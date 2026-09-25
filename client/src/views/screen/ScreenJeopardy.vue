<script setup lang="ts">
// Экран для зрителей: «Своя игра» и «Хамса». Вопросы ведущий читает вслух — на экране тема, цена и ход вопроса.
import { computed } from 'vue'
import type { GameState, JeopardyView } from '../../lib/types'
import { competitorMap, fmtScore, textOn } from '../../lib/util'
import BoardGrid from '../../components/BoardGrid.vue'
import ScoreStrip from '../../components/ScoreStrip.vue'
import TimerBar from '../../components/TimerBar.vue'
import { kindSuffix } from '../../lib/rules'

const props = defineProps<{
  state: GameState
  j: JeopardyView
  now: number
  flash: Record<string, number>
}>()

const comps = computed(() => competitorMap(props.state))
const nameOf = (id: string | null | undefined) => (id ? comps.value.get(id)?.name ?? '—' : '—')
const colorOf = (id: string | null | undefined) => (id ? comps.value.get(id)?.color ?? '#888' : '#888')
const scoreOf = (id: string) => comps.value.get(id)?.score ?? 0
const round = computed(() => props.j.rounds[props.j.roundIndex])
const q = computed(() => props.j.question)
const answering = computed(() => (q.value?.step === 'answering' ? q.value.responderId : null))
const questionTimer = computed(() =>
  q.value?.step === 'buzzing' ? props.state.timers.buzz : q.value?.step === 'answering' ? props.state.timers.answer : undefined,
)
const wrongAttempts = computed(() => q.value?.attempts.filter((a) => !a.correct) ?? [])
const rightAttempt = computed(() => q.value?.attempts.find((a) => a.correct) ?? null)
const final = computed(() => props.j.final)
const standings = computed(() => [...props.state.competitors].sort((a, b) => b.score - a.score))
const podium = computed(() => standings.value.slice(0, 3))

// Спортивный формат: кто за столом, объявленная тема, выбор игроков.
const kindLabel = computed(() => {
  const w = kindSuffix(round.value?.name, props.j.kind, props.j.format)
  return w ? `${w} раунд` : ''
})
const finalTitle = computed(() => (props.j.format === 'khamsa' ? round.value?.name || 'Хамса' : 'Финал'))
const tableList = computed(() =>
  props.j.table
    ? props.state.teams
        .filter((t) => props.j.table?.[t.id])
        .map((t) => ({ id: t.id, color: t.color, team: t.name, name: props.j.table?.[t.id]?.name ?? '' }))
    : [],
)
const theme = computed(() => (props.j.themeIndex != null ? props.j.board?.[props.j.themeIndex] ?? null : null))
const phase = computed(() => props.j.phase)
const teamsInPlay = computed(() => props.state.teams.filter((t) => props.state.players.some((p) => p.teamId === t.id)))
// «Хамса», четвёртый раунд: чья очередь убирать тему и кто играет раунд от каждой команды.
const strike = computed(() => (props.j.stage === 'strike' ? props.j.strike ?? null : null))
const leaderOf = (teamId: string) => props.j.leaders?.[teamId]?.name ?? ''

const SPECIAL: Record<string, { title: string; icon: string }> = {
  cat: { title: 'Кот в мешке', icon: '🐱' },
  auction: { title: 'Аукцион', icon: '💰' },
  norisk: { title: 'Вопрос без риска', icon: '🛡' },
}
</script>

<template>
  <div class="jeo">
    <!-- Табло -->
    <!-- Капитаны выбирают игроков (спортивный формат) -->
    <template v-if="j.stage === 'assign' && phase">
      <div class="round-title">{{ round?.name }} <span v-if="kindLabel" class="kind">· {{ kindLabel }}</span></div>
      <div class="assign-card">
        <template v-if="phase.scope === 'theme'">
          <div class="muted-label">Тема</div>
          <div class="theme-big">{{ phase.themes[0]?.name ?? '…' }}</div>
          <div class="assign-sub">Капитаны выбирают, кто будет играть эту тему</div>
        </template>
        <template v-else-if="phase.scope === 'leader'">
          <div class="assign-sub">Капитаны выбирают одного игрока на весь раунд</div>
          <div v-if="j.board" class="slots">
            <div v-for="(t, ti) in j.board" :key="ti" class="slot">{{ t.name ?? `Тема ${ti + 1}` }}</div>
          </div>
          <div class="muted-label">Потом команды по очереди уберут темы — останется одна</div>
        </template>
        <template v-else>
          <div class="assign-sub">Капитаны распределяют игроков по темам</div>
          <div class="slots">
            <div v-for="t in phase.themes" :key="t.index" class="slot" :class="{ secret: !t.name }">
              {{ t.name ?? `Тема ${t.index + 1}` }}
            </div>
          </div>
          <div v-if="phase.themes.some((t) => !t.name)" class="muted-label">Названия тем откроются, когда игроки сядут за стол</div>
        </template>
        <TimerBar v-if="state.timers.assign" class="assign-timer" :timer="state.timers.assign" :now="now" big :warn-at="5000" />
        <div class="ready-row">
          <span
            v-for="t in teamsInPlay"
            :key="t.id"
            class="ready-chip"
            :class="{ on: phase.ready.includes(t.id) }"
            :style="{ '--c': t.color, '--t': textOn(t.color) }"
          >
            {{ t.name }} {{ phase.ready.includes(t.id) ? '✓' : '…' }}
          </span>
        </div>
      </div>
    </template>

    <!-- «Хамса», четвёртый раунд: команды по очереди убирают темы -->
    <template v-else-if="strike && j.board">
      <div class="round-title">{{ round?.name }} <span v-if="kindLabel" class="kind">· {{ kindLabel }}</span></div>
      <div class="assign-card strike-card">
        <div class="assign-sub">Команды по очереди убирают темы</div>
        <div class="strike-list">
          <div v-for="(t, ti) in j.board" :key="ti" class="strike-theme" :class="{ struck: t.struck }">{{ t.name ?? `Тема ${ti + 1}` }}</div>
        </div>
        <div class="muted-label">Убирает тему: {{ nameOf(strike.current) }}</div>
        <div class="ready-row">
          <span
            v-for="id in strike.order"
            :key="id"
            class="ready-chip small"
            :class="{ on: id === strike.current }"
            :style="{ '--c': colorOf(id), '--t': textOn(colorOf(id)) }"
            :title="leaderOf(id) ? `Раунд играет ${leaderOf(id)}` : ''"
          >
            {{ nameOf(id) }}<span v-if="leaderOf(id)" class="faint-team"> · {{ leaderOf(id) }}</span>
          </span>
        </div>
      </div>
    </template>

    <!-- Тема объявлена (спортивный формат) -->
    <template v-else-if="j.stage === 'theme' && theme">
      <div class="round-title">{{ round?.name }} <span v-if="kindLabel" class="kind">· {{ kindLabel }}</span></div>
      <div class="assign-card">
        <div class="muted-label">Тема</div>
        <div class="theme-big">{{ theme.name ?? '…' }}</div>
        <div class="prices nums">
          <span v-for="qq in theme.questions" :key="qq.id" class="price-chip" :class="{ played: qq.played }">{{ qq.price }}</span>
        </div>
        <div v-if="tableList.length" class="table-list">
          <div class="muted-label">За столом</div>
          <div class="ready-row">
            <span v-for="t in tableList" :key="t.id" class="ready-chip on" :style="{ '--c': t.color, '--t': textOn(t.color) }">
              {{ t.name }} <span class="faint-team">· {{ t.team }}</span>
            </span>
          </div>
        </div>
      </div>
    </template>

    <template v-else-if="j.stage === 'board' && j.board">
      <div class="round-title">{{ round?.name }} <span v-if="kindLabel" class="kind">· {{ kindLabel }}</span></div>
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
      <div v-if="tableList.length" class="table-line">
        <span v-for="t in tableList" :key="t.id" class="ready-chip on small" :style="{ '--c': t.color, '--t': textOn(t.color) }">
          {{ t.name }}
        </span>
      </div>

      <div v-if="q.step === 'special'" class="special">
        <div class="special-icon">{{ SPECIAL[q.type]?.icon }}</div>
        <div class="special-title">{{ SPECIAL[q.type]?.title }}</div>
        <div v-if="q.type === 'cat'" class="special-sub">
          Игрок, выбравший вопрос, отдаёт его другому.<br />
          Стоимость: <b class="nums">{{ q.price }}</b>
        </div>
        <div v-else-if="q.type === 'auction'" class="special-sub">
          Игроки торгуются за право ответить.<br />Минимальная ставка — <b class="nums">{{ q.basePrice }}</b>
        </div>
        <div v-else class="special-sub">Цена удваивается, за ошибку очки не снимаются</div>
      </div>

      <div v-else class="q-body" :class="{ glow: q.step === 'buzzing' }">
        <div class="q-number">Вопрос {{ q.number }} · <span class="nums">{{ q.price }}</span></div>
        <div
          v-if="answering"
          class="responder"
          :style="{ '--c': colorOf(answering), '--t': textOn(colorOf(answering)) }"
        >
          Отвечает: {{ nameOf(answering) }}
        </div>
        <div v-else-if="q.step === 'reading'" class="q-state">Слушайте вопрос</div>
        <div v-else-if="q.step === 'buzzing'" class="q-state go">Жмите на кнопку!</div>
        <template v-else-if="q.step === 'reveal'">
          <div v-if="rightAttempt" class="right-by" :style="{ '--c': colorOf(rightAttempt.competitorId) }">
            {{ nameOf(rightAttempt.competitorId) }}: +{{ rightAttempt.delta }}
          </div>
          <div v-else class="q-state muted">Вопрос не взят</div>
        </template>
      </div>

      <div class="q-status">
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
      <div class="round-title">{{ finalTitle }}</div>
      <div v-if="final.step === 'themes'" class="final-themes">
        <div v-for="t in final.themes" :key="t.index" class="final-theme" :class="{ removed: t.removed }">{{ t.name }}</div>
      </div>
      <template v-else>
        <div class="final-theme-name">{{ final.themeName }}</div>
        <div v-if="final.step === 'bets'" class="final-status">Участники делают ставки</div>
        <div v-else-if="final.step === 'question'" class="final-q">
          <div class="final-status">Слушайте вопрос — ответ пишите на телефоне</div>
          <TimerBar :timer="state.timers.final" :now="now" big :warn-at="10000" />
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
      :chooser-id="j.stage === 'board' && j.format === 'tv' ? j.chooserId : null"
      :active-id="answering"
      :locked-out="state.buzzer.lockedOut"
      :flash="flash"
    />
  </div>
</template>

<style scoped>
.kind {
  font-size: 0.6em;
  opacity: 0.75;
  text-transform: none;
}
.assign-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2.4vh;
  text-align: center;
  width: min(1300px, 100%);
  margin: 0 auto;
}
.assign-timer {
  width: min(900px, 90%);
}
.muted-label {
  font-size: clamp(1rem, 1.8vw, 1.6rem);
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.theme-big {
  font-size: clamp(2.4rem, 6vw, 6rem);
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: -0.01em;
  line-height: 1.05;
  background: linear-gradient(100deg, #4f46e5, #7c3aed);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.assign-sub {
  font-size: clamp(1.4rem, 2.8vw, 2.6rem);
  font-weight: 800;
}
.slots {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 1.2vw;
}
.slot {
  padding: 0.6em 1.2em;
  border-radius: 16px;
  background: linear-gradient(180deg, var(--board), var(--board-2));
  border: 1px solid var(--board-edge);
  box-shadow: var(--shadow);
  font-size: clamp(1.1rem, 2.2vw, 2rem);
  font-weight: 800;
  text-transform: uppercase;
  color: #312e81;
}
.slot.secret {
  opacity: 0.75;
  font-style: italic;
}
.ready-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.8vw;
}
.ready-chip {
  padding: 0.35em 0.9em;
  border-radius: 99px;
  border: 3px solid var(--c);
  background: var(--panel);
  font-size: clamp(1rem, 2vw, 1.8rem);
  font-weight: 800;
}
.ready-chip.on {
  background: var(--c);
  color: var(--t);
  box-shadow: 0 8px 20px -10px var(--c);
}
.ready-chip.small {
  font-size: clamp(0.9rem, 1.5vw, 1.3rem);
}
.faint-team {
  opacity: 0.75;
  font-weight: 600;
}
.prices {
  display: flex;
  gap: 1vw;
}
.price-chip {
  padding: 0.3em 0.8em;
  border-radius: 14px;
  background: linear-gradient(180deg, var(--board), var(--board-2));
  border: 1px solid var(--board-edge);
  box-shadow: var(--shadow);
  color: var(--accent);
  font-size: clamp(1.4rem, 3vw, 3rem);
  font-weight: 800;
  letter-spacing: -0.02em;
}
.price-chip.played {
  opacity: 0.3;
}
.strike-card {
  gap: 1.6vh;
  min-height: 0;
}
.strike-list {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1vh;
}
.strike-theme {
  min-width: min(60vw, 900px);
  padding: 0.15em 1.2em;
  border-radius: 16px;
  background: linear-gradient(180deg, var(--board), var(--board-2));
  border: 1px solid var(--board-edge);
  box-shadow: var(--shadow);
  color: #312e81;
  font-size: clamp(1.1rem, min(2.8vw, 4.6vh), 3rem);
  font-weight: 900;
  text-transform: uppercase;
  transition: opacity 0.4s;
}
.strike-theme.struck {
  opacity: 0.2;
  text-decoration: line-through;
}
.table-list {
  display: flex;
  flex-direction: column;
  gap: 1vh;
}
.table-line {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.6vw;
  margin-top: -1vh;
}

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
  font-weight: 800;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.06em;
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
  letter-spacing: -0.02em;
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
  border-radius: 28px;
  background: linear-gradient(180deg, var(--board), var(--board-2));
  border: 1px solid var(--board-edge);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  transition: box-shadow 0.3s;
}
.q-body.glow {
  box-shadow:
    0 0 0 4px rgba(34, 197, 94, 0.75),
    0 0 70px rgba(34, 197, 94, 0.35);
}
.q-number {
  font-size: clamp(1.1rem, 2.2vw, 2.2rem);
  font-weight: 700;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.q-state {
  font-size: clamp(2.4rem, min(7vw, 12vh), 7rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  text-align: center;
  line-height: 1.05;
  animation: pop 0.4s ease;
}
.q-state.go {
  color: var(--ok);
  animation: pulse 0.9s ease-in-out infinite;
}
.q-state.muted {
  color: var(--faint);
}
.right-by {
  font-size: clamp(2rem, min(5vw, 9vh), 5rem);
  font-weight: 800;
  padding: 0.2em 0.9em;
  border-radius: 99px;
  border: 4px solid var(--c);
  background: color-mix(in srgb, var(--c) 12%, var(--panel));
  animation: pop 0.45s ease;
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
  border-radius: 28px;
  background: radial-gradient(circle at 50% 35%, #ffffff, #efeaff 70%);
  border: 1px solid #d8ccfd;
  box-shadow: var(--shadow-lg);
  animation: pop 0.5s ease;
  text-align: center;
}
.special-icon {
  font-size: clamp(3rem, 12vh, 9rem);
  line-height: 1;
}
.special-title {
  font-size: clamp(2rem, min(6vw, 10vh), 6rem);
  font-weight: 800;
  color: #6d28d9;
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
  border-radius: 22px;
  background: var(--c);
  color: var(--t);
  font-size: clamp(2rem, min(5.5vw, 10vh), 5.5rem);
  font-weight: 800;
  letter-spacing: -0.01em;
  text-align: center;
  box-shadow: 0 18px 40px -16px var(--c);
  animation: pop 0.35s ease;
}
.wrongs {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.wrong {
  color: var(--bad);
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
  font-weight: 800;
  letter-spacing: -0.02em;
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
  border-radius: 16px;
  background: linear-gradient(180deg, var(--board), var(--board-2));
  border: 1px solid var(--board-edge);
  box-shadow: var(--shadow);
  transition: opacity 0.3s;
}
.final-theme.removed {
  opacity: 0.2;
  text-decoration: line-through;
}
.final-theme-name {
  text-align: center;
  font-size: clamp(1.8rem, 4.5vw, 4.5rem);
  font-weight: 800;
  letter-spacing: -0.02em;
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
  border-radius: 18px;
  background: var(--panel);
  border: 2px solid var(--line);
  border-top: 8px solid var(--c);
  box-shadow: var(--shadow);
  text-align: center;
  transition: transform 0.25s;
}
.fp.current {
  transform: scale(1.03);
  border-color: var(--accent);
  border-top-color: var(--c);
  box-shadow: var(--ring), var(--shadow-lg);
}
.fp.ok {
  background: var(--ok-soft);
}
.fp.bad {
  background: var(--bad-soft);
}
.fp-name {
  font-weight: 800;
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
  border-radius: 24px 24px 0 0;
  background: linear-gradient(180deg, color-mix(in srgb, var(--c) 85%, white), var(--c));
  color: var(--t);
  box-shadow: 0 24px 50px -20px var(--c);
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
  font-weight: 800;
}
.pod-score {
  font-size: clamp(1.5rem, 3.4vw, 3.6rem);
  font-weight: 800;
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
