<script setup lang="ts">
// «Своя игра» у ведущего: раунды, табло, вопрос, финал, итоги.
import { computed, nextTick, ref, watch } from 'vue'
import { competitorMap, fmtScore, textOn } from '../../lib/util'
import BoardGrid from '../../components/BoardGrid.vue'
import Icon from '../../components/Icon.vue'
import HostJQuestion from './HostJQuestion.vue'
import HostJFinal from './HostJFinal.vue'
import HostJSport from './HostJSport.vue'
import { kindTitle, kindSuffix } from '../../lib/rules'
import { useHost } from './ctx'
import { askThemeName } from './themeName'

const { state, run } = useHost()
const s = computed(() => state.value!)
const j = computed(() => s.value.jeopardy!)
const comps = computed(() => competitorMap(s.value))
const chooser = computed(() => (j.value.chooserId ? comps.value.get(j.value.chooserId) : undefined))
const standings = computed(() => [...s.value.competitors].sort((a, b) => b.score - a.score))
// Темы по порядку (спортивная, «Эрудит-квартет», «Хамса») или табло, как на ТВ.
const sport = computed(() => j.value.format !== 'tv')
// Следующий раунд, который играется в этом формате.
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

function rename(ti: number) {
  const name = askThemeName(j.value, ti)
  if (name !== null) void run('j.theme.name', { round: j.value.roundIndex, theme: ti, name })
}

// На телефоне вкладки раундов прокручиваются вбок — текущую держим на виду.
const roundsEl = ref<HTMLElement | null>(null)
watch(
  () => [j.value.roundIndex, j.value.stage === 'results'],
  () =>
    nextTick(() => {
      const el = roundsEl.value
      const on = el?.querySelector<HTMLElement>('.round-tab.on')
      if (el && on && el.scrollWidth > el.clientWidth) {
        el.scrollTo({ left: on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' })
      }
    }),
  { immediate: true },
)
</script>

<template>
  <div class="jeo">
    <div ref="roundsEl" class="rounds">
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
      <BoardGrid :board="j.board" variant="host" clickable renamable @select="select" @rename="rename" />
      <p class="muted small legend">
        Щёлкните по теме, чтобы вписать её название из своего листа. Кот в мешке, аукцион и вопрос без риска отмечаются
        после выбора вопроса.
      </p>
    </template>

    <HostJQuestion v-else-if="j.stage === 'question' && j.question" />

    <div v-else-if="j.stage === 'roundEnd'" class="card center-card">
      <h2>Раунд «{{ j.rounds[j.roundIndex]?.name }}» окончен</h2>
      <button v-if="nextRound" class="btn primary huge" @click="run('j.nextRound')">
        <Icon name="next" /> Следующий раунд: {{ nextRound.name }} <span class="kbd">Enter</span>
      </button>
      <button v-else class="btn primary huge" @click="run('j.results')"><Icon name="trophy" /> Итоги игры</button>
    </div>

    <HostJFinal v-else-if="j.stage === 'final' && j.final" />

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
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.round-tab {
  padding: 0.45em 0.95em;
  border-radius: 99px;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--text);
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  box-shadow: var(--shadow-sm);
  transition:
    border-color 0.15s,
    background 0.15s;
}
.round-tab:hover:not(.on) {
  border-color: var(--line-2);
  background: var(--panel-2);
}
.round-tab.on {
  background: linear-gradient(135deg, #6366f1, var(--accent));
  color: var(--accent-text);
  border-color: transparent;
  box-shadow: 0 6px 14px -6px rgba(79, 70, 229, 0.7);
}
.kind-tag {
  font-size: 0.72em;
  font-weight: 600;
  opacity: 0.75;
}
.round-tab.done:not(.on) {
  color: var(--muted);
}
.round-tab.final:not(.on) {
  border-color: color-mix(in srgb, var(--gold) 60%, transparent);
  background: var(--gold-soft);
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
  border-radius: 12px;
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-left: 6px solid var(--c);
  font-size: 1.15rem;
}
.place {
  width: 2em;
}
@media (max-width: 760px) {
  .rounds {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    margin: 0 -14px;
    padding: 2px 14px 8px;
  }
  .rounds::-webkit-scrollbar {
    display: none;
  }
  .round-tab {
    flex: none;
    white-space: nowrap;
  }
  .center-card {
    padding: 20px 16px;
  }
  .center-card .btn.huge,
  .center-card .row .btn {
    width: 100%;
  }
  .chooser {
    font-size: 1rem;
  }
}
</style>
