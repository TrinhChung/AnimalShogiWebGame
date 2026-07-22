<script setup lang="ts">
import { computed, ref } from "vue";
import {
  getVersion,
  reportSeed,
  type MatchReport,
  type TerminalType,
} from "@/reports/reportData";

type ResultFilter = "all" | "decisive" | "draw";
type TerminalFilter = "all" | TerminalType;

const searchQuery = ref("");
const selectedVersion = ref("all");
const selectedResult = ref<ResultFilter>("all");
const selectedTerminal = ref<TerminalFilter>("all");

const filteredMatches = computed(() => {
  const normalizedQuery = searchQuery.value.trim().toLocaleLowerCase("vi");

  return reportSeed.games.filter((match) => {
    const matchesVersion =
      selectedVersion.value === "all" ||
      match.engine_first === selectedVersion.value ||
      match.engine_second === selectedVersion.value;
    const matchesResult =
      selectedResult.value === "all" ||
      (selectedResult.value === "draw"
        ? match.winner === null
        : match.winner !== null);
    const matchesTerminal =
      selectedTerminal.value === "all" ||
      match.terminal_type === selectedTerminal.value;
    const searchableText = [
      match.game_id,
      match.run_id,
      getVersion(match.engine_first).display_name,
      getVersion(match.engine_second).display_name,
      match.opening_id,
    ]
      .join(" ")
      .toLocaleLowerCase("vi");

    return (
      matchesVersion &&
      matchesResult &&
      matchesTerminal &&
      searchableText.includes(normalizedQuery)
    );
  });
});

const formatDate = (value: string): { date: string; time: string } => {
  const date = new Date(value);
  return {
    date: new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date),
    time: new Intl.DateTimeFormat("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date),
  };
};

const formatDuration = (milliseconds: number): string => {
  const seconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

const resultLabel = (match: MatchReport): string =>
  match.winner ? `${getVersion(match.winner).display_name} thắng` : "Hòa";

const terminalLabels: Record<TerminalType, string> = {
  catch: "Bắt Sư Tử",
  try: "Try",
  draw: "Hòa giới hạn",
};

const clearFilters = () => {
  searchQuery.value = "";
  selectedVersion.value = "all";
  selectedResult.value = "all";
  selectedTerminal.value = "all";
};
</script>

<template>
  <main class="history-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">Match archive</p>
        <h1>Lịch sử trận đấu</h1>
        <p>Tra cứu kết quả, thời lượng và run ID của từng lần đánh giá bot.</p>
      </div>
      <div class="archive-state">
        <span
          ><i></i
          >{{
            reportSeed.is_seed_data ? "Seed dự phòng" : "MySQL đã đồng bộ"
          }}</span
        >
        <small>{{ reportSeed.games.length }} bản ghi</small>
      </div>
    </header>

    <section class="history-summary" aria-label="Tóm tắt lịch sử">
      <div>
        <span>Trận đã lưu</span>
        <strong>{{ reportSeed.summary.total_games }}</strong>
      </div>
      <div>
        <span>Trận quyết định</span>
        <strong>{{
          reportSeed.games.filter((match) => match.winner).length
        }}</strong>
        <small>trong dữ liệu hiển thị</small>
      </div>
      <div>
        <span>Trận hòa</span>
        <strong>{{
          reportSeed.games.filter((match) => !match.winner).length
        }}</strong>
        <small>trong dữ liệu hiển thị</small>
      </div>
      <div>
        <span>Schema report</span>
        <strong>v{{ reportSeed.schema_version }}</strong>
        <small>{{
          reportSeed.is_seed_data ? "nguồn dữ liệu mẫu" : "nguồn MySQL 8"
        }}</small>
      </div>
    </section>

    <section class="history-surface">
      <div class="toolbar">
        <label class="search-field">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m16 16 4 4" />
          </svg>
          <span class="sr-only">Tìm kiếm trận đấu</span>
          <input
            v-model="searchQuery"
            type="search"
            placeholder="Tìm game ID, run ID, phiên bản…"
          />
        </label>
        <label>
          <span>Phiên bản</span>
          <select v-model="selectedVersion">
            <option value="all">Tất cả phiên bản</option>
            <option
              v-for="version in reportSeed.versions"
              :key="version.version_id"
              :value="version.version_id"
            >
              {{ version.display_name }}
            </option>
          </select>
        </label>
        <label>
          <span>Kết quả</span>
          <select v-model="selectedResult">
            <option value="all">Tất cả kết quả</option>
            <option value="decisive">Có thắng / thua</option>
            <option value="draw">Hòa</option>
          </select>
        </label>
        <label>
          <span>Kết thúc bởi</span>
          <select v-model="selectedTerminal">
            <option value="all">Mọi điều kiện</option>
            <option value="catch">Bắt Sư Tử</option>
            <option value="try">Try</option>
            <option value="draw">Hòa giới hạn</option>
          </select>
        </label>
        <button class="clear-button" type="button" @click="clearFilters">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 4v6h6M20 20v-6h-6M5.5 15a8 8 0 0 0 13-3M18.5 9a8 8 0 0 0-13-3"
            />
          </svg>
          Đặt lại
        </button>
      </div>

      <div class="table-summary">
        <span
          >Hiển thị <strong>{{ filteredMatches.length }}</strong> /
          {{ reportSeed.games.length }} bản ghi</span
        >
        <span class="sql-note"
          ><i></i
          >{{
            reportSeed.is_seed_data
              ? "Đang dùng seed dự phòng"
              : "Dữ liệu đọc trực tiếp từ MySQL"
          }}</span
        >
      </div>

      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Đối đầu</th>
              <th>Kết quả</th>
              <th>Thống kê</th>
              <th>Kết thúc</th>
              <th>Run ID</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="match in filteredMatches" :key="match.game_id">
              <td data-label="Thời gian">
                <span class="date-cell"
                  ><strong>{{ formatDate(match.played_at_utc).date }}</strong
                  ><small>{{
                    formatDate(match.played_at_utc).time
                  }}</small></span
                >
              </td>
              <td data-label="Đối đầu">
                <span class="versus-cell">
                  <span class="bot-chip first">{{
                    getVersion(match.engine_first).display_name.charAt(0)
                  }}</span>
                  <span>
                    <strong>{{
                      getVersion(match.engine_first).display_name
                    }}</strong>
                    <small
                      >vs
                      {{ getVersion(match.engine_second).display_name }}</small
                    >
                  </span>
                </span>
              </td>
              <td data-label="Kết quả">
                <span
                  class="result-pill"
                  :class="match.winner ? 'win' : 'draw'"
                >
                  <i></i>{{ resultLabel(match) }}
                </span>
              </td>
              <td data-label="Thống kê">
                <span class="numbers-cell">
                  <strong>{{ match.total_actions }} nước</strong>
                  <small
                    >{{ formatDuration(match.wall_time_ms) }} ·
                    {{ match.opening_id }}</small
                  >
                </span>
              </td>
              <td data-label="Kết thúc">
                <span class="terminal-tag" :class="match.terminal_type">
                  {{ terminalLabels[match.terminal_type] }}
                </span>
              </td>
              <td data-label="Run ID">
                <span class="run-cell"
                  ><code>{{ match.run_id }}</code
                  ><small>{{ match.game_id }}</small></span
                >
              </td>
            </tr>
            <tr v-if="filteredMatches.length === 0">
              <td colspan="6" class="empty-state">
                <span>Không có trận đấu phù hợp với bộ lọc hiện tại.</span>
                <button type="button" @click="clearFilters">Xóa bộ lọc</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>
</template>

<style scoped>
.history-page {
  margin: 0 auto;
  max-width: 1520px;
  padding: 34px 38px 48px;
  width: 100%;
}

.page-header {
  align-items: center;
  display: flex;
  gap: 24px;
  justify-content: space-between;
  margin-bottom: 26px;
}

.eyebrow {
  color: #c78b38;
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0.17em;
  margin: 0 0 7px;
  text-transform: uppercase;
}

h1 {
  color: #17211e;
  font-size: clamp(28px, 3vw, 42px);
  font-weight: 780;
  letter-spacing: -0.04em;
  line-height: 1.1;
  margin: 0 0 8px;
}

.page-header p:last-child {
  color: #74807c;
  font-size: 13px;
  margin: 0;
}

.archive-state {
  align-items: flex-end;
  display: grid;
  flex: 0 0 auto;
  gap: 5px;
  justify-items: end;
}

.archive-state span {
  align-items: center;
  background: #edf5f1;
  border: 1px solid #dbe9e2;
  border-radius: 999px;
  color: #47735f;
  display: flex;
  font-size: 10px;
  font-weight: 800;
  gap: 7px;
  padding: 8px 12px;
  text-transform: uppercase;
}

.archive-state i,
.sql-note i {
  background: #58aa82;
  border-radius: 50%;
  height: 6px;
  width: 6px;
}

.archive-state small {
  color: #9aa4a0;
  font-size: 9px;
}

.history-summary {
  display: grid;
  gap: 1px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-bottom: 16px;
  overflow: hidden;
}

.history-summary > div {
  background: #16231f;
  display: grid;
  gap: 2px;
  min-height: 92px;
  padding: 18px 21px;
}

.history-summary > div:first-child {
  border-radius: 14px 0 0 14px;
}

.history-summary > div:last-child {
  border-radius: 0 14px 14px 0;
}

.history-summary span,
.history-summary small {
  color: #74857f;
  font-size: 9px;
  font-weight: 700;
}

.history-summary strong {
  color: #f7f9f8;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 24px;
}

.history-surface {
  background: #ffffff;
  border: 1px solid #e1e6e3;
  border-radius: 15px;
  box-shadow: 0 10px 28px rgba(34, 49, 43, 0.04);
  overflow: hidden;
}

.toolbar {
  align-items: end;
  display: grid;
  gap: 11px;
  grid-template-columns:
    minmax(220px, 1.25fr) repeat(3, minmax(130px, 0.7fr))
    auto;
  padding: 18px 20px;
}

.toolbar label {
  display: grid;
  gap: 6px;
  min-width: 0;
  position: relative;
}

.toolbar label > span:not(.sr-only) {
  color: #8b9692;
  font-size: 9px;
  font-weight: 800;
}

.toolbar input,
.toolbar select,
.clear-button {
  background: #fafbf9;
  border: 1px solid #dfe5e1;
  border-radius: 9px;
  color: #3b4743;
  font: inherit;
  font-size: 10px;
  min-height: 39px;
  outline: none;
  padding: 8px 10px;
  width: 100%;
}

.toolbar input:focus,
.toolbar select:focus {
  border-color: #d1a35c;
  box-shadow: 0 0 0 3px rgba(209, 163, 92, 0.12);
}

.search-field input {
  padding-left: 36px;
}

.search-field svg {
  fill: none;
  height: 16px;
  left: 12px;
  position: absolute;
  stroke: #899590;
  stroke-linecap: round;
  stroke-width: 1.7;
  top: 12px;
  width: 16px;
}

.clear-button {
  align-items: center;
  cursor: pointer;
  display: flex;
  font-weight: 800;
  gap: 6px;
  padding-inline: 13px;
  width: auto;
}

.clear-button svg {
  fill: none;
  height: 14px;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
  width: 14px;
}

.table-summary {
  align-items: center;
  background: #f8faf8;
  border-bottom: 1px solid #e7ebe8;
  border-top: 1px solid #e7ebe8;
  color: #89938f;
  display: flex;
  font-size: 9px;
  justify-content: space-between;
  padding: 10px 20px;
}

.table-summary strong {
  color: #485550;
}

.sql-note {
  align-items: center;
  display: flex;
  gap: 6px;
}

.table-scroll {
  overflow-x: auto;
}

table {
  border-collapse: collapse;
  min-width: 1020px;
  width: 100%;
}

th {
  color: #8e9894;
  font-size: 8px;
  font-weight: 850;
  letter-spacing: 0.08em;
  padding: 12px 16px;
  text-align: left;
  text-transform: uppercase;
}

td {
  border-top: 1px solid #eff2f0;
  padding: 13px 16px;
}

tbody tr {
  transition: background-color 140ms ease;
}

tbody tr:hover {
  background: #fbfcfb;
}

.date-cell,
.versus-cell > span:last-child,
.numbers-cell,
.run-cell {
  display: grid;
  min-width: 0;
}

.date-cell strong,
.numbers-cell strong,
.versus-cell strong {
  color: #394540;
  font-size: 10px;
}

.date-cell small,
.numbers-cell small,
.versus-cell small,
.run-cell small {
  color: #99a39f;
  font-size: 8px;
  margin-top: 3px;
}

.versus-cell {
  align-items: center;
  display: flex;
  gap: 9px;
}

.bot-chip {
  background: #e9f1ed;
  border-radius: 8px;
  color: #47675a;
  display: grid;
  flex: 0 0 auto;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 11px;
  font-weight: 800;
  height: 30px;
  place-items: center;
  width: 30px;
}

.result-pill,
.terminal-tag {
  align-items: center;
  border-radius: 999px;
  display: inline-flex;
  font-size: 8px;
  font-weight: 800;
  padding: 6px 8px;
  white-space: nowrap;
}

.result-pill {
  gap: 6px;
}

.result-pill i {
  background: currentColor;
  border-radius: 50%;
  height: 5px;
  width: 5px;
}

.result-pill.win {
  background: #e9f6ef;
  color: #438b69;
}

.result-pill.draw {
  background: #f0f2f1;
  color: #737e7a;
}

.terminal-tag.catch {
  background: #fff4e3;
  color: #aa7326;
}

.terminal-tag.try {
  background: #f1eefb;
  color: #7763ad;
}

.terminal-tag.draw {
  background: #eef3f8;
  color: #617d98;
}

.run-cell {
  max-width: 255px;
}

.run-cell code {
  color: #63706b;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-state {
  padding: 58px 20px;
  text-align: center;
}

.empty-state span {
  color: #7f8a86;
  font-size: 11px;
}

.empty-state button {
  background: transparent;
  border: 0;
  color: #a26d28;
  cursor: pointer;
  font-size: 10px;
  font-weight: 800;
  margin-left: 8px;
}

.sr-only {
  height: 1px;
  margin: -1px;
  overflow: hidden;
  padding: 0;
  position: absolute;
  width: 1px;
}

@media (max-width: 1180px) {
  .toolbar {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .search-field {
    grid-column: span 2;
  }
}

@media (max-width: 780px) {
  .history-page {
    padding: 25px 18px 38px;
  }

  .page-header {
    align-items: flex-start;
  }

  .history-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .history-summary > div:first-child,
  .history-summary > div:last-child {
    border-radius: 0;
  }

  .history-summary > div:first-child {
    border-radius: 14px 0 0 0;
  }

  .history-summary > div:nth-child(2) {
    border-radius: 0 14px 0 0;
  }

  .history-summary > div:nth-child(3) {
    border-radius: 0 0 0 14px;
  }

  .history-summary > div:last-child {
    border-radius: 0 0 14px 0;
  }

  .toolbar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .search-field {
    grid-column: 1 / -1;
  }

  .table-summary {
    align-items: flex-start;
    display: grid;
    gap: 5px;
  }
}

@media (max-width: 520px) {
  .page-header {
    display: grid;
  }

  .archive-state {
    justify-items: start;
  }

  .toolbar {
    grid-template-columns: 1fr;
  }

  .search-field {
    grid-column: auto;
  }

  .history-summary > div {
    padding: 15px;
  }
}
</style>
