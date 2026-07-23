import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import initializeWasm, {
  draw,
  getBotObservation,
  getInitialState,
  getLegalActions,
  getNextState,
  lost,
  won,
} from "../src/wasm/quantum_animal_shogi_wasm.js";
import {
  actorRewardForOutcome,
  encodeProtocolAction,
  expectedSeatForPly,
  trajectoryContract,
} from "../src/game/trajectory_contract.mjs";

const wasmBinary = new URL(
  "../src/wasm/quantum_animal_shogi_wasm_bg.wasm",
  import.meta.url,
);
let wasmInitialization;
let validatorRulesetDigest;

const initializeValidator = () => {
  wasmInitialization ??= readFile(wasmBinary).then((bytes) => {
    validatorRulesetDigest = createHash("sha256").update(bytes).digest("hex");
    return initializeWasm({ module_or_path: bytes });
  });
  return wasmInitialization;
};

const parseJson = (value, fallback) => {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const canonicalValue = (value) => {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
};

export const canonicalJson = (value) => JSON.stringify(canonicalValue(value));

export const hashJson = (value) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");

const snapshotState = (state) => ({
  pieces: Array.from(state.pieces),
  ownership: state.ownership,
  bitBoards: Array.from(state.bitBoards),
  turn: state.turn,
});

const transitionMaterial = (move) => ({
  ply: Number(move.ply),
  seat: Number(move.seat),
  source: Number(move.source),
  destination: Number(move.destination),
  protocolAction: Number(move.protocolAction),
  thinkTimeMs:
    move.thinkTimeMs === null || move.thinkTimeMs === undefined
      ? null
      : Number(move.thinkTimeMs),
  observation: parseJson(move.observation, []),
  actionMask: parseJson(move.actionMask, []),
  observationTurn: Number(move.observationTurn),
  stateBefore: parseJson(move.stateBefore, null),
  stateAfter: parseJson(move.stateAfter, null),
  rewardAfter:
    move.rewardAfter === null || move.rewardAfter === undefined
      ? null
      : Number(move.rewardAfter),
  rewardPerspective: move.rewardPerspective,
  outcomeAfter: move.outcomeAfter ?? null,
  isTerminal: Boolean(move.isTerminal),
  terminalReasonKey: move.terminalReasonKey ?? null,
  actorKind: move.actorKind,
  policyMetadata: parseJson(move.policyMetadata, {}),
  qualityFlags: parseJson(move.qualityFlags, []),
});

export const transitionChecksumFor = (move) =>
  hashJson(transitionMaterial(move));

const sameJson = (left, right) => canonicalJson(left) === canonicalJson(right);

const terminalResult = (state, actorSeat) => {
  const nextSeat = actorSeat === 0 ? 1 : 0;
  if (won(state)) {
    return {
      outcome: nextSeat === 0 ? "player-one-win" : "player-two-win",
      reason: "try",
    };
  }
  if (lost(state)) {
    return {
      outcome: actorSeat === 0 ? "player-one-win" : "player-two-win",
      reason: "catch",
    };
  }
  if (draw(state)) {
    return { outcome: "draw", reason: "max-turn-draw" };
  }
  return null;
};

const addMismatch = (errors, code, message, ply = null) => {
  errors.push({ code, message, ...(ply === null ? {} : { ply }) });
};

export const validateTrajectory = async (match, moves) => {
  await initializeValidator();
  const errors = [];
  const checks = {
    schema: false,
    provenance: false,
    initialState: false,
    contiguousPly: false,
    legalActions: false,
    stateTransitions: false,
    terminalOutcome: false,
    checksums: false,
    qualityFlags: false,
    policyDecisions: false,
  };
  if (
    Number(match.trajectorySchemaVersion) !==
      trajectoryContract.schemaVersion ||
    match.rulesetVersion !== trajectoryContract.rulesetVersion ||
    !/^[a-z0-9._-]{1,80}$/.test(match.dataSource ?? "") ||
    match.recorderVersion !== trajectoryContract.recorderVersion ||
    !/^[0-9a-f]{64}$/.test(match.recorderBuildDigest ?? "") ||
    match.rulesetDigest !== validatorRulesetDigest ||
    !Number.isInteger(Number(match.rngSeed)) ||
    Number(match.rngSeed) < 0 ||
    Number(match.rngSeed) > 0xffff_ffff ||
    match.observationEncoding !== trajectoryContract.observationEncoding ||
    match.actionEncoding !== trajectoryContract.actionEncoding ||
    match.stateEncoding !== trajectoryContract.stateEncoding ||
    match.rewardEncoding !== trajectoryContract.rewardEncoding
  ) {
    addMismatch(
      errors,
      "schema-contract",
      "Trajectory encoding contract is not v2.",
    );
  } else {
    checks.schema = true;
  }
  if (
    !/^[0-9a-f]{64}$/.test(match.botOneArtifactDigest ?? "") ||
    !/^[0-9a-f]{64}$/.test(match.botTwoArtifactDigest ?? "") ||
    !/^[a-zA-Z0-9._:-]{1,120}$/.test(match.botOnePolicyKey ?? "") ||
    !/^[a-zA-Z0-9._:-]{1,120}$/.test(match.botTwoPolicyKey ?? "")
  ) {
    addMismatch(
      errors,
      "bot-provenance",
      "A participant has incomplete version provenance.",
    );
  } else {
    checks.provenance = true;
  }

  let currentState = getInitialState();
  const expectedInitialState = snapshotState(currentState);
  const storedInitialState = parseJson(match.initialState, null);
  if (
    !sameJson(storedInitialState, expectedInitialState) ||
    match.initialStateHash !== hashJson(expectedInitialState)
  ) {
    addMismatch(errors, "initial-state", "Initial state or hash is invalid.");
  } else {
    checks.initialState = true;
  }

  let stoppedEarly = false;
  let observedTerminal = null;
  let randomState = Number(match.rngSeed) >>> 0;
  const transitionChecksums = [];
  for (const [index, move] of moves.entries()) {
    const expectedPly = index + 1;
    const ply = Number(move.ply);
    const seat = Number(move.seat);
    if (
      ply !== expectedPly ||
      seat !== expectedSeatForPly(Number(match.firstSeat), expectedPly)
    ) {
      addMismatch(errors, "ply-seat", "Ply or seat is not contiguous.", ply);
    }
    const stateBefore = parseJson(move.stateBefore, null);
    const expectedBefore = snapshotState(currentState);
    if (
      !sameJson(stateBefore, expectedBefore) ||
      move.stateBeforeHash !== hashJson(expectedBefore)
    ) {
      addMismatch(
        errors,
        "state-before",
        "State before action is invalid.",
        ply,
      );
    }

    const expectedObservation = getBotObservation(currentState);
    const observation = parseJson(move.observation, []);
    const actionMask = parseJson(move.actionMask, []);
    if (
      !sameJson(observation, expectedObservation.observation) ||
      !sameJson(actionMask, expectedObservation.actionMask) ||
      Number(move.observationTurn) !== Number(expectedObservation.turn)
    ) {
      addMismatch(
        errors,
        "observation",
        "Observation or legal mask differs from replay.",
        ply,
      );
    }

    const action = [Number(move.source), Number(move.destination)];
    const protocolAction = Number(move.protocolAction);
    const legalActions = getLegalActions(currentState);
    const isLegal = legalActions.some(
      (candidate) => candidate[0] === action[0] && candidate[1] === action[1],
    );
    if (
      !isLegal ||
      encodeProtocolAction(action) !== protocolAction ||
      actionMask[protocolAction] !== 1
    ) {
      addMismatch(
        errors,
        "illegal-action",
        "Stored action is not legal for the replayed state.",
        ply,
      );
      stoppedEarly = true;
      break;
    }
    const expectedActor =
      seat === 0
        ? {
            kind: match.botOneKind,
            botId: match.botOneId,
            versionKey: match.botOneVersionKey,
            policyKey: match.botOnePolicyKey,
          }
        : {
            kind: match.botTwoKind,
            botId: match.botTwoId,
            versionKey: match.botTwoVersionKey,
            policyKey: match.botTwoPolicyKey,
          };
    if (expectedActor.kind === "wasm-random") {
      randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
      const expectedAction = legalActions[randomState % legalActions.length];
      if (
        !expectedAction ||
        expectedAction[0] !== action[0] ||
        expectedAction[1] !== action[1]
      ) {
        addMismatch(
          errors,
          "policy-decision",
          "Seeded random action differs from the recorded policy decision.",
          ply,
        );
      }
    }

    const nextState = getNextState(currentState, action);
    const expectedAfter = snapshotState(nextState);
    if (
      !sameJson(parseJson(move.stateAfter, null), expectedAfter) ||
      move.stateAfterHash !== hashJson(expectedAfter)
    ) {
      addMismatch(
        errors,
        "state-after",
        "State after action differs from replay.",
        ply,
      );
    }
    const terminal = terminalResult(nextState, seat);
    const expectedReward = terminal
      ? actorRewardForOutcome(seat, terminal.outcome)
      : 0;
    if (
      Boolean(move.isTerminal) !== Boolean(terminal) ||
      (move.outcomeAfter ?? null) !== (terminal?.outcome ?? null) ||
      (move.terminalReasonKey ?? null) !== (terminal?.reason ?? null) ||
      move.rewardPerspective !== "actor" ||
      Number(move.rewardAfter) !== expectedReward
    ) {
      addMismatch(
        errors,
        "terminal-label",
        "Reward or terminal label is inconsistent.",
        ply,
      );
    }
    const policyMetadata = parseJson(move.policyMetadata, {});
    if (
      move.actorKind !== expectedActor.kind ||
      policyMetadata.botId !== expectedActor.botId ||
      policyMetadata.versionKey !== expectedActor.versionKey ||
      policyMetadata.policyKey !== expectedActor.policyKey ||
      Number(policyMetadata.schemaVersion) !== 1
    ) {
      addMismatch(
        errors,
        "actor-provenance",
        "Move actor provenance is inconsistent.",
        ply,
      );
    }
    const qualityFlags = parseJson(move.qualityFlags, null);
    if (!Array.isArray(qualityFlags) || qualityFlags.length !== 0) {
      addMismatch(
        errors,
        "quality-flag",
        "Transition has an exclusion quality flag.",
        ply,
      );
    }
    if (terminal) {
      observedTerminal = terminal;
      if (index !== moves.length - 1) {
        addMismatch(
          errors,
          "moves-after-terminal",
          "Trajectory continues after a terminal state.",
          ply,
        );
      }
    }

    const expectedTransitionChecksum = transitionChecksumFor(move);
    transitionChecksums.push(expectedTransitionChecksum);
    if (move.transitionChecksum !== expectedTransitionChecksum) {
      addMismatch(
        errors,
        "transition-checksum",
        "Transition checksum differs.",
        ply,
      );
    }
    currentState = nextState;
  }

  checks.contiguousPly = !errors.some(({ code }) => code === "ply-seat");
  checks.legalActions = !errors.some(({ code }) =>
    ["observation", "illegal-action"].includes(code),
  );
  checks.stateTransitions = !errors.some(({ code }) =>
    ["state-before", "state-after", "moves-after-terminal"].includes(code),
  );
  if (
    stoppedEarly ||
    moves.length === 0 ||
    !observedTerminal ||
    match.status !== "completed" ||
    match.outcome !== observedTerminal.outcome ||
    match.terminationReason !== observedTerminal.reason
  ) {
    addMismatch(
      errors,
      "match-outcome",
      "Completed match does not match the replayed terminal state.",
    );
  } else {
    checks.terminalOutcome = true;
  }
  checks.checksums = !errors.some(({ code }) =>
    ["initial-state", "transition-checksum"].includes(code),
  );
  checks.provenance =
    checks.provenance &&
    !errors.some(({ code }) => code === "actor-provenance");
  checks.qualityFlags = !errors.some(({ code }) => code === "quality-flag");
  checks.policyDecisions = !errors.some(
    ({ code }) => code === "policy-decision",
  );

  const trajectoryChecksum =
    errors.length === 0
      ? hashJson({
          schemaVersion: Number(match.trajectorySchemaVersion),
          rulesetVersion: match.rulesetVersion,
          rulesetDigest: match.rulesetDigest,
          dataSource: match.dataSource,
          recorderVersion: match.recorderVersion,
          recorderBuildDigest: match.recorderBuildDigest,
          encodings: {
            observation: match.observationEncoding,
            action: match.actionEncoding,
            state: match.stateEncoding,
            reward: match.rewardEncoding,
          },
          rngSeed: Number(match.rngSeed),
          initialStateHash: match.initialStateHash,
          transitions: transitionChecksums,
          outcome: match.outcome,
          terminationReason: match.terminationReason,
        })
      : null;
  return {
    passed: errors.length === 0,
    checks,
    errors,
    trajectoryChecksum,
  };
};

export const validateStoredTrajectory = async (connection, matchId) => {
  const [matchRows] = await connection.execute(
    `SELECT matches.id, matches.status, matches.outcome,
            matches.termination_reason AS terminationReason,
            first_seat AS firstSeat, ruleset_version AS rulesetVersion,
            trajectory_schema_version AS trajectorySchemaVersion,
            data_source AS dataSource,
            recorder_version AS recorderVersion,
            recorder_build_digest AS recorderBuildDigest,
            observation_encoding AS observationEncoding,
            action_encoding AS actionEncoding, state_encoding AS stateEncoding,
            reward_encoding AS rewardEncoding, ruleset_digest AS rulesetDigest,
            rng_seed AS rngSeed, initial_state_json AS initialState,
            initial_state_hash AS initialStateHash,
            bot_one.bot_key AS botOneId, bot_one.kind AS botOneKind,
            version_one.version_key AS botOneVersionKey,
            version_one.artifact_digest AS botOneArtifactDigest,
            version_one.policy_key AS botOnePolicyKey,
            bot_two.bot_key AS botTwoId, bot_two.kind AS botTwoKind,
            version_two.version_key AS botTwoVersionKey,
            version_two.artifact_digest AS botTwoArtifactDigest,
            version_two.policy_key AS botTwoPolicyKey
     FROM matches
     JOIN bot_versions AS version_one ON version_one.id = matches.bot_one_version_id
     JOIN bots AS bot_one ON bot_one.id = version_one.bot_id
     JOIN bot_versions AS version_two ON version_two.id = matches.bot_two_version_id
     JOIN bots AS bot_two ON bot_two.id = version_two.bot_id
     WHERE matches.id = ?`,
    [matchId],
  );
  if (!matchRows[0]) {
    throw new Error("trajectory match was not found");
  }
  const [moves] = await connection.execute(
    `SELECT ply, seat, source_square AS source, destination_square AS destination,
            protocol_action AS protocolAction, think_time_ms AS thinkTimeMs,
            observation_json AS observation,
            action_mask_json AS actionMask, observation_turn AS observationTurn,
            state_before_json AS stateBefore,
            state_before_hash AS stateBeforeHash, state_after_json AS stateAfter,
            state_after_hash AS stateAfterHash, transition_checksum AS transitionChecksum,
            reward_after AS rewardAfter, reward_perspective AS rewardPerspective,
            outcome_after AS outcomeAfter, is_terminal AS isTerminal,
            terminal_reason_key AS terminalReasonKey, actor_kind AS actorKind,
            policy_metadata_json AS policyMetadata,
            quality_flags_json AS qualityFlags
     FROM match_moves WHERE match_id = ? ORDER BY ply`,
    [matchId],
  );
  const result = await validateTrajectory(matchRows[0], moves);
  await connection.execute(
    `INSERT INTO trajectory_validations
      (public_id, match_id, validator_version, status, trajectory_checksum,
       checks_json, errors_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      matchId,
      trajectoryContract.validatorVersion,
      result.passed ? "passed" : "failed",
      result.trajectoryChecksum,
      JSON.stringify(result.checks),
      JSON.stringify(result.errors),
    ],
  );
  await connection.execute(
    `UPDATE matches
     SET quality_status = ?, trajectory_checksum = ?, validated_at = CURRENT_TIMESTAMP(3),
         validation_error = ?
     WHERE id = ?`,
    [
      result.passed ? "train-eligible" : "rejected",
      result.trajectoryChecksum,
      result.passed ? null : JSON.stringify(result.errors),
      matchId,
    ],
  );
  return result;
};
