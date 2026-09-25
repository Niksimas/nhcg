<script setup lang="ts">
// Спортивная «Своя игра» у ведущего: вид раунда, распределение игроков по темам, темы и вопросы по порядку.
import { computed } from 'vue'
import type { RoundKind } from '../../lib/types'
import { competitorMap, fmtScore, textOn } from '../../lib/util'
import { KIND_HINT, kindsFor, kindTitle } from '../../lib/rules'
import BoardGrid from '../../components/BoardGrid.vue'
import TimerBar from '../../components/TimerBar.vue'
import Icon from '../../components/Icon.vue'
import { useHost } from './ctx'

const { state, run, now } = useHost()
const s = computed(() => state.value!)
const j = computed(() => s.value.jeopardy!)
const comps = computed(() => competitorMap(s.value))
const round = computed(() => j.value.rounds[j.value.roundIndex])
const board = computed(() => j.value.board ?? [])
const KINDS = computed<RoundKind[]>(() => kindsFor(j.value.format))
const khamsa = computed(() => j.value.format === 'khamsa')
// «Хамса», четвёртый раунд: кто сейчас убирает тему и сколько тем осталось.
const strike = computed(() => j.value.strike ?? null)
const strikeLeft = computed(() => board.value.filter((t) => !t.struck).length)

// Команды, у которых есть игроки, — они играют темы.
const teams = computed(() => s.value.teams.filter((t) => s.value.players.some((p) => p.teamId === t.id)))
const membersOf = (teamId: string) => s.value.players.filter((p) => p.teamId === teamId)
const themeName = (ti: number) => board.value[ti]?.name ?? `Тема ${ti + 1}`
const pickOf = (teamId: string, ti: number) => j.value.assign?.[teamId]?.[ti]?.playerId ?? ''

const nextTheme = computed(() => {
  if (j.value.themeIndex != null) {
    const cur = board.value[j.value.themeIndex]
    if (cur && cur.questions.some((q) => !q.played)) return j.value.themeIndex
  }
  const i = board.value.findIndex((t) => t.questions.some((q) => !q.played))
  return i >= 0 ? i : null
})
const nextPrice = computed(() => {
  const ti = j.value.themeIndex
  if (ti == null) return null
  return board.value[ti]?.questions.find((q) => !q.played)?.price ?? null
})
const assignScopeThemes = computed(() => (j.value.phase?.themes ?? []).map((t) => t.index))

function setKind(kind: RoundKind) {
  if (kind === j.value.kind) return
  void run('j.kind', { kind })
}

function assign(teamId: string, themeIndex: number, ev: Event) {
  const playerId = (ev.target as HTMLSelectElement).value
  if (playerId) void run('j.assign.set', { teamId, themeIndex, playerId })
}

async function select(id: string, played: boolean) {
  if (played && !confirm('Этот вопрос уже сыгран. Открыть его снова?')) return
  await run('j.select', { id, force: played })
}
</script>

<template>
  <div class="sport">
    <div class="kind-row">
      <span class="label">Раунд «{{ round?.name }}»</span>
      <div class="kinds">
        <button
          v-for="k in KINDS"
          :key="k"
          class="kind"
          :class="{ on: j.kind === k }"
          :title="KIND_HINT[k]"
          @click="setKind(k)"
        >
          {{ kindTitle(k, j.format) }}
        </button>
      </div>
      <span v-if="khamsa && j.roundNumber" class="muted small">Раунд {{ j.roundNumber }} из 5 · вопросы ×{{ j.roundNumber }}</span>
    </div>
    <p v-if="j.kind" class="muted small hint">{{ KIND_HINT[j.kind] }}</p>

    <!-- Капитаны выбирают игроков -->
    <div v-if="j.stage === 'assign' && j.phase && j.phase.scope === 'leader'" class="card assign">
      <div class="assign-head">
        <h3>Капитаны выбирают игрока четвёртого раунда</h3>
        <TimerBar v-if="s.timers.assign" :timer="s.timers.assign" :now="now" />
      </div>
      <p class="muted small">
        Обычно — самого сильного. Затем команды по очереди уберут темы, оставшуюся сыграют выбранные игроки.
      </p>
      <div class="assign-table" :style="{ '--n': 1 }">
        <div class="cell head">Команда</div>
        <div class="cell head">Играет раунд</div>
        <template v-for="t in teams" :key="t.id">
          <div class="cell team" :style="{ '--c': t.color, '--t': textOn(t.color) }">
            <span class="team-name">{{ t.name }}</span>
            <span v-if="j.phase.ready.includes(t.id)" class="ready">✓ готово</span>
          </div>
          <div class="cell">
            <select class="select small" :value="j.leaders?.[t.id]?.playerId ?? ''" @change="assign(t.id, -1, $event)">
              <option value="">— капитан —</option>
              <option v-for="p in membersOf(t.id)" :key="p.id" :value="p.id">
                {{ p.name }}{{ p.id === t.captainId ? ' (кап.)' : '' }}
              </option>
            </select>
          </div>
        </template>
      </div>
      <button class="btn primary big" @click="run('j.assign.done')">
        <Icon name="play" /> Готово — к выбору темы <span class="kbd">Enter</span>
      </button>
    </div>

    <div v-else-if="j.stage === 'assign' && j.phase" class="card assign">
      <div class="assign-head">
        <h3>
          {{ j.phase.scope === 'round' ? 'Капитаны распределяют игроков по темам' : `Тема «${themeName(j.phase.themes[0]?.index ?? 0)}»: капитаны выбирают игрока` }}
        </h3>
        <TimerBar v-if="s.timers.assign" :timer="s.timers.assign" :now="now" />
      </div>
      <p class="muted small">
        Капитаны выбирают на своих телефонах. Вы тоже можете поставить игрока. Кого не выберут — программа назначит сама.
      </p>
      <div class="assign-table" :style="{ '--n': assignScopeThemes.length }">
        <div class="cell head">Команда</div>
        <div v-for="ti in assignScopeThemes" :key="ti" class="cell head">
          {{ themeName(ti) }}
          <span v-if="board[ti]?.hidden" class="faint small"> (игроки не видят)</span>
        </div>
        <template v-for="t in teams" :key="t.id">
          <div class="cell team" :style="{ '--c': t.color, '--t': textOn(t.color) }">
            <span class="team-name">{{ t.name }}</span>
            <span v-if="j.phase.ready.includes(t.id)" class="ready">✓ готово</span>
          </div>
          <div v-for="ti in assignScopeThemes" :key="ti" class="cell">
            <select class="select small" :value="pickOf(t.id, ti)" @change="assign(t.id, ti, $event)">
              <option value="">— не выбран —</option>
              <option v-for="p in membersOf(t.id)" :key="p.id" :value="p.id">
                {{ p.name }}{{ p.id === t.captainId ? ' (кап.)' : '' }}
              </option>
            </select>
          </div>
        </template>
      </div>
      <button class="btn primary big" @click="run('j.assign.done')">
        <Icon name="play" /> Готово — {{ j.phase.scope === 'round' ? 'к темам раунда' : 'начать тему' }} <span class="kbd">Enter</span>
      </button>
    </div>

    <!-- «Хамса», четвёртый раунд: команды по очереди убирают темы -->
    <div v-else-if="j.stage === 'strike' && strike" class="card strike">
      <h3>Команды по очереди убирают темы — останется одна</h3>
      <div class="order">
        <span
          v-for="(id, i) in strike.order"
          :key="id"
          class="order-chip"
          :class="{ on: id === strike.current }"
          :style="{ '--c': comps.get(id)?.color ?? '#888', '--t': textOn(comps.get(id)?.color ?? '#888') }"
        >
          {{ i + 1 }}. {{ comps.get(id)?.name }} <span class="faint-in">{{ fmtScore(comps.get(id)?.score ?? 0) }}</span>
        </span>
      </div>
      <p class="muted small">
        Сейчас убирает: <b>{{ comps.get(strike.current ?? '')?.name }}</b> — капитан или игрок раунда нажимает на телефоне,
        либо нажмите тему здесь за команду. Осталось тем: {{ strikeLeft }}.
      </p>
      <div class="strike-list">
        <button
          v-for="(th, ti) in board"
          :key="ti"
          class="strike-theme"
          :class="{ struck: th.struck }"
          :disabled="th.struck"
          @click="run('j.strike', { index: ti })"
        >
          <span>{{ th.name }}</span>
          <span v-if="!th.struck" class="strike-act"><Icon name="x" /> Убрать</span>
        </button>
      </div>
    </div>

    <!-- Темы раунда -->
    <template v-else-if="j.stage === 'board'">
      <BoardGrid :board="board" variant="host" clickable @select="select" />
      <div class="row wrap actions">
        <button v-if="nextTheme != null" class="btn primary huge" @click="run('j.next')">
          <Icon name="play" /> {{ j.themeIndex === nextTheme ? 'Продолжить тему' : 'Следующая тема' }}: «{{ themeName(nextTheme) }}»
          <span class="kbd">Enter</span>
        </button>
        <button
          v-if="j.tablePlay && j.kind !== 'captain'"
          class="btn ghost"
          title="Капитаны выберут игроков заново"
          @click="run('j.assign.start')"
        >
          <Icon name="users" /> Выбрать игроков заново
        </button>
      </div>
    </template>

    <!-- Тема объявлена -->
    <div v-else-if="j.stage === 'theme' && j.themeIndex != null" class="card theme-card">
      <div class="label">Тема {{ j.themeIndex + 1 }} из {{ board.length }}</div>
      <h2 class="theme-title">{{ themeName(j.themeIndex) }}</h2>
      <div v-if="j.table" class="table-players">
        <div v-for="t in teams" :key="t.id" class="tp" :style="{ '--c': t.color, '--t': textOn(t.color) }">
          <span class="team-name">{{ t.name }}</span>
          <select
            v-if="j.kind !== 'captain'"
            class="select small"
            :value="j.table[t.id]?.playerId ?? ''"
            title="Кто играет эту тему"
            @change="assign(t.id, j.kind === 'leaders' ? -1 : j.themeIndex, $event)"
          >
            <option v-for="p in membersOf(t.id)" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <b v-else>{{ j.table[t.id]?.name ?? '—' }}</b>
        </div>
      </div>
      <p v-else class="muted">Тему играют все участники{{ s.settings.teamMode ? ' команд' : '' }}.</p>
      <button class="btn ok huge" @click="run('j.next')">
        <Icon name="play" /> Первый вопрос{{ nextPrice != null ? ` за ${nextPrice}` : '' }} <span class="kbd">Enter</span>
      </button>
    </div>

    <!-- Расстановка на раунд -->
    <details v-if="j.tablePlay && j.assign && j.stage !== 'assign' && teams.length" class="card lineup" :open="j.stage === 'board'">
      <summary>Кто какую тему играет</summary>
      <div class="assign-table" :style="{ '--n': board.length }">
        <div class="cell head">Команда</div>
        <div v-for="(th, ti) in board" :key="ti" class="cell head">{{ th.name ?? `Тема ${ti + 1}` }}</div>
        <template v-for="t in teams" :key="t.id">
          <div class="cell team" :style="{ '--c': t.color, '--t': textOn(t.color) }">
            <span class="team-name">{{ comps.get(t.id)?.name ?? t.name }}</span>
          </div>
          <div v-for="(th, ti) in board" :key="ti" class="cell" :class="{ struck: th.struck }">
            {{
              j.kind === 'leaders'
                ? th.struck
                  ? '—'
                  : j.leaders?.[t.id]?.name ?? 'капитан'
                : j.assign[t.id]?.[ti]?.name ?? (j.kind === 'captain' ? 'капитан' : '—')
            }}
          </div>
        </template>
      </div>
    </details>
  </div>
</template>

<style scoped>
.sport {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.kind-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.kinds {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 3px;
  border-radius: 12px;
  background: var(--panel-3);
}
.kind {
  border: none;
  background: transparent;
  color: var(--muted);
  font-weight: 700;
  padding: 0.4em 0.8em;
  border-radius: 9px;
  cursor: pointer;
}
.kind:hover:not(.on) {
  color: var(--text);
}
.kind.on {
  background: var(--panel);
  color: var(--accent);
  box-shadow: var(--shadow-sm);
}
.hint {
  margin: -4px 0 0;
}
.small {
  font-size: 0.85rem;
}
.assign {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.assign-head {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.assign-head h3 {
  margin: 0;
}
.assign-table {
  display: grid;
  grid-template-columns: minmax(120px, 1.2fr) repeat(var(--n), minmax(120px, 1fr));
  gap: 6px;
  overflow-x: auto;
}
.cell {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 4px 6px;
  border-radius: 8px;
  background: var(--panel-2);
  font-size: 0.9rem;
}
.cell.head {
  background: transparent;
  font-weight: 700;
  color: var(--muted);
  text-transform: uppercase;
  font-size: 0.8rem;
}
.cell.team {
  background: var(--c);
  color: var(--t);
  font-weight: 700;
  justify-content: space-between;
}
.cell .select {
  width: 100%;
}
.team-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ready {
  font-size: 0.8rem;
  white-space: nowrap;
}
.actions {
  align-items: center;
}
.theme-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}
.theme-title {
  margin: 0;
  font-size: 2rem;
  text-transform: uppercase;
}
.table-players {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tp {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 12px;
  background: var(--c);
  color: var(--t);
  font-weight: 700;
}
.tp .select {
  color: var(--text);
}
.tp .select {
  width: auto;
}
.strike {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.strike h3 {
  margin: 0;
}
.order {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.order-chip {
  padding: 4px 10px;
  border-radius: 99px;
  border: 2px solid var(--c);
  font-weight: 700;
  font-size: 0.9rem;
}
.order-chip.on {
  background: var(--c);
  color: var(--t);
}
.faint-in {
  opacity: 0.7;
  font-weight: 600;
}
.strike-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.strike-theme {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid var(--board-edge);
  background: linear-gradient(180deg, var(--board), var(--board-2));
  box-shadow: var(--shadow-sm);
  color: var(--text);
  font-weight: 800;
  text-transform: uppercase;
  cursor: pointer;
  text-align: left;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.strike-theme:hover:not(:disabled) {
  border-color: #f5b5b5;
  background: var(--bad-soft);
}
.strike-theme.struck {
  opacity: 0.35;
  text-decoration: line-through;
  cursor: default;
}
.strike-act {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8rem;
  color: var(--bad);
  text-transform: none;
}
.cell.struck {
  opacity: 0.4;
}
.lineup summary {
  cursor: pointer;
  font-weight: 700;
}
.lineup .assign-table {
  margin-top: 10px;
}
</style>
