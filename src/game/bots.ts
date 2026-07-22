export type BotKind = "wasm-alpha-beta" | "wasm-random" | "native";

export type BotDefinition = {
  id: string;
  name: string;
  description: string;
  kind: BotKind;
  version: string;
  versionKey: string;
  depth?: number;
};

export const packagedBots: BotDefinition[] = [
  {
    id: "wasm-alpha-beta-2",
    name: "WASM Alpha-Beta · Nhanh",
    description: "Alpha-Beta độ sâu 2, phù hợp để xem nhanh nhiều nước.",
    kind: "wasm-alpha-beta",
    version: "depth-2",
    versionKey: "web-v1:depth-2",
    depth: 2,
  },
  {
    id: "wasm-alpha-beta-4",
    name: "WASM Alpha-Beta · Cân bằng",
    description: "Alpha-Beta độ sâu 4, cân bằng tốc độ và sức chơi.",
    kind: "wasm-alpha-beta",
    version: "depth-4",
    versionKey: "web-v1:depth-4",
    depth: 4,
  },
  {
    id: "alpha-beta-8",
    name: "Alpha-Beta · Chuyên sâu",
    description:
      "Alpha-Beta độ sâu 8, ưu tiên sức chơi và có thể tính lâu hơn.",
    kind: "wasm-alpha-beta",
    version: "depth-8",
    versionKey: "web-v1:depth-8",
    depth: 8,
  },
  {
    id: "uniform-random",
    name: "Uniform Random",
    description: "Chọn ngẫu nhiên một nước hợp lệ với seed cố định.",
    kind: "wasm-random",
    version: "seeded-v1",
    versionKey: "web-v1:seeded-v1",
  },
];

export const decodeProtocolAction = (actionIndex: number): [number, number] => {
  if (!Number.isInteger(actionIndex) || actionIndex < 0 || actionIndex >= 240) {
    throw new Error(`Invalid protocol action: ${actionIndex}`);
  }

  const source = Math.floor(actionIndex / 12);
  const destination = actionIndex % 12;
  return source < 12
    ? [11 - source, 11 - destination]
    : [source, 11 - destination];
};

export const encodeProtocolAction = ([source, destination]: [
  number,
  number,
]): number => {
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
