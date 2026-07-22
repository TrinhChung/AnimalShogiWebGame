import { reactive } from "vue";

import reportSeedJson from "./reportSeed.json";

export type VersionStatus = "champion" | "stable" | "legacy" | "baseline";
export type CandidateResult = "win" | "draw" | "loss";
export type TerminalType = "catch" | "try" | "draw";

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

export type ReportData = {
  schema_version: 1;
  is_seed_data: boolean;
  generated_at_utc: string;
  summary: ReportSummary;
  versions: VersionReport[];
  games: MatchReport[];
};

export const reportSeed = reactive(reportSeedJson as ReportData);
export const reportLoadState = reactive({
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
      const data = (await response.json()) as ReportData & { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      Object.assign(reportSeed, data);
      reportLoadState.source = "mysql";
      reportLoadState.error = "";
    } catch (error) {
      reportLoadState.source = "seed";
      reportLoadState.error =
        error instanceof Error ? error.message : "Không thể tải báo cáo MySQL.";
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
