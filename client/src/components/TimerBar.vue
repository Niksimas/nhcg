<script setup lang="ts">
import { computed } from 'vue'
import type { TimerState } from '../lib/types'
import { timerLeft } from '../lib/util'

const props = withDefaults(
  defineProps<{ timer: TimerState | null | undefined; now: number; label?: string; big?: boolean; warnAt?: number }>(),
  { label: '', big: false, warnAt: 5000 },
)

const left = computed(() => timerLeft(props.timer, props.now))
const fraction = computed(() => {
  const t = props.timer
  if (!t || t.total <= 0) return 0
  return Math.max(0, Math.min(1, left.value / t.total))
})
const seconds = computed(() => Math.ceil(left.value / 1000))
const warn = computed(() => !!props.timer && left.value <= props.warnAt && left.value > 0)
</script>

<template>
  <div v-if="timer" class="timer" :class="{ big, warn, paused: !timer.running, done: left <= 0 }">
    <div class="bar">
      <div class="fill" :style="{ transform: `scaleX(${fraction})` }" />
    </div>
    <div class="num nums">
      <span v-if="label" class="lbl">{{ label }}</span>
      <span>{{ seconds }}</span>
      <span v-if="!timer.running && left > 0" class="lbl">пауза</span>
    </div>
  </div>
</template>

<style scoped>
.timer {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.bar {
  flex: 1;
  height: 10px;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}
.big .bar {
  height: 16px;
}
.fill {
  height: 100%;
  width: 100%;
  transform-origin: left center;
  background: linear-gradient(90deg, var(--ok), #7ee787);
  transition: transform 0.12s linear;
}
.warn .fill {
  background: linear-gradient(90deg, var(--bad), var(--warn));
}
.paused .fill {
  background: var(--muted);
}
.num {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  font-weight: 800;
  font-size: 1.3rem;
  min-width: 3.2em;
  justify-content: flex-end;
}
.big .num {
  font-size: 2rem;
}
.warn .num {
  color: var(--bad);
}
.lbl {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--muted);
}
</style>
