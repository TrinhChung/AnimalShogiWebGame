import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

import { createDatabaseFromEnvironment } from "./database.mjs";
import { MatchRepository } from "./match_repository.mjs";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const defaultPort = 8766;
const maximumRequestBytes = 512 * 1024;

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
  return {
    id: validateIdentifier(value.id, "bot id"),
    name: String(value.name ?? "").slice(0, 255),
    description: String(value.description ?? "").slice(0, 4_000),
    kind: validateIdentifier(value.kind, "bot kind"),
    version: validateIdentifier(value.version, "bot version"),
    versionKey: value.versionKey,
    depth:
      value.depth === undefined
        ? undefined
        : validateInteger(value.depth, "bot depth", 1, 100),
  };
};

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

export const createNativeBotBridge = ({ matchRepository = null } = {}) => {
  const botProcesses = new Map();

  const repository = () => {
    if (!matchRepository) {
      throw new HttpError(503, "MySQL match storage is unavailable");
    }
    return matchRepository;
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

      if (request.method === "GET" && request.url === "/api/report") {
        sendJson(response, 200, await repository().reportData());
        return;
      }

      if (request.method === "POST" && request.url === "/api/series/start") {
        const body = await readJson(request);
        const result = await repository().startSeries({
          botOne: validateBotDefinition(body.botOne),
          botTwo: validateBotDefinition(body.botTwo),
          repeatCount: validateInteger(body.repeatCount, "repeatCount", 1, 500),
          settings: body.settings ?? {},
        });
        sendJson(response, 201, result);
        return;
      }

      const finishSeriesMatch = request.url?.match(
        /^\/api\/series\/([a-zA-Z0-9-]+)\/finish$/,
      );
      if (request.method === "POST" && finishSeriesMatch) {
        const body = await readJson(request);
        const status = ["completed", "stopped", "failed"].includes(body.status)
          ? body.status
          : "stopped";
        await repository().finishSeries(
          validateIdentifier(finishSeriesMatch[1], "series id"),
          status,
        );
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && request.url === "/api/matches/start") {
        const body = await readJson(request);
        const result = await repository().startMatch({
          seriesId: validateIdentifier(body.seriesId, "series id"),
          gameIndex: validateInteger(body.gameIndex, "gameIndex", 1, 500),
          settings: body.settings ?? {},
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
        await repository().recordMove(
          validateIdentifier(recordMoveMatch[1], "match id"),
          {
            ply: validateInteger(body.ply, "ply", 1, 256),
            seat: validateInteger(body.seat, "seat", 0, 1),
            source: validateInteger(body.source, "source", 0, 19),
            destination: validateInteger(
              body.destination,
              "destination",
              0,
              11,
            ),
            protocolAction: validateInteger(
              body.protocolAction,
              "protocolAction",
              0,
              239,
            ),
            thinkTimeMs: validateInteger(
              body.thinkTimeMs,
              "thinkTimeMs",
              0,
              3_600_000,
            ),
            observation: observation.observation,
            actionMask: observation.action_mask,
            stateAfter: validateStateSnapshot(body.stateAfter),
            rewardAfter: Number.isFinite(body.rewardAfter)
              ? body.rewardAfter
              : null,
            isTerminal: Boolean(body.isTerminal),
            metadata: body.metadata ?? {},
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
        const status = ["completed", "stopped", "failed"].includes(body.status)
          ? body.status
          : "failed";
        const outcome = ["player-one-win", "player-two-win", "draw"].includes(
          body.outcome,
        )
          ? body.outcome
          : null;
        await repository().finishMatch(
          validateIdentifier(finishMatch[1], "match id"),
          {
            status,
            outcome,
            terminationReason:
              String(body.terminationReason ?? "").slice(0, 100) || null,
            botOneReward: Number.isFinite(body.botOneReward)
              ? body.botOneReward
              : null,
            botTwoReward: Number.isFinite(body.botTwoReward)
              ? body.botTwoReward
              : null,
            metadata: body.metadata ?? {},
            errorMessage:
              String(body.errorMessage ?? "").slice(0, 8_000) || null,
          },
        );
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
    const { server, closeAll } = createNativeBotBridge({ matchRepository });
    const shutdown = () => {
      closeAll();
      server.close(async () => {
        if (database) {
          await database.end();
        }
        process.exit(0);
      });
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    server.listen(port, "127.0.0.1", () => {
      console.log(`Native bot bridge: http://127.0.0.1:${port}`);
      console.log(
        `MySQL match storage: ${database ? "connected" : "disabled"}`,
      );
    });
  };

  start().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
