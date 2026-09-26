// Режим «Хамса» — командная игра, придуманная в Азербайджане (Фаик Гусейнов, 2006) на основе «Эрудит-квартета».
// Всё построено на числе пять: в команде 5 игроков, в игре 5 раундов, в раунде 5 тем по 5 вопросов.
//
//   1. Явный раунд         — темы объявлены заранее, капитан за минуту расставляет игроков по темам (100–500).
//   2. Полуявный раунд     — тема объявляется перед игрой, капитан за 20 секунд выбирает игрока (200–1000).
//   3. Тайный раунд        — капитан заранее ставит игроков на темы, не зная их названий (300–1500).
//   4. Персональный раунд  — капитан выбирает одного игрока; команды по очереди (от меньшего счёта к большему)
//      вычёркивают темы, оставшуюся тему играют выбранные игроки (400–2000).
//   5. Раунд «Хамса»       — один сложный вопрос для всей команды: играют команды с положительным счётом,
//      капитан за 30 секунд делает ставку (от 1 до всех набранных очков), затем минута на обсуждение и 10 секунд
//      на запись ответа.
//
// Фальстарта нет: нажать можно в любой момент после объявления темы и стоимости вопроса — ведущий прекращает чтение.
// На ответ — 3 секунды. После неверного ответа право ответа переходит к следующему нажавшему (5 секунд), а если
// желающих нет — ведущий читает дальше, и перебить его снова может любой. Ошибка — минус стоимость.
//
// Ход тем и вопросов, выбор игроков капитанами и раунд со ставками — общие с «Эрудит-квартетом» из «Своей игры».
// Вопросы ведущий читает с листа: программа знает только скелет игры (раунды, темы, стоимость вопросов).

import { JeopardyMode } from './jeopardy.js'
import { rankPresses } from './buzzer.js'
import { GameError } from './util.js'

export const KHAMSA_KINDS = ['open', 'semi', 'closed', 'personal']
const ROUND_NAME = { open: 'Явный раунд', semi: 'Полуявный раунд', closed: 'Тайный раунд', personal: 'Персональный раунд' }

export class KhamsaMode extends JeopardyMode {
  constructor(game) {
    super(game)
    this.commands['j.strike'] = (a) => this.hostStrike(Number(a.index))
  }

  static initialState() {
    return {
      ...JeopardyMode.initialState(),
      strike: null, // вычёркивание тем: { order: [команды], turn, removed: [номера тем] }
      struck: {}, // вычеркнутые темы: номер раунда → [номера тем]
      chosen: {}, // оставшаяся после вычёркивания тема: номер раунда → номер темы
    }
  }

  get s() {
    return this.game.state.khamsa
  }

  reset() {
    this.game.state.khamsa = KhamsaMode.initialState()
  }

  // Настройки «Хамсы» поверх общих правил «Эрудит-квартета».
  get settings() {
    const g = this.game.settings
    return {
      ...g,
      jTableMode: 'one',
      jOnePerPlayer: true,
      jSpecials: false,
      jAssignRoundTime: g.hAssignRoundTime,
      jAssignThemeTime: g.hAssignThemeTime,
      jBuzzTime: g.hBuzzTime,
      jAnswerTime: g.hAnswerTime,
      jWrongPenalty: g.hWrongPenalty,
      jEarlyLockMs: 0,
      jBetTime: g.hBetTime,
      jFinalTime: g.hFinalTime,
      jFinalOnlyPositive: true,
      phoneSelect: false,
    }
  }

  format() {
    return 'khamsa'
  }

  hasKinds() {
    return true
  }

  liveReading() {
    return true
  }

  // Скелет «Хамсы»: четыре раунда по пять тем из пяти вопросов и раунд «Хамса» — один вопрос на ставку.
  structureKey() {
    return JSON.stringify(this.s.names)
  }

  buildRounds() {
    const rounds = KHAMSA_KINDS.map((kind, ri) => ({
      name: ROUND_NAME[kind],
      type: 'normal',
      themes: Array.from({ length: 5 }, (_, ti) => this.buildTheme(ri, ti, 5, () => 0)),
    }))
    const ri = rounds.length
    const theme = this.buildTheme(ri, 0, 1, () => 0)
    theme.name = this.themeName(ri, 0, 'Хамса')
    rounds.push({ name: 'Хамса', type: 'final', themes: [theme] })
    return rounds
  }

  // Номер обычного раунда (без финала): от него зависит стоимость вопросов.
  roundNumber(ri) {
    let n = 0
    for (let i = 0; i <= ri; i++) if (this.rounds()[i] && this.rounds()[i].type !== 'final') n++
    return Math.max(1, n)
  }

  kindOf(ri = this.s.roundIndex) {
    const r = this.round(ri)
    if (!r) return null
    if (r.type === 'final') return 'khamsa'
    return KHAMSA_KINDS[ri] ?? 'open'
  }

  priceOf(ri, ti, qi) {
    const q = this.rounds()[ri]?.themes[ti]?.questions[qi]
    if (!q) return 0
    return (qi + 1) * this.game.settings.hPriceBase * this.roundNumber(ri)
  }

  // Фальстарта нет: кнопки открыты с начала вопроса. Нажатие раньше этого (при игре по интернету кнопки открываются
  // с небольшой задержкой) просто не засчитывается.
  earlyPolicy() {
    return 'ignore'
  }

  sanitize() {
    super.sanitize()
    const s = this.s
    for (const key of ['struck', 'chosen']) if (!s[key] || typeof s[key] !== 'object' || Array.isArray(s[key])) s[key] = {}
    const st = s.strike
    if (!st || !Array.isArray(st.order) || !Array.isArray(st.removed) || !Number.isInteger(st.turn)) s.strike = null
    if (s.stage === 'strike' && !s.strike) s.stage = 'board'
    // После перезапуска вопрос возвращается к чтению — кнопки снова открыты с начала вопроса.
    if (this.game.state.mode === 'khamsa' && this.game.state.stage === 'game' && s.stage === 'question' && s.q?.step === 'reading') {
      s.q.read = false
      this.game.armBuzzer()
    }
  }

  // ───────────── раунды ─────────────

  enterRound(index) {
    this.s.strike = null
    super.enterRound(index)
  }

  // Персональный раунд уже шёл (тема осталась после вычёркивания) — сразу к ней.
  enterPersonal() {
    if (Number.isInteger(this.s.chosen?.[this.s.roundIndex])) {
      this.s.stage = 'board'
      return
    }
    super.enterPersonal()
  }

  // Игроки выбраны — команды вычёркивают темы (если тема уже осталась одна — играем её).
  afterLeaders() {
    const chosen = this.s.chosen?.[this.s.roundIndex]
    if (Number.isInteger(chosen)) this.enterTheme(chosen)
    else this.startStrike()
  }

  // В персональном раунде играется одна тема — оставшаяся после вычёркивания.
  themeInPlay(ri, ti) {
    if (this.kindOf(ri) !== 'personal') return true
    return this.s.chosen?.[ri] === ti
  }

  roundComplete(ri) {
    if (this.kindOf(ri) === 'personal') {
      const chosen = this.s.chosen?.[ri]
      return Number.isInteger(chosen) && this.themeComplete(ri, chosen)
    }
    return super.roundComplete(ri)
  }

  nextThemeIndex() {
    const ri = this.s.roundIndex
    if (this.kindOf(ri) === 'personal') {
      const chosen = this.s.chosen?.[ri]
      return Number.isInteger(chosen) && !this.themeComplete(ri, chosen) ? chosen : null
    }
    return super.nextThemeIndex()
  }

  // Ведущий заново запускает выбор игрока персонального раунда (например, если кто-то ушёл).
  restartAssign() {
    const s = this.s
    const ri = s.roundIndex
    if (this.kindOf(ri) === 'personal') {
      const chosen = s.chosen?.[ri]
      if (Number.isInteger(chosen) && this.themeQuestionIds(ri, chosen).some((id) => s.played.includes(id))) {
        throw new GameError('Тема персонального раунда уже играется')
      }
      if (['board', 'assign', 'strike', 'theme'].includes(s.stage)) s.strike = null
    }
    return super.restartAssign()
  }

  // ───────────── персональный раунд: вычёркивание тем ─────────────

  startStrike() {
    const s = this.s
    const ri = s.roundIndex
    const r = this.round(ri)
    // Вычёркивают по очереди — от команды с наименьшим счётом к наибольшему.
    const order = this.game
      .competitors()
      .filter((c) => c.canBuzz)
      .sort((a, b) => this.game.score(a.id) - this.game.score(b.id))
      .map((c) => c.id)
    if (r.themes.length <= 1 || !order.length) {
      this.chooseTheme(0)
      return
    }
    s.stage = 'strike'
    s.strike = { order, turn: 0, removed: [] }
    this.game.log('Команды по очереди убирают темы персонального раунда')
    this.game.emitEvent('strikeStart')
  }

  strikeTurn() {
    const st = this.s.strike
    return st ? st.order[st.turn % st.order.length] : null
  }

  strike(ti, competitorId) {
    const s = this.s
    const st = s.strike
    if (s.stage !== 'strike' || !st) throw new GameError('Сейчас темы не убирают')
    const r = this.round()
    if (!Number.isInteger(ti) || !r.themes[ti] || st.removed.includes(ti)) throw new GameError('Эту тему убрать нельзя')
    const current = this.strikeTurn()
    if (competitorId && competitorId !== current) throw new GameError('Сейчас убирает тему другая команда')
    this.game.pushUndo('Тема убрана')
    st.removed.push(ti)
    st.turn += 1
    s.struck = { ...s.struck, [s.roundIndex]: [...st.removed] }
    this.game.log(`${this.game.competitorName(current)} убирает тему «${r.themes[ti].name}»`)
    this.game.emitEvent('strike', { index: ti, competitorId: current })
    const left = r.themes.map((_, i) => i).filter((i) => !st.removed.includes(i))
    if (left.length === 1) this.chooseTheme(left[0])
    return true
  }

  chooseTheme(ti) {
    const s = this.s
    s.strike = null
    s.chosen = { ...s.chosen, [s.roundIndex]: ti }
    this.enterTheme(ti)
  }

  hostStrike(ti) {
    return this.strike(ti, null)
  }

  // ───────────── после неверного ответа ─────────────

  // Право ответа переходит к следующему нажавшему. Если больше никто не нажимал — кнопки снова открыты:
  // пока вопрос не дочитан, ведущий читает дальше (без отсчёта), иначе — время на обдумывание.
  continueAfterWrong(q) {
    const g = this.game.settings
    const b = this.game.state.buzzer
    const next = g.hQueue ? rankPresses(b.presses.filter((p) => !b.lockedOut.includes(p.competitorId)))[0] : null
    if (next) {
      b.status = 'answering'
      b.winner = { playerId: next.playerId, competitorId: next.competitorId, t: next.t, reaction: next.t - (next.start ?? b.armedAt ?? next.t) }
      q.responderId = next.competitorId
      q.step = 'answering'
      this.game.startTimer('answer', g.hNextTime)
      this.game.log(`Право ответа переходит: ${this.game.competitorName(next.competitorId)}`)
      this.game.emitEvent('buzzWinner', { competitorId: next.competitorId, playerId: next.playerId, next: true })
      return true
    }
    if (this.game.eligibleCompetitors().length === 0) return false
    q.responderId = null
    const at = this.game.armBuzzer()
    if (q.read) {
      q.step = 'buzzing'
      this.game.startTimer('buzz', g.hQueue ? g.hNextTime : g.hBuzzTime, at)
    } else {
      q.step = 'reading'
    }
    this.game.emitEvent('armed', { at, again: true })
    return true
  }

  // ───────────── действия игроков ─────────────

  playerAction(playerId, name, a) {
    if (name !== 'strike') return super.playerAction(playerId, name, a)
    if (this.game.state.stage !== 'game') throw new GameError('Игра ещё не началась')
    const cid = this.game.competitorOf(playerId)
    if (!cid) throw new GameError('Сначала выберите команду')
    if (!this.canStrike(cid, playerId)) throw new GameError('Сейчас убирает тему другая команда')
    return this.strike(Number(a.index), cid)
  }

  // Убрать тему может капитан или игрок персонального раунда той команды, чья сейчас очередь.
  canStrike(cid, playerId) {
    if (this.s.stage !== 'strike' || this.strikeTurn() !== cid) return false
    if (!this.game.settings.teamMode) return cid === playerId
    return this.game.captainOf(cid) === playerId || this.leaderOf(cid) === playerId
  }

  // ───────────── представления ─────────────

  view(role) {
    const v = super.view(role)
    if (!v) return v
    const s = this.s
    const ri = s.roundIndex
    const struck = s.stage === 'strike' && s.strike ? s.strike.removed : s.struck?.[ri] ?? []
    return {
      ...v,
      roundNumber: this.round(ri)?.type === 'final' ? 5 : this.roundNumber(ri),
      board: v.board ? v.board.map((t, ti) => ({ ...t, struck: struck.includes(ti) })) : null,
      strike: s.stage === 'strike' && s.strike ? { order: s.strike.order, turn: s.strike.turn, current: this.strikeTurn(), removed: s.strike.removed } : null,
    }
  }

  meView(cid, playerId) {
    const me = super.meView(cid, playerId)
    return { ...me, canStrike: !!cid && this.canStrike(cid, playerId) }
  }
}
