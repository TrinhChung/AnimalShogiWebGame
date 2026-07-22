<script setup lang="ts">
import { computed } from 'vue'
import { useQuantumAnimalShogiStore } from '@/stores/QuantumAnimalShogiStore'

defineProps<{
  label: string
  disabled?: boolean
}>()

const selectedBotId = defineModel<string>({ required: true })
const store = useQuantumAnimalShogiStore()
const packagedBotOptions = computed(() => store.botCatalog.filter(({ kind }) => kind !== 'native'))
const nativeBotOptions = computed(() => store.botCatalog.filter(({ kind }) => kind === 'native'))
</script>

<template>
  <label class="bot-selector">
    <span>{{ label }}</span>
    <select v-model="selectedBotId" :disabled="disabled">
      <optgroup label="Bot chạy trực tiếp trên Web">
        <option v-for="bot in packagedBotOptions" :key="bot.id" :value="bot.id">
          {{ bot.name }}
        </option>
      </optgroup>
      <optgroup v-if="nativeBotOptions.length" label="Binary C++ Stage">
        <option v-for="bot in nativeBotOptions" :key="bot.id" :value="bot.id">
          {{ bot.name }}
        </option>
      </optgroup>
    </select>
    <small>{{ store.botDescription(selectedBotId) }}</small>
  </label>
</template>

<style scoped>
.bot-selector {
  display: grid;
  gap: 6px;
}

span {
  color: #7a7164;
  font-size: 11px;
  font-weight: 700;
}

select {
  background: #ffffff;
  border: 1px solid #d9d1c0;
  border-radius: 9px;
  color: #29241d;
  font: inherit;
  min-height: 40px;
  padding: 8px 11px;
  width: 100%;
}

small {
  color: #81786b;
  font-size: 11px;
  line-height: 1.4;
}

select:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
