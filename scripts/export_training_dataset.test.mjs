import assert from "node:assert/strict";
import test from "node:test";

import { splitForGroup } from "./export_training_dataset.mjs";

test("dataset split is deterministic at the series boundary", () => {
  const first = splitForGroup("series-one", 1234);
  assert.equal(splitForGroup("series-one", 1234), first);
  assert(new Set(["train", "validation", "test"]).has(first));
});

test("dataset split seed participates in the stable hash", () => {
  const results = new Set(
    Array.from({ length: 100 }, (_, seed) => splitForGroup("series-one", seed)),
  );
  assert(results.size > 1);
});
