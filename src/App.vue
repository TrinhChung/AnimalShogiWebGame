<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import AppNavbar from "@/components/AppNavbar.vue";
import BenchmarkIntelligence from "@/components/BenchmarkIntelligence.vue";
import BotAlgorithmGuide from "@/components/BotAlgorithmGuide.vue";
import CurrentStageAlgorithms from "@/components/CurrentStageAlgorithms.vue";
import GameBoard from "@/components/GameBoard.vue";
import MatchHistory from "@/components/MatchHistory.vue";
import SoloControlPanel from "@/components/SoloControlPanel.vue";
import VersionAnalytics from "@/components/VersionAnalytics.vue";
import { loadReportData } from "@/reports/reportData";
import { useQuantumAnimalShogiStore } from "@/stores/QuantumAnimalShogiStore";

type AppPage =
  | "analytics"
  | "benchmarks"
  | "stage"
  | "algorithms"
  | "history"
  | "playground";

const appPages: AppPage[] = [
  "analytics",
  "benchmarks",
  "stage",
  "algorithms",
  "history",
  "playground",
];
const store = useQuantumAnimalShogiStore();
const initialized = ref(false);

const pageFromHash = (): AppPage => {
  const requestedPage = window.location.hash.slice(1);
  return appPages.includes(requestedPage as AppPage)
    ? (requestedPage as AppPage)
    : "analytics";
};

const activePage = ref<AppPage>(pageFromHash());

const synchronizePage = () => {
  activePage.value = pageFromHash();
};

onMounted(async () => {
  window.addEventListener("hashchange", synchronizePage);
  await Promise.all([store.initialize(), loadReportData()]);
  initialized.value = true;
});

onBeforeUnmount(() => {
  window.removeEventListener("hashchange", synchronizePage);
});
</script>

<template>
  <div class="app-shell">
    <AppNavbar :active-page="activePage" />
    <section class="page-content">
      <VersionAnalytics v-if="activePage === 'analytics'" />
      <BenchmarkIntelligence v-else-if="activePage === 'benchmarks'" />
      <CurrentStageAlgorithms v-else-if="activePage === 'stage'" />
      <BotAlgorithmGuide v-else-if="activePage === 'algorithms'" />
      <MatchHistory v-else-if="activePage === 'history'" />
      <main v-else class="playground-layout">
        <template v-if="initialized">
          <SoloControlPanel />
          <GameBoard />
        </template>
        <div v-else class="loading-state">
          <span></span>
          <strong>Đang khởi tạo engine…</strong>
        </div>
      </main>
    </section>
  </div>
</template>

<style>
:root {
  color-scheme: light;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
}

* {
  box-sizing: border-box;
}

html,
body,
#app {
  height: 100%;
  margin: 0;
}

body {
  background:
    radial-gradient(
      circle at 84% 0%,
      rgba(221, 176, 104, 0.11),
      transparent 27%
    ),
    #f2f4f1;
  color: #292f2c;
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
  font-size: 14px;
  overflow: hidden;
}

button,
input,
select {
  letter-spacing: 0;
}

button,
a,
input,
select {
  -webkit-tap-highlight-color: transparent;
}

button:focus-visible,
a:focus-visible,
input:focus-visible,
select:focus-visible {
  outline: 2px solid #d49a43;
  outline-offset: 2px;
}

.app-shell {
  display: grid;
  grid-template-columns: 218px minmax(0, 1fr);
  height: 100%;
}

.page-content {
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
}

.playground-layout {
  display: grid;
  gap: 20px;
  grid-template-columns: minmax(300px, 370px) minmax(0, 1fr);
  height: 100vh;
  overflow: hidden;
  padding: 20px;
}

.loading-state {
  align-items: center;
  color: #66716d;
  display: flex;
  gap: 12px;
  grid-column: 1 / -1;
  justify-content: center;
}

.loading-state span {
  animation: loading-spin 900ms linear infinite;
  border: 2px solid #dbe1dd;
  border-radius: 50%;
  border-top-color: #c58c3a;
  height: 22px;
  width: 22px;
}

@keyframes loading-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .playground-layout {
    grid-template-columns: 1fr;
    height: auto;
    min-height: 100%;
    overflow: visible;
  }
}

@media (max-width: 780px) {
  .app-shell {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .playground-layout {
    padding: 14px;
  }
}
</style>
