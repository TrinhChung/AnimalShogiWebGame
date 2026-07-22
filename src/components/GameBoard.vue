<script setup lang="ts">
import { useQuantumAnimalShogiStore } from "@/stores/QuantumAnimalShogiStore";
import PieceCell from "./PieceCell.vue";

const store = useQuantumAnimalShogiStore();
</script>

<template>
  <section class="board-panel">
    <div class="board-header">
      <div>
        <p class="eyebrow">Quantum Animal Shogi</p>
        <h2>
          {{
            store.gameMode === "human-vs-engine"
              ? "Người đấu Máy"
              : "Máy đấu Máy"
          }}
        </h2>
      </div>
      <div class="stats-row">
        <div class="stat-badge">Nước {{ store.turn }}</div>
        <div
          v-if="store.gameMode === 'engine-vs-engine'"
          class="stat-badge"
          data-testid="board-series-progress"
        >
          Ván {{ store.currentMatchNumber }}/{{ store.repeatCount }}
        </div>
        <div class="stat-badge" :class="{ thinking: store.isThinking }">
          {{ store.currentPlayerLabel }}
          {{ store.isThinking ? "đang tính…" : "đến lượt" }}
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="cell piece-cell hand-cell">
        <PieceCell :piece-state="store.enemyHands[1]!" :index="null" />
      </div>
      <div class="cell piece-cell hand-cell">
        <PieceCell :piece-state="store.enemyHands[0]!" :index="null" />
      </div>
      <div class="cell blank-cell"></div>
      <div class="cell piece-cell board-cell">
        <PieceCell :piece-state="store.board[11]!" :index="11" />
      </div>
      <div class="cell piece-cell board-cell">
        <PieceCell :piece-state="store.board[10]!" :index="10" />
      </div>
      <div class="cell piece-cell board-cell">
        <PieceCell :piece-state="store.board[9]!" :index="9" />
      </div>
      <div class="cell blank-cell"></div>
      <div class="cell piece-cell hand-cell">
        <PieceCell :piece-state="store.allyHands[6]!" :index="18" />
      </div>
      <div class="cell piece-cell hand-cell">
        <PieceCell :piece-state="store.allyHands[7]!" :index="19" />
      </div>

      <div class="cell piece-cell hand-cell">
        <PieceCell :piece-state="store.enemyHands[3]!" :index="null" />
      </div>
      <div class="cell piece-cell hand-cell">
        <PieceCell :piece-state="store.enemyHands[2]!" :index="null" />
      </div>
      <div class="cell blank-cell"></div>
      <div class="cell piece-cell board-cell">
        <PieceCell :piece-state="store.board[8]!" :index="8" />
      </div>
      <div class="cell piece-cell board-cell">
        <PieceCell :piece-state="store.board[7]!" :index="7" />
      </div>
      <div class="cell piece-cell board-cell">
        <PieceCell :piece-state="store.board[6]!" :index="6" />
      </div>
      <div class="cell blank-cell"></div>
      <div class="cell piece-cell hand-cell">
        <PieceCell :piece-state="store.allyHands[4]!" :index="16" />
      </div>
      <div class="cell piece-cell hand-cell">
        <PieceCell :piece-state="store.allyHands[5]!" :index="17" />
      </div>

      <div class="cell piece-cell hand-cell">
        <PieceCell :piece-state="store.enemyHands[5]!" :index="null" />
      </div>
      <div class="cell piece-cell hand-cell">
        <PieceCell :piece-state="store.enemyHands[4]!" :index="null" />
      </div>
      <div class="cell blank-cell"></div>
      <div class="cell piece-cell board-cell">
        <PieceCell :piece-state="store.board[5]!" :index="5" />
      </div>
      <div class="cell piece-cell board-cell">
        <PieceCell :piece-state="store.board[4]!" :index="4" />
      </div>
      <div class="cell piece-cell board-cell">
        <PieceCell :piece-state="store.board[3]!" :index="3" />
      </div>
      <div class="cell blank-cell"></div>
      <div class="cell piece-cell hand-cell">
        <PieceCell :piece-state="store.allyHands[2]!" :index="14" />
      </div>
      <div class="cell piece-cell hand-cell">
        <PieceCell :piece-state="store.allyHands[3]!" :index="15" />
      </div>

      <div class="cell piece-cell hand-cell">
        <PieceCell :piece-state="store.enemyHands[7]!" :index="null" />
      </div>
      <div class="cell piece-cell hand-cell">
        <PieceCell :piece-state="store.enemyHands[6]!" :index="null" />
      </div>
      <div class="cell blank-cell"></div>
      <div class="cell piece-cell board-cell">
        <PieceCell :piece-state="store.board[2]!" :index="2" />
      </div>
      <div class="cell piece-cell board-cell">
        <PieceCell :piece-state="store.board[1]!" :index="1" />
      </div>
      <div class="cell piece-cell board-cell">
        <PieceCell :piece-state="store.board[0]!" :index="0" />
      </div>
      <div class="cell blank-cell"></div>
      <div class="cell piece-cell hand-cell">
        <PieceCell :piece-state="store.allyHands[0]!" :index="12" />
      </div>
      <div class="cell piece-cell hand-cell">
        <PieceCell :piece-state="store.allyHands[1]!" :index="13" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.board-panel {
  align-content: start;
  background: #fffdf7;
  border: 1px solid #d9d1c0;
  border-radius: 18px;
  box-shadow: 0 24px 70px rgba(48, 40, 25, 0.11);
  display: grid;
  gap: 14px;
  min-width: 0;
  overflow: hidden;
  height: calc(100vh - 40px);
  padding: 24px;
}

.board-header {
  align-items: start;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  min-width: 0;
}

.eyebrow {
  color: #9a5a2a;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.13em;
  margin: 0 0 4px;
  text-transform: uppercase;
}

h2 {
  font-size: 26px;
  letter-spacing: -0.035em;
  line-height: 1.1;
  margin: 0;
}

.stats-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.stat-badge {
  background: #f0eadf;
  border-radius: 999px;
  color: #62594c;
  font-size: 12px;
  font-weight: 700;
  padding: 6px 10px;
}

.stat-badge.thinking {
  background: #f5dfb5;
  color: #814718;
}

.grid {
  background: #817566;
  border: 4px solid #6e5c48;
  border-radius: 12px;
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  justify-self: center;
  max-width: 100%;
  overflow: hidden;
  width: min(100%, calc((100vh - 132px) * 9 / 4));
}

.cell {
  aspect-ratio: 1 / 1;
}

.piece-cell {
  background-color: #ded6c8;
}

.blank-cell {
  background-color: #918679;
}

.board-cell {
  background-color: #e8bd70;
  border: 1px solid #817566;
}

.hand-cell {
  border: 1px solid #817566;
}

@media (max-width: 900px) {
  .grid {
    width: 100%;
  }

  .board-panel {
    height: auto;
  }
}
</style>
