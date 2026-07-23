import { pathToFileURL } from "node:url";

const disabledMessage =
  "Legacy JSONL import is disabled for the training-ready database. " +
  "Keep the source file as an external archive; legacy rows cannot satisfy trajectory schema v2 and must not be promoted to train-eligible.";

export const importLegacyHistory = async () => {
  throw new Error(disabledMessage);
};

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  console.error(disabledMessage);
  process.exitCode = 1;
}
