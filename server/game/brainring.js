// Режим «Брейн-ринг»: турнир из боёв. В бою обычно две команды и 5 вопросов (настраивается).
// Ведущий читает вопрос, по сигналу «Время!» идёт минута, нажатие до сигнала — фальстарт.
// После неверного ответа соперники получают оставшееся время (по умолчанию не меньше 20 секунд).
// Кто взял больше вопросов в бою — побеждает и получает турнирные очки (по умолчанию +1).
// Счёт турнира сквозной: взятые во всех боях вопросы (по N очков за вопрос) плюс очки за победы
// (или только очки за победы). У команды одна кнопка — телефон капитана или игрока, которому её отдал ведущий.
// Вопросы ведущий читает с листа, программа ведёт кнопки, таймер, счёт боя и таблицу турнира.

import { GameError } from './util.js'

const OPEN_STAGES = ['reading', 'armed', 'answering']
const STAGES = ['idle', 'reading', 'armed', 'answering', 'reveal', 'battleEnd', 'finished']

export class BrainRingMode {
  constructor(game) {
    this.game = game
    this.commands = {
      'br.next': () => this.goto(this.s.qIndex + 1),
      'br.start': () => this.startTime(),
      'br.judge': (a) => this.judge(a.correct === true),
      'br.cancel': () => this.cancel(),
      'br.burn': () => this.burnCommand(),
      'br.value': (a) => this.setValue(a.value),
      'br.battle': (a) => this.battleCommand(a.teams),
      'br.extra': () => this.extraQuestion(),
      'br.draw': () => this.declareDraw(),
      'br.endBattle': () => this.endBattleCommand(),
      'br.finish': () => this.finish(),
      'br.continue': () => this.continueGame(),
    }
  }

  static initialState() {
    return {
      stage: 'idle', // idle | reading | armed | answering | reveal | battleEnd | finished
      qIndex: -1, // номер вопроса в турнире (с нуля)
      value: 1,
      carry: 0,
      armCount: 0,
      answeredBy: null,
      winnerId: null, // победитель турнира (на стадии finished)
      history: [], // сыгранные вопросы: { index, result, competitorId, value, battle }
      battle: null, // текущий бой: { no, teams, scores, played, extra, tie }
      battles: [], // завершённые бои: { no, teams, scores, winnerId, played }
    }
  }

  get s() {
    return this.game.state.brainring
  }

  get settings() {
    return this.game.settings
  }

  reset() {
    this.game.state.brainring = BrainRingMode.initialState()
  }

  sanitize() {
    const s = this.s
    if (!Number.isInteger(s.qIndex) || s.qIndex < -1) s.qIndex = -1
    delete s.showQuestion
    if (!Array.isArray(s.history)) s.history = []
    if (s.stage === 'armed' || s.stage === 'answering') s.stage = 'reading'
    if (!STAGES.includes(s.stage)) s.stage = 'idle'
    if (!Number.isInteger(s.armCount)) s.armCount = 0
    s.battles = Array.isArray(s.battles) ? s.battles.map(cleanBattle).filter(Boolean) : []
    s.battle = s.battle ? cleanBattle(s.battle) : null
    if (s.battle) {
      s.battle.extra = Number.isInteger(s.battle.extra) ? s.battle.extra : 0
      s.battle.tie = s.battle.tie === true
    }
  }

  canStart() {
    return null
  }

  start() {
    const s = this.s
    this.game.stopTimers()
    if (OPEN_STAGES.includes(s.stage)) {
      s.stage = 'reading'
      s.armCount = 0
      this.game.openBuzzer()
    } else {
      this.game.setBuzzer('off')
    }
  }

  earlyPolicy() {
    const s = this.s
    if (s.stage === 'reading' || (s.stage === 'armed' && s.armCount <= 1)) return 'falseStart'
    return 'ignore'
  }

  // ───────────── бои ─────────────

  // Кто может нажимать кнопку: только команды текущего боя.
  participants() {
    return this.s.battle ? this.s.battle.teams : null
  }

  buzzDenied(cid, playerId) {
    const b = this.s.battle
    if (b && !b.teams.includes(cid)) return 'notInBattle'
    const holder = this.buttonOf(cid)
    return holder && holder !== playerId ? 'notButton' : null
  }

  // Одна кнопка на команду: у кого она (в личной игре или если выключено — у каждого своя).
  buttonOf(cid) {
    if (!this.settings.teamMode || !this.settings.brOneButton) return null
    return this.game.buttonHolder(cid)
  }

  activeCompetitors() {
    return this.game.competitors().filter((c) => c.canBuzz)
  }

  battleCommand(teams) {
    const s = this.s
    if (s.battle) throw new GameError('Сначала завершите текущий бой')
    if (OPEN_STAGES.includes(s.stage)) throw new GameError('Сначала закончите вопрос')
    const ids = Array.isArray(teams) ? [...new Set(teams.filter((x) => typeof x === 'string'))] : []
    const all = this.activeCompetitors()
    if (ids.length < Math.min(2, all.length) || !ids.length) throw new GameError('Выберите хотя бы две команды')
    for (const id of ids) if (!this.game.competitor(id)) throw new GameError('Участник не найден')
    this.game.pushUndo('Новый бой')
    this.startBattle(ids)
    return true
  }

  startBattle(ids) {
    const s = this.s
    s.battle = {
      no: s.battles.length + 1,
      teams: ids,
      scores: Object.fromEntries(ids.map((id) => [id, 0])),
      played: 0,
      extra: 0,
      tie: false,
    }
    s.carry = 0
    s.stage = 'idle'
    s.answeredBy = null
    s.winnerId = null
    this.game.stopTimers()
    this.game.setBuzzer('off')
    this.game.log(`Бой №${s.battle.no}: ${ids.map((id) => this.game.competitorName(id)).join(' — ')}`)
    this.game.emitEvent('battleStart', { no: s.battle.no, teams: ids })
  }

  // Бой без выбора команд: две команды (или все игроки без команд) — сразу в бой.
  canAutoBattle() {
    return this.activeCompetitors().length <= 2 || !this.settings.teamMode
  }

  autoBattle() {
    this.startBattle(this.activeCompetitors().map((c) => c.id))
  }

  battleLimit() {
    const b = this.s.battle
    const n = this.settings.brBattleQuestions
    return b && n > 0 ? n + b.extra : 0
  }

  // После каждого сыгранного вопроса: не пора ли закончить бой.
  checkBattleEnd() {
    const b = this.s.battle
    if (!b) return
    const scores = b.teams.map((id) => b.scores[id] ?? 0)
    const max = Math.max(...scores)
    const leaders = b.teams.filter((id) => (b.scores[id] ?? 0) === max)
    const target = this.settings.brTargetScore
    if (target > 0 && max >= target && leaders.length === 1) {
      this.finishBattle(leaders[0])
      return
    }
    const limit = this.battleLimit()
    if (!limit || b.played < limit) return
    if (leaders.length === 1) {
      this.finishBattle(leaders[0])
      return
    }
    const mode = this.settings.brTieMode
    if (mode === 'draw') {
      this.finishBattle(null)
    } else if (mode === 'extra') {
      b.extra += 1
      this.game.log('Ничья — дополнительный вопрос')
      this.game.emitEvent('battleTie', { extra: true })
    } else {
      b.tie = true
      this.game.log('Ничья — ведущий решает: дополнительный вопрос или ничья')
      this.game.emitEvent('battleTie', { extra: false })
    }
  }

  finishBattle(winnerId) {
    const s = this.s
    const b = s.battle
    if (!b) return
    const result = { no: b.no, teams: [...b.teams], scores: { ...b.scores }, winnerId, played: b.played }
    s.battles.push(result)
    if (winnerId) this.game.addScore(winnerId, this.settings.brWinPoints)
    else for (const id of b.teams) this.game.addScore(id, this.settings.brDrawPoints)
    s.battle = null
    s.carry = 0
    s.stage = 'battleEnd'
    this.game.stopTimers()
    this.game.setBuzzer('off')
    const score = b.teams.map((id) => b.scores[id] ?? 0).join(':')
    this.game.log(
      winnerId
        ? `Бой №${b.no} (${score}): победа «${this.game.competitorName(winnerId)}»`
        : `Бой №${b.no} (${score}): ничья`,
    )
    this.game.emitEvent('battleEnd', { no: b.no, winnerId })
  }

  extraQuestion() {
    const b = this.s.battle
    if (!b?.tie) throw new GameError('Сейчас нет ничьей')
    this.game.pushUndo('Дополнительный вопрос')
    b.tie = false
    b.extra += 1
    this.game.log('Ничья — дополнительный вопрос')
    return true
  }

  declareDraw() {
    const b = this.s.battle
    if (!b) throw new GameError('Бой не идёт')
    this.game.pushUndo('Ничья')
    this.dropOpenQuestion()
    this.finishBattle(null)
    return true
  }

  // Бой заканчивают посреди вопроса — этот вопрос снимается и в счёт боя не идёт.
  dropOpenQuestion() {
    const s = this.s
    if (!OPEN_STAGES.includes(s.stage)) return
    s.history.push({ index: s.qIndex, result: 'cancelled', competitorId: null, value: 0, battle: s.battle?.no ?? null })
    s.answeredBy = null
    s.stage = 'reveal'
  }

  // Ведущий заканчивает бой раньше: побеждает тот, у кого больше очков, при равенстве — ничья.
  endBattleCommand() {
    const b = this.s.battle
    if (!b) throw new GameError('Бой не идёт')
    this.game.pushUndo('Бой завершён')
    this.dropOpenQuestion()
    const max = Math.max(...b.teams.map((id) => b.scores[id] ?? 0))
    const leaders = b.teams.filter((id) => (b.scores[id] ?? 0) === max)
    this.finishBattle(leaders.length === 1 ? leaders[0] : null)
    return true
  }

  // Турнирная таблица: бои, победы, ничьи, поражения, взятые вопросы и сквозной счёт.
  standings() {
    const s = this.s
    const rows = new Map(
      this.game.competitors().map((c) => [
        c.id,
        { competitorId: c.id, played: 0, wins: 0, draws: 0, losses: 0, taken: 0, against: 0, total: 0 },
      ]),
    )
    const list = s.battle ? [...s.battles, { ...s.battle, live: true }] : s.battles
    for (const bt of list) {
      for (const id of bt.teams) {
        const row = rows.get(id)
        if (!row) continue
        row.taken += bt.scores[id] ?? 0
        row.against += bt.teams.filter((x) => x !== id).reduce((sum, x) => sum + (bt.scores[x] ?? 0), 0)
        if (bt.live) continue
        row.played += 1
        if (bt.winnerId === id) row.wins += 1
        else if (bt.winnerId == null) row.draws += 1
        else row.losses += 1
      }
    }
    for (const row of rows.values()) row.total = this.game.score(row.competitorId)
    return [...rows.values()].sort(
      (a, b) =>
        b.total - a.total || b.wins - a.wins || b.taken - b.against - (a.taken - a.against) || b.taken - a.taken,
    )
  }

  // Кого поставить в следующий бой: пара, которая ещё не встречалась и провела меньше всего боёв.
  nextPair() {
    const ids = this.activeCompetitors().map((c) => c.id)
    if (ids.length <= 2) return ids
    const played = new Map(ids.map((id) => [id, 0]))
    const met = new Map()
    const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`)
    for (const bt of this.s.battles) {
      for (const id of bt.teams) if (played.has(id)) played.set(id, played.get(id) + 1)
      for (let i = 0; i < bt.teams.length; i++) {
        for (let j = i + 1; j < bt.teams.length; j++) {
          const k = key(bt.teams[i], bt.teams[j])
          met.set(k, (met.get(k) ?? 0) + 1)
        }
      }
    }
    let best = null
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const score = [met.get(key(ids[i], ids[j])) ?? 0, played.get(ids[i]) + played.get(ids[j])]
        if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1])) {
          best = { pair: [ids[i], ids[j]], score }
        }
      }
    }
    return best ? best.pair : ids
  }

  // ───────────── вопросы ─────────────

  goto(index) {
    if (!Number.isInteger(index) || index < 0) throw new GameError('Нет такого вопроса')
    const s = this.s
    if (s.stage === 'finished') throw new GameError('Турнир завершён — продолжите игру, чтобы играть дальше')
    if (s.battle?.tie) throw new GameError('Ничья: выберите «Дополнительный вопрос» или «Ничья»')
    if (!s.battle && !this.canAutoBattle()) throw new GameError('Выберите, какие команды играют этот бой')
    this.game.pushUndo('Следующий вопрос')
    if (!s.battle) this.autoBattle()
    this.game.stopTimers()
    s.qIndex = index
    s.stage = 'reading'
    s.value = this.settings.brQuestionValue + s.carry
    s.armCount = 0
    s.answeredBy = null
    this.game.openBuzzer()
    const b = s.battle
    const limit = this.battleLimit()
    this.game.log(
      `Бой №${b.no}, вопрос ${b.played + 1}${limit ? ` из ${limit}` : ''}${s.value > 1 ? `, стоимость ${s.value}` : ''}`,
    )
    this.game.emitEvent('brQuestion', { index })
    return true
  }

  startTime() {
    const s = this.s
    if (s.stage !== 'reading') throw new GameError('Сначала откройте вопрос')
    this.game.pushUndo('Время!')
    s.stage = 'armed'
    s.armCount = 1
    const at = this.game.armBuzzer()
    this.game.startTimer('main', this.settings.brMainTime, at)
    this.game.emitEvent('brStart', { resumed: false, at })
    return true
  }

  onBuzzWinner() {
    const s = this.s
    if (s.stage !== 'armed') return
    s.stage = 'answering'
    this.game.pauseTimer('main')
    this.game.startTimer('answer', this.settings.brAnswerTime)
  }

  judge(correct) {
    const s = this.s
    const winner = this.game.state.buzzer.winner
    if (s.stage !== 'answering' || !winner) throw new GameError('Сейчас никто не отвечает')
    const cid = winner.competitorId
    const name = this.game.competitorName(cid)
    this.game.pushUndo(correct ? `Верно: ${name}` : `Неверно: ${name}`)
    this.game.stopTimer('answer')
    if (correct) {
      const b = s.battle
      if (b) b.scores[cid] = (b.scores[cid] ?? 0) + s.value
      // В сквозной счёт турнира взятый вопрос идёт с весом «очков за вопрос» (например, 0,5).
      if (!b || this.settings.brTotal === 'sum') this.game.addScore(cid, s.value * this.settings.brTakenPoints)
      s.history.push({ index: s.qIndex, result: 'correct', competitorId: cid, value: s.value, battle: b?.no ?? null })
      s.answeredBy = cid
      s.carry = 0
      this.game.log(`${name}: верно, +${s.value}`)
      this.game.emitEvent('correct', { competitorId: cid, delta: s.value })
      this.endQuestion(true)
      return true
    }
    this.game.lockOut(cid)
    this.game.log(`${name}: неверно`)
    this.game.emitEvent('wrong', { competitorId: cid, delta: 0 })
    if (this.game.eligibleCompetitors().length > 0) {
      const remaining = this.game.timerRemaining('main')
      const extra = this.settings.brAfterWrongTime * 1000
      const mode = this.settings.brAfterWrongMode
      const next = mode === 'fixed' ? extra : mode === 'atLeast' ? Math.max(remaining, extra) : remaining
      if (next > 0) {
        s.stage = 'armed'
        s.armCount += 1
        const at = this.game.armBuzzer()
        if (!this.game.state.timers.main) this.game.startTimer('main', next / 1000, at)
        else this.game.resumeTimer('main', next, at)
        this.game.emitEvent('brStart', { resumed: true, at })
        return true
      }
    }
    this.burn()
    return true
  }

  // counted — вопрос засчитывается в бой (снятый ведущим вопрос не считается).
  endQuestion(counted) {
    this.game.stopTimers()
    this.game.setBuzzer('off')
    this.s.stage = 'reveal'
    if (counted && this.s.battle) {
      this.s.battle.played += 1
      this.checkBattleEnd()
    }
  }

  // Никто не ответил правильно: очки переходят на следующий вопрос (если включено).
  burn() {
    const s = this.s
    s.history.push({ index: s.qIndex, result: 'burned', competitorId: null, value: s.value, battle: s.battle?.no ?? null })
    s.carry = this.settings.brCarryOver ? s.value : 0
    s.answeredBy = null
    this.game.log(`Вопрос не взят${s.carry ? ' — очки переходят в следующий вопрос' : ''}`)
    this.game.emitEvent('burned')
    this.endQuestion(true)
  }

  burnCommand() {
    if (!OPEN_STAGES.includes(this.s.stage)) throw new GameError('Нет открытого вопроса')
    this.game.pushUndo('Вопрос не взят')
    this.burn()
    return true
  }

  // Снять вопрос (неудачный вопрос, спорная ситуация): без очков, без переноса и не в счёт боя.
  cancel() {
    const s = this.s
    if (!OPEN_STAGES.includes(s.stage)) throw new GameError('Нет открытого вопроса')
    this.game.pushUndo('Вопрос снят')
    s.history.push({ index: s.qIndex, result: 'cancelled', competitorId: null, value: 0, battle: s.battle?.no ?? null })
    s.answeredBy = null
    this.game.log('Вопрос снят ведущим')
    this.endQuestion(false)
    return true
  }

  onFalseStart() {
    const s = this.s
    if (OPEN_STAGES.includes(s.stage) && this.game.eligibleCompetitors().length === 0) this.burn()
  }

  onTimerExpired(name) {
    const s = this.s
    if (name === 'main' && s.stage === 'armed') {
      this.game.emitEvent('timeUp')
      this.burn()
    } else if (name === 'answer') {
      this.game.emitEvent('answerTimeUp')
    }
  }

  setValue(value) {
    const n = Math.round(Number(value))
    if (!Number.isFinite(n) || n < 0 || n > 1000) throw new GameError('Неверная стоимость')
    if (!OPEN_STAGES.includes(this.s.stage)) throw new GameError('Нет открытого вопроса')
    this.s.value = n
    return true
  }

  // Итоги турнира.
  finish() {
    const s = this.s
    if (s.battle) throw new GameError('Сначала завершите текущий бой')
    this.game.pushUndo('Итоги турнира')
    this.game.stopTimers()
    this.game.setBuzzer('off')
    const table = this.standings().filter((r) => r.played > 0 || r.total !== 0)
    const top = table[0]
    const tied = top && table[1] && table[1].total === top.total && table[1].wins === top.wins
    s.winnerId = top && !tied ? top.competitorId : null
    s.stage = 'finished'
    this.game.log(s.winnerId ? `Итоги турнира: победитель — ${this.game.competitorName(s.winnerId)}` : 'Итоги турнира')
    this.game.emitEvent('brWinner', { competitorId: s.winnerId })
    return true
  }

  // Продолжить турнир после показа итогов.
  continueGame() {
    const s = this.s
    if (s.stage !== 'finished') throw new GameError('Турнир не завершён')
    this.game.pushUndo('Продолжение турнира')
    s.stage = 'idle'
    s.winnerId = null
    return true
  }

  // ───────────── представления ─────────────

  view(role) {
    const s = this.s
    const host = role === 'host'
    const b = s.battle
    return {
      stage: s.stage,
      qIndex: s.qIndex,
      value: s.value,
      carry: s.carry,
      answeredBy: s.answeredBy,
      winnerId: s.winnerId,
      history: s.history.slice(-100),
      battle: b
        ? {
            no: b.no,
            teams: b.teams,
            scores: b.scores,
            played: b.played,
            limit: this.battleLimit(),
            extra: b.extra,
            tie: b.tie,
          }
        : null,
      lastBattle: s.stage === 'battleEnd' ? s.battles[s.battles.length - 1] ?? null : null,
      battles: s.battles.slice(-100),
      standings: this.standings(),
      nextPair: host ? this.nextPair() : null,
    }
  }

  meView(cid, playerId) {
    const b = this.s.battle
    const holder = cid ? this.buttonOf(cid) : null
    const p = holder ? this.game.player(holder) : null
    return {
      inBattle: b ? !!cid && b.teams.includes(cid) : null,
      // null — кнопка у каждого игрока; иначе — у кого кнопка команды (и на связи ли его телефон)
      button: p ? { playerId: p.id, name: p.name, connected: this.game.isConnected(p.id) } : null,
      isButton: holder ? holder === playerId : null,
    }
  }
}

function cleanBattle(b) {
  if (!b || typeof b !== 'object' || !Array.isArray(b.teams)) return null
  const teams = b.teams.filter((x) => typeof x === 'string')
  const scores = {}
  for (const id of teams) scores[id] = Number.isFinite(b.scores?.[id]) ? b.scores[id] : 0
  return {
    ...b,
    no: Number.isInteger(b.no) ? b.no : 0,
    teams,
    scores,
    played: Number.isInteger(b.played) ? b.played : 0,
    winnerId: typeof b.winnerId === 'string' ? b.winnerId : null,
  }
}
