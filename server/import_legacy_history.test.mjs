import assert from "node:assert/strict";
import test from "node:test";

import { importLegacyHistory } from "./import_legacy_history.mjs";

test("legacy history cannot enter the training-ready database", async () => {
  await assert.rejects(
    () => importLegacyHistory(),
    /Legacy JSONL import is disabled/,
  );
});
