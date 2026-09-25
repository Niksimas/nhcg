<script setup lang="ts">
// Состояние кнопок: кто нажал и с каким отставанием, таймеры, блокировки.
import { computed } from 'vue'
import { competitorMap, timerLeft } from '../../lib/util'
import Icon from '../../components/Icon.vue'
import { useHost } from './ctx'

const { state, now, run } = useHost()
const s = computed(() => state.value!)
const b = computed(() => s.value.buzzer)
const comps = computed(() => competitorMap(s.value))
const playerName = (id: string) => s.value.players.find((p) => p.id === id)?.name ?? ''

const STATUS: Record<string, { text: string; cls: string }> = {
  test: { text: 'Проверка кнопок', cls: 'test' },
  off: { text: 'Кнопки выключены', cls: 'off' },
  closed: { text: 'Кнопки закрыты', cls: 'closed' },
  armed: { text: 'Кнопки открыты', cls: 'armed' },
  collecting: { text: 'Определяем первого…', cls: 'armed' },
  answering: { text: 'Идёт ответ', cls: 'answering' },
}
const status = computed(() =>
  b.value.status === 'armed' && b.value.armedAt != null && now.value < b.value.armedAt
    ? { text: 'Кнопки сейчас откроются…', cls: 'closed' }
    : STATUS[b.value.status] ?? STATUS.off,
)

const TIMER_LABEL: Record<string, string> = {
  buzz: 'На нажатие',
  answer: 'На ответ',
  main: 'Время вопроса',
  final: 'Финал',
  assign: 'Выбор игроков',
}
const timers = computed(() =>
  Object.entries(s.value.timers).map(([name, t]) => ({ name, t, left: timerLeft(t, now.value) })),
)
</script>

<template>
  <div class="buzz">
    <div class="status" :class="status.cls">
      <span class="dot" />
      {{ status.text }}
    </div>

    <div v-for="{ name, t, left } in timers" :key="name" class="timer-row">
      <span class="t-label">{{ TIMER_LABEL[name] ?? name }}</span>
      <span class="t-val nums" :class="{ warn: left < 5000 && left > 0 }">{{ Math.ceil(left / 1000) }} с</span>
      <button
        v-if="left > 0"
        class="btn small flat icon"
        :title="t.running ? 'Пауза (P)' : 'Продолжить (P)'"
        @click="run(t.running ? 'timer.pause' : 'timer.resume', { name })"
      >
        <Icon :name="t.running ? 'pause' : 'play'" />
      </button>
      <button class="btn small flat" title="Добавить 5 секунд" @click="run('timer.add', { name, seconds: 5 })">+5</button>
    </div>

    <div v-if="b.ranking.length" class="ranking">
      <div class="label">Нажатия</div>
      <div
        v-for="(r, i) in b.ranking"
        :key="r.competitorId"
        class="rank"
        :class="{ first: b.winner?.competitorId === r.competitorId, late: r.late }"
        :style="{ '--c': comps.get(r.competitorId)?.color ?? '#888' }"
      >
        <span class="pos nums">{{ i + 1 }}</span>
        <span class="grow ellipsis">
          {{ comps.get(r.competitorId)?.name ?? '—' }}
          <span v-if="s.settings.teamMode" class="faint small">({{ playerName(r.playerId) }})</span>
        </span>
        <span class="nums small" :title="'Отставание от первого'">{{ i === 0 ? '' : `+${r.delta} мс` }}</span>
        <span v-if="r.reaction != null" class="nums faint small" title="Время реакции">{{ r.reaction }} мс</span>
      </div>
      <p class="hint faint">Время учитывает задержку Wi-Fi каждого телефона.</p>
    </div>
  </div>
</template>

<style scoped>
.buzz {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 800;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--panel-2);
}
.status .dot {
  width: 12px;
  height: 12px;
  background: var(--muted);
}
.status.armed {
  background: rgba(34, 197, 94, 0.18);
  color: #7ef0a8;
}
.status.armed .dot {
  background: var(--ok);
  animation: pulse 0.8s infinite;
}
.status.answering {
  background: rgba(255, 200, 61, 0.15);
  color: var(--accent);
}
.status.answering .dot {
  background: var(--accent);
}
.status.closed .dot {
  background: var(--warn);
}
.status.test .dot {
  background: var(--info);
}
.timer-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.t-label {
  flex: 1;
  color: var(--muted);
  font-size: 0.9rem;
}
.t-val {
  font-weight: 800;
  font-size: 1.2rem;
}
.t-val.warn {
  color: var(--bad);
}
.ranking {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rank {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--panel-2);
  border-left: 5px solid var(--c);
}
.rank.first {
  background: color-mix(in srgb, var(--c) 30%, var(--panel-2));
  font-weight: 800;
}
.rank.late {
  opacity: 0.6;
}
.pos {
  width: 1.3em;
  text-align: center;
  font-weight: 800;
}
.small {
  font-size: 0.8rem;
}
.hint {
  font-size: 0.75rem;
  margin: 2px 0 0;
}
</style>
