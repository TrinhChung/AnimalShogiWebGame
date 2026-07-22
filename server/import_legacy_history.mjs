import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { createDatabaseFromEnvironment } from "./database.mjs";
import { MatchRepository } from "./match_repository.mjs";

const legacyBot = (agent, fallbackId) => {
  const id = String(agent?.id ?? fallbackId).replace(/[^a-zA-Z0-9._-]/g, "-");
  const name = String(agent?.name ?? id);
  return {
    id,
    name,
    description: "Imported from the legacy JSONL match history.",
    kind: "native",
    version: "legacy",
    versionKey: `legacy-data:${id}`,
  };
};

const decodeProtocolAction = (action) => {
  if (!Number.isInteger(action) || action < 0 || action >= 240) {
    throw new Error(`invalid legacy action: ${action}`);
  }
  const externalSource = Math.floor(action / 12);
  const externalDestination = action % 12;
  return {
    source: externalSource < 12 ? 11 - externalSource : externalSource,
    destination: 11 - externalDestination,
  };
};

const inferredOutcome = (agentOne, agentTwo) => {
  if (agentOne.reward > agentTwo.reward) {
    return "player-one-win";
  }
  if (agentTwo.reward > agentOne.reward) {
    return "player-two-win";
  }
  return "draw";
};

export const importLegacyHistory = async (database, filePath) => {
  const repository = new MatchRepository(database);
  const lines = (await readFile(filePath, "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim());
  let imported = 0;
  let skipped = 0;

  for (const line of lines) {
    const importKey = createHash("sha256").update(line).digest("hex");
    const [existing] = await database.execute(
      `SELECT id FROM matches
       WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.legacyImportKey')) = ?
       LIMIT 1`,
      [importKey],
    );
    if (existing.length > 0) {
      skipped += 1;
      continue;
    }

    const item = JSON.parse(line);
    const agentOne = item.agent_0 ?? item.bot0;
    const agentTwo = item.agent_1 ?? item.bot1;
    if (!agentOne || !agentTwo) {
      throw new Error("legacy match is missing an agent");
    }
    const settings = {
      ...(item.settings ?? {}),
      legacyImport: true,
      originalTimestamp: item.timestamp ?? null,
    };
    const series = await repository.startSeries({
      botOne: legacyBot(agentOne, "legacy-player-one"),
      botTwo: legacyBot(agentTwo, "legacy-player-two"),
      repeatCount: 1,
      settings,
    });
    const match = await repository.startMatch({
      seriesId: series.id,
      gameIndex: 1,
      settings,
    });

    for (const [index, move] of (
      item.moves ??
      item.move_history ??
      []
    ).entries()) {
      const action = Number(move.action);
      const coordinates = decodeProtocolAction(action);
      await repository.recordMove(match.id, {
        ply: Number(move.turn ?? index + 1),
        seat: move.agent === "agent_1" ? 1 : 0,
        ...coordinates,
        protocolAction: action,
        thinkTimeMs: move.think_time_ms ?? null,
        observation: move.observation ?? [],
        actionMask: move.action_mask ?? [],
        stateAfter: move.state_after ?? { importedFromLegacy: true },
        rewardAfter: move.reward_after ?? null,
        isTerminal:
          index === (item.moves ?? item.move_history ?? []).length - 1,
        metadata: { legacyImport: true },
      });
    }

    const outcome = item.outcome ?? inferredOutcome(agentOne, agentTwo);
    await repository.finishMatch(match.id, {
      status: "completed",
      outcome,
      terminationReason: "legacy-import",
      botOneReward: agentOne.reward ?? null,
      botTwoReward: agentTwo.reward ?? null,
      metadata: {
        legacyImportKey: importKey,
        originalTimestamp: item.timestamp ?? null,
      },
    });
    await repository.finishSeries(series.id, "completed");

    const originalTimestamp = new Date(item.timestamp);
    if (!Number.isNaN(originalTimestamp.getTime())) {
      await database.execute(
        "UPDATE matches SET started_at = ? WHERE public_id = ?",
        [originalTimestamp, match.id],
      );
      await database.execute(
        "UPDATE match_series SET started_at = ? WHERE public_id = ?",
        [originalTimestamp, series.id],
      );
    }
    imported += 1;
  }

  return { imported, skipped };
};

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error(
      "usage: node server/import_legacy_history.mjs <history.jsonl>",
    );
  }
  const database = await createDatabaseFromEnvironment();
  if (!database) {
    throw new Error("MySQL is not configured");
  }
  try {
    const result = await importLegacyHistory(database, filePath);
    console.log(
      `Legacy matches imported: ${result.imported}; already present: ${result.skipped}`,
    );
  } finally {
    await database.end();
  }
}
