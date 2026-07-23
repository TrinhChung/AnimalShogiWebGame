<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  benchmarkLoadState,
  reportSeed,
  type BenchmarkComponent,
  type BenchmarkFinding,
  type VersionBenchmarkReport,
} from "@/reports/reportData";

const selectedVersionId = ref("");
type TrainingDataSummary = {
  quality: Array<{
    quality_status: "quarantined" | "raw" | "train-eligible" | "rejected";
    match_count: number;
    transition_count: number;
  }>;
  exports: { export_count: number; match_count: number; sample_count: number };
};
const trainingDataSummary = ref<TrainingDataSummary | null>(null);

const qualityCount = (
  status: TrainingDataSummary["quality"][number]["quality_status"],
) =>
  trainingDataSummary.value?.quality.find(
    (item) => item.quality_status === status,
  )?.match_count ?? 0;

onMounted(async () => {
  try {
    const response = await fetch("/api/training-data/summary", {
      cache: "no-store",
    });
    if (response.ok) {
      trainingDataSummary.value =
        (await response.json()) as TrainingDataSummary;
    }
  } catch {
    trainingDataSummary.value = null;
  }
});

const benchmarkVersions = computed(() => reportSeed.benchmarks.versions);

watch(
  () => benchmarkVersions.value.map((item) => item.version_id).join("|"),
  () => {
    if (
      benchmarkVersions.value.some(
        (item) => item.version_id === selectedVersionId.value,
      )
    ) {
      return;
    }
    selectedVersionId.value =
      benchmarkVersions.value.find((item) => item.data_quality === "verified")
        ?.version_id ??
      benchmarkVersions.value.find((item) => item.case_count > 0)?.version_id ??
      benchmarkVersions.value[0]?.version_id ??
      "";
  },
  { immediate: true },
);

const selectedVersion = computed<VersionBenchmarkReport | null>(
  () =>
    benchmarkVersions.value.find(
      (item) => item.version_id === selectedVersionId.value,
    ) ?? null,
);

const selectedMatchVersion = computed(() =>
  reportSeed.versions.find(
    (item) => item.version_id === selectedVersion.value?.version_id,
  ),
);

const coveragePercent = computed(() => {
  const selected = selectedVersion.value;
  if (!selected || selected.case_count === 0) {
    return 0;
  }
  return Math.round(
    (selected.completed_case_count / selected.case_count) * 100,
  );
});

const dominantComponent = computed(
  () => selectedVersion.value?.component_breakdown[0] ?? null,
);

const qualityLabels: Record<VersionBenchmarkReport["data_quality"], string> = {
  verified: "Đã xác minh",
  historical: "Lịch sử",
  missing: "Thiếu dữ liệu",
};

const componentColors: Record<string, string> = {
  movegen: "#d59236",
  evaluation: "#4c9c78",
  ordering: "#5d88bd",
  propagation: "#8b70bb",
  l_eq: "#ba6f62",
  other: "#89948f",
};

const numberFormatter = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 1,
});

const formatNumber = (value: number): string => numberFormatter.format(value);
const formatCompact = (value: number): string => {
  if (value >= 1_000_000) {
    return `${formatNumber(value / 1_000_000)}M`;
  }
  if (value >= 1_000) {
    return `${formatNumber(value / 1_000)}K`;
  }
  return value > 0 ? formatNumber(value) : "—";
};
const formatMetric = (value: number, suffix = ""): string =>
  value > 0 ? `${formatNumber(value)}${suffix}` : "—";
const formatDate = (value: string | null): string =>
  value
    ? new Intl.DateTimeFormat("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "Chưa có run";

const componentColor = (component: BenchmarkComponent): string =>
  componentColors[component.key] ?? "#89948f";

const getMatchVersion = (versionId: string) =>
  reportSeed.versions.find((item) => item.version_id === versionId);

const evidenceSummary = (finding: BenchmarkFinding): string =>
  Object.entries(finding.evidence)
    .slice(0, 3)
    .map(([key, value]) => `${key.replaceAll("_", " ")}: ${String(value)}`)
    .join(" · ");

const findingSourceLabel = (finding: BenchmarkFinding): string =>
  finding.source === "persisted" ? "Kết luận đã lưu" : "Phân tích tự động";
</script>

<template>
  <main class="benchmark-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">Algorithm intelligence</p>
        <h1>Benchmark & hiệu quả thuật toán</h1>
        <p class="page-description">
          Đối chiếu sức mạnh thi đấu với chi phí tìm kiếm, tìm bottleneck và lưu
          bằng chứng theo từng bot version.
        </p>
      </div>
      <div class="header-context">
        <span
          class="source-chip"
          :title="benchmarkLoadState.error ?? undefined"
        >
          <i></i>
          {{
            benchmarkLoadState.source === "mysql"
              ? "MySQL trực tiếp"
              : "Seed tham khảo"
          }}
        </span>
        <span class="last-run">
          <small>Benchmark mới nhất</small>
          <strong>{{
            formatDate(reportSeed.benchmarks.summary.latest_run_at)
          }}</strong>
        </span>
      </div>
    </header>

    <section class="summary-grid" aria-label="Phạm vi benchmark">
      <article>
        <span>Version đã đo</span>
        <strong>
          {{ reportSeed.benchmarks.summary.benchmarked_versions
          }}<small>/{{ reportSeed.benchmarks.summary.total_versions }}</small>
        </strong>
        <p>Version có ít nhất một benchmark case</p>
      </article>
      <article>
        <span>Benchmark run</span>
        <strong>{{ reportSeed.benchmarks.summary.total_runs }}</strong>
        <p>Run tách biệt theo suite và cấu hình</p>
      </article>
      <article>
        <span>Case đã lưu</span>
        <strong>{{
          formatCompact(reportSeed.benchmarks.summary.total_cases)
        }}</strong>
        <p>Position, depth và repeat có provenance</p>
      </article>
      <article class="principle-card">
        <span>Nguyên tắc đánh giá</span>
        <strong>Strength ≠ Speed</strong>
        <p>
          Elo và benchmark được hiển thị cạnh nhau, không trộn thành điểm ảo.
        </p>
      </article>
    </section>

    <section v-if="trainingDataSummary" class="training-quality surface">
      <div>
        <p class="section-kicker">Training data gate</p>
        <h2>Chất lượng trajectory</h2>
        <small
          >Chỉ ván replay pass mới được dùng cho Elo, báo cáo và export.</small
        >
      </div>
      <dl>
        <div class="eligible">
          <dt>Train-eligible</dt>
          <dd>{{ qualityCount("train-eligible") }}</dd>
        </div>
        <div>
          <dt>Đang chờ</dt>
          <dd>{{ qualityCount("raw") }}</dd>
        </div>
        <div>
          <dt>Quarantine cũ</dt>
          <dd>{{ qualityCount("quarantined") }}</dd>
        </div>
        <div class="rejected">
          <dt>Bị loại</dt>
          <dd>{{ qualityCount("rejected") }}</dd>
        </div>
        <div>
          <dt>Dataset export</dt>
          <dd>{{ trainingDataSummary.exports.export_count }}</dd>
        </div>
      </dl>
    </section>

    <section v-if="selectedVersion" class="version-focus surface">
      <div class="focus-topline">
        <label class="version-select">
          <span>Version đang phân tích</span>
          <select v-model="selectedVersionId" aria-label="Version benchmark">
            <option
              v-for="version in benchmarkVersions"
              :key="version.version_id"
              :value="version.version_id"
            >
              {{ version.display_name }} ·
              {{ qualityLabels[version.data_quality] }}
            </option>
          </select>
        </label>
        <div class="profile-identity">
          <span class="quality-pill" :class="selectedVersion.data_quality">
            {{ qualityLabels[selectedVersion.data_quality] }}
          </span>
          <span>{{ selectedVersion.stage_label }}</span>
          <span>{{ selectedVersion.search_family }}</span>
          <code v-if="selectedVersion.source_commit">
            {{ selectedVersion.source_commit.slice(0, 8) }}
          </code>
        </div>
      </div>

      <div v-if="selectedVersion.algorithm_tags.length" class="algorithm-tags">
        <span v-for="tag in selectedVersion.algorithm_tags" :key="tag">
          {{ tag }}
        </span>
      </div>
      <div v-else class="algorithm-tags empty-tags">
        Chưa có algorithm profile được xác minh cho artifact này.
      </div>

      <div class="focus-metrics">
        <article>
          <span>Coverage hợp lệ</span>
          <strong>{{ coveragePercent }}%</strong>
          <small>
            {{ selectedVersion.completed_case_count }}/{{
              selectedVersion.case_count
            }}
            case
          </small>
        </article>
        <article>
          <span>Median NPS</span>
          <strong>{{ formatCompact(selectedVersion.median_nps) }}</strong>
          <small
            >{{ formatCompact(selectedVersion.median_nodes) }} node
            median</small
          >
        </article>
        <article>
          <span>Depth hoàn tất</span>
          <strong>{{ selectedVersion.max_completed_depth || "—" }}</strong>
          <small
            >{{ selectedVersion.suite_count }} suite ·
            {{ selectedVersion.run_count }} run</small
          >
        </article>
        <article>
          <span>Peak RSS</span>
          <strong>{{
            formatMetric(selectedVersion.peak_rss_mb, " MiB")
          }}</strong>
          <small
            >TT hit
            {{ formatMetric(selectedVersion.average_tt_hit_rate, "%") }}</small
          >
        </article>
        <article>
          <span>Elo từ trận đấu</span>
          <strong>{{ selectedMatchVersion?.elo ?? "—" }}</strong>
          <small v-if="selectedMatchVersion">
            {{ selectedMatchVersion.games }} trận ·
            {{ selectedMatchVersion.wins }} thắng
          </small>
          <small v-else>Chưa có match data cùng version key</small>
        </article>
      </div>
    </section>

    <section v-if="selectedVersion" class="analysis-grid">
      <article class="surface component-card">
        <div class="section-heading">
          <div>
            <p class="section-kicker">Cost profile</p>
            <h2>Thời gian đang nằm ở đâu?</h2>
          </div>
          <span v-if="dominantComponent" class="dominant-label">
            Cao nhất: {{ dominantComponent.label }}
          </span>
        </div>

        <div
          v-if="selectedVersion.component_breakdown.length"
          class="component-list"
        >
          <div
            v-for="component in selectedVersion.component_breakdown"
            :key="component.key"
            class="component-row"
          >
            <div class="component-meta">
              <span>
                <i :style="{ background: componentColor(component) }"></i>
                {{ component.label }}
              </span>
              <strong>{{ component.share_percent }}%</strong>
            </div>
            <div class="component-track">
              <i
                :style="{
                  width: `${component.share_percent}%`,
                  background: componentColor(component),
                }"
              ></i>
            </div>
            <small>{{ formatNumber(component.elapsed_ms) }} ms cộng dồn</small>
          </div>
        </div>
        <div v-else class="empty-state compact-empty">
          <strong>Thiếu component timing</strong>
          <p>
            Import `eval_ms`, `movegen_ms`, `ordering_ms`, `propagation_ms` và
            `leq_ms`.
          </p>
        </div>

        <footer class="component-footer">
          <span>
            Branching
            <b>{{ formatMetric(selectedVersion.average_branching) }}</b>
          </span>
          <span>
            Sau reduction
            <b>{{ formatMetric(selectedVersion.reduced_branching) }}</b>
          </span>
          <span>
            Mức giảm
            <b>{{
              formatMetric(selectedVersion.branching_reduction_percent, "%")
            }}</b>
          </span>
        </footer>
      </article>

      <article class="surface findings-card">
        <div class="section-heading">
          <div>
            <p class="section-kicker">Decision support</p>
            <h2>Nên cải thiện phần nào?</h2>
          </div>
          <span class="finding-count"
            >{{ selectedVersion.findings.length }} tín hiệu</span
          >
        </div>

        <div v-if="selectedVersion.findings.length" class="finding-list">
          <article
            v-for="finding in selectedVersion.findings"
            :key="`${finding.category}:${finding.title}`"
            class="finding-item"
            :class="finding.severity"
          >
            <span class="severity-mark"></span>
            <div>
              <span class="finding-source">
                {{ findingSourceLabel(finding) }} · {{ finding.category }}
              </span>
              <h3>{{ finding.title }}</h3>
              <small v-if="evidenceSummary(finding)">{{
                evidenceSummary(finding)
              }}</small>
              <p>{{ finding.recommendation }}</p>
            </div>
          </article>
        </div>
        <div v-else class="empty-state compact-empty">
          <strong>Chưa phát hiện bottleneck</strong>
          <p>
            Cần thêm benchmark case hoặc persisted finding để đưa ra khuyến
            nghị.
          </p>
        </div>
      </article>
    </section>

    <section class="surface comparison-card">
      <div class="section-heading table-heading">
        <div>
          <p class="section-kicker">Version matrix</p>
          <h2>So sánh sức mạnh và hiệu suất</h2>
        </div>
        <p>
          Không so NPS giữa các môi trường khác nhau nếu environment metadata
          không tương đương.
        </p>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Version</th>
              <th>Dữ liệu</th>
              <th>Elo</th>
              <th>Median NPS</th>
              <th>Depth</th>
              <th>TT hit</th>
              <th>Median time</th>
              <th>Coverage</th>
              <th>Bottleneck chính</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="version in benchmarkVersions"
              :key="version.version_id"
              :class="{ selected: version.version_id === selectedVersionId }"
              @click="selectedVersionId = version.version_id"
            >
              <td>
                <span class="version-cell">
                  <i :style="{ background: version.color }"></i>
                  <span>
                    <strong>{{ version.display_name }}</strong>
                    <small>{{ version.stage_label }}</small>
                  </span>
                </span>
              </td>
              <td>
                <span
                  class="quality-pill table-pill"
                  :class="version.data_quality"
                >
                  {{ qualityLabels[version.data_quality] }}
                </span>
              </td>
              <td>{{ getMatchVersion(version.version_id)?.elo ?? "—" }}</td>
              <td>{{ formatCompact(version.median_nps) }}</td>
              <td>{{ version.max_completed_depth || "—" }}</td>
              <td>{{ formatMetric(version.average_tt_hit_rate, "%") }}</td>
              <td>{{ formatMetric(version.median_elapsed_ms, " ms") }}</td>
              <td>
                {{ version.completed_case_count }}/{{ version.case_count }}
              </td>
              <td>
                {{ version.component_breakdown[0]?.label ?? "Chưa đủ dữ liệu" }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="selectedVersion" class="surface workload-card">
      <div class="section-heading table-heading">
        <div>
          <p class="section-kicker">Workload drill-down</p>
          <h2>Position nào đang kéo hiệu suất xuống?</h2>
        </div>
        <span>{{ selectedVersion.workloads.length }} workload</span>
      </div>

      <div v-if="selectedVersion.workloads.length" class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Position</th>
              <th>Nhóm</th>
              <th>Trạng thái</th>
              <th>Depth tối đa</th>
              <th>Median node</th>
              <th>Median time</th>
              <th>Median NPS</th>
              <th>TT hit</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="workload in selectedVersion.workloads"
              :key="`${workload.position_key}:${workload.workload_class}`"
            >
              <td>
                <strong>{{ workload.position_key }}</strong>
              </td>
              <td>{{ workload.workload_class }}</td>
              <td>
                <span
                  class="completion"
                  :class="{ failed: !workload.completed }"
                >
                  {{ workload.completed ? "Hoàn tất" : "Có timeout/lỗi" }}
                </span>
              </td>
              <td>{{ workload.max_depth || "—" }}</td>
              <td>{{ formatCompact(workload.median_nodes) }}</td>
              <td>{{ formatMetric(workload.median_elapsed_ms, " ms") }}</td>
              <td>{{ formatCompact(workload.median_nps) }}</td>
              <td>{{ formatMetric(workload.average_tt_hit_rate, "%") }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty-state">
        <strong>Version này chưa có benchmark case</strong>
        <p>
          Match history vẫn cho biết sức mạnh tương đối, nhưng chưa đủ để kết
          luận phần thuật toán nào cần tối ưu.
        </p>
      </div>
    </section>

    <aside class="method-note">
      <strong>Cách đọc báo cáo</strong>
      <p>
        Elo trả lời “bot nào thắng nhiều hơn”; benchmark trả lời “chi phí nằm ở
        đâu”. Mọi khuyến nghị tự động đều được suy ra từ dữ liệu MySQL và phải
        được xác nhận bằng A/B test giữ nguyên move, score, legality và hash
        trước khi thay đổi production.
      </p>
    </aside>
  </main>
</template>

<style scoped>
.benchmark-page {
  margin: 0 auto;
  max-width: 1520px;
  padding: 34px 38px 48px;
  width: 100%;
}

.page-header,
.focus-topline,
.section-heading,
.component-meta,
.component-footer {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

.page-header {
  gap: 24px;
  margin-bottom: 25px;
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
h3,
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

.header-context {
  align-items: stretch;
  display: flex;
  flex: 0 0 auto;
  gap: 9px;
}

.source-chip,
.last-run {
  background: #ffffff;
  border: 1px solid #dfe5e1;
  border-radius: 11px;
  display: flex;
  padding: 10px 12px;
}

.source-chip {
  align-items: center;
  color: #527066;
  font-size: 9px;
  font-weight: 850;
  gap: 7px;
  text-transform: uppercase;
}

.source-chip i {
  background: #58aa82;
  border-radius: 50%;
  box-shadow: 0 0 0 3px rgba(88, 170, 130, 0.14);
  height: 6px;
  width: 6px;
}

.last-run {
  display: grid;
  min-width: 180px;
}

.last-run small {
  color: #8b9692;
  font-size: 8px;
  font-weight: 750;
  text-transform: uppercase;
}

.last-run strong {
  color: #36423e;
  font-size: 10px;
  margin-top: 3px;
}

.summary-grid {
  display: grid;
  gap: 13px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-bottom: 16px;
}

.summary-grid article {
  background: #ffffff;
  border: 1px solid #e0e5e2;
  border-radius: 14px;
  box-shadow: 0 8px 22px rgba(34, 49, 43, 0.03);
  min-width: 0;
  padding: 16px 17px;
}

.summary-grid article > span,
.focus-metrics span {
  color: #84908c;
  font-size: 9px;
  font-weight: 750;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.summary-grid strong {
  color: #1c2824;
  display: block;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 25px;
  margin: 4px 0;
}

.summary-grid strong small {
  color: #93a09b;
  font-size: 14px;
}

.summary-grid p {
  color: #8b9692;
  font-size: 9px;
  line-height: 1.45;
  margin-bottom: 0;
}

.summary-grid .principle-card {
  background: #14211d;
  border-color: #14211d;
}

.principle-card > span,
.principle-card p {
  color: #74867f !important;
}

.principle-card strong {
  color: #e5ae59;
  font-family: inherit;
  font-size: 20px;
}

.training-quality {
  align-items: center;
  display: flex;
  gap: 22px;
  justify-content: space-between;
  margin-bottom: 16px;
  padding: 17px 19px;
}

.training-quality h2 {
  font-family: Georgia, "Times New Roman", serif;
  margin: 2px 0 4px;
}

.training-quality small {
  color: #74807b;
}

.training-quality dl {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
  margin: 0;
}

.training-quality dl div {
  background: #f1f4f2;
  border-radius: 9px;
  min-width: 92px;
  padding: 9px 11px;
}

.training-quality dt {
  color: #73807a;
  font-size: 9px;
  font-weight: 800;
  text-transform: uppercase;
}

.training-quality dd {
  font-size: 18px;
  font-weight: 800;
  margin: 3px 0 0;
}

.training-quality .eligible {
  background: #e6f3eb;
  color: #216547;
}

.training-quality .rejected {
  background: #f7e9e7;
  color: #98463a;
}

.surface {
  background: #ffffff;
  border: 1px solid #e0e5e2;
  border-radius: 15px;
  box-shadow: 0 9px 24px rgba(34, 49, 43, 0.035);
  min-width: 0;
}

.version-focus {
  margin-bottom: 16px;
  padding: 19px 21px 0;
}

.focus-topline {
  gap: 20px;
}

.version-select {
  display: grid;
  min-width: min(430px, 100%);
}

.version-select > span {
  color: #8a9691;
  font-size: 9px;
  font-weight: 800;
  margin-bottom: 6px;
  text-transform: uppercase;
}

.version-select select {
  background: #f8faf8;
  border: 1px solid #dce3df;
  border-radius: 9px;
  color: #26332e;
  font: inherit;
  font-size: 12px;
  font-weight: 750;
  min-height: 39px;
  padding: 8px 12px;
}

.profile-identity,
.algorithm-tags {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.profile-identity {
  justify-content: flex-end;
}

.profile-identity > span:not(.quality-pill),
.profile-identity code,
.algorithm-tags span {
  background: #f3f6f4;
  border: 1px solid #e5eae7;
  border-radius: 999px;
  color: #68746f;
  font-size: 9px;
  padding: 6px 9px;
}

.profile-identity code {
  color: #9a6b2d;
}

.quality-pill {
  border-radius: 999px;
  font-size: 8px;
  font-weight: 850;
  padding: 6px 9px;
  text-transform: uppercase;
}

.quality-pill.verified {
  background: #e7f5ed;
  color: #3b8965;
}

.quality-pill.historical {
  background: #fff3df;
  color: #a46d23;
}

.quality-pill.missing {
  background: #f1f3f2;
  color: #7b8782;
}

.algorithm-tags {
  border-bottom: 1px solid #edf1ee;
  margin-top: 14px;
  padding-bottom: 16px;
}

.algorithm-tags span {
  background: #fffaf1;
  border-color: #f0e2c8;
  color: #8b6228;
}

.empty-tags {
  color: #929d99;
  font-size: 10px;
}

.focus-metrics {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.focus-metrics article {
  display: grid;
  min-width: 0;
  padding: 17px 14px 19px;
}

.focus-metrics article:first-child {
  padding-left: 0;
}

.focus-metrics article + article {
  border-left: 1px solid #edf1ee;
}

.focus-metrics strong {
  color: #1f2b27;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 22px;
  margin: 3px 0;
}

.focus-metrics small {
  color: #929d99;
  font-size: 8px;
}

.analysis-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(0, 1.05fr) minmax(360px, 0.95fr);
  margin-bottom: 16px;
}

.component-card,
.findings-card {
  padding: 20px 21px;
}

.section-heading {
  gap: 18px;
  margin-bottom: 18px;
}

.section-heading h2 {
  color: #1e2a26;
  font-size: 19px;
  letter-spacing: -0.025em;
  margin-bottom: 0;
}

.dominant-label,
.finding-count,
.table-heading > span {
  background: #f3f6f4;
  border-radius: 999px;
  color: #78847f;
  font-size: 8px;
  font-weight: 800;
  padding: 6px 9px;
  text-transform: uppercase;
}

.component-list {
  display: grid;
  gap: 13px;
}

.component-row {
  display: grid;
  gap: 5px;
}

.component-meta span {
  align-items: center;
  color: #53605b;
  display: flex;
  font-size: 10px;
  font-weight: 700;
  gap: 7px;
}

.component-meta span i {
  border-radius: 3px;
  height: 8px;
  width: 8px;
}

.component-meta strong {
  color: #3c4844;
  font-size: 10px;
}

.component-track {
  background: #edf1ee;
  border-radius: 99px;
  height: 7px;
  overflow: hidden;
}

.component-track i {
  border-radius: inherit;
  display: block;
  height: 100%;
}

.component-row small {
  color: #9aa4a0;
  font-size: 8px;
}

.component-footer {
  border-top: 1px solid #edf1ee;
  margin-top: 17px;
  padding-top: 14px;
}

.component-footer span {
  color: #8b9692;
  display: grid;
  font-size: 8px;
  gap: 3px;
  text-align: center;
  text-transform: uppercase;
}

.component-footer b {
  color: #394640;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 14px;
}

.finding-list {
  display: grid;
  gap: 9px;
  max-height: 405px;
  overflow-y: auto;
  padding-right: 3px;
}

.finding-item {
  background: #f8faf9;
  border: 1px solid #e7ece9;
  border-radius: 11px;
  display: grid;
  gap: 10px;
  grid-template-columns: 5px minmax(0, 1fr);
  padding: 12px;
}

.severity-mark {
  background: #6997c8;
  border-radius: 99px;
}

.finding-item.warning .severity-mark {
  background: #d99b42;
}

.finding-item.critical .severity-mark {
  background: #c66b5c;
}

.finding-source {
  color: #8d9894;
  font-size: 7px;
  font-weight: 850;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.finding-item h3 {
  color: #34413c;
  font-size: 11px;
  margin: 4px 0 3px;
}

.finding-item small {
  color: #9a6a2b;
  display: block;
  font-size: 8px;
  margin-bottom: 5px;
}

.finding-item p {
  color: #75817c;
  font-size: 9px;
  line-height: 1.55;
  margin-bottom: 0;
}

.comparison-card,
.workload-card {
  margin-bottom: 16px;
  overflow: hidden;
}

.table-heading {
  border-bottom: 1px solid #edf1ee;
  margin-bottom: 0;
  padding: 18px 20px 15px;
}

.table-heading > p {
  color: #929c98;
  font-size: 8px;
  margin-bottom: 0;
  max-width: 360px;
  text-align: right;
}

.table-scroll {
  overflow-x: auto;
}

table {
  border-collapse: collapse;
  min-width: 980px;
  width: 100%;
}

th,
td {
  border-bottom: 1px solid #edf1ee;
  padding: 12px 15px;
  text-align: left;
}

th {
  background: #fafbfa;
  color: #89948f;
  font-size: 8px;
  font-weight: 850;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

td {
  color: #58645f;
  font-size: 9px;
}

tbody tr {
  cursor: pointer;
  transition: background-color 140ms ease;
}

tbody tr:hover,
tbody tr.selected {
  background: #fbf7ef;
}

.workload-card tbody tr {
  cursor: default;
}

.version-cell {
  align-items: center;
  display: flex;
  gap: 9px;
  min-width: 180px;
}

.version-cell > i {
  border-radius: 8px;
  height: 28px;
  width: 5px;
}

.version-cell > span {
  display: grid;
}

.version-cell strong,
.workload-card td strong {
  color: #34413c;
  font-size: 10px;
}

.version-cell small {
  color: #9ba5a1;
  font-size: 8px;
  margin-top: 2px;
}

.table-pill {
  display: inline-block;
  white-space: nowrap;
}

.completion {
  background: #e7f5ed;
  border-radius: 99px;
  color: #3b8965;
  display: inline-block;
  font-size: 8px;
  font-weight: 800;
  padding: 5px 7px;
}

.completion.failed {
  background: #faece9;
  color: #b45d50;
}

.empty-state {
  color: #87928d;
  display: grid;
  min-height: 145px;
  padding: 28px;
  place-content: center;
  text-align: center;
}

.empty-state strong {
  color: #53605b;
  font-size: 12px;
}

.empty-state p {
  font-size: 9px;
  line-height: 1.5;
  margin: 5px auto 0;
  max-width: 480px;
}

.compact-empty {
  min-height: 230px;
  padding: 18px;
}

.method-note {
  background: #e9eee9;
  border: 1px solid #dbe3dd;
  border-radius: 12px;
  display: grid;
  gap: 4px;
  grid-template-columns: 145px minmax(0, 1fr);
  padding: 13px 16px;
}

.method-note strong {
  color: #46534d;
  font-size: 10px;
}

.method-note p {
  color: #75817c;
  font-size: 9px;
  line-height: 1.5;
  margin-bottom: 0;
}

@media (max-width: 1180px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .analysis-grid {
    grid-template-columns: 1fr;
  }

  .focus-metrics {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 780px) {
  .benchmark-page {
    padding: 25px 18px 38px;
  }

  .page-header,
  .focus-topline,
  .section-heading,
  .method-note,
  .training-quality {
    align-items: flex-start;
    display: grid;
  }

  .header-context,
  .version-select {
    width: 100%;
  }

  .profile-identity {
    justify-content: flex-start;
  }

  .focus-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .focus-metrics article:nth-child(odd) {
    border-left: 0;
  }

  .table-heading > p {
    text-align: left;
  }

  .method-note {
    grid-template-columns: 1fr;
  }

  .training-quality dl {
    justify-content: flex-start;
  }
}

@media (max-width: 520px) {
  .summary-grid,
  .focus-metrics {
    grid-template-columns: 1fr;
  }

  .header-context {
    display: grid;
  }

  .focus-metrics article,
  .focus-metrics article:first-child {
    border-left: 0;
    border-top: 1px solid #edf1ee;
    padding-left: 0;
  }

  .component-footer {
    align-items: flex-start;
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
