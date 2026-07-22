import { randomUUID } from "node:crypto";

const maximumRepeatCount = 500;
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
  return bot;
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
    `INSERT INTO bot_versions (bot_id, version_key, version_label, metadata_json)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE version_label = VALUES(version_label)`,
    [botId, bot.versionKey, bot.version, json({ depth: bot.depth ?? null })],
  );
  const [versionRows] = await connection.execute(
    "SELECT id FROM bot_versions WHERE bot_id = ? AND version_key = ?",
    [botId, bot.versionKey],
  );
  return versionRows[0].id;
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

const buildReportData = (rows, moveTimes) => {
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

  async startSeries({ botOne, botTwo, repeatCount, settings = {} }) {
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
      const botOneVersionId = await upsertBotVersion(connection, botOne);
      const botTwoVersionId = await upsertBotVersion(connection, botTwo);
      const publicId = randomUUID();
      await connection.execute(
        `INSERT INTO match_series
          (public_id, mode, status, bot_one_version_id, bot_two_version_id, first_seat,
           repeat_count, settings_json)
         VALUES (?, 'engine-vs-engine', 'running', ?, ?, 0, ?, ?)`,
        [
          publicId,
          botOneVersionId,
          botTwoVersionId,
          repeatCount,
          json(settings),
        ],
      );
      return { id: publicId };
    });
  }

  async startMatch({ seriesId, gameIndex, settings = {} }) {
    if (
      !Number.isInteger(gameIndex) ||
      gameIndex < 1 ||
      gameIndex > maximumRepeatCount
    ) {
      throw new Error("gameIndex is invalid");
    }

    return withTransaction(this.pool, async (connection) => {
      const [seriesRows] = await connection.execute(
        `SELECT id, status, repeat_count, bot_one_version_id, bot_two_version_id, first_seat
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
          (public_id, series_id, game_index, ruleset_version, mode, status,
           bot_one_version_id, bot_two_version_id, first_seat, settings_json, metadata_json)
         VALUES (?, ?, ?, 'quantum-animal-shogi-v1', 'engine-vs-engine', 'running', ?, ?, ?, ?, ?)`,
        [
          publicId,
          series.id,
          gameIndex,
          series.bot_one_version_id,
          series.bot_two_version_id,
          series.first_seat,
          json(settings),
          json({}),
        ],
      );
      return { id: publicId };
    });
  }

  async recordMove(matchId, move) {
    return withTransaction(this.pool, async (connection) => {
      const [matchRows] = await connection.execute(
        `SELECT id, status, bot_one_version_id, bot_two_version_id
         FROM matches WHERE public_id = ? FOR UPDATE`,
        [matchId],
      );
      const match = matchRows[0];
      if (!match || match.status !== "running") {
        throw new Error("match is not running");
      }
      const botVersionId =
        move.seat === 0 ? match.bot_one_version_id : match.bot_two_version_id;
      await connection.execute(
        `INSERT INTO match_moves
          (match_id, ply, seat, bot_version_id, source_square, destination_square,
           protocol_action, think_time_ms, observation_json, action_mask_json,
           state_after_json, reward_after, is_terminal, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
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
          json(move.stateAfter),
          move.rewardAfter,
          Boolean(move.isTerminal),
          json(move.metadata),
        ],
      );
      await connection.execute(
        `UPDATE matches
         SET move_count = GREATEST(move_count, ?), last_state_json = ?
         WHERE id = ?`,
        [move.ply, json(move.stateAfter), match.id],
      );
    });
  }

  async finishMatch(matchId, result) {
    const [updateResult] = await this.pool.execute(
      `UPDATE matches
       SET status = ?, outcome = ?, termination_reason = ?, bot_one_reward = ?,
           bot_two_reward = ?, duration_ms = TIMESTAMPDIFF(MICROSECOND, started_at, CURRENT_TIMESTAMP(3)) DIV 1000,
           metadata_json = ?, error_message = ?, finished_at = CURRENT_TIMESTAMP(3)
       WHERE public_id = ? AND status = 'running'`,
      [
        result.status,
        result.outcome ?? null,
        result.terminationReason ?? null,
        result.botOneReward ?? null,
        result.botTwoReward ?? null,
        json(result.metadata),
        result.errorMessage ?? null,
        matchId,
      ],
    );
    return updateResult.affectedRows > 0;
  }

  async finishSeries(seriesId, status) {
    const [updateResult] = await this.pool.execute(
      `UPDATE match_series AS series
       SET status = ?,
           completed_match_count = (
             SELECT COUNT(*) FROM matches WHERE series_id = series.id AND status = 'completed'
           ),
           bot_one_wins = (
             SELECT COUNT(*) FROM matches WHERE series_id = series.id AND outcome = 'player-one-win'
           ),
           bot_two_wins = (
             SELECT COUNT(*) FROM matches WHERE series_id = series.id AND outcome = 'player-two-win'
           ),
           draw_count = (
             SELECT COUNT(*) FROM matches WHERE series_id = series.id AND outcome = 'draw'
           ),
           finished_at = CURRENT_TIMESTAMP(3)
       WHERE public_id = ? AND status = 'running'`,
      [status, seriesId],
    );
    return updateResult.affectedRows > 0;
  }

  async listMatches(limit = 50) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
    const [rows] = await this.pool.query(
      `SELECT matches.public_id AS id, matches.game_index AS gameIndex, matches.status,
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
        FROM matches WHERE status = 'completed'
        UNION ALL
        SELECT bot_two_version_id AS version_id,
               outcome = 'player-two-win' AS is_win,
               outcome = 'draw' AS is_draw,
               outcome = 'player-one-win' AS is_loss
        FROM matches WHERE status = 'completed'
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
      ORDER BY matches.started_at, matches.id
      LIMIT 5000
    `);
    const [moveTimeRows] = await this.pool.query(`
      SELECT bot_version_id AS versionId, AVG(think_time_ms) AS averageMoveTimeMs
      FROM match_moves
      WHERE think_time_ms IS NOT NULL
      GROUP BY bot_version_id
    `);
    const moveTimes = new Map(
      moveTimeRows.map((row) => [
        String(row.versionId),
        Number(row.averageMoveTimeMs),
      ]),
    );
    return buildReportData(rows, moveTimes);
  }
}
