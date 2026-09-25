<script setup lang="ts">
// «Брейн-ринг» у ведущего: вопрос, кнопка «Время!», таймер, приём ответов, счёт боя.
import { computed, ref } from 'vue'
import { competitorMap, fmtScore, textOn, timerLeft } from '../../lib/util'
import ContentView from '../../components/ContentView.vue'
import TimerBar from '../../components/TimerBar.vue'
import Modal from '../../components/Modal.vue'
import Icon from '../../components/Icon.vue'
import { useHost } from './ctx'

const props = defineProps<{ hostPlays: boolean }>()
const { state, run, now } = useHost()
const s = computed(() => state.value!)
const br = computed(() => s.value.brainring!)
const comps = computed(() => competitorMap(s.value))
const nameOf = (id: string | null | undefined) => (id ? comps.value.get(id)?.name ?? '—' : '—')
const b = computed(() => s.value.buzzer)
const responder = computed(() => (br.value.stage === 'answering' && b.value.winner ? comps.value.get(b.value.winner.competitorId) : undefined))
const hasPack = computed(() => br.value.total != null)
const atEnd = computed(() => br.value.total != null && br.value.qIndex >= br.value.total - 1)
const listOpen = ref(false)
const mainLeft = computed(() => timerLeft(s.value.timers.main, now.value))
const hideAnswer = computed(() => s.value.settings.hideAnswerOnHost)

const falseStarters = computed(() => b.value.falseStarts.map((id) => nameOf(id)))
const history = computed(() => [...br.value.history].reverse().slice(0, 12))
const RESULT: Record<string, string> = { correct: 'взят', burned: 'не взят', cancelled: 'снят' }

async function next() {
  await run('br.next')
}
async function goto(i: number) {
  listOpen.value = false
  await run('br.goto', { index: i })
}
async function setValue() {
  const v = prompt('Сколько очков стоит этот вопрос?', String(br.value.value))
  if (v === null) return
  await run('br.value', { value: Number(v) })
}
async function newBattle() {
  if (!confirm('Начать новый бой? Счёт всех команд обнулится.')) return
  await run('br.newBattle')
}
async function finish() {
  if (!confirm('Завершить бой и показать победителя?')) return
  await run('br.finish')
}
const mediaPlaying = computed(() => (props.hostPlays ? br.value.stage === 'reading' || br.value.stage === 'armed' : null))
</script>

<template>
  <div class="br">
    <div class="top-row">
      <div class="qnum">
        <template v-if="br.qIndex >= 0">
          Вопрос №{{ br.qIndex + 1 }}<span v-if="br.total" class="muted"> из {{ br.total }}</span>
        </template>
        <template v-else>Вопросы ещё не начались</template>
      </div>
      <button v-if="br.stage !== 'idle' && br.stage !== 'finished'" class="chip value" title="Изменить стоимость" @click="setValue">
        Стоимость: <b>{{ br.value }}</b>
      </button>
      <span v-if="br.carry > 0 && (br.stage === 'reveal' || br.stage === 'idle')" class="chip warn">
        Перенос: +{{ br.carry }} к следующему вопросу
      </span>
      <div class="grow" />
      <button v-if="hasPack" class="btn small" @click="listOpen = true"><Icon name="list" /> Все вопросы</button>
      <button class="btn small ghost" @click="finish"><Icon name="flag" /> Завершить бой</button>
      <button class="btn small ghost" @click="newBattle"><Icon name="refresh" /> Новый бой</button>
    </div>

    <div v-if="br.question" class="q-grid">
      <div class="card">
        <div class="label">
          Вопрос <span v-if="br.question.themeName" class="faint">· {{ br.question.themeName }}</span>
        </div>
        <ContentView :items="br.question.content" variant="host" :playing="mediaPlaying" />
        <label class="check show-q">
          <input type="checkbox" :checked="br.showQuestion" @change="run('br.show', { show: !br.showQuestion })" />
          Показывать текст вопроса на экране и телефонах
        </label>
      </div>
      <div class="card a-card" :class="{ hidden: hideAnswer }">
        <div class="label">Ответ</div>
        <div class="answer">{{ br.question.answer || '—' }}</div>
        <ContentView v-if="br.question.answerContent?.length" :items="br.question.answerContent" variant="host" />
        <div v-if="br.question.comment" class="comment">{{ br.question.comment }}</div>
      </div>
    </div>
    <div v-else-if="br.stage !== 'idle' && br.stage !== 'finished' && !hasPack" class="card muted">
      Пакет не выбран — читайте вопрос с листа. Программа следит за кнопками, фальстартами и временем.
    </div>

    <div class="control card">
      <template v-if="br.stage === 'idle'">
        <button class="btn primary huge" :disabled="atEnd && br.qIndex >= 0" @click="next">
          <Icon name="play" /> {{ br.qIndex >= 0 ? 'Следующий вопрос' : 'Первый вопрос' }} <span class="kbd">Enter</span>
        </button>
      </template>

      <template v-else-if="br.stage === 'reading'">
        <div class="hint">Прочитайте вопрос. Нажатие кнопки до сигнала — фальстарт.</div>
        <button class="btn ok huge time-btn" @click="run('br.start')">
          ВРЕМЯ! <span class="kbd">Пробел</span>
        </button>
        <div class="row wrap">
          <button class="btn small ghost" @click="run('br.cancel')">Снять вопрос</button>
        </div>
      </template>

      <template v-else-if="br.stage === 'armed'">
        <TimerBar class="main-timer" :timer="s.timers.main" :now="now" big :warn-at="10000" />
        <div class="waiting"><span class="pulse-dot" /> Идёт время — ждём нажатия</div>
        <div class="row wrap">
          <button class="btn" @click="run('br.burn')">Никто не ответил</button>
          <button class="btn small ghost" @click="run('br.cancel')">Снять вопрос</button>
        </div>
      </template>

      <template v-else-if="br.stage === 'answering' && responder">
        <div class="responder" :style="{ '--c': responder.color, '--t': textOn(responder.color) }">
          Отвечает: {{ responder.name }}
          <span class="react">реакция {{ b.winner?.reaction }} мс</span>
        </div>
        <div class="muted">Осталось времени: {{ Math.ceil(mainLeft / 1000) }} с (таймер на паузе)</div>
        <TimerBar v-if="s.timers.answer" :timer="s.timers.answer" :now="now" label="на ответ" />
        <div class="judge">
          <button class="btn ok huge" @click="run('br.judge', { correct: true })">
            <Icon name="check" /> Верно +{{ br.value }} <span class="kbd">Enter</span>
          </button>
          <button class="btn bad huge" @click="run('br.judge', { correct: false })">
            <Icon name="x" /> Неверно <span class="kbd">Backspace</span>
          </button>
        </div>
      </template>

      <template v-else-if="br.stage === 'reveal'">
        <div class="result" :class="br.answeredBy ? 'ok' : 'burned'">
          {{ br.answeredBy ? `Верно ответили: ${nameOf(br.answeredBy)}` : 'Вопрос не взят' }}
        </div>
        <button class="btn primary huge" :disabled="atEnd" @click="next">
          <Icon name="next" /> Следующий вопрос <span class="kbd">Enter</span>
        </button>
        <p v-if="atEnd" class="muted">Вопросы в пакете закончились.</p>
      </template>

      <template v-else-if="br.stage === 'finished'">
        <div class="result ok">{{ br.winnerId ? `Победа: ${nameOf(br.winnerId)}!` : 'Бой завершён вничью' }}</div>
        <div class="row wrap">
          <button class="btn primary big" @click="run('br.newBattle')"><Icon name="refresh" /> Новый бой</button>
          <button class="btn big" @click="run('br.continue')">Продолжить этот бой</button>
        </div>
      </template>

      <div v-if="falseStarters.length" class="fs">Фальстарт: {{ falseStarters.join(', ') }}</div>
    </div>

    <div class="scores">
      <div v-for="c in s.competitors" :key="c.id" class="sc" :style="{ '--c': c.color }">
        <span class="grow ellipsis">{{ c.name }}</span>
        <b class="nums">{{ fmtScore(c.score) }}</b>
      </div>
    </div>
    <p v-if="s.settings.brTargetScore" class="muted small">Бой идёт до {{ s.settings.brTargetScore }} очков.</p>

    <div v-if="history.length" class="history">
      <div class="label">История</div>
      <div v-for="(h, i) in history" :key="i" class="h-row">
        <span class="faint nums">№{{ h.index + 1 }}</span>
        <span>{{ RESULT[h.result] }}</span>
        <span v-if="h.competitorId">· {{ nameOf(h.competitorId) }} +{{ h.value }}</span>
      </div>
    </div>

    <Modal v-if="listOpen && br.list" title="Вопросы пакета" width="760px" @close="listOpen = false">
      <div class="qlist">
        <button
          v-for="(item, i) in br.list"
          :key="i"
          class="qitem"
          :class="{ cur: i === br.qIndex, done: br.history.some((h) => h.index === i) }"
          @click="goto(i)"
        >
          <span class="nums faint">{{ i + 1 }}.</span>
          <span class="grow">{{ item.preview || '(без текста)' }}</span>
          <span class="faint small">{{ item.themeName }}</span>
        </button>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.br {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.top-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.qnum {
  font-size: 1.3rem;
  font-weight: 900;
}
.value {
  border: none;
  cursor: pointer;
  color: var(--text);
}
.chip.warn {
  background: rgba(245, 158, 11, 0.2);
  color: #ffd08a;
}
.q-grid {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 12px;
}
.q-grid .card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.a-card {
  border-color: rgba(255, 200, 61, 0.4);
  background: color-mix(in srgb, var(--accent) 7%, var(--panel));
}
.answer {
  font-size: 1.5rem;
  font-weight: 900;
  color: var(--accent);
}
.a-card.hidden .answer,
.a-card.hidden .comment {
  filter: blur(9px);
}
.a-card.hidden:hover .answer,
.a-card.hidden:hover .comment {
  filter: none;
}
.comment {
  color: var(--muted);
  font-size: 0.9rem;
  white-space: pre-wrap;
}
.show-q {
  font-size: 0.9rem;
}
.control {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}
.hint {
  color: var(--muted);
}
.time-btn {
  font-size: 2.2rem;
  padding: 0.6em 2em;
  letter-spacing: 0.05em;
}
.main-timer {
  width: 100%;
}
.waiting {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.2rem;
  font-weight: 800;
  color: #7ef0a8;
}
.pulse-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--ok);
  animation: pulse 0.8s infinite;
}
.responder {
  padding: 10px 18px;
  border-radius: 14px;
  background: var(--c);
  color: var(--t);
  font-size: 1.7rem;
  font-weight: 900;
  animation: pop 0.3s ease;
}
.react {
  font-size: 0.9rem;
  font-weight: 600;
  margin-left: 8px;
  opacity: 0.85;
}
.judge {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.result {
  font-size: 1.5rem;
  font-weight: 900;
}
.result.ok {
  color: var(--ok);
}
.result.burned {
  color: var(--muted);
}
.fs {
  color: #ff9a9a;
  font-weight: 700;
}
.scores {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.sc {
  flex: 1 1 160px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--panel-2);
  border-left: 6px solid var(--c);
  font-size: 1.2rem;
}
.sc b {
  font-size: 1.6rem;
  color: var(--accent);
}
.history {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 0.9rem;
}
.h-row {
  display: flex;
  gap: 8px;
}
.small {
  font-size: 0.85rem;
}
.qlist {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.qitem {
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: var(--panel-2);
  color: var(--text);
  cursor: pointer;
}
.qitem:hover {
  border-color: var(--line-2);
}
.qitem.cur {
  border-color: var(--accent);
}
.qitem.done {
  opacity: 0.55;
}
@media (max-width: 900px) {
  .q-grid {
    grid-template-columns: 1fr;
  }
}
</style>
