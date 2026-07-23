import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const reportSeed = JSON.parse(
  readFileSync(
    new URL("../src/reports/reportSeed.json", import.meta.url),
    "utf8",
  ),
);

assert.equal(reportSeed.schema_version, 1);
assert.equal(reportSeed.is_seed_data, true);
assert(reportSeed.versions.length > 0, "Expected at least one bot version");
assert(reportSeed.games.length > 0, "Expected at least one historical game");
assert(
  reportSeed.benchmarks.versions.length > 0,
  "Expected benchmark coverage metadata",
);

const versionIds = new Set(
  reportSeed.versions.map(({ version_id }) => version_id),
);
assert.equal(
  versionIds.size,
  reportSeed.versions.length,
  "Version IDs must be unique",
);
assert(
  versionIds.has(reportSeed.summary.leader_version_id),
  "The summary leader must reference a seeded version",
);

for (const version of reportSeed.versions) {
  assert.equal(
    version.wins + version.draws + version.losses,
    version.games,
    `${version.version_id} record must add up to its game count`,
  );
  assert.equal(
    version.elo_trend.at(-1),
    version.elo,
    `${version.version_id} trend must end at Elo`,
  );
}

const aggregateGameCount = reportSeed.versions.reduce(
  (total, version) => total + version.games,
  0,
);
assert.equal(reportSeed.summary.total_games, aggregateGameCount / 2);

assert.equal(
  reportSeed.benchmarks.summary.total_versions,
  reportSeed.benchmarks.versions.length,
);
assert.equal(
  reportSeed.benchmarks.summary.benchmarked_versions,
  reportSeed.benchmarks.versions.filter(({ case_count }) => case_count > 0)
    .length,
);
assert.equal(
  reportSeed.benchmarks.summary.total_cases,
  reportSeed.benchmarks.versions.reduce(
    (total, version) => total + version.case_count,
    0,
  ),
);

for (const version of reportSeed.benchmarks.versions) {
  assert(
    version.completed_case_count <= version.case_count,
    `${version.version_id} completed benchmark count is invalid`,
  );
  const componentShare = version.component_breakdown.reduce(
    (total, component) => total + component.share_percent,
    0,
  );
  if (version.component_breakdown.length > 0) {
    assert(
      Math.abs(componentShare - 100) < 0.2,
      `${version.version_id} component shares must add up to 100%`,
    );
  }
  assert(
    version.findings.every(
      ({ severity }) =>
        severity === "info" ||
        severity === "warning" ||
        severity === "critical",
    ),
    `${version.version_id} has an invalid finding severity`,
  );
}

const gameIds = new Set();
for (const game of reportSeed.games) {
  assert(!gameIds.has(game.game_id), `Duplicate game ID: ${game.game_id}`);
  gameIds.add(game.game_id);
  assert(
    versionIds.has(game.candidate_version),
    `Unknown candidate: ${game.candidate_version}`,
  );
  assert(
    versionIds.has(game.opponent_version),
    `Unknown opponent: ${game.opponent_version}`,
  );
  assert(
    versionIds.has(game.engine_first),
    `Unknown first engine: ${game.engine_first}`,
  );
  assert(
    versionIds.has(game.engine_second),
    `Unknown second engine: ${game.engine_second}`,
  );
  assert(
    game.winner === null ||
      game.winner === game.engine_first ||
      game.winner === game.engine_second,
    `Winner must be one of the engines: ${game.game_id}`,
  );
  assert.equal(game.candidate_result === "draw", game.winner === null);
  if (game.candidate_result === "win") {
    assert.equal(game.winner, game.candidate_version);
  } else if (game.candidate_result === "loss") {
    assert.equal(game.winner, game.opponent_version);
  }
  assert.equal(game.complete, true);
}

console.log(
  `Report seed passed: ${reportSeed.versions.length} versions and ${reportSeed.games.length} games are consistent.`,
);
