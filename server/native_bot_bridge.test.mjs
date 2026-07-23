import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import {
  createNativeBotBridge,
  nativeBotDefinitions,
} from "./native_bot_bridge.mjs";

test("native bot catalog contains the three archived stages", () => {
  assert.deepEqual(
    nativeBotDefinitions.slice(0, 3).map(({ id }) => id),
    ["stage35", "stage5", "stage57"],
  );
});

test("bridge exposes only allowlisted available bots", async (context) => {
  const { server } = createNativeBotBridge();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());

  const address = server.address();
  assert(address && typeof address === "object");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/bots`);
  const bots = await response.json();

  assert.equal(response.status, 200);
  assert(bots.length >= 3);
  assert(bots.every((bot) => bot.kind === "native"));
  assert(bots.every((bot) => !("executable" in bot)));
  assert(bots.every((bot) => bot.version && bot.versionKey));
});

test("bridge persists a validated match lifecycle", async (context) => {
  const calls = [];
  const matchRepository = {
    async check() {
      calls.push(["check"]);
    },
    async startSeries(value) {
      calls.push(["startSeries", value]);
      return { id: "series-1" };
    },
    async startMatch(value) {
      calls.push(["startMatch", value]);
      return { id: "match-1" };
    },
    async recordMove(id, value) {
      calls.push(["recordMove", id, value]);
    },
    async finishMatch(id, value) {
      calls.push(["finishMatch", id, value]);
      return true;
    },
    async finishSeries(id, status) {
      calls.push(["finishSeries", id, status]);
      return true;
    },
    async reportData() {
      calls.push(["reportData"]);
      return {
        schema_version: 1,
        is_seed_data: false,
        versions: [],
        games: [],
      };
    },
  };
  const benchmarkRepository = {
    async reportData() {
      calls.push(["benchmarkReportData"]);
      return {
        generated_at_utc: "2026-07-22T00:00:00Z",
        summary: {
          total_versions: 1,
          benchmarked_versions: 1,
          total_runs: 1,
          total_cases: 1,
          latest_run_at: "2026-07-22T00:00:00Z",
        },
        versions: [],
      };
    },
    async recordRun(value) {
      calls.push(["recordBenchmarkRun", value]);
      return { id: "benchmark-1", created: true };
    },
  };
  const trainingDataRepository = {
    async summary() {
      calls.push(["trainingDataSummary"]);
      return { quality: [], sources: [], exports: {} };
    },
    async validatePending(limit) {
      calls.push(["validateTrainingData", limit]);
      return { validated: 0, passed: 0, failed: 0 };
    },
    async addLabel(value) {
      calls.push(["addTrainingLabel", value]);
      return { id: "label-1" };
    },
  };
  const { server } = createNativeBotBridge({
    matchRepository,
    benchmarkRepository,
    trainingDataRepository,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const bot = {
    id: "wasm-alpha-beta-2",
    name: "Alpha Beta",
    description: "Test bot",
    kind: "wasm-alpha-beta",
    version: "depth-2",
    versionKey: "web-v1:depth-2",
    artifactDigest: "a".repeat(64),
    policyKey: "wasm-alpha-beta-v1",
    depth: 2,
  };

  const healthResponse = await fetch(`${baseUrl}/api/health`);
  assert.deepEqual(await healthResponse.json(), {
    ok: true,
    database: { connected: true },
  });

  const seriesResponse = await fetch(`${baseUrl}/api/series/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      botOne: bot,
      botTwo: bot,
      repeatCount: 3,
      mode: "engine-vs-engine",
      firstSeat: 0,
      settings: {},
    }),
  });
  assert.equal(seriesResponse.status, 201);
  assert.deepEqual(await seriesResponse.json(), { id: "series-1" });

  const matchResponse = await fetch(`${baseUrl}/api/matches/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      seriesId: "series-1",
      gameIndex: 1,
      settings: {},
      trajectory: {
        schemaVersion: 2,
        dataSource: "web-test",
        recorderVersion: "web-trajectory-v2",
        recorderBuildDigest: "b".repeat(64),
        observationEncoding: "qas-observation-20x9-v1:side-to-move",
        actionEncoding: "qas-action-mask-240-v1:side-to-move",
        stateEncoding: "qas-wasm-state-v1:side-to-move",
        rewardEncoding: "terminal-outcome-v1:actor-perspective",
        rulesetDigest: "c".repeat(64),
        rngSeed: 123,
        initialState: {
          pieces: Array(8).fill(15),
          ownership: 15,
          bitBoards: [1, 2, 4, 8, 256, 512, 1024, 2048],
          turn: 0,
        },
      },
    }),
  });
  assert.equal(matchResponse.status, 201);

  const actionMask = Array(240).fill(0);
  actionMask[127] = 1;
  const moveResponse = await fetch(`${baseUrl}/api/matches/match-1/moves`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ply: 1,
      seat: 0,
      source: 1,
      destination: 4,
      protocolAction: 127,
      thinkTimeMs: 12,
      observation: Array.from({ length: 20 }, () => Array(9).fill(0)),
      actionMask,
      observationTurn: 0,
      stateBefore: {
        pieces: Array(8).fill(15),
        ownership: 15,
        bitBoards: [1, 2, 4, 8, 256, 512, 1024, 2048],
        turn: 0,
      },
      stateAfter: {
        pieces: Array(8).fill(15),
        ownership: 15,
        bitBoards: [1, 2, 4, 16, 32, 256, 512, 1024],
        turn: 1,
      },
      rewardAfter: 0,
      rewardPerspective: "actor",
      outcomeAfter: null,
      isTerminal: false,
      terminalReasonKey: null,
      actorKind: "wasm-alpha-beta",
      policyMetadata: { depth: 2 },
      qualityFlags: [],
    }),
  });
  assert.equal(moveResponse.status, 201, await moveResponse.text());

  const finishResponse = await fetch(`${baseUrl}/api/matches/match-1/finish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      status: "completed",
      outcome: "player-one-win",
      terminationReason: "catch",
    }),
  });
  assert.equal(finishResponse.status, 200);

  const reportResponse = await fetch(`${baseUrl}/api/report`);
  assert.equal(reportResponse.status, 200);
  const report = await reportResponse.json();
  assert.equal(report.is_seed_data, false);
  assert.equal(report.benchmarks.summary.total_cases, 1);

  const benchmarkResponse = await fetch(`${baseUrl}/api/benchmarks`);
  assert.equal(benchmarkResponse.status, 200);
  assert.equal((await benchmarkResponse.json()).summary.total_runs, 1);

  const importResponse = await fetch(`${baseUrl}/api/benchmarks/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ run: { key: "test-run" } }),
  });
  assert.equal(importResponse.status, 201);
  assert.deepEqual(await importResponse.json(), {
    id: "benchmark-1",
    created: true,
  });

  assert.equal(
    (await fetch(`${baseUrl}/api/training-data/summary`)).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${baseUrl}/api/training-data/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 10 }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${baseUrl}/api/training-data/labels`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchId: "match-1", namespace: "review" }),
      })
    ).status,
    201,
  );

  assert.deepEqual(
    calls.map(([name]) => name),
    [
      "check",
      "startSeries",
      "startMatch",
      "recordMove",
      "finishMatch",
      "reportData",
      "benchmarkReportData",
      "benchmarkReportData",
      "recordBenchmarkRun",
      "trainingDataSummary",
      "validateTrainingData",
      "addTrainingLabel",
    ],
  );
});

test("bridge exposes rating and seeded tournament lifecycle routes", async (context) => {
  const calls = [];
  const matchRepository = {
    async registerBots(bots) {
      calls.push(["registerBots", bots]);
      return [{ botId: bots[0].id, rating: 1500 }];
    },
    async listRatings() {
      calls.push(["listRatings"]);
      return [];
    },
    async startTournament(value) {
      calls.push(["startTournament", value]);
      return { id: "tournament-1", entries: [] };
    },
    async startTournamentRound(id) {
      calls.push(["startTournamentRound", id]);
      return { roundNumber: 1, pairings: [] };
    },
    async finishTournamentPairing(tournamentId, pairingId, value) {
      calls.push(["finishTournamentPairing", tournamentId, pairingId, value]);
      return { ok: true };
    },
    async finishTournament(tournamentId, championEntryId) {
      calls.push(["finishTournament", tournamentId, championEntryId]);
      return { ok: true };
    },
    async stopTournament(id) {
      calls.push(["stopTournament", id]);
    },
  };
  const { server } = createNativeBotBridge({ matchRepository });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const bot = {
    id: "uniform-random",
    name: "Uniform Random",
    description: "Test bot",
    kind: "wasm-random",
    version: "seeded-v1",
    versionKey: "web-v1:seeded-v1",
    artifactDigest: "d".repeat(64),
    policyKey: "uniform-random-lcg-v1",
  };
  const post = (path, body) =>
    fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  assert.equal(
    (await post("/api/ratings/register", { bots: [bot] })).status,
    200,
  );
  assert.equal((await fetch(`${baseUrl}/api/ratings`)).status, 200);
  assert.equal(
    (
      await post("/api/tournaments/start", {
        participants: [bot, { ...bot, id: "random-two", versionKey: "v2" }],
        gamesPerPairing: 2,
      })
    ).status,
    201,
  );
  assert.equal(
    (await post("/api/tournaments/tournament-1/rounds/start", {})).status,
    201,
  );
  assert.equal(
    (
      await post("/api/tournaments/tournament-1/pairings/pairing-1/finish", {
        winnerEntryId: "entry-1",
        entryOneScore: 1,
        entryTwoScore: 1,
        advanceReason: "seed-tiebreak",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await post("/api/tournaments/tournament-1/finish", {
        championEntryId: "entry-1",
      })
    ).status,
    200,
  );
  assert.equal(
    (await post("/api/tournaments/tournament-1/stop", {})).status,
    200,
  );

  assert.deepEqual(
    calls.map(([name]) => name),
    [
      "registerBots",
      "listRatings",
      "startTournament",
      "startTournamentRound",
      "finishTournamentPairing",
      "finishTournament",
      "stopTournament",
    ],
  );
});
