import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

import {
  BenchmarkRepository,
  emptyBenchmarkReport,
} from "./benchmark_repository.mjs";
import {
  encodeProtocolAction,
  trajectoryContract,
} from "../src/game/trajectory_contract.mjs";
import { createDatabaseFromEnvironment } from "./database.mjs";
import { MatchRepository } from "./match_repository.mjs";
import { TrainingDataRepository } from "./training_data_repository.mjs";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const defaultPort = 8766;
const maximumRequestBytes = 4 * 1024 * 1024;

export const nativeBotDefinitions = [
  {
    id: "stage35",
    name: "C++ Stage 3.5",
    description:
      "Bản engine cổ điển Stage 3.5; một nước có thể mất khoảng 20–40 giây.",
    version: "3.5",
    executable: path.join(
      repositoryRoot,
      "evaluation/versions/legacy-stage3.5/qas.exe",
    ),
  },
  {
    id: "stage5",
    name: "C++ Stage 5",
    description:
      "Bản engine cổ điển Stage 5; một nước có thể mất khoảng 20–40 giây.",
    version: "5.0",
    executable: path.join(
      repositoryRoot,
      "evaluation/versions/legacy-stage5/qas.exe",
    ),
  },
  {
    id: "stage57",
    name: "C++ Stage 5.7",
    description:
      "Bản engine cổ điển Stage 5.7; một nước có thể mất khoảng 20–40 giây.",
    version: "5.7",
    executable: path.join(
      repositoryRoot,
      "evaluation/versions/legacy-stage5.7/qas.exe",
    ),
  },
  {
    id: "stage5-clean",
    name: "C++ Stage 5 Clean",
    description: "Artifact Stage 5 Clean đã được chấp nhận.",
    version: "stage5-clean",
    executable: path.join(
      repositoryRoot,
      "evaluation/versions/stage5-clean/qas.exe",
    ),
  },
  {
    id: "current-cpp",
    name: "C++ Current",
    description: "Bản Release hiện tại, giới hạn một giây cho mỗi nước.",
    version: "current",
    executable: path.join(repositoryRoot, "build/current/Release/qas.exe"),
    args: ["protocol", "1000", "8"],
  },
];

const artifactDigests = new Map();

const artifactDigest = (executable) => {
  const cached = artifactDigests.get(executable);
  if (cached) {
    return cached;
  }
  const digest = createHash("sha256")
    .update(readFileSync(executable))
    .digest("hex");
  artifactDigests.set(executable, digest);
  return digest;
};

const publicBot = (definition) => {
  const digest = artifactDigest(definition.executable);
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    kind: "native",
    version: definition.version,
    versionKey: `${definition.version}:${digest}`,
    artifactDigest: digest,
    policyKey: "native-json-protocol-v1",
  };
};

const availableBotDefinitions = () =>
  nativeBotDefinitions.filter(({ executable }) => existsSync(executable));

const findBot = (botId) =>
  availableBotDefinitions().find(({ id }) => id === botId);

const validateIdentifier = (value, fieldName) => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9._-]{1,80}$/.test(value)) {
    throw new Error(`${fieldName} is invalid`);
  }
  return value;
};

const validateInteger = (value, fieldName, minimum, maximum) => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${fieldName} is invalid`);
  }
  return value;
};

const validateBotDefinition = (value) => {
  if (!value || typeof value !== "object") {
    throw new Error("bot definition is invalid");
  }
  if (!/^[a-zA-Z0-9._:-]{1,255}$/.test(value.versionKey ?? "")) {
    throw new Error("bot version key is invalid");
  }
  if (!/^[0-9a-f]{64}$/.test(value.artifactDigest ?? "")) {
    throw new Error("bot artifact digest is invalid");
  }
  if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(value.policyKey ?? "")) {
    throw new Error("bot policy key is invalid");
  }
  return {
    id: validateIdentifier(value.id, "bot id"),
    name: String(value.name ?? "").slice(0, 255),
    description: String(value.description ?? "").slice(0, 4_000),
    kind: validateIdentifier(value.kind, "bot kind"),
    version: validateIdentifier(value.version, "bot version"),
    versionKey: value.versionKey,
    artifactDigest: value.artifactDigest,
    policyKey: value.policyKey,
    depth:
      value.depth === undefined
        ? undefined
        : validateInteger(value.depth, "bot depth", 1, 100),
  };
};

const validateObject = (value, fieldName) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} is invalid`);
  }
  return value;
};

const validateOptionalObject = (value, fieldName) =>
  value === undefined ? {} : validateObject(value, fieldName);

const validateStateSnapshot = (value) => {
  if (
    !value ||
    !Array.isArray(value.pieces) ||
    value.pieces.length !== 8 ||
    !value.pieces.every(
      (item) => Number.isInteger(item) && item >= 0 && item <= 255,
    ) ||
    !Number.isInteger(value.ownership) ||
    value.ownership < 0 ||
    value.ownership > 255 ||
    !Array.isArray(value.bitBoards) ||
    value.bitBoards.length !== 8 ||
    !value.bitBoards.every(
      (item) => Number.isInteger(item) && item >= 0 && item <= 4_095,
    ) ||
    !Number.isInteger(value.turn) ||
    value.turn < 0 ||
    value.turn > 256
  ) {
    throw new Error("state snapshot is invalid");
  }
  return value;
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const validateObservation = (observation) => {
  if (
    !observation ||
    !Array.isArray(observation.observation) ||
    observation.observation.length !== 20 ||
    !observation.observation.every(
      (row) =>
        Array.isArray(row) &&
        row.length === 9 &&
        row.every((value) => value === 0 || value === 1),
    ) ||
    !Array.isArray(observation.actionMask) ||
    observation.actionMask.length !== 240 ||
    !observation.actionMask.every((value) => value === 0 || value === 1) ||
    !Number.isInteger(observation.turn) ||
    observation.turn < 0 ||
    observation.turn > 256
  ) {
    throw new Error("bot observation is invalid");
  }

  return {
    observation: observation.observation,
    action_mask: observation.actionMask,
    turn: observation.turn,
  };
};

class NativeBotProcess {
  constructor(definition) {
    this.definition = definition;
    this.process = null;
    this.pending = null;
    this.stdoutBuffer = "";
  }

  start() {
    if (this.process) {
      return;
    }

    this.process = spawn(
      this.definition.executable,
      this.definition.args ?? [],
      {
        cwd: repositoryRoot,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.process.stdout.setEncoding("utf8");
    this.process.stderr.setEncoding("utf8");
    this.process.stdout.on("data", (chunk) => this.handleOutput(chunk));
    this.process.stderr.on("data", (chunk) =>
      process.stderr.write(`[${this.definition.id}] ${chunk}`),
    );
    this.process.on("error", (error) => this.fail(error));
    this.process.on("exit", (code) => {
      this.fail(new Error(`${this.definition.name} exited with code ${code}`));
      this.process = null;
    });
  }

  handleOutput(chunk) {
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      let response;
      try {
        response = JSON.parse(line);
      } catch {
        process.stderr.write(`[${this.definition.id} stdout] ${line}\n`);
        continue;
      }

      if (!this.pending) {
        continue;
      }

      const { resolve, timer } = this.pending;
      this.pending = null;
      clearTimeout(timer);
      resolve(response);
    }
  }

  fail(error) {
    if (!this.pending) {
      return;
    }

    const { reject, timer } = this.pending;
    this.pending = null;
    clearTimeout(timer);
    reject(error);
  }

  request(payload) {
    this.start();
    if (!this.process?.stdin.writable) {
      return Promise.reject(
        new Error(`${this.definition.name} is not writable`),
      );
    }
    if (this.pending) {
      return Promise.reject(
        new Error(`${this.definition.name} already has a pending request`),
      );
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        if (this.process && !this.process.killed) {
          this.process.kill();
        }
        this.process = null;
        reject(new Error(`${this.definition.name} timed out`));
      }, 45_000);
      this.pending = { resolve, reject, timer };
      this.process.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  close() {
    this.fail(new Error(`${this.definition.name} was stopped`));
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
    this.process = null;
  }
}

const sendJson = (response, status, value) => {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
};

const readJson = (request) => {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > maximumRequestBytes) {
        reject(new Error("request body is too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("request body is not valid JSON"));
      }
    });
    request.on("error", reject);
  });
};

export const createNativeBotBridge = ({
  matchRepository = null,
  benchmarkRepository = null,
  trainingDataRepository = null,
} = {}) => {
  const botProcesses = new Map();

  const repository = () => {
    if (!matchRepository) {
      throw new HttpError(503, "MySQL match storage is unavailable");
    }
    return matchRepository;
  };

  const benchmarks = () => {
    if (!benchmarkRepository) {
      throw new HttpError(503, "MySQL benchmark storage is unavailable");
    }
    return benchmarkRepository;
  };

  const trainingData = () => {
    if (!trainingDataRepository) {
      throw new HttpError(503, "MySQL training-data storage is unavailable");
    }
    return trainingDataRepository;
  };

  const closeSession = (sessionId) => {
    const prefix = `${sessionId}:`;
    for (const [key, botProcess] of botProcesses) {
      if (key.startsWith(prefix)) {
        botProcess.close();
        botProcesses.delete(key);
      }
    }
  };

  const closeAll = () => {
    for (const botProcess of botProcesses.values()) {
      botProcess.close();
    }
    botProcesses.clear();
  };

  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/api/health") {
        if (matchRepository) {
          await matchRepository.check();
        }
        sendJson(response, 200, {
          ok: true,
          database: { connected: Boolean(matchRepository) },
        });
        return;
      }

      if (request.method === "GET" && request.url === "/api/bots") {
        sendJson(response, 200, availableBotDefinitions().map(publicBot));
        return;
      }

      if (request.method === "GET" && request.url?.startsWith("/api/history")) {
        const url = new URL(request.url, "http://localhost");
        const limit = Number(url.searchParams.get("limit") ?? 50);
        sendJson(response, 200, await repository().listMatches(limit));
        return;
      }

      if (request.method === "GET" && request.url === "/api/stats/bots") {
        sendJson(response, 200, await repository().botStatistics());
        return;
      }

      if (request.method === "GET" && request.url === "/api/ratings") {
        sendJson(response, 200, await repository().listRatings());
        return;
      }

      if (
        request.method === "POST" &&
        request.url === "/api/ratings/register"
      ) {
        const body = await readJson(request);
        if (
          !Array.isArray(body.bots) ||
          body.bots.length < 1 ||
          body.bots.length > 100
        ) {
          throw new Error("bots must contain between 1 and 100 definitions");
        }
        const ratings = await repository().registerBots(
          body.bots.map(validateBotDefinition),
        );
        sendJson(response, 200, ratings);
        return;
      }

      if (request.method === "GET" && request.url === "/api/report") {
        const report = await repository().reportData();
        const benchmarkReport = benchmarkRepository
          ? await benchmarkRepository.reportData()
          : emptyBenchmarkReport();
        sendJson(response, 200, { ...report, benchmarks: benchmarkReport });
        return;
      }

      if (request.method === "GET" && request.url === "/api/benchmarks") {
        sendJson(response, 200, await benchmarks().reportData());
        return;
      }

      if (request.method === "POST" && request.url === "/api/benchmarks/runs") {
        const body = await readJson(request);
        const result = await benchmarks().recordRun(body);
        sendJson(response, result.created ? 201 : 200, result);
        return;
      }

      if (
        request.method === "GET" &&
        request.url === "/api/training-data/summary"
      ) {
        sendJson(response, 200, await trainingData().summary());
        return;
      }

      if (
        request.method === "POST" &&
        request.url === "/api/training-data/validate"
      ) {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          await trainingData().validatePending(
            validateInteger(body.limit ?? 100, "validation limit", 1, 1_000),
          ),
        );
        return;
      }

      if (
        request.method === "POST" &&
        request.url === "/api/training-data/labels"
      ) {
        const body = await readJson(request);
        sendJson(response, 201, await trainingData().addLabel(body));
        return;
      }

      if (
        request.method === "POST" &&
        request.url === "/api/tournaments/start"
      ) {
        const body = await readJson(request);
        if (
          !Array.isArray(body.participants) ||
          body.participants.length < 2 ||
          body.participants.length > 100
        ) {
          throw new Error("participants must contain between 2 and 100 bots");
        }
        const result = await repository().startTournament({
          name: String(body.name ?? "").slice(0, 255),
          participants: body.participants.map(validateBotDefinition),
          gamesPerPairing: validateInteger(
            body.gamesPerPairing,
            "gamesPerPairing",
            1,
            20,
          ),
          settings: body.settings ?? {},
        });
        sendJson(response, 201, result);
        return;
      }

      const startTournamentRound = request.url?.match(
        /^\/api\/tournaments\/([a-zA-Z0-9-]+)\/rounds\/start$/,
      );
      if (request.method === "POST" && startTournamentRound) {
        const result = await repository().startTournamentRound(
          validateIdentifier(startTournamentRound[1], "tournament id"),
        );
        sendJson(response, 201, result);
        return;
      }

      const finishTournamentPairing = request.url?.match(
        /^\/api\/tournaments\/([a-zA-Z0-9-]+)\/pairings\/([a-zA-Z0-9-]+)\/finish$/,
      );
      if (request.method === "POST" && finishTournamentPairing) {
        const body = await readJson(request);
        const result = await repository().finishTournamentPairing(
          validateIdentifier(finishTournamentPairing[1], "tournament id"),
          validateIdentifier(finishTournamentPairing[2], "pairing id"),
          {
            winnerEntryId: validateIdentifier(
              body.winnerEntryId,
              "winner entry id",
            ),
            entryOneScore: Number(body.entryOneScore),
            entryTwoScore: Number(body.entryTwoScore),
            advanceReason: body.advanceReason,
          },
        );
        sendJson(response, 200, result);
        return;
      }

      const finishTournament = request.url?.match(
        /^\/api\/tournaments\/([a-zA-Z0-9-]+)\/finish$/,
      );
      if (request.method === "POST" && finishTournament) {
        const body = await readJson(request);
        const result = await repository().finishTournament(
          validateIdentifier(finishTournament[1], "tournament id"),
          validateIdentifier(body.championEntryId, "champion entry id"),
        );
        sendJson(response, 200, result);
        return;
      }

      const stopTournament = request.url?.match(
        /^\/api\/tournaments\/([a-zA-Z0-9-]+)\/stop$/,
      );
      if (request.method === "POST" && stopTournament) {
        await repository().stopTournament(
          validateIdentifier(stopTournament[1], "tournament id"),
        );
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && request.url === "/api/series/start") {
        const body = await readJson(request);
        if (!new Set(["engine-vs-engine", "human-vs-engine"]).has(body.mode)) {
          throw new Error("series mode is invalid");
        }
        const result = await repository().startSeries({
          botOne: validateBotDefinition(body.botOne),
          botTwo: validateBotDefinition(body.botTwo),
          repeatCount: validateInteger(body.repeatCount, "repeatCount", 1, 500),
          mode: body.mode,
          firstSeat: validateInteger(body.firstSeat ?? 0, "firstSeat", 0, 1),
          tournamentPairingId: body.tournamentPairingId
            ? validateIdentifier(
                body.tournamentPairingId,
                "tournament pairing id",
              )
            : null,
          tournamentGameIndex:
            body.tournamentGameIndex === undefined
              ? null
              : validateInteger(
                  body.tournamentGameIndex,
                  "tournamentGameIndex",
                  1,
                  20,
                ),
          settings: validateOptionalObject(body.settings, "series settings"),
        });
        sendJson(response, 201, result);
        return;
      }

      const finishSeriesMatch = request.url?.match(
        /^\/api\/series\/([a-zA-Z0-9-]+)\/finish$/,
      );
      if (request.method === "POST" && finishSeriesMatch) {
        const body = await readJson(request);
        if (!new Set(["completed", "stopped", "failed"]).has(body.status)) {
          throw new Error("series status is invalid");
        }
        const status = body.status;
        const finished = await repository().finishSeries(
          validateIdentifier(finishSeriesMatch[1], "series id"),
          status,
        );
        if (!finished) {
          throw new HttpError(409, "series is unavailable or incomplete");
        }
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && request.url === "/api/matches/start") {
        const body = await readJson(request);
        const result = await repository().startMatch({
          seriesId: validateIdentifier(body.seriesId, "series id"),
          gameIndex: validateInteger(body.gameIndex, "gameIndex", 1, 500),
          settings: validateOptionalObject(body.settings, "match settings"),
          trajectory: {
            schemaVersion: validateInteger(
              body.trajectory?.schemaVersion,
              "trajectory schemaVersion",
              trajectoryContract.schemaVersion,
              trajectoryContract.schemaVersion,
            ),
            dataSource: validateIdentifier(
              body.trajectory?.dataSource,
              "trajectory dataSource",
            ),
            recorderVersion: validateIdentifier(
              body.trajectory?.recorderVersion,
              "trajectory recorderVersion",
            ),
            recorderBuildDigest: String(
              body.trajectory?.recorderBuildDigest ?? "",
            ),
            observationEncoding: String(
              body.trajectory?.observationEncoding ?? "",
            ),
            actionEncoding: String(body.trajectory?.actionEncoding ?? ""),
            stateEncoding: String(body.trajectory?.stateEncoding ?? ""),
            rewardEncoding: String(body.trajectory?.rewardEncoding ?? ""),
            rulesetDigest: String(body.trajectory?.rulesetDigest ?? ""),
            rngSeed: validateInteger(
              body.trajectory?.rngSeed,
              "trajectory rngSeed",
              0,
              0xffff_ffff,
            ),
            initialState: validateStateSnapshot(body.trajectory?.initialState),
          },
        });
        sendJson(response, 201, result);
        return;
      }

      const recordMoveMatch = request.url?.match(
        /^\/api\/matches\/([a-zA-Z0-9-]+)\/moves$/,
      );
      if (request.method === "POST" && recordMoveMatch) {
        const body = await readJson(request);
        const observation = validateObservation({
          observation: body.observation,
          actionMask: body.actionMask,
          turn: body.observationTurn,
        });
        const source = validateInteger(body.source, "source", 0, 19);
        const destination = validateInteger(
          body.destination,
          "destination",
          0,
          11,
        );
        const protocolAction = validateInteger(
          body.protocolAction,
          "protocolAction",
          0,
          239,
        );
        if (
          encodeProtocolAction([source, destination]) !== protocolAction ||
          observation.action_mask[protocolAction] !== 1
        ) {
          throw new Error("action is inconsistent with the legal mask");
        }
        if (typeof body.isTerminal !== "boolean") {
          throw new Error("isTerminal is invalid");
        }
        const outcomeAfter = [
          "player-one-win",
          "player-two-win",
          "draw",
        ].includes(body.outcomeAfter)
          ? body.outcomeAfter
          : null;
        const terminalReasonKey = ["try", "catch", "max-turn-draw"].includes(
          body.terminalReasonKey,
        )
          ? body.terminalReasonKey
          : null;
        if (
          (body.isTerminal && (!outcomeAfter || !terminalReasonKey)) ||
          (!body.isTerminal && (outcomeAfter || terminalReasonKey))
        ) {
          throw new Error("terminal labels are invalid");
        }
        if (
          !Number.isFinite(body.rewardAfter) ||
          body.rewardAfter < -1 ||
          body.rewardAfter > 1 ||
          body.rewardPerspective !== "actor"
        ) {
          throw new Error("reward label is invalid");
        }
        const qualityFlags = body.qualityFlags ?? [];
        if (
          !Array.isArray(qualityFlags) ||
          new Set(qualityFlags).size !== qualityFlags.length ||
          !qualityFlags.every(
            (item) =>
              typeof item === "string" &&
              /^[a-z0-9][a-z0-9._:-]{0,119}$/.test(item),
          )
        ) {
          throw new Error("qualityFlags is invalid");
        }
        await repository().recordMove(
          validateIdentifier(recordMoveMatch[1], "match id"),
          {
            ply: validateInteger(body.ply, "ply", 1, 256),
            seat: validateInteger(body.seat, "seat", 0, 1),
            source,
            destination,
            protocolAction,
            thinkTimeMs:
              body.thinkTimeMs === null
                ? null
                : validateInteger(
                    body.thinkTimeMs,
                    "thinkTimeMs",
                    0,
                    3_600_000,
                  ),
            observation: observation.observation,
            actionMask: observation.action_mask,
            observationTurn: observation.turn,
            stateBefore: validateStateSnapshot(body.stateBefore),
            stateAfter: validateStateSnapshot(body.stateAfter),
            rewardAfter: body.rewardAfter,
            rewardPerspective: body.rewardPerspective,
            outcomeAfter,
            isTerminal: body.isTerminal,
            terminalReasonKey,
            actorKind: validateIdentifier(body.actorKind, "actorKind"),
            policyMetadata: validateOptionalObject(
              body.policyMetadata,
              "policyMetadata",
            ),
            qualityFlags,
            metadata: validateOptionalObject(body.metadata, "move metadata"),
          },
        );
        sendJson(response, 201, { ok: true });
        return;
      }

      const finishMatch = request.url?.match(
        /^\/api\/matches\/([a-zA-Z0-9-]+)\/finish$/,
      );
      if (request.method === "POST" && finishMatch) {
        const body = await readJson(request);
        if (!new Set(["completed", "stopped", "failed"]).has(body.status)) {
          throw new Error("match status is invalid");
        }
        const status = body.status;
        const outcome = ["player-one-win", "player-two-win", "draw"].includes(
          body.outcome,
        )
          ? body.outcome
          : null;
        const finished = await repository().finishMatch(
          validateIdentifier(finishMatch[1], "match id"),
          {
            status,
            outcome,
            terminationReason: [
              "try",
              "catch",
              "max-turn-draw",
              "stopped",
              "failed",
            ].includes(body.terminationReason)
              ? body.terminationReason
              : null,
            metadata: validateOptionalObject(body.metadata, "match metadata"),
            errorMessage:
              String(body.errorMessage ?? "").slice(0, 8_000) || null,
          },
        );
        if (!finished) {
          throw new HttpError(409, "match is unavailable or already finished");
        }
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && request.url === "/api/reset") {
        const body = await readJson(request);
        closeSession(validateIdentifier(body.sessionId, "sessionId"));
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && request.url === "/api/shutdown") {
        sendJson(response, 200, { ok: true });
        setImmediate(() => {
          closeAll();
          server.close();
        });
        return;
      }

      if (request.method === "POST" && request.url === "/api/action") {
        const body = await readJson(request);
        const sessionId = validateIdentifier(body.sessionId, "sessionId");
        const seat = validateIdentifier(body.seat, "seat");
        const botId = validateIdentifier(body.botId, "botId");
        const definition = findBot(botId);
        if (!definition) {
          throw new Error(`native bot is unavailable: ${botId}`);
        }

        const observation = validateObservation(body.observation);
        const processKey = `${sessionId}:${seat}`;
        let botProcess = botProcesses.get(processKey);
        if (botProcess && botProcess.definition.id !== botId) {
          botProcess.close();
          botProcesses.delete(processKey);
          botProcess = undefined;
        }
        if (!botProcess) {
          botProcess = new NativeBotProcess(definition);
          botProcesses.set(processKey, botProcess);
        }

        const action = await botProcess.request({
          command: "get_action",
          observation,
        });
        if (!Number.isInteger(action) || action < 0 || action >= 240) {
          throw new Error(`${definition.name} returned an invalid action`);
        }
        if (observation.action_mask[action] !== 1) {
          throw new Error(`${definition.name} returned an illegal action`);
        }

        sendJson(response, 200, { action });
        return;
      }

      sendJson(response, 404, { error: "not found" });
    } catch (error) {
      if (
        request.method === "POST" &&
        request.url === "/api/action" &&
        error instanceof Error &&
        error.message.endsWith(" was stopped")
      ) {
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
        return;
      }
      sendJson(response, error instanceof HttpError ? error.status : 400, {
        error: error instanceof Error ? error.message : "request failed",
      });
    }
  });

  server.on("close", closeAll);
  return { server, closeAll };
};

const parsePort = () => {
  const portIndex = process.argv.indexOf("--port");
  if (portIndex === -1) {
    return defaultPort;
  }

  const port = Number(process.argv[portIndex + 1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("bridge port is invalid");
  }
  return port;
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const start = async () => {
    const port = parsePort();
    const database = await createDatabaseFromEnvironment();
    const matchRepository = database ? new MatchRepository(database) : null;
    const benchmarkRepository = database
      ? new BenchmarkRepository(database)
      : null;
    const trainingDataRepository = database
      ? new TrainingDataRepository(database)
      : null;
    if (matchRepository) {
      await matchRepository.initializeRatings();
    }
    const { server, closeAll } = createNativeBotBridge({
      matchRepository,
      benchmarkRepository,
      trainingDataRepository,
    });
    server.once("close", () => {
      void (database ? database.end() : Promise.resolve()).finally(() => {
        process.exit(0);
      });
    });
    const shutdown = () => {
      closeAll();
      server.close();
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    server.listen(port, "127.0.0.1", () => {
      console.log(`Native bot bridge: http://127.0.0.1:${port}`);
      console.log(
        `MySQL match/benchmark storage: ${database ? "connected" : "disabled"}`,
      );
    });
  };

  start().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
