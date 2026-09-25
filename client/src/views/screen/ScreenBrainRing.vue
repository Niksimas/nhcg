<script setup lang="ts">
import { computed } from 'vue'
import type { BrainRingView, GameState } from '../../lib/types'
import { competitorMap, fmtScore, textOn, timerLeft } from '../../lib/util'
import ContentView from '../../components/ContentView.vue'
import BrStandings from '../../components/BrStandings.vue'

const props = defineProps<{
  state: GameState
  br: BrainRingView
  now: number
  flash: Record<string, number>
  replayKey: number
  mediaPaused: boolean
}>()

const comps = computed(() => competitorMap(props.state))
const nameOf = (id: string | null | undefined) => (id ? comps.value.get(id)?.name ?? '—' : '—')
const b = computed(() => props.state.buzzer)
const answeringId = computed(() => (props.br.stage === 'answering' ? b.value.winner?.competitorId ?? null : null))
const main = computed(() => props.state.timers.main)
const left = computed(() => timerLeft(main.value, props.now))
const secs = computed(() => Math.ceil(left.value / 1000))
const fraction = computed(() => (main.value && main.value.total > 0 ? Math.min(1, left.value / main.value.total) : 0))
const R = 88
const C = 2 * Math.PI * R

const status = computed(() => {
  const br = props.br
  switch (br.stage) {
    case 'idle':
      return { text: 'Брейн-ринг', cls: 'idle' }
    case 'reading':
      return { text: 'Внимание, вопрос!', cls: 'reading' }
    case 'armed':
      // Игра по интернету: сигнал назначен на ближайший момент — до него «Внимание…».
      return b.value.armedAt != null && props.now < b.value.armedAt
        ? { text: 'Внимание…', cls: 'reading' }
        : { text: 'Время!', cls: 'armed' }
    case 'answering':
      return { text: `Отвечает: ${nameOf(answeringId.value)}`, cls: 'answering' }
    case 'reveal':
      return br.answeredBy
        ? { text: `Верно! ${nameOf(br.answeredBy)} +${lastValue.value}`, cls: 'correct' }
        : { text: br.carry ? `Вопрос не взят — очки переходят дальше` : 'Вопрос не взят', cls: 'burned' }
    case 'battleEnd': {
      const last = br.lastBattle
      return {
        text: last?.winnerId ? `Бой №${last.no}: победа «${nameOf(last.winnerId)}»` : `Бой №${last?.no ?? ''}: ничья`,
        cls: 'finished',
      }
    }
    case 'finished':
      return { text: br.winnerId ? `Победитель турнира: ${nameOf(br.winnerId)}!` : 'Итоги турнира', cls: 'finished' }
    default:
      return { text: '', cls: '' }
  }
})
const lastValue = computed(() => props.br.history[props.br.history.length - 1]?.value ?? props.br.value)
const revealed = computed(() => props.br.stage === 'reveal' || props.br.stage === 'battleEnd')
const showContent = computed(() => props.br.question?.content && (props.br.showQuestion || revealed.value))
// Во время боя на экране — только его команды со счётом боя; между боями — турнирная таблица.
const battle = computed(() => props.br.battle)
const shownTeams = computed(() => {
  const ids = battle.value?.teams ?? props.br.lastBattle?.teams ?? null
  return ids ? props.state.competitors.filter((c) => ids.includes(c.id)) : props.state.competitors
})
const scoreOf = (id: string) => {
  const bt = battle.value ?? props.br.lastBattle
  return bt ? bt.scores[id] ?? 0 : props.state.competitors.find((c) => c.id === id)?.score ?? 0
}
const showTable = computed(() => !battle.value && (props.br.stage === 'idle' || props.br.stage === 'finished'))
const battleInfo = computed(() => {
  const bt = battle.value
  if (!bt) return ''
  const n = Math.max(1, bt.played + (['reading', 'armed', 'answering'].includes(props.br.stage) ? 1 : 0))
  if (!bt.limit) return `Бой №${bt.no} · вопрос ${n}`
  return n > props.state.settings.brBattleQuestions ? `Бой №${bt.no} · дополнительный вопрос` : `Бой №${bt.no} · вопрос ${n} из ${bt.limit}`
})
const mediaPlaying = computed(() => !props.mediaPaused && (props.br.stage === 'reading' || props.br.stage === 'armed'))
const cols = computed(() => Math.min(4, Math.max(2, shownTeams.value.length)))
</script>

<template>
  <div class="br">
    <header class="head">
      <span class="label-big">Брейн-ринг</span>
      <span v-if="battle" class="qnum">{{ battleInfo }}</span>
      <span v-if="br.value > 1 && battle" class="value">Стоимость: {{ br.value }}</span>
    </header>

    <div v-if="showTable" class="table-wrap">
      <div class="status finished">{{ status.text }}</div>
      <BrStandings
        :standings="br.standings"
        :competitors="state.competitors"
        variant="screen"
        :winner-id="br.stage === 'finished' ? br.winnerId : null"
      />
    </div>

    <div v-else class="teams" :style="{ '--cols': cols }">
      <div
        v-for="c in shownTeams"
        :key="`${c.id}-${flash[c.id] ?? 0}`"
        class="team"
        :class="{
          active: c.id === answeringId,
          locked: b.lockedOut.includes(c.id),
          winner: br.stage === 'battleEnd' && br.lastBattle?.winnerId === c.id,
          flash: !!flash[c.id],
        }"
        :style="{ '--c': c.color, '--t': textOn(c.color) }"
      >
        <div class="team-name ellipsis">{{ c.name }}</div>
        <div class="team-score nums">{{ fmtScore(scoreOf(c.id)) }}</div>
        <div v-if="b.falseStarts.includes(c.id)" class="tag bad">Фальстарт</div>
        <div v-else-if="b.lockedOut.includes(c.id)" class="tag">Ответ неверный</div>
        <div v-else-if="c.id === answeringId" class="tag on">Отвечает!</div>
        <div v-else-if="!c.connected" class="tag warn">нет связи</div>
      </div>
    </div>

    <div v-if="!showTable" class="middle">
      <div class="clock" :class="[status.cls, { warn: br.stage === 'armed' && left <= 10000 }]">
        <svg viewBox="0 0 200 200">
          <circle cx="100" cy="100" :r="R" class="track" />
          <circle
            cx="100"
            cy="100"
            :r="R"
            class="progress"
            :stroke-dasharray="C"
            :stroke-dashoffset="C * (1 - fraction)"
          />
        </svg>
        <div class="secs nums">{{ main ? secs : '—' }}</div>
      </div>
      <div class="status" :class="status.cls">{{ status.text }}</div>
    </div>

    <div v-if="!showTable && (showContent || (revealed && br.question?.answer))" class="question" :class="{ reveal: revealed }">
      <ContentView
        v-if="showContent"
        :items="br.question?.content"
        variant="screen"
        :compact="revealed"
        :playing="mediaPlaying"
        :replay-key="replayKey"
      />
      <div v-if="revealed && br.question?.answer" class="answer">
        Ответ: <b>{{ br.question.answer }}</b>
      </div>
      <ContentView
        v-if="revealed && br.question?.answerContent?.length"
        :items="br.question.answerContent"
        variant="screen"
        compact
        :playing="true"
      />
    </div>
  </div>
</template>

<style scoped>
.table-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2vh;
  width: min(1200px, 100%);
  margin: 0 auto;
  overflow: hidden;
}

.br {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 2.5vh;
  padding: 2.5vh 3vw;
}
.head {
  display: flex;
  align-items: baseline;
  gap: 2vw;
  font-size: clamp(1rem, 2vw, 2rem);
  font-weight: 800;
}
.label-big {
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  flex: 1;
}
.qnum {
  color: var(--muted);
}
.value {
  color: var(--warn);
}
.teams {
  display: grid;
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  gap: 2vw;
}
.team {
  position: relative;
  border-radius: 22px;
  padding: 2vh 1.5vw 2.5vh;
  background: linear-gradient(180deg, color-mix(in srgb, var(--c) 35%, #0f1733), #0f1733);
  border: 4px solid color-mix(in srgb, var(--c) 70%, transparent);
  text-align: center;
  transition:
    transform 0.25s,
    opacity 0.25s;
}
.team-name {
  font-size: clamp(1.3rem, 3vw, 3.2rem);
  font-weight: 900;
}
.team-score {
  font-size: clamp(3rem, 9vw, 9rem);
  font-weight: 900;
  line-height: 1;
  color: #fff;
}
.team.active {
  background: var(--c);
  color: var(--t);
  transform: scale(1.05);
  box-shadow: 0 0 80px color-mix(in srgb, var(--c) 70%, transparent);
  animation: pop 0.35s ease;
}
.team.active .team-score {
  color: var(--t);
}
.team.locked {
  opacity: 0.45;
}
.team.winner {
  background: var(--c);
  color: var(--t);
  animation: pulse 1.2s ease-in-out infinite;
}
.team.winner .team-score {
  color: var(--t);
}
.team.flash {
  animation: flash 0.7s ease;
}
.tag {
  display: inline-block;
  margin-top: 1vh;
  padding: 0.15em 0.8em;
  border-radius: 99px;
  background: rgba(0, 0, 0, 0.3);
  font-weight: 800;
  font-size: clamp(0.9rem, 1.6vw, 1.6rem);
}
.tag.bad {
  background: var(--bad);
  color: #fff;
  animation: shake 0.4s ease;
}
.tag.on {
  background: rgba(0, 0, 0, 0.35);
}
.tag.warn {
  color: var(--warn);
}
.middle {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3vw;
}
.clock {
  position: relative;
  width: clamp(140px, 24vh, 300px);
  aspect-ratio: 1;
}
.clock svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}
.track {
  fill: none;
  stroke: rgba(255, 255, 255, 0.1);
  stroke-width: 14;
}
.progress {
  fill: none;
  stroke: var(--ok);
  stroke-width: 14;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.12s linear;
}
.clock.warn .progress {
  stroke: var(--bad);
}
.clock.answering .progress,
.clock.reading .progress {
  stroke: var(--muted);
}
.secs {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: clamp(2.5rem, 8vh, 6rem);
  font-weight: 900;
}
.clock.warn .secs {
  color: var(--bad);
}
.status {
  font-size: clamp(1.6rem, 4vw, 4.2rem);
  font-weight: 900;
  max-width: 55vw;
}
.status.armed {
  color: var(--ok);
  animation: pulse 0.9s ease-in-out infinite;
}
.status.correct {
  color: var(--ok);
}
.status.burned {
  color: var(--muted);
}
.status.finished {
  color: var(--accent);
}
.question {
  flex: 0 1 auto;
  max-height: 48vh;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2vh;
  padding: 2vh 3vw;
  border-radius: 22px;
  background: var(--panel);
  border: 1px solid var(--line);
  overflow: hidden;
}
.answer {
  font-size: clamp(1.5rem, min(3.4vw, 6vh), 3.4rem);
  text-align: center;
}
.answer b {
  color: var(--accent);
}
</style>
