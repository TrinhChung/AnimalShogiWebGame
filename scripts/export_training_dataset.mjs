import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createDatabaseFromEnvironment } from "../server/database.mjs";
import {
  canonicalJson,
  validateStoredTrajectory,
} from "../server/trajectory_integrity.mjs";
import { actorRewardForOutcome } from "../src/game/trajectory_contract.mjs";

const datasetSchemaVersion = 1;
const parseArguments = (arguments_) => {
  const result = {
    output: path.resolve("output/datasets"),
    name: `qas-training-${new Date().toISOString().slice(0, 10)}`,
    seed: 20_260_723,
  };
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!value || !["--output", "--name", "--seed"].includes(key)) {
      throw new Error(
        "usage: npm run dataset:export -- --output <dir> --name <name> --seed <uint32>",
      );
    }
    if (key === "--output") result.output = path.resolve(value);
    if (key === "--name") result.name = value;
    if (key === "--seed") result.seed = Number(value);
  }
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(result.name)) {
    throw new Error("dataset name is invalid");
  }
  if (
    !Number.isInteger(result.seed) ||
    result.seed < 0 ||
    result.seed > 0xffff_ffff
  ) {
    throw new Error("dataset seed is invalid");
  }
  return result;
};

const parseJson = (value, fallback) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

export const splitForGroup = (groupId, seed) => {
  const bucket = Number.parseInt(
    createHash("sha256").update(`${seed}:${groupId}`).digest("hex").slice(0, 8),
    16,
  );
  const ratio = bucket / 0x1_0000_0000;
  return ratio < 0.8 ? "train" : ratio < 0.9 ? "validation" : "test";
};

const verifyTrajectoryForExport = async (database, match) => {
  const connection = await database.getConnection();
  let result;
  try {
    await connection.beginTransaction();
    result = await validateStoredTrajectory(connection, match.databaseId);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  if (!result.passed) {
    throw new Error(
      `Trajectory ${match.matchId} failed replay validation during export`,
    );
  }
  if (result.trajectoryChecksum !== match.trajectoryChecksum) {
    throw new Error(
      `Trajectory ${match.matchId} checksum changed during export validation`,
    );
  }
};

const gameplayFingerprint = (match, moves) =>
  createHash("sha256")
    .update(
      canonicalJson({
        rulesetDigest: match.rulesetDigest,
        initialStateHash: match.initialStateHash,
        outcome: match.outcome,
        actors: moves.map((move) => move.versionKey),
        actions: moves.map((move) => Number(move.protocolAction)),
      }),
    )
    .digest("hex");

const labelRecord = (row) => ({
  namespace: row.namespaceKey,
  key: row.labelKey,
  version: Number(row.labelVersion),
  value: parseJson(row.valueJson, null),
  producer: row.producerKey,
  confidence: row.confidence === null ? null : Number(row.confidence),
});

const loadLabels = async (database, matchDatabaseId) => {
  const [rows] = await database.execute(
    `SELECT labels.match_id AS matchId, labels.match_move_id AS moveId,
            labels.namespace_key AS namespaceKey, labels.label_key AS labelKey,
            labels.label_version AS labelVersion, labels.value_json AS valueJson,
            labels.producer_key AS producerKey, labels.confidence
     FROM training_labels AS labels
     LEFT JOIN match_moves ON match_moves.id = labels.match_move_id
     WHERE labels.match_id = ? OR match_moves.match_id = ?
     ORDER BY labels.id`,
    [matchDatabaseId, matchDatabaseId],
  );
  const matchLabels = [];
  const moveLabels = new Map();
  for (const row of rows) {
    if (row.moveId === null) {
      matchLabels.push(labelRecord(row));
      continue;
    }
    const key = String(row.moveId);
    if (!moveLabels.has(key)) moveLabels.set(key, []);
    moveLabels.get(key).push(labelRecord(row));
  }
  return { matchLabels, moveLabels };
};

const loadMoves = async (database, matchDatabaseId) => {
  const [rows] = await database.execute(
    `SELECT match_moves.id AS databaseId, match_moves.public_id AS moveId,
            match_moves.ply, match_moves.seat, bots.bot_key AS botId,
            bots.kind AS actorKind, bot_versions.version_key AS versionKey,
            bot_versions.artifact_digest AS artifactDigest,
            bot_versions.policy_key AS policyKey,
            match_moves.source_square AS source,
            match_moves.destination_square AS destination,
            match_moves.protocol_action AS protocolAction,
            match_moves.think_time_ms AS thinkTimeMs,
            match_moves.observation_json AS observation,
            match_moves.action_mask_json AS actionMask,
            match_moves.observation_turn AS observationTurn,
            match_moves.state_before_json AS stateBefore,
            match_moves.state_before_hash AS stateBeforeHash,
            match_moves.state_after_json AS stateAfter,
            match_moves.state_after_hash AS stateAfterHash,
            match_moves.transition_checksum AS transitionChecksum,
            match_moves.reward_after AS rewardAfter,
            match_moves.reward_perspective AS rewardPerspective,
            match_moves.outcome_after AS outcomeAfter,
            match_moves.terminal_reason_key AS terminalReason,
            match_moves.is_terminal AS isTerminal,
            match_moves.policy_metadata_json AS policyMetadata,
            match_moves.quality_flags_json AS qualityFlags
     FROM match_moves
     JOIN bot_versions ON bot_versions.id = match_moves.bot_version_id
     JOIN bots ON bots.id = bot_versions.bot_id
     WHERE match_moves.match_id = ?
     ORDER BY match_moves.ply`,
    [matchDatabaseId],
  );
  return rows;
};

const createSample = (match, move, split, annotations) => ({
  dataset_schema_version: datasetSchemaVersion,
  trajectory_schema_version: Number(match.trajectorySchemaVersion),
  split,
  match_id: match.matchId,
  move_id: move.moveId,
  ply: Number(move.ply),
  provenance: {
    data_source: match.dataSource,
    ruleset_version: match.rulesetVersion,
    ruleset_digest: match.rulesetDigest,
    recorder_version: match.recorderVersion,
    recorder_build_digest: match.recorderBuildDigest,
    rng_seed: Number(match.rngSeed),
    trajectory_checksum: match.trajectoryChecksum,
    transition_checksum: move.transitionChecksum,
  },
  actor: {
    seat: Number(move.seat),
    kind: move.actorKind,
    bot_id: move.botId,
    version_key: move.versionKey,
    artifact_digest: move.artifactDigest,
    policy_key: move.policyKey,
  },
  encoding: {
    observation: match.observationEncoding,
    action: match.actionEncoding,
    state: match.stateEncoding,
    reward: match.rewardEncoding,
    perspective: "side-to-move",
  },
  state_before: parseJson(move.stateBefore, null),
  state_before_hash: move.stateBeforeHash,
  observation: parseJson(move.observation, []),
  legal_action_mask: parseJson(move.actionMask, []),
  observation_turn: Number(move.observationTurn),
  action: {
    source: Number(move.source),
    destination: Number(move.destination),
    protocol_action: Number(move.protocolAction),
  },
  immediate_reward: Number(move.rewardAfter),
  reward_perspective: move.rewardPerspective,
  state_after: parseJson(move.stateAfter, null),
  state_after_hash: move.stateAfterHash,
  terminal: Boolean(move.isTerminal),
  terminal_reason: move.terminalReason ?? null,
  targets: {
    action: Number(move.protocolAction),
    final_outcome: match.outcome,
    return_for_actor: actorRewardForOutcome(Number(move.seat), match.outcome),
  },
  policy_metadata: parseJson(move.policyMetadata, {}),
  quality_flags: parseJson(move.qualityFlags, []),
  annotations,
});

export const exportTrainingDataset = async (options) => {
  const database = await createDatabaseFromEnvironment();
  if (!database) throw new Error("MySQL is not configured");
  const exportPublicId = randomUUID();
  let exportDatabaseId = null;
  const fileState = {};
  try {
    const datasetDirectory = path.join(
      options.output,
      `${options.name}-${exportPublicId}`,
    );
    await mkdir(datasetDirectory, { recursive: true });
    const filter = {
      quality_status: "train-eligible",
      trajectory_schema_version: 2,
      match_status: "completed",
    };
    const [exportResult] = await database.execute(
      `INSERT INTO dataset_exports
        (public_id, name, dataset_schema_version, status, split_seed,
         split_strategy, filter_json)
       VALUES (?, ?, ?, 'building', ?, 'series-hash-80-10-10-v1', ?)`,
      [
        exportPublicId,
        options.name,
        datasetSchemaVersion,
        options.seed,
        JSON.stringify(filter),
      ],
    );
    exportDatabaseId = exportResult.insertId;
    for (const split of ["train", "validation", "test"]) {
      fileState[split] = {
        name: `${split}.jsonl`,
        handle: await open(path.join(datasetDirectory, `${split}.jsonl`), "wx"),
        digest: createHash("sha256"),
        samples: 0,
        matches: 0,
      };
    }
    const [matches] = await database.query(`
      SELECT matches.id AS databaseId, matches.public_id AS matchId,
             match_series.public_id AS seriesId, matches.outcome,
             matches.ruleset_version AS rulesetVersion,
             trajectory_schema_version AS trajectorySchemaVersion,
             data_source AS dataSource, recorder_version AS recorderVersion,
             recorder_build_digest AS recorderBuildDigest,
             observation_encoding AS observationEncoding,
             action_encoding AS actionEncoding, state_encoding AS stateEncoding,
             reward_encoding AS rewardEncoding, ruleset_digest AS rulesetDigest,
             rng_seed AS rngSeed, initial_state_hash AS initialStateHash,
             trajectory_checksum AS trajectoryChecksum
      FROM matches
      LEFT JOIN match_series ON match_series.id = matches.series_id
      WHERE matches.quality_status = 'train-eligible'
        AND matches.trajectory_schema_version = 2
        AND matches.status = 'completed'
        AND matches.trajectory_checksum IS NOT NULL
      ORDER BY matches.public_id
    `);
    if (matches.length === 0) {
      throw new Error(
        "No train-eligible trajectories are available for export",
      );
    }
    const seenFingerprints = new Set();
    let duplicateMatchCount = 0;
    for (const match of matches) {
      await verifyTrajectoryForExport(database, match);
      const moves = await loadMoves(database, match.databaseId);
      const fingerprint = gameplayFingerprint(match, moves);
      if (seenFingerprints.has(fingerprint)) {
        duplicateMatchCount += 1;
        continue;
      }
      seenFingerprints.add(fingerprint);
      const split = splitForGroup(
        match.seriesId ?? match.matchId,
        options.seed,
      );
      const targetFile = fileState[split];
      const { matchLabels, moveLabels } = await loadLabels(
        database,
        match.databaseId,
      );
      for (const move of moves) {
        const sample = createSample(match, move, split, [
          ...matchLabels,
          ...(moveLabels.get(String(move.databaseId)) ?? []),
        ]);
        const line = `${canonicalJson(sample)}\n`;
        await targetFile.handle.write(line);
        targetFile.digest.update(line);
        targetFile.samples += 1;
      }
      targetFile.matches += 1;
      await database.execute(
        `INSERT INTO dataset_export_items
          (export_id, match_id, split_key, sample_count, trajectory_checksum)
         VALUES (?, ?, ?, ?, ?)`,
        [
          exportDatabaseId,
          match.databaseId,
          split,
          moves.length,
          match.trajectoryChecksum,
        ],
      );
    }
    for (const state of Object.values(fileState)) await state.handle.close();
    const manifest = {
      dataset_schema_version: datasetSchemaVersion,
      export_id: exportPublicId,
      name: options.name,
      created_at_utc: new Date().toISOString(),
      filter,
      split: {
        seed: options.seed,
        strategy: "series-hash-80-10-10-v1",
        leakage_boundary: "series_id",
        duplicate_strategy: "gameplay-fingerprint-first-only-v1",
        duplicate_matches_excluded: duplicateMatchCount,
      },
      labels: {
        immediate_reward: "actor-perspective terminal reward v1",
        return_for_actor: "final match outcome from acting seat v1",
        action: "official 240-action index v1",
        annotations: "append-only training_labels records",
      },
      files: Object.fromEntries(
        Object.entries(fileState).map(([split, state]) => [
          split,
          {
            path: state.name,
            sha256: state.digest.digest("hex"),
            matches: state.matches,
            samples: state.samples,
          },
        ]),
      ),
    };
    const manifestSha256 = createHash("sha256")
      .update(canonicalJson(manifest))
      .digest("hex");
    await writeFile(
      path.join(datasetDirectory, "manifest.json"),
      `${JSON.stringify({ ...manifest, manifest_sha256: manifestSha256 }, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    const sampleCount = Object.values(fileState).reduce(
      (sum, state) => sum + state.samples,
      0,
    );
    const matchCount = Object.values(fileState).reduce(
      (sum, state) => sum + state.matches,
      0,
    );
    await database.execute(
      `UPDATE dataset_exports
       SET status = 'completed', manifest_json = ?, manifest_sha256 = ?,
           sample_count = ?, match_count = ?, finalized_at = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [
        JSON.stringify(manifest),
        manifestSha256,
        sampleCount,
        matchCount,
        exportDatabaseId,
      ],
    );
    console.log(
      `Dataset exported: ${datasetDirectory} (${matchCount} matches, ${sampleCount} samples)`,
    );
    return {
      id: exportPublicId,
      directory: datasetDirectory,
      matchCount,
      sampleCount,
      duplicateMatchCount,
    };
  } catch (error) {
    for (const state of Object.values(fileState)) {
      await state.handle.close().catch(() => undefined);
    }
    if (exportDatabaseId !== null) {
      await database.execute(
        "UPDATE dataset_exports SET status = 'failed', finalized_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
        [exportDatabaseId],
      );
    }
    throw error;
  } finally {
    await database.end();
  }
};

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  exportTrainingDataset(parseArguments(process.argv.slice(2))).catch(
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
