<script setup lang="ts">
// Финал «Своей игры» (и раунд «Хамса») на телефоне: ставка и письменный ответ. Вопрос читает ведущий.
// Ставку делают один раз и за отведённое время; за команду ставку и ответ сдаёт капитан.
import { computed, ref, watch } from 'vue'
import type { JFinal, MeView, TimerState } from '../../lib/types'
import TimerBar from '../../components/TimerBar.vue'

const props = defineProps<{
  final: JFinal
  me: NonNullable<NonNullable<MeView['jeopardy']>['final']>
  timer: TimerState | undefined
  betTimer: TimerState | undefined
  now: number
  title?: string
}>()
const emit = defineEmits<{ bet: [amount: number]; answer: [text: string] }>()

const betInput = ref<string>('')
// Ставка выбрана, ждём подтверждения: изменить её потом будет нельзя.
const confirming = ref<number | null>(null)
const answer = ref(props.me.answer ?? '')
const answerSent = ref(props.me.answer ?? '')
const betError = ref('')

watch(
  () => props.me.answer,
  (a) => {
    if (a !== null) answerSent.value = a
    // Ответ пишет капитан — остальные видят его ответ.
    if (a !== null && !props.me.canAnswer) answer.value = a
  },
)
watch(
  () => props.me.canBet,
  (can) => {
    if (!can) confirming.value = null
  },
)

const max = computed(() => props.me.maxBet)
// Быстрые суммы только подставляются в поле — ставку игрок подтверждает сам.
const quick = computed(() => {
  const m = max.value
  return [1, Math.round(m / 4), Math.round(m / 2), m].filter((v, i, arr) => v >= 1 && arr.indexOf(v) === i)
})

function parseBet(): number | null {
  const n = Math.round(Number(betInput.value.replace(/\s/g, '').replace(',', '.')))
  if (!betInput.value.trim() || !Number.isFinite(n) || n < 1 || n > max.value) {
    betError.value = `Ставка — от 1 до ${max.value}`
    return null
  }
  betError.value = ''
  return n
}

function pickQuick(v: number) {
  betInput.value = String(v)
  betError.value = ''
}

function askConfirm() {
  const n = parseBet()
  if (n !== null) confirming.value = n
}

function sendBet() {
  if (confirming.value === null) return
  emit('bet', confirming.value)
  confirming.value = null
}

// Поле ввода обновляется на каждый символ: v-model на телефонах ждёт конца набора слова (IME) или ухода фокуса.
function onBetInput(ev: Event) {
  betInput.value = (ev.target as HTMLInputElement).value
  betError.value = ''
}
function onAnswerInput(ev: Event) {
  answer.value = (ev.target as HTMLTextAreaElement).value
}

function sendAnswer() {
  if (!answer.value.trim() || !dirty.value) return
  emit('answer', answer.value)
  answerSent.value = answer.value.trim()
}

const dirty = computed(() => answer.value.trim() !== (answerSent.value ?? '').trim())
const writerName = computed(() => props.me.writer?.name ?? 'капитан')
</script>

<template>
  <div class="final">
    <div class="head">
      <div class="label">{{ title ?? 'Финал' }}</div>
      <div v-if="final.themeName" class="theme">{{ final.themeName }}</div>
    </div>

    <template v-if="!me.participant">
      <p class="muted t-center">
        Вы не участвуете {{ !title || title === 'Финал' ? 'в финале' : 'в этом раунде' }} — для участия нужен положительный счёт.
        Следите за экраном!
      </p>
    </template>

    <template v-else-if="final.step === 'themes'">
      <p class="muted t-center">Ведущий убирает темы, пока не останется одна.</p>
      <div class="themes">
        <span v-for="t in final.themes" :key="t.index" class="chip" :class="{ removed: t.removed }">{{ t.name }}</span>
      </div>
    </template>

    <template v-else-if="final.step === 'bets'">
      <TimerBar v-if="betTimer && me.bet === null" :timer="betTimer" :now="now" label="на ставку" :warn-at="10000" />

      <template v-if="me.bet !== null">
        <p class="t-center big-text">Ставка принята: <b class="nums">{{ me.bet }}</b></p>
        <p class="muted t-center small">Изменить ставку нельзя. Ждём остальных участников…</p>
      </template>

      <template v-else-if="me.canBet && confirming !== null">
        <p class="t-center big-text">Ставка <b class="nums">{{ confirming }}</b>?</p>
        <p class="muted t-center small">После подтверждения изменить её будет нельзя.</p>
        <button class="btn primary big block" @click="sendBet">Подтвердить ставку</button>
        <button class="btn ghost block" @click="confirming = null">Изменить сумму</button>
      </template>

      <template v-else-if="me.canBet">
        <p class="t-center">Сделайте ставку (максимум <b class="nums">{{ max }}</b>)</p>
        <div class="bet-row">
          <input
            :value="betInput"
            class="input bet-input nums"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            placeholder="Ставка"
            enterkeyhint="done"
            @input="onBetInput"
            @keydown.enter.prevent="askConfirm"
          />
          <button class="btn primary big" :disabled="!betInput.trim()" @click="askConfirm">Поставить</button>
        </div>
        <div class="quick">
          <button v-for="q in quick" :key="q" class="btn small ghost" :class="{ on: betInput === String(q) }" @click="pickQuick(q)">
            {{ q === max ? `Ва-банк (${q})` : q }}
          </button>
        </div>
        <p v-if="betError" class="error">{{ betError }}</p>
      </template>

      <p v-else-if="!final.betsOpen" class="t-center">Время на ставку вышло. Без ставки ответ не принесёт и не отнимет очков.</p>
      <p v-else class="t-center">Ставку за команду делает <b>{{ writerName }}</b>.</p>
    </template>

    <template v-else-if="final.step === 'question'">
      <TimerBar :timer="timer" :now="now" :warn-at="10000" />
      <template v-if="me.canAnswer">
        <p class="muted t-center small">Ведущий читает вопрос — напишите ответ, пока идёт время.</p>
        <textarea
          :value="answer"
          class="textarea answer"
          maxlength="300"
          rows="3"
          placeholder="Ваш ответ"
          enterkeyhint="send"
          @input="onAnswerInput"
          @keydown.enter.exact.prevent="sendAnswer"
        />
        <button class="btn primary big block" :disabled="!answer.trim() || !dirty" @click="sendAnswer">
          {{ answerSent && !dirty ? 'Ответ отправлен ✓' : 'Отправить ответ' }}
        </button>
        <p class="muted t-center small">Ответ можно исправить, пока идёт время. Ставка: {{ me.bet ?? 'нет' }}</p>
      </template>
      <template v-else>
        <p class="t-center">Ответ за команду пишет <b>{{ writerName }}</b>.</p>
        <p class="t-center">{{ me.answer ? `Ответ команды: «${me.answer}»` : 'Ответа пока нет' }}</p>
        <p class="muted t-center small">Ставка: {{ me.bet ?? 'нет' }}</p>
      </template>
    </template>

    <template v-else-if="final.step === 'reveal'">
      <p class="t-center">Ваш ответ: <b>{{ me.answer || '—' }}</b></p>
      <p class="t-center">Ставка: <b class="nums">{{ me.bet ?? 0 }}</b></p>
      <p v-if="me.result === true" class="result ok">Верно! +{{ me.bet }}</p>
      <p v-else-if="me.result === false" class="result bad">Неверно, −{{ me.bet ?? 0 }}</p>
      <p v-else class="muted t-center">Ведущий проверяет ответы…</p>
    </template>
  </div>
</template>

<style scoped>
.final {
  width: 100%;
  max-width: 460px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: stretch;
}
.head {
  text-align: center;
}
.theme {
  font-size: 1.5rem;
  font-weight: 800;
  color: var(--accent);
}
.t-center {
  text-align: center;
  margin: 0;
}
.themes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
}
.chip.removed {
  text-decoration: line-through;
  opacity: 0.4;
}
.bet-row {
  display: flex;
  gap: 8px;
}
.bet-input {
  height: var(--h-lg);
  font-size: 1.4rem;
  text-align: center;
}
.quick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
}
.quick .btn.on {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}
.big-text {
  font-size: 1.3rem;
}
.answer {
  font-size: 1.1rem;
}
.error {
  color: var(--bad);
  text-align: center;
  margin: 0;
}
.result {
  text-align: center;
  font-size: 1.6rem;
  font-weight: 800;
  margin: 0;
}
.result.ok {
  color: var(--ok);
}
.result.bad {
  color: var(--bad);
}
.small {
  font-size: 0.85rem;
}
</style>
