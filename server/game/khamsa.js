// Режим «Хамса» — командная игра, придуманная в Азербайджане (Фаик Гусейнов, 2006) на основе «Эрудит-квартета».
// Всё построено на числе пять: в команде 5 игроков, в игре 5 раундов, в раунде 5 тем по 5 вопросов.
//
//   1. Явный раунд     — темы объявлены заранее, капитан за минуту расставляет игроков по темам (100–500).
//   2. Полуявный раунд — тема объявляется перед игрой, капитан за 20 секунд выбирает игрока (200–1000).
//   3. Тайный раунд    — капитан заранее ставит игроков на темы, не зная их названий (300–1500).
//   4. Четвёртый раунд — капитан выбирает одного игрока; команды по очереди (от меньшего счёта к большему)
//      вычёркивают темы, оставшуюся тему играют выбранные игроки (400–2000).
//   5. Раунд «Хамса»   — один сложный вопрос для всей команды: играют команды с положительным счётом,
//      ставка — от 1 до всех набранных очков, минута на обсуждение и 10 секунд на запись ответа.
//
// Нажатие до конца вопроса — фальстарт: игрок теряет право ответа. На ответ — 3 секунды. После неверного
// ответа право ответа переходит к следующему нажавшему (5 секунд на обдумывание). Ошибка — минус стоимость.
//
// Ход тем и вопросов, выбор игроков капитанами и раунд со ставками — общие со спортивной «Своей игрой».
// Вопросы ведущий читает с листа: программа знает только скелет игры (раунды, темы, стоимость вопросов).

import { JeopardyMode } from './jeopardy.js'
import { rankPresses } from './buzzer.js'
import { GameError } from './util.js'

export const KHAMSA_KINDS = ['open', 'semi', 'closed', 'leaders']
const KIND_NAME = { open: 'явный', semi: 'полуявный', closed: 'тайный', leaders: 'четвёртый', khamsa: '«Хамса»' }
const ROUND_NAME = { open: 'Явный раунд', semi: 'Полуявный раунд', closed: 'Тайный раунд', leaders: 'Четвёртый раунд' }

export class KhamsaMode extends JeopardyMode {
  constructor(game) {
    super(game)
    this.commands['j.strike'] = (a) => this.hostStrike(Number(a.index))
  }

  static initialState() {
    return {
      ...JeopardyMode.initialState(),
      leaders: {}, // игрок 4-го раунда: номер раунда → команда → игрок
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

  // Настройки «Хамсы» поверх общих правил спортивного формата.
  get settings() {
    const g = this.game.settings
    return {
      ...g,
      jFormat: 'sport',
      jTableMode: 'one',
      jOnePerPlayer: true,
      jSpecials: false,
      jAssignRoundTime: g.hAssignRoundTime,
      jAssignThemeTime: g.hAssignThemeTime,
      jBuzzTime: g.hBuzzTime,
      jAnswerTime: g.hAnswerTime,
      jWrongPenalty: g.hWrongPenalty,
      jEarlyLockMs: 0,
      jFinalTime: g.hFinalTime,
      jFinalOnlyPositive: true,
      phoneSelect: false,
    }
  }

  isSport() {
    return true
  }

  // Скелет «Хамсы»: четыре раунда по пять тем из пяти вопросов и раунд «Хамса» — один вопрос на ставку.
  structureKey() {
    return JSON.stringify([this.s.kinds, this.s.names])
  }

  buildRounds() {
    const rounds = []
    const seen = {}
    for (let ri = 0; ri < KHAMSA_KINDS.length; ri++) {
      const kind = KHAMSA_KINDS.includes(this.s.kinds?.[ri]) ? this.s.kinds[ri] : KHAMSA_KINDS[ri]
      seen[kind] = (seen[kind] ?? 0) + 1
      rounds.push({
        name: seen[kind] > 1 ? `${ROUND_NAME[kind]} ${seen[kind]}` : ROUND_NAME[kind],
        type: 'normal',
        themes: Array.from({ length: 5 }, (_, ti) => this.buildTheme(ri, ti, 5, () => 0)),
      })
    }
    const ri = rounds.length
    const theme = this.buildTheme(ri, 0, 1, () => 0)
    theme.name = this.themeName(ri, 0, 'Хамса')
    rounds.push({ name: 'Хамса', type: 'final', themes: [theme] })
    return rounds
  }

  // Играются все пять раундов: четыре обычных по порядку, пятый — раунд «Хамса».
  playable(ri) {
    return !!this.round(ri)
  }

  kinds() {
    return KHAMSA_KINDS
  }

  // Номер обычного раунда (без финала): от него зависят стоимость вопросов и вид раунда.
  roundNumber(ri) {
    let n = 0
    for (let i = 0; i <= ri; i++) if (this.rounds()[i] && this.rounds()[i].type !== 'final') n++
    return Math.max(1, n)
  }

  kindOf(ri = this.s.roundIndex) {
    const r = this.round(ri)
    if (r?.type === 'final') return 'khamsa'
    const chosen = this.s.kinds?.[ri]
    if (KHAMSA_KINDS.includes(chosen)) return chosen
    return KHAMSA_KINDS[this.roundNumber(ri) - 1] ?? 'open'
  }

  priceOf(ri, ti, qi) {
    const q = this.rounds()[ri]?.themes[ti]?.questions[qi]
    if (!q) return 0
    return (qi + 1) * this.game.settings.hPriceBase * this.roundNumber(ri)
  }

  // Нажатие до конца вопроса — фальстарт: право ответа на этот вопрос потеряно.
  earlyPolicy() {
    const q = this.s.q
    return this.s.stage === 'question' && q?.step === 'reading' ? 'falseStart' : 'ignore'
  }

  sanitize() {
    super.sanitize()
    const s = this.s
    for (const key of ['leaders', 'struck', 'chosen']) if (!s[key] || typeof s[key] !== 'object' || Array.isArray(s[key])) s[key] = {}
    const st = s.strike
    if (!st || !Array.isArray(st.order) || !Array.isArray(st.removed) || !Number.isInteger(st.turn)) s.strike = null
    if (s.stage === 'strike' && !s.strike) s.stage = 'board'
  }

  // ───────────── раунды ─────────────

  enterRound(index) {
    const r = this.round(index)
    if (!r) throw new GameError('Нет такого раунда')
    const s = this.s
    s.roundIndex = index
    s.q = null
    s.themeIndex = null
    s.phase = null
    s.strike = null
    this.game.stopTimers()
    this.game.setBuzzer('off')
    if (r.type === 'final') {
      this.startFinal()
      return
    }
    s.final = null
    if (this.roundComplete(index)) {
      s.stage = 'roundEnd'
      return
    }
    s.stage = 'board'
    const kind = this.kindOf(index)
    if (kind === 'leaders') {
      this.startLeaders()
      return
    }
    if (this.tablePlay() && (kind === 'open' || kind === 'closed') && !this.roundHasAssignments(index)) {
      this.startAssign('round')
    }
  }

  // В четвёртом раунде играется одна тема — оставшаяся после вычёркивания.
  roundComplete(ri) {
    if (this.round(ri)?.type !== 'final' && this.kindOf(ri) === 'leaders') {
      const chosen = this.s.chosen?.[ri]
      return Number.isInteger(chosen) && this.themeComplete(ri, chosen)
    }
    return super.roundComplete(ri)
  }

  nextThemeIndex() {
    const ri = this.s.roundIndex
    if (this.kindOf(ri) === 'leaders') {
      const chosen = this.s.chosen?.[ri]
      return Number.isInteger(chosen) && !this.themeComplete(ri, chosen) ? chosen : null
    }
    return super.nextThemeIndex()
  }

  themeVisible(ri, ti) {
    // Темы четвёртого раунда видны всем — их вычёркивают.
    if (this.kindOf(ri) === 'leaders') return true
    return super.themeVisible(ri, ti)
  }

  // ───────────── четвёртый раунд: игрок от команды и вычёркивание тем ─────────────

  leaderOf(teamId, ri = this.s.roundIndex) {
    const pid = this.s.leaders?.[ri]?.[teamId]
    const p = pid ? this.game.player(pid) : null
    return p && p.teamId === teamId ? p.id : this.game.captainOf(teamId)
  }

  tablePlayer(teamId, ri, ti) {
    if (!this.tablePlay()) return null
    if (this.kindOf(ri) === 'leaders') return this.leaderOf(teamId, ri)
    return super.tablePlayer(teamId, ri, ti)
  }

  startLeaders() {
    const s = this.s
    const ri = s.roundIndex
    if (Number.isInteger(s.chosen?.[ri])) {
      s.stage = 'board'
      return
    }
    const picked = Object.keys(s.leaders?.[ri] ?? {}).length > 0
    if (this.tablePlay() && !picked && this.teamsWithPlayers().length) {
      this.game.stopTimers()
      this.game.setBuzzer('off')
      s.stage = 'assign'
      s.phase = { scope: 'leader', themes: [], ready: [] }
      this.game.startTimer('assign', this.game.settings.hAssignRoundTime)
      this.game.log(`Раунд «${this.round().name}»: капитаны выбирают игрока`)
      this.game.emitEvent('assignStart', { scope: 'leader' })
      return
    }
    this.startStrike()
  }

  // Капитан выбирает игрока четвёртого раунда (тема в запросе не нужна — пишем её как -1).
  setAssignment(teamId, ti, playerId, byCaptain) {
    const s = this.s
    if (this.kindOf(s.roundIndex) !== 'leaders') return super.setAssignment(teamId, ti, playerId, byCaptain)
    if (!this.tablePlay()) throw new GameError('Сейчас играет вся команда — выбирать игрока не нужно')
    if (!this.game.team(teamId)) throw new GameError('Команда не найдена')
    const p = this.game.player(playerId)
    if (!p || p.teamId !== teamId) throw new GameError('Игрок не в этой команде')
    if (byCaptain) {
      if (s.stage !== 'assign' || s.phase?.scope !== 'leader') throw new GameError('Сейчас нельзя выбрать игрока')
      if (s.phase.ready.includes(teamId)) throw new GameError('Выбор уже подтверждён')
    }
    const ri = s.roundIndex
    if (!s.leaders[ri]) s.leaders[ri] = {}
    s.leaders[ri][teamId] = p.id
  }

  finishAssign() {
    const s = this.s
    if (s.stage !== 'assign' || s.phase?.scope !== 'leader') return super.finishAssign()
    this.game.stopTimer('assign')
    s.phase = null
    this.game.emitEvent('assignDone', { scope: 'leader' })
    const chosen = s.chosen?.[s.roundIndex]
    if (Number.isInteger(chosen)) this.enterTheme(chosen)
    else this.startStrike()
    return true
  }

  hostAssign(teamId, ti, playerId) {
    if (this.kindOf() !== 'leaders') return super.hostAssign(teamId, ti, playerId)
    this.game.pushUndo('Игрок четвёртого раунда')
    this.setAssignment(teamId, ti, playerId, false)
    this.game.log(`${this.game.competitorName(teamId)}: четвёртый раунд играет ${this.game.player(playerId).name}`)
    return true
  }

  // Ведущий заново запускает выбор игрока четвёртого раунда (например, если кто-то ушёл).
  restartAssign() {
    const s = this.s
    const ri = s.roundIndex
    if (this.kindOf(ri) !== 'leaders') return super.restartAssign()
    if (!this.tablePlay()) throw new GameError('Выбирать игрока нужно только в командной игре')
    const chosen = s.chosen?.[ri]
    if (Number.isInteger(chosen) && this.themeQuestionIds(ri, chosen).some((id) => s.played.includes(id))) {
      throw new GameError('Тема четвёртого раунда уже играется')
    }
    if (!['board', 'assign', 'strike', 'theme'].includes(s.stage)) throw new GameError('Сначала закончите вопрос')
    this.game.pushUndo('Выбор игроков')
    if (s.leaders) delete s.leaders[ri]
    this.game.stopTimers()
    this.game.setBuzzer('off')
    s.strike = null
    s.stage = 'assign'
    s.phase = { scope: 'leader', themes: [], ready: [] }
    this.game.startTimer('assign', this.game.settings.hAssignRoundTime)
    this.game.emitEvent('assignStart', { scope: 'leader' })
    return true
  }

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
    this.game.log('Команды по очереди убирают темы четвёртого раунда')
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

  // Право ответа переходит к следующему нажавшему; если больше никто не нажимал — кнопки открываются снова.
  continueAfterWrong(q) {
    if (!this.game.settings.hQueue) return super.continueAfterWrong(q)
    const b = this.game.state.buzzer
    const next = rankPresses(b.presses.filter((p) => !b.lockedOut.includes(p.competitorId)))[0]
    if (next) {
      b.status = 'answering'
      b.winner = { playerId: next.playerId, competitorId: next.competitorId, t: next.t, reaction: next.t - (b.armedAt ?? next.t) }
      q.responderId = next.competitorId
      q.step = 'answering'
      this.game.startTimer('answer', this.game.settings.hNextTime)
      this.game.log(`Право ответа переходит: ${this.game.competitorName(next.competitorId)}`)
      this.game.emitEvent('buzzWinner', { competitorId: next.competitorId, playerId: next.playerId, next: true })
      return true
    }
    if (this.game.eligibleCompetitors().length === 0) return false
    q.responderId = null
    q.step = 'buzzing'
    const at = this.game.armBuzzer()
    this.game.startTimer('buzz', this.game.settings.hNextTime, at)
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

  // Убрать тему может капитан или игрок четвёртого раунда той команды, чья сейчас очередь.
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
    const leaders = {}
    if (this.tablePlay() && this.kindOf(ri) === 'leaders') {
      const hidden = s.stage === 'assign' && role !== 'host'
      for (const t of this.teamsWithPlayers()) if (!hidden) leaders[t.id] = this.playerRef(this.leaderOf(t.id, ri))
    }
    return {
      ...v,
      format: 'khamsa',
      roundNumber: this.round(ri)?.type === 'final' ? 5 : this.roundNumber(ri),
      board: v.board ? v.board.map((t, ti) => ({ ...t, struck: struck.includes(ti) })) : null,
      strike: s.stage === 'strike' && s.strike ? { order: s.strike.order, turn: s.strike.turn, current: this.strikeTurn(), removed: s.strike.removed } : null,
      leaders,
    }
  }

  meView(cid, playerId) {
    const me = super.meView(cid, playerId)
    const s = this.s
    const ri = s.roundIndex
    const r = this.round(ri)
    let isLeader = false
    if (r && r.type !== 'final' && this.tablePlay() && cid && this.game.team(cid) && this.kindOf(ri) === 'leaders') {
      // Игрок четвёртого раунда играет одну тему — ту, что осталась после вычёркивания. Пока капитаны выбирают, выбор скрыт.
      isLeader = s.stage !== 'assign' && this.leaderOf(cid, ri) === playerId
      const chosen = s.chosen?.[ri]
      me.myThemes = isLeader && Number.isInteger(chosen) && !this.themeComplete(ri, chosen) ? [{ index: chosen, name: r.themes[chosen]?.name ?? null }] : []
    }
    // Капитан выбирает одного игрока на четвёртый раунд.
    if (me.isCaptain && s.stage === 'assign' && s.phase?.scope === 'leader') {
      const leader = s.leaders?.[ri]?.[cid]
      me.captain = {
        themes: [{ index: -1, name: 'Кто играет четвёртый раунд' }],
        members: this.game.teamMembers(cid).map((p) => ({ id: p.id, name: p.name, played: false })),
        picks: leader ? { '-1': leader } : {},
        ready: s.phase.ready.includes(cid),
        unique: false,
      }
    }
    return { ...me, isLeader, canStrike: !!cid && this.canStrike(cid, playerId) }
  }
}

export { KIND_NAME as KHAMSA_KIND_NAME }
