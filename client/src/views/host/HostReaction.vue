<script setup lang="ts">
// Тест реакции у ведущего: запуск попыток, нажатия в реальном времени, лучшее и среднее время каждого игрока.
import { computed } from 'vue'
import Icon from '../../components/Icon.vue'
import TimerBar from '../../components/TimerBar.vue'
import { useHost } from './ctx'

const { state, run, now } = useHost()
const s = computed(() => state.value!)
const r = computed(() => s.value.reaction!)

const playerOf = (id: string) => s.value.players.find((p) => p.id === id)
const teamOf = (id: string) => {
  const p = playerOf(id)
  return p?.teamId ? (s.value.teams.find((t) => t.id === p.teamId) ?? null) : null
}
const nameOf = (id: string) => playerOf(id)?.name ?? '—'
const colorOf = (id: string) => teamOf(id)?.color ?? playerOf(id)?.color ?? '#888'

const running = computed(() => r.value.stage === 'run')
// Сигнал назначен на ближайший момент — до него у игроков «Внимание…».
const waiting = computed(() => running.value && r.value.signalAt != null && now.value < r.value.signalAt)
const connected = computed(() => s.value.players.filter((p) => p.connected).length)
const best = computed(() => r.value.current.find((x) => x.reaction != null)?.reaction ?? null)
const hasStats = computed(() => r.value.stats.some((x) => x.tries || x.falseStarts || x.misses))
const fmt = (ms: number | null) => (ms == null ? '—' : `${ms} мс`)

async function reset() {
  if (!confirm('Сбросить результаты всех попыток?')) return
  await run('r.reset')
}
</script>

<template>
  <div class="rt">
    <div class="top-row">
      <div class="title">Тест реакции</div>
      <span class="muted">{{ r.attempts ? `попыток: ${r.attempts}` : 'попыток ещё не было' }}</span>
      <div class="grow" />
      <button v-if="r.attempts && !running" class="btn small ghost" @click="reset"><Icon name="trash" /> Сбросить результаты</button>
    </div>

    <div class="card control" :class="{ wait: waiting, go: running && !waiting }">
      <template v-if="!running">
        <p class="muted">
          Нажмите «Старт» — {{ s.settings.rRandom ? 'через 1,5–4 секунды' : 'через полсекунды' }} у всех телефонов
          одновременно загорится «Жми!». Программа запишет время каждого нажатия; нажатие до сигнала — фальстарт.
        </p>
        <button class="btn primary huge" :disabled="!connected" @click="run('r.start')">
          <Icon name="bolt" /> {{ r.attempts ? 'Ещё попытка' : 'Старт' }} <span class="kbd">Пробел</span>
        </button>
        <p v-if="!connected" class="muted small">Никто из игроков не на связи.</p>
      </template>
      <template v-else>
        <div class="signal">{{ waiting ? 'Внимание…' : 'Жмите!' }}</div>
        <TimerBar v-if="!waiting && s.timers.reaction" class="t" :timer="s.timers.reaction" :now="now" label="на нажатие" />
        <div class="muted">Нажали {{ r.current.length }} из {{ r.expected.length }}</div>
        <button class="btn big" @click="run('r.stop')"><Icon name="flag" /> Закончить попытку <span class="kbd">Esc</span></button>
      </template>
    </div>

    <div v-if="r.current.length" class="card">
      <div class="label">{{ running ? `Попытка ${r.no}` : `Попытка ${r.no} — итоги` }}</div>
      <div class="rows">
        <div
          v-for="(x, i) in r.current"
          :key="x.playerId"
          class="row-item"
          :class="{ early: x.early, miss: !x.early && x.reaction == null, first: i === 0 && x.reaction != null }"
          :style="{ '--c': colorOf(x.playerId) }"
        >
          <span class="pos nums">{{ x.reaction != null ? i + 1 : '' }}</span>
          <span class="grow ellipsis">
            {{ nameOf(x.playerId) }}
            <span v-if="teamOf(x.playerId)" class="faint small">({{ teamOf(x.playerId)?.name }})</span>
          </span>
          <span v-if="x.reaction != null && best != null && x.reaction > best" class="nums faint small">+{{ x.reaction - best }} мс</span>
          <span class="nums ms">{{ x.early ? 'фальстарт' : x.reaction == null ? 'не нажал' : `${x.reaction} мс` }}</span>
        </div>
      </div>
    </div>

    <div v-if="hasStats" class="card">
      <div class="label">Все попытки — по среднему времени</div>
      <div class="table-wrap">
        <table class="stats">
          <thead>
            <tr>
              <th>#</th>
              <th class="name">Игрок</th>
              <th title="Среднее время по попыткам, где игрок нажал вовремя">Среднее</th>
              <th title="Лучшее время">Лучшее</th>
              <th title="В последней попытке">Последнее</th>
              <th title="Сколько раз нажал вовремя">Нажал</th>
              <th title="Нажал до сигнала">Фальст.</th>
              <th title="Не нажал за отведённое время">Пропуск</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(x, i) in r.stats" :key="x.playerId" :style="{ '--c': colorOf(x.playerId) }">
              <td class="nums faint">{{ x.avg != null ? i + 1 : '' }}</td>
              <td class="name">
                <span class="dot" />
                <span class="ellipsis">{{ nameOf(x.playerId) }}</span>
              </td>
              <td class="nums strong">{{ fmt(x.avg) }}</td>
              <td class="nums">{{ fmt(x.best) }}</td>
              <td class="nums">{{ fmt(x.last) }}</td>
              <td class="nums">{{ x.tries }}</td>
              <td class="nums">{{ x.falseStarts || '' }}</td>
              <td class="nums">{{ x.misses || '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="hint faint">Время считается от момента, когда «Жми!» загорелось на телефоне игрока, с поправкой на задержку Wi-Fi.</p>
    </div>
  </div>
</template>

<style scoped>
.rt {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.top-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.title {
  font-size: 1.3rem;
  font-weight: 900;
}
.control {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  transition:
    background 0.15s,
    border-color 0.15s;
}
.control p {
  margin: 0;
}
.control.wait {
  background: var(--warn-soft);
  border-color: #f6d58f;
}
.control.go {
  background: var(--ok-soft);
  border-color: #b5e5c6;
}
.signal {
  font-size: 2.2rem;
  font-weight: 900;
}
.wait .signal {
  color: #92400e;
}
.go .signal {
  color: var(--ok-2);
}
.control .t {
  width: 100%;
}
.rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
}
.row-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-radius: 10px;
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-left: 5px solid var(--c);
}
.row-item.first {
  background: color-mix(in srgb, var(--c) 14%, var(--panel));
  font-weight: 800;
}
.row-item.early .ms {
  color: var(--bad);
}
.row-item.miss {
  opacity: 0.6;
}
.pos {
  width: 1.4em;
  text-align: center;
  font-weight: 800;
}
.ms {
  font-weight: 800;
  min-width: 5.5em;
  text-align: right;
}
.small {
  font-size: 0.8rem;
}
.table-wrap {
  overflow-x: auto;
}
.stats {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0 4px;
  margin-top: 4px;
}
.stats th {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  text-align: center;
  padding: 0 0.4em;
  white-space: nowrap;
}
.stats th.name {
  text-align: left;
}
.stats td {
  background: var(--panel-2);
  padding: 0.35em 0.5em;
  text-align: center;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
.stats td:first-child {
  border-left: 1px solid var(--line);
  border-radius: 10px 0 0 10px;
}
.stats td:last-child {
  border-right: 1px solid var(--line);
  border-radius: 0 10px 10px 0;
}
.stats td.name {
  text-align: left;
  max-width: 0;
  width: 35%;
}
.stats .dot {
  display: inline-block;
  width: 0.7em;
  height: 0.7em;
  border-radius: 50%;
  background: var(--c);
  margin-right: 0.5em;
  vertical-align: middle;
}
.stats .ellipsis {
  vertical-align: middle;
}
.strong {
  font-weight: 900;
  color: var(--accent);
}
.hint {
  font-size: 0.75rem;
  margin: 4px 0 0;
}
@media (max-width: 760px) {
  .control {
    align-items: stretch;
  }
  .stats td.name {
    width: auto;
    max-width: 9em;
  }
}
</style>
