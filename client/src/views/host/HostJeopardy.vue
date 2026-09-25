<script setup lang="ts">
// «Своя игра» у ведущего: раунды, табло, вопрос, финал, итоги.
import { computed } from 'vue'
import { competitorMap, fmtScore, textOn } from '../../lib/util'
import BoardGrid from '../../components/BoardGrid.vue'
import Icon from '../../components/Icon.vue'
import HostJQuestion from './HostJQuestion.vue'
import HostJFinal from './HostJFinal.vue'
import HostJSport from './HostJSport.vue'
import { kindTitle, kindSuffix } from '../../lib/rules'
import { useHost } from './ctx'

defineProps<{ hostPlays: boolean }>()
const { state, run } = useHost()
const s = computed(() => state.value!)
const j = computed(() => s.value.jeopardy!)
const comps = computed(() => competitorMap(s.value))
const chooser = computed(() => (j.value.chooserId ? comps.value.get(j.value.chooserId) : undefined))
const standings = computed(() => [...s.value.competitors].sort((a, b) => b.score - a.score))
const sport = computed(() => j.value.format === 'sport' || j.value.format === 'khamsa')
// Следующий раунд, который играется в этом формате (финал со ставками спортивный формат пропускает).
const nextRound = computed(() => {
  const i = j.value.rounds.findIndex((r, idx) => idx > j.value.roundIndex && !r.skip)
  return i >= 0 ? j.value.rounds[i] : null
})

async function goRound(index: number) {
  if (index === j.value.roundIndex && j.value.stage !== 'results') return
  const q = j.value.question
  if (j.value.stage === 'question' && q?.step !== 'reveal' && !confirm('Идёт вопрос. Перейти к другому раунду?')) return
  await run('j.round', { index })
}

async function select(id: string, played: boolean) {
  if (played && !confirm('Этот вопрос уже сыгран. Открыть его снова?')) return
  await run('j.select', { id, force: played })
}
</script>

<template>
  <div class="jeo">
    <div class="rounds">
      <template v-for="(r, i) in j.rounds" :key="i">
        <button
          v-if="!r.skip"
          class="round-tab"
          :class="{ on: i === j.roundIndex && j.stage !== 'results', done: r.complete, final: r.type === 'final' }"
          :title="r.kind ? `${kindTitle(r.kind, j.format)} раунд` : ''"
          @click="goRound(i)"
        >
          {{ r.name }}
          <span v-if="kindSuffix(r.name, r.kind, j.format)" class="kind-tag">{{ kindSuffix(r.name, r.kind, j.format) }}</span>
          <span v-if="r.complete" class="faint">✓</span>
        </button>
      </template>
      <button class="round-tab" :class="{ on: j.stage === 'results' }" @click="j.stage !== 'results' && run('j.results')">
        <Icon name="trophy" /> Итоги
      </button>
    </div>

    <HostJSport v-if="sport && ['board', 'assign', 'strike', 'theme'].includes(j.stage)" />

    <template v-else-if="j.stage === 'board' && j.board">
      <div class="board-head">
        <div v-if="chooser" class="chooser" :style="{ '--c': chooser.color, '--t': textOn(chooser.color) }">
          Выбирает: <b>{{ chooser.name }}</b>
        </div>
        <div v-else class="muted">Выбирающий не назначен — отметьте его в списке игроков.</div>
        <span class="muted small">
          Нажмите на цену, чтобы открыть вопрос.
          <template v-if="s.settings.phoneSelect">Выбирающий может выбрать вопрос и со своего телефона.</template>
        </span>
      </div>
      <BoardGrid :board="j.board" variant="host" clickable show-types @select="select" />
      <p class="muted small legend">🐱 — кот в мешке, 💰 — аукцион, 🛡 — вопрос без риска (игроки этих значков не видят)</p>
    </template>

    <HostJQuestion v-else-if="j.stage === 'question' && j.question" :host-plays="hostPlays" />

    <div v-else-if="j.stage === 'roundEnd'" class="card center-card">
      <h2>Раунд «{{ j.rounds[j.roundIndex]?.name }}» окончен</h2>
      <button v-if="nextRound" class="btn primary huge" @click="run('j.nextRound')">
        <Icon name="next" /> Следующий раунд: {{ nextRound.name }} <span class="kbd">Enter</span>
      </button>
      <button v-else class="btn primary huge" @click="run('j.results')"><Icon name="trophy" /> Итоги игры</button>
    </div>

    <HostJFinal v-else-if="j.stage === 'final' && j.final" :host-plays="hostPlays" />

    <div v-else-if="j.stage === 'results'" class="card center-card">
      <h2>Итоги игры</h2>
      <ol class="standings">
        <li v-for="(c, i) in standings" :key="c.id" :style="{ '--c': c.color }">
          <span class="place">{{ ['🥇', '🥈', '🥉'][i] ?? `${i + 1}.` }}</span>
          <span class="grow">{{ c.name }}</span>
          <b class="nums">{{ fmtScore(c.score) }}</b>
        </li>
      </ol>
      <div class="row wrap">
        <button class="btn" @click="run('j.board')"><Icon name="arrowLeft" /> Вернуться к игре</button>
        <button class="btn ghost" @click="run('game.lobby')"><Icon name="home" /> В лобби</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.jeo {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.rounds {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.round-tab {
  padding: 0.45em 0.9em;
  border-radius: 99px;
  border: 1px solid var(--line-2);
  background: var(--panel-2);
  color: var(--text);
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.round-tab.on {
  background: var(--accent);
  color: var(--accent-text);
  border-color: transparent;
}
.kind-tag {
  font-size: 0.72em;
  font-weight: 600;
  opacity: 0.75;
}
.round-tab.final:not(.on) {
  border-color: rgba(255, 200, 61, 0.5);
}
.board-head {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.chooser {
  padding: 6px 14px;
  border-radius: 10px;
  background: var(--c);
  color: var(--t);
  font-size: 1.1rem;
}
.small {
  font-size: 0.85rem;
}
.legend {
  margin: 0;
}
.center-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 28px;
  text-align: center;
}
.standings {
  list-style: none;
  padding: 0;
  margin: 0;
  width: 100%;
  max-width: 520px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.standings li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--panel-2);
  border-left: 6px solid var(--c);
  font-size: 1.15rem;
}
.place {
  width: 2em;
}
</style>
