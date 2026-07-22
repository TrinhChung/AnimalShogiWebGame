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
    },
    async finishSeries(id, status) {
      calls.push(["finishSeries", id, status]);
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
  const { server } = createNativeBotBridge({ matchRepository });
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
      settings: {},
    }),
  });
  assert.equal(seriesResponse.status, 201);
  assert.deepEqual(await seriesResponse.json(), { id: "series-1" });

  const matchResponse = await fetch(`${baseUrl}/api/matches/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seriesId: "series-1", gameIndex: 1, settings: {} }),
  });
  assert.equal(matchResponse.status, 201);

  const moveResponse = await fetch(`${baseUrl}/api/matches/match-1/moves`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ply: 1,
      seat: 0,
      source: 1,
      destination: 4,
      protocolAction: 124,
      thinkTimeMs: 12,
      observation: Array.from({ length: 20 }, () => Array(9).fill(0)),
      actionMask: Array(240).fill(0),
      observationTurn: 0,
      stateAfter: {
        pieces: Array(8).fill(15),
        ownership: 15,
        bitBoards: [1, 2, 4, 16, 32, 256, 512, 1024],
        turn: 1,
      },
      rewardAfter: 0,
      isTerminal: false,
    }),
  });
  assert.equal(moveResponse.status, 201, await moveResponse.text());

  const finishResponse = await fetch(`${baseUrl}/api/matches/match-1/finish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      status: "completed",
      outcome: "player-one-win",
      botOneReward: 1,
      botTwoReward: -1,
    }),
  });
  assert.equal(finishResponse.status, 200);

  const reportResponse = await fetch(`${baseUrl}/api/report`);
  assert.equal(reportResponse.status, 200);
  assert.equal((await reportResponse.json()).is_seed_data, false);

  assert.deepEqual(
    calls.map(([name]) => name),
    [
      "check",
      "startSeries",
      "startMatch",
      "recordMove",
      "finishMatch",
      "reportData",
    ],
  );
});
