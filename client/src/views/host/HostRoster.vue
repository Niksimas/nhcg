<script setup lang="ts">
// Список игроков/команд со счётом: переименование, перенос между командами, ручная правка очков.
import { computed, nextTick, ref } from 'vue'
import type { Competitor, PlayerInfo } from '../../lib/types'
import { fmtScore, plural, textOn } from '../../lib/util'
import { PALETTE_UI } from './palette'
import Icon from '../../components/Icon.vue'
import { useHost } from './ctx'

const { state, run, conn, flash } = useHost()

const s = computed(() => state.value!)
const teamMode = computed(() => s.value.settings.teamMode)
const pings = conn.pings

const chooserId = computed(() => (s.value.stage === 'game' && s.value.mode === 'jeopardy' ? s.value.jeopardy?.chooserId ?? null : null))
const activeId = computed(() => {
  const b = s.value.buzzer
  if (b.status === 'answering' && b.winner) return b.winner.competitorId
  const q = s.value.jeopardy?.question
  return q?.step === 'answering' ? q.responderId : null
})
const lockedOut = computed(() => new Set(s.value.buzzer.lockedOut))
const falseStarts = computed(() => new Set(s.value.buzzer.falseStarts))

const step = computed(() => {
  if (s.value.mode === 'brainring') return 1
  const q = s.value.jeopardy?.question
  if (q) return q.price || 100
  const round = s.value.jeopardy?.board
  const prices = round?.flatMap((t) => t.questions.map((x) => x.price)).filter((p) => p > 0) ?? []
  return prices.length ? Math.min(...prices) : 100
})

const unassigned = computed(() => s.value.players.filter((p) => !p.teamId || !s.value.teams.some((t) => t.id === p.teamId)))
const membersOf = (teamId: string) => s.value.players.filter((p) => p.teamId === teamId)

// ── редактирование ──
const editing = ref<{ kind: 'score' | 'player' | 'team'; id: string; value: string } | null>(null)
const inputRef = ref<HTMLInputElement[] | HTMLInputElement | null>(null)

function startEdit(kind: 'score' | 'player' | 'team', id: string, value: string | number) {
  editing.value = { kind, id, value: String(value) }
  void nextTick(() => {
    const el = Array.isArray(inputRef.value) ? inputRef.value[0] : inputRef.value
    el?.focus()
    el?.select()
  })
}

async function commitEdit() {
  const e = editing.value
  if (!e) return
  editing.value = null
  if (e.kind === 'score') {
    const v = Number(e.value.replace(',', '.').replace(/\s/g, ''))
    if (Number.isFinite(v)) await run('score.set', { competitorId: e.id, value: v })
  } else if (e.kind === 'player') {
    if (e.value.trim()) await run('player.rename', { playerId: e.id, name: e.value })
  } else if (e.kind === 'team') {
    if (e.value.trim()) await run('team.rename', { teamId: e.id, name: e.value })
  }
}

function add(c: Competitor, sign: 1 | -1) {
  void run('score.add', { competitorId: c.id, delta: sign * step.value })
}

async function removePlayer(p: PlayerInfo) {
  if (!confirm(`Удалить игрока «${p.name}» из игры?`)) return
  await run('player.remove', { playerId: p.id })
}

async function removeTeam(c: Competitor) {
  if (!confirm(`Удалить команду «${c.name}»? Игроки останутся без команды.`)) return
  await run('team.remove', { teamId: c.id })
}

async function addTeam() {
  const name = prompt('Название команды', `Команда ${s.value.teams.length + 1}`)
  if (name === null) return
  await run('team.add', { name })
}

function setTeam(p: PlayerInfo, teamId: string) {
  void run('player.team', { playerId: p.id, teamId: teamId || null })
}

const colorFor = ref<string | null>(null)
function pickColor(c: Competitor, color: string) {
  colorFor.value = null
  if (c.kind === 'team') void run('team.color', { teamId: c.id, color })
  else void run('player.color', { playerId: c.id, color })
}

function setChooser(c: Competitor) {
  void run('j.chooser', { competitorId: c.id })
}

function unlock(c: Competitor) {
  void run('buzzer.unlock', { competitorId: c.id })
}

function pingText(id: string) {
  const v = pings.value[id]
  return v == null ? '' : `${v} мс`
}
function pingClass(id: string) {
  const v = pings.value[id]
  if (v == null) return ''
  return v < 80 ? 'good' : v < 200 ? 'mid' : 'bad'
}
const title = computed(() => {
  const n = teamMode.value ? s.value.teams.length : s.value.players.length
  return teamMode.value ? `${n} ${plural(n, 'команда', 'команды', 'команд')}` : `${n} ${plural(n, 'игрок', 'игрока', 'игроков')}`
})
</script>

<template>
  <div class="roster">
    <div class="roster-head">
      <span class="label">{{ title }}</span>
      <button v-if="teamMode" class="btn small" @click="addTeam"><Icon name="plus" /> Команда</button>
    </div>

    <p v-if="!s.competitors.length" class="empty muted">
      {{ teamMode ? 'Создайте команды или дождитесь, пока игроки их создадут.' : 'Пока никто не подключился. Покажите игрокам QR-код.' }}
    </p>

    <div
      v-for="c in s.competitors"
      :key="c.id"
      class="comp"
      :class="{
        active: c.id === activeId,
        locked: lockedOut.has(c.id),
        chooser: c.id === chooserId,
        offline: !c.connected,
      }"
      :style="{ '--c': c.color, '--t': textOn(c.color) }"
    >
      <div :key="`f${flash[c.id] ?? 0}`" class="comp-main" :class="{ flash: !!flash[c.id] }">
        <button class="swatch" title="Цвет" @click="colorFor = colorFor === c.id ? null : c.id" />
        <div class="grow name-wrap">
          <input
            v-if="editing && editing.kind === (c.kind === 'team' ? 'team' : 'player') && editing.id === c.id"
            ref="inputRef"
            v-model="editing.value"
            class="input small"
            maxlength="32"
            @keydown.enter="commitEdit"
            @keydown.esc="editing = null"
            @blur="commitEdit"
          />
          <div v-else class="name ellipsis" title="Нажмите, чтобы переименовать" @click="startEdit(c.kind === 'team' ? 'team' : 'player', c.id, c.name)">
            <span v-if="c.id === chooserId" class="tag-ch" title="Выбирает вопрос">▶</span>
            {{ c.name }}
          </div>
          <div class="meta">
            <template v-if="c.kind === 'player'">
              <span class="conn" :class="c.connected ? pingClass(c.id) : 'off'">
                {{ c.connected ? pingText(c.id) || 'в сети' : 'нет связи' }}
              </span>
            </template>
            <template v-else>
              <span class="muted">{{ c.members.length }} {{ plural(c.members.length, 'игрок', 'игрока', 'игроков') }}</span>
            </template>
            <span v-if="falseStarts.has(c.id)" class="bad-tag">фальстарт</span>
            <span v-else-if="lockedOut.has(c.id)" class="bad-tag">отвечал</span>
            <button
              v-if="lockedOut.has(c.id)"
              class="link"
              title="Разрешить снова нажимать кнопку в этом вопросе"
              @click="unlock(c)"
            >
              снять
            </button>
          </div>
        </div>
        <div class="score-wrap">
          <input
            v-if="editing && editing.kind === 'score' && editing.id === c.id"
            ref="inputRef"
            v-model="editing.value"
            class="input small score-input nums"
            inputmode="numeric"
            @keydown.enter="commitEdit"
            @keydown.esc="editing = null"
            @blur="commitEdit"
          />
          <div v-else class="score nums" :class="{ neg: c.score < 0 }" title="Нажмите, чтобы изменить" @click="startEdit('score', c.id, c.score)">
            {{ fmtScore(c.score) }}
          </div>
          <div class="pm">
            <button class="btn small flat" :title="`−${step}`" @click="add(c, -1)"><Icon name="minus" size="0.9em" /></button>
            <button class="btn small flat" :title="`+${step}`" @click="add(c, 1)"><Icon name="plus" size="0.9em" /></button>
          </div>
        </div>
      </div>

      <div v-if="colorFor === c.id" class="palette">
        <button v-for="col in PALETTE_UI" :key="col" class="swatch-pick" :style="{ background: col }" @click="pickColor(c, col)" />
      </div>

      <div class="actions">
        <button v-if="chooserId !== null && s.mode === 'jeopardy' && c.id !== chooserId" class="link" @click="setChooser(c)">
          сделать выбирающим
        </button>
        <button v-if="c.kind === 'player'" class="link danger" @click="removePlayer(s.players.find((p) => p.id === c.id)!)">удалить</button>
        <button v-else class="link danger" @click="removeTeam(c)">удалить</button>
      </div>

      <div v-if="c.kind === 'team'" class="members">
        <div v-for="p in membersOf(c.id)" :key="`${p.id}-${flash[p.id] ?? 0}`" class="member" :class="{ flash: !!flash[p.id] }">
          <span class="conn-dot" :class="p.connected ? pingClass(p.id) || 'good' : 'off'" />
          <input
            v-if="editing && editing.kind === 'player' && editing.id === p.id"
            ref="inputRef"
            v-model="editing.value"
            class="input small"
            maxlength="24"
            @keydown.enter="commitEdit"
            @keydown.esc="editing = null"
            @blur="commitEdit"
          />
          <span v-else class="grow ellipsis" @click="startEdit('player', p.id, p.name)">{{ p.name }}</span>
          <span class="faint small">{{ pingText(p.id) }}</span>
          <select class="select small team-sel" :value="p.teamId ?? ''" title="Перевести в другую команду" @change="setTeam(p, ($event.target as HTMLSelectElement).value)">
            <option value="">без команды</option>
            <option v-for="t in s.teams" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
          <button class="btn small flat icon" title="Удалить игрока" @click="removePlayer(p)"><Icon name="x" size="0.85em" /></button>
        </div>
      </div>
    </div>

    <div v-if="teamMode && unassigned.length" class="unassigned">
      <div class="label">Без команды</div>
      <div v-for="p in unassigned" :key="p.id" class="member">
        <span class="conn-dot" :class="p.connected ? 'good' : 'off'" />
        <span class="grow ellipsis">{{ p.name }}</span>
        <select class="select small team-sel" value="" @change="setTeam(p, ($event.target as HTMLSelectElement).value)">
          <option value="">выбрать…</option>
          <option v-for="t in s.teams" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
        <button class="btn small flat icon" title="Удалить игрока" @click="removePlayer(p)"><Icon name="x" size="0.85em" /></button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.roster {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.roster-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.empty {
  font-size: 0.9rem;
  margin: 4px 0;
}
.comp {
  border-radius: 12px;
  background: var(--panel-2);
  border: 2px solid transparent;
  border-left: 6px solid var(--c);
  padding: 8px 8px 6px 10px;
  transition:
    background 0.2s,
    border-color 0.2s;
}
.comp.active {
  border-color: var(--c);
  background: color-mix(in srgb, var(--c) 30%, var(--panel-2));
}
.comp.chooser {
  box-shadow: inset 0 0 0 1px rgba(255, 200, 61, 0.5);
}
.comp.locked {
  opacity: 0.6;
}
.comp-main {
  display: flex;
  align-items: center;
  gap: 8px;
}
.comp-main.flash {
  animation: flash 0.7s ease;
}
.swatch {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.4);
  background: var(--c);
  cursor: pointer;
  flex: none;
  padding: 0;
}
.name-wrap {
  min-width: 0;
}
.name {
  font-weight: 700;
  cursor: text;
}
.tag-ch {
  color: var(--accent);
  font-size: 0.8em;
}
.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.78rem;
  flex-wrap: wrap;
}
.conn {
  color: var(--ok);
}
.conn.mid {
  color: var(--warn);
}
.conn.bad,
.conn.off {
  color: var(--bad);
}
.bad-tag {
  color: #ff9a9a;
  font-weight: 700;
}
.score-wrap {
  display: flex;
  align-items: center;
  gap: 2px;
}
.score {
  min-width: 3.5em;
  text-align: right;
  font-size: 1.25rem;
  font-weight: 800;
  color: var(--accent);
  cursor: text;
}
.score.neg {
  color: var(--bad);
}
.score-input {
  width: 5.5em;
}
.pm {
  display: flex;
  flex-direction: column;
}
.pm .btn {
  padding: 0.1em 0.35em;
}
.palette {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 0 4px 24px;
}
.swatch-pick {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.3);
  cursor: pointer;
  padding: 0;
}
.actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 2px;
}
.link {
  background: none;
  border: none;
  color: var(--muted);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0;
  text-decoration: underline dotted;
}
.link:hover {
  color: var(--text);
}
.link.danger:hover {
  color: var(--bad);
}
.members,
.unassigned {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
}
.member {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.88rem;
  padding: 3px 4px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.15);
}
.member.flash {
  animation: flash 0.7s ease;
}
.conn-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ok);
  flex: none;
}
.conn-dot.mid {
  background: var(--warn);
}
.conn-dot.bad,
.conn-dot.off {
  background: var(--bad);
}
.team-sel {
  width: auto;
  max-width: 110px;
}
.small {
  font-size: 0.75rem;
}
.unassigned {
  padding: 8px;
  border-radius: 12px;
  border: 1px dashed var(--line-2);
}
</style>
