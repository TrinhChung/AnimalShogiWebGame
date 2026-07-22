<script setup lang="ts">
import BotSelector from "./BotSelector.vue";
import { useQuantumAnimalShogiStore } from "@/stores/QuantumAnimalShogiStore";

const store = useQuantumAnimalShogiStore();
</script>

<template>
  <section class="panel">
    <header>
      <p class="eyebrow">Quantum Animal Shogi</p>
      <h1>Web Solo</h1>
      <p class="subtitle">
        Chọn tự do bot Alpha-Beta, Random hoặc các binary C++ Stage.
      </p>
    </header>

    <div class="mode-switch" aria-label="Chế độ chơi">
      <button
        :class="{ active: store.gameMode === 'human-vs-engine' }"
        :disabled="store.isMachineMatchRunning || store.isThinking"
        data-testid="human-mode"
        @click="store.setGameMode('human-vs-engine')"
      >
        Người – Máy
      </button>
      <button
        :class="{ active: store.gameMode === 'engine-vs-engine' }"
        :disabled="store.isMachineMatchRunning || store.isThinking"
        data-testid="engine-mode"
        @click="store.setGameMode('engine-vs-engine')"
      >
        Máy – Máy
      </button>
    </div>

    <div class="connection-list">
      <div
        class="bridge-row"
        :class="{ connected: store.nativeBridgeAvailable }"
      >
        <span class="bridge-dot"></span>
        <span>
          {{
            store.nativeBridgeAvailable
              ? "C++ Stage đã kết nối"
              : "Chỉ dùng bot đóng gói Web"
          }}
        </span>
        <button
          v-if="!store.nativeBridgeAvailable"
          @click="store.loadNativeBots()"
        >
          Thử lại
        </button>
      </div>
      <div
        class="bridge-row"
        :class="{ connected: store.persistenceAvailable }"
      >
        <span class="bridge-dot"></span>
        <span>{{
          store.persistenceAvailable
            ? "MySQL đang lưu dữ liệu"
            : store.persistenceError
        }}</span>
      </div>
    </div>

    <div
      class="status-card"
      :class="{ error: store.initializationError || store.botError }"
    >
      <span>Trạng thái</span>
      <strong data-testid="game-status">{{ store.statusText }}</strong>
    </div>

    <div v-if="store.gameMode === 'human-vs-engine'" class="settings">
      <BotSelector
        v-model="store.humanBotId"
        label="Bot đối thủ"
        :disabled="store.isThinking"
      />

      <p class="hint">
        Bạn luôn đi trước. Chọn một quân hoặc quân trong tay, rồi chọn ô đích
        được tô sáng.
      </p>
    </div>

    <div v-else class="settings">
      <div class="engine-grid">
        <BotSelector
          v-model="store.playerOneBotId"
          label="Bot 1 · đi trước"
          :disabled="store.isMachineMatchRunning"
        />
        <BotSelector
          v-model="store.playerTwoBotId"
          label="Bot 2 · đi sau"
          :disabled="store.isMachineMatchRunning"
        />
      </div>

      <label>
        <span>Số ván lặp</span>
        <input
          v-model.number="store.repeatCount"
          type="number"
          min="1"
          max="500"
          step="1"
          :disabled="store.isMachineMatchRunning"
          data-testid="repeat-count"
        />
      </label>

      <label>
        <span>Khoảng nghỉ giữa hai nước</span>
        <select
          v-model.number="store.moveDelay"
          :disabled="store.isMachineMatchRunning"
        >
          <option :value="0">Không nghỉ</option>
          <option :value="150">150 ms</option>
          <option :value="350">350 ms</option>
          <option :value="700">700 ms</option>
          <option :value="1200">1,2 giây</option>
        </select>
      </label>

      <div class="button-row">
        <button
          class="primary"
          :disabled="!store.isReady || store.isMachineMatchRunning"
          data-testid="start-engine-match"
          @click="store.startMachineMatch()"
        >
          Bắt đầu
        </button>
        <button
          class="secondary"
          :disabled="!store.isMachineMatchRunning"
          data-testid="stop-engine-match"
          @click="store.stopMachineMatch()"
        >
          Dừng
        </button>
      </div>
    </div>

    <div class="stats">
      <div>
        <span>Nước đi</span>
        <strong data-testid="turn-count">{{ store.turn }}</strong>
      </div>
      <div>
        <span>Đến lượt</span>
        <strong data-testid="current-player">{{
          store.currentPlayerLabel
        }}</strong>
      </div>
      <div v-if="store.gameMode === 'engine-vs-engine'">
        <span>Ván lặp</span>
        <strong data-testid="series-progress">
          {{ store.currentMatchNumber }}/{{ store.repeatCount }} · xong
          {{ store.completedMatchCount }}
        </strong>
      </div>
      <div v-if="store.gameMode === 'engine-vs-engine'">
        <span>Tỷ số Bot 1 – Bot 2</span>
        <strong data-testid="series-score">{{ store.seriesScoreText }}</strong>
      </div>
      <div v-else>
        <span>Điểm của bạn</span>
        <strong>{{ store.reward }}</strong>
      </div>
    </div>

    <button
      class="reset"
      :disabled="!store.isReady || store.isThinking"
      @click="store.reset()"
    >
      Ván mới
    </button>
  </section>
</template>

<style scoped>
.panel {
  align-content: start;
  background: #fffdf7;
  border: 1px solid #d9d1c0;
  border-radius: 18px;
  box-shadow: 0 24px 70px rgba(48, 40, 25, 0.11);
  display: grid;
  gap: 16px;
  height: calc(100vh - 40px);
  min-height: 0;
  overflow-y: auto;
  padding: 24px;
}

header,
p {
  margin: 0;
}

.eyebrow {
  color: #9a5a2a;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

h1 {
  color: #29241d;
  font-size: 30px;
  letter-spacing: -0.04em;
  margin: 4px 0 6px;
}

.subtitle,
.hint {
  color: #746b5d;
  line-height: 1.55;
}

.mode-switch {
  background: #eee8dc;
  border-radius: 12px;
  display: grid;
  gap: 4px;
  grid-template-columns: 1fr 1fr;
  padding: 4px;
}

.mode-switch button {
  background: transparent;
  color: #665e51;
}

.mode-switch button.active {
  background: #ffffff;
  box-shadow: 0 4px 14px rgba(48, 40, 25, 0.1);
  color: #8b3f1f;
}

.bridge-row {
  align-items: center;
  color: #8b5c24;
  display: flex;
  font-size: 11px;
  font-weight: 700;
  gap: 7px;
}

.connection-list {
  display: grid;
  gap: 7px;
}

.bridge-row.connected {
  color: #28704c;
}

.bridge-dot {
  background: currentColor;
  border-radius: 50%;
  height: 8px;
  width: 8px;
}

.bridge-row button {
  background: transparent;
  color: inherit;
  min-height: auto;
  padding: 2px 4px;
  text-decoration: underline;
}

.status-card {
  background: #e4f2e8;
  border: 1px solid #bad8c2;
  border-radius: 12px;
  display: grid;
  gap: 4px;
  padding: 14px;
}

.status-card.error {
  background: #fff0ee;
  border-color: #e8b9b2;
}

.status-card span,
.stats span,
label span {
  color: #7a7164;
  font-size: 11px;
  font-weight: 700;
}

.settings,
label {
  display: grid;
  gap: 8px;
}

.settings {
  gap: 14px;
}

.engine-grid,
.stats {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.stats {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.stats div {
  background: #f5f1e8;
  border-radius: 10px;
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 10px;
}

.stats strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

select,
input,
button {
  border: 0;
  border-radius: 9px;
  font: inherit;
  min-height: 40px;
  padding: 8px 11px;
}

select,
input {
  background: #ffffff;
  border: 1px solid #d9d1c0;
  color: #29241d;
  width: 100%;
}

button {
  cursor: pointer;
  font-weight: 800;
}

button.primary {
  background: #a34723;
  color: #ffffff;
}

button.secondary,
button.reset {
  background: #5f6257;
  color: #ffffff;
}

.button-row {
  display: grid;
  gap: 8px;
  grid-template-columns: 1fr 1fr;
}

button:disabled,
select:disabled,
input:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

@media (max-width: 1100px) {
  .engine-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .panel {
    height: auto;
  }
}
</style>
