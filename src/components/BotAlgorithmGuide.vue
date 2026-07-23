<script setup lang="ts">
const bots: Array<[string, string, string, string]> = [
  ["WASM Alpha-Beta · Nhanh", "Browser", "Negamax Alpha-Beta", "Depth 2"],
  ["WASM Alpha-Beta · Cân bằng", "Browser", "Negamax Alpha-Beta", "Depth 4"],
  ["Alpha-Beta · Chuyên sâu", "Browser", "Negamax Alpha-Beta", "Depth 8"],
  [
    "Uniform Random",
    "Browser",
    "LCG có seed, chọn legal move",
    "Không nhìn trước",
  ],
  [
    "C++ Stage 5 Clean",
    "Native",
    "ID + PVS + TT + ordering + L_eq",
    "contest_safe",
  ],
  ["C++ Current", "Native", "Search của source hiện tại", "Candidate local"],
];

const concepts: Array<[string, string]> = [
  [
    "Minimax / Negamax",
    "Xem trò chơi là cây state. Vì game zero-sum, điểm của state con được đổi dấu khi đổi bên đi.",
  ],
  [
    "Alpha-Beta",
    "Cắt nhánh không còn khả năng thay đổi quyết định, vẫn cho cùng kết quả Minimax ở cùng depth/evaluator.",
  ],
  [
    "Evaluator",
    "Ước lượng lá chưa terminal; luật Catch, Try, draw và propagation luôn do rules quyết định.",
  ],
  [
    "Iterative deepening",
    "Tìm depth 1, 2, 3… để luôn có nước fallback và tận dụng kết quả depth trước.",
  ],
  [
    "Transposition table",
    "Dùng Zobrist key để tái sử dụng state đã tìm, kèm depth, bound, best move và age.",
  ],
  [
    "Move ordering",
    "Đưa nước hứa hẹn lên trước để tạo cutoff sớm; không tự loại một legal move.",
  ],
  [
    "PVS + aspiration",
    "Thử cửa sổ hẹp sau principal move và quanh score depth trước; re-search khi cần.",
  ],
  [
    "L_eq",
    "Giữ một đại diện khi nhiều move tạo successor có cùng canonical semantics; đây là phép giảm chính xác.",
  ],
  [
    "Lineage LUT",
    "Precompute support của bốn lineage CH/G/E/L để tối ưu propagation hot path mà không đổi luật.",
  ],
];
</script>

<template>
  <main class="algorithm-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">Algorithm guide</p>
        <h1>Các thuật toán cơ bản của bot</h1>
        <p class="lead">
          Giải thích bot chọn nước như thế nào, phần nào ảnh hưởng sức mạnh và
          điểm khác nhau giữa bot chạy trong trình duyệt với engine C++ native.
        </p>
      </div>
      <div class="review-chip">
        <small>Nguyên tắc</small><strong>Rules ≠ Search ≠ I/O</strong>
      </div>
    </header>

    <section class="surface">
      <h2>Bot nào dùng thuật toán nào</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Bot</th>
              <th>Nơi chạy</th>
              <th>Thuật toán quyết định</th>
              <th>Giới hạn</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="bot in bots" :key="bot[0]">
              <td>
                <strong>{{ bot[0] }}</strong>
              </td>
              <td>{{ bot[1] }}</td>
              <td>{{ bot[2] }}</td>
              <td>{{ bot[3] }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="note">
        Ba bot WASM Alpha-Beta dùng cùng code Rust; chúng khác độ sâu chứ không
        phải ba thuật toán riêng.
      </p>
    </section>

    <section class="surface">
      <h2>Từ cây trò chơi đến nước được chọn</h2>
      <div class="concept-grid">
        <article
          v-for="concept in concepts"
          :key="concept[0]"
          class="concept-card"
        >
          <span>Khái niệm</span><strong>{{ concept[0] }}</strong>
          <p>{{ concept[1] }}</p>
        </article>
      </div>
      <div class="formula">
        score(state) = max(-score(child)) · độ phức tạp duyệt đầy đủ ≈ O(b^d)
      </div>
    </section>

    <section class="surface">
      <h2>Evaluator đang nhìn gì</h2>
      <div class="snapshot-grid">
        <article>
          <span>WASM</span><strong>Material đơn giản</strong>
          <p>Chick 1 · Giraffe 4 · Elephant 5 · Lion 100 · Hen 10.</p>
        </article>
        <article>
          <span>Native C++</span><strong>Nhiều tín hiệu hơn</strong>
          <p>
            Expected material, uncertainty, mobility, Lion safety/pressure và
            Try progress.
          </p>
        </article>
        <article>
          <span>Terminal</span><strong>Không xấp xỉ</strong>
          <p>Catch, Try và draw được kiểm tra bởi rules trước evaluator.</p>
        </article>
      </div>
    </section>

    <section class="surface">
      <h2>Chọn bot cho thử nghiệm</h2>
      <p class="note">
        Random dùng làm sanity baseline; WASM depth 2/4/8 đổi tốc độ lấy tầm
        nhìn; Stage 5 Clean là accepted native anchor; C++ Current chỉ là
        candidate cho tới khi permanent evaluation hoàn tất.
      </p>
    </section>
  </main>
</template>

<style scoped src="@/assets/algorithm-pages.css"></style>
