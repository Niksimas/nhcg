<script setup lang="ts">
// Журнал игры — отдельное меню ведущего (окно на компьютере, вкладка на телефоне):
// события игры, а в «Брейн-ринге» ещё история боёв и вопросов.
import { computed, ref, watch } from 'vue'
import { competitorMap } from '../../lib/util'
import { useHost } from './ctx'

const { state } = useHost()
const s = computed(() => state.value!)
const br = computed(() => (s.value.mode === 'brainring' ? s.value.brainring : null))
const comps = computed(() => competitorMap(s.value))
const nameOf = (id: string | null | undefined) => (id ? comps.value.get(id)?.name ?? '—' : '—')

type Tab = 'log' | 'battles' | 'questions'
const tab = ref<Tab>('log')
watch(br, (v) => {
  if (!v) tab.value = 'log'
})

const log = computed(() => [...(s.value.log ?? [])].reverse())
const battles = computed(() => [...(br.value?.battles ?? [])].reverse())
const questions = computed(() => [...(br.value?.history ?? [])].reverse())
const RESULT: Record<string, string> = { correct: 'взят', burned: 'не взят', cancelled: 'снят' }

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
</script>

<template>
  <div class="history">
    <div v-if="br" class="seg" role="tablist">
      <button class="seg-btn" :class="{ on: tab === 'log' }" role="tab" @click="tab = 'log'">События</button>
      <button class="seg-btn" :class="{ on: tab === 'battles' }" role="tab" @click="tab = 'battles'">
        Бои <span class="cnt nums">{{ battles.length }}</span>
      </button>
      <button class="seg-btn" :class="{ on: tab === 'questions' }" role="tab" @click="tab = 'questions'">
        Вопросы <span class="cnt nums">{{ questions.length }}</span>
      </button>
    </div>

    <div v-if="tab === 'log'" class="list">
      <p v-if="!log.length" class="muted empty">Пока ничего не произошло.</p>
      <div v-for="(l, i) in log" :key="i" class="item">
        <span class="when faint nums">{{ fmtTime(l.at) }}</span>
        <span class="what">{{ l.text }}</span>
      </div>
    </div>

    <div v-else-if="tab === 'battles'" class="list">
      <p v-if="!battles.length" class="muted empty">Боёв ещё не было.</p>
      <div v-for="bt in battles" :key="bt.no" class="item">
        <span class="when faint nums">№{{ bt.no }}</span>
        <span class="what">{{ bt.teams.map((id) => `${nameOf(id)} ${bt.scores[id] ?? 0}`).join(' — ') }}</span>
        <span class="tag" :class="bt.winnerId ? 'win' : 'draw'">{{ bt.winnerId ? `победа: ${nameOf(bt.winnerId)}` : 'ничья' }}</span>
      </div>
    </div>

    <div v-else class="list">
      <p v-if="!questions.length" class="muted empty">Вопросов ещё не было.</p>
      <div v-for="(h, i) in questions" :key="i" class="item">
        <span class="when faint nums">№{{ h.index + 1 }}</span>
        <span class="what">{{ h.competitorId ? `${nameOf(h.competitorId)} +${h.value}` : '' }}</span>
        <span class="tag" :class="h.result">{{ RESULT[h.result] }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.seg {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 2px;
  height: var(--h-md);
  padding: 3px;
  border-radius: 12px;
  background: var(--panel-3);
}
.seg-btn {
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.seg-btn.on {
  background: var(--panel);
  color: var(--accent);
  box-shadow: var(--shadow-sm);
}
.cnt {
  font-size: 0.8em;
  opacity: 0.7;
}
.list {
  display: flex;
  flex-direction: column;
}
.item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 7px 2px;
  border-bottom: 1px solid var(--line);
  font-size: 0.92rem;
  line-height: 1.35;
}
.item:last-child {
  border-bottom: none;
}
.when {
  flex: none;
  min-width: 4.6em;
  font-size: 0.85em;
}
.what {
  flex: 1;
  min-width: 0;
}
.tag {
  flex: none;
  padding: 1px 8px;
  border-radius: 99px;
  background: var(--panel-3);
  color: var(--muted);
  font-size: 0.8rem;
  font-weight: 700;
}
.tag.win,
.tag.correct {
  background: var(--ok-soft);
  color: var(--ok-2);
}
.tag.cancelled {
  background: var(--warn-soft);
  color: var(--warn);
}
.empty {
  margin: 8px 0;
}
</style>
