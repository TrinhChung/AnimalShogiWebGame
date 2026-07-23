import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  trajectoryContract,
} from "../src/game/trajectory_contract.mjs";
import {
  hashJson,
  transitionChecksumFor,
  validateTrajectory,
} from "./trajectory_integrity.mjs";

const snapshot = (state) => ({
  pieces: Array.from(state.pieces),
  ownership: state.ownership,
  bitBoards: Array.from(state.bitBoards),
  turn: state.turn,
});

const terminalResult = (state, seat) => {
  if (won(state)) {
    const nextSeat = seat === 0 ? 1 : 0;
    return {
      outcome: nextSeat === 0 ? "player-one-win" : "player-two-win",
      reason: "try",
    };
  }
  if (lost(state)) {
    return {
      outcome: seat === 0 ? "player-one-win" : "player-two-win",
      reason: "catch",
    };
  }
  return draw(state) ? { outcome: "draw", reason: "max-turn-draw" } : null;
};

const fixture = async () => {
  const bytes = await readFile(
    new URL("../src/wasm/quantum_animal_shogi_wasm_bg.wasm", import.meta.url),
  );
  const rulesetDigest = createHash("sha256").update(bytes).digest("hex");
  await initializeWasm({ module_or_path: bytes });
  let state = getInitialState();
  const initialState = snapshot(state);
  const moves = [];
  let finalResult = null;
  for (let ply = 1; ply <= 256; ply += 1) {
    const seat = (ply - 1) % 2;
    const observation = getBotObservation(state);
    const action = getLegalActions(state)[0];
    assert(action, "fixture requires a legal action");
    const nextState = getNextState(state, action);
    const terminal = terminalResult(nextState, seat);
    const stateBefore = snapshot(state);
    const stateAfter = snapshot(nextState);
    const move = {
      ply,
      seat,
      source: action[0],
      destination: action[1],
      protocolAction: encodeProtocolAction(action),
      observation: observation.observation,
      actionMask: observation.actionMask,
      observationTurn: observation.turn,
      stateBefore,
      stateBeforeHash: hashJson(stateBefore),
      stateAfter,
      stateAfterHash: hashJson(stateAfter),
      rewardAfter: terminal ? actorRewardForOutcome(seat, terminal.outcome) : 0,
      rewardPerspective: "actor",
      outcomeAfter: terminal?.outcome ?? null,
      isTerminal: Boolean(terminal),
      terminalReasonKey: terminal?.reason ?? null,
      actorKind: "wasm-alpha-beta",
      policyMetadata: {
        schemaVersion: 1,
        botId: seat === 0 ? "fixture-one" : "fixture-two",
        versionKey: seat === 0 ? "fixture-one-v1" : "fixture-two-v1",
        policyKey: "fixture-first-legal-v1",
        configuredDepth: null,
        decisionStats: null,
      },
      qualityFlags: [],
    };
    move.transitionChecksum = transitionChecksumFor(move);
    moves.push(move);
    state = nextState;
    if (terminal) {
      finalResult = terminal;
      break;
    }
  }
  assert(finalResult, "fixture must terminate");
  return {
    match: {
      status: "completed",
      outcome: finalResult.outcome,
      terminationReason: finalResult.reason,
      firstSeat: 0,
      rulesetVersion: trajectoryContract.rulesetVersion,
      dataSource: "unit-test",
      trajectorySchemaVersion: trajectoryContract.schemaVersion,
      recorderVersion: trajectoryContract.recorderVersion,
      recorderBuildDigest: "a".repeat(64),
      observationEncoding: trajectoryContract.observationEncoding,
      actionEncoding: trajectoryContract.actionEncoding,
      stateEncoding: trajectoryContract.stateEncoding,
      rewardEncoding: trajectoryContract.rewardEncoding,
      rulesetDigest,
      rngSeed: 123,
      initialState,
      initialStateHash: hashJson(initialState),
      botOneId: "fixture-one",
      botOneKind: "wasm-alpha-beta",
      botOneVersionKey: "fixture-one-v1",
      botOneArtifactDigest: "c".repeat(64),
      botOnePolicyKey: "fixture-first-legal-v1",
      botTwoId: "fixture-two",
      botTwoKind: "wasm-alpha-beta",
      botTwoVersionKey: "fixture-two-v1",
      botTwoArtifactDigest: "d".repeat(64),
      botTwoPolicyKey: "fixture-first-legal-v1",
    },
    moves,
  };
};

test("a complete deterministic trajectory is train eligible", async () => {
  const { match, moves } = await fixture();
  const result = await validateTrajectory(match, moves);
  assert.equal(result.passed, true, JSON.stringify(result.errors));
  assert.match(result.trajectoryChecksum, /^[0-9a-f]{64}$/);
  assert(Object.values(result.checks).every(Boolean));
});

test("replay rejects a legal-mask mutation", async () => {
  const { match, moves } = await fixture();
  moves[0].actionMask[moves[0].protocolAction] = 0;
  moves[0].transitionChecksum = transitionChecksumFor(moves[0]);
  const result = await validateTrajectory(match, moves);
  assert.equal(result.passed, false);
  assert(result.errors.some(({ code }) => code === "observation"));
});

test("replay rejects an actor-perspective reward mutation", async () => {
  const { match, moves } = await fixture();
  const terminalMove = moves.at(-1);
  terminalMove.rewardAfter =
    terminalMove.rewardAfter === 0 ? 1 : -terminalMove.rewardAfter;
  terminalMove.transitionChecksum = transitionChecksumFor(terminalMove);
  const result = await validateTrajectory(match, moves);
  assert.equal(result.passed, false);
  assert(result.errors.some(({ code }) => code === "terminal-label"));
});

test("replay rejects actor provenance and quality exclusion flags", async () => {
  const { match, moves } = await fixture();
  moves[0].policyMetadata.botId = "wrong-bot";
  moves[0].qualityFlags = ["recorder.partial-observation"];
  moves[0].transitionChecksum = transitionChecksumFor(moves[0]);
  const result = await validateTrajectory(match, moves);
  assert.equal(result.passed, false);
  assert(result.errors.some(({ code }) => code === "actor-provenance"));
  assert(result.errors.some(({ code }) => code === "quality-flag"));
});

test("replay verifies seeded random policy decisions", async () => {
  const { match, moves } = await fixture();
  match.botOneKind = "wasm-random";
  match.botTwoKind = "wasm-random";
  for (const move of moves) {
    move.actorKind = "wasm-random";
    move.transitionChecksum = transitionChecksumFor(move);
  }
  const result = await validateTrajectory(match, moves);
  assert.equal(result.passed, false);
  assert(result.errors.some(({ code }) => code === "policy-decision"));
});
