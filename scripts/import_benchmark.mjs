import { readFile } from "node:fs/promises";
import path from "node:path";

const [bundlePath, bridgeUrl = "http://127.0.0.1:8766"] = process.argv.slice(2);

if (!bundlePath) {
  console.error(
    "Usage: node scripts/import_benchmark.mjs <benchmark-bundle.json> [bridge-url]",
  );
  process.exitCode = 1;
} else {
  try {
    const absolutePath = path.resolve(bundlePath);
    const bundle = JSON.parse(await readFile(absolutePath, "utf8"));
    const response = await fetch(
      `${bridgeUrl.replace(/\/$/, "")}/api/benchmarks/runs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bundle),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error ?? `HTTP ${response.status}`);
    }
    console.log(
      `${result.created ? "Imported" : "Already present"}: ${result.id}`,
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Benchmark import failed",
    );
    process.exitCode = 1;
  }
}
