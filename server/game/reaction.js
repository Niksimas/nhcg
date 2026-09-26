// Тест реакции: по сигналу жмут все — записывается время каждого нажатия (каждого игрока, а не первой команды).
//
// Ведущий запускает попытку. Сигнал «Жми!» загорается у всех телефонов одновременно — через случайное время
// (1,5–4 с), чтобы момент нельзя было угадать. Скорость — от момента, когда кнопка загорелась на телефоне игрока,
// до нажатия. Нажатие до сигнала — фальстарт этой попытки. Попытка заканчивается,
// когда нажали все, кто был на связи, или через несколько секунд после сигнала. По всем попыткам считается
// лучшая и средняя реакция каждого игрока.

import { GameError } from './util.js'
import { greenTime, syncStartDelay } from './buzzer.js'

const STAGES = ['idle', 'run', 'done']
const ATTEMPTS_LIMIT = 100
const DELAY_MIN = 1500
const DELAY_MAX = 4000

export class ReactionMode {
  constructor(game) {
    this.game = game
    this.random = Math.random
    this.commands = {
      'r.start': () => this.startAttempt(),
      'r.stop': () => this.stopAttempt(),
      'r.reset': () => this.resetResults(),
    }
  }

  static initialState() {
    return {
      stage: 'idle', // idle | run (попытка идёт) | done (попытка закончена)
      no: 0, // номер последней попытки
      signalAt: null, // момент сигнала (серверное время)
      expected: [], // кто был на связи в начале попытки — от них ждём нажатий
      presses: [], // нажатия текущей попытки: { playerId, t, arrival, reaction, early }
      attempts: [], // законченные попытки: { no, results: [{ playerId, reaction, early }] }
    }
  }

  get s() {
    return this.game.state.reaction
  }

  get settings() {
    return this.game.settings
  }

  reset() {
    this.game.state.reaction = ReactionMode.initialState()
  }

  sanitize() {
    const s = this.s
    if (!STAGES.includes(s.stage)) s.stage = 'idle'
    if (!Number.isInteger(s.no) || s.no < 0) s.no = 0
    s.expected = Array.isArray(s.expected) ? s.expected.filter((x) => typeof x === 'string') : []
    s.presses = []
    s.attempts = Array.isArray(s.attempts)
      ? s.attempts
          .filter((a) => a && Array.isArray(a.results))
          .map((a) => ({
            no: Number.isInteger(a.no) ? a.no : 0,
            results: a.results
              .filter((r) => r && typeof r.playerId === 'string')
              .map((r) => ({ playerId: r.playerId, reaction: Number.isFinite(r.reaction) ? r.reaction : null, early: r.early === true })),
          }))
          .slice(-ATTEMPTS_LIMIT)
      : []
    // Попытка, прерванная перезапуском сервера, не считается.
    if (s.stage === 'run') s.stage = s.attempts.length ? 'done' : 'idle'
    s.signalAt = null
  }

  canStart() {
    return null
  }

  start() {
    const s = this.s
    this.game.stopTimers()
    this.game.setBuzzer('off')
    if (s.stage === 'run') {
      s.stage = s.attempts.length ? 'done' : 'idle'
      s.presses = []
      s.signalAt = null
    }
  }

  earlyPolicy() {
    return 'ignore'
  }

  onBuzzWinner() {}

  // ───────────── попытки ─────────────

  startAttempt() {
    const s = this.s
    if (s.stage === 'run') throw new GameError('Попытка уже идёт')
    const expected = this.game.state.players.filter((p) => this.game.isConnected(p.id)).map((p) => p.id)
    if (!expected.length) throw new GameError('Никто из игроков не на связи')
    const now = this.game.now()
    // Сигнал — чуть позже, чтобы команда успела дойти до всех телефонов и «Жми!» загорелось у всех одновременно.
    const rtts = expected.map((id) => this.game.pingOf(id))
    const delay = Math.max(
      syncStartDelay(rtts),
      this.settings.rRandom ? DELAY_MIN + Math.round(this.random() * (DELAY_MAX - DELAY_MIN)) : 0,
    )
    s.no += 1
    s.stage = 'run'
    s.signalAt = now + delay
    s.expected = expected
    s.presses = []
    this.game.stopTimers()
    // Кнопки «открыты» с момента сигнала: до него телефоны показывают «Внимание…».
    this.game.setBuzzer('armed')
    this.game.state.buzzer.armedAt = s.signalAt
    this.game.startTimer('reaction', this.settings.rTimeout, s.signalAt)
    this.game.log(`Тест реакции: попытка ${s.no}`)
    // Звук — сразу, а не в момент сигнала: сигнал для всех — надпись «Жми!» на своём телефоне.
    this.game.emitEvent('reactionStart', { no: s.no, signalAt: s.signalAt })
    return true
  }

  // Нажатие игрока: t — честный момент нажатия, go — когда кнопка загорелась зелёным на его телефоне
  // (оба в серверном времени). Скорость считается от момента, когда загорелась кнопка, а не от команды ведущего.
  press(playerId, t, arrival, go = null) {
    const s = this.s
    if (s.stage !== 'run') return { result: 'off' }
    if (s.presses.some((p) => p.playerId === playerId)) return { result: 'dup' }
    const start = greenTime({ go, openedAt: s.signalAt, rtt: this.game.pingOf(playerId) }, this.game.fairness())
    const early = t < start
    const reaction = early ? null : Math.round(t - start)
    s.presses.push({ playerId, t, arrival, reaction, early })
    if (early) this.game.emitEvent('reactionEarly', { playerId })
    const pending = s.expected.filter((id) => this.game.isConnected(id) && !s.presses.some((p) => p.playerId === id))
    if (!pending.length) this.finishAttempt()
    this.game.changed()
    return early ? { result: 'falseStart' } : { result: 'pressed', reaction }
  }

  finishAttempt() {
    const s = this.s
    const results = [...s.presses]
      .sort((a, b) => Number(a.early) - Number(b.early) || (a.reaction ?? 0) - (b.reaction ?? 0) || a.arrival - b.arrival)
      .map((p) => ({ playerId: p.playerId, reaction: p.reaction, early: p.early }))
    for (const id of s.expected) {
      if (!results.some((r) => r.playerId === id)) results.push({ playerId: id, reaction: null, early: false })
    }
    s.attempts.push({ no: s.no, results })
    if (s.attempts.length > ATTEMPTS_LIMIT) s.attempts.splice(0, s.attempts.length - ATTEMPTS_LIMIT)
    s.stage = 'done'
    s.presses = []
    s.signalAt = null
    this.game.stopTimers()
    this.game.setBuzzer('off')
    const best = results.find((r) => r.reaction != null)
    this.game.log(
      `Попытка ${s.no}: ${best ? `быстрее всех ${this.playerName(best.playerId)} — ${best.reaction} мс` : 'никто не нажал вовремя'}`,
    )
    this.game.emitEvent('reactionDone', { no: s.no })
  }

  stopAttempt() {
    if (this.s.stage !== 'run') throw new GameError('Попытка не идёт')
    this.finishAttempt()
    return true
  }

  // Сброс не отменяется (Ctrl+Z результаты теста не трогает) — ведущий подтверждает его заранее.
  resetResults() {
    if (this.s.stage === 'run') throw new GameError('Сначала закончите попытку')
    this.reset()
    this.game.log('Результаты теста реакции сброшены')
    return true
  }

  onTimerExpired(name) {
    if (name === 'reaction' && this.s.stage === 'run') this.finishAttempt()
  }

  playerName(id) {
    return this.game.player(id)?.name ?? '—'
  }

  // ───────────── итоги ─────────────

  // По всем попыткам: лучшее и среднее время, сколько раз нажал вовремя, фальстарты и пропуски.
  stats() {
    const rows = new Map(
      this.game.state.players.map((p) => [
        p.id,
        { playerId: p.id, tries: 0, best: null, avg: null, last: null, falseStarts: 0, misses: 0, sum: 0 },
      ]),
    )
    const s = this.s
    s.attempts.forEach((a, i) => {
      const lastAttempt = i === s.attempts.length - 1
      for (const r of a.results) {
        const row = rows.get(r.playerId)
        if (!row) continue
        if (r.reaction != null) {
          row.tries += 1
          row.sum += r.reaction
          row.best = row.best == null ? r.reaction : Math.min(row.best, r.reaction)
        } else if (r.early) row.falseStarts += 1
        else row.misses += 1
        if (lastAttempt) row.last = r.reaction
      }
    })
    return [...rows.values()]
      .map(({ sum, ...row }) => ({ ...row, avg: row.tries ? Math.round(sum / row.tries) : null }))
      .sort((a, b) => (a.avg ?? Infinity) - (b.avg ?? Infinity) || (a.best ?? Infinity) - (b.best ?? Infinity))
  }

  // Нажатия текущей попытки (пока она идёт) или итоги последней.
  current() {
    const s = this.s
    if (s.stage === 'run') {
      return [...s.presses]
        .sort((a, b) => Number(a.early) - Number(b.early) || (a.reaction ?? 0) - (b.reaction ?? 0))
        .map((p) => ({ playerId: p.playerId, reaction: p.reaction, early: p.early }))
    }
    const last = s.attempts[s.attempts.length - 1]
    return last && s.stage === 'done' ? last.results : []
  }

  view() {
    const s = this.s
    return {
      stage: s.stage,
      no: s.no,
      signalAt: s.stage === 'run' ? s.signalAt : null,
      expected: s.stage === 'run' ? s.expected : [],
      current: this.current(),
      stats: this.stats(),
      attempts: s.attempts.length,
    }
  }

  meView(playerId) {
    const s = this.s
    const list = this.current()
    const mine = list.find((r) => r.playerId === playerId) ?? null
    const valid = list.filter((r) => r.reaction != null)
    const stat = this.stats().find((r) => r.playerId === playerId)
    return {
      pressed: !!mine && (mine.reaction != null || mine.early),
      early: !!mine?.early,
      reaction: mine?.reaction ?? null,
      place: mine?.reaction != null ? valid.findIndex((r) => r.playerId === playerId) + 1 : null,
      of: valid.length,
      best: stat?.best ?? null,
      avg: stat?.avg ?? null,
      tries: stat?.tries ?? 0,
      running: s.stage === 'run',
    }
  }
}
