<script setup lang="ts">
// Состояние кнопок игроков и таймеры — в шапке панели ведущего:
// на компьютере плашкой в самой шапке, на телефоне полоской под ней (только пока кнопки открыты или идёт время).
// Кто нажал и с каким отставанием — отдельным списком под вопросом (variant="ranking").
import { computed } from 'vue'
import { competitorMap, timerLeft } from '../../lib/util'
import Icon from '../../components/Icon.vue'
import { useHost } from './ctx'

const props = withDefaults(defineProps<{ variant?: 'pill' | 'strip' | 'ranking' }>(), { variant: 'pill' })

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
  buzz: 'на нажатие',
  answer: 'на ответ',
  main: 'время вопроса',
  final: 'финал',
  assign: 'выбор игроков',
}
const timers = computed(() =>
  Object.entries(s.value.timers).map(([name, t]) => ({ name, t, left: timerLeft(t, now.value) })),
)
// Полоска на телефоне нужна, только когда кнопки открыты, идёт ответ или тикает таймер.
const buzzing = computed(() => ['armed', 'collecting', 'answering'].includes(b.value.status))
const stripVisible = computed(() => buzzing.value || timers.value.some((t) => t.left > 0))
const stripText = computed(() => {
  if (buzzing.value) return status.value.text
  const t = timers.value.find((x) => x.left > 0)
  const label = t ? TIMER_LABEL[t.name] : null
  return label ? label[0].toUpperCase() + label.slice(1) : status.value.text
})
</script>

<template>
  <div v-if="props.variant !== 'ranking'" v-show="props.variant === 'pill' || stripVisible" :class="[props.variant, status.cls]">
    <span class="dot" />
    <span class="s-text ellipsis">{{ props.variant === 'strip' ? stripText : status.text }}</span>
    <template v-for="{ name, t, left } in timers" :key="name">
      <span v-if="props.variant === 'pill'" class="t-label">{{ TIMER_LABEL[name] ?? name }}</span>
      <span class="t-val nums" :class="{ warn: left < 5000 && left > 0 }" :title="TIMER_LABEL[name] ?? name">
        {{ Math.ceil(left / 1000) }} с
      </span>
      <button
        v-if="left > 0"
        class="btn small flat icon"
        :title="t.running ? 'Пауза (P)' : 'Продолжить (P)'"
        @click="run(t.running ? 'timer.pause' : 'timer.resume', { name })"
      >
        <Icon :name="t.running ? 'pause' : 'play'" />
      </button>
      <button class="btn small flat" title="Добавить 5 секунд" @click="run('timer.add', { name, seconds: 5 })">+5</button>
    </template>
  </div>

  <div v-else-if="b.ranking.length" class="ranking">
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
      <span class="nums small" title="Отставание от первого">{{ i === 0 ? '' : `+${r.delta} мс` }}</span>
      <span v-if="r.reaction != null" class="nums faint small" title="Время реакции">{{ r.reaction }} мс</span>
    </div>
    <p class="hint faint">Время учитывает задержку Wi-Fi каждого телефона.</p>
  </div>
</template>

<style scoped>
/* Плашка в шапке (компьютер) и полоска под шапкой (телефон). */
.pill,
.strip {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 800;
  background: var(--panel);
}
.pill {
  height: var(--h-md);
  padding: 0 4px 0 14px;
  border-radius: 12px;
  border: 1px solid var(--line);
  box-shadow: var(--shadow-sm);
  max-width: 100%;
  min-width: 0;
}
.strip {
  min-height: 44px;
  padding: 2px 10px 2px 14px;
  border-bottom: 1px solid var(--line);
}
.strip .s-text {
  flex: 1;
}
.dot {
  width: 11px;
  height: 11px;
  background: var(--muted);
}
.armed {
  background: var(--ok-soft);
  border-color: #b5e5c6;
  color: var(--ok-2);
}
.armed .dot {
  background: var(--ok);
  animation: pulse 0.8s infinite;
}
.answering {
  background: var(--gold-soft);
  border-color: #f6d58f;
  color: #92400e;
}
.answering .dot {
  background: var(--gold);
}
.closed .dot {
  background: var(--warn);
}
.test .dot {
  background: var(--info);
}
.pill .s-text {
  padding-right: 6px;
}
.t-label {
  margin-left: 4px;
  padding-left: 10px;
  border-left: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  font-weight: 600;
  font-size: 0.85rem;
  opacity: 0.8;
  white-space: nowrap;
}
.t-val {
  font-size: 1.15rem;
  color: var(--text);
  white-space: nowrap;
}
.t-val.warn {
  color: var(--bad);
}
.pill .btn,
.strip .btn {
  color: var(--text);
}

/* Кто нажал: под вопросом. */
.ranking {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 560px;
}
.rank {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 10px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-left: 5px solid var(--c);
}
.rank.first {
  background: color-mix(in srgb, var(--c) 14%, var(--panel));
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
