import { pathToFileURL } from "node:url";

import { createDatabaseFromEnvironment } from "../server/database.mjs";
import { TrainingDataRepository } from "../server/training_data_repository.mjs";

const parseLimit = (arguments_) => {
  if (arguments_.length === 0) return 100;
  if (arguments_.length !== 2 || arguments_[0] !== "--limit") {
    throw new Error("usage: npm run dataset:validate -- --limit <1..1000>");
  }
  const limit = Number(arguments_[1]);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("validation limit is invalid");
  }
  return limit;
};

export const validatePendingTrainingData = async (limit) => {
  const database = await createDatabaseFromEnvironment();
  if (!database) throw new Error("MySQL is not configured");
  try {
    return await new TrainingDataRepository(database).validatePending(limit);
  } finally {
    await database.end();
  }
};

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  validatePendingTrainingData(parseLimit(process.argv.slice(2)))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
