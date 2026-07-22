<script setup lang="ts">
import { computed } from "vue";
import {
  getVersion,
  getWinRate,
  reportSeed,
  type MatchReport,
  type VersionReport,
} from "@/reports/reportData";

const statusLabels: Record<VersionReport["status"], string> = {
  champion: "Đương kim",
  stable: "Ổn định",
  legacy: "Kế thừa",
  baseline: "Đối chứng",
};

const leader = computed(() => getVersion(reportSeed.summary.leader_version_id));
const recentMatches = computed(() => reportSeed.games.slice(0, 5));
const chartLabels = computed(() =>
  Array.from({ length: 6 }, (_, index) => {
    const date = new Date(reportSeed.generated_at_utc);
    date.setDate(date.getDate() - (5 - index) * 7);
    return new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
    }).format(date);
  }),
);

const trendPoints = (values: number[]): string => {
  const minimumElo = 1320;
  const maximumElo = 1680;
  const chartWidth = 628;
  const chartHeight = 182;

  return values
    .map((value, index) => {
      const x = 52 + (index / (values.length - 1)) * chartWidth;
      const y =
        18 + ((maximumElo - value) / (maximumElo - minimumElo)) * chartHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
};

const formatMatchDate = (value: string): string =>
  new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const getMatchOutcome = (match: MatchReport): string => {
  if (!match.winner) {
    return "Hòa";
  }

  return getVersion(match.winner).display_name;
};
</script>

<template>
  <main class="analytics-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">Report center</p>
        <h1>Hiệu suất bot qua từng phiên bản</h1>
        <p class="page-description">
          Theo dõi sức mạnh, tốc độ và kết quả đối đầu để lựa chọn phiên bản ổn
          định nhất.
        </p>
      </div>
      <div class="header-actions">
        <span class="seed-badge">
          <i></i
          >{{ reportSeed.is_seed_data ? "Dữ liệu seed" : "MySQL trực tiếp" }}
        </span>
        <label class="period-filter">
          <span class="sr-only">Khoảng thời gian</span>
          <select aria-label="Khoảng thời gian">
            <option>Toàn bộ lịch sử</option>
            <option>30 ngày gần nhất</option>
            <option>7 ngày gần nhất</option>
          </select>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M8 2v3m8-3v3M4 9h16M5 4h14a1 1 0 0 1 1 1v15H4V5a1 1 0 0 1 1-1Z"
            />
          </svg>
        </label>
      </div>
    </header>

    <section class="metric-grid" aria-label="Chỉ số tổng quan">
      <article class="metric-card">
        <div class="metric-icon amber">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 4h8l1 3h3v13H4V7h3l1-3Zm0 8h8M9 9v6m6-6v6" />
          </svg>
        </div>
        <div>
          <span>Tổng số trận</span>
          <strong>{{ reportSeed.summary.total_games }}</strong>
          <small>{{
            reportSeed.is_seed_data ? "Dữ liệu mẫu" : "Đã lưu trong MySQL"
          }}</small>
        </div>
      </article>
      <article class="metric-card">
        <div class="metric-icon green">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m4 15 5-5 4 4 7-8m-5 0h5v5" />
          </svg>
        </div>
        <div>
          <span>Tỉ lệ thắng cao nhất</span>
          <strong>{{ reportSeed.summary.leader_win_rate }}%</strong>
          <small
            ><b>{{ leader.display_name }}</b> đang dẫn đầu</small
          >
        </div>
      </article>
      <article class="metric-card">
        <div class="metric-icon blue">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 17V7l8-4 8 4v10l-8 4-8-4Zm0-10 8 4 8-4m-8 4v10" />
          </svg>
        </div>
        <div>
          <span>Phiên bản theo dõi</span>
          <strong>{{ reportSeed.summary.total_versions }}</strong>
          <small>Phân hạng theo Elo từ lịch sử</small>
        </div>
      </article>
      <article class="metric-card">
        <div class="metric-icon violet">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        </div>
        <div>
          <span>Số nước trung bình</span>
          <strong>{{ reportSeed.summary.average_actions }}</strong>
          <small>Trên mỗi trận hoàn tất</small>
        </div>
      </article>
    </section>

    <section class="analysis-grid">
      <article class="surface trend-card">
        <div class="section-heading">
          <div>
            <p class="section-kicker">Xếp hạng sức mạnh</p>
            <h2>Diễn biến Elo</h2>
          </div>
          <div class="chart-legend">
            <span
              v-for="version in reportSeed.versions"
              :key="version.version_id"
            >
              <i :style="{ background: version.color }"></i
              >{{ version.display_name }}
            </span>
          </div>
        </div>

        <div class="chart-wrap">
          <svg
            class="elo-chart"
            viewBox="0 0 720 242"
            role="img"
            aria-label="Biểu đồ diễn biến Elo"
          >
            <g class="grid-lines">
              <line x1="52" x2="680" y1="18" y2="18" />
              <line x1="52" x2="680" y1="78.7" y2="78.7" />
              <line x1="52" x2="680" y1="139.3" y2="139.3" />
              <line x1="52" x2="680" y1="200" y2="200" />
            </g>
            <g class="axis-labels">
              <text x="7" y="22">1.680</text>
              <text x="7" y="82">1.560</text>
              <text x="7" y="143">1.440</text>
              <text x="7" y="204">1.320</text>
              <text
                v-for="(label, index) in chartLabels"
                :key="label"
                :x="52 + (index / (chartLabels.length - 1)) * 628"
                y="231"
                text-anchor="middle"
              >
                {{ label }}
              </text>
            </g>
            <g v-for="version in reportSeed.versions" :key="version.version_id">
              <polyline
                class="trend-line-shadow"
                :points="trendPoints(version.elo_trend)"
                :stroke="version.color"
              />
              <polyline
                class="trend-line"
                :points="trendPoints(version.elo_trend)"
                :stroke="version.color"
              />
              <circle
                v-for="point in trendPoints(version.elo_trend).split(' ')"
                :key="point"
                :cx="point.split(',')[0]"
                :cy="point.split(',')[1]"
                r="3"
                :fill="version.color"
              />
            </g>
          </svg>
        </div>
      </article>

      <article class="leader-card">
        <div class="leader-topline">
          <span class="champion-label">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m5 8 4 3 3-6 3 6 4-3-2 9H7L5 8Zm2 12h10" />
            </svg>
            Champion hiện tại
          </span>
          <span class="live-dot">Active</span>
        </div>
        <div class="leader-identity">
          <div class="version-orbit"><span>5.7</span></div>
          <div>
            <p>Phiên bản mạnh nhất</p>
            <h2>{{ leader.display_name }}</h2>
            <span class="version-code">{{ leader.version_id }}</span>
          </div>
        </div>
        <div class="leader-elo">
          <span>Elo hiện tại</span>
          <strong>{{ leader.elo }}</strong>
          <small>+{{ leader.elo_delta }} điểm</small>
        </div>
        <div class="leader-record">
          <div>
            <strong>{{ leader.wins }}</strong
            ><span>Thắng</span>
          </div>
          <div>
            <strong>{{ leader.draws }}</strong
            ><span>Hòa</span>
          </div>
          <div>
            <strong>{{ leader.losses }}</strong
            ><span>Thua</span>
          </div>
        </div>
        <div class="win-progress">
          <span
            ><b>Tỉ lệ thắng</b
            ><strong>{{ getWinRate(leader).toFixed(1) }}%</strong></span
          >
          <div><i :style="{ width: `${getWinRate(leader)}%` }"></i></div>
        </div>
      </article>
    </section>

    <section class="detail-grid">
      <article class="surface ranking-card">
        <div class="section-heading compact">
          <div>
            <p class="section-kicker">So sánh trực tiếp</p>
            <h2>Hiệu suất phiên bản</h2>
          </div>
          <a href="#history">Xem lịch sử <span>→</span></a>
        </div>
        <div class="ranking-list">
          <div
            v-for="(version, index) in reportSeed.versions"
            :key="version.version_id"
            class="rank-row"
          >
            <span class="rank-number">{{
              String(index + 1).padStart(2, "0")
            }}</span>
            <span class="rank-version">
              <i :style="{ background: version.color }">{{
                version.display_name.charAt(0)
              }}</i>
              <span
                ><strong>{{ version.display_name }}</strong
                ><small>{{ statusLabels[version.status] }}</small></span
              >
            </span>
            <span class="rank-elo"
              ><strong>{{ version.elo }}</strong
              ><small>Elo</small></span
            >
            <span class="rank-rate">
              <span
                ><b>{{ getWinRate(version).toFixed(1) }}%</b
                ><small>{{ version.games }} trận</small></span
              >
              <i
                ><b
                  :style="{
                    width: `${getWinRate(version)}%`,
                    background: version.color,
                  }"
                ></b
              ></i>
            </span>
            <span
              class="rank-delta"
              :class="{ negative: version.elo_delta < 0 }"
            >
              {{ version.elo_delta > 0 ? "+" : "" }}{{ version.elo_delta }}
            </span>
          </div>
        </div>
      </article>

      <article class="surface recent-card">
        <div class="section-heading compact">
          <div>
            <p class="section-kicker">Hoạt động mới nhất</p>
            <h2>Trận đấu gần đây</h2>
          </div>
          <a href="#history">Tất cả <span>→</span></a>
        </div>
        <div class="recent-list">
          <div
            v-for="match in recentMatches"
            :key="match.game_id"
            class="recent-row"
          >
            <span
              class="result-mark"
              :class="match.winner ? 'decisive' : 'draw'"
            >
              {{ match.winner ? "W" : "D" }}
            </span>
            <span class="match-versus">
              <strong>
                {{ getVersion(match.engine_first).display_name }}
                <i>vs</i>
                {{ getVersion(match.engine_second).display_name }}
              </strong>
              <small
                >{{ formatMatchDate(match.played_at_utc) }} ·
                {{ match.total_actions }} nước</small
              >
            </span>
            <span class="match-winner"
              ><small>Kết quả</small
              ><strong>{{ getMatchOutcome(match) }}</strong></span
            >
          </div>
        </div>
      </article>
    </section>
  </main>
</template>

<style scoped>
.analytics-page {
  margin: 0 auto;
  max-width: 1520px;
  padding: 34px 38px 48px;
  width: 100%;
}

.page-header,
.section-heading,
.leader-topline,
.leader-identity,
.leader-elo,
.win-progress > span {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

.page-header {
  gap: 24px;
  margin-bottom: 27px;
}

.eyebrow,
.section-kicker {
  color: #c78b38;
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0.17em;
  margin: 0 0 7px;
  text-transform: uppercase;
}

h1,
h2,
p {
  margin-top: 0;
}

h1 {
  color: #17211e;
  font-size: clamp(28px, 3vw, 42px);
  font-weight: 780;
  letter-spacing: -0.04em;
  line-height: 1.1;
  margin-bottom: 8px;
}

.page-description {
  color: #74807c;
  font-size: 13px;
  margin-bottom: 0;
}

.header-actions {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 10px;
}

.seed-badge {
  align-items: center;
  background: #edf4f0;
  border: 1px solid #dce9e3;
  border-radius: 999px;
  color: #527066;
  display: flex;
  font-size: 10px;
  font-weight: 800;
  gap: 7px;
  padding: 10px 13px;
  text-transform: uppercase;
}

.seed-badge i {
  background: #58aa82;
  border-radius: 50%;
  box-shadow: 0 0 0 3px rgba(88, 170, 130, 0.14);
  height: 6px;
  width: 6px;
}

.period-filter {
  position: relative;
}

.period-filter select {
  appearance: none;
  background: #ffffff;
  border: 1px solid #dde3df;
  border-radius: 10px;
  color: #37433f;
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  min-height: 39px;
  padding: 8px 34px 8px 38px;
}

.period-filter svg {
  fill: none;
  height: 16px;
  left: 13px;
  pointer-events: none;
  position: absolute;
  stroke: #7d8985;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.6;
  top: 11px;
  width: 16px;
}

.metric-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-bottom: 16px;
}

.metric-card {
  align-items: center;
  background: #ffffff;
  border: 1px solid #e1e6e3;
  border-radius: 14px;
  box-shadow: 0 9px 24px rgba(34, 49, 43, 0.035);
  display: flex;
  gap: 14px;
  min-width: 0;
  padding: 17px;
}

.metric-card > div:last-child {
  display: grid;
  min-width: 0;
}

.metric-card span,
.metric-card small {
  color: #84908c;
  font-size: 10px;
  font-weight: 650;
}

.metric-card strong {
  color: #1b2723;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 25px;
  line-height: 1.2;
  margin: 2px 0;
}

.metric-card small b {
  color: #3c9870;
}

.metric-icon {
  border-radius: 11px;
  display: grid;
  flex: 0 0 auto;
  height: 44px;
  place-items: center;
  width: 44px;
}

.metric-icon svg {
  fill: none;
  height: 20px;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
  width: 20px;
}

.metric-icon.amber {
  background: #fff5e3;
  color: #d18b28;
}

.metric-icon.green {
  background: #e9f7f0;
  color: #469b73;
}

.metric-icon.blue {
  background: #edf4fe;
  color: #5888c4;
}

.metric-icon.violet {
  background: #f2effd;
  color: #806ac0;
}

.analysis-grid,
.detail-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(0, 1.85fr) minmax(280px, 0.72fr);
  margin-bottom: 16px;
}

.detail-grid {
  grid-template-columns: minmax(0, 1.45fr) minmax(340px, 1fr);
  margin-bottom: 0;
}

.surface,
.leader-card {
  border-radius: 15px;
  min-width: 0;
}

.surface {
  background: #ffffff;
  border: 1px solid #e1e6e3;
  box-shadow: 0 9px 24px rgba(34, 49, 43, 0.035);
}

.trend-card {
  padding: 21px 23px 14px;
}

.section-heading {
  gap: 18px;
}

.section-heading h2 {
  color: #1e2a26;
  font-size: 20px;
  font-weight: 780;
  letter-spacing: -0.025em;
  margin-bottom: 0;
}

.section-heading.compact {
  border-bottom: 1px solid #edf0ee;
  padding: 18px 20px 15px;
}

.section-heading.compact a {
  color: #9b6a28;
  font-size: 10px;
  font-weight: 800;
  text-decoration: none;
}

.section-heading.compact a span {
  font-size: 15px;
  margin-left: 3px;
}

.chart-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 7px 13px;
  justify-content: flex-end;
}

.chart-legend span {
  align-items: center;
  color: #79847f;
  display: flex;
  font-size: 9px;
  font-weight: 700;
  gap: 5px;
}

.chart-legend i {
  border-radius: 50%;
  height: 6px;
  width: 6px;
}

.chart-wrap {
  overflow-x: auto;
  padding-top: 11px;
}

.elo-chart {
  display: block;
  min-width: 580px;
  width: 100%;
}

.grid-lines line {
  stroke: #e8ece9;
  stroke-dasharray: 3 5;
  stroke-width: 1;
}

.axis-labels text {
  fill: #95a09c;
  font-size: 9px;
  font-weight: 650;
}

.trend-line,
.trend-line-shadow {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.trend-line {
  stroke-width: 2.2;
}

.trend-line-shadow {
  opacity: 0.12;
  stroke-width: 8;
}

.leader-card {
  background:
    radial-gradient(
      circle at 93% 8%,
      rgba(220, 160, 71, 0.19),
      transparent 31%
    ),
    #14211d;
  color: #ffffff;
  overflow: hidden;
  padding: 21px;
  position: relative;
}

.leader-card::after {
  border: 1px solid rgba(255, 255, 255, 0.035);
  border-radius: 50%;
  content: "";
  height: 220px;
  position: absolute;
  right: -125px;
  top: 72px;
  width: 220px;
}

.champion-label,
.live-dot {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.champion-label {
  align-items: center;
  color: #dca047;
  display: flex;
  gap: 6px;
}

.champion-label svg {
  fill: none;
  height: 15px;
  stroke: currentColor;
  stroke-linejoin: round;
  stroke-width: 1.6;
  width: 15px;
}

.live-dot {
  align-items: center;
  background: rgba(90, 178, 135, 0.11);
  border: 1px solid rgba(90, 178, 135, 0.23);
  border-radius: 99px;
  color: #6fc49a;
  display: flex;
  gap: 6px;
  padding: 5px 8px;
}

.live-dot::before {
  background: currentColor;
  border-radius: 50%;
  content: "";
  height: 5px;
  width: 5px;
}

.leader-identity {
  justify-content: flex-start;
  margin: 23px 0 19px;
}

.version-orbit {
  border: 1px solid rgba(220, 160, 71, 0.32);
  border-radius: 50%;
  display: grid;
  flex: 0 0 auto;
  height: 70px;
  margin-right: 14px;
  padding: 5px;
  place-items: center;
  width: 70px;
}

.version-orbit span {
  background: linear-gradient(145deg, #f0b85f, #b87829);
  border-radius: 50%;
  color: #17231f;
  display: grid;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 19px;
  font-weight: 800;
  height: 100%;
  place-items: center;
  width: 100%;
}

.leader-identity p,
.leader-identity h2 {
  margin-bottom: 0;
}

.leader-identity p,
.leader-elo > span {
  color: #788a84;
  font-size: 9px;
  font-weight: 750;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.leader-identity h2 {
  font-size: 21px;
  font-weight: 780;
  letter-spacing: -0.03em;
  margin-top: 4px;
}

.version-code {
  color: #63756f;
  font-size: 9px;
}

.leader-elo {
  align-items: baseline;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  justify-content: flex-start;
  padding: 15px 0;
}

.leader-elo strong {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 31px;
  margin-left: auto;
}

.leader-elo small {
  color: #68bd94;
  font-size: 9px;
  font-weight: 800;
  margin-left: 7px;
}

.leader-record {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  padding: 14px 0;
}

.leader-record div {
  display: grid;
  text-align: center;
}

.leader-record div + div {
  border-left: 1px solid rgba(255, 255, 255, 0.08);
}

.leader-record strong {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 18px;
}

.leader-record span,
.win-progress span {
  color: #71827c;
  font-size: 9px;
  margin-top: 2px;
}

.win-progress > span b {
  color: #9aa7a3;
}

.win-progress > span strong {
  color: #e9b35e;
  font-size: 11px;
}

.win-progress > div {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 99px;
  height: 5px;
  margin-top: 7px;
  overflow: hidden;
}

.win-progress > div i {
  background: linear-gradient(90deg, #bd7f2c, #e8ba6e);
  border-radius: inherit;
  display: block;
  height: 100%;
}

.ranking-list,
.recent-list {
  display: grid;
  padding: 3px 20px 7px;
}

.rank-row {
  align-items: center;
  display: grid;
  gap: 12px;
  grid-template-columns: 25px minmax(140px, 1fr) 58px minmax(120px, 0.8fr) 42px;
  min-height: 65px;
}

.rank-row + .rank-row,
.recent-row + .recent-row {
  border-top: 1px solid #eff2f0;
}

.rank-number {
  color: #a2aca8;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 12px;
}

.rank-version,
.rank-version > span,
.rank-elo,
.rank-rate > span,
.match-versus,
.match-winner {
  display: grid;
  min-width: 0;
}

.rank-version {
  align-items: center;
  display: flex;
  gap: 10px;
}

.rank-version > i {
  border-radius: 9px;
  color: #15201c;
  display: grid;
  flex: 0 0 auto;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 12px;
  font-style: normal;
  font-weight: 800;
  height: 32px;
  place-items: center;
  width: 32px;
}

.rank-version strong,
.match-versus strong,
.match-winner strong {
  color: #34403c;
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rank-version small,
.rank-elo small,
.rank-rate small,
.match-versus small,
.match-winner small {
  color: #9aa4a0;
  font-size: 8px;
  margin-top: 3px;
}

.rank-elo strong {
  color: #28342f;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 14px;
}

.rank-rate {
  display: grid;
  gap: 6px;
}

.rank-rate > span {
  align-items: baseline;
  display: flex;
  justify-content: space-between;
}

.rank-rate > span b {
  color: #3b4743;
  font-size: 9px;
}

.rank-rate > i {
  background: #edf0ee;
  border-radius: 99px;
  height: 4px;
  overflow: hidden;
}

.rank-rate > i b {
  border-radius: inherit;
  display: block;
  height: 100%;
}

.rank-delta {
  background: #eaf7f0;
  border-radius: 6px;
  color: #47926e;
  font-size: 9px;
  font-weight: 800;
  padding: 5px 4px;
  text-align: center;
}

.rank-delta.negative {
  background: #fbefed;
  color: #b86b5e;
}

.recent-list {
  padding-bottom: 7px;
}

.recent-row {
  align-items: center;
  display: grid;
  gap: 10px;
  grid-template-columns: 29px minmax(0, 1fr) minmax(85px, 0.55fr);
  min-height: 52px;
}

.result-mark {
  border-radius: 7px;
  display: grid;
  font-size: 9px;
  font-weight: 900;
  height: 26px;
  place-items: center;
  width: 26px;
}

.result-mark.decisive {
  background: #e8f6ef;
  color: #3f946b;
}

.result-mark.draw {
  background: #f1f3f2;
  color: #79847f;
}

.match-versus strong i {
  color: #a1aaa7;
  font-size: 8px;
  font-style: normal;
  margin: 0 3px;
}

.match-winner {
  text-align: right;
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
  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .analysis-grid,
  .detail-grid {
    grid-template-columns: 1fr;
  }

  .leader-card {
    display: grid;
    gap: 0 24px;
    grid-template-columns: minmax(240px, 1fr) 1fr;
  }

  .leader-topline {
    grid-column: 1 / -1;
  }

  .leader-identity {
    grid-row: 2 / 5;
  }
}

@media (max-width: 780px) {
  .analytics-page {
    padding: 25px 18px 38px;
  }

  .page-header {
    align-items: flex-start;
    display: grid;
  }

  .header-actions {
    width: 100%;
  }

  .period-filter {
    flex: 1;
  }

  .period-filter select {
    width: 100%;
  }

  .section-heading {
    align-items: flex-start;
    display: grid;
  }

  .chart-legend {
    justify-content: flex-start;
  }

  .leader-card {
    display: block;
  }

  .rank-row {
    gap: 8px;
    grid-template-columns: 22px minmax(120px, 1fr) 48px 70px;
  }

  .rank-rate {
    display: none;
  }
}

@media (max-width: 520px) {
  .metric-grid {
    grid-template-columns: 1fr;
  }

  .seed-badge {
    display: none;
  }

  .rank-row {
    grid-template-columns: 22px minmax(0, 1fr) 48px;
  }

  .rank-delta {
    display: none;
  }

  .recent-row {
    grid-template-columns: 29px minmax(0, 1fr);
  }

  .match-winner {
    display: none;
  }
}
</style>
