<script setup lang="ts">
// Спортивная «Своя игра» у ведущего: вид раунда, распределение игроков по темам, темы и вопросы по порядку.
import { computed } from 'vue'
import type { RoundKind } from '../../lib/types'
import { competitorMap, textOn } from '../../lib/util'
import { KIND_HINT, KIND_TITLE } from '../../lib/rules'
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
const KINDS: RoundKind[] = ['open', 'semi', 'closed', 'captain']

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
          {{ KIND_TITLE[k] }}
        </button>
      </div>
    </div>
    <p v-if="j.kind" class="muted small hint">{{ KIND_HINT[j.kind] }}</p>

    <!-- Капитаны выбирают игроков -->
    <div v-if="j.stage === 'assign' && j.phase" class="card assign">
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
            @change="assign(t.id, j.themeIndex, $event)"
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
          <div v-for="(_, ti) in board" :key="ti" class="cell">
            {{ j.assign[t.id]?.[ti]?.name ?? (j.kind === 'captain' ? 'капитан' : '—') }}
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
  gap: 4px;
  padding: 3px;
  border-radius: 12px;
  background: var(--panel-2);
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
.kind.on {
  background: var(--accent);
  color: var(--accent-text);
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
  background: var(--bg-2);
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
  border-radius: 10px;
  background: var(--c);
  color: var(--t);
  font-weight: 700;
}
.tp .select {
  width: auto;
}
.lineup summary {
  cursor: pointer;
  font-weight: 700;
}
.lineup .assign-table {
  margin-top: 10px;
}
</style>
