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
        Chơi với bot hoặc tổ chức giải vô địch theo Elo tích lũy.
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
      <div class="seed-note">
        <strong>Giải đấu loại trực tiếp</strong>
        <span>
          Elo không reset. Hệ thống chốt 4 nhóm hạt giống khi mở giải và
          ghép hạt giống cao nhất với thấp nhất ở mỗi vòng.
        </span>
      </div>

      <label>
        <span>Số ván mỗi cặp</span>
        <input
          v-model.number="store.gamesPerPairing"
          type="number"
          min="1"
          max="20"
          step="1"
          :disabled="store.isMachineMatchRunning"
          data-testid="games-per-pairing"
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
          :disabled="
            !store.isReady ||
            !store.persistenceAvailable ||
            store.isMachineMatchRunning
          "
          data-testid="start-engine-match"
          @click="store.startMachineMatch()"
        >
          Bắt đầu giải
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

      <div class="seed-table" data-testid="seed-table">
        <div class="seed-table-header">
          <strong>Bảng hạt giống</strong>
          <span>{{ store.seedTableRows.length }} bot</span>
        </div>
        <div class="seed-list">
          <div
            v-for="entry in store.seedTableRows"
            :key="entry.entryId"
            class="seed-row"
            :class="entry.status"
          >
            <span class="seed-number">#{{ entry.seed }}</span>
            <span class="seed-bot">
              <strong>{{ entry.name }}</strong>
              <small>
                Nhóm {{ entry.seedGroup }} · Elo chốt {{ entry.seedRating }}
              </small>
            </span>
            <span class="seed-live">{{ entry.liveRating }}</span>
          </div>
        </div>
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
        <span>Vòng · cặp · ván</span>
        <strong data-testid="series-progress">
          {{ store.tournamentRound }} · {{ store.currentPairingNumber }}/{{
            store.totalPairingsInRound
          }}
          · {{ store.currentMatchNumber }}/{{ store.gamesPerPairing }}
        </strong>
      </div>
      <div v-if="store.gameMode === 'engine-vs-engine'">
        <span>Tỷ số cặp hiện tại</span>
        <strong data-testid="series-score">
          {{ store.currentPairingScoreOne }} –
          {{ store.currentPairingScoreTwo }}
        </strong>
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

.stats {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.seed-note {
  background: #f5ead5;
  border: 1px solid #e3cfa8;
  border-radius: 10px;
  color: #684c25;
  display: grid;
  font-size: 12px;
  gap: 4px;
  line-height: 1.45;
  padding: 11px;
}

.seed-table {
  border: 1px solid #d9d1c0;
  border-radius: 10px;
  overflow: hidden;
}

.seed-table-header,
.seed-row {
  align-items: center;
  display: grid;
}

.seed-table-header {
  background: #eee8dc;
  grid-template-columns: 1fr auto;
  padding: 9px 10px;
}

.seed-table-header span {
  color: #7a7164;
  font-size: 11px;
}

.seed-list {
  max-height: 230px;
  overflow-y: auto;
}

.seed-row {
  border-top: 1px solid #eee8dc;
  gap: 8px;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  padding: 8px 10px;
}

.seed-row:first-child {
  border-top: 0;
}

.seed-row.eliminated {
  opacity: 0.48;
}

.seed-row.champion {
  background: #e4f2e8;
}

.seed-number,
.seed-live {
  color: #8b3f1f;
  font-size: 12px;
  font-weight: 800;
}

.seed-bot {
  display: grid;
  min-width: 0;
}

.seed-bot strong,
.seed-bot small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.seed-bot small {
  color: #7a7164;
  font-size: 10px;
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
}

@media (max-width: 900px) {
  .panel {
    height: auto;
  }
}
</style>
