// Режим «Брейн-ринг»: ведущий читает вопрос, по сигналу «Время!» запускается минута,
// нажатие до сигнала — фальстарт. После неверного ответа соперники получают оставшееся время
// (по умолчанию не меньше 20 секунд). Невзятый вопрос переносит очки на следующий.
// Можно играть без пакета: ведущий читает вопросы с листа, программа — кнопки и таймер.

import { GameError } from './util.js'

const OPEN_STAGES = ['reading', 'armed', 'answering']

export class BrainRingMode {
  constructor(game) {
    this.game = game
    this.cache = { pack: null, list: [] }
    this.commands = {
      'br.next': () => this.goto(this.s.qIndex + 1),
      'br.goto': (a) => this.goto(Number(a.index)),
      'br.start': () => this.startTime(),
      'br.judge': (a) => this.judge(a.correct === true),
      'br.show': (a) => this.showQuestion(a.show !== false),
      'br.cancel': () => this.cancel(),
      'br.burn': () => this.burnCommand(),
      'br.value': (a) => this.setValue(a.value),
      'br.newBattle': () => this.newBattle(),
      'br.finish': () => this.finish(),
      'br.continue': () => this.continueBattle(),
    }
  }

  static initialState() {
    return {
      stage: 'idle', // idle | reading | armed | answering | reveal | finished
      qIndex: -1,
      showQuestion: false,
      value: 1,
      carry: 0,
      armCount: 0,
      answeredBy: null,
      winnerId: null,
      history: [],
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
    if (!Number.isInteger(s.qIndex)) s.qIndex = -1
    const total = this.total()
    if (total != null && s.qIndex >= total) s.qIndex = total - 1
    if (!Array.isArray(s.history)) s.history = []
    if (s.stage === 'armed' || s.stage === 'answering') s.stage = 'reading'
    if (!['idle', 'reading', 'reveal', 'finished'].includes(s.stage)) s.stage = 'idle'
    if (!Number.isInteger(s.armCount)) s.armCount = 0
  }

  // Все вопросы пакета подряд (все раунды и темы) — для брейн-ринга цены не важны.
  questions() {
    const pack = this.game.pack
    if (!pack) return []
    if (this.cache.pack !== pack) {
      const list = []
      pack.rounds.forEach((r) =>
        r.themes.forEach((t) => t.questions.forEach((q) => list.push({ themeName: t.name, roundName: r.name, question: q }))),
      )
      this.cache = { pack, list }
    }
    return this.cache.list
  }

  total() {
    return this.game.pack ? this.questions().length : null
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

  goto(index) {
    const total = this.total()
    if (!Number.isInteger(index) || index < 0) throw new GameError('Нет такого вопроса')
    if (total != null && index >= total) throw new GameError('Вопросы в пакете закончились')
    const s = this.s
    if (s.stage === 'finished') throw new GameError('Бой завершён — начните новый бой')
    this.game.pushUndo('Следующий вопрос')
    this.game.stopTimers()
    s.qIndex = index
    s.stage = 'reading'
    s.showQuestion = this.settings.brAutoShowQuestion
    s.value = this.settings.brQuestionValue + s.carry
    s.armCount = 0
    s.answeredBy = null
    this.game.openBuzzer()
    this.game.log(`Вопрос №${index + 1}${s.value > 1 ? ` (стоимость ${s.value})` : ''}`)
    this.game.emitEvent('brQuestion', { index })
    return true
  }

  startTime() {
    const s = this.s
    if (s.stage !== 'reading') throw new GameError('Сначала откройте вопрос')
    this.game.pushUndo('Время!')
    s.stage = 'armed'
    s.armCount = 1
    this.game.armBuzzer()
    this.game.startTimer('main', this.settings.brMainTime)
    this.game.emitEvent('brStart', { resumed: false })
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
      this.game.addScore(cid, s.value)
      s.history.push({ index: s.qIndex, result: 'correct', competitorId: cid, value: s.value })
      s.answeredBy = cid
      s.carry = 0
      this.game.log(`${name}: верно, +${s.value}`)
      this.game.emitEvent('correct', { competitorId: cid, delta: s.value })
      this.endQuestion()
      const target = this.settings.brTargetScore
      if (target > 0 && this.game.score(cid) >= target) {
        s.winnerId = cid
        s.stage = 'finished'
        this.game.log(`Победа в бою: ${name}`)
        this.game.emitEvent('brWinner', { competitorId: cid })
      }
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
        this.game.armBuzzer()
        if (!this.game.state.timers.main) this.game.startTimer('main', next / 1000)
        else this.game.resumeTimer('main', next)
        this.game.emitEvent('brStart', { resumed: true })
        return true
      }
    }
    this.burn()
    return true
  }

  endQuestion() {
    this.game.stopTimers()
    this.game.setBuzzer('off')
    this.s.stage = 'reveal'
  }

  // Никто не ответил правильно: очки переходят на следующий вопрос (если включено).
  burn() {
    const s = this.s
    s.history.push({ index: s.qIndex, result: 'burned', competitorId: null, value: s.value })
    s.carry = this.settings.brCarryOver ? s.value : 0
    s.answeredBy = null
    this.game.log(`Вопрос не взят${s.carry ? ' — очки переходят в следующий вопрос' : ''}`)
    this.game.emitEvent('burned')
    this.endQuestion()
  }

  burnCommand() {
    if (!OPEN_STAGES.includes(this.s.stage)) throw new GameError('Нет открытого вопроса')
    this.game.pushUndo('Вопрос не взят')
    this.burn()
    return true
  }

  // Снять вопрос (неудачный вопрос, спорная ситуация): без очков и без переноса.
  cancel() {
    const s = this.s
    if (!OPEN_STAGES.includes(s.stage)) throw new GameError('Нет открытого вопроса')
    this.game.pushUndo('Вопрос снят')
    s.history.push({ index: s.qIndex, result: 'cancelled', competitorId: null, value: 0 })
    s.answeredBy = null
    this.game.log('Вопрос снят ведущим')
    this.endQuestion()
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

  showQuestion(show) {
    this.s.showQuestion = show
    return true
  }

  setValue(value) {
    const n = Math.round(Number(value))
    if (!Number.isFinite(n) || n < 0 || n > 1000) throw new GameError('Неверная стоимость')
    if (!OPEN_STAGES.includes(this.s.stage)) throw new GameError('Нет открытого вопроса')
    this.s.value = n
    return true
  }

  newBattle() {
    this.game.pushUndo('Новый бой')
    const s = this.s
    this.game.stopTimers()
    this.game.setBuzzer('off')
    this.game.state.scores = {}
    const qIndex = s.qIndex
    this.game.state.brainring = { ...BrainRingMode.initialState(), qIndex }
    this.game.log('Новый бой: счёт обнулён')
    this.game.emitEvent('brNewBattle')
    return true
  }

  finish() {
    this.game.pushUndo('Бой завершён')
    const s = this.s
    this.game.stopTimers()
    this.game.setBuzzer('off')
    const list = this.game.competitors()
    let winner = null
    if (list.length) {
      const max = Math.max(...list.map((c) => this.game.score(c.id)))
      const top = list.filter((c) => this.game.score(c.id) === max)
      winner = top.length === 1 ? top[0].id : null
    }
    s.winnerId = winner
    s.stage = 'finished'
    this.game.log(winner ? `Бой завершён, победитель: ${this.game.competitorName(winner)}` : 'Бой завершён вничью')
    this.game.emitEvent('brWinner', { competitorId: winner })
    return true
  }

  // Продолжить бой после «победы» (например, если играем до большего счёта).
  continueBattle() {
    const s = this.s
    if (s.stage !== 'finished') throw new GameError('Бой не завершён')
    this.game.pushUndo('Продолжение боя')
    s.stage = s.qIndex >= 0 ? 'reveal' : 'idle'
    s.winnerId = null
    return true
  }

  view(role) {
    const s = this.s
    const host = role === 'host'
    const list = this.questions()
    const item = s.qIndex >= 0 ? list[s.qIndex] ?? null : null
    const revealed = s.stage === 'reveal' || s.stage === 'finished'
    const showAnswer = host || (revealed && this.settings.brShowAnswer)
    const showContent = host || s.showQuestion || (revealed && this.settings.brShowAnswer)
    return {
      stage: s.stage,
      qIndex: s.qIndex,
      total: this.total(),
      value: s.value,
      carry: s.carry,
      showQuestion: s.showQuestion,
      answeredBy: s.answeredBy,
      winnerId: s.winnerId,
      history: s.history.slice(-100),
      question: item
        ? {
            themeName: item.themeName,
            content: showContent ? item.question.content : null,
            answer: showAnswer ? item.question.answer : null,
            answerContent: showAnswer ? item.question.answerContent : null,
            comment: host ? item.question.comment || null : null,
          }
        : null,
      list: host ? list.map((x) => ({ themeName: x.themeName, preview: preview(x.question) })) : null,
    }
  }
}

function preview(question) {
  const text = question.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join(' ')
    .trim()
  const media = question.content.find((c) => c.type !== 'text')
  const label = text || (media ? { image: '[картинка]', audio: '[звук]', video: '[видео]' }[media.type] : '')
  return label.length > 90 ? `${label.slice(0, 88)}…` : label
}
