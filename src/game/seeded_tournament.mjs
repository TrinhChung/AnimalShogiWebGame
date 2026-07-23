const maximumSeedGroups = 4;

export const assignSeeds = (participants) => {
  if (!Array.isArray(participants) || participants.length < 2) {
    throw new Error("A tournament requires at least two participants");
  }

  const ranked = [...participants].sort(
    (left, right) =>
      right.rating - left.rating || left.versionKey.localeCompare(right.versionKey),
  );
  const groupCount = Math.min(maximumSeedGroups, ranked.length);

  return ranked.map((participant, index) => ({
    ...participant,
    seed: index + 1,
    seedGroup: Math.floor((index * groupCount) / ranked.length) + 1,
    seedRating: participant.rating,
  }));
};

export const createSeededRound = (activeEntries) => {
  if (!Array.isArray(activeEntries) || activeEntries.length < 2) {
    throw new Error("A round requires at least two active entries");
  }

  const ordered = [...activeEntries].sort(
    (left, right) => left.seed - right.seed || left.entryId.localeCompare(right.entryId),
  );
  const bye = ordered.length % 2 === 1 ? ordered.shift() : null;
  const pairings = [];

  while (ordered.length > 0) {
    pairings.push({
      entryOne: ordered.shift(),
      entryTwo: ordered.pop(),
    });
  }

  return { bye, pairings };
};

export const selectPairingWinner = ({ entryOne, entryTwo, scoreOne, scoreTwo }) => {
  if (scoreOne > scoreTwo) {
    return { winner: entryOne, reason: "score" };
  }
  if (scoreTwo > scoreOne) {
    return { winner: entryTwo, reason: "score" };
  }
  return entryOne.seed < entryTwo.seed
    ? { winner: entryOne, reason: "seed-tiebreak" }
    : { winner: entryTwo, reason: "seed-tiebreak" };
};
