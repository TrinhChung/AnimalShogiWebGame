import { randomUUID } from "node:crypto";

import {
  assignSeeds,
  createSeededRound,
} from "../src/game/seeded_tournament.mjs";
import {
  actorRewardForOutcome,
  encodeProtocolAction,
  expectedSeatForPly,
  trajectoryContract,
} from "../src/game/trajectory_contract.mjs";
import {
  canonicalJson,
  hashJson,
  transitionChecksumFor,
  validateStoredTrajectory,
} from "./trajectory_integrity.mjs";

const maximumRepeatCount = 500;
const maximumTournamentGamesPerPairing = 20;
const ratingKFactor = 24;
const ratingFormulaVersion = "elo-400-k24-v1";
const reportColors = [
  "#dca047",
  "#5c9d7e",
  "#668fc5",
  "#8a72bf",
  "#bf7767",
  "#5b9ca1",
];

const json = (value) => JSON.stringify(value ?? {});

const validateBot = (bot) => {
  if (
    !bot ||
    typeof bot.id !== "string" ||
    typeof bot.name !== "string" ||
    typeof bot.kind !== "string" ||
    typeof bot.version !== "string" ||
    typeof bot.versionKey !== "string"
  ) {
    throw new Error("bot definition is invalid");
  }
  for (const field of ["id", "kind", "version", "versionKey"]) {
    if (!/^[a-zA-Z0-9._:-]{1,255}$/.test(bot[field])) {
      throw new Error(`bot ${field} is invalid`);
    }
  }
  const artifactDigest = bot.artifactDigest;
  if (
    typeof artifactDigest !== "string" ||
    !/^[0-9a-f]{64}$/.test(artifactDigest)
  ) {
    throw new Error("bot artifactDigest is invalid");
  }
  const policyKey = bot.policyKey;
  if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(policyKey)) {
    throw new Error("bot policyKey is invalid");
  }
  return { ...bot, artifactDigest, policyKey };
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

const normalizeDecisionStats = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("policy decisionStats is invalid");
  }
  const allowedKeys = new Set([
    "searchDepth",
    "nodes",
    "score",
    "scorePerspective",
    "selectedActionProbability",
    "policyEntropy",
    "principalVariation",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error("policy decisionStats contains an unknown field");
  }
  const optionalInteger = (item, field, maximum) => {
    if (item === undefined || item === null) return null;
    if (!Number.isSafeInteger(item) || item < 0 || item > maximum) {
      throw new Error(`policy ${field} is invalid`);
    }
    return item;
  };
  const optionalNumber = (item, field, minimum, maximum) => {
    if (item === undefined || item === null) return null;
    if (!Number.isFinite(item) || item < minimum || item > maximum) {
      throw new Error(`policy ${field} is invalid`);
    }
    return item;
  };
  const principalVariation = value.principalVariation ?? [];
  if (
    !Array.isArray(principalVariation) ||
    principalVariation.length > 256 ||
    !principalVariation.every(
      (action) => Number.isInteger(action) && action >= 0 && action < 240,
    )
  ) {
    throw new Error("policy principalVariation is invalid");
  }
  if (
    value.scorePerspective !== undefined &&
    value.scorePerspective !== "actor"
  ) {
    throw new Error("policy scorePerspective is invalid");
  }
  return {
    schemaVersion: 1,
    searchDepth: optionalInteger(value.searchDepth, "searchDepth", 256),
    nodes: optionalInteger(value.nodes, "nodes", Number.MAX_SAFE_INTEGER),
    score: optionalNumber(value.score, "score", -1_000_000_000, 1_000_000_000),
    scorePerspective: value.scorePerspective ?? "actor",
    selectedActionProbability: optionalNumber(
      value.selectedActionProbability,
      "selectedActionProbability",
      0,
      1,
    ),
    policyEntropy: optionalNumber(value.policyEntropy, "policyEntropy", 0, 100),
    principalVariation,
  };
};

const normalizePolicyMetadata = (value, actor) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("policy metadata is invalid");
  }
  for (const [field, expected] of [
    ["botId", actor.botId],
    ["versionKey", actor.versionKey],
    ["policyKey", actor.policyKey],
  ]) {
    if (value[field] !== expected) {
      throw new Error(`policy ${field} does not match the stored actor`);
    }
  }
  const storedMetadata = parseJson(actor.versionMetadata, {});
  const configuredDepth = storedMetadata.depth ?? null;
  if ((value.depth ?? null) !== configuredDepth) {
    throw new Error("policy depth does not match the stored bot version");
  }
  const decisionStats = normalizeDecisionStats(value.decisionStats);
  if (Boolean(value.decisionStatsAvailable) !== Boolean(decisionStats)) {
    throw new Error("policy decisionStats availability is inconsistent");
  }
  return {
    schemaVersion: 1,
    botId: actor.botId,
    versionKey: actor.versionKey,
    policyKey: actor.policyKey,
    configuredDepth,
    decisionStats,
  };
};

const withTransaction = async (pool, operation) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const upsertBotVersion = async (connection, definition) => {
  const bot = validateBot(definition);
  await connection.execute(
    `INSERT INTO bots (bot_key, name, kind, description)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), kind = VALUES(kind), description = VALUES(description)`,
    [bot.id, bot.name, bot.kind, bot.description ?? null],
  );
  const [botRows] = await connection.execute(
    "SELECT id FROM bots WHERE bot_key = ?",
    [bot.id],
  );
  const botId = botRows[0].id;
  await connection.execute(
    `INSERT INTO bot_versions
      (bot_id, version_key, version_label, artifact_digest, policy_key, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE version_label = VALUES(version_label),
       artifact_digest = COALESCE(artifact_digest, VALUES(artifact_digest)),
       policy_key = IF(policy_key = 'legacy-unknown', VALUES(policy_key), policy_key)`,
    [
      botId,
      bot.versionKey,
      bot.version,
      bot.artifactDigest,
      bot.policyKey,
      json({ depth: bot.depth ?? null }),
    ],
  );
  const [versionRows] = await connection.execute(
    `SELECT id, artifact_digest AS artifactDigest, policy_key AS policyKey
     FROM bot_versions WHERE bot_id = ? AND version_key = ?`,
    [botId, bot.versionKey],
  );
  const storedVersion = versionRows[0];
  if (
    storedVersion.artifactDigest !== bot.artifactDigest ||
    storedVersion.policyKey !== bot.policyKey
  ) {
    throw new Error("bot version provenance conflicts with existing data");
  }
  const versionId = storedVersion.id;
  if (bot.kind !== "human") {
    await connection.execute(
      `INSERT INTO bot_ratings (bot_version_id)
       VALUES (?)
       ON DUPLICATE KEY UPDATE bot_version_id = VALUES(bot_version_id)`,
      [versionId],
    );
  }
  return versionId;
};

const roundedRating = (value) => Number(value.toFixed(4));

const scoreFromOutcome = (outcome) => {
  if (outcome === "player-one-win") {
    return 1;
  }
  if (outcome === "player-two-win") {
    return 0;
  }
  if (outcome === "draw") {
    return 0.5;
  }
  throw new Error("completed match outcome is invalid");
};

const validateDigest = (value, field) => {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${field} is invalid`);
  }
  return value;
};

const validateTrajectoryStart = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("trajectory metadata is required");
  }
  if (
    value.schemaVersion !== trajectoryContract.schemaVersion ||
    value.recorderVersion !== trajectoryContract.recorderVersion ||
    value.observationEncoding !== trajectoryContract.observationEncoding ||
    value.actionEncoding !== trajectoryContract.actionEncoding ||
    value.stateEncoding !== trajectoryContract.stateEncoding ||
    value.rewardEncoding !== trajectoryContract.rewardEncoding
  ) {
    throw new Error("trajectory contract version is invalid");
  }
  if (!/^[a-z0-9._-]{1,80}$/.test(value.dataSource ?? "")) {
    throw new Error("trajectory dataSource is invalid");
  }
  if (
    !Number.isInteger(value.rngSeed) ||
    value.rngSeed < 0 ||
    value.rngSeed > 0xffff_ffff
  ) {
    throw new Error("trajectory rngSeed is invalid");
  }
  return {
    ...value,
    recorderBuildDigest: validateDigest(
      value.recorderBuildDigest,
      "trajectory recorderBuildDigest",
    ),
    rulesetDigest: validateDigest(
      value.rulesetDigest,
      "trajectory rulesetDigest",
    ),
    initialStateHash: hashJson(value.initialState),
  };
};

export const calculateEloUpdate = (
  playerOneRating,
  playerTwoRating,
  playerOneScore,
) => {
  if (
    !Number.isFinite(playerOneRating) ||
    !Number.isFinite(playerTwoRating) ||
    ![0, 0.5, 1].includes(playerOneScore)
  ) {
    throw new Error("Elo update input is invalid");
  }
  const expectedScore =
    1 / (1 + 10 ** ((playerTwoRating - playerOneRating) / 400));
  const delta = ratingKFactor * (playerOneScore - expectedScore);
  return {
    playerOneRating: roundedRating(playerOneRating + delta),
    playerTwoRating: roundedRating(playerTwoRating - delta),
  };
};

const applyRatingForMatch = async (connection, matchId) => {
  const [eventRows] = await connection.execute(
    "SELECT id FROM rating_events WHERE match_id = ?",
    [matchId],
  );
  if (eventRows.length > 0) {
    return false;
  }

  const [matchRows] = await connection.execute(
    `SELECT id, mode, status, outcome, quality_status,
            bot_one_version_id, bot_two_version_id
     FROM matches WHERE id = ? FOR UPDATE`,
    [matchId],
  );
  const match = matchRows[0];
  if (
    !match ||
    match.mode !== "engine-vs-engine" ||
    match.status !== "completed" ||
    match.quality_status !== "train-eligible"
  ) {
    return false;
  }
  const playerOneScore = scoreFromOutcome(match.outcome);
  const versionIds = [match.bot_one_version_id, match.bot_two_version_id];
  await connection.query(
    `INSERT IGNORE INTO bot_ratings (bot_version_id)
     VALUES ${versionIds.map(() => "(?)").join(", ")}`,
    versionIds,
  );
  const [ratingRows] = await connection.query(
    `SELECT bot_version_id AS versionId, rating
     FROM bot_ratings
     WHERE bot_version_id IN (?, ?)
     ORDER BY bot_version_id
     FOR UPDATE`,
    versionIds,
  );
  const ratings = new Map(
    ratingRows.map((row) => [String(row.versionId), Number(row.rating)]),
  );
  const playerOneBefore = ratings.get(String(match.bot_one_version_id));
  const playerTwoBefore = ratings.get(String(match.bot_two_version_id));
  if (playerOneBefore === undefined || playerTwoBefore === undefined) {
    throw new Error("bot rating row is missing");
  }
  const updatedRatings =
    match.bot_one_version_id === match.bot_two_version_id
      ? {
          playerOneRating: playerOneBefore,
          playerTwoRating: playerTwoBefore,
        }
      : calculateEloUpdate(playerOneBefore, playerTwoBefore, playerOneScore);
  const playerOneAfter = updatedRatings.playerOneRating;
  const playerTwoAfter = updatedRatings.playerTwoRating;

  if (match.bot_one_version_id === match.bot_two_version_id) {
    await connection.execute(
      `UPDATE bot_ratings
       SET games = games + 2,
           wins = wins + ?, draws = draws + ?, losses = losses + ?,
           rating = ?
       WHERE bot_version_id = ?`,
      [
        match.outcome === "draw" ? 0 : 1,
        match.outcome === "draw" ? 2 : 0,
        match.outcome === "draw" ? 0 : 1,
        playerOneAfter,
        match.bot_one_version_id,
      ],
    );
  } else {
    await connection.execute(
      `UPDATE bot_ratings
       SET rating = ?, games = games + 1,
           wins = wins + ?, draws = draws + ?, losses = losses + ?
       WHERE bot_version_id = ?`,
      [
        playerOneAfter,
        playerOneScore === 1 ? 1 : 0,
        playerOneScore === 0.5 ? 1 : 0,
        playerOneScore === 0 ? 1 : 0,
        match.bot_one_version_id,
      ],
    );
    await connection.execute(
      `UPDATE bot_ratings
       SET rating = ?, games = games + 1,
           wins = wins + ?, draws = draws + ?, losses = losses + ?
       WHERE bot_version_id = ?`,
      [
        playerTwoAfter,
        playerOneScore === 0 ? 1 : 0,
        playerOneScore === 0.5 ? 1 : 0,
        playerOneScore === 1 ? 1 : 0,
        match.bot_two_version_id,
      ],
    );
  }

  await connection.execute(
    `INSERT INTO rating_events
      (match_id, player_one_version_id, player_two_version_id, player_one_score,
       player_one_rating_before, player_two_rating_before,
       player_one_rating_after, player_two_rating_after, k_factor, formula_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      match.id,
      match.bot_one_version_id,
      match.bot_two_version_id,
      playerOneScore,
      playerOneBefore,
      playerTwoBefore,
      playerOneAfter,
      playerTwoAfter,
      ratingKFactor,
      ratingFormulaVersion,
    ],
  );
  return true;
};

const sampledTrend = (values, pointCount = 6) => {
  if (values.length === 0) {
    return Array(pointCount).fill(1500);
  }
  return Array.from({ length: pointCount }, (_, index) => {
    const sourceIndex = Math.round(
      (index / (pointCount - 1)) * (values.length - 1),
    );
    return Math.round(values[sourceIndex]);
  });
};

const buildReportData = (
  rows,
  moveTimes,
  persistedRatings = [],
  ratingHistories = new Map(),
) => {
  const versions = new Map();
  const games = [];

  const getVersion = (row, side) => {
    const versionId = `${row[`${side}BotKey`]}@${row[`${side}VersionKey`]}`;
    if (!versions.has(versionId)) {
      versions.set(versionId, {
        version_id: versionId,
        display_name: `${row[`${side}BotName`]} · ${row[`${side}VersionLabel`]}`,
        rating: 1500,
        games: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        totalActions: 0,
        average_move_time_ms: Number(
          moveTimes.get(String(row[`${side}VersionId`])) ?? 0,
        ),
        history: [1500],
      });
    }
    return versions.get(versionId);
  };

  for (const row of rows) {
    const playerOne = getVersion(row, "playerOne");
    const playerTwo = getVersion(row, "playerTwo");
    const isDraw = row.outcome === "draw";
    const playerOneScore = isDraw
      ? 0.5
      : row.outcome === "player-one-win"
        ? 1
        : 0;
    const expected =
      1 / (1 + 10 ** ((playerTwo.rating - playerOne.rating) / 400));
    const ratingDelta = 24 * (playerOneScore - expected);
    playerOne.rating += ratingDelta;
    playerTwo.rating -= ratingDelta;

    for (const participant of [playerOne, playerTwo]) {
      participant.games += 1;
      participant.totalActions += Number(row.moveCount);
      participant.history.push(participant.rating);
    }
    if (isDraw) {
      playerOne.draws += 1;
      playerTwo.draws += 1;
    } else if (row.outcome === "player-one-win") {
      playerOne.wins += 1;
      playerTwo.losses += 1;
    } else {
      playerTwo.wins += 1;
      playerOne.losses += 1;
    }

    const winner = isDraw
      ? null
      : row.outcome === "player-one-win"
        ? playerOne.version_id
        : playerTwo.version_id;
    games.push({
      game_id: row.id,
      run_id: row.seriesId ?? row.id,
      played_at_utc: new Date(row.startedAt).toISOString(),
      candidate_version: playerOne.version_id,
      opponent_version: playerTwo.version_id,
      engine_first: playerOne.version_id,
      engine_second: playerTwo.version_id,
      candidate_result: isDraw
        ? "draw"
        : winner === playerOne.version_id
          ? "win"
          : "loss",
      winner,
      terminal_type: isDraw
        ? "draw"
        : String(row.terminationReason ?? "").includes("try")
          ? "try"
          : "catch",
      total_actions: Number(row.moveCount),
      wall_time_ms: Number(row.durationMs ?? 0),
      opening_id: `game-${row.gameIndex ?? 1}`,
      complete: true,
    });
  }

  for (const row of persistedRatings) {
    const versionId = `${row.botKey}@${row.versionKey}`;
    const existing = versions.get(versionId);
    const version = existing ?? {
      version_id: versionId,
      display_name: `${row.botName} · ${row.versionLabel}`,
      totalActions: 0,
      average_move_time_ms: Number(moveTimes.get(String(row.versionId)) ?? 0),
    };
    Object.assign(version, {
      rating: Number(row.rating),
      games: Number(row.games),
      wins: Number(row.wins),
      draws: Number(row.draws),
      losses: Number(row.losses),
      history: ratingHistories.get(String(row.versionId)) ?? [
        1500,
        Number(row.rating),
      ],
    });
    versions.set(versionId, version);
  }

  const rankedVersions = [...versions.values()].sort(
    (left, right) =>
      right.rating - left.rating ||
      left.version_id.localeCompare(right.version_id),
  );
  const versionReports = rankedVersions.map((item, index) => ({
    version_id: item.version_id,
    display_name: item.display_name,
    status:
      index === 0
        ? "champion"
        : index === 1
          ? "stable"
          : index < 4
            ? "legacy"
            : "baseline",
    elo: Math.round(item.rating),
    elo_delta: Math.round(item.rating - 1500),
    games: item.games,
    wins: item.wins,
    draws: item.draws,
    losses: item.losses,
    average_move_time_ms: Math.round(item.average_move_time_ms),
    average_actions:
      item.games === 0
        ? 0
        : Number((item.totalActions / item.games).toFixed(1)),
    color: reportColors[index % reportColors.length],
    elo_trend: sampledTrend(item.history),
  }));
  const leader = versionReports[0];
  const totalActions = rows.reduce(
    (sum, row) => sum + Number(row.moveCount),
    0,
  );

  return {
    schema_version: 1,
    is_seed_data: false,
    generated_at_utc: new Date().toISOString(),
    summary: {
      total_games: rows.length,
      total_versions: versionReports.length,
      leader_version_id: leader?.version_id ?? "",
      leader_win_rate: leader?.games
        ? Number(((leader.wins / leader.games) * 100).toFixed(1))
        : 0,
      average_actions: rows.length
        ? Number((totalActions / rows.length).toFixed(1))
        : 0,
    },
    versions: versionReports,
    games: games.reverse(),
  };
};

export class MatchRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async check() {
    await this.pool.query("SELECT 1");
  }

  async initializeRatings() {
    await this.pool.query(`
      INSERT IGNORE INTO bot_ratings (bot_version_id)
      SELECT bot_versions.id
      FROM bot_versions
      JOIN bots ON bots.id = bot_versions.bot_id
      WHERE bots.kind <> 'human'
    `);
    const [matches] = await this.pool.query(`
      SELECT matches.id
      FROM matches
      LEFT JOIN rating_events ON rating_events.match_id = matches.id
      WHERE matches.status = 'completed'
        AND matches.mode = 'engine-vs-engine'
        AND matches.quality_status = 'train-eligible'
        AND matches.outcome IN ('player-one-win', 'player-two-win', 'draw')
        AND rating_events.id IS NULL
      ORDER BY COALESCE(matches.finished_at, matches.started_at), matches.id
    `);
    for (const match of matches) {
      await withTransaction(this.pool, (connection) =>
        applyRatingForMatch(connection, match.id),
      );
    }
  }

  async registerBots(botDefinitions) {
    if (!Array.isArray(botDefinitions) || botDefinitions.length < 1) {
      throw new Error("botDefinitions must not be empty");
    }
    await withTransaction(this.pool, async (connection) => {
      for (const definition of botDefinitions) {
        await upsertBotVersion(connection, definition);
      }
    });
    return this.listRatings();
  }

  async listRatings() {
    const [rows] = await this.pool.query(`
      SELECT bots.bot_key AS botId, bots.name, bots.kind,
             bot_versions.version_key AS versionKey,
             bot_versions.version_label AS version,
             bot_ratings.rating, bot_ratings.games, bot_ratings.wins,
             bot_ratings.draws, bot_ratings.losses, bot_ratings.updated_at AS updatedAt
      FROM bot_ratings
      JOIN bot_versions ON bot_versions.id = bot_ratings.bot_version_id
      JOIN bots ON bots.id = bot_versions.bot_id
      ORDER BY bot_ratings.rating DESC, bot_versions.version_key
    `);
    return rows.map((row, index) => ({
      ...row,
      rank: index + 1,
      rating: Math.round(Number(row.rating)),
      games: Number(row.games),
      wins: Number(row.wins),
      draws: Number(row.draws),
      losses: Number(row.losses),
    }));
  }

  async startTournament({
    name = "Bot Championship",
    participants,
    gamesPerPairing,
    settings = {},
  }) {
    if (!Array.isArray(participants) || participants.length < 2) {
      throw new Error("a tournament requires at least two bots");
    }
    if (
      !Number.isInteger(gamesPerPairing) ||
      gamesPerPairing < 1 ||
      gamesPerPairing > maximumTournamentGamesPerPairing
    ) {
      throw new Error(
        `gamesPerPairing must be between 1 and ${maximumTournamentGamesPerPairing}`,
      );
    }

    return withTransaction(this.pool, async (connection) => {
      const entries = [];
      for (const definition of participants) {
        const versionId = await upsertBotVersion(connection, definition);
        entries.push({
          entryId: randomUUID(),
          versionId,
          versionKey: definition.versionKey,
          rating: 1500,
          bot: validateBot(definition),
        });
      }
      if (
        new Set(entries.map(({ versionId }) => String(versionId))).size !==
        entries.length
      ) {
        throw new Error("tournament participants must be unique bot versions");
      }
      const [ratingRows] = await connection.query(
        `SELECT bot_version_id AS versionId, rating
         FROM bot_ratings WHERE bot_version_id IN (?)`,
        [entries.map(({ versionId }) => versionId)],
      );
      const ratings = new Map(
        ratingRows.map((row) => [String(row.versionId), Number(row.rating)]),
      );
      for (const entry of entries) {
        entry.rating = ratings.get(String(entry.versionId)) ?? 1500;
      }
      const seededEntries = assignSeeds(entries);
      const tournamentId = randomUUID();
      const safeName = String(name).trim().slice(0, 255) || "Bot Championship";
      const [tournamentResult] = await connection.execute(
        `INSERT INTO tournaments
          (public_id, name, format_key, status, participant_count,
           games_per_pairing, settings_json)
         VALUES (?, ?, 'elo-seeded-knockout-v1', 'running', ?, ?, ?)`,
        [
          tournamentId,
          safeName,
          seededEntries.length,
          gamesPerPairing,
          json(settings),
        ],
      );
      for (const entry of seededEntries) {
        await connection.execute(
          `INSERT INTO tournament_entries
            (public_id, tournament_id, bot_version_id, seed_number,
             seed_group, seed_rating, status)
           VALUES (?, ?, ?, ?, ?, ?, 'active')`,
          [
            entry.entryId,
            tournamentResult.insertId,
            entry.versionId,
            entry.seed,
            entry.seedGroup,
            entry.seedRating,
          ],
        );
      }
      return {
        id: tournamentId,
        name: safeName,
        format: "elo-seeded-knockout-v1",
        gamesPerPairing,
        entries: seededEntries.map((entry) => ({
          entryId: entry.entryId,
          botId: entry.bot.id,
          name: entry.bot.name,
          version: entry.bot.version,
          versionKey: entry.bot.versionKey,
          rating: Math.round(entry.rating),
          seed: entry.seed,
          seedGroup: entry.seedGroup,
          status: "active",
        })),
      };
    });
  }

  async startTournamentRound(tournamentId) {
    return withTransaction(this.pool, async (connection) => {
      const [tournamentRows] = await connection.execute(
        `SELECT id, status, current_round AS currentRound
         FROM tournaments WHERE public_id = ? FOR UPDATE`,
        [tournamentId],
      );
      const tournament = tournamentRows[0];
      if (!tournament || tournament.status !== "running") {
        throw new Error("tournament is not running");
      }
      const [entryRows] = await connection.execute(
        `SELECT id, public_id AS entryId, seed_number AS seed,
                seed_group AS seedGroup, seed_rating AS seedRating,
                bot_version_id AS versionId
         FROM tournament_entries
         WHERE tournament_id = ? AND status = 'active'
         ORDER BY seed_number
         FOR UPDATE`,
        [tournament.id],
      );
      if (entryRows.length < 2) {
        throw new Error("tournament does not have enough active entries");
      }
      const roundNumber = Number(tournament.currentRound) + 1;
      const roundPublicId = randomUUID();
      const [roundResult] = await connection.execute(
        `INSERT INTO tournament_rounds
          (public_id, tournament_id, round_number, status)
         VALUES (?, ?, ?, 'running')`,
        [roundPublicId, tournament.id, roundNumber],
      );
      const round = createSeededRound(entryRows);
      const pairings = [];
      let pairingIndex = 1;
      if (round.bye) {
        const pairingId = randomUUID();
        await connection.execute(
          `INSERT INTO tournament_pairings
            (public_id, round_id, pairing_index, entry_one_id, entry_two_id,
             winner_entry_id, status, advance_reason, finished_at)
           VALUES (?, ?, ?, ?, NULL, ?, 'completed', 'bye', CURRENT_TIMESTAMP(3))`,
          [
            pairingId,
            roundResult.insertId,
            pairingIndex,
            round.bye.id,
            round.bye.id,
          ],
        );
        pairings.push({
          pairingId,
          pairingIndex,
          entryOneId: round.bye.entryId,
          entryTwoId: null,
          winnerEntryId: round.bye.entryId,
          status: "completed",
          advanceReason: "bye",
        });
        pairingIndex += 1;
      }
      for (const pairing of round.pairings) {
        const pairingId = randomUUID();
        await connection.execute(
          `INSERT INTO tournament_pairings
            (public_id, round_id, pairing_index, entry_one_id, entry_two_id, status)
           VALUES (?, ?, ?, ?, ?, 'running')`,
          [
            pairingId,
            roundResult.insertId,
            pairingIndex,
            pairing.entryOne.id,
            pairing.entryTwo.id,
          ],
        );
        pairings.push({
          pairingId,
          pairingIndex,
          entryOneId: pairing.entryOne.entryId,
          entryTwoId: pairing.entryTwo.entryId,
          winnerEntryId: null,
          status: "running",
          advanceReason: null,
        });
        pairingIndex += 1;
      }
      await connection.execute(
        "UPDATE tournaments SET current_round = ? WHERE id = ?",
        [roundNumber, tournament.id],
      );
      return { id: roundPublicId, roundNumber, pairings };
    });
  }

  async startSeries({
    botOne,
    botTwo,
    repeatCount,
    mode = "engine-vs-engine",
    firstSeat = 0,
    tournamentPairingId = null,
    tournamentGameIndex = null,
    settings = {},
  }) {
    if (!new Set(["engine-vs-engine", "human-vs-engine"]).has(mode)) {
      throw new Error("match series mode is invalid");
    }
    if (![0, 1].includes(firstSeat)) {
      throw new Error("match series firstSeat is invalid");
    }
    const validatedBotOne = validateBot(botOne);
    const validatedBotTwo = validateBot(botTwo);
    const humanCount = [validatedBotOne, validatedBotTwo].filter(
      ({ kind }) => kind === "human",
    ).length;
    if (
      (mode === "human-vs-engine" && humanCount !== 1) ||
      (mode === "engine-vs-engine" && humanCount !== 0)
    ) {
      throw new Error("match participants do not match the series mode");
    }
    if (
      !Number.isInteger(repeatCount) ||
      repeatCount < 1 ||
      repeatCount > maximumRepeatCount
    ) {
      throw new Error(
        `repeatCount must be between 1 and ${maximumRepeatCount}`,
      );
    }

    return withTransaction(this.pool, async (connection) => {
      const botOneVersionId = await upsertBotVersion(
        connection,
        validatedBotOne,
      );
      const botTwoVersionId = await upsertBotVersion(
        connection,
        validatedBotTwo,
      );
      let pairingDatabaseId = null;
      if (tournamentPairingId) {
        if (mode !== "engine-vs-engine") {
          throw new Error("only engine matches can belong to a tournament");
        }
        if (
          !Number.isInteger(tournamentGameIndex) ||
          tournamentGameIndex < 1 ||
          tournamentGameIndex > maximumTournamentGamesPerPairing
        ) {
          throw new Error("tournamentGameIndex is invalid");
        }
        const [pairingRows] = await connection.execute(
          `SELECT tournament_pairings.id,
                  entry_one.bot_version_id AS entryOneVersionId,
                  entry_two.bot_version_id AS entryTwoVersionId,
                  tournament_pairings.status
           FROM tournament_pairings
           JOIN tournament_entries AS entry_one ON entry_one.id = tournament_pairings.entry_one_id
           JOIN tournament_entries AS entry_two ON entry_two.id = tournament_pairings.entry_two_id
           WHERE tournament_pairings.public_id = ? FOR UPDATE`,
          [tournamentPairingId],
        );
        const pairing = pairingRows[0];
        const actualVersions = [
          String(botOneVersionId),
          String(botTwoVersionId),
        ].sort();
        const expectedVersions = pairing
          ? [
              String(pairing.entryOneVersionId),
              String(pairing.entryTwoVersionId),
            ].sort()
          : [];
        if (
          !pairing ||
          pairing.status !== "running" ||
          actualVersions[0] !== expectedVersions[0] ||
          actualVersions[1] !== expectedVersions[1]
        ) {
          throw new Error("tournament pairing is not available for these bots");
        }
        pairingDatabaseId = pairing.id;
      } else if (tournamentGameIndex !== null) {
        throw new Error("tournamentPairingId is required");
      }
      const publicId = randomUUID();
      await connection.execute(
        `INSERT INTO match_series
         (public_id, mode, status, bot_one_version_id, bot_two_version_id,
           tournament_pairing_id, tournament_game_index, first_seat,
           repeat_count, settings_json)
         VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?, ?)`,
        [
          publicId,
          mode,
          botOneVersionId,
          botTwoVersionId,
          pairingDatabaseId,
          tournamentGameIndex,
          firstSeat,
          repeatCount,
          json(settings),
        ],
      );
      return { id: publicId };
    });
  }

  async startMatch({ seriesId, gameIndex, settings = {}, trajectory }) {
    if (
      !Number.isInteger(gameIndex) ||
      gameIndex < 1 ||
      gameIndex > maximumRepeatCount
    ) {
      throw new Error("gameIndex is invalid");
    }

    const validatedTrajectory = validateTrajectoryStart(trajectory);
    return withTransaction(this.pool, async (connection) => {
      const [seriesRows] = await connection.execute(
        `SELECT id, mode, status, repeat_count, bot_one_version_id,
                bot_two_version_id, first_seat
         FROM match_series WHERE public_id = ? FOR UPDATE`,
        [seriesId],
      );
      const series = seriesRows[0];
      if (
        !series ||
        series.status !== "running" ||
        gameIndex > series.repeat_count
      ) {
        throw new Error("match series is not available");
      }

      const publicId = randomUUID();
      await connection.execute(
        `INSERT INTO matches
          (public_id, series_id, game_index, ruleset_version,
           trajectory_schema_version, data_source, quality_status,
           recorder_version, recorder_build_digest, observation_encoding,
           action_encoding, state_encoding, reward_encoding, ruleset_digest,
           rng_seed, initial_state_json, initial_state_hash, mode, status,
           bot_one_version_id, bot_two_version_id, first_seat, last_state_json,
           settings_json, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, 'raw', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 'running', ?, ?, ?, ?, ?, ?)`,
        [
          publicId,
          series.id,
          gameIndex,
          trajectoryContract.rulesetVersion,
          validatedTrajectory.schemaVersion,
          validatedTrajectory.dataSource,
          validatedTrajectory.recorderVersion,
          validatedTrajectory.recorderBuildDigest,
          validatedTrajectory.observationEncoding,
          validatedTrajectory.actionEncoding,
          validatedTrajectory.stateEncoding,
          validatedTrajectory.rewardEncoding,
          validatedTrajectory.rulesetDigest,
          validatedTrajectory.rngSeed,
          json(validatedTrajectory.initialState),
          validatedTrajectory.initialStateHash,
          series.mode,
          series.bot_one_version_id,
          series.bot_two_version_id,
          series.first_seat,
          json(validatedTrajectory.initialState),
          json(settings),
          json({ trajectoryContract: trajectoryContract.schemaVersion }),
        ],
      );
      return { id: publicId };
    });
  }

  async recordMove(matchId, move) {
    return withTransaction(this.pool, async (connection) => {
      const [matchRows] = await connection.execute(
        `SELECT matches.id, matches.status,
                matches.quality_status AS qualityStatus,
                matches.trajectory_schema_version AS trajectorySchemaVersion,
                matches.first_seat AS firstSeat,
                matches.move_count AS moveCount,
                matches.last_state_json AS lastState,
                matches.bot_one_version_id, matches.bot_two_version_id,
                bot_one.bot_key AS botOneId, bot_one.kind AS botOneKind,
                version_one.version_key AS botOneVersionKey,
                version_one.policy_key AS botOnePolicyKey,
                version_one.metadata_json AS botOneVersionMetadata,
                bot_two.bot_key AS botTwoId, bot_two.kind AS botTwoKind,
                version_two.version_key AS botTwoVersionKey,
                version_two.policy_key AS botTwoPolicyKey,
                version_two.metadata_json AS botTwoVersionMetadata
         FROM matches
         JOIN bot_versions AS version_one ON version_one.id = matches.bot_one_version_id
         JOIN bots AS bot_one ON bot_one.id = version_one.bot_id
         JOIN bot_versions AS version_two ON version_two.id = matches.bot_two_version_id
         JOIN bots AS bot_two ON bot_two.id = version_two.bot_id
         WHERE matches.public_id = ? FOR UPDATE`,
        [matchId],
      );
      const match = matchRows[0];
      if (
        !match ||
        match.status !== "running" ||
        match.qualityStatus !== "raw" ||
        Number(match.trajectorySchemaVersion) !==
          trajectoryContract.schemaVersion
      ) {
        throw new Error("match is not running");
      }
      const expectedPly = Number(match.moveCount) + 1;
      if (
        move.ply !== expectedPly ||
        move.seat !== expectedSeatForPly(Number(match.firstSeat), expectedPly)
      ) {
        throw new Error("move ply or seat is not contiguous");
      }
      if (
        encodeProtocolAction([move.source, move.destination]) !==
          move.protocolAction ||
        move.actionMask[move.protocolAction] !== 1
      ) {
        throw new Error("move action is inconsistent with the legal mask");
      }
      const previousState =
        typeof match.lastState === "string"
          ? JSON.parse(match.lastState)
          : match.lastState;
      if (
        canonicalJson(previousState) !== canonicalJson(move.stateBefore) ||
        move.observationTurn !== move.stateBefore.turn ||
        move.stateBefore.turn !== move.ply - 1 ||
        move.stateAfter.turn !== move.ply
      ) {
        throw new Error("move state chain is invalid");
      }
      const expectedReward = move.isTerminal
        ? actorRewardForOutcome(move.seat, move.outcomeAfter)
        : 0;
      if (
        move.rewardPerspective !== "actor" ||
        move.rewardAfter !== expectedReward ||
        (move.isTerminal && (!move.outcomeAfter || !move.terminalReasonKey)) ||
        (!move.isTerminal &&
          (move.outcomeAfter !== null || move.terminalReasonKey !== null))
      ) {
        throw new Error("move reward or terminal label is invalid");
      }
      const botVersionId =
        move.seat === 0 ? match.bot_one_version_id : match.bot_two_version_id;
      const actor =
        move.seat === 0
          ? {
              botId: match.botOneId,
              kind: match.botOneKind,
              versionKey: match.botOneVersionKey,
              policyKey: match.botOnePolicyKey,
              versionMetadata: match.botOneVersionMetadata,
            }
          : {
              botId: match.botTwoId,
              kind: match.botTwoKind,
              versionKey: match.botTwoVersionKey,
              policyKey: match.botTwoPolicyKey,
              versionMetadata: match.botTwoVersionMetadata,
            };
      if (move.actorKind !== actor.kind) {
        throw new Error(
          "move actor kind does not match the stored participant",
        );
      }
      const policyMetadata = normalizePolicyMetadata(
        move.policyMetadata,
        actor,
      );
      const stateBeforeHash = hashJson(move.stateBefore);
      const stateAfterHash = hashJson(move.stateAfter);
      const transitionChecksum = transitionChecksumFor({
        ...move,
        actorKind: actor.kind,
        policyMetadata,
      });
      const movePublicId = randomUUID();
      await connection.execute(
        `INSERT INTO match_moves
          (public_id, match_id, ply, seat, bot_version_id, source_square, destination_square,
           protocol_action, think_time_ms, observation_json, action_mask_json,
           observation_turn, state_before_json, state_before_hash, state_after_json,
           state_after_hash, transition_checksum, reward_after,
           reward_perspective, outcome_after, is_terminal, terminal_reason_key,
           actor_kind, policy_metadata_json, quality_flags_json, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?)`,
        [
          movePublicId,
          match.id,
          move.ply,
          move.seat,
          botVersionId,
          move.source,
          move.destination,
          move.protocolAction,
          move.thinkTimeMs,
          json(move.observation),
          json(move.actionMask),
          move.observationTurn,
          json(move.stateBefore),
          stateBeforeHash,
          json(move.stateAfter),
          stateAfterHash,
          transitionChecksum,
          move.rewardAfter,
          move.rewardPerspective,
          move.outcomeAfter,
          move.isTerminal,
          move.terminalReasonKey,
          actor.kind,
          json(policyMetadata),
          json(move.qualityFlags ?? []),
          json(move.metadata),
        ],
      );
      await connection.execute(
        `UPDATE matches
         SET move_count = GREATEST(move_count, ?), last_state_json = ?
         WHERE id = ?`,
        [move.ply, json(move.stateAfter), match.id],
      );
      return { id: movePublicId };
    });
  }

  async finishMatch(matchId, result) {
    return withTransaction(this.pool, async (connection) => {
      const [matchRows] = await connection.execute(
        `SELECT id, mode, status, move_count AS moveCount
         FROM matches WHERE public_id = ? FOR UPDATE`,
        [matchId],
      );
      const match = matchRows[0];
      if (!match || match.status !== "running") {
        return false;
      }
      if (result.status === "completed") {
        scoreFromOutcome(result.outcome);
        const [terminalRows] = await connection.execute(
          `SELECT outcome_after AS outcomeAfter,
                  terminal_reason_key AS terminalReasonKey
           FROM match_moves
           WHERE match_id = ? AND ply = ? AND is_terminal = TRUE`,
          [match.id, match.moveCount],
        );
        const terminalMove = terminalRows[0];
        if (
          !terminalMove ||
          terminalMove.outcomeAfter !== result.outcome ||
          terminalMove.terminalReasonKey !== result.terminationReason
        ) {
          throw new Error("completed match does not match its terminal move");
        }
      }
      const playerOneReward =
        result.outcome === "player-one-win"
          ? 1
          : result.outcome === "player-two-win"
            ? -1
            : result.outcome === "draw"
              ? 0
              : null;
      const playerTwoReward =
        playerOneReward === null ? null : -playerOneReward;
      await connection.execute(
        `UPDATE matches
         SET status = ?, outcome = ?, termination_reason = ?, bot_one_reward = ?,
             bot_two_reward = ?, duration_ms = TIMESTAMPDIFF(MICROSECOND, started_at, CURRENT_TIMESTAMP(3)) DIV 1000,
             metadata_json = ?, error_message = ?, finished_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [
          result.status,
          result.outcome ?? null,
          result.terminationReason ?? null,
          playerOneReward,
          playerTwoReward,
          json(result.metadata),
          result.errorMessage ?? null,
          match.id,
        ],
      );
      if (result.status === "completed") {
        const validation = await validateStoredTrajectory(connection, match.id);
        if (validation.passed && match.mode === "engine-vs-engine") {
          await applyRatingForMatch(connection, match.id);
        }
      } else {
        await connection.execute(
          `UPDATE matches
           SET quality_status = 'rejected', validation_error = ?
           WHERE id = ?`,
          [
            JSON.stringify([
              {
                code: "incomplete-match",
                message: `Match finished with status ${result.status}.`,
              },
            ]),
            match.id,
          ],
        );
      }
      return true;
    });
  }

  async finishSeries(seriesId, status) {
    const [updateResult] = await this.pool.execute(
      `UPDATE match_series AS series
       SET status = ?,
           completed_match_count = (
             SELECT COUNT(*) FROM matches
             WHERE series_id = series.id AND status = 'completed'
               AND quality_status = 'train-eligible'
           ),
           bot_one_wins = (
             SELECT COUNT(*) FROM matches
             WHERE series_id = series.id AND outcome = 'player-one-win'
               AND quality_status = 'train-eligible'
           ),
           bot_two_wins = (
             SELECT COUNT(*) FROM matches
             WHERE series_id = series.id AND outcome = 'player-two-win'
               AND quality_status = 'train-eligible'
           ),
           draw_count = (
             SELECT COUNT(*) FROM matches
             WHERE series_id = series.id AND outcome = 'draw'
               AND quality_status = 'train-eligible'
           ),
           finished_at = CURRENT_TIMESTAMP(3)
       WHERE public_id = ? AND status = 'running'
         AND (
           ? <> 'completed'
           OR repeat_count = (
             SELECT COUNT(*) FROM matches
             WHERE series_id = series.id AND status = 'completed'
               AND quality_status = 'train-eligible'
           )
         )`,
      [status, seriesId, status],
    );
    if (updateResult.affectedRows === 0 && status === "completed") {
      await this.pool.execute(
        `UPDATE match_series
         SET status = 'failed', finished_at = CURRENT_TIMESTAMP(3)
         WHERE public_id = ? AND status = 'running'`,
        [seriesId],
      );
    }
    return updateResult.affectedRows > 0;
  }

  async finishTournamentPairing(
    tournamentId,
    pairingId,
    { winnerEntryId, entryOneScore, entryTwoScore, advanceReason },
  ) {
    if (
      !Number.isFinite(entryOneScore) ||
      entryOneScore < 0 ||
      !Number.isFinite(entryTwoScore) ||
      entryTwoScore < 0 ||
      !["score", "seed-tiebreak"].includes(advanceReason)
    ) {
      throw new Error("tournament pairing result is invalid");
    }
    return withTransaction(this.pool, async (connection) => {
      const [pairingRows] = await connection.execute(
        `SELECT tournament_pairings.id, tournament_pairings.status,
                tournament_rounds.id AS roundId,
                tournament_rounds.round_number AS roundNumber,
                tournaments.id AS tournamentId,
                tournaments.public_id AS tournamentPublicId,
                tournaments.games_per_pairing AS gamesPerPairing,
                entry_one.id AS entryOneId, entry_one.public_id AS entryOnePublicId,
                entry_two.id AS entryTwoId, entry_two.public_id AS entryTwoPublicId
         FROM tournament_pairings
         JOIN tournament_rounds ON tournament_rounds.id = tournament_pairings.round_id
         JOIN tournaments ON tournaments.id = tournament_rounds.tournament_id
         JOIN tournament_entries AS entry_one ON entry_one.id = tournament_pairings.entry_one_id
         JOIN tournament_entries AS entry_two ON entry_two.id = tournament_pairings.entry_two_id
         WHERE tournament_pairings.public_id = ? FOR UPDATE`,
        [pairingId],
      );
      const pairing = pairingRows[0];
      if (
        !pairing ||
        pairing.tournamentPublicId !== tournamentId ||
        pairing.status !== "running"
      ) {
        throw new Error("tournament pairing is not running");
      }
      const winnerIsOne = winnerEntryId === pairing.entryOnePublicId;
      const winnerIsTwo = winnerEntryId === pairing.entryTwoPublicId;
      if (!winnerIsOne && !winnerIsTwo) {
        throw new Error("pairing winner is not a participant");
      }
      const [gameRows] = await connection.execute(
        `SELECT COUNT(*) AS completedGames
         FROM match_series
         WHERE tournament_pairing_id = ? AND status = 'completed'`,
        [pairing.id],
      );
      if (
        Number(gameRows[0].completedGames) !== Number(pairing.gamesPerPairing)
      ) {
        throw new Error("all pairing games must be completed first");
      }
      const winnerDatabaseId = winnerIsOne
        ? pairing.entryOneId
        : pairing.entryTwoId;
      const loserDatabaseId = winnerIsOne
        ? pairing.entryTwoId
        : pairing.entryOneId;
      await connection.execute(
        `UPDATE tournament_pairings
         SET winner_entry_id = ?, entry_one_score = ?, entry_two_score = ?,
             status = 'completed', advance_reason = ?, finished_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [
          winnerDatabaseId,
          entryOneScore,
          entryTwoScore,
          advanceReason,
          pairing.id,
        ],
      );
      await connection.execute(
        `UPDATE tournament_entries
         SET status = 'eliminated', eliminated_round = ?
         WHERE id = ? AND status = 'active'`,
        [pairing.roundNumber, loserDatabaseId],
      );
      const [pendingRows] = await connection.execute(
        `SELECT COUNT(*) AS pendingPairings
         FROM tournament_pairings
         WHERE round_id = ? AND status = 'running'`,
        [pairing.roundId],
      );
      if (Number(pendingRows[0].pendingPairings) === 0) {
        await connection.execute(
          `UPDATE tournament_rounds
           SET status = 'completed', finished_at = CURRENT_TIMESTAMP(3)
           WHERE id = ?`,
          [pairing.roundId],
        );
      }
      return { ok: true };
    });
  }

  async finishTournament(tournamentId, championEntryId) {
    return withTransaction(this.pool, async (connection) => {
      const [tournamentRows] = await connection.execute(
        `SELECT id, status FROM tournaments WHERE public_id = ? FOR UPDATE`,
        [tournamentId],
      );
      const tournament = tournamentRows[0];
      if (!tournament || tournament.status !== "running") {
        throw new Error("tournament is not running");
      }
      const [entryRows] = await connection.execute(
        `SELECT id, public_id AS entryId
         FROM tournament_entries
         WHERE tournament_id = ? AND status = 'active' FOR UPDATE`,
        [tournament.id],
      );
      if (entryRows.length !== 1 || entryRows[0].entryId !== championEntryId) {
        throw new Error("champion must be the only active tournament entry");
      }
      await connection.execute(
        `UPDATE tournament_entries
         SET status = 'champion', final_place = 1 WHERE id = ?`,
        [entryRows[0].id],
      );
      await connection.execute(
        `UPDATE tournaments
         SET status = 'completed', champion_entry_id = ?, finished_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [entryRows[0].id, tournament.id],
      );
      return { ok: true };
    });
  }

  async stopTournament(tournamentId) {
    return withTransaction(this.pool, async (connection) => {
      const [tournamentRows] = await connection.execute(
        `SELECT id, status FROM tournaments WHERE public_id = ? FOR UPDATE`,
        [tournamentId],
      );
      const tournament = tournamentRows[0];
      if (!tournament || tournament.status !== "running") {
        return false;
      }
      await connection.execute(
        `UPDATE tournament_pairings
         JOIN tournament_rounds ON tournament_rounds.id = tournament_pairings.round_id
         SET tournament_pairings.status = 'stopped',
             tournament_pairings.finished_at = CURRENT_TIMESTAMP(3)
         WHERE tournament_rounds.tournament_id = ?
           AND tournament_pairings.status = 'running'`,
        [tournament.id],
      );
      await connection.execute(
        `UPDATE tournament_rounds
         SET status = 'stopped', finished_at = CURRENT_TIMESTAMP(3)
         WHERE tournament_id = ? AND status = 'running'`,
        [tournament.id],
      );
      await connection.execute(
        `UPDATE tournaments
         SET status = 'stopped', finished_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [tournament.id],
      );
      return true;
    });
  }

  async listMatches(limit = 50) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
    const [rows] = await this.pool.query(
      `SELECT matches.public_id AS id, matches.game_index AS gameIndex, matches.status,
              matches.quality_status AS qualityStatus,
              matches.outcome, matches.move_count AS moveCount, matches.started_at AS startedAt,
              matches.finished_at AS finishedAt, bot_one.name AS botOneName, bot_two.name AS botTwoName
       FROM matches
       JOIN bot_versions AS version_one ON version_one.id = matches.bot_one_version_id
       JOIN bots AS bot_one ON bot_one.id = version_one.bot_id
       JOIN bot_versions AS version_two ON version_two.id = matches.bot_two_version_id
       JOIN bots AS bot_two ON bot_two.id = version_two.bot_id
       ORDER BY matches.started_at DESC, matches.id DESC
       LIMIT ?`,
      [safeLimit],
    );
    return rows;
  }

  async botStatistics() {
    const [rows] = await this.pool.query(`
      SELECT bots.bot_key AS botId, MAX(bots.name) AS name, COUNT(*) AS games,
             SUM(sides.is_win) AS wins, SUM(sides.is_draw) AS draws, SUM(sides.is_loss) AS losses
      FROM (
        SELECT bot_one_version_id AS version_id,
               outcome = 'player-one-win' AS is_win,
               outcome = 'draw' AS is_draw,
               outcome = 'player-two-win' AS is_loss
        FROM matches
        WHERE status = 'completed' AND mode = 'engine-vs-engine'
          AND quality_status = 'train-eligible'
        UNION ALL
        SELECT bot_two_version_id AS version_id,
               outcome = 'player-two-win' AS is_win,
               outcome = 'draw' AS is_draw,
               outcome = 'player-one-win' AS is_loss
        FROM matches
        WHERE status = 'completed' AND mode = 'engine-vs-engine'
          AND quality_status = 'train-eligible'
      ) AS sides
      JOIN bot_versions ON bot_versions.id = sides.version_id
      JOIN bots ON bots.id = bot_versions.bot_id
      GROUP BY bots.bot_key
      ORDER BY wins DESC, bots.bot_key
    `);
    return rows;
  }

  async reportData() {
    const [rows] = await this.pool.query(`
      SELECT matches.public_id AS id, match_series.public_id AS seriesId,
             matches.game_index AS gameIndex, matches.outcome,
             matches.termination_reason AS terminationReason,
             matches.move_count AS moveCount, matches.duration_ms AS durationMs,
             matches.started_at AS startedAt,
             player_one_version.id AS playerOneVersionId,
             player_one_version.version_key AS playerOneVersionKey,
             player_one_version.version_label AS playerOneVersionLabel,
             player_one_bot.bot_key AS playerOneBotKey,
             player_one_bot.name AS playerOneBotName,
             player_two_version.id AS playerTwoVersionId,
             player_two_version.version_key AS playerTwoVersionKey,
             player_two_version.version_label AS playerTwoVersionLabel,
             player_two_bot.bot_key AS playerTwoBotKey,
             player_two_bot.name AS playerTwoBotName
      FROM matches
      LEFT JOIN match_series ON match_series.id = matches.series_id
      JOIN bot_versions AS player_one_version ON player_one_version.id = matches.bot_one_version_id
      JOIN bots AS player_one_bot ON player_one_bot.id = player_one_version.bot_id
      JOIN bot_versions AS player_two_version ON player_two_version.id = matches.bot_two_version_id
      JOIN bots AS player_two_bot ON player_two_bot.id = player_two_version.bot_id
      WHERE matches.status = 'completed'
        AND matches.mode = 'engine-vs-engine'
        AND matches.quality_status = 'train-eligible'
      ORDER BY matches.started_at, matches.id
      LIMIT 5000
    `);
    const [moveTimeRows] = await this.pool.query(`
      SELECT match_moves.bot_version_id AS versionId,
             AVG(match_moves.think_time_ms) AS averageMoveTimeMs
      FROM match_moves
      JOIN matches ON matches.id = match_moves.match_id
      WHERE match_moves.think_time_ms IS NOT NULL
        AND matches.quality_status = 'train-eligible'
        AND matches.mode = 'engine-vs-engine'
      GROUP BY match_moves.bot_version_id
    `);
    const moveTimes = new Map(
      moveTimeRows.map((row) => [
        String(row.versionId),
        Number(row.averageMoveTimeMs),
      ]),
    );
    const [ratingRows] = await this.pool.query(`
      SELECT bot_versions.id AS versionId,
             bot_versions.version_key AS versionKey,
             bot_versions.version_label AS versionLabel,
             bots.bot_key AS botKey, bots.name AS botName,
             bot_ratings.rating, bot_ratings.games, bot_ratings.wins,
             bot_ratings.draws, bot_ratings.losses
      FROM bot_ratings
      JOIN bot_versions ON bot_versions.id = bot_ratings.bot_version_id
      JOIN bots ON bots.id = bot_versions.bot_id
    `);
    const [historyRows] = await this.pool.query(`
      SELECT version_id AS versionId, rating_after AS ratingAfter
      FROM (
        SELECT player_one_version_id AS version_id,
               player_one_rating_after AS rating_after, id
        FROM rating_events
        UNION ALL
        SELECT player_two_version_id AS version_id,
               player_two_rating_after AS rating_after, id
        FROM rating_events
      ) AS rating_history
      ORDER BY id
    `);
    const ratingHistories = new Map();
    for (const row of historyRows) {
      const key = String(row.versionId);
      const history = ratingHistories.get(key) ?? [1500];
      history.push(Number(row.ratingAfter));
      ratingHistories.set(key, history);
    }
    return buildReportData(rows, moveTimes, ratingRows, ratingHistories);
  }
}
