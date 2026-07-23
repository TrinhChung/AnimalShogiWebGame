import {
  decodeProtocolAction,
  encodeProtocolAction,
} from "@/game/trajectory_contract.mjs";

export type BotKind = "wasm-alpha-beta" | "wasm-random" | "native" | "human";

export type BotDefinition = {
  id: string;
  name: string;
  description: string;
  kind: BotKind;
  version: string;
  versionKey: string;
  artifactDigest: string;
  policyKey: string;
  depth?: number;
};

const wasmArtifactDigest = __QAS_WASM_SHA256__;
const webBuildDigest = __QAS_WEB_BUILD_SHA256__;

export const localHumanParticipant: BotDefinition = {
  id: "local-human",
  name: "Local Human",
  description: "Local human input recorded without personal identifiers.",
  kind: "human",
  version: "human-input-v1",
  versionKey: `human-input-v1:${webBuildDigest}`,
  artifactDigest: webBuildDigest,
  policyKey: "human-ui-input-v1",
};

export const packagedBots: BotDefinition[] = [
  {
    id: "wasm-alpha-beta-2",
    name: "WASM Alpha-Beta · Nhanh",
    description: "Alpha-Beta độ sâu 2, phù hợp để xem nhanh nhiều nước.",
    kind: "wasm-alpha-beta",
    version: "depth-2",
    versionKey: `wasm-v1:${wasmArtifactDigest}:depth-2`,
    artifactDigest: wasmArtifactDigest,
    policyKey: "wasm-alpha-beta-v1",
    depth: 2,
  },
  {
    id: "wasm-alpha-beta-4",
    name: "WASM Alpha-Beta · Cân bằng",
    description: "Alpha-Beta độ sâu 4, cân bằng tốc độ và sức chơi.",
    kind: "wasm-alpha-beta",
    version: "depth-4",
    versionKey: `wasm-v1:${wasmArtifactDigest}:depth-4`,
    artifactDigest: wasmArtifactDigest,
    policyKey: "wasm-alpha-beta-v1",
    depth: 4,
  },
  {
    id: "alpha-beta-8",
    name: "Alpha-Beta · Chuyên sâu",
    description:
      "Alpha-Beta độ sâu 8, ưu tiên sức chơi và có thể tính lâu hơn.",
    kind: "wasm-alpha-beta",
    version: "depth-8",
    versionKey: `wasm-v1:${wasmArtifactDigest}:depth-8`,
    artifactDigest: wasmArtifactDigest,
    policyKey: "wasm-alpha-beta-v1",
    depth: 8,
  },
  {
    id: "uniform-random",
    name: "Uniform Random",
    description: "Chọn ngẫu nhiên một nước hợp lệ với seed cố định.",
    kind: "wasm-random",
    version: "seeded-v1",
    versionKey: `web-random-v1:${webBuildDigest}`,
    artifactDigest: webBuildDigest,
    policyKey: "uniform-random-lcg-v1",
  },
];

export { decodeProtocolAction, encodeProtocolAction };
