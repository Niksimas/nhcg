<script setup lang="ts">
// Финал «Своей игры» у ведущего: темы, ставки, вопрос, проверка ответов.
import { computed, reactive } from 'vue'
import { competitorMap, fmtScore, textOn } from '../../lib/util'
import ContentView from '../../components/ContentView.vue'
import TimerBar from '../../components/TimerBar.vue'
import Icon from '../../components/Icon.vue'
import { useHost } from './ctx'

const props = defineProps<{ hostPlays: boolean }>()
const { state, run, now } = useHost()
const s = computed(() => state.value!)
const f = computed(() => s.value.jeopardy!.final!)
const comps = computed(() => competitorMap(s.value))
const nameOf = (id: string) => comps.value.get(id)?.name ?? '—'
const colorOf = (id: string) => comps.value.get(id)?.color ?? '#888'
const scoreOf = (id: string) => comps.value.get(id)?.score ?? 0
const title = computed(() => {
  const j = s.value.jeopardy!
  return j.format === 'khamsa' ? `Раунд «${j.rounds[j.roundIndex]?.name || 'Хамса'}»` : 'Финал'
})

const betInputs = reactive<Record<string, number | null>>({})
const participantIds = computed(() => new Set(f.value.participants.map((p) => p.competitorId)))
const others = computed(() => s.value.competitors.filter((c) => !participantIds.value.has(c.id)))
const allBets = computed(() => f.value.participants.every((p) => p.hasBet))
const allAnswers = computed(() => f.value.participants.every((p) => p.hasAnswer))

function setBet(id: string) {
  const v = betInputs[id]
  if (v == null) return
  void run('j.final.bet', { competitorId: id, amount: v })
}

async function showQuestion() {
  if (!allBets.value && !confirm('Не все сделали ставки (без ставки — 0). Показать вопрос?')) return
  await run('j.final.question')
}

async function closeAnswers() {
  if (!allAnswers.value && !confirm('Не все прислали ответ. Закончить приём ответов?')) return
  await run('j.final.close')
}
</script>

<template>
  <div class="final">
    <div class="head">
      <h2>{{ title }}</h2>
      <span v-if="f.themeName" class="theme">Тема: {{ f.themeName }}</span>
    </div>

    <!-- Темы -->
    <div v-if="f.step === 'themes'" class="card">
      <p class="muted">Уберите темы (обычно игроки убирают по очереди), пока не останется одна.</p>
      <div class="themes">
        <div v-for="t in f.themes" :key="t.index" class="theme-row" :class="{ removed: t.removed }">
          <span class="grow">{{ t.name }}</span>
          <button v-if="!t.removed" class="btn small bad" @click="run('j.final.removeTheme', { index: t.index })">
            <Icon name="x" /> Убрать
          </button>
        </div>
      </div>
    </div>

    <!-- Участники -->
    <div v-if="f.step === 'themes' || f.step === 'bets'" class="card">
      <div class="label">Участники финала</div>
      <div class="parts">
        <div v-for="p in f.participants" :key="p.competitorId" class="part" :style="{ '--c': colorOf(p.competitorId) }">
          <span class="grow name">{{ nameOf(p.competitorId) }}</span>
          <span class="muted nums">счёт {{ fmtScore(scoreOf(p.competitorId)) }}</span>
          <template v-if="f.step === 'bets'">
            <span class="bet nums" :class="{ none: !p.hasBet }">{{ p.hasBet ? `ставка ${p.bet}` : 'нет ставки' }}</span>
            <input
              v-model.number="betInputs[p.competitorId]"
              class="input small bet-in nums"
              type="number"
              min="1"
              :max="Math.max(1, scoreOf(p.competitorId))"
              placeholder="ставка"
              @keydown.enter="setBet(p.competitorId)"
            />
            <button class="btn small" @click="setBet(p.competitorId)">OK</button>
          </template>
          <button class="btn small flat" title="Убрать из финала" @click="run('j.final.toggle', { competitorId: p.competitorId })">
            <Icon name="x" />
          </button>
        </div>
      </div>
      <div v-if="others.length" class="row wrap others">
        <span class="muted small">Не участвуют:</span>
        <button v-for="c in others" :key="c.id" class="btn small ghost" @click="run('j.final.toggle', { competitorId: c.id })">
          <Icon name="plus" /> {{ c.name }} ({{ fmtScore(c.score) }})
        </button>
      </div>
      <p v-if="f.step === 'bets'" class="muted small">Игроки делают ставки на телефонах. Ставку можно ввести и вручную.</p>
    </div>

    <div v-if="f.step !== 'themes'" class="q-grid">
      <div class="card">
        <div class="label">Вопрос финала</div>
        <ContentView :items="f.content" variant="host" :playing="props.hostPlays ? f.step === 'question' : null" />
      </div>
      <div class="card a-card">
        <div class="label">Ответ</div>
        <div class="answer">{{ f.answer }}</div>
        <ContentView v-if="f.answerContent?.length" :items="f.answerContent" variant="host" />
        <div v-if="f.comment" class="comment">{{ f.comment }}</div>
      </div>
    </div>

    <div v-if="f.step === 'bets'" class="actions">
      <button class="btn primary huge" @click="showQuestion"><Icon name="play" /> Показать вопрос</button>
      <span class="muted">{{ allBets ? 'Все ставки сделаны' : 'Ждём ставки…' }}</span>
    </div>

    <template v-if="f.step === 'question'">
      <TimerBar :timer="s.timers.final" :now="now" big :warn-at="10000" />
      <div class="parts">
        <div v-for="p in f.participants" :key="p.competitorId" class="part" :style="{ '--c': colorOf(p.competitorId) }">
          <span class="grow name">{{ nameOf(p.competitorId) }}</span>
          <span class="nums muted">ставка {{ p.bet ?? 0 }}</span>
          <span :class="p.hasAnswer ? 'ok' : 'muted'">{{ p.hasAnswer ? `«${p.answer}»` : 'пишет…' }}</span>
        </div>
      </div>
      <button class="btn primary big" @click="closeAnswers">Закончить приём ответов</button>
    </template>

    <template v-if="f.step === 'reveal'">
      <p class="muted">Открывайте ответы по одному: «Показать» — ответ и ставка появятся на экране, затем отметьте результат.</p>
      <div class="parts">
        <div
          v-for="p in f.participants"
          :key="p.competitorId"
          class="part reveal"
          :class="{ current: f.current === p.competitorId, ok: p.result === true, bad: p.result === false }"
          :style="{ '--c': colorOf(p.competitorId), '--t': textOn(colorOf(p.competitorId)) }"
        >
          <span class="name">{{ nameOf(p.competitorId) }}</span>
          <span class="grow ans">{{ p.answer || '— нет ответа —' }}</span>
          <span class="nums muted">ставка {{ p.bet ?? 0 }}</span>
          <button class="btn small" :class="{ primary: !p.shown }" @click="run('j.final.show', { competitorId: p.competitorId })">
            <Icon name="eye" /> Показать
          </button>
          <button class="btn small ok" @click="run('j.final.judge', { competitorId: p.competitorId, correct: true })">
            <Icon name="check" />
          </button>
          <button class="btn small bad" @click="run('j.final.judge', { competitorId: p.competitorId, correct: false })">
            <Icon name="x" />
          </button>
        </div>
      </div>
      <div class="actions">
        <button class="btn big" :disabled="f.answerShown" @click="run('j.final.answer')"><Icon name="eye" /> Показать правильный ответ</button>
        <button class="btn primary big" @click="run('j.results')"><Icon name="trophy" /> Итоги игры</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.final {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.head {
  display: flex;
  align-items: baseline;
  gap: 16px;
}
.head h2 {
  margin: 0;
  color: var(--accent);
}
.theme {
  font-size: 1.2rem;
  font-weight: 800;
}
.themes {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.theme-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--panel-2);
  font-weight: 700;
}
.theme-row.removed {
  opacity: 0.35;
  text-decoration: line-through;
}
.parts {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}
.part {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--panel-2);
  border-left: 6px solid var(--c);
  flex-wrap: wrap;
}
.part .name {
  font-weight: 800;
}
.part.current {
  outline: 2px solid var(--accent);
}
.part.ok {
  background: rgba(34, 197, 94, 0.18);
}
.part.bad {
  background: rgba(239, 68, 68, 0.18);
}
.ans {
  font-weight: 700;
  color: var(--accent);
}
.bet.none {
  color: var(--warn);
}
.bet-in {
  width: 90px;
}
.others {
  margin-top: 10px;
}
.small {
  font-size: 0.85rem;
}
.ok {
  color: #7ef0a8;
}
.q-grid {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 12px;
}
.a-card {
  border-color: rgba(255, 200, 61, 0.4);
}
.answer {
  font-size: 1.4rem;
  font-weight: 900;
  color: var(--accent);
}
.comment {
  color: var(--muted);
  font-size: 0.9rem;
  white-space: pre-wrap;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
@media (max-width: 900px) {
  .q-grid {
    grid-template-columns: 1fr;
  }
}
</style>
