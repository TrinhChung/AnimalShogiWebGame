export const trajectoryContract = Object.freeze({
  schemaVersion: 2,
  rulesetVersion: "quantum-animal-shogi-v1",
  recorderVersion: "web-trajectory-v2",
  validatorVersion: "wasm-replay-v1",
  observationEncoding: "qas-observation-20x9-v1:side-to-move",
  actionEncoding: "qas-action-mask-240-v1:side-to-move",
  stateEncoding: "qas-wasm-state-v1:side-to-move",
  rewardEncoding: "terminal-outcome-v1:actor-perspective",
});

export const encodeProtocolAction = ([source, destination]) => {
  if (
    !Number.isInteger(source) ||
    !Number.isInteger(destination) ||
    source < 0 ||
    source >= 20 ||
    destination < 0 ||
    destination >= 12
  ) {
    throw new Error(`Invalid internal action: [${source}, ${destination}]`);
  }
  const externalSource = source < 12 ? 11 - source : source;
  return externalSource * 12 + (11 - destination);
};

export const decodeProtocolAction = (actionIndex) => {
  if (!Number.isInteger(actionIndex) || actionIndex < 0 || actionIndex >= 240) {
    throw new Error(`Invalid protocol action: ${actionIndex}`);
  }
  const externalSource = Math.floor(actionIndex / 12);
  const externalDestination = actionIndex % 12;
  return externalSource < 12
    ? [11 - externalSource, 11 - externalDestination]
    : [externalSource, 11 - externalDestination];
};

export const expectedSeatForPly = (firstSeat, ply) => (firstSeat + ply - 1) % 2;

export const actorRewardForOutcome = (seat, outcome) => {
  if (outcome === "draw") {
    return 0;
  }
  if (outcome === "player-one-win") {
    return seat === 0 ? 1 : -1;
  }
  if (outcome === "player-two-win") {
    return seat === 1 ? 1 : -1;
  }
  return 0;
};
