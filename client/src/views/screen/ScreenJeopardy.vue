<script setup lang="ts">
import { computed } from 'vue'
import type { GameState, JeopardyView } from '../../lib/types'
import { competitorMap, fmtScore, textOn } from '../../lib/util'
import BoardGrid from '../../components/BoardGrid.vue'
import ContentView from '../../components/ContentView.vue'
import ScoreStrip from '../../components/ScoreStrip.vue'
import TimerBar from '../../components/TimerBar.vue'

const props = defineProps<{
  state: GameState
  j: JeopardyView
  now: number
  flash: Record<string, number>
  replayKey: number
  mediaPaused: boolean
}>()

const comps = computed(() => competitorMap(props.state))
const nameOf = (id: string | null | undefined) => (id ? comps.value.get(id)?.name ?? '—' : '—')
const colorOf = (id: string | null | undefined) => (id ? comps.value.get(id)?.color ?? '#888' : '#888')
const scoreOf = (id: string) => comps.value.get(id)?.score ?? 0
const round = computed(() => props.j.rounds[props.j.roundIndex])
const q = computed(() => props.j.question)
const answering = computed(() => (q.value?.step === 'answering' ? q.value.responderId : null))
const mediaPlaying = computed(() => !props.mediaPaused && (q.value?.step === 'reading' || q.value?.step === 'buzzing'))
const questionTimer = computed(() =>
  q.value?.step === 'buzzing' ? props.state.timers.buzz : q.value?.step === 'answering' ? props.state.timers.answer : undefined,
)
const wrongAttempts = computed(() => q.value?.attempts.filter((a) => !a.correct) ?? [])
const rightAttempt = computed(() => q.value?.attempts.find((a) => a.correct) ?? null)
const final = computed(() => props.j.final)
const standings = computed(() => [...props.state.competitors].sort((a, b) => b.score - a.score))
const podium = computed(() => standings.value.slice(0, 3))

const SPECIAL: Record<string, { title: string; icon: string }> = {
  cat: { title: 'Кот в мешке', icon: '🐱' },
  auction: { title: 'Аукцион', icon: '💰' },
  norisk: { title: 'Вопрос без риска', icon: '🛡' },
}
</script>

<template>
  <div class="jeo">
    <!-- Табло -->
    <template v-if="j.stage === 'board' && j.board">
      <div class="round-title">{{ round?.name }}</div>
      <div class="board-wrap">
        <BoardGrid :board="j.board" variant="screen" />
      </div>
    </template>

    <!-- Вопрос -->
    <template v-else-if="j.stage === 'question' && q">
      <div class="q-head">
        <span class="q-theme">{{ q.themeName }}</span>
        <span class="q-price nums">{{ q.price }}</span>
      </div>

      <div v-if="q.step === 'special'" class="special">
        <div class="special-icon">{{ SPECIAL[q.type]?.icon }}</div>
        <div class="special-title">{{ SPECIAL[q.type]?.title }}</div>
        <div v-if="q.type === 'cat'" class="special-sub">
          Тема: <b>{{ q.catTheme }}</b><br />
          Стоимость: <b class="nums">{{ q.catPriceOptions ? q.catPriceOptions.join(' / ') : q.price }}</b>
          <div class="muted">Игрок, выбравший вопрос, отдаёт его другому</div>
        </div>
        <div v-else-if="q.type === 'auction'" class="special-sub">
          Игроки торгуются за право ответить.<br />Минимальная ставка — <b class="nums">{{ q.basePrice }}</b>
        </div>
        <div v-else class="special-sub">Цена удваивается, за ошибку очки не снимаются</div>
      </div>

      <div v-else class="q-body" :class="{ glow: q.step === 'buzzing' }">
        <template v-if="q.step !== 'reveal'">
          <ContentView :items="q.content" variant="screen" :playing="mediaPlaying" :replay-key="replayKey" />
        </template>
        <template v-else>
          <div class="answer-label">Правильный ответ</div>
          <div class="answer">{{ q.answer || '—' }}</div>
          <ContentView v-if="q.answerContent?.length" :items="q.answerContent" variant="screen" :playing="true" />
          <div v-if="rightAttempt" class="right-by" :style="{ '--c': colorOf(rightAttempt.competitorId) }">
            {{ nameOf(rightAttempt.competitorId) }}: +{{ rightAttempt.delta }}
          </div>
        </template>
      </div>

      <div class="q-status">
        <div
          v-if="answering"
          class="responder"
          :style="{ '--c': colorOf(answering), '--t': textOn(colorOf(answering)) }"
        >
          Отвечает: {{ nameOf(answering) }}
        </div>
        <div v-else-if="q.step === 'buzzing'" class="go">Жмите на кнопку!</div>
        <div v-if="wrongAttempts.length && q.step !== 'reveal'" class="wrongs">
          <span v-for="(a, i) in wrongAttempts" :key="i" class="wrong">✗ {{ nameOf(a.competitorId) }}</span>
        </div>
        <TimerBar v-if="questionTimer" class="q-timer" :timer="questionTimer" :now="now" big :warn-at="3000" />
      </div>
    </template>

    <!-- Конец раунда -->
    <template v-else-if="j.stage === 'roundEnd'">
      <div class="center-card">
        <div class="round-title">{{ round?.name }}</div>
        <div class="big-text">Раунд окончен!</div>
      </div>
    </template>

    <!-- Финал -->
    <template v-else-if="j.stage === 'final' && final">
      <div class="round-title">Финал</div>
      <div v-if="final.step === 'themes'" class="final-themes">
        <div v-for="t in final.themes" :key="t.index" class="final-theme" :class="{ removed: t.removed }">{{ t.name }}</div>
      </div>
      <template v-else>
        <div class="final-theme-name">{{ final.themeName }}</div>
        <div v-if="final.step === 'bets'" class="final-status">Участники делают ставки</div>
        <div v-else-if="final.step === 'question'" class="final-q">
          <ContentView :items="final.content" variant="screen" :playing="!mediaPaused" :replay-key="replayKey" />
          <TimerBar :timer="state.timers.final" :now="now" big :warn-at="10000" />
        </div>
        <div v-if="final.step === 'reveal' && final.answerShown" class="final-answer">
          Правильный ответ: <b>{{ final.answer }}</b>
          <ContentView v-if="final.answerContent?.length" :items="final.answerContent" variant="screen" :playing="true" />
        </div>
        <div class="final-players">
          <div
            v-for="p in final.participants"
            :key="p.competitorId"
            class="fp"
            :class="{ current: final.current === p.competitorId, ok: p.result === true, bad: p.result === false }"
            :style="{ '--c': colorOf(p.competitorId) }"
          >
            <div class="fp-name">{{ nameOf(p.competitorId) }}</div>
            <div class="fp-score nums">счёт {{ fmtScore(scoreOf(p.competitorId)) }}</div>
            <template v-if="final.step === 'reveal' && p.shown">
              <div class="fp-answer">{{ p.answer || '—' }}</div>
              <div class="fp-bet nums">
                Ставка {{ p.bet ?? 0 }}
                <span v-if="p.result === true"> ✓ +{{ p.bet }}</span>
                <span v-else-if="p.result === false"> ✗ −{{ p.bet ?? 0 }}</span>
              </div>
            </template>
            <div v-else-if="final.step === 'bets'" class="fp-state">{{ p.hasBet ? 'Ставка сделана ✓' : 'Думает…' }}</div>
            <div v-else-if="final.step === 'question'" class="fp-state">{{ p.hasAnswer ? 'Ответ записан ✓' : 'Пишет…' }}</div>
            <div v-else class="fp-state">…</div>
          </div>
        </div>
      </template>
    </template>

    <!-- Итоги -->
    <template v-else-if="j.stage === 'results'">
      <div class="round-title">Итоги игры</div>
      <div class="podium">
        <div
          v-for="(c, i) in podium"
          :key="c.id"
          class="pod"
          :class="`p${i + 1}`"
          :style="{ '--c': c.color, '--t': textOn(c.color) }"
        >
          <div class="medal">{{ ['🥇', '🥈', '🥉'][i] }}</div>
          <div class="pod-name">{{ c.name }}</div>
          <div class="pod-score nums">{{ fmtScore(c.score) }}</div>
        </div>
      </div>
      <ol v-if="standings.length > 3" class="rest" start="4">
        <li v-for="c in standings.slice(3)" :key="c.id">
          {{ c.name }} — <b class="nums">{{ fmtScore(c.score) }}</b>
        </li>
      </ol>
    </template>

    <ScoreStrip
      v-if="j.stage !== 'results' && j.stage !== 'final'"
      class="scores"
      size="large"
      :competitors="state.competitors"
      :chooser-id="j.stage === 'board' ? j.chooserId : null"
      :active-id="answering"
      :locked-out="state.buzzer.lockedOut"
      :flash="flash"
    />
  </div>
</template>

<style scoped>
.jeo {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 2vh;
  padding: 2.5vh 2.5vw;
}
.round-title {
  text-align: center;
  font-size: clamp(1.4rem, 3vw, 3rem);
  font-weight: 900;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.board-wrap {
  flex: 1;
  min-height: 0;
}
.q-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 2vw;
  font-size: clamp(1.2rem, 2.6vw, 2.6rem);
  font-weight: 800;
}
.q-theme {
  text-transform: uppercase;
  color: var(--muted);
}
.q-price {
  color: var(--accent);
}
.q-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2vh;
  padding: 2vh 3vw;
  border-radius: 24px;
  background: linear-gradient(180deg, var(--board), var(--board-2));
  border: 2px solid var(--board-edge);
  overflow: hidden;
  transition: box-shadow 0.3s;
}
.q-body.glow {
  box-shadow:
    0 0 0 4px rgba(63, 224, 127, 0.85),
    0 0 60px rgba(63, 224, 127, 0.45);
}
.answer-label {
  font-size: clamp(1rem, 1.8vw, 1.8rem);
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.answer {
  font-size: clamp(2rem, 5vw, 5rem);
  font-weight: 900;
  text-align: center;
  color: var(--accent);
  animation: pop 0.45s ease;
}
.right-by {
  font-size: clamp(1.2rem, 2.2vw, 2.2rem);
  font-weight: 800;
  padding: 0.2em 0.8em;
  border-radius: 99px;
  border: 3px solid var(--c);
}
.special {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 2vh 2vw;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2vh;
  border-radius: 24px;
  background: radial-gradient(circle at 50% 40%, #3b2a8f, #150f3d);
  border: 2px solid #6d55ff;
  animation: pop 0.5s ease;
  text-align: center;
}
.special-icon {
  font-size: clamp(3rem, 12vh, 9rem);
  line-height: 1;
}
.special-title {
  font-size: clamp(2rem, min(6vw, 10vh), 6rem);
  font-weight: 900;
  color: var(--accent);
  text-transform: uppercase;
  line-height: 1.1;
}
.special-sub {
  font-size: clamp(1.1rem, min(2.4vw, 4vh), 2.4rem);
  line-height: 1.35;
}
.q-status {
  display: flex;
  align-items: center;
  gap: 2vw;
  min-height: 3.2rem;
  flex-wrap: wrap;
}
.responder {
  padding: 0.3em 1em;
  border-radius: 14px;
  background: var(--c);
  color: var(--t);
  font-size: clamp(1.3rem, 2.8vw, 2.8rem);
  font-weight: 900;
  animation: pop 0.35s ease;
}
.go {
  font-size: clamp(1.3rem, 2.6vw, 2.6rem);
  font-weight: 900;
  color: var(--ok);
  animation: pulse 0.9s ease-in-out infinite;
}
.wrongs {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.wrong {
  color: #ff9a9a;
  font-size: clamp(1rem, 1.8vw, 1.8rem);
  font-weight: 700;
  text-decoration: line-through;
}
.q-timer {
  flex: 1;
  min-width: 240px;
}
.center-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2vh;
}
.big-text {
  font-size: clamp(2rem, 6vw, 6rem);
  font-weight: 900;
}
.final-themes {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.5vh;
}
.final-theme {
  font-size: clamp(1.5rem, 3.5vw, 3.5rem);
  font-weight: 800;
  padding: 0.2em 1.2em;
  border-radius: 14px;
  background: linear-gradient(180deg, var(--board), var(--board-2));
  border: 2px solid var(--board-edge);
  transition: opacity 0.3s;
}
.final-theme.removed {
  opacity: 0.2;
  text-decoration: line-through;
}
.final-theme-name {
  text-align: center;
  font-size: clamp(1.8rem, 4.5vw, 4.5rem);
  font-weight: 900;
}
.final-status {
  text-align: center;
  font-size: clamp(1.3rem, 2.6vw, 2.6rem);
  color: var(--muted);
}
.final-q {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3vh;
}
.final-answer {
  text-align: center;
  font-size: clamp(1.5rem, 3.2vw, 3.2rem);
}
.final-answer b {
  color: var(--accent);
}
.final-players {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  justify-content: center;
  margin-top: auto;
}
.fp {
  min-width: 220px;
  max-width: 420px;
  flex: 1 1 220px;
  padding: 14px 18px;
  border-radius: 16px;
  background: var(--panel);
  border: 3px solid transparent;
  border-top: 8px solid var(--c);
  text-align: center;
  transition: transform 0.25s;
}
.fp.current {
  transform: scale(1.06);
  border-color: var(--accent);
}
.fp.ok {
  background: rgba(34, 197, 94, 0.18);
}
.fp.bad {
  background: rgba(239, 68, 68, 0.18);
}
.fp-name {
  font-weight: 900;
  font-size: clamp(1.1rem, 2vw, 2rem);
}
.fp-score {
  font-size: clamp(1rem, 1.8vw, 1.8rem);
  font-weight: 800;
  color: var(--muted);
}
.fp-answer {
  font-size: clamp(1.2rem, 2.4vw, 2.4rem);
  font-weight: 700;
  color: var(--accent);
  margin: 6px 0;
  overflow-wrap: anywhere;
}
.fp-bet,
.fp-state {
  color: var(--muted);
  font-size: clamp(0.9rem, 1.6vw, 1.5rem);
}
.podium {
  flex: 1;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2vw;
}
.pod {
  width: min(26vw, 360px);
  border-radius: 20px 20px 0 0;
  background: var(--c);
  color: var(--t);
  text-align: center;
  padding: 2vh 1vw;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 1vh;
  animation: fadeUp 0.6s ease both;
}
.pod.p1 {
  order: 2;
  height: 62%;
}
.pod.p2 {
  order: 1;
  height: 48%;
  animation-delay: 0.3s;
}
.pod.p3 {
  order: 3;
  height: 38%;
  animation-delay: 0.6s;
}
.medal {
  font-size: clamp(2.5rem, 6vw, 6rem);
  line-height: 1;
}
.pod-name {
  font-size: clamp(1.3rem, 2.6vw, 2.8rem);
  font-weight: 900;
}
.pod-score {
  font-size: clamp(1.5rem, 3.4vw, 3.6rem);
  font-weight: 900;
}
.rest {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px 32px;
  font-size: clamp(1rem, 1.8vw, 1.8rem);
}
.scores {
  margin-top: auto;
}
</style>
