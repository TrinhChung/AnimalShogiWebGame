import assert from "node:assert/strict";
import test from "node:test";

import {
  BenchmarkRepository,
  buildBenchmarkReport,
  validateBenchmarkBundle,
} from "./benchmark_repository.mjs";

const validBundle = () => ({
  bot: {
    id: "stage5-clean",
    name: "Stage 5 Clean",
    kind: "native",
    description: "Accepted engine",
    version: "stage5-clean",
    versionKey: "stage5-clean:abc123",
    artifactDigest: "a".repeat(64),
    policyKey: "native-json-protocol-v1",
  },
  suite: {
    key: "focused-v1",
    name: "Focused benchmark",
    schemaVersion: 1,
    metricCatalog: { nodes: "count", elapsed_ms: "milliseconds" },
  },
  algorithm: {
    stageLabel: "Stage 5.0 Clean",
    searchFamily: "Negamax Alpha-Beta / PVS",
    sourceCommit: "5e096227947cf53c760a027318e26183863483f3",
    features: ["PVS", "TT", "L_eq trigger"],
    config: { tt_requested_mb: 256 },
  },
  run: {
    key: "20260722-focused",
    label: "Focused depth 10",
    status: "completed",
    source: "evaluation_pipeline",
    startedAt: "2026-07-22T00:00:00Z",
    finishedAt: "2026-07-22T00:01:00Z",
    environment: { cpu: "test" },
  },
  cases: [
    {
      positionKey: "initial",
      workloadClass: "general",
      depth: 10,
      repeatIndex: 1,
      completed: true,
      legalResult: true,
      nodes: 100_000,
      elapsedMs: 1_000,
      nps: 100_000,
      ttHitRate: 0.15,
      averageBranching: 20,
      reducedBranching: 15,
      movegenMs: 500,
      evalMs: 200,
      orderingMs: 100,
      propagationMs: 50,
      leqMs: 20,
      peakRssMb: 198,
    },
  ],
  findings: [
    {
      category: "movegen",
      severity: "warning",
      title: "Move generation dominates",
      evidence: { share_percent: 50 },
      recommendation: "Profile legal filtering.",
    },
  ],
});

test("benchmark bundle validation preserves reproducible metadata", () => {
  const bundle = validateBenchmarkBundle(validBundle());
  assert.equal(bundle.bot.versionKey, "stage5-clean:abc123");
  assert.equal(bundle.algorithm.features.length, 3);
  assert.equal(bundle.cases[0].positionKey, "initial");
  assert(bundle.run.startedAt instanceof Date);
  assert(bundle.run.finishedAt instanceof Date);
});

test("benchmark bundle validation rejects an invalid bounded metric", () => {
  const bundle = validBundle();
  bundle.cases[0].ttHitRate = 1.1;
  assert.throws(
    () => validateBenchmarkBundle(bundle),
    /benchmark case 0 ttHitRate is invalid/,
  );
});

test("benchmark bundle validation rejects ambiguous booleans and timestamps", () => {
  const ambiguousBoolean = validBundle();
  ambiguousBoolean.cases[0].completed = "false";
  assert.throws(
    () => validateBenchmarkBundle(ambiguousBoolean),
    /benchmark case 0 completed is invalid/,
  );

  const reversedTime = validBundle();
  reversedTime.run.finishedAt = "2026-07-21T23:59:00Z";
  assert.throws(
    () => validateBenchmarkBundle(reversedTime),
    /finishedAt precedes startedAt/,
  );
});

test("benchmark report exposes cost profile, workload and recommendations", () => {
  const rows = [
    {
      versionDatabaseId: 7,
      versionKey: "stage5-clean:abc123",
      versionLabel: "stage5-clean",
      botKey: "stage5-clean",
      botName: "Stage 5 Clean",
      stageLabel: "Stage 5.0 Clean",
      searchFamily: "Negamax Alpha-Beta / PVS",
      profileSourceCommit: "5e096227947cf53c760a027318e26183863483f3",
      featuresJson: JSON.stringify(["PVS", "TT", "L_eq trigger"]),
      algorithmConfigJson: JSON.stringify({ tt_requested_mb: 256 }),
      runId: 11,
      finishedAt: "2026-07-22T00:01:00Z",
      suiteKey: "focused-v1",
      caseId: 13,
      positionKey: "initial",
      workloadClass: "general",
      depth: 10,
      completed: 1,
      legalResult: 1,
      nodes: 100_000,
      elapsedMs: 1_000,
      nps: 100_000,
      ttHitRate: 0.15,
      averageBranching: 20,
      reducedBranching: 15,
      evalMs: 200,
      movegenMs: 500,
      orderingMs: 100,
      propagationMs: 50,
      leqMs: 20,
      peakRssMb: 198,
    },
  ];
  const findings = [
    {
      botKey: "stage5-clean",
      versionKey: "stage5-clean:abc123",
      category: "movegen",
      severity: "warning",
      title: "Persisted finding",
      evidenceJson: JSON.stringify({ source: "profile" }),
      recommendation: "Inspect legal filtering.",
    },
  ];

  const report = buildBenchmarkReport(rows, findings);
  assert.equal(report.summary.total_versions, 1);
  assert.equal(report.summary.total_cases, 1);
  const version = report.versions[0];
  assert.equal(version.version_id, "stage5-clean@stage5-clean:abc123");
  assert.equal(version.data_quality, "verified");
  assert.equal(version.median_nps, 100_000);
  assert.equal(version.max_completed_depth, 10);
  assert.equal(version.workloads[0].position_key, "initial");
  assert.equal(version.component_breakdown[0].key, "movegen");
  assert.equal(version.findings[0].source, "persisted");
  assert(
    version.findings.some(
      (finding) =>
        finding.source === "automatic" && finding.category === "movegen",
    ),
  );
});

test("missing optional search metrics do not produce false TT or branching findings", () => {
  const rows = [
    {
      versionDatabaseId: 8,
      versionKey: "stage5-clean:no-optional-metrics",
      versionLabel: "stage5-clean",
      botKey: "stage5-clean",
      botName: "Stage 5 Clean",
      stageLabel: "Stage 5.0 Clean",
      searchFamily: "Negamax Alpha-Beta / PVS",
      profileSourceCommit: "5e096227947cf53c760a027318e26183863483f3",
      featuresJson: "[]",
      algorithmConfigJson: "{}",
      runId: 12,
      finishedAt: "2026-07-22T00:01:00Z",
      suiteKey: "minimal-v1",
      caseId: 14,
      positionKey: "initial",
      workloadClass: "general",
      depth: 10,
      completed: 1,
      legalResult: 1,
      nodes: 200_000,
      elapsedMs: 1_000,
      nps: 200_000,
      ttHitRate: null,
      averageBranching: 25,
      reducedBranching: null,
      evalMs: null,
      movegenMs: null,
      orderingMs: null,
      propagationMs: null,
      leqMs: null,
      peakRssMb: null,
    },
  ];

  const version = buildBenchmarkReport(rows).versions[0];
  assert.equal(version.tt_hit_sample_count, 0);
  assert.equal(version.branching_pair_sample_count, 0);
  assert.equal(version.branching_reduction_percent, 0);
  assert.equal(
    version.findings.some((finding) =>
      ["transposition_table", "branching"].includes(finding.category),
    ),
    false,
  );
});

test("benchmark import rejects a profile change for an immutable bot version", async () => {
  const lifecycle = [];
  const bundle = validBundle();
  const connection = {
    async beginTransaction() {
      lifecycle.push("begin");
    },
    async commit() {
      lifecycle.push("commit");
    },
    async rollback() {
      lifecycle.push("rollback");
    },
    release() {
      lifecycle.push("release");
    },
    async execute(statement) {
      if (statement.includes("SELECT id FROM bots")) {
        return [[{ id: 1 }]];
      }
      if (statement.includes("FROM bot_versions WHERE")) {
        return [
          [
            {
              id: 2,
              artifactDigest: bundle.bot.artifactDigest,
              policyKey: bundle.bot.policyKey,
            },
          ],
        ];
      }
      if (statement.includes("schema_version AS schemaVersion")) {
        return [
          [
            {
              id: 3,
              schemaVersion: bundle.suite.schemaVersion,
              metricCatalogJson: JSON.stringify(bundle.suite.metricCatalog),
            },
          ],
        ];
      }
      if (statement.includes("stage_label AS stageLabel")) {
        return [
          [
            {
              stageLabel: bundle.algorithm.stageLabel,
              searchFamily: bundle.algorithm.searchFamily,
              sourceCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              featuresJson: JSON.stringify(bundle.algorithm.features),
              configJson: JSON.stringify(bundle.algorithm.config),
              notes: null,
            },
          ],
        ];
      }
      return [[]];
    },
  };
  const repository = new BenchmarkRepository({
    async getConnection() {
      return connection;
    },
  });

  await assert.rejects(
    () => repository.recordRun(bundle),
    /algorithm profile conflicts with the existing bot version/,
  );
  assert.deepEqual(lifecycle, ["begin", "rollback", "release"]);
});
