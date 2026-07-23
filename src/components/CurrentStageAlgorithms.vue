<script setup lang="ts">
const productionFeatures: Array<[string, string, string]> = [
  [
    "Negamax Alpha-Beta / PVS",
    "Bật",
    "Search lõi, iterative deepening đến depth hoàn tất gần nhất",
  ],
  [
    "Aspiration window",
    "Bật",
    "Cửa sổ đầu 50, tối đa 3 retry rồi trở về full window",
  ],
  ["Transposition table", "Bật", "Depth/age replacement, tự giới hạn theo RAM"],
  [
    "Move ordering + killer/history",
    "Bật",
    "Ưu tiên TT, terminal, capture và quiet move gây cutoff",
  ],
  [
    "Evaluator tối ưu",
    "Bật",
    "Lookup mask, occupancy/attack 12-bit và reusable scratch",
  ],
  [
    "L_eq",
    "Có điều kiện",
    "depth ≥ 4, legal ≥ 24, duplicate hint và giảm ≥ 25%",
  ],
  ["Lineage LUT", "Bật", "Lookup CH/G/E/L thay cho duyệt tối đa 24 hoán vị"],
  [
    "Generation cache / L_eq cache",
    "Tắt",
    "Chưa có benchmark đủ mạnh để nhận thêm độ phức tạp",
  ],
];

const stages: Array<[string, string, string]> = [
  [
    "1",
    "Alpha-Beta, iterative deepening, evaluator và TT",
    "Baseline đúng, deterministic",
  ],
  ["2", "Gộp canonical successor L_eq", "Chỉ bật theo trigger có lợi"],
  [
    "3–3.5",
    "PVS, aspiration, ordering, killer/history",
    "Đối chiếu với Alpha-Beta độ sâu nhỏ",
  ],
  [
    "4",
    "Tối ưu evaluator giữ nguyên ngữ nghĩa",
    "Eval time giảm 79,5% trên focused suite",
  ],
  ["5", "Lineage lookup table", "Có exhaustive equivalence test với reference"],
  ["5.0 Clean", "Đóng băng Stage 5", "Champion và stable anchor hiện tại"],
];

const statusClass = (status: string) =>
  status === "Bật" ? "enabled" : status === "Tắt" ? "disabled" : "conditional";
</script>

<template>
  <main class="algorithm-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">Current stage</p>
        <h1>Thuật toán của stage hiện tại</h1>
        <p class="lead">
          Ảnh chụp trạng thái đã được chấp nhận của engine. Binary đang build
          chỉ là candidate cho đến khi được freeze, đánh giá và promote bằng
          pipeline chính thức.
        </p>
      </div>
      <div class="review-chip">
        <small>Rà soát gần nhất</small><strong>22/07/2026 · JST</strong>
      </div>
    </header>

    <section class="surface snapshot-grid" aria-label="Stage hiện tại">
      <article>
        <span>Champion</span><strong>Stage 5.0 Clean</strong>
        <p><code>stage5-clean</code></p>
      </article>
      <article>
        <span>Runtime profile</span><strong>contest_safe</strong>
        <p>Stable anchor đã đóng băng</p>
      </article>
      <article>
        <span>Source commit</span><strong><code>5e096227947c…</code></strong>
        <p>Artifact được định danh bất biến</p>
      </article>
      <article>
        <span>Candidate local</span><strong>C++ Current</strong>
        <p>Chưa phải champion mới</p>
      </article>
    </section>

    <section class="surface">
      <h2>Pipeline chọn một nước</h2>
      <ol class="pipeline">
        <li>
          Rules sinh legal move, áp dụng capture, promotion và propagation đến
          fixed point.
        </li>
        <li>
          Lineage LUT giải support CH/G/E/L; reference permutation vẫn dùng cho
          differential test.
        </li>
        <li>
          L_eq thử gộp các successor có cùng canonical semantics khi trigger
          đạt.
        </li>
        <li>
          Move ordering xếp TT move, terminal, capture và quiet heuristic lên
          trước.
        </li>
        <li>
          Iterative deepening gọi Negamax Alpha-Beta/PVS từ depth nông đến sâu.
        </li>
        <li>
          Aspiration và TT giảm vùng tìm kiếm nhưng vẫn giữ đường fallback chính
          xác.
        </li>
        <li>
          Khi hết thời gian, engine trả legal move của iteration hoàn tất gần
          nhất.
        </li>
      </ol>
    </section>

    <section class="surface">
      <h2>Bật/tắt trong production</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Thành phần</th>
              <th>Trạng thái</th>
              <th>Thiết lập hoặc vai trò</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="feature in productionFeatures" :key="feature[0]">
              <td>
                <strong>{{ feature[0] }}</strong>
              </td>
              <td>
                <span :class="statusClass(feature[1])">{{ feature[1] }}</span>
              </td>
              <td>{{ feature[2] }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="surface">
      <h2>Các stage đã đóng góp gì</h2>
      <div class="stage-grid">
        <article v-for="stage in stages" :key="stage[0]" class="stage-card">
          <span>Stage {{ stage[0] }}</span
          ><strong>{{ stage[1] }}</strong>
          <p>{{ stage[2] }}</p>
        </article>
      </div>
    </section>

    <section class="surface">
      <h2>Điều kiện để promote stage mới</h2>
      <p class="note">
        Cần test đối chiếu đúng, Release build pass, benchmark lặp lại được,
        artifact/config/commit được freeze và permanent evaluation đạt policy.
        Không suy luận tính năng chỉ từ tên binary.
      </p>
    </section>
  </main>
</template>

<style scoped src="@/assets/algorithm-pages.css"></style>
