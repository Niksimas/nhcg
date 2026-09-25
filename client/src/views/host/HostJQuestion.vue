<script setup lang="ts">
// Вопрос «Своей игры» у ведущего. Текст вопроса ведущий читает со своего листа, здесь — ход вопроса:
// кнопки, кто отвечает, «верно / неверно», спецвопросы (их ведущий отмечает сам).
import { computed, ref, watch } from 'vue'
import type { Competitor, QType } from '../../lib/types'
import { competitorMap, fmtScore, textOn, TYPE_LABEL } from '../../lib/util'
import Icon from '../../components/Icon.vue'
import { useHost } from './ctx'

const { state, run } = useHost()
const s = computed(() => state.value!)
const j = computed(() => s.value.jeopardy!)
const q = computed(() => j.value.question!)
const comps = computed(() => competitorMap(s.value))
const nameOf = (id: string | null | undefined) => (id ? comps.value.get(id)?.name ?? '—' : '—')

const pickId = ref<string | null>(null)
const price = ref<number>(0)

// Кот в мешке выбравший отдаёт другому игроку.
const candidates = computed<Competitor[]>(() => {
  const list = s.value.competitors.filter((c) => c.canBuzz)
  if (q.value.type !== 'cat') return list
  const others = list.filter((c) => c.id !== j.value.chooserId)
  return others.length ? others : list
})

watch(
  () => [q.value.id, q.value.step] as const,
  () => {
    const qq = q.value
    if (qq.step !== 'special') return
    price.value = qq.price
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

const SPECIALS: { type: QType; icon: string; title: string }[] = [
  { type: 'cat', icon: '🐱', title: 'Кот в мешке' },
  { type: 'auction', icon: '💰', title: 'Аукцион' },
  { type: 'norisk', icon: '🛡', title: 'Без риска' },
]

const sport = computed(() => j.value.format === 'sport' || j.value.format === 'khamsa')
// Спортивный формат: сколько вопросов осталось в теме и кто за столом.
const themeLeft = computed(() => {
  const ti = j.value.themeIndex
  if (ti == null) return 0
  return (j.value.board?.[ti]?.questions ?? []).filter((x) => !x.played).length
})
const table = computed(() =>
  j.value.table
    ? s.value.teams
        .filter((t) => j.value.table?.[t.id])
        .map((t) => ({ id: t.id, color: t.color, team: t.name, name: j.value.table?.[t.id]?.name ?? '' }))
    : [],
)
const responder = computed(() => (q.value.responderId ? comps.value.get(q.value.responderId) : undefined))
</script>

<template>
  <div class="q">
    <div class="q-head">
      <span class="theme">{{ q.themeName }}</span>
      <span class="qnum muted">вопрос {{ q.number }}</span>
      <span class="price nums">{{ q.price }}</span>
      <span v-if="q.type !== 'normal'" class="chip type">{{ TYPE_LABEL[q.type] }}</span>
    </div>
    <div v-if="table.length" class="table-row">
      <span class="muted small">За столом:</span>
      <span v-for="t in table" :key="t.id" class="tp" :style="{ '--c': t.color, '--t': textOn(t.color) }">
        {{ t.name }} <span class="faint">({{ t.team }})</span>
      </span>
    </div>

    <!-- Спецвопросы -->
    <div v-if="q.step === 'special'" class="card special">
      <template v-if="q.type === 'cat'">
        <div class="special-title">🐱 Кот в мешке</div>
        <p class="muted">Выбравший вопрос ({{ nameOf(j.chooserId) }}) отдаёт его другому игроку. Назовите тему кота и отметьте, кому он достался.</p>
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
        <p class="read-hint">Прочитайте вопрос со своего листа, затем откройте кнопки.</p>
        <button class="btn ok huge" @click="run('j.arm')">
          <Icon name="bolt" /> Принимать ответы <span class="kbd">Пробел</span>
        </button>
        <button class="btn ghost big" @click="run('j.reveal')">Никто не знает — закрыть вопрос <span class="kbd">Esc</span></button>
        <div v-if="j.specials && q.type === 'normal'" class="specials">
          <span class="muted small">Спецвопрос в листе?</span>
          <button v-for="sp in SPECIALS" :key="sp.type" class="btn small" @click="run('j.special', { type: sp.type })">
            {{ sp.icon }} {{ sp.title }}
          </button>
        </div>
        <p v-if="s.settings.jEarlyLockMs > 0 && j.format !== 'khamsa'" class="muted hint">
          Раннее нажатие блокирует кнопку игрока на {{ (s.settings.jEarlyLockMs / 1000).toFixed(1) }} с.
        </p>
        <p v-else-if="j.format === 'khamsa'" class="muted hint">Нажатие до того, как вы откроете кнопки, — фальстарт.</p>
      </template>

      <template v-else-if="q.step === 'buzzing'">
        <div class="waiting"><span class="pulse-dot" /> Кнопки открыты — ждём нажатия…</div>
        <button class="btn big" @click="run('j.reveal')">Никто не знает — закрыть вопрос <span class="kbd">Esc</span></button>
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
        <div class="revealed">Вопрос сыгран</div>
        <template v-if="sport">
          <button class="btn primary huge" @click="run('j.next')">
            <Icon name="next" /> {{ themeLeft ? 'Следующий вопрос' : 'Тема сыграна — к темам раунда' }} <span class="kbd">Enter</span>
          </button>
          <button class="btn ghost" @click="run('j.close')"><Icon name="grid" /> К темам</button>
        </template>
        <button v-else class="btn primary huge" @click="run('j.close')"><Icon name="grid" /> К табло <span class="kbd">Enter</span></button>
      </template>

      <div v-if="q.attempts.length" class="attempts">
        <span v-for="(a, i) in q.attempts" :key="i" class="chip" :class="a.correct ? 'ok' : 'bad'">
          {{ a.correct ? '✓' : '✗' }} {{ nameOf(a.competitorId) }} {{ a.delta > 0 ? '+' : '' }}{{ a.delta || '' }}
        </span>
      </div>
      <p class="muted hint manual">Счёт можно поправить вручную: кнопки ± у игрока слева или щелчок по его счёту.</p>
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
.table-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: -6px;
}
.tp .faint {
  color: inherit;
  opacity: 0.75;
  font-weight: 600;
}
.tp {
  padding: 3px 11px;
  border-radius: 99px;
  background: var(--c);
  color: var(--t);
  font-weight: 700;
  font-size: 0.9rem;
}
.price {
  color: var(--accent);
  font-size: 1.6rem;
}
.type {
  background: #ede9fe;
  color: #5b21b6;
}
.qnum {
  font-size: 0.95rem;
  font-weight: 600;
}
.read-hint {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
}
.specials {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.manual {
  margin-top: 4px;
}
.small {
  font-size: 0.85rem;
}
.special {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-color: #c4b5fd;
  background: linear-gradient(180deg, #f5f3ff, var(--panel) 80%);
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
  background: var(--panel);
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
  color: var(--ok);
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
  font-weight: 800;
  box-shadow: 0 10px 24px -10px var(--c);
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
  background: var(--ok-soft);
  color: var(--ok-2);
}
.chip.bad {
  background: var(--bad-soft);
  color: var(--bad-2);
}
</style>
