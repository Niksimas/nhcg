// Режим «Своя игра»: табло тем и цен, спецвопросы (кот в мешке, аукцион, без риска), финал со ставками.

import { GameError, cleanText } from './util.js'

const Q_TYPES = ['normal', 'cat', 'auction', 'norisk']
const TYPE_LABEL = { cat: 'кот в мешке', auction: 'аукцион', norisk: 'вопрос без риска' }
const CONTENT_STEPS = ['reading', 'buzzing', 'answering', 'reveal']

export class JeopardyMode {
  constructor(game) {
    this.game = game
    this.commands = {
      'j.select': (a) => this.select(a.id, a.force === true),
      'j.assign': (a) => this.assign(a.competitorId, a.price),
      'j.arm': () => this.arm(),
      'j.judge': (a) => this.judge(a.correct === true),
      'j.reveal': () => this.reveal(),
      'j.close': () => this.close(),
      'j.round': (a) => this.goRound(Number(a.index)),
      'j.nextRound': () => this.nextRound(),
      'j.chooser': (a) => this.setChooser(a.competitorId),
      'j.results': () => this.showResults(),
      'j.board': () => this.backToBoard(),
      'j.final.removeTheme': (a) => this.finalRemoveTheme(Number(a.index)),
      'j.final.toggle': (a) => this.finalToggleParticipant(a.competitorId),
      'j.final.bet': (a) => this.finalSetBet(a.competitorId, a.amount),
      'j.final.question': () => this.finalQuestion(),
      'j.final.close': () => this.finalClose(),
      'j.final.show': (a) => this.finalShow(a.competitorId),
      'j.final.judge': (a) => this.finalJudge(a.competitorId, a.correct === true),
      'j.final.answer': () => this.finalShowAnswer(),
    }
  }

  static initialState() {
    return { roundIndex: 0, played: [], chooserId: null, stage: 'board', q: null, final: null }
  }

  get s() {
    return this.game.state.jeopardy
  }

  get settings() {
    return this.game.settings
  }

  rounds() {
    return this.game.pack?.rounds ?? []
  }

  round(i = this.s.roundIndex) {
    return this.rounds()[i] ?? null
  }

  reset() {
    this.game.state.jeopardy = JeopardyMode.initialState()
  }

  // Проверка состояния после восстановления из файла.
  sanitize() {
    const s = this.s
    if (!this.game.pack) {
      this.reset()
      return
    }
    if (!Number.isInteger(s.roundIndex) || !this.round(s.roundIndex)) s.roundIndex = 0
    s.played = Array.isArray(s.played) ? s.played.filter((id) => this.find(id)) : []
    if (!['board', 'question', 'roundEnd', 'final', 'results'].includes(s.stage)) s.stage = 'board'
    if (s.q && !this.find(s.q.id)) s.q = null
    if (s.stage === 'question' && !s.q) s.stage = 'board'
    if (s.stage === 'final' && (!s.final || this.round()?.type !== 'final')) s.stage = 'board'
    if (s.q && s.q.type === 'normal' && (s.q.step === 'buzzing' || s.q.step === 'answering')) {
      // После перезапуска возвращаемся к чтению вопроса — ведущий снова разрешит ответы.
      // У спецвопросов отвечающий назначен ведущим, поэтому их не трогаем.
      s.q.step = 'reading'
      s.q.responderId = null
    }
  }

  find(id) {
    if (typeof id !== 'string') return null
    const m = /^(\d+):(\d+):(\d+)$/.exec(id)
    if (!m) return null
    const [ri, ti, qi] = m.slice(1).map(Number)
    const round = this.rounds()[ri]
    const theme = round?.themes[ti]
    const question = theme?.questions[qi]
    if (!question) return null
    return { id, ri, ti, qi, round, theme, question }
  }

  roundQuestionIds(ri) {
    const round = this.rounds()[ri]
    if (!round) return []
    const ids = []
    round.themes.forEach((t, ti) => t.questions.forEach((_, qi) => ids.push(`${ri}:${ti}:${qi}`)))
    return ids
  }

  roundComplete(ri) {
    return this.roundQuestionIds(ri).every((id) => this.s.played.includes(id))
  }

  canStart() {
    if (!this.game.pack) return 'Сначала выберите пакет вопросов'
    if (!this.rounds().length) return 'В пакете нет раундов'
    return null
  }

  earlyPolicy() {
    const q = this.s.q
    if (this.s.stage === 'question' && q && (q.step === 'reading' || q.step === 'buzzing') && this.settings.jEarlyLockMs > 0) {
      return 'lock'
    }
    return 'ignore'
  }

  randomCompetitor() {
    const list = this.game.competitors().filter((c) => c.canBuzz)
    return list.length ? list[Math.floor(Math.random() * list.length)].id : null
  }

  lowestCompetitor() {
    const list = this.game.competitors().filter((c) => c.canBuzz)
    if (!list.length) return null
    const min = Math.min(...list.map((c) => this.game.score(c.id)))
    const current = list.find((c) => c.id === this.s.chooserId)
    if (current && this.game.score(current.id) === min) return current.id
    return list.find((c) => this.game.score(c.id) === min).id
  }

  // Вызывается при старте игры, смене режима или загрузке пакета.
  start() {
    const s = this.s
    if (!s.chooserId || !this.game.competitor(s.chooserId)) s.chooserId = this.randomCompetitor()
    if (s.stage === 'results') {
      this.game.stopTimers()
      this.game.setBuzzer('off')
      return
    }
    this.enterRound(this.round(s.roundIndex) ? s.roundIndex : 0)
  }

  enterRound(index) {
    const r = this.round(index)
    if (!r) throw new GameError('Нет такого раунда')
    const s = this.s
    s.roundIndex = index
    s.q = null
    this.game.stopTimers()
    this.game.setBuzzer('off')
    if (r.type === 'final') {
      this.startFinal()
    } else {
      s.final = null
      s.stage = this.roundComplete(index) ? 'roundEnd' : 'board'
    }
  }

  // ───────────── табло и обычные вопросы ─────────────

  select(id, force = false) {
    const s = this.s
    if (s.stage !== 'board' && !(force && s.stage === 'roundEnd')) throw new GameError('Сейчас нельзя выбрать вопрос')
    const f = this.find(id)
    if (!f || f.ri !== s.roundIndex || f.round.type === 'final') throw new GameError('Вопрос не найден')
    if (s.played.includes(id) && !force) throw new GameError('Этот вопрос уже сыгран')
    this.game.pushUndo('Выбор вопроса')
    if (!s.played.includes(id)) s.played.push(id)
    const type = Q_TYPES.includes(f.question.type) ? f.question.type : 'normal'
    const base = f.question.price
    s.stage = 'question'
    s.q = {
      id,
      type,
      basePrice: base,
      price: type === 'cat' && Number.isFinite(f.question.catPrice) ? f.question.catPrice : base,
      step: type === 'normal' ? 'reading' : 'special',
      responderId: null,
      attempts: [],
    }
    this.game.stopTimers()
    if (type === 'normal') this.game.openBuzzer()
    else this.game.setBuzzer('off')
    this.game.log(`Вопрос: «${f.theme.name}» за ${base}${type !== 'normal' ? ` — ${TYPE_LABEL[type]}` : ''}`)
    this.game.emitEvent('questionSelected', { id, type })
    return true
  }

  // Назначение отвечающего для спецвопроса (кот в мешке, аукцион, без риска).
  assign(competitorId, price) {
    const s = this.s
    const q = s.q
    if (s.stage !== 'question' || !q || q.step !== 'special') throw new GameError('Сейчас нельзя назначить отвечающего')
    const c = this.game.competitor(competitorId)
    if (!c) throw new GameError('Участник не найден')
    let p = q.price
    if (q.type !== 'norisk' && price !== undefined && price !== null && price !== '') {
      const n = Math.round(Number(price))
      if (!Number.isFinite(n) || n < 0 || n > 1e9) throw new GameError('Неверная стоимость')
      p = n
    }
    this.game.pushUndo('Назначение отвечающего')
    q.responderId = c.id
    q.price = p
    q.step = 'answering'
    this.game.startTimer('answer', this.settings.jAnswerTime)
    const what = q.type === 'auction' ? `ставка ${p}` : q.type === 'norisk' ? `без риска, ${p * 2} за верный ответ` : `стоимость ${p}`
    this.game.log(`Отвечает ${c.name} (${what})`)
    this.game.emitEvent('assigned', { competitorId: c.id })
    return true
  }

  arm() {
    const s = this.s
    const q = s.q
    if (s.stage !== 'question' || !q || q.step !== 'reading') throw new GameError('Сейчас нельзя принимать ответы')
    this.game.pushUndo('Приём ответов')
    q.step = 'buzzing'
    const at = this.game.armBuzzer()
    this.game.startTimer('buzz', this.settings.jBuzzTime, at)
    this.game.emitEvent('armed', { at })
    return true
  }

  onBuzzWinner(cid) {
    const q = this.s.q
    if (this.s.stage !== 'question' || !q || q.step !== 'buzzing') return
    q.step = 'answering'
    q.responderId = cid
    this.game.stopTimer('buzz')
    this.game.startTimer('answer', this.settings.jAnswerTime)
  }

  judge(correct) {
    const s = this.s
    const q = s.q
    if (s.stage !== 'question' || !q || q.step !== 'answering' || !q.responderId) {
      throw new GameError('Сейчас никто не отвечает')
    }
    const cid = q.responderId
    const name = this.game.competitorName(cid)
    this.game.pushUndo(correct ? `Верно: ${name}` : `Неверно: ${name}`)
    this.game.stopTimer('answer')
    if (correct) {
      const gain = q.type === 'norisk' ? q.price * 2 : q.price
      this.game.addScore(cid, gain)
      q.attempts.push({ competitorId: cid, correct: true, delta: gain })
      s.chooserId = cid
      this.game.log(`${name}: верно, +${gain}`)
      this.game.emitEvent('correct', { competitorId: cid, delta: gain })
      this.toReveal()
      return true
    }
    const loss = q.type === 'norisk' || !this.settings.jWrongPenalty ? 0 : q.price
    this.game.addScore(cid, -loss)
    q.attempts.push({ competitorId: cid, correct: false, delta: -loss })
    this.game.log(`${name}: неверно${loss ? `, −${loss}` : ''}`)
    this.game.emitEvent('wrong', { competitorId: cid, delta: -loss })
    if (q.type === 'normal') {
      this.game.lockOut(cid)
      if (this.game.eligibleCompetitors().length > 0) {
        // Остальные могут попробовать ответить.
        q.responderId = null
        q.step = 'buzzing'
        const at = this.game.armBuzzer()
        this.game.startTimer('buzz', this.settings.jBuzzTime, at)
        this.game.emitEvent('armed', { at, again: true })
        return true
      }
    }
    this.toReveal()
    return true
  }

  toReveal() {
    const q = this.s.q
    q.step = 'reveal'
    q.responderId = null
    this.game.stopTimer('buzz')
    this.game.stopTimer('answer')
    this.game.setBuzzer('off')
    this.game.emitEvent('reveal')
  }

  reveal() {
    const s = this.s
    if (s.stage !== 'question' || !s.q) throw new GameError('Нет открытого вопроса')
    if (s.q.step === 'reveal') return true
    this.game.pushUndo('Показ ответа')
    this.toReveal()
    return true
  }

  close() {
    const s = this.s
    if (s.stage !== 'question' || !s.q) throw new GameError('Нет открытого вопроса')
    this.game.pushUndo('Возврат к табло')
    s.q = null
    this.game.stopTimers()
    this.game.setBuzzer('off')
    s.stage = this.roundComplete(s.roundIndex) ? 'roundEnd' : 'board'
    this.game.emitEvent('board')
    return true
  }

  goRound(index) {
    if (!Number.isInteger(index) || !this.round(index)) throw new GameError('Нет такого раунда')
    this.game.pushUndo('Смена раунда')
    const prev = this.s.roundIndex
    this.enterRound(index)
    if (index !== prev && this.round(index).type !== 'final' && this.settings.jNewRoundChooser === 'lowest') {
      const low = this.lowestCompetitor()
      if (low) this.s.chooserId = low
    }
    this.game.log(`Раунд: ${this.round(index).name}`)
    this.game.emitEvent('round', { index })
    return true
  }

  nextRound() {
    const next = this.s.roundIndex + 1
    if (next >= this.rounds().length) return this.showResults()
    return this.goRound(next)
  }

  setChooser(competitorId) {
    const c = this.game.competitor(competitorId)
    if (!c) throw new GameError('Участник не найден')
    this.game.pushUndo('Смена выбирающего')
    this.s.chooserId = c.id
    return true
  }

  showResults() {
    this.game.pushUndo('Итоги')
    this.game.stopTimers()
    this.game.setBuzzer('off')
    this.s.q = null
    this.s.stage = 'results'
    this.game.log('Итоги игры')
    this.game.emitEvent('results')
    return true
  }

  backToBoard() {
    if (this.s.stage !== 'results') throw new GameError('Игра не завершена')
    this.game.pushUndo('Возврат к игре')
    this.enterRound(this.s.roundIndex)
    return true
  }

  // ───────────── финал ─────────────

  startFinal() {
    const s = this.s
    const r = this.round()
    const themes = r.themes.map((t, i) => ({ index: i, name: t.name, removed: false }))
    const onlyPositive = this.settings.jFinalOnlyPositive
    const participants = this.game
      .competitors()
      .filter((c) => c.canBuzz && (!onlyPositive || this.game.score(c.id) > 0))
      .map((c) => c.id)
    s.stage = 'final'
    s.final = {
      step: themes.length > 1 ? 'themes' : 'bets',
      themes,
      themeIndex: themes.length === 1 ? 0 : null,
      participants,
      bets: {},
      answers: {},
      results: {},
      shown: [],
      current: null,
      answerShown: false,
    }
  }

  needFinal(steps) {
    const f = this.s.final
    const list = Array.isArray(steps) ? steps : [steps]
    if (this.s.stage !== 'final' || !f || !list.includes(f.step)) throw new GameError('Сейчас это действие недоступно')
    return f
  }

  finalQuestionData() {
    const f = this.s.final
    if (!f || f.themeIndex == null) return null
    const theme = this.round()?.themes[f.themeIndex]
    return theme ? { theme, question: theme.questions[0] } : null
  }

  finalRemoveTheme(index) {
    const f = this.needFinal('themes')
    const th = f.themes[index]
    if (!th || th.removed) throw new GameError('Тема не найдена')
    if (f.themes.filter((t) => !t.removed).length <= 1) throw new GameError('Осталась последняя тема')
    this.game.pushUndo('Убрана тема финала')
    th.removed = true
    const left = f.themes.filter((t) => !t.removed)
    if (left.length === 1) {
      f.themeIndex = left[0].index
      f.step = 'bets'
      this.game.log(`Тема финала: ${left[0].name}`)
      this.game.emitEvent('finalTheme')
    }
    return true
  }

  finalToggleParticipant(competitorId) {
    const f = this.needFinal(['themes', 'bets'])
    const c = this.game.competitor(competitorId)
    if (!c) throw new GameError('Участник не найден')
    if (f.participants.includes(c.id)) {
      f.participants = f.participants.filter((x) => x !== c.id)
      delete f.bets[c.id]
    } else {
      f.participants.push(c.id)
    }
    return true
  }

  maxBet(cid) {
    return Math.max(1, this.game.score(cid))
  }

  applyBet(cid, amount) {
    const n = Math.round(Number(amount))
    const max = this.maxBet(cid)
    if (!Number.isFinite(n) || n < 1 || n > max) throw new GameError(`Ставка должна быть от 1 до ${max}`)
    this.s.final.bets[cid] = n
  }

  finalSetBet(competitorId, amount) {
    const f = this.needFinal('bets')
    if (!f.participants.includes(competitorId)) throw new GameError('Участник не играет в финале')
    this.applyBet(competitorId, amount)
    return true
  }

  finalQuestion() {
    const f = this.needFinal('bets')
    if (!this.finalQuestionData()) throw new GameError('Не выбрана тема финала')
    this.game.pushUndo('Вопрос финала')
    f.step = 'question'
    this.game.startTimer('final', this.settings.jFinalTime)
    this.game.log('Финал: вопрос показан')
    this.game.emitEvent('finalQuestion')
    return true
  }

  finalClose() {
    const f = this.needFinal('question')
    this.game.pushUndo('Приём ответов финала закрыт')
    this.game.stopTimer('final')
    f.step = 'reveal'
    return true
  }

  finalShow(competitorId) {
    const f = this.needFinal('reveal')
    if (!f.participants.includes(competitorId)) throw new GameError('Участник не играет в финале')
    f.current = competitorId
    if (!f.shown.includes(competitorId)) f.shown.push(competitorId)
    this.game.emitEvent('finalShow', { competitorId })
    return true
  }

  finalJudge(competitorId, correct) {
    const f = this.needFinal('reveal')
    if (!f.participants.includes(competitorId)) throw new GameError('Участник не играет в финале')
    const name = this.game.competitorName(competitorId)
    this.game.pushUndo(`Финал: ${name}`)
    const bet = f.bets[competitorId] ?? 0
    const prev = f.results[competitorId]
    if (prev === true) this.game.addScore(competitorId, -bet)
    else if (prev === false) this.game.addScore(competitorId, bet)
    f.results[competitorId] = correct
    this.game.addScore(competitorId, correct ? bet : -bet)
    f.current = competitorId
    if (!f.shown.includes(competitorId)) f.shown.push(competitorId)
    this.game.log(`Финал, ${name}: ${correct ? 'верно' : 'неверно'} (${correct ? '+' : '−'}${bet})`)
    this.game.emitEvent(correct ? 'correct' : 'wrong', { competitorId, delta: correct ? bet : -bet })
    return true
  }

  finalShowAnswer() {
    const f = this.needFinal('reveal')
    f.answerShown = true
    this.game.emitEvent('reveal')
    return true
  }

  // ───────────── действия игроков ─────────────

  playerAction(playerId, name, a) {
    if (this.game.state.stage !== 'game') throw new GameError('Игра ещё не началась')
    const cid = this.game.competitorOf(playerId)
    if (!cid) throw new GameError('Сначала выберите команду')
    switch (name) {
      case 'select': {
        if (!this.settings.phoneSelect) throw new GameError('Выбор вопроса с телефона выключен')
        if (this.s.stage !== 'board') throw new GameError('Сейчас нельзя выбрать вопрос')
        if (cid !== this.s.chooserId) throw new GameError('Сейчас выбирает другой игрок')
        return this.select(a.id, false)
      }
      case 'finalBet': {
        const f = this.needFinal('bets')
        if (!f.participants.includes(cid)) throw new GameError('Вы не участвуете в финале')
        this.applyBet(cid, a.amount)
        this.game.emitEvent('finalBet', { competitorId: cid })
        return true
      }
      case 'finalAnswer': {
        const f = this.needFinal('question')
        if (!f.participants.includes(cid)) throw new GameError('Вы не участвуете в финале')
        f.answers[cid] = cleanText(a.text, 300)
        this.game.emitEvent('finalAnswer', { competitorId: cid })
        return true
      }
      default:
        return undefined
    }
  }

  // ───────────── таймеры ─────────────

  onTimerExpired(name) {
    const s = this.s
    if (name === 'buzz' && s.stage === 'question' && s.q?.step === 'buzzing') {
      this.game.log('Время вышло — никто не ответил')
      this.game.emitEvent('timeUp')
      this.toReveal()
    } else if (name === 'answer') {
      this.game.emitEvent('answerTimeUp')
    } else if (name === 'final' && s.stage === 'final' && s.final?.step === 'question') {
      s.final.step = 'reveal'
      this.game.emitEvent('timeUp')
    }
  }

  // ───────────── представления ─────────────

  view(role) {
    const s = this.s
    const host = role === 'host'
    const pack = this.game.pack
    if (!pack) return null
    const r = this.round()
    return {
      stage: s.stage,
      roundIndex: s.roundIndex,
      rounds: pack.rounds.map((round, i) => ({
        name: round.name,
        type: round.type,
        complete: round.type === 'final' ? false : this.roundComplete(i),
      })),
      chooserId: s.chooserId,
      board:
        r && r.type !== 'final'
          ? r.themes.map((t, ti) => ({
              name: t.name,
              questions: t.questions.map((q, qi) => {
                const id = `${s.roundIndex}:${ti}:${qi}`
                return { id, price: q.price, played: s.played.includes(id), type: host ? q.type : undefined }
              }),
            }))
          : null,
      question: this.questionView(host),
      final: this.finalView(host),
    }
  }

  questionView(host) {
    const q = this.s.q
    if (this.s.stage !== 'question' || !q) return null
    const f = this.find(q.id)
    if (!f) return null
    const src = f.question
    const contentVisible = host || CONTENT_STEPS.includes(q.step)
    const revealed = q.step === 'reveal'
    return {
      id: q.id,
      themeName: f.theme.name,
      type: q.type,
      step: q.step,
      basePrice: q.basePrice,
      price: q.price,
      responderId: q.responderId,
      catTheme: q.type === 'cat' ? src.catTheme || f.theme.name : null,
      catPriceOptions: q.type === 'cat' ? src.catPriceOptions ?? null : null,
      catSelf: q.type === 'cat' ? !!src.catSelf : null,
      content: contentVisible ? src.content : null,
      answer: host || revealed ? src.answer : null,
      answerContent: host || revealed ? src.answerContent : null,
      comment: host ? src.comment || null : null,
      attempts: q.attempts,
    }
  }

  finalView(host) {
    const f = this.s.final
    if (this.s.stage !== 'final' || !f) return null
    const data = this.finalQuestionData()
    const showQuestion = host || f.step === 'question' || f.step === 'reveal'
    const showAnswer = host || f.answerShown
    return {
      step: f.step,
      themes: f.themes,
      themeName: data?.theme.name ?? null,
      participants: f.participants.map((cid) => {
        const open = host || f.shown.includes(cid)
        return {
          competitorId: cid,
          hasBet: cid in f.bets,
          hasAnswer: !!f.answers[cid],
          bet: open ? (f.bets[cid] ?? null) : null,
          answer: open ? (f.answers[cid] ?? null) : null,
          result: f.results[cid] ?? null,
          shown: f.shown.includes(cid),
        }
      }),
      current: f.current,
      content: showQuestion && data ? data.question.content : null,
      answer: showAnswer && data ? data.question.answer : null,
      answerContent: showAnswer && data ? data.question.answerContent : null,
      comment: host && data ? data.question.comment || null : null,
      answerShown: f.answerShown,
    }
  }

  meView(cid) {
    const s = this.s
    const f = s.stage === 'final' ? s.final : null
    const participant = !!(f && cid && f.participants.includes(cid))
    return {
      isChooser: !!cid && cid === s.chooserId,
      canSelect: this.settings.phoneSelect && s.stage === 'board' && !!cid && cid === s.chooserId,
      final: f
        ? {
            participant,
            bet: participant ? (f.bets[cid] ?? null) : null,
            maxBet: participant ? this.maxBet(cid) : 0,
            answer: participant ? (f.answers[cid] ?? null) : null,
            result: participant ? (f.results[cid] ?? null) : null,
          }
        : null,
    }
  }
}
