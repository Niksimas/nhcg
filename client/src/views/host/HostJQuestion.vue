<script setup lang="ts">
// Открытый вопрос «Своей игры» у ведущего: текст, ответ, управление ходом вопроса.
import { computed, ref, watch } from 'vue'
import type { Competitor } from '../../lib/types'
import { competitorMap, fmtScore, textOn, TYPE_LABEL } from '../../lib/util'
import ContentView from '../../components/ContentView.vue'
import Icon from '../../components/Icon.vue'
import { useHost } from './ctx'

const props = defineProps<{ hostPlays: boolean }>()
const { state, run } = useHost()
const s = computed(() => state.value!)
const j = computed(() => s.value.jeopardy!)
const q = computed(() => j.value.question!)
const comps = computed(() => competitorMap(s.value))
const nameOf = (id: string | null | undefined) => (id ? comps.value.get(id)?.name ?? '—' : '—')

const pickId = ref<string | null>(null)
const price = ref<number>(0)
const hideAnswer = computed(() => s.value.settings.hideAnswerOnHost)

const candidates = computed<Competitor[]>(() => {
  const list = s.value.competitors.filter((c) => c.canBuzz)
  if (q.value.type !== 'cat' || q.value.catSelf) return list
  const others = list.filter((c) => c.id !== j.value.chooserId)
  return others.length ? others : list
})

watch(
  () => [q.value.id, q.value.step] as const,
  () => {
    const qq = q.value
    if (qq.step !== 'special') return
    price.value = qq.catPriceOptions?.[0] ?? qq.price
    if (qq.type === 'cat') pickId.value = null
    else pickId.value = j.value.chooserId && comps.value.has(j.value.chooserId) ? j.value.chooserId : candidates.value[0]?.id ?? null
  },
  { immediate: true },
)

const pickedComp = computed(() => (pickId.value ? comps.value.get(pickId.value) : undefined))

function assign() {
  if (!pickId.value) return
  void run('j.assign', { competitorId: pickId.value, price: price.value })
}

const mediaPlaying = computed(() => (props.hostPlays ? q.value.step === 'reading' || q.value.step === 'buzzing' : null))
const hasMedia = computed(() => (q.value.content ?? []).some((c) => c.type !== 'text'))
const responder = computed(() => (q.value.responderId ? comps.value.get(q.value.responderId) : undefined))
</script>

<template>
  <div class="q">
    <div class="q-head">
      <span class="theme">{{ q.themeName }}</span>
      <span class="price nums">{{ q.price }}</span>
      <span v-if="q.type !== 'normal'" class="chip type">{{ TYPE_LABEL[q.type] }}</span>
    </div>

    <div class="q-grid">
      <div class="card q-card">
        <div class="label">Вопрос</div>
        <ContentView :items="q.content" variant="host" :playing="mediaPlaying" />
        <div v-if="hasMedia" class="row media-ctl">
          <span class="muted small">Медиа на экране:</span>
          <button class="btn small" @click="run('media', { action: 'replay' })"><Icon name="refresh" /> Сначала</button>
          <button class="btn small" @click="run('media', { action: 'pause' })"><Icon name="pause" /></button>
          <button class="btn small" @click="run('media', { action: 'play' })"><Icon name="play" /></button>
        </div>
      </div>
      <div class="card a-card" :class="{ hidden: hideAnswer }">
        <div class="label">Ответ {{ hideAnswer ? '(наведите, чтобы увидеть)' : '' }}</div>
        <div class="answer">{{ q.answer || '—' }}</div>
        <ContentView v-if="q.answerContent?.length" :items="q.answerContent" variant="host" />
        <div v-if="q.comment" class="comment">{{ q.comment }}</div>
      </div>
    </div>

    <!-- Спецвопросы -->
    <div v-if="q.step === 'special'" class="card special">
      <template v-if="q.type === 'cat'">
        <div class="special-title">🐱 Кот в мешке — тема «{{ q.catTheme }}»</div>
        <p class="muted">Выбравший вопрос ({{ nameOf(j.chooserId) }}) отдаёт его {{ q.catSelf ? 'любому игроку (можно себе)' : 'другому игроку' }}. Кому?</p>
      </template>
      <template v-else-if="q.type === 'auction'">
        <div class="special-title">💰 Аукцион</div>
        <p class="muted">Игроки называют ставки (не меньше {{ q.basePrice }}). Отметьте победителя торгов и его ставку.</p>
      </template>
      <template v-else>
        <div class="special-title">🛡 Вопрос без риска</div>
        <p class="muted">Отвечает выбравший вопрос. Верный ответ — удвоенная цена ({{ q.price * 2 }}), ошибка без штрафа.</p>
      </template>

      <div class="picks">
        <button
          v-for="c in candidates"
          :key="c.id"
          class="pick"
          :class="{ on: pickId === c.id }"
          :style="{ '--c': c.color, '--t': textOn(c.color) }"
          @click="pickId = c.id"
        >
          {{ c.name }} <span class="nums faint">{{ fmtScore(c.score) }}</span>
        </button>
      </div>

      <div v-if="q.type !== 'norisk'" class="row wrap price-row">
        <span>{{ q.type === 'auction' ? 'Ставка:' : 'Стоимость:' }}</span>
        <template v-if="q.type === 'cat' && q.catPriceOptions">
          <button
            v-for="p in q.catPriceOptions"
            :key="p"
            class="btn small"
            :class="{ primary: price === p }"
            @click="price = p"
          >
            {{ p }}
          </button>
        </template>
        <input v-model.number="price" class="input small price-input nums" type="number" min="0" />
        <button
          v-if="q.type === 'auction' && pickedComp && pickedComp.score > q.basePrice"
          class="btn small ghost"
          @click="price = pickedComp.score"
        >
          Ва-банк ({{ pickedComp.score }})
        </button>
      </div>

      <button class="btn primary big" :disabled="!pickId" @click="assign">
        <Icon name="play" /> {{ q.type === 'cat' ? 'Отдать вопрос' : 'Начать' }}{{ pickedComp ? `: ${pickedComp.name}` : '' }}
      </button>
    </div>

    <!-- Ход вопроса -->
    <div v-else class="controls">
      <template v-if="q.step === 'reading'">
        <button class="btn ok huge" @click="run('j.arm')">
          <Icon name="bolt" /> Принимать ответы <span class="kbd">Пробел</span>
        </button>
        <button class="btn ghost big" @click="run('j.reveal')">Показать ответ <span class="kbd">Esc</span></button>
        <p class="muted hint">Прочитайте вопрос вслух, затем откройте кнопки. Раннее нажатие блокирует кнопку игрока на {{ (s.settings.jEarlyLockMs / 1000).toFixed(1) }} с.</p>
      </template>

      <template v-else-if="q.step === 'buzzing'">
        <div class="waiting"><span class="pulse-dot" /> Кнопки открыты — ждём нажатия…</div>
        <button class="btn big" @click="run('j.reveal')">Никто не знает — показать ответ <span class="kbd">Esc</span></button>
      </template>

      <template v-else-if="q.step === 'answering' && responder">
        <div class="responder" :style="{ '--c': responder.color, '--t': textOn(responder.color) }">
          Отвечает: {{ responder.name }}
          <span v-if="s.buzzer.winner && s.buzzer.winner.competitorId === responder.id" class="react">
            реакция {{ s.buzzer.winner.reaction }} мс
          </span>
        </div>
        <div class="judge">
          <button class="btn ok huge" @click="run('j.judge', { correct: true })">
            <Icon name="check" /> Верно +{{ q.type === 'norisk' ? q.price * 2 : q.price }} <span class="kbd">Enter</span>
          </button>
          <button class="btn bad huge" @click="run('j.judge', { correct: false })">
            <Icon name="x" /> Неверно
            {{ q.type === 'norisk' || !s.settings.jWrongPenalty ? '' : `−${q.price}` }}
            <span class="kbd">Backspace</span>
          </button>
        </div>
      </template>

      <template v-else-if="q.step === 'reveal'">
        <div class="revealed">Ответ показан на экране</div>
        <button class="btn primary huge" @click="run('j.close')"><Icon name="grid" /> К табло <span class="kbd">Enter</span></button>
      </template>

      <div v-if="q.attempts.length" class="attempts">
        <span v-for="(a, i) in q.attempts" :key="i" class="chip" :class="a.correct ? 'ok' : 'bad'">
          {{ a.correct ? '✓' : '✗' }} {{ nameOf(a.competitorId) }} {{ a.delta > 0 ? '+' : '' }}{{ a.delta || '' }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.q {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.q-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  font-size: 1.3rem;
  font-weight: 800;
}
.theme {
  text-transform: uppercase;
  color: var(--muted);
}
.price {
  color: var(--accent);
  font-size: 1.6rem;
}
.type {
  background: #3b2a8f;
}
.q-grid {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 12px;
}
.q-card,
.a-card {
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
.a-card.hidden .comment,
.a-card.hidden :deep(.content) {
  filter: blur(9px);
  transition: filter 0.2s;
}
.a-card.hidden:hover .answer,
.a-card.hidden:hover .comment,
.a-card.hidden:hover :deep(.content) {
  filter: none;
}
.comment {
  font-size: 0.92rem;
  color: var(--muted);
  white-space: pre-wrap;
  border-top: 1px solid var(--line);
  padding-top: 8px;
}
.media-ctl {
  flex-wrap: wrap;
}
.small {
  font-size: 0.85rem;
}
.special {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-color: #6d55ff;
  background: color-mix(in srgb, #6d55ff 12%, var(--panel));
}
.special-title {
  font-size: 1.3rem;
  font-weight: 900;
}
.special p {
  margin: 0;
}
.picks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.pick {
  padding: 0.5em 0.9em;
  border-radius: 10px;
  border: 2px solid var(--c);
  background: transparent;
  color: var(--text);
  font-weight: 700;
  cursor: pointer;
}
.pick.on {
  background: var(--c);
  color: var(--t);
}
.price-input {
  width: 110px;
}
.controls {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}
.hint {
  margin: 0;
  font-size: 0.88rem;
}
.waiting {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.3rem;
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
  font-size: 1.6rem;
  font-weight: 900;
  animation: pop 0.3s ease;
}
.react {
  font-size: 0.9rem;
  font-weight: 600;
  opacity: 0.85;
  margin-left: 8px;
}
.judge {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.revealed {
  color: var(--muted);
  font-weight: 700;
}
.attempts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip.ok {
  background: rgba(34, 197, 94, 0.25);
}
.chip.bad {
  background: rgba(239, 68, 68, 0.25);
}
@media (max-width: 900px) {
  .q-grid {
    grid-template-columns: 1fr;
  }
}
</style>
