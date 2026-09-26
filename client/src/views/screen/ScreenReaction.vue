<script setup lang="ts">
// Экран для зрителей: тест реакции — сигнал, нажатия попытки и лучшие по среднему времени.
import { computed } from 'vue'
import type { GameState, ReactionView } from '../../lib/types'

const props = defineProps<{ state: GameState; r: ReactionView; now: number }>()

const playerOf = (id: string) => props.state.players.find((p) => p.id === id)
const teamOf = (id: string) => {
  const p = playerOf(id)
  return p?.teamId ? (props.state.teams.find((t) => t.id === p.teamId) ?? null) : null
}
const nameOf = (id: string) => playerOf(id)?.name ?? '—'
const colorOf = (id: string) => teamOf(id)?.color ?? playerOf(id)?.color ?? '#888'

const running = computed(() => props.r.stage === 'run')
const waiting = computed(() => running.value && props.r.signalAt != null && props.now < props.r.signalAt)
const signal = computed(() => {
  if (running.value) return waiting.value ? 'Внимание…' : 'Жми!'
  return props.r.stage === 'done' ? `Попытка ${props.r.no}` : 'Тест реакции'
})
const leaders = computed(() => props.r.stats.filter((x) => x.avg != null).slice(0, 10))
</script>

<template>
  <div class="rt">
    <div class="signal" :class="{ wait: waiting, go: running && !waiting }">{{ signal }}</div>
    <p v-if="r.stage === 'idle'" class="sub">Жмите на кнопку, как только она загорится зелёным. Нажатие до сигнала — фальстарт.</p>

    <div class="cols">
      <div v-if="r.current.length" class="col">
        <div class="col-title">{{ running ? `Попытка ${r.no}` : 'Итоги попытки' }}</div>
        <div
          v-for="(x, i) in r.current"
          :key="x.playerId"
          class="line"
          :class="{ first: i === 0 && x.reaction != null, early: x.early, miss: !x.early && x.reaction == null }"
          :style="{ '--c': colorOf(x.playerId) }"
        >
          <span class="pos nums">{{ x.reaction != null ? i + 1 : '' }}</span>
          <span class="name ellipsis">{{ nameOf(x.playerId) }}</span>
          <span class="ms nums">{{ x.early ? 'фальстарт' : x.reaction == null ? '—' : `${x.reaction} мс` }}</span>
        </div>
      </div>
      <div v-if="leaders.length" class="col">
        <div class="col-title">Лучшие по среднему</div>
        <div v-for="(x, i) in leaders" :key="x.playerId" class="line" :style="{ '--c': colorOf(x.playerId) }">
          <span class="pos nums">{{ i + 1 }}</span>
          <span class="name ellipsis">{{ nameOf(x.playerId) }}</span>
          <span class="ms nums">{{ x.avg }} мс</span>
          <span class="best nums">лучшее {{ x.best }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rt {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3vh;
  padding: 4vh 3vw;
}
.signal {
  font-size: clamp(3rem, 10vw, 10rem);
  font-weight: 900;
  letter-spacing: -0.02em;
  line-height: 1;
  color: var(--accent);
  text-align: center;
}
.signal.wait {
  color: #b45309;
}
.signal.go {
  color: var(--ok);
  animation: pop 0.3s ease;
}
.sub {
  margin: 0;
  font-size: clamp(1rem, 2vw, 1.8rem);
  color: var(--muted);
  text-align: center;
}
.cols {
  flex: 1;
  min-height: 0;
  width: min(1500px, 100%);
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 3vw;
  align-content: start;
}
.col {
  display: flex;
  flex-direction: column;
  gap: 1vh;
  min-width: 0;
}
.col-title {
  font-size: clamp(1rem, 1.8vw, 1.6rem);
  font-weight: 800;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.line {
  display: flex;
  align-items: center;
  gap: 1vw;
  padding: 0.5vh 1vw;
  border-radius: 14px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-left: 8px solid var(--c);
  box-shadow: var(--shadow-sm);
  font-size: clamp(1rem, 2.2vw, 2.2rem);
  font-weight: 700;
}
.line.first {
  background: color-mix(in srgb, var(--c) 16%, var(--panel));
  font-weight: 900;
}
.line.early .ms {
  color: var(--bad);
}
.line.miss {
  opacity: 0.55;
}
.pos {
  width: 1.5em;
  text-align: center;
  color: var(--muted);
}
.name {
  flex: 1;
  min-width: 0;
}
.ms {
  font-weight: 900;
}
.best {
  font-size: 0.6em;
  color: var(--muted);
  white-space: nowrap;
}
</style>
