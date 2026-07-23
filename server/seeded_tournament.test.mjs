import assert from "node:assert/strict";
import test from "node:test";

import {
  assignSeeds,
  createSeededRound,
  selectPairingWinner,
} from "../src/game/seeded_tournament.mjs";

const participant = (entryId, rating) => ({
  entryId,
  versionKey: entryId,
  rating,
});

test("ratings are frozen into deterministic seed groups", () => {
  const seeds = assignSeeds([
    participant("c", 1500),
    participant("a", 1700),
    participant("b", 1600),
    participant("d", 1400),
    participant("e", 1300),
  ]);

  assert.deepEqual(
    seeds.map(({ entryId, seed, seedGroup, seedRating }) => ({
      entryId,
      seed,
      seedGroup,
      seedRating,
    })),
    [
      { entryId: "a", seed: 1, seedGroup: 1, seedRating: 1700 },
      { entryId: "b", seed: 2, seedGroup: 1, seedRating: 1600 },
      { entryId: "c", seed: 3, seedGroup: 2, seedRating: 1500 },
      { entryId: "d", seed: 4, seedGroup: 3, seedRating: 1400 },
      { entryId: "e", seed: 5, seedGroup: 4, seedRating: 1300 },
    ],
  );
});

test("each round pairs the highest remaining seed with the lowest", () => {
  const entries = assignSeeds([
    participant("a", 1800),
    participant("b", 1700),
    participant("c", 1600),
    participant("d", 1500),
    participant("e", 1400),
  ]);
  const round = createSeededRound(entries);

  assert.equal(round.bye?.entryId, "a");
  assert.deepEqual(
    round.pairings.map(({ entryOne, entryTwo }) => [
      entryOne.entryId,
      entryTwo.entryId,
    ]),
    [
      ["b", "e"],
      ["c", "d"],
    ],
  );
});

test("a tied pairing advances the frozen higher seed", () => {
  const [higher, lower] = assignSeeds([
    participant("higher", 1600),
    participant("lower", 1400),
  ]);

  const result = selectPairingWinner({
    entryOne: lower,
    entryTwo: higher,
    scoreOne: 1,
    scoreTwo: 1,
  });

  assert.equal(result.winner.entryId, "higher");
  assert.equal(result.reason, "seed-tiebreak");
});
