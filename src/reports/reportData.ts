import { reactive } from "vue";

import reportSeedJson from "./reportSeed.json";

export type VersionStatus = "champion" | "stable" | "legacy" | "baseline";
export type CandidateResult = "win" | "draw" | "loss";
export type TerminalType = "catch" | "try" | "draw";
export type BenchmarkDataQuality = "verified" | "historical" | "missing";
export type FindingSeverity = "info" | "warning" | "critical";

export type ReportSummary = {
  total_games: number;
  total_versions: number;
  leader_version_id: string;
  leader_win_rate: number;
  average_actions: number;
};

export type VersionReport = {
  version_id: string;
  display_name: string;
  status: VersionStatus;
  elo: number;
  elo_delta: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  average_move_time_ms: number;
  average_actions: number;
  color: string;
  elo_trend: number[];
};

export type MatchReport = {
  game_id: string;
  run_id: string;
  played_at_utc: string;
  candidate_version: string;
  opponent_version: string;
  engine_first: string;
  engine_second: string;
  candidate_result: CandidateResult;
  winner: string | null;
  terminal_type: TerminalType;
  total_actions: number;
  wall_time_ms: number;
  opening_id: string;
  complete: boolean;
};

export type BenchmarkComponent = {
  key: string;
  label: string;
  elapsed_ms: number;
  share_percent: number;
};

export type BenchmarkFinding = {
  category: string;
  severity: FindingSeverity;
  title: string;
  evidence: Record<string, unknown>;
  recommendation: string;
  source: "persisted" | "automatic";
};

export type BenchmarkWorkload = {
  position_key: string;
  workload_class: string;
  case_count: number;
  completed: boolean;
  max_depth: number;
  median_nodes: number;
  median_elapsed_ms: number;
  median_nps: number;
  average_tt_hit_rate: number;
};

export type VersionBenchmarkReport = {
  version_id: string;
  display_name: string;
  stage_label: string;
  search_family: string;
  source_commit: string | null;
  algorithm_tags: string[];
  algorithm_config: Record<string, unknown>;
  data_quality: BenchmarkDataQuality;
  suite_count: number;
  run_count: number;
  case_count: number;
  completed_case_count: number;
  latest_run_at: string | null;
  median_nodes: number;
  median_elapsed_ms: number;
  median_nps: number;
  max_completed_depth: number;
  peak_rss_mb: number;
  average_tt_hit_rate: number;
  tt_hit_sample_count: number;
  average_branching: number;
  reduced_branching: number;
  branching_pair_sample_count: number;
  branching_reduction_percent: number;
  component_breakdown: BenchmarkComponent[];
  workloads: BenchmarkWorkload[];
  findings: BenchmarkFinding[];
  color: string;
};

export type BenchmarkReport = {
  generated_at_utc: string;
  summary: {
    total_versions: number;
    benchmarked_versions: number;
    total_runs: number;
    total_cases: number;
    latest_run_at: string | null;
  };
  versions: VersionBenchmarkReport[];
};

export type ReportData = {
  schema_version: 1;
  is_seed_data: boolean;
  generated_at_utc: string;
  summary: ReportSummary;
  versions: VersionReport[];
  games: MatchReport[];
  benchmarks: BenchmarkReport;
};

export const reportSeed = reactive(reportSeedJson as ReportData);
export const reportLoadState = reactive({
  source: "seed" as "seed" | "mysql",
  error: "",
});
export const benchmarkLoadState = reactive({
  source: "seed" as "seed" | "mysql",
  error: "",
});

const emptyVersion: VersionReport = {
  version_id: "unavailable",
  display_name: "Chưa có dữ liệu",
  status: "baseline",
  elo: 1500,
  elo_delta: 0,
  games: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  average_move_time_ms: 0,
  average_actions: 0,
  color: "#9aa4a0",
  elo_trend: [1500, 1500, 1500, 1500, 1500, 1500],
};

let loadPromise: Promise<void> | null = null;

export const loadReportData = async (): Promise<void> => {
  if (loadPromise) {
    return loadPromise;
  }
  loadPromise = (async () => {
    try {
      const response = await fetch("/api/report", { cache: "no-store" });
      const data = (await response.json()) as Partial<ReportData> & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      const hasBenchmarkData = Boolean(
        data.benchmarks && Array.isArray(data.benchmarks.versions),
      );
      Object.assign(reportSeed, data);
      reportLoadState.source = "mysql";
      reportLoadState.error = "";
      benchmarkLoadState.source = hasBenchmarkData ? "mysql" : "seed";
      benchmarkLoadState.error = hasBenchmarkData
        ? ""
        : "API hiện tại chưa trả benchmark data; đang dùng seed tham khảo.";
    } catch (error) {
      reportLoadState.source = "seed";
      reportLoadState.error =
        error instanceof Error ? error.message : "Không thể tải báo cáo MySQL.";
      benchmarkLoadState.source = "seed";
      benchmarkLoadState.error = reportLoadState.error;
    }
  })();
  return loadPromise;
};

export const getVersion = (versionId: string): VersionReport =>
  reportSeed.versions.find((version) => version.version_id === versionId) ??
  reportSeed.versions[0] ??
  emptyVersion;

export const getWinRate = (version: VersionReport): number =>
  version.games === 0 ? 0 : (version.wins / version.games) * 100;
