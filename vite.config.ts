import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const botBridgePort = process.env.QAS_BOT_BRIDGE_PORT ?? "8766";
const fileDigest = (paths: string[]) => {
  const digest = createHash("sha256");
  for (const sourcePath of paths) {
    digest.update(
      readFileSync(fileURLToPath(new URL(sourcePath, import.meta.url))),
    );
  }
  return digest.digest("hex");
};
const wasmDigest = fileDigest(["./src/wasm/quantum_animal_shogi_wasm_bg.wasm"]);
const webBuildDigest = fileDigest([
  "./src/wasm/quantum_animal_shogi_wasm_bg.wasm",
  "./src/game/bots.ts",
  "./src/game/trajectory_contract.mjs",
  "./src/stores/QuantumAnimalShogiStore.ts",
]);

export default defineConfig({
  base: "./",
  define: {
    __QAS_WASM_SHA256__: JSON.stringify(wasmDigest),
    __QAS_WEB_BUILD_SHA256__: JSON.stringify(webBuildDigest),
  },
  plugins: [vue()],
  server: {
    proxy: {
      "/api": `http://127.0.0.1:${botBridgePort}`,
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
