// Ядро игры: игроки/команды, счёт, «честная кнопка», таймеры, отмена действий, автосохранение.
// Логика конкретных режимов вынесена в jeopardy.js («Своя игра») и brainring.js («Брейн-ринг»).
// Сервер — единственный источник правды: клиенты только показывают присланное состояние.

import { EventEmitter } from 'node:events'
import { performance } from 'node:perf_hooks'
import { defaultSettings, sanitizeSettings, mergeSettings } from './settings.js'
import { effectivePressTime, collectWindow, rankPresses, median, FAIRNESS, FAIRNESS_ONLINE, syncStartDelay } from './buzzer.js'
import { GameError, newId, cleanName, isObj, finite } from './util.js'
import { JeopardyMode } from './jeopardy.js'
import { BrainRingMode } from './brainring.js'
import { buildViews } from './views.js'

export { GameError, newId, cleanName }

export const PALETTE = [
  '#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00',
  '#00acc1', '#d81b60', '#7cb342', '#5c6bc0', '#8d6e63', '#26a69a',
]

const MAX_PLAYERS = 100
const MAX_TEAMS = 50
const UNDO_LIMIT = 60
const LOG_LIMIT = 60

export function freshBuzzer(status = 'off') {
  return { status, armedAt: null, presses: [], winner: null, lockedOut: [], falseStarts: [] }
}

export class Game extends EventEmitter {
  constructor(opts = {}) {
    super()
    this.now = opts.clock ?? (() => performance.now())
    this.timerApi = opts.timers ?? { setTimeout, clearTimeout }
    this.packStore = opts.packStore ?? null
    this.persist = opts.persist ?? null
    this.saveDelay = opts.saveDelay ?? 400
    this.pack = null
    this.state = Game.initialState()
    this.modes = { jeopardy: new JeopardyMode(this), brainring: new BrainRingMode(this) }
    this.undoStack = []
    this.presence = new Map() // playerId -> { conns, pings: number[], ping }
    this.earlyLocks = new Map() // competitorId -> момент (серверное время), до которого кнопка заблокирована
    this.timerHandles = new Map()
    this.collectHandle = null
    this.saveHandle = null
  }

  static initialState() {
    return {
      v: 1,
      stage: 'lobby',
      mode: 'jeopardy',
      settings: defaultSettings(),
      players: [],
      teams: [],
      scores: {},
      packId: null,
      buzzer: freshBuzzer('test'),
      timers: {},
      jeopardy: JeopardyMode.initialState(),
      brainring: BrainRingMode.initialState(),
      log: [],
    }
  }

  get mode() {
    return this.modes[this.state.mode]
  }

  get settings() {
    return this.state.settings
  }

  // ───────────────────────────── служебное ─────────────────────────────

  changed() {
    this.syncTimers()
    this.emit('change')
    this.scheduleSave()
  }

  emitEvent(name, data = {}) {
    this.emit('event', { name, data })
  }

  log(text) {
    this.state.log.push({ at: Date.now(), text })
    if (this.state.log.length > LOG_LIMIT) this.state.log.splice(0, this.state.log.length - LOG_LIMIT)
  }

  scheduleSave() {
    if (!this.persist) return
    if (this.saveHandle) clearTimeout(this.saveHandle)
    this.saveHandle = setTimeout(() => {
      this.saveHandle = null
      this.saveNow()
    }, this.saveDelay)
    this.saveHandle.unref?.()
  }

  saveNow() {
    if (!this.persist) return
    try {
      this.persist.save(this.serialize())
    } catch (err) {
      console.error('Не удалось сохранить состояние игры:', err.message)
    }
  }

  // ───────────────────────────── игроки и команды ─────────────────────────────

  player(id) {
    return this.state.players.find((p) => p.id === id) ?? null
  }

  playerByToken(token) {
    if (typeof token !== 'string' || !token) return null
    return this.state.players.find((p) => p.token === token) ?? null
  }

  team(id) {
    return this.state.teams.find((t) => t.id === id) ?? null
  }

  presenceOf(playerId) {
    let pr = this.presence.get(playerId)
    if (!pr) {
      pr = { conns: 0, pings: [], ping: null }
      this.presence.set(playerId, pr)
    }
    return pr
  }

  isConnected(playerId) {
    return (this.presence.get(playerId)?.conns ?? 0) > 0
  }

  pingOf(playerId) {
    return this.presence.get(playerId)?.ping ?? null
  }

  attach(playerId) {
    const pr = this.presenceOf(playerId)
    pr.conns += 1
    if (pr.conns === 1) {
      this.emitEvent('presence', { playerId, connected: true })
      this.changed()
    }
  }

  detach(playerId) {
    const pr = this.presenceOf(playerId)
    pr.conns = Math.max(0, pr.conns - 1)
    if (pr.conns === 0) {
      pr.pings = []
      pr.ping = null
      this.emitEvent('presence', { playerId, connected: false })
      this.changed()
    }
  }

  updatePing(playerId, rtt) {
    if (!finite(rtt)) return
    const pr = this.presenceOf(playerId)
    pr.pings.push(rtt)
    if (pr.pings.length > 5) pr.pings.shift()
    pr.ping = median(pr.pings)
  }

  // Соревнующиеся стороны: команды в командном режиме, иначе — отдельные игроки.
  competitors() {
    const s = this.state
    if (s.settings.teamMode) {
      return s.teams.map((t) => {
        const members = s.players.filter((p) => p.teamId === t.id)
        return {
          id: t.id,
          kind: 'team',
          name: t.name,
          color: t.color,
          members: members.map((m) => m.id),
          connected: members.some((m) => this.isConnected(m.id)),
          canBuzz: members.length > 0,
        }
      })
    }
    return s.players.map((p) => ({
      id: p.id,
      kind: 'player',
      name: p.name,
      color: p.color,
      members: [p.id],
      connected: this.isConnected(p.id),
      canBuzz: true,
    }))
  }

  competitor(id) {
    return this.competitors().find((c) => c.id === id) ?? null
  }

  competitorOf(playerId) {
    const p = this.player(playerId)
    if (!p) return null
    if (!this.settings.teamMode) return p.id
    return p.teamId && this.team(p.teamId) ? p.teamId : null
  }

  competitorName(id) {
    return this.competitor(id)?.name ?? '—'
  }

  score(cid) {
    return this.state.scores[cid] ?? 0
  }

  addScore(cid, delta) {
    if (!cid || !finite(delta) || delta === 0) return
    this.state.scores[cid] = this.score(cid) + delta
  }

  nextColor(list) {
    const used = new Set(list.map((x) => x.color))
    return PALETTE.find((c) => !used.has(c)) ?? PALETTE[list.length % PALETTE.length]
  }

  resolveTeam({ teamId, newTeamName } = {}) {
    if (teamId) {
      if (!this.team(teamId)) throw new GameError('Команда не найдена')
      return teamId
    }
    const name = cleanName(newTeamName, 32)
    if (!name) return null
    const existing = this.state.teams.find((t) => t.name.toLowerCase() === name.toLowerCase())
    if (existing) return existing.id
    if (!this.settings.allowPlayerTeams) throw new GameError('Создавать команды может только ведущий')
    return this.createTeam(name).id
  }

  createTeam(name) {
    if (this.state.teams.length >= MAX_TEAMS) throw new GameError('Слишком много команд')
    let clean = cleanName(name, 32)
    if (!clean) clean = `Команда ${this.state.teams.length + 1}`
    if (this.state.teams.some((t) => t.name.toLowerCase() === clean.toLowerCase())) {
      throw new GameError('Команда с таким названием уже есть')
    }
    const team = { id: newId(), name: clean, color: this.nextColor(this.state.teams) }
    this.state.teams.push(team)
    this.log(`Создана команда «${clean}»`)
    return team
  }

  // Подключение нового игрока (или возвращение под своим именем с другого устройства).
  join({ name, teamId, newTeamName, takeover } = {}) {
    const clean = cleanName(name)
    if (!clean) throw new GameError('Введите имя')
    const existing = this.state.players.find((p) => p.name.toLowerCase() === clean.toLowerCase())
    if (existing) {
      const online = this.isConnected(existing.id)
      if (takeover && !online) {
        this.log(`${existing.name} вернулся с другого устройства`)
        this.changed()
        return existing
      }
      throw new GameError(online ? 'Это имя уже занято — выберите другое' : 'Игрок с таким именем уже есть', {
        code: 'nameTaken',
        canTakeover: !online,
        existingName: existing.name,
      })
    }
    if (this.settings.joinLocked) throw new GameError('Ведущий закрыл вход в игру для новых игроков')
    if (this.state.players.length >= MAX_PLAYERS) throw new GameError('Слишком много игроков')
    const resolvedTeam = this.resolveTeam({ teamId, newTeamName })
    const player = {
      id: newId(),
      token: newId(18),
      name: clean,
      teamId: resolvedTeam,
      color: this.nextColor(this.state.players),
      joinedAt: Date.now(),
    }
    this.state.players.push(player)
    this.log(`Подключился игрок ${clean}${resolvedTeam ? ` (${this.team(resolvedTeam).name})` : ''}`)
    this.emitEvent('join', { playerId: player.id })
    this.changed()
    return player
  }

  renamePlayer(playerId, name) {
    const p = this.player(playerId)
    if (!p) throw new GameError('Игрок не найден')
    const clean = cleanName(name)
    if (!clean) throw new GameError('Введите имя')
    if (this.state.players.some((x) => x !== p && x.name.toLowerCase() === clean.toLowerCase())) {
      throw new GameError('Это имя уже занято')
    }
    p.name = clean
    this.changed()
  }

  setPlayerTeam(playerId, opts) {
    const p = this.player(playerId)
    if (!p) throw new GameError('Игрок не найден')
    p.teamId = opts?.teamId === null && !opts?.newTeamName ? null : this.resolveTeam(opts)
    this.changed()
  }

  removePlayer(playerId, logText = null) {
    const p = this.player(playerId)
    if (!p) throw new GameError('Игрок не найден')
    this.state.players = this.state.players.filter((x) => x !== p)
    delete this.state.scores[p.id]
    this.presence.delete(p.id)
    this.log(logText ?? `Игрок ${p.name} удалён`)
    this.emit('kick', p.id)
    this.changed()
  }

  removeTeam(teamId) {
    const t = this.team(teamId)
    if (!t) throw new GameError('Команда не найдена')
    this.state.teams = this.state.teams.filter((x) => x !== t)
    for (const p of this.state.players) if (p.teamId === t.id) p.teamId = null
    delete this.state.scores[t.id]
    this.log(`Команда «${t.name}» удалена`)
    this.changed()
  }

  // ───────────────────────────── кнопка ─────────────────────────────

  setBuzzer(status) {
    this.clearCollect()
    this.state.buzzer = freshBuzzer(status)
    this.earlyLocks.clear()
  }

  // Новый вопрос: кнопки «закрыты» (раннее нажатие = фальстарт/блокировка), штрафы сброшены.
  openBuzzer() {
    this.setBuzzer('closed')
  }

  // Открыть кнопки. При игре по интернету — не сразу, а в момент, до которого сигнал успеет дойти
  // до всех устройств: тогда «Жми!» загорается у всех одновременно. Возвращает момент открытия.
  armBuzzer() {
    this.clearCollect()
    const b = this.state.buzzer
    b.status = 'armed'
    b.armedAt = this.now() + (this.settings.onlineMode ? syncStartDelay(this.connectedRtts()) : 0)
    b.presses = []
    b.winner = null
    return b.armedAt
  }

  fairness() {
    return this.settings.onlineMode ? FAIRNESS_ONLINE : FAIRNESS
  }

  connectedRtts() {
    const rtts = []
    for (const c of this.eligibleCompetitors()) {
      for (const pid of c.members) if (this.isConnected(pid)) rtts.push(this.pingOf(pid))
    }
    return rtts
  }

  lockOut(cid) {
    const b = this.state.buzzer
    if (cid && !b.lockedOut.includes(cid)) b.lockedOut.push(cid)
  }

  unlock(cid) {
    const b = this.state.buzzer
    b.lockedOut = b.lockedOut.filter((x) => x !== cid)
    b.falseStarts = b.falseStarts.filter((x) => x !== cid)
    this.earlyLocks.delete(cid)
  }

  eligibleCompetitors() {
    const b = this.state.buzzer
    return this.competitors().filter((c) => c.canBuzz && !b.lockedOut.includes(c.id))
  }

  clearCollect() {
    if (this.collectHandle) {
      this.timerApi.clearTimeout(this.collectHandle)
      this.collectHandle = null
    }
  }

  collectWindowMs() {
    return collectWindow(this.connectedRtts(), this.fairness())
  }

  // Нажатие кнопки игроком. claimed — момент нажатия в серверном времени по часам клиента.
  buzz(playerId, claimed, arrival = this.now()) {
    const player = this.player(playerId)
    if (!player) return { result: 'unknown' }
    const cid = this.competitorOf(playerId)
    if (!cid) return { result: 'noTeam' }
    const b = this.state.buzzer
    const t = effectivePressTime({ claimed, arrival, rtt: this.pingOf(playerId) }, this.fairness())

    if (b.status === 'test') {
      this.emitEvent('test', { playerId, competitorId: cid })
      return { result: 'test' }
    }
    if (b.status === 'off') return { result: 'off' }
    if (b.lockedOut.includes(cid)) return { result: 'locked' }

    if (b.status === 'answering') {
      // Опоздавшие нажатия запоминаем только для таблицы «кто за кем».
      if (finite(b.armedAt) && t >= b.armedAt && !b.presses.some((p) => p.competitorId === cid)) {
        b.presses.push({ playerId, competitorId: cid, t, arrival, late: true })
        this.changed()
      }
      return { result: 'late' }
    }

    if (b.status === 'closed' || t < b.armedAt) return this.earlyPress(cid, playerId, t)

    const lock = this.earlyLocks.get(cid)
    if (lock && t < lock) return { result: 'early', until: lock }
    if (b.presses.some((p) => p.competitorId === cid)) return { result: 'dup' }

    b.presses.push({ playerId, competitorId: cid, t, arrival, late: false })
    if (b.status === 'armed') {
      b.status = 'collecting'
      this.collectHandle = this.timerApi.setTimeout(() => this.resolveBuzz(), this.collectWindowMs())
    }
    this.changed()
    return { result: 'pressed' }
  }

  earlyPress(cid, playerId, t) {
    const policy = this.mode.earlyPolicy()
    const b = this.state.buzzer
    if (policy === 'falseStart') {
      if (!b.falseStarts.includes(cid)) {
        b.falseStarts.push(cid)
        this.lockOut(cid)
        this.log(`Фальстарт: ${this.competitorName(cid)}`)
        this.emitEvent('falseStart', { competitorId: cid, playerId })
        this.mode.onFalseStart?.(cid)
        this.changed()
      }
      return { result: 'falseStart' }
    }
    if (policy === 'lock') {
      const until = t + this.settings.jEarlyLockMs
      this.earlyLocks.set(cid, Math.max(this.earlyLocks.get(cid) ?? 0, until))
      this.changed()
      return { result: 'early', until: this.earlyLocks.get(cid) }
    }
    return { result: 'ignored' }
  }

  // Окно сбора нажатий закрылось — определяем, кто был первым.
  resolveBuzz() {
    this.clearCollect()
    const b = this.state.buzzer
    if (b.status !== 'collecting') return
    const valid = rankPresses(b.presses.filter((p) => !p.late && !b.lockedOut.includes(p.competitorId)))
    if (!valid.length) {
      b.status = 'armed'
      this.changed()
      return
    }
    const w = valid[0]
    b.status = 'answering'
    b.winner = { playerId: w.playerId, competitorId: w.competitorId, t: w.t, reaction: w.t - b.armedAt }
    const player = this.player(w.playerId)
    this.log(
      `Первым нажал: ${this.competitorName(w.competitorId)}` +
        (this.settings.teamMode && player ? ` (${player.name})` : '') +
        ` — реакция ${Math.round(b.winner.reaction)} мс`,
    )
    this.emitEvent('buzzWinner', { competitorId: w.competitorId, playerId: w.playerId })
    this.mode.onBuzzWinner(w.competitorId, w.playerId)
    this.changed()
  }

  // ───────────────────────────── таймеры ─────────────────────────────

  // startAt — серверное время старта (по умолчанию сейчас; позже — при синхронном старте онлайн).
  startTimer(name, seconds, startAt = this.now()) {
    const ms = Math.round((seconds ?? 0) * 1000)
    if (!(ms > 0)) {
      delete this.state.timers[name]
      return
    }
    this.state.timers[name] = { total: ms, running: true, endsAt: Math.max(startAt, this.now()) + ms, remaining: ms }
  }

  timerRemaining(name) {
    const t = this.state.timers[name]
    if (!t) return 0
    return t.running ? Math.min(t.total, Math.max(0, t.endsAt - this.now())) : t.remaining
  }

  pauseTimer(name) {
    const t = this.state.timers[name]
    if (!t || !t.running) return
    t.remaining = Math.max(0, t.endsAt - this.now())
    t.running = false
    t.endsAt = null
  }

  resumeTimer(name, remainingMs, startAt = this.now()) {
    const t = this.state.timers[name]
    if (!t) return
    if (finite(remainingMs)) t.remaining = Math.max(0, remainingMs)
    if (t.remaining > t.total) t.total = t.remaining
    if (t.remaining <= 0) return
    t.running = true
    t.endsAt = Math.max(startAt, this.now()) + t.remaining
  }

  addTime(name, seconds) {
    const t = this.state.timers[name]
    if (!t) return
    const delta = Math.round(seconds * 1000)
    if (t.running) {
      t.endsAt = Math.max(this.now(), t.endsAt + delta)
      t.remaining = t.endsAt - this.now()
    } else {
      t.remaining = Math.max(0, t.remaining + delta)
    }
    if (t.remaining > t.total) t.total = t.remaining
  }

  stopTimer(name) {
    delete this.state.timers[name]
  }

  stopTimers() {
    this.state.timers = {}
  }

  // Приводит реальные setTimeout в соответствие с таймерами в состоянии.
  syncTimers() {
    for (const [name, h] of this.timerHandles) {
      const t = this.state.timers[name]
      if (!t || !t.running || t.endsAt !== h.endsAt) {
        this.timerApi.clearTimeout(h.handle)
        this.timerHandles.delete(name)
      }
    }
    for (const [name, t] of Object.entries(this.state.timers)) {
      if (!t.running || this.timerHandles.has(name)) continue
      const endsAt = t.endsAt
      const handle = this.timerApi.setTimeout(() => this.onTimer(name, endsAt), Math.max(0, endsAt - this.now()))
      this.timerHandles.set(name, { handle, endsAt })
    }
  }

  onTimer(name, endsAt) {
    this.timerHandles.delete(name)
    const t = this.state.timers[name]
    if (!t || !t.running || t.endsAt !== endsAt) return
    // Если время вышло, пока собираются нажатия — сначала определяем победителя.
    if (this.state.buzzer.status === 'collecting') {
      this.resolveBuzz()
      if (this.state.timers[name] !== t || !t.running) return
    }
    t.running = false
    t.remaining = 0
    t.endsAt = null
    this.mode.onTimerExpired(name)
    this.changed()
  }

  frozenTimers() {
    const out = {}
    for (const [name, t] of Object.entries(this.state.timers)) {
      out[name] = { total: t.total, running: t.running, remaining: this.timerRemaining(name), endsAt: null }
    }
    return out
  }

  // ───────────────────────────── отмена действий ─────────────────────────────

  pushUndo(label) {
    const s = this.state
    const snap = structuredClone({
      stage: s.stage,
      mode: s.mode,
      scores: s.scores,
      competitorIds: this.competitors().map((c) => c.id),
      buzzer: s.buzzer,
      timers: this.frozenTimers(),
      jeopardy: s.jeopardy,
      brainring: s.brainring,
    })
    this.undoStack.push({ label, snap })
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift()
  }

  undo() {
    const item = this.undoStack.pop()
    if (!item) throw new GameError('Нечего отменять')
    this.clearCollect()
    this.earlyLocks.clear()
    const { snap } = item
    const s = this.state
    s.stage = snap.stage
    s.mode = snap.mode
    // Счёт восстанавливаем из снимка, но очки тех, кто появился уже после снимка, не трогаем.
    const scores = { ...snap.scores }
    for (const [key, value] of Object.entries(s.scores)) {
      if (!snap.competitorIds.includes(key)) scores[key] = value
    }
    s.scores = scores
    s.buzzer = snap.buzzer
    if (s.buzzer.status === 'collecting' || s.buzzer.status === 'armed') {
      s.buzzer.status = 'armed'
      s.buzzer.armedAt = this.now()
      s.buzzer.presses = []
    }
    s.timers = {}
    for (const [name, t] of Object.entries(snap.timers)) {
      s.timers[name] = { ...t }
      if (t.running && t.remaining > 0) s.timers[name].endsAt = this.now() + t.remaining
      else s.timers[name].running = false
    }
    s.jeopardy = snap.jeopardy
    s.brainring = snap.brainring
    this.log(`Отменено: ${item.label}`)
    this.emitEvent('undo', { label: item.label })
    this.changed()
  }

  // ───────────────────────────── пакеты ─────────────────────────────

  async loadPack(packId) {
    if (!this.packStore) throw new GameError('Хранилище пакетов недоступно')
    const pack = await this.packStore.loadForGame(packId)
    this.pack = pack
    this.state.packId = pack.id
    this.undoStack = []
    this.modes.jeopardy.reset()
    this.modes.brainring.reset()
    if (this.state.stage === 'game') this.mode.start()
    this.log(`Загружен пакет «${pack.title}»`)
    this.changed()
    return pack
  }

  // Перечитать текущий пакет после правки в редакторе. Если структура (раунды/темы/число вопросов)
  // не изменилась — прогресс игры сохраняется, иначе пакет загружается заново.
  async refreshPack() {
    if (!this.state.packId || !this.packStore) return
    const pack = await this.packStore.loadForGame(this.state.packId)
    const shape = (p) => p.rounds.map((r) => `${r.type}:${r.themes.map((t) => t.questions.length).join(',')}`).join('|')
    if (this.pack && shape(this.pack) === shape(pack)) {
      this.pack = pack
      this.changed()
    } else {
      await this.loadPack(this.state.packId)
    }
  }

  unloadPack() {
    this.pack = null
    this.state.packId = null
    this.undoStack = []
    this.modes.jeopardy.reset()
    this.modes.brainring.reset()
    if (this.state.stage === 'game') {
      this.state.stage = 'lobby'
      this.setBuzzer('test')
      this.stopTimers()
    }
    this.changed()
  }

  // ───────────────────────────── ход игры ─────────────────────────────

  startGame() {
    const problem = this.mode.canStart()
    if (problem) throw new GameError(problem)
    this.pushUndo('Начало игры')
    this.state.stage = 'game'
    this.mode.start()
    this.log(`Игра началась: ${this.state.mode === 'jeopardy' ? '«Своя игра»' : '«Брейн-ринг»'}`)
    this.emitEvent('gameStart')
  }

  toLobby() {
    this.pushUndo('Возврат в лобби')
    this.state.stage = 'lobby'
    this.stopTimers()
    this.setBuzzer('test')
  }

  setMode(mode) {
    if (!this.modes[mode]) throw new GameError('Неизвестный режим')
    if (mode === this.state.mode) return
    this.pushUndo('Смена режима')
    this.stopTimers()
    this.state.mode = mode
    if (this.state.stage === 'game' && !this.mode.canStart()) {
      this.mode.start()
    } else {
      this.state.stage = 'lobby'
      this.setBuzzer('test')
    }
  }

  resetGame({ keepPlayers = true } = {}) {
    this.clearCollect()
    this.earlyLocks.clear()
    const s = this.state
    s.stage = 'lobby'
    s.scores = {}
    s.timers = {}
    s.buzzer = freshBuzzer('test')
    s.jeopardy = JeopardyMode.initialState()
    s.brainring = BrainRingMode.initialState()
    if (!keepPlayers) {
      for (const p of s.players) this.emit('kick', p.id)
      s.players = []
      s.teams = []
      this.presence.clear()
    }
    this.undoStack = []
    this.log(keepPlayers ? 'Новая игра (игроки сохранены)' : 'Новая игра')
  }

  updateSettings(patch) {
    const clean = sanitizeSettings(patch)
    const teamModeChanged = 'teamMode' in clean && clean.teamMode !== this.settings.teamMode
    Object.assign(this.state.settings, clean)
    if (teamModeChanged) {
      // Прежние участники кнопки (игроки ↔ команды) больше не существуют.
      this.stopTimers()
      this.setBuzzer(this.state.stage === 'lobby' ? 'test' : 'off')
      this.undoStack = []
      if (this.state.stage === 'game') this.mode.start()
    }
  }

  // ───────────────────────────── команды ─────────────────────────────

  // Команда от ведущего. Возвращает результат (или Promise для асинхронных команд).
  hostCommand(name, args) {
    const a = isObj(args) ? args : {}
    const fn = HOST_COMMANDS[name]
    let result
    if (fn) {
      result = fn(this, a)
    } else {
      const modeName = name.startsWith('j.') ? 'jeopardy' : name.startsWith('br.') ? 'brainring' : null
      const handler = modeName && this.modes[modeName].commands[name]
      if (!handler) throw new GameError(`Неизвестная команда: ${name}`)
      if (this.state.mode !== modeName) throw new GameError('Эта команда относится к другому режиму')
      if (this.state.stage !== 'game') throw new GameError('Сначала начните игру')
      result = handler(a)
    }
    if (result && typeof result.then === 'function') {
      return result.then((r) => {
        this.changed()
        return r
      })
    }
    this.changed()
    return result
  }

  // Действие игрока (кроме нажатия кнопки).
  playerAction(playerId, name, args) {
    const a = isObj(args) ? args : {}
    const p = this.player(playerId)
    if (!p) throw new GameError('Вы не в игре')
    switch (name) {
      case 'rename':
        this.renamePlayer(playerId, a.name)
        return
      case 'setTeam':
        if (!this.settings.teamMode) throw new GameError('Командный режим выключен')
        this.setPlayerTeam(playerId, { teamId: a.teamId, newTeamName: a.newTeamName })
        return
      default: {
        const result = this.mode.playerAction?.(playerId, name, a)
        if (result === undefined) throw new GameError('Неизвестное действие')
        this.changed()
      }
    }
  }

  // ───────────────────────────── представления ─────────────────────────────

  buildViews() {
    return buildViews(this)
  }

  // ───────────────────────────── сохранение ─────────────────────────────

  serialize() {
    const s = this.state
    return {
      ...s,
      buzzer: { ...s.buzzer, presses: [] },
      timers: this.frozenTimers(),
      savedAt: Date.now(),
    }
  }

  // Восстановление после перезапуска сервера. Кнопки закрываются, таймеры ставятся на паузу.
  async restore(saved) {
    if (!isObj(saved) || saved.v !== 1) return false
    try {
      const s = Game.initialState()
      s.stage = saved.stage === 'game' ? 'game' : 'lobby'
      s.mode = this.modes[saved.mode] ? saved.mode : 'jeopardy'
      s.settings = mergeSettings(saved.settings)
      s.players = (Array.isArray(saved.players) ? saved.players : [])
        .filter((p) => isObj(p) && typeof p.id === 'string' && typeof p.token === 'string')
        .map((p) => ({
          id: p.id,
          token: p.token,
          name: cleanName(p.name) || 'Игрок',
          teamId: typeof p.teamId === 'string' ? p.teamId : null,
          color: typeof p.color === 'string' ? p.color : PALETTE[0],
          joinedAt: finite(p.joinedAt) ? p.joinedAt : Date.now(),
        }))
      s.teams = (Array.isArray(saved.teams) ? saved.teams : [])
        .filter((t) => isObj(t) && typeof t.id === 'string')
        .map((t) => ({ id: t.id, name: cleanName(t.name, 32) || 'Команда', color: t.color || PALETTE[0] }))
      for (const p of s.players) if (p.teamId && !s.teams.some((t) => t.id === p.teamId)) p.teamId = null
      if (isObj(saved.scores)) {
        for (const [k, v] of Object.entries(saved.scores)) if (finite(v)) s.scores[k] = v
      }
      s.log = Array.isArray(saved.log) ? saved.log.slice(-LOG_LIMIT) : []
      if (isObj(saved.buzzer)) {
        const b = saved.buzzer
        // Кнопки, которые были открыты или ждали ответа, после перезапуска закрыты: ведущий откроет их снова.
        const valid = ['test', 'off', 'closed'].includes(b.status)
        s.buzzer = {
          ...freshBuzzer(),
          status: valid ? b.status : 'closed',
          lockedOut: Array.isArray(b.lockedOut) ? b.lockedOut.filter((x) => typeof x === 'string') : [],
          falseStarts: Array.isArray(b.falseStarts) ? b.falseStarts.filter((x) => typeof x === 'string') : [],
        }
        if (s.stage === 'lobby') s.buzzer = freshBuzzer('test')
      }
      if (isObj(saved.timers)) {
        for (const [name, t] of Object.entries(saved.timers)) {
          if (isObj(t) && finite(t.total) && finite(t.remaining)) {
            s.timers[name] = { total: t.total, running: false, endsAt: null, remaining: t.remaining }
          }
        }
      }
      if (isObj(saved.jeopardy)) s.jeopardy = { ...s.jeopardy, ...saved.jeopardy }
      if (isObj(saved.brainring)) s.brainring = { ...s.brainring, ...saved.brainring }
      this.state = s
      if (typeof saved.packId === 'string' && this.packStore) {
        try {
          this.pack = await this.packStore.loadForGame(saved.packId)
          s.packId = this.pack.id
        } catch {
          this.pack = null
          s.packId = null
          s.jeopardy = JeopardyMode.initialState()
          s.brainring = BrainRingMode.initialState()
          if (s.stage === 'game' && s.mode === 'jeopardy') s.stage = 'lobby'
        }
      }
      this.modes.jeopardy.sanitize()
      this.modes.brainring.sanitize()
      this.log('Игра восстановлена после перезапуска сервера')
      this.changed()
      return true
    } catch (err) {
      console.error('Сохранённое состояние повреждено, начинаем заново:', err.message)
      this.state = Game.initialState()
      this.pack = null
      return false
    }
  }
}

// ───────────────────────────── общие команды ведущего ─────────────────────────────

const needCompetitor = (game, id) => {
  const c = game.competitor(id)
  if (!c) throw new GameError('Участник не найден')
  return c
}

const HOST_COMMANDS = {
  undo: (g) => g.undo(),
  'settings.update': (g, a) => g.updateSettings(a.patch),
  'mode.set': (g, a) => g.setMode(a.mode),
  'pack.load': (g, a) => g.loadPack(String(a.packId ?? '')),
  'pack.unload': (g) => g.unloadPack(),
  'game.start': (g) => g.startGame(),
  'game.lobby': (g) => g.toLobby(),
  'game.reset': (g, a) => g.resetGame({ keepPlayers: a.keepPlayers !== false }),

  'score.set': (g, a) => {
    const c = needCompetitor(g, a.competitorId)
    const value = Number(a.value)
    if (!finite(value)) throw new GameError('Неверное число')
    g.pushUndo(`Счёт ${c.name}`)
    g.state.scores[c.id] = Math.round(value)
    g.log(`Счёт ${c.name} изменён на ${Math.round(value)}`)
  },
  'score.add': (g, a) => {
    const c = needCompetitor(g, a.competitorId)
    const delta = Number(a.delta)
    if (!finite(delta) || delta === 0) throw new GameError('Неверное число')
    g.pushUndo(`Счёт ${c.name}`)
    g.addScore(c.id, Math.round(delta))
    g.log(`${c.name}: ${delta > 0 ? '+' : ''}${Math.round(delta)} (вручную)`)
  },
  'score.reset': (g) => {
    g.pushUndo('Сброс счёта')
    g.state.scores = {}
    g.log('Счёт обнулён')
  },

  'player.rename': (g, a) => g.renamePlayer(a.playerId, a.name),
  'player.remove': (g, a) => g.removePlayer(a.playerId),
  'player.team': (g, a) => g.setPlayerTeam(a.playerId, { teamId: a.teamId ?? null, newTeamName: a.newTeamName }),
  'team.add': (g, a) => g.createTeam(a.name),
  'team.rename': (g, a) => {
    const t = g.team(a.teamId)
    if (!t) throw new GameError('Команда не найдена')
    const name = cleanName(a.name, 32)
    if (!name) throw new GameError('Введите название')
    if (g.state.teams.some((x) => x !== t && x.name.toLowerCase() === name.toLowerCase())) {
      throw new GameError('Команда с таким названием уже есть')
    }
    t.name = name
  },
  'team.color': (g, a) => {
    const t = g.team(a.teamId)
    if (!t) throw new GameError('Команда не найдена')
    if (typeof a.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(a.color)) throw new GameError('Неверный цвет')
    t.color = a.color
  },
  'player.color': (g, a) => {
    const p = g.player(a.playerId)
    if (!p) throw new GameError('Игрок не найден')
    if (typeof a.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(a.color)) throw new GameError('Неверный цвет')
    p.color = a.color
  },
  'team.remove': (g, a) => g.removeTeam(a.teamId),

  'timer.pause': (g, a) => g.pauseTimer(String(a.name)),
  'timer.resume': (g, a) => g.resumeTimer(String(a.name)),
  'timer.add': (g, a) => {
    const sec = Number(a.seconds)
    if (!finite(sec)) throw new GameError('Неверное число')
    g.addTime(String(a.name), sec)
  },

  'buzzer.unlock': (g, a) => {
    const c = needCompetitor(g, a.competitorId)
    g.pushUndo(`Снятие блокировки ${c.name}`)
    g.unlock(c.id)
    g.log(`Блокировка снята: ${c.name}`)
  },

  media: (g, a) => {
    const action = ['play', 'pause', 'replay'].includes(a.action) ? a.action : 'replay'
    g.emitEvent('media', { action })
  },
  'sound.test': (g) => g.emitEvent('soundTest'),
}
