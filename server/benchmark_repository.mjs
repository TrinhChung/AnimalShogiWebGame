import { randomUUID } from "node:crypto";

const maximumCaseCount = 2_000;
const maximumFindingCount = 200;
const reportColors = [
  "#dca047",
  "#5c9d7e",
  "#668fc5",
  "#8a72bf",
  "#bf7767",
  "#5b9ca1",
];

const json = (value) => JSON.stringify(value ?? {});

const canonicalValue = (value) => {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
};

const sameJson = (left, right) =>
  JSON.stringify(canonicalValue(parseJson(left, {}))) ===
  JSON.stringify(canonicalValue(right));

const parseJson = (value, fallback) => {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const text = (value, field, maximumLength, { optional = false } = {}) => {
  const result = String(value ?? "").trim();
  if ((!optional && result.length === 0) || result.length > maximumLength) {
    throw new Error(`${field} is invalid`);
  }
  return result || null;
};

const identifier = (value, field, maximumLength = 120) => {
  const result = text(value, field, maximumLength);
  if (!/^[a-zA-Z0-9._:-]+$/.test(result)) {
    throw new Error(`${field} is invalid`);
  }
  return result;
};

const sha256 = (value, field) => {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${field} is invalid`);
  }
  return value;
};

const integer = (value, field, minimum, maximum) => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} is invalid`);
  }
  return value;
};

const metric = (
  value,
  field,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
) => {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${field} is invalid`);
  }
  return value;
};

const boolean = (value, field) => {
  if (typeof value !== "boolean") {
    throw new Error(`${field} is invalid`);
  }
  return value;
};

const object = (value, field, { optional = false } = {}) => {
  if ((value === null || value === undefined) && optional) {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} is invalid`);
  }
  return value;
};

const timestamp = (value, field, { optional = false } = {}) => {
  if ((value === null || value === undefined || value === "") && optional) {
    return null;
  }
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) {
    throw new Error(`${field} is invalid`);
  }
  return result;
};

const validateBot = (value) => {
  if (!value || typeof value !== "object") {
    throw new Error("benchmark bot is invalid");
  }
  return {
    id: identifier(value.id, "benchmark bot id", 100),
    name: text(value.name, "benchmark bot name", 255),
    kind: identifier(value.kind, "benchmark bot kind", 50),
    description: text(value.description, "benchmark bot description", 4_000, {
      optional: true,
    }),
    version: identifier(value.version, "benchmark bot version", 100),
    versionKey: identifier(value.versionKey, "benchmark bot version key", 255),
    artifactDigest: sha256(
      value.artifactDigest,
      "benchmark bot artifactDigest",
    ),
    policyKey: identifier(value.policyKey, "benchmark bot policyKey", 120),
    depth:
      value.depth === undefined
        ? null
        : integer(value.depth, "benchmark bot depth", 1, 256),
  };
};

const validateCase = (value, index) => {
  if (!value || typeof value !== "object") {
    throw new Error(`benchmark case ${index} is invalid`);
  }
  return {
    positionKey: identifier(
      value.positionKey,
      `benchmark case ${index} positionKey`,
      160,
    ),
    workloadClass: identifier(
      value.workloadClass ?? "general",
      `benchmark case ${index} workloadClass`,
      80,
    ),
    depth: integer(value.depth ?? 0, `benchmark case ${index} depth`, 0, 256),
    timeLimitMs: integer(
      value.timeLimitMs ?? 0,
      `benchmark case ${index} timeLimitMs`,
      0,
      3_600_000,
    ),
    repeatIndex: integer(
      value.repeatIndex ?? 1,
      `benchmark case ${index} repeatIndex`,
      1,
      10_000,
    ),
    completed: boolean(value.completed, `benchmark case ${index} completed`),
    legalResult: boolean(
      value.legalResult,
      `benchmark case ${index} legalResult`,
    ),
    bestMove: text(value.bestMove, `benchmark case ${index} bestMove`, 100, {
      optional: true,
    }),
    score: metric(
      value.score,
      `benchmark case ${index} score`,
      -10_000_000,
      10_000_000,
    ),
    nodes: metric(value.nodes, `benchmark case ${index} nodes`),
    elapsedMs: metric(value.elapsedMs, `benchmark case ${index} elapsedMs`),
    nps: metric(value.nps, `benchmark case ${index} nps`),
    ttHitRate: metric(
      value.ttHitRate,
      `benchmark case ${index} ttHitRate`,
      0,
      1,
    ),
    averageBranching: metric(
      value.averageBranching,
      `benchmark case ${index} averageBranching`,
    ),
    reducedBranching: metric(
      value.reducedBranching,
      `benchmark case ${index} reducedBranching`,
    ),
    evalMs: metric(value.evalMs, `benchmark case ${index} evalMs`),
    movegenMs: metric(value.movegenMs, `benchmark case ${index} movegenMs`),
    orderingMs: metric(value.orderingMs, `benchmark case ${index} orderingMs`),
    propagationMs: metric(
      value.propagationMs,
      `benchmark case ${index} propagationMs`,
    ),
    leqMs: metric(value.leqMs, `benchmark case ${index} leqMs`),
    peakRssMb: metric(value.peakRssMb, `benchmark case ${index} peakRssMb`),
    metrics: object(value.metrics, `benchmark case ${index} metrics`, {
      optional: true,
    }),
  };
};

const validateFinding = (value, index) => {
  if (!value || typeof value !== "object") {
    throw new Error(`benchmark finding ${index} is invalid`);
  }
  const severity = identifier(
    value.severity ?? "info",
    `benchmark finding ${index} severity`,
    20,
  );
  if (!new Set(["info", "warning", "critical"]).has(severity)) {
    throw new Error(`benchmark finding ${index} severity is invalid`);
  }
  return {
    category: identifier(
      value.category,
      `benchmark finding ${index} category`,
      80,
    ),
    severity,
    title: text(value.title, `benchmark finding ${index} title`, 255),
    evidence: object(value.evidence, `benchmark finding ${index} evidence`, {
      optional: true,
    }),
    recommendation: text(
      value.recommendation,
      `benchmark finding ${index} recommendation`,
      8_000,
    ),
  };
};

export const validateBenchmarkBundle = (value) => {
  if (!value || typeof value !== "object") {
    throw new Error("benchmark bundle is invalid");
  }
  if (!Array.isArray(value.cases) || value.cases.length > maximumCaseCount) {
    throw new Error(
      `benchmark cases must contain at most ${maximumCaseCount} items`,
    );
  }
  if (
    !Array.isArray(value.findings ?? []) ||
    (value.findings ?? []).length > maximumFindingCount
  ) {
    throw new Error(
      `benchmark findings must contain at most ${maximumFindingCount} items`,
    );
  }
  const algorithmSourceCommit = text(
    value.algorithm?.sourceCommit,
    "benchmark source commit",
    40,
    { optional: true },
  );
  const runSourceCommit = text(
    value.run?.sourceCommit,
    "benchmark run source commit",
    40,
    { optional: true },
  );
  if (
    algorithmSourceCommit &&
    runSourceCommit &&
    algorithmSourceCommit.toLowerCase() !== runSourceCommit.toLowerCase()
  ) {
    throw new Error("benchmark source commits do not match");
  }
  const sourceCommit = (
    algorithmSourceCommit ?? runSourceCommit
  )?.toLowerCase();
  if (sourceCommit && !/^[a-fA-F0-9]{40}$/.test(sourceCommit)) {
    throw new Error("benchmark source commit is invalid");
  }
  const features = value.algorithm?.features ?? [];
  if (
    !Array.isArray(features) ||
    features.length > 100 ||
    !features.every(
      (item) =>
        typeof item === "string" && item.length > 0 && item.length <= 100,
    )
  ) {
    throw new Error("benchmark algorithm features are invalid");
  }
  const status = identifier(
    value.run?.status ?? "completed",
    "benchmark run status",
    30,
  );
  if (!new Set(["completed", "partial", "failed"]).has(status)) {
    throw new Error("benchmark run status is invalid");
  }
  const startedAt = timestamp(value.run?.startedAt, "benchmark run startedAt");
  const finishedAt = timestamp(
    value.run?.finishedAt,
    "benchmark run finishedAt",
    { optional: true },
  );
  if (status === "completed" && !finishedAt) {
    throw new Error("completed benchmark run requires finishedAt");
  }
  if (finishedAt && finishedAt < startedAt) {
    throw new Error("benchmark run finishedAt precedes startedAt");
  }
  return {
    bot: validateBot(value.bot),
    suite: {
      key: identifier(value.suite?.key, "benchmark suite key", 120),
      name: text(value.suite?.name, "benchmark suite name", 255),
      description: text(
        value.suite?.description,
        "benchmark suite description",
        4_000,
        { optional: true },
      ),
      schemaVersion: integer(
        value.suite?.schemaVersion ?? 1,
        "benchmark suite schema version",
        1,
        10_000,
      ),
      metricCatalog: object(
        value.suite?.metricCatalog,
        "benchmark suite metricCatalog",
        { optional: true },
      ),
    },
    algorithm: {
      stageLabel: text(
        value.algorithm?.stageLabel,
        "benchmark stage label",
        100,
        { optional: true },
      ),
      searchFamily: text(
        value.algorithm?.searchFamily ?? "unknown",
        "benchmark search family",
        100,
      ),
      sourceCommit,
      features,
      config: object(value.algorithm?.config, "benchmark algorithm config", {
        optional: true,
      }),
      notes: text(value.algorithm?.notes, "benchmark algorithm notes", 8_000, {
        optional: true,
      }),
    },
    run: {
      key: identifier(value.run?.key, "benchmark run key", 255),
      label: text(value.run?.label, "benchmark run label", 255),
      status,
      source: identifier(
        value.run?.source ?? "manual",
        "benchmark run source",
        50,
      ),
      sourceCommit,
      environment: object(value.run?.environment, "benchmark run environment", {
        optional: true,
      }),
      settings: object(value.run?.settings, "benchmark run settings", {
        optional: true,
      }),
      notes: text(value.run?.notes, "benchmark run notes", 8_000, {
        optional: true,
      }),
      startedAt,
      finishedAt,
    },
    cases: value.cases.map(validateCase),
    findings: (value.findings ?? []).map(validateFinding),
  };
};

const withTransaction = async (pool, operation) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const upsertBotVersion = async (connection, bot) => {
  await connection.execute(
    `INSERT INTO bots (bot_key, name, kind, description)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), kind = VALUES(kind), description = VALUES(description)`,
    [bot.id, bot.name, bot.kind, bot.description],
  );
  const [botRows] = await connection.execute(
    "SELECT id FROM bots WHERE bot_key = ?",
    [bot.id],
  );
  await connection.execute(
    `INSERT INTO bot_versions
      (bot_id, version_key, version_label, artifact_digest, policy_key, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE version_label = VALUES(version_label),
       artifact_digest = COALESCE(artifact_digest, VALUES(artifact_digest)),
       policy_key = IF(policy_key = 'legacy-unknown', VALUES(policy_key), policy_key)`,
    [
      botRows[0].id,
      bot.versionKey,
      bot.version,
      bot.artifactDigest,
      bot.policyKey,
      json({ depth: bot.depth }),
    ],
  );
  const [versionRows] = await connection.execute(
    `SELECT id, artifact_digest AS artifactDigest, policy_key AS policyKey
     FROM bot_versions WHERE bot_id = ? AND version_key = ?`,
    [botRows[0].id, bot.versionKey],
  );
  if (
    versionRows[0].artifactDigest !== bot.artifactDigest ||
    versionRows[0].policyKey !== bot.policyKey
  ) {
    throw new Error(
      "benchmark bot provenance conflicts with the existing version",
    );
  }
  const versionId = versionRows[0].id;
  await connection.execute(
    `INSERT INTO bot_ratings (bot_version_id)
     VALUES (?)
     ON DUPLICATE KEY UPDATE bot_version_id = VALUES(bot_version_id)`,
    [versionId],
  );
  return versionId;
};

const median = (values) => {
  const sorted = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (sorted.length === 0) {
    return 0;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const average = (values) => {
  const usable = values.map(Number).filter(Number.isFinite);
  return usable.length === 0
    ? 0
    : usable.reduce((sum, value) => sum + value, 0) / usable.length;
};

const round = (value, digits = 1) => Number(Number(value || 0).toFixed(digits));

const numeric = (value) =>
  value === null || value === undefined ? Number.NaN : Number(value);

const maximum = (values) => {
  const usable = values.map(Number).filter(Number.isFinite);
  return usable.length === 0 ? 0 : Math.max(...usable);
};

const componentDefinitions = [
  ["movegen", "Sinh nước", "movegenMs"],
  ["evaluation", "Lượng giá", "evalMs"],
  ["ordering", "Xếp nước", "orderingMs"],
  ["propagation", "Propagation", "propagationMs"],
  ["l_eq", "L_eq", "leqMs"],
];

const recommendationFor = (key) => {
  const recommendations = {
    movegen:
      "Profile pseudo-move generation và legal filtering; ưu tiên buffer tái sử dụng hoặc bảng hình học trước khi thêm cache.",
    evaluation:
      "Tách profile từng feature của evaluator và A/B với reference để tối ưu hot component mà không đổi score.",
    ordering:
      "Kiểm tra first-cutoff rate và cutoff rank theo workload; tuning TT/killer/history trước khi thêm heuristic mới.",
    propagation:
      "Đo số lần propagation và fixed-point iteration; đối chiếu LUT/reference trước mọi tối ưu rules hot path.",
    l_eq: "Xem lại trigger theo branching, depth và duplicate ratio; tránh bật grouping ở workload không giảm node.",
    other:
      "Bổ sung instrumentation cho phần thời gian chưa phân loại trước khi tối ưu.",
  };
  return recommendations[key] ?? recommendations.other;
};

const automaticDiagnostics = (version) => {
  if (version.case_count === 0) {
    return [
      {
        category: "coverage",
        severity: "info",
        title: "Chưa có benchmark chuẩn hóa",
        evidence: { case_count: 0 },
        recommendation:
          "Import ít nhất một suite có position thường, tactical, duplicate-hand và time-bound trước khi kết luận về version này.",
        source: "automatic",
      },
    ];
  }

  const diagnostics = [];
  const completionRate = version.completed_case_count / version.case_count;
  if (completionRate < 1) {
    diagnostics.push({
      category: "deadline",
      severity: completionRate < 0.8 ? "critical" : "warning",
      title: `${round((1 - completionRate) * 100)}% case chưa hoàn tất`,
      evidence: {
        completed: version.completed_case_count,
        total: version.case_count,
      },
      recommendation:
        "Khoanh vùng workload timeout, kiểm tra branching và giữ nguyên fallback từ depth hoàn tất gần nhất.",
      source: "automatic",
    });
  }

  const dominant = version.component_breakdown[0];
  if (dominant && dominant.share_percent >= 35) {
    diagnostics.push({
      category: dominant.key,
      severity: dominant.share_percent >= 55 ? "critical" : "warning",
      title: `${dominant.label} chiếm ${dominant.share_percent}% thời gian đo được`,
      evidence: {
        component: dominant.key,
        share_percent: dominant.share_percent,
        elapsed_ms: dominant.elapsed_ms,
      },
      recommendation: recommendationFor(dominant.key),
      source: "automatic",
    });
  }

  if (
    version.median_nodes >= 100_000 &&
    version.tt_hit_sample_count > 0 &&
    version.average_tt_hit_rate < 0.1
  ) {
    diagnostics.push({
      category: "transposition_table",
      severity: "warning",
      title: "TT hit thấp trên cây tìm kiếm lớn",
      evidence: {
        median_nodes: version.median_nodes,
        average_tt_hit_rate: version.average_tt_hit_rate,
      },
      recommendation:
        "Kiểm tra đầy đủ Zobrist key, replacement depth/age và ordering bằng TT move trước khi tăng kích thước bảng.",
      source: "automatic",
    });
  }

  if (
    version.branching_pair_sample_count > 0 &&
    version.average_branching >= 20 &&
    version.branching_reduction_percent < 5
  ) {
    diagnostics.push({
      category: "branching",
      severity: "warning",
      title: "Branching cao nhưng mức giảm successor thấp",
      evidence: {
        average_branching: version.average_branching,
        branching_reduction_percent: version.branching_reduction_percent,
      },
      recommendation:
        "Đo theo position để phân biệt vấn đề move ordering với thiếu successor equivalence; không bật L_eq always-on.",
      source: "automatic",
    });
  }
  return diagnostics.slice(0, 4);
};

const buildWorkloads = (cases) => {
  const workloads = new Map();
  for (const item of cases) {
    const key = `${item.positionKey}:${item.workloadClass}`;
    if (!workloads.has(key)) {
      workloads.set(key, {
        position_key: item.positionKey,
        workload_class: item.workloadClass,
        rows: [],
      });
    }
    workloads.get(key).rows.push(item);
  }
  return [...workloads.values()]
    .map((item) => ({
      position_key: item.position_key,
      workload_class: item.workload_class,
      case_count: item.rows.length,
      completed: item.rows.every((row) => row.completed && row.legalResult),
      max_depth: Math.max(0, ...item.rows.map((row) => row.depth)),
      median_nodes: Math.round(median(item.rows.map((row) => row.nodes))),
      median_elapsed_ms: round(median(item.rows.map((row) => row.elapsedMs))),
      median_nps: Math.round(median(item.rows.map((row) => row.nps))),
      average_tt_hit_rate: round(
        average(item.rows.map((row) => row.ttHitRate)) * 100,
      ),
    }))
    .sort(
      (left, right) =>
        right.median_elapsed_ms - left.median_elapsed_ms ||
        left.position_key.localeCompare(right.position_key),
    );
};

export const buildBenchmarkReport = (rows, findingRows = []) => {
  const versions = new Map();
  for (const row of rows) {
    const versionId = `${row.botKey}@${row.versionKey}`;
    if (!versions.has(versionId)) {
      versions.set(versionId, {
        version_id: versionId,
        database_id: String(row.versionDatabaseId),
        display_name: `${row.botName} · ${row.versionLabel}`,
        stage_label: row.stageLabel ?? row.versionLabel,
        search_family: row.searchFamily ?? "Chưa khai báo",
        source_commit: row.profileSourceCommit ?? null,
        algorithm_tags: parseJson(row.featuresJson, []),
        algorithm_config: parseJson(row.algorithmConfigJson, {}),
        runs: new Set(),
        suites: new Set(),
        latest_run_at: null,
        cases: [],
        color: reportColors[versions.size % reportColors.length],
      });
    }
    const version = versions.get(versionId);
    if (row.runId !== null && row.runId !== undefined) {
      version.runs.add(String(row.runId));
      version.suites.add(row.suiteKey);
      if (
        row.finishedAt &&
        (!version.latest_run_at ||
          new Date(row.finishedAt) > new Date(version.latest_run_at))
      ) {
        version.latest_run_at = new Date(row.finishedAt).toISOString();
      }
    }
    if (row.caseId !== null && row.caseId !== undefined) {
      version.cases.push({
        positionKey: row.positionKey,
        workloadClass: row.workloadClass,
        depth: Number(row.depth),
        completed: Boolean(row.completed),
        legalResult: Boolean(row.legalResult),
        nodes: numeric(row.nodes),
        elapsedMs: numeric(row.elapsedMs),
        nps: numeric(row.nps),
        ttHitRate: numeric(row.ttHitRate),
        averageBranching: numeric(row.averageBranching),
        reducedBranching: numeric(row.reducedBranching),
        evalMs: numeric(row.evalMs),
        movegenMs: numeric(row.movegenMs),
        orderingMs: numeric(row.orderingMs),
        propagationMs: numeric(row.propagationMs),
        leqMs: numeric(row.leqMs),
        peakRssMb: numeric(row.peakRssMb),
      });
    }
  }

  const findingsByVersion = new Map();
  for (const row of findingRows) {
    const versionId = `${row.botKey}@${row.versionKey}`;
    if (!findingsByVersion.has(versionId)) {
      findingsByVersion.set(versionId, []);
    }
    findingsByVersion.get(versionId).push({
      category: row.category,
      severity: row.severity,
      title: row.title,
      evidence: parseJson(row.evidenceJson, {}),
      recommendation: row.recommendation,
      source: "persisted",
    });
  }

  const reports = [...versions.values()].map((version) => {
    const completedCases = version.cases.filter(
      (item) => item.completed && item.legalResult,
    );
    const componentTotals = componentDefinitions.map(([key, label, field]) => ({
      key,
      label,
      elapsed_ms: version.cases.reduce(
        (sum, item) => sum + (Number.isFinite(item[field]) ? item[field] : 0),
        0,
      ),
    }));
    const measuredComponentMs = componentTotals.reduce(
      (sum, item) => sum + item.elapsed_ms,
      0,
    );
    const totalElapsedMs = version.cases.reduce(
      (sum, item) =>
        sum + (Number.isFinite(item.elapsedMs) ? item.elapsedMs : 0),
      0,
    );
    componentTotals.push({
      key: "other",
      label: "Khác/chưa đo",
      elapsed_ms: Math.max(0, totalElapsedMs - measuredComponentMs),
    });
    const componentDenominator = componentTotals.reduce(
      (sum, item) => sum + item.elapsed_ms,
      0,
    );
    const ttHitSamples = completedCases
      .map((item) => item.ttHitRate)
      .filter(Number.isFinite);
    const branchingPairs = completedCases.filter(
      (item) =>
        Number.isFinite(item.averageBranching) &&
        Number.isFinite(item.reducedBranching),
    );
    const averageBranching = average(
      branchingPairs.map((item) => item.averageBranching),
    );
    const reducedBranching = average(
      branchingPairs.map((item) => item.reducedBranching),
    );
    const report = {
      version_id: version.version_id,
      display_name: version.display_name,
      stage_label: version.stage_label,
      search_family: version.search_family,
      source_commit: version.source_commit,
      algorithm_tags: Array.isArray(version.algorithm_tags)
        ? version.algorithm_tags
        : [],
      algorithm_config: version.algorithm_config,
      data_quality:
        version.cases.length === 0
          ? "missing"
          : version.source_commit
            ? "verified"
            : "historical",
      suite_count: version.suites.size,
      run_count: version.runs.size,
      case_count: version.cases.length,
      completed_case_count: completedCases.length,
      latest_run_at: version.latest_run_at,
      median_nodes: Math.round(
        median(completedCases.map((item) => item.nodes)),
      ),
      median_elapsed_ms: round(
        median(completedCases.map((item) => item.elapsedMs)),
      ),
      median_nps: Math.round(median(completedCases.map((item) => item.nps))),
      max_completed_depth: Math.max(
        0,
        ...completedCases.map((item) => item.depth),
      ),
      peak_rss_mb: round(maximum(completedCases.map((item) => item.peakRssMb))),
      average_tt_hit_rate: round(average(ttHitSamples) * 100),
      tt_hit_sample_count: ttHitSamples.length,
      average_branching: round(averageBranching, 2),
      reduced_branching: round(reducedBranching, 2),
      branching_pair_sample_count: branchingPairs.length,
      branching_reduction_percent:
        averageBranching > 0
          ? round((1 - reducedBranching / averageBranching) * 100)
          : 0,
      component_breakdown: componentTotals
        .map((item) => ({
          key: item.key,
          label: item.label,
          elapsed_ms: round(item.elapsed_ms),
          share_percent:
            componentDenominator > 0
              ? round((item.elapsed_ms / componentDenominator) * 100)
              : 0,
        }))
        .filter((item) => item.elapsed_ms > 0)
        .sort((left, right) => right.elapsed_ms - left.elapsed_ms),
      workloads: buildWorkloads(version.cases),
      findings: [],
      color: version.color,
    };
    report.findings = [
      ...(findingsByVersion.get(version.version_id) ?? []),
      ...automaticDiagnostics(report),
    ].slice(0, 6);
    return report;
  });

  reports.sort(
    (left, right) =>
      Number(right.data_quality !== "missing") -
        Number(left.data_quality !== "missing") ||
      right.median_nps - left.median_nps ||
      left.version_id.localeCompare(right.version_id),
  );

  const latestRun = reports
    .map((item) => item.latest_run_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  return {
    generated_at_utc: new Date().toISOString(),
    summary: {
      total_versions: reports.length,
      benchmarked_versions: reports.filter((item) => item.case_count > 0)
        .length,
      total_runs: reports.reduce((sum, item) => sum + item.run_count, 0),
      total_cases: reports.reduce((sum, item) => sum + item.case_count, 0),
      latest_run_at: latestRun ?? null,
    },
    versions: reports,
  };
};

export const emptyBenchmarkReport = () => ({
  generated_at_utc: new Date().toISOString(),
  summary: {
    total_versions: 0,
    benchmarked_versions: 0,
    total_runs: 0,
    total_cases: 0,
    latest_run_at: null,
  },
  versions: [],
});

export class BenchmarkRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async recordRun(rawBundle) {
    const bundle = validateBenchmarkBundle(rawBundle);
    return withTransaction(this.pool, async (connection) => {
      const botVersionId = await upsertBotVersion(connection, bundle.bot);
      await connection.execute(
        `INSERT INTO benchmark_suites
          (suite_key, name, description, schema_version, metric_catalog_json)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description),
           suite_key = VALUES(suite_key)`,
        [
          bundle.suite.key,
          bundle.suite.name,
          bundle.suite.description,
          bundle.suite.schemaVersion,
          json(bundle.suite.metricCatalog),
        ],
      );
      const [suiteRows] = await connection.execute(
        `SELECT id, schema_version AS schemaVersion,
                metric_catalog_json AS metricCatalogJson
         FROM benchmark_suites WHERE suite_key = ?`,
        [bundle.suite.key],
      );
      if (
        Number(suiteRows[0].schemaVersion) !== bundle.suite.schemaVersion ||
        !sameJson(suiteRows[0].metricCatalogJson, bundle.suite.metricCatalog)
      ) {
        throw new Error(
          "benchmark suite contract conflicts with the existing suite key",
        );
      }
      const suiteId = suiteRows[0].id;

      await connection.execute(
        `INSERT INTO bot_version_algorithm_profiles
          (bot_version_id, stage_label, search_family, source_commit,
           features_json, config_json, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE bot_version_id = VALUES(bot_version_id)`,
        [
          botVersionId,
          bundle.algorithm.stageLabel,
          bundle.algorithm.searchFamily,
          bundle.algorithm.sourceCommit,
          json(bundle.algorithm.features),
          json(bundle.algorithm.config),
          bundle.algorithm.notes,
        ],
      );
      const [profileRows] = await connection.execute(
        `SELECT stage_label AS stageLabel, search_family AS searchFamily,
                source_commit AS sourceCommit, features_json AS featuresJson,
                config_json AS configJson, notes
         FROM bot_version_algorithm_profiles WHERE bot_version_id = ?`,
        [botVersionId],
      );
      const existingProfile = profileRows[0];
      if (
        existingProfile.stageLabel !== bundle.algorithm.stageLabel ||
        existingProfile.searchFamily !== bundle.algorithm.searchFamily ||
        existingProfile.sourceCommit !== bundle.algorithm.sourceCommit ||
        existingProfile.notes !== bundle.algorithm.notes ||
        !sameJson(existingProfile.featuresJson, bundle.algorithm.features) ||
        !sameJson(existingProfile.configJson, bundle.algorithm.config)
      ) {
        throw new Error(
          "benchmark algorithm profile conflicts with the existing bot version",
        );
      }

      const [existingRows] = await connection.execute(
        `SELECT public_id AS id FROM benchmark_runs
         WHERE bot_version_id = ? AND suite_id = ? AND run_key = ?`,
        [botVersionId, suiteId, bundle.run.key],
      );
      if (existingRows.length > 0) {
        return { id: existingRows[0].id, created: false };
      }

      const publicId = randomUUID();
      const [runResult] = await connection.execute(
        `INSERT INTO benchmark_runs
          (public_id, bot_version_id, suite_id, run_key, run_label, status, source,
           source_commit, environment_json, settings_json, notes, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          publicId,
          botVersionId,
          suiteId,
          bundle.run.key,
          bundle.run.label,
          bundle.run.status,
          bundle.run.source,
          bundle.run.sourceCommit,
          json(bundle.run.environment),
          json(bundle.run.settings),
          bundle.run.notes,
          bundle.run.startedAt,
          bundle.run.finishedAt,
        ],
      );
      const runId = runResult.insertId;

      for (const item of bundle.cases) {
        await connection.execute(
          `INSERT INTO benchmark_cases
            (run_id, position_key, workload_class, depth, time_limit_ms, repeat_index,
             completed, legal_result, best_move, score, nodes, elapsed_ms, nps, tt_hit_rate,
             average_branching, reduced_branching, eval_ms, movegen_ms, ordering_ms,
             propagation_ms, leq_ms, peak_rss_mb, metrics_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            runId,
            item.positionKey,
            item.workloadClass,
            item.depth,
            item.timeLimitMs,
            item.repeatIndex,
            item.completed,
            item.legalResult,
            item.bestMove,
            item.score,
            item.nodes,
            item.elapsedMs,
            item.nps,
            item.ttHitRate,
            item.averageBranching,
            item.reducedBranching,
            item.evalMs,
            item.movegenMs,
            item.orderingMs,
            item.propagationMs,
            item.leqMs,
            item.peakRssMb,
            json(item.metrics),
          ],
        );
      }

      for (const finding of bundle.findings) {
        await connection.execute(
          `INSERT INTO benchmark_findings
            (run_id, category, severity, title, evidence_json, recommendation)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            runId,
            finding.category,
            finding.severity,
            finding.title,
            json(finding.evidence),
            finding.recommendation,
          ],
        );
      }
      return { id: publicId, created: true };
    });
  }

  async reportData() {
    const [rows] = await this.pool.query(`
      SELECT bot_versions.id AS versionDatabaseId,
             bot_versions.version_key AS versionKey,
             bot_versions.version_label AS versionLabel,
             bots.bot_key AS botKey, bots.name AS botName,
             profiles.stage_label AS stageLabel,
             profiles.search_family AS searchFamily,
             profiles.source_commit AS profileSourceCommit,
             profiles.features_json AS featuresJson,
             profiles.config_json AS algorithmConfigJson,
             runs.id AS runId, runs.finished_at AS finishedAt,
             suites.suite_key AS suiteKey,
             cases.id AS caseId, cases.position_key AS positionKey,
             cases.workload_class AS workloadClass, cases.depth,
             cases.completed, cases.legal_result AS legalResult,
             cases.nodes, cases.elapsed_ms AS elapsedMs, cases.nps,
             cases.tt_hit_rate AS ttHitRate,
             cases.average_branching AS averageBranching,
             cases.reduced_branching AS reducedBranching,
             cases.eval_ms AS evalMs, cases.movegen_ms AS movegenMs,
             cases.ordering_ms AS orderingMs,
             cases.propagation_ms AS propagationMs, cases.leq_ms AS leqMs,
             cases.peak_rss_mb AS peakRssMb
      FROM bot_versions
      JOIN bots ON bots.id = bot_versions.bot_id
      LEFT JOIN bot_version_algorithm_profiles AS profiles
        ON profiles.bot_version_id = bot_versions.id
      LEFT JOIN benchmark_runs AS runs
        ON runs.bot_version_id = bot_versions.id
      LEFT JOIN benchmark_suites AS suites ON suites.id = runs.suite_id
      LEFT JOIN benchmark_cases AS cases ON cases.run_id = runs.id
      ORDER BY bots.bot_key, bot_versions.created_at, runs.finished_at, cases.id
    `);
    const [findingRows] = await this.pool.query(`
      SELECT botKey, versionKey, category, severity, title,
             evidenceJson, recommendation
      FROM (
        SELECT bots.bot_key AS botKey, bot_versions.version_key AS versionKey,
               findings.category, findings.severity, findings.title,
               findings.evidence_json AS evidenceJson, findings.recommendation,
               findings.created_at AS findingCreatedAt, findings.id AS findingId,
               ROW_NUMBER() OVER (
                 PARTITION BY bot_versions.id
                 ORDER BY findings.created_at DESC, findings.id DESC
               ) AS versionFindingRank
        FROM benchmark_findings AS findings
        JOIN benchmark_runs AS runs ON runs.id = findings.run_id
        JOIN bot_versions ON bot_versions.id = runs.bot_version_id
        JOIN bots ON bots.id = bot_versions.bot_id
        WHERE findings.status = 'open'
      ) AS rankedFindings
      WHERE versionFindingRank <= 6
      ORDER BY findingCreatedAt DESC, findingId DESC
    `);
    return buildBenchmarkReport(rows, findingRows);
  }
}
