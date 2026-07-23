import assert from "node:assert/strict";
import test from "node:test";

import { calculateEloUpdate, MatchRepository } from "./match_repository.mjs";
import { trajectoryContract } from "../src/game/trajectory_contract.mjs";

test("equal ratings exchange twelve Elo points after a decisive game", () => {
  assert.deepEqual(calculateEloUpdate(1500, 1500, 1), {
    playerOneRating: 1512,
    playerTwoRating: 1488,
  });
});

test("Elo updates continue from the persisted ratings instead of resetting", () => {
  const first = calculateEloUpdate(1500, 1500, 1);
  const second = calculateEloUpdate(
    first.playerOneRating,
    first.playerTwoRating,
    1,
  );

  assert(second.playerOneRating > first.playerOneRating);
  assert(second.playerTwoRating < first.playerTwoRating);
  assert.notEqual(second.playerOneRating, 1512);
});

test("a draw moves unequal ratings toward each other", () => {
  assert.deepEqual(calculateEloUpdate(1700, 1300, 0.5), {
    playerOneRating: 1690.1818,
    playerTwoRating: 1309.8182,
  });
});

const transitionFixture = () => {
  const stateBefore = {
    pieces: Array(8).fill(15),
    ownership: 15,
    bitBoards: [1, 2, 4, 8, 256, 512, 1024, 2048],
    turn: 0,
  };
  const stateAfter = { ...stateBefore, turn: 1 };
  const actionMask = Array(240).fill(0);
  actionMask[127] = 1;
  return {
    ply: 1,
    seat: 0,
    source: 1,
    destination: 4,
    protocolAction: 127,
    thinkTimeMs: 10,
    observation: Array.from({ length: 20 }, () => Array(9).fill(0)),
    actionMask,
    observationTurn: 0,
    stateBefore,
    stateAfter,
    rewardAfter: 0,
    rewardPerspective: "actor",
    outcomeAfter: null,
    isTerminal: false,
    terminalReasonKey: null,
    actorKind: "wasm-alpha-beta",
    policyMetadata: {
      botId: "bot-one",
      versionKey: "bot-one-v1",
      policyKey: "wasm-alpha-beta-v1",
      depth: 2,
      decisionStatsAvailable: false,
    },
    qualityFlags: [],
    metadata: {},
  };
};

const repositoryFixture = () => {
  const lifecycle = [];
  const statements = [];
  const stateBefore = transitionFixture().stateBefore;
  const connection = {
    async beginTransaction() {
      lifecycle.push("begin");
    },
    async commit() {
      lifecycle.push("commit");
    },
    async rollback() {
      lifecycle.push("rollback");
    },
    release() {
      lifecycle.push("release");
    },
    async execute(statement, parameters) {
      statements.push([statement, parameters]);
      if (statement.includes("WHERE matches.public_id")) {
        return [
          [
            {
              id: 1,
              status: "running",
              qualityStatus: "raw",
              trajectorySchemaVersion: 2,
              firstSeat: 0,
              moveCount: 0,
              lastState: JSON.stringify(stateBefore),
              bot_one_version_id: 10,
              bot_two_version_id: 11,
              botOneId: "bot-one",
              botOneKind: "wasm-alpha-beta",
              botOneVersionKey: "bot-one-v1",
              botOnePolicyKey: "wasm-alpha-beta-v1",
              botOneVersionMetadata: JSON.stringify({ depth: 2 }),
              botTwoId: "bot-two",
              botTwoKind: "wasm-alpha-beta",
              botTwoVersionKey: "bot-two-v1",
              botTwoPolicyKey: "wasm-alpha-beta-v1",
              botTwoVersionMetadata: JSON.stringify({ depth: 2 }),
            },
          ],
        ];
      }
      return [{ affectedRows: 1 }];
    },
  };
  return {
    lifecycle,
    statements,
    repository: new MatchRepository({
      async getConnection() {
        return connection;
      },
    }),
  };
};

test("recordMove commits one contiguous checksummed transition", async () => {
  const fixture = repositoryFixture();
  const result = await fixture.repository.recordMove(
    "match-1",
    transitionFixture(),
  );
  assert.match(result.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(fixture.lifecycle, ["begin", "commit", "release"]);
  const insert = fixture.statements.find(([statement]) =>
    statement.includes("INSERT INTO match_moves"),
  );
  assert(insert);
  assert.equal((insert[0].match(/\?/g) ?? []).length, insert[1].length);
  assert.match(insert[1][16], /^[0-9a-f]{64}$/);
});

test("recordMove rejects a gap before writing", async () => {
  const fixture = repositoryFixture();
  const transition = transitionFixture();
  transition.ply = 2;
  await assert.rejects(
    () => fixture.repository.recordMove("match-1", transition),
    /ply or seat is not contiguous/,
  );
  assert.deepEqual(fixture.lifecycle, ["begin", "rollback", "release"]);
  assert.equal(
    fixture.statements.some(([statement]) =>
      statement.includes("INSERT INTO match_moves"),
    ),
    false,
  );
});

test("startMatch writes every trajectory-v2 field with a bound value", async () => {
  const statements = [];
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(statement, parameters) {
      statements.push([statement, parameters]);
      if (statement.includes("FROM match_series")) {
        return [
          [
            {
              id: 7,
              mode: "engine-vs-engine",
              status: "running",
              repeat_count: 1,
              bot_one_version_id: 10,
              bot_two_version_id: 11,
              first_seat: 0,
            },
          ],
        ];
      }
      return [{ affectedRows: 1 }];
    },
  };
  const repository = new MatchRepository({
    async getConnection() {
      return connection;
    },
  });
  const initialState = transitionFixture().stateBefore;
  const result = await repository.startMatch({
    seriesId: "series-1",
    gameIndex: 1,
    settings: {},
    trajectory: {
      ...trajectoryContract,
      dataSource: "unit-test",
      recorderBuildDigest: "a".repeat(64),
      rulesetDigest: "b".repeat(64),
      rngSeed: 123,
      initialState,
    },
  });
  assert.match(result.id, /^[0-9a-f-]{36}$/);
  const insert = statements.find(([statement]) =>
    statement.includes("INSERT INTO matches"),
  );
  assert(insert);
  assert.equal((insert[0].match(/\?/g) ?? []).length, insert[1].length);
});

test("an incomplete completed series is closed as failed", async () => {
  const statements = [];
  const repository = new MatchRepository({
    async execute(statement, parameters) {
      statements.push([statement, parameters]);
      return [{ affectedRows: statements.length === 1 ? 0 : 1 }];
    },
  });
  assert.equal(await repository.finishSeries("series-1", "completed"), false);
  assert.equal(statements.length, 2);
  assert.match(statements[1][0], /SET status = 'failed'/);
});
