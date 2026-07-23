export type RatingParticipant = {
  entryId: string;
  versionKey: string;
  rating: number;
};

export type SeededEntry = RatingParticipant & {
  seed: number;
  seedGroup: number;
  seedRating: number;
};

export function assignSeeds<T extends RatingParticipant>(
  participants: T[],
): Array<
  T & {
    seed: number;
    seedGroup: number;
    seedRating: number;
  }
>;

export function createSeededRound<T extends SeededEntry>(entries: T[]): {
  bye: T | null;
  pairings: Array<{ entryOne: T; entryTwo: T }>;
};

export function selectPairingWinner<T extends SeededEntry>(input: {
  entryOne: T;
  entryTwo: T;
  scoreOne: number;
  scoreTwo: number;
}): { winner: T; reason: "score" | "seed-tiebreak" };
