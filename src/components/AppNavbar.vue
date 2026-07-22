<script setup lang="ts">
import { reportLoadState } from "@/reports/reportData";

type AppPage = "analytics" | "history" | "playground";

defineProps<{
  activePage: AppPage;
}>();

const navigationItems: { id: AppPage; label: string; description: string }[] = [
  { id: "analytics", label: "Thống kê", description: "Tổng quan phiên bản" },
  { id: "history", label: "Lịch sử", description: "Tra cứu từng trận" },
  { id: "playground", label: "Phòng đấu", description: "Chạy bot trực tiếp" },
];
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">
        <i></i><i></i><i></i><i></i>
      </span>
      <span>
        <strong>QAS Lab</strong>
        <small>Bot intelligence</small>
      </span>
    </div>

    <nav aria-label="Điều hướng chính">
      <p class="nav-label">Không gian làm việc</p>
      <a
        v-for="item in navigationItems"
        :key="item.id"
        :href="`#${item.id}`"
        class="nav-item"
        :class="{ active: activePage === item.id }"
        :aria-current="activePage === item.id ? 'page' : undefined"
      >
        <svg
          v-if="item.id === 'analytics'"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M4 19V9m6 10V5m6 14v-7m4 7H2" />
        </svg>
        <svg
          v-else-if="item.id === 'history'"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5m4-1v5l3 2" />
        </svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 4h8l1 3h3v13H4V7h3l1-3Zm0 8h8M9 9v6m6-6v6" />
        </svg>
        <span>
          <strong>{{ item.label }}</strong>
          <small>{{ item.description }}</small>
        </span>
      </a>
    </nav>

    <div class="data-status">
      <span class="status-icon" aria-hidden="true">
        <span></span>
      </span>
      <span>
        <strong>Nguồn dữ liệu</strong>
        <small v-if="reportLoadState.source === 'mysql'"
          >MySQL 8 · Đã đồng bộ</small
        >
        <small v-else :title="reportLoadState.error"
          >Seed dự phòng · MySQL lỗi</small
        >
      </span>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  background: #101916;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  color: #f4f7f5;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  padding: 26px 18px 20px;
  position: relative;
  z-index: 10;
}

.brand {
  align-items: center;
  display: flex;
  gap: 12px;
  padding: 0 8px 34px;
}

.brand > span:last-child,
.data-status > span:last-child,
.nav-item > span {
  display: grid;
  min-width: 0;
}

.brand strong {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 20px;
  letter-spacing: -0.025em;
}

.brand small {
  color: #82918c;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.brand-mark {
  background: #dca047;
  border-radius: 11px;
  display: grid;
  flex: 0 0 auto;
  gap: 3px;
  grid-template-columns: repeat(2, 6px);
  height: 38px;
  place-content: center;
  transform: rotate(45deg);
  width: 38px;
}

.brand-mark i {
  background: #101916;
  border-radius: 2px;
  height: 6px;
  width: 6px;
}

.brand-mark i:first-child,
.brand-mark i:last-child {
  opacity: 0.42;
}

nav {
  display: grid;
  gap: 7px;
}

.nav-label {
  color: #61706b;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.14em;
  margin: 0 10px 7px;
  text-transform: uppercase;
}

.nav-item {
  align-items: center;
  border: 1px solid transparent;
  border-radius: 12px;
  color: #8d9a96;
  display: flex;
  gap: 12px;
  min-height: 57px;
  padding: 10px 12px;
  text-decoration: none;
  transition:
    background-color 160ms ease,
    border-color 160ms ease,
    color 160ms ease;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.045);
  color: #e9eeeb;
}

.nav-item.active {
  background: #1e2b27;
  border-color: #2a3c36;
  color: #ffffff;
}

.nav-item.active::before {
  background: #dca047;
  border-radius: 0 4px 4px 0;
  content: "";
  height: 28px;
  left: 0;
  position: absolute;
  width: 3px;
}

.nav-item svg {
  fill: none;
  flex: 0 0 auto;
  height: 20px;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
  width: 20px;
}

.nav-item strong {
  font-size: 13px;
}

.nav-item small {
  color: #65736f;
  font-size: 10px;
  margin-top: 2px;
}

.nav-item.active small {
  color: #91a19b;
}

.data-status {
  align-items: center;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  display: flex;
  gap: 10px;
  margin-top: auto;
  padding: 12px;
}

.data-status strong {
  color: #c9d1ce;
  font-size: 11px;
}

.data-status small {
  color: #6f7e79;
  font-size: 10px;
  margin-top: 2px;
}

.status-icon {
  border: 1px solid #496159;
  border-radius: 50%;
  display: grid;
  flex: 0 0 auto;
  height: 28px;
  place-items: center;
  width: 28px;
}

.status-icon span {
  background: #e2ac5a;
  border-radius: 50%;
  box-shadow: 0 0 0 4px rgba(226, 172, 90, 0.12);
  height: 6px;
  width: 6px;
}

@media (max-width: 780px) {
  .sidebar {
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    border-right: 0;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    min-height: auto;
    padding: 12px 14px;
  }

  .brand {
    padding: 0 16px 0 0;
  }

  .brand > span:last-child,
  .data-status,
  .nav-label,
  .nav-item small {
    display: none;
  }

  .brand-mark {
    border-radius: 9px;
    height: 32px;
    width: 32px;
  }

  nav {
    display: grid;
    gap: 5px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .nav-item {
    gap: 7px;
    justify-content: center;
    min-height: 42px;
    padding: 7px 8px;
  }

  .nav-item.active::before {
    display: none;
  }

  .nav-item strong {
    font-size: 11px;
  }

  .nav-item svg {
    height: 17px;
    width: 17px;
  }
}

@media (max-width: 440px) {
  .brand {
    padding-right: 8px;
  }

  .nav-item svg {
    display: none;
  }
}
</style>
