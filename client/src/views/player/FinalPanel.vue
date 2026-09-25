<script setup lang="ts">
// Финал «Своей игры» (и раунд «Хамса») на телефоне: ставка и письменный ответ. Вопрос читает ведущий.
import { computed, ref, watch } from 'vue'
import type { JFinal, MeView, TimerState } from '../../lib/types'
import TimerBar from '../../components/TimerBar.vue'

const props = defineProps<{
  final: JFinal
  me: NonNullable<NonNullable<MeView['jeopardy']>['final']>
  timer: TimerState | undefined
  now: number
  title?: string
}>()
const emit = defineEmits<{ bet: [amount: number]; answer: [text: string] }>()

const betInput = ref<number | null>(props.me.bet)
const editingBet = ref(props.me.bet === null)
const answer = ref(props.me.answer ?? '')
const answerSent = ref(props.me.answer ?? '')
const betError = ref('')

watch(
  () => props.me.bet,
  (b) => {
    if (b !== null) editingBet.value = false
  },
)
watch(
  () => props.me.answer,
  (a) => {
    if (a !== null) answerSent.value = a
  },
)

const max = computed(() => props.me.maxBet)
const quick = computed(() => {
  const m = max.value
  const list = [1, Math.round(m / 4), Math.round(m / 2), m].filter((v, i, arr) => v >= 1 && arr.indexOf(v) === i)
  return list
})

function sendBet(v: number | null = betInput.value) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n) || n < 1 || n > max.value) {
    betError.value = `Ставка — от 1 до ${max.value}`
    return
  }
  betError.value = ''
  betInput.value = n
  emit('bet', n)
}

function sendAnswer() {
  emit('answer', answer.value)
  answerSent.value = answer.value.trim()
}

const dirty = computed(() => answer.value.trim() !== (answerSent.value ?? '').trim())
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
      <template v-if="editingBet">
        <p class="t-center">Сделайте ставку (максимум <b class="nums">{{ max }}</b>)</p>
        <div class="bet-row">
          <input
            v-model.number="betInput"
            class="input bet-input nums"
            type="number"
            inputmode="numeric"
            min="1"
            :max="max"
            placeholder="Ставка"
            @keydown.enter.prevent="sendBet()"
          />
          <button class="btn primary big" @click="sendBet()">Поставить</button>
        </div>
        <div class="quick">
          <button v-for="q in quick" :key="q" class="btn small ghost" @click="sendBet(q)">
            {{ q === max ? `Ва-банк (${q})` : q }}
          </button>
        </div>
        <p v-if="betError" class="error">{{ betError }}</p>
      </template>
      <template v-else>
        <p class="t-center big-text">Ставка принята: <b class="nums">{{ me.bet }}</b></p>
        <button class="btn ghost" @click="editingBet = true">Изменить ставку</button>
        <p class="muted t-center">Ждём остальных участников…</p>
      </template>
    </template>

    <template v-else-if="final.step === 'question'">
      <TimerBar :timer="timer" :now="now" :warn-at="10000" />
      <p class="muted t-center small">Ведущий читает вопрос — напишите ответ, пока идёт время.</p>
      <textarea
        v-model="answer"
        class="textarea answer"
        maxlength="300"
        rows="3"
        placeholder="Ваш ответ"
        enterkeyhint="send"
        @keydown.enter.exact.prevent="sendAnswer"
      />
      <button class="btn primary big block" :disabled="!answer.trim() || !dirty" @click="sendAnswer">
        {{ answerSent && !dirty ? 'Ответ отправлен ✓' : 'Отправить ответ' }}
      </button>
      <p class="muted t-center small">Ответ можно исправить, пока идёт время. Ставка: {{ me.bet ?? 'нет' }}</p>
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
