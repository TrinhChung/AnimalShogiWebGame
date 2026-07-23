export type MatchOutcome = "player-one-win" | "player-two-win" | "draw";

export const trajectoryContract: Readonly<{
  schemaVersion: 2;
  rulesetVersion: string;
  recorderVersion: string;
  validatorVersion: string;
  observationEncoding: string;
  actionEncoding: string;
  stateEncoding: string;
  rewardEncoding: string;
}>;

export function encodeProtocolAction(action: [number, number]): number;
export function decodeProtocolAction(actionIndex: number): [number, number];
export function expectedSeatForPly(firstSeat: number, ply: number): number;
export function actorRewardForOutcome(
  seat: number,
  outcome: MatchOutcome | null,
): number;
