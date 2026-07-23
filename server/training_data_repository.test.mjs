import assert from "node:assert/strict";
import test from "node:test";

import { TrainingDataRepository } from "./training_data_repository.mjs";

test("training-data summary preserves explicit quality buckets", async () => {
  let queryIndex = 0;
  const repository = new TrainingDataRepository({
    async query() {
      queryIndex += 1;
      if (queryIndex === 1) {
        return [
          [
            {
              qualityStatus: "train-eligible",
              matchCount: "3",
              transitionCount: "72",
            },
            {
              qualityStatus: "quarantined",
              matchCount: "2",
              transitionCount: "18",
            },
          ],
        ];
      }
      if (queryIndex === 2) {
        return [
          [
            {
              dataSource: "web-tournament",
              qualityStatus: "train-eligible",
              matchCount: "3",
            },
          ],
        ];
      }
      return [
        [
          {
            exportCount: "1",
            exportedMatchCount: "3",
            exportedSampleCount: "72",
          },
        ],
      ];
    },
  });
  const summary = await repository.summary();
  assert.deepEqual(summary.quality[0], {
    quality_status: "train-eligible",
    match_count: 3,
    transition_count: 72,
  });
  assert.deepEqual(summary.exports, {
    export_count: 1,
    match_count: 3,
    sample_count: 72,
  });
});

test("a label requires exactly one versioned target", async () => {
  const repository = new TrainingDataRepository({});
  await assert.rejects(
    () =>
      repository.addLabel({
        namespace: "review",
        key: "tactical-quality",
        version: 1,
        producer: "human-review-v1",
        value: "good",
      }),
    /exactly one target/,
  );
});
