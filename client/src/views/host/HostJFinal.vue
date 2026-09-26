<script setup lang="ts">
// Финал «Своей игры» (и раунд «Хамса») у ведущего: ставки, вопрос с листа, ответы с телефонов, проверка.
import { computed, reactive } from 'vue'
import { competitorMap, fmtScore, textOn } from '../../lib/util'
import TimerBar from '../../components/TimerBar.vue'
import Icon from '../../components/Icon.vue'
import { useHost } from './ctx'

const { state, run, now } = useHost()
const s = computed(() => state.value!)
const f = computed(() => s.value.jeopardy!.final!)
const comps = computed(() => competitorMap(s.value))
const nameOf = (id: string) => comps.value.get(id)?.name ?? '—'
const colorOf = (id: string) => comps.value.get(id)?.color ?? '#888'
const scoreOf = (id: string) => comps.value.get(id)?.score ?? 0
const j = computed(() => s.value.jeopardy!)
const title = computed(() => (j.value.format === 'khamsa' ? `Раунд «${j.value.rounds[j.value.roundIndex]?.name || 'Хамса'}»` : 'Финал'))

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
  if (!allBets.value && !confirm('Не все сделали ставки (без ставки — 0). Начать приём ответов?')) return
  await run('j.final.question')
}

function renameTheme() {
  const ti = f.value.themes.find((t) => !t.removed)?.index ?? 0
  const name = prompt('Тема вопроса (пусто — без названия)', f.value.themeName ?? '')
  if (name !== null) void run('j.theme.name', { round: j.value.roundIndex, theme: ti, name })
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
      <button class="btn small ghost" title="Вписать тему вопроса из своего листа" @click="renameTheme"><Icon name="edit" /> Тема</button>
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
      <div class="label">Участники {{ j.format === 'khamsa' ? 'раунда' : 'финала' }}</div>
      <div v-if="f.step === 'bets'" class="bets-time">
        <TimerBar v-if="s.timers.bets" :timer="s.timers.bets" :now="now" label="на ставку" :warn-at="10000" />
        <span v-if="!f.betsOpen" class="closed-tag">Время на ставку вышло — с телефонов ставки больше не принимаются</span>
      </div>
      <div class="parts">
        <div v-for="p in f.participants" :key="p.competitorId" class="part" :style="{ '--c': colorOf(p.competitorId) }">
          <span class="grow name">{{ nameOf(p.competitorId) }}</span>
          <span class="muted nums">счёт {{ fmtScore(scoreOf(p.competitorId)) }}</span>
          <template v-if="f.step === 'bets'">
            <span class="bet nums" :class="{ none: !p.hasBet }" :title="p.hasBet ? 'Ставка сделана — игрок изменить её не может' : ''">
              {{ p.hasBet ? `ставка ${p.bet}` : 'нет ставки' }}
            </span>
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
      <p v-if="f.step === 'bets'" class="muted small">
        {{ s.settings.teamMode ? 'Капитаны делают ставки на телефонах' : 'Игроки делают ставки на телефонах' }} — один раз, изменить
        ставку нельзя. Вы можете вписать или поправить ставку вручную.
      </p>
    </div>

    <div v-if="f.step === 'bets'" class="actions">
      <button class="btn primary huge" @click="showQuestion"><Icon name="play" /> Вопрос прочитан — принимать ответы</button>
      <span class="muted">{{ allBets ? 'Все ставки сделаны' : 'Ждём ставки…' }}</span>
    </div>
    <p v-if="f.step === 'bets'" class="muted small">
      Когда все сделают ставки, прочитайте вопрос со своего листа и откройте приём ответов — пойдёт время, игроки пишут
      ответ на телефонах.
    </p>

    <template v-if="f.step === 'question'">
      <TimerBar :timer="s.timers.final" :now="now" big :warn-at="10000" />
      <div class="parts">
        <div v-for="p in f.participants" :key="p.competitorId" class="part" :style="{ '--c': colorOf(p.competitorId) }">
          <span class="grow name">{{ nameOf(p.competitorId) }}</span>
          <span class="nums muted">ставка {{ p.bet ?? 0 }}</span>
          <span :class="p.hasAnswer ? 'got' : 'muted'">{{ p.hasAnswer ? `«${p.answer}»` : 'пишет…' }}</span>
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
  border-radius: 12px;
  background: var(--panel-2);
  border: 1px solid var(--line);
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
  border-radius: 12px;
  background: var(--panel-2);
  border: 1px solid var(--line);
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
  background: var(--ok-soft);
}
.part.bad {
  background: var(--bad-soft);
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
.bets-time {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 8px 0 4px;
}
.closed-tag {
  color: var(--bad-2);
  font-weight: 700;
  font-size: 0.9rem;
}
.small {
  font-size: 0.85rem;
}
.got {
  color: var(--ok-2);
  font-weight: 700;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
@media (max-width: 760px) {
  .head {
    flex-wrap: wrap;
    align-items: center;
    row-gap: 4px;
  }
  .head h2 {
    flex-basis: 100%;
    font-size: 1.4rem;
  }
  /* Строка участника: имя, счёт и ставка сверху, поле ставки и кнопки — под ними. */
  .part:not(.reveal) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 5.8em 6.6em;
    gap: 6px 10px;
  }
  .part:not(.reveal) > :not(:first-child):not(.bet-in) {
    justify-self: end;
  }
  .part:not(.reveal) .bet-in {
    width: 100%;
  }
  .actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
