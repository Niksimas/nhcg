<script setup lang="ts">
// Телефон капитана: кто из игроков команды играет каждую тему раунда (или объявленную тему).
import { computed } from 'vue'
import type { MeView } from '../../lib/types'
import TimerBar from '../../components/TimerBar.vue'
import type { TimerState } from '../../lib/types'

type Captain = NonNullable<NonNullable<MeView['jeopardy']>['captain']>

const props = defineProps<{ captain: Captain; timer?: TimerState; now: number; busy: boolean }>()
const emit = defineEmits<{ pick: [themeIndex: number, playerId: string]; ready: [] }>()

const usedBy = computed(() => {
  const map = new Map<string, number>()
  for (const [ti, pid] of Object.entries(props.captain.picks)) map.set(pid, Number(ti))
  return map
})
const allPicked = computed(() => props.captain.themes.every((t) => props.captain.picks[t.index]))

function label(t: { index: number; name: string | null }) {
  return t.name ?? `Тема ${t.index + 1} (название пока скрыто)`
}
</script>

<template>
  <div class="cap">
    <div class="cap-title">Вы капитан — кто играет?</div>
    <TimerBar v-if="timer" :timer="timer" :now="now" />
    <p v-if="captain.unique" class="muted small">Каждый игрок играет не больше одной темы в раунде.</p>
    <div v-for="t in captain.themes" :key="t.index" class="theme">
      <div class="theme-name" :class="{ secret: !t.name }">{{ label(t) }}</div>
      <div class="members">
        <button
          v-for="m in captain.members"
          :key="m.id"
          class="member"
          :class="{
            on: captain.picks[t.index] === m.id,
            used: captain.unique && usedBy.has(m.id) && usedBy.get(m.id) !== t.index,
          }"
          :disabled="captain.ready || busy || (captain.unique && m.played)"
          @click="emit('pick', t.index, m.id)"
        >
          {{ m.name }}
          <span v-if="m.played && captain.unique" class="tag">уже играл</span>
          <span v-else-if="captain.unique && usedBy.has(m.id) && usedBy.get(m.id) !== t.index" class="tag">
            тема {{ (usedBy.get(m.id) ?? 0) + 1 }}
          </span>
        </button>
      </div>
    </div>
    <button v-if="!captain.ready" class="btn primary big block" :disabled="busy" @click="emit('ready')">Готово</button>
    <p v-if="!captain.ready && !allPicked" class="muted small">На темы без выбора игрока программа назначит сама.</p>
    <div v-if="captain.ready" class="sent">✓ Выбор отправлен. Ждём других капитанов.</div>
  </div>
</template>

<style scoped>
.cap {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(520px, 100%);
  margin: 0 auto;
  padding: 4px 4px 12px;
  user-select: none;
}
.cap-title {
  font-size: 1.3rem;
  font-weight: 900;
  text-align: center;
}
.small {
  font-size: 0.85rem;
  margin: 0;
  text-align: center;
}
.theme {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border-radius: 12px;
  background: var(--panel-2);
}
.theme-name {
  font-weight: 800;
  text-transform: uppercase;
  font-size: 0.95rem;
}
.theme-name.secret {
  font-style: italic;
  opacity: 0.75;
  text-transform: none;
}
.members {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.member {
  padding: 8px 12px;
  border-radius: 10px;
  border: 2px solid var(--line-2);
  background: var(--bg-2);
  color: var(--text);
  font-weight: 700;
  font-size: 1rem;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.member.on {
  background: var(--accent);
  color: var(--accent-text);
  border-color: transparent;
}
.member.used:not(.on) {
  opacity: 0.6;
}
.member:disabled {
  opacity: 0.45;
}
.member.on:disabled {
  opacity: 1;
}
.tag {
  font-size: 0.72rem;
  font-weight: 600;
  opacity: 0.8;
}
.sent {
  text-align: center;
  font-weight: 700;
  color: #7bf0a8;
}
</style>
