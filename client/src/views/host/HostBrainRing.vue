<script setup lang="ts">
// «Брейн-ринг» у ведущего: кнопка «Время!», таймер, приём ответов, счёт боя. Вопросы — с листа ведущего.
import { computed, ref, watch } from 'vue'
import { competitorMap, textOn, timerLeft } from '../../lib/util'
import BrStandings from '../../components/BrStandings.vue'
import TimerBar from '../../components/TimerBar.vue'
import Icon from '../../components/Icon.vue'
import { useHost } from './ctx'

const { state, run, now } = useHost()
const s = computed(() => state.value!)
const br = computed(() => s.value.brainring!)
const comps = computed(() => competitorMap(s.value))
const nameOf = (id: string | null | undefined) => (id ? comps.value.get(id)?.name ?? '—' : '—')
const b = computed(() => s.value.buzzer)
const responder = computed(() => (br.value.stage === 'answering' && b.value.winner ? comps.value.get(b.value.winner.competitorId) : undefined))
const mainLeft = computed(() => timerLeft(s.value.timers.main, now.value))

const falseStarters = computed(() => b.value.falseStarts.map((id) => nameOf(id)))
const history = computed(() => [...br.value.history].reverse().slice(0, 12))
const RESULT: Record<string, string> = { correct: 'взят', burned: 'не взят', cancelled: 'снят' }

async function next() {
  await run('br.next')
}
async function setValue() {
  const v = prompt('Сколько очков стоит этот вопрос?', String(br.value.value))
  if (v === null) return
  await run('br.value', { value: Number(v) })
}
// ── бои ──
const battle = computed(() => br.value.battle)
const last = computed(() => br.value.lastBattle)
const active = computed(() => s.value.competitors.filter((c) => c.canBuzz))
const picked = ref<string[]>([])
// Предлагаем пару, которая ещё не встречалась (или обе команды, если их две).
watch(
  () => [battle.value?.no ?? null, br.value.battles.length, (br.value.nextPair ?? []).join()] as const,
  () => {
    if (!battle.value) picked.value = [...(br.value.nextPair ?? [])]
  },
  { immediate: true },
)
function togglePick(id: string) {
  picked.value = picked.value.includes(id) ? picked.value.filter((x) => x !== id) : [...picked.value, id]
}
async function startBattle() {
  await run('br.battle', { teams: picked.value })
}
async function endBattle() {
  if (!confirm('Завершить бой сейчас? Победит тот, у кого больше очков в бою, при равенстве — ничья.')) return
  await run('br.endBattle')
}
async function finish() {
  if (!confirm('Показать итоги турнира?')) return
  await run('br.finish')
}
const battleLabel = computed(() => {
  const bt = battle.value
  if (!bt) return ''
  const n = bt.played + (br.value.stage === 'reveal' || br.value.stage === 'idle' ? 0 : 1)
  const q = Math.max(1, Math.min(n, bt.limit || n))
  const extra = bt.limit && n > s.value.settings.brBattleQuestions ? ' (дополнительный)' : ''
  return `Бой №${bt.no} · вопрос ${q}${bt.limit ? ` из ${bt.limit}` : ''}${extra}`
})
const needsSetup = computed(() => !battle.value && (br.value.stage === 'idle' || br.value.stage === 'battleEnd'))
</script>

<template>
  <div class="br">
    <div class="top-row">
      <div class="qnum">
        <template v-if="battle">{{ battleLabel }}</template>
        <template v-else-if="br.stage === 'battleEnd' && last">Бой №{{ last.no }} окончен</template>
        <template v-else>Бой не начат</template>
      </div>
      <button v-if="battle && ['reading', 'armed', 'answering'].includes(br.stage)" class="chip value" title="Изменить стоимость" @click="setValue">
        Стоимость: <b>{{ br.value }}</b>
      </button>
      <span v-if="br.carry > 0 && (br.stage === 'reveal' || br.stage === 'idle')" class="chip warn">
        Перенос: +{{ br.carry }} к следующему вопросу
      </span>
      <div class="grow" />
      <button v-if="battle" class="btn small ghost" @click="endBattle"><Icon name="flag" /> Завершить бой</button>
      <button v-else-if="br.stage !== 'finished'" class="btn small ghost" @click="finish"><Icon name="trophy" /> Итоги турнира</button>
    </div>

    <!-- Счёт текущего боя -->
    <div v-if="battle" class="battle-bar">
      <div
        v-for="id in battle.teams"
        :key="id"
        class="bt"
        :class="{ lead: (battle.scores[id] ?? 0) > 0 && battle.teams.every((x) => (battle!.scores[x] ?? 0) <= (battle!.scores[id] ?? 0)) }"
        :style="{ '--c': comps.get(id)?.color ?? '#888', '--t': textOn(comps.get(id)?.color ?? '#888') }"
      >
        <span class="bt-name ellipsis">{{ nameOf(id) }}</span>
        <b class="bt-score nums">{{ battle.scores[id] ?? 0 }}</b>
      </div>
    </div>

    <!-- Ничья: решает ведущий -->
    <div v-if="battle?.tie" class="card tie">
      <div class="result burned">Ничья {{ battle.teams.map((id) => battle!.scores[id] ?? 0).join(' : ') }}</div>
      <div class="row wrap">
        <button class="btn primary big" @click="run('br.extra')"><Icon name="plus" /> Дополнительный вопрос</button>
        <button class="btn big" @click="run('br.draw')">Засчитать ничью (+{{ s.settings.brDrawPoints }})</button>
      </div>
    </div>

    <!-- Итог боя -->
    <div v-if="br.stage === 'battleEnd' && last" class="card battle-end">
      <div class="result ok">
        Бой №{{ last.no }}: {{ last.teams.map((id) => `${nameOf(id)} ${last!.scores[id] ?? 0}`).join(' — ') }}
      </div>
      <div class="be-winner">
        {{ last.winnerId ? `Победа: ${nameOf(last.winnerId)} (+${s.settings.brWinPoints})` : `Ничья (+${s.settings.brDrawPoints} каждой)` }}
      </div>
    </div>

    <!-- Выбор команд на следующий бой -->
    <div v-if="needsSetup && active.length" class="card setup">
      <div class="label">{{ br.battles.length ? 'Следующий бой' : 'Первый бой' }}: кто играет?</div>
      <div class="picks">
        <button
          v-for="c in active"
          :key="c.id"
          class="pick"
          :class="{ on: picked.includes(c.id) }"
          :style="{ '--c': c.color, '--t': textOn(c.color) }"
          @click="togglePick(c.id)"
        >
          {{ c.name }}
        </button>
      </div>
      <button class="btn primary big" :disabled="picked.length < Math.min(2, active.length)" @click="startBattle">
        <Icon name="play" /> Начать бой №{{ br.battles.length + 1 }}
      </button>
      <p class="muted small">
        Бой — {{ s.settings.brBattleQuestions || 'сколько угодно' }} вопросов{{ s.settings.brTargetScore ? ` или до ${s.settings.brTargetScore} очков` : '' }}.
        За победу — +{{ s.settings.brWinPoints }} в турнирную таблицу. Предложена пара, которая ещё не встречалась.
      </p>
    </div>


    <div class="control card">
      <template v-if="br.stage === 'idle' && battle">
        <button class="btn primary huge" @click="next">
          <Icon name="play" /> Первый вопрос боя <span class="kbd">Enter</span>
        </button>
      </template>
      <template v-else-if="needsSetup">
        <p class="muted">Выберите команды и начните бой.</p>
      </template>

      <template v-else-if="br.stage === 'reading'">
        <div class="hint">Прочитайте вопрос №{{ br.qIndex + 1 }} со своего листа. Нажатие кнопки до сигнала — фальстарт.</div>
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
        <button v-if="!battle?.tie" class="btn primary huge" @click="next">
          <Icon name="next" /> Следующий вопрос <span class="kbd">Enter</span>
        </button>
      </template>

      <template v-else-if="br.stage === 'finished'">
        <div class="result ok">{{ br.winnerId ? `Победитель турнира: ${nameOf(br.winnerId)}!` : 'Итоги турнира' }}</div>
        <div class="row wrap">
          <button class="btn big" @click="run('br.continue')"><Icon name="play" /> Продолжить турнир</button>
        </div>
      </template>

      <div v-if="falseStarters.length" class="fs">Фальстарт: {{ falseStarters.join(', ') }}</div>
    </div>

    <div class="card table-card">
      <div class="label">
        Турнирная таблица
        <span class="faint">
          · {{ s.settings.brTotal === 'sum' ? 'очки = взятые вопросы + очки за победы' : 'очки — только за победы и ничьи' }}
        </span>
      </div>
      <BrStandings
        :standings="br.standings"
        :competitors="s.competitors"
        :highlight="battle?.teams ?? []"
        :winner-id="br.stage === 'finished' ? br.winnerId : null"
      />
    </div>

    <div v-if="br.battles.length" class="history">
      <div class="label">Бои</div>
      <div v-for="bt in [...br.battles].reverse().slice(0, 12)" :key="bt.no" class="h-row">
        <span class="faint nums">№{{ bt.no }}</span>
        <span>{{ bt.teams.map((id) => `${nameOf(id)} ${bt.scores[id] ?? 0}`).join(' — ') }}</span>
        <span class="faint">· {{ bt.winnerId ? `победа ${nameOf(bt.winnerId)}` : 'ничья' }}</span>
      </div>
    </div>

    <div v-if="history.length" class="history">
      <div class="label">Вопросы</div>
      <div v-for="(h, i) in history" :key="i" class="h-row">
        <span class="faint nums">№{{ h.index + 1 }}</span>
        <span>{{ RESULT[h.result] }}</span>
        <span v-if="h.competitorId">· {{ nameOf(h.competitorId) }} +{{ h.value }}</span>
      </div>
    </div>

  </div>
</template>

<style scoped>
.battle-bar {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.bt {
  flex: 1 1 160px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 16px;
  border-radius: 14px;
  background: var(--c);
  color: var(--t);
  font-weight: 800;
  font-size: 1.2rem;
  box-shadow: 0 10px 22px -12px var(--c);
}
.bt.lead {
  box-shadow:
    0 0 0 3px var(--panel),
    0 0 0 6px var(--gold);
}
.bt-score {
  font-size: 2rem;
}
.tie,
.battle-end,
.setup {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
}
.be-winner {
  font-size: 1.3rem;
  font-weight: 800;
  color: var(--accent);
}
.picks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.pick {
  padding: 8px 14px;
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
.table-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

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
  background: var(--warn-soft);
  color: #92400e;
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
  font-size: 1.7rem;
  font-weight: 800;
  box-shadow: 0 10px 24px -10px var(--c);
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
  color: var(--bad);
  font-weight: 700;
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
@media (max-width: 760px) {
  .control {
    align-items: stretch;
  }
  .time-btn {
    font-size: 1.9rem;
    padding: 0.55em 1em;
  }
  .responder {
    font-size: 1.3rem;
    padding: 10px 14px;
  }
  .react {
    display: block;
    margin-left: 0;
  }
  /* «Верно» и «Неверно» рядом — под большой палец. */
  .judge {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .judge .btn {
    flex-direction: column;
    gap: 2px;
    min-height: 92px;
    padding: 0.5em 0.4em;
    font-size: 1.12rem;
  }
  .setup > .btn,
  .tie .btn {
    width: 100%;
  }
}
</style>
