// Режим «Своя игра» в двух форматах.
//
// Спортивный (по умолчанию) — по правилам «Эрудит-квартета»: раунд состоит из тем по 5 вопросов
// (10, 20, 30, 40, 50 очков), вопросы темы идут подряд, за верный ответ очки начисляются, за неверный — снимаются.
// От каждой команды тему играет один игрок, нажимать кнопку может только он. Виды раундов:
//   открытый     — темы раунда объявлены заранее, капитаны сразу распределяют игроков по темам;
//   полуоткрытый — тема объявляется перед игрой, капитан за 20 секунд выбирает, кто её играет;
//   закрытый     — капитаны заранее ставят игроков на темы, не зная их названий;
//   командирский — тему играют капитаны команд.
// Телевизионный — как в передаче: табло тем и цен, спецвопросы (кот в мешке, аукцион, без риска), финал со ставками.
//
// Вопросы ведущий читает с листа (например, из документа Word), поэтому программа знает только «скелет» игры:
// сколько раундов, тем и вопросов и сколько стоит каждый вопрос. Скелет строится из настроек; названия тем
// ведущий может вписать сам, а спецвопрос — отметить, когда дойдёт до него в своём листе.

import { GameError, cleanText } from './util.js'

const Q_TYPES = ['normal', 'cat', 'auction', 'norisk']
const TYPE_LABEL = { cat: 'кот в мешке', auction: 'аукцион', norisk: 'вопрос без риска' }
export const KINDS = ['open', 'semi', 'closed', 'captain']
export const KIND_LABEL = { open: 'открытый', semi: 'полуоткрытый', closed: 'закрытый', captain: 'командирский' }
const KIND_ROUND_NAME = { open: 'Открытый раунд', semi: 'Полуоткрытый раунд', closed: 'Закрытый раунд', captain: 'Командирский раунд' }
const PRICE_STEP = { x10: 10, x1: 1, x100: 100 }
const STAGES = ['board', 'assign', 'strike', 'theme', 'question', 'roundEnd', 'final', 'results']

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
      'j.special': (a) => this.markSpecial(a.type),
      'j.theme.name': (a) => this.renameTheme(Number(a.round), Number(a.theme), a.name),
      // спортивный формат
      'j.theme': (a) => this.startTheme(Number(a.index)),
      'j.next': () => this.next(),
      'j.kind': (a) => this.setKind(a.kind),
      'j.assign.start': () => this.restartAssign(),
      'j.assign.set': (a) => this.hostAssign(a.teamId, Number(a.themeIndex), a.playerId),
      'j.assign.done': () => this.assignDone(),
    }
  }

  static initialState() {
    return {
      roundIndex: 0,
      played: [],
      chooserId: null,
      stage: 'board',
      q: null,
      final: null,
      // спортивный формат
      themeIndex: null, // тема, которая играется сейчас
      kinds: {}, // вид раунда, выбранный ведущим: номер раунда → open | semi | closed | captain
      assign: {}, // кто играет тему: номер раунда → команда → номер темы → игрок
      phase: null, // выбор игроков капитанами: { scope: 'round' | 'theme', themes: [...], ready: [командыготовы] }
      names: {}, // названия тем, вписанные ведущим: номер раунда → номер темы → название
    }
  }

  get s() {
    return this.game.state.jeopardy
  }

  get settings() {
    return this.game.settings
  }

  // Скелет игры (раунды → темы → вопросы со стоимостью). Пересобирается, только когда меняются настройки
  // или названия тем.
  rounds() {
    const key = this.structureKey()
    if (this.struct?.key !== key) this.struct = { key, rounds: this.buildRounds() }
    return this.struct.rounds
  }

  structureKey() {
    const st = this.settings
    return JSON.stringify([st.jFormat, st.jRounds, st.jThemes, st.jQuestions, st.jFinal, this.s.kinds, this.s.names])
  }

  themeName(ri, ti, fallback) {
    const name = this.s.names?.[ri]?.[ti]
    return typeof name === 'string' && name ? name : fallback
  }

  buildTheme(ri, ti, count, priceOf) {
    return {
      name: this.themeName(ri, ti, `Тема ${ti + 1}`),
      named: !!this.s.names?.[ri]?.[ti],
      questions: Array.from({ length: count }, (_, qi) => ({ price: priceOf(qi), type: 'normal' })),
    }
  }

  buildRounds() {
    const st = this.settings
    const sport = st.jFormat === 'sport'
    const rounds = []
    const seen = {}
    for (let ri = 0; ri < st.jRounds; ri++) {
      let name = `Раунд ${ri + 1}`
      if (sport) {
        // В спортивном формате раунд называется по виду: открытый, полуоткрытый, закрытый, командирский.
        const kind = KINDS.includes(this.s.kinds?.[ri]) ? this.s.kinds[ri] : KINDS[ri % KINDS.length]
        seen[kind] = (seen[kind] ?? 0) + 1
        name = seen[kind] > 1 ? `${KIND_ROUND_NAME[kind]} ${seen[kind]}` : KIND_ROUND_NAME[kind]
      }
      const themes = Array.from({ length: st.jThemes }, (_, ti) => this.buildTheme(ri, ti, st.jQuestions, (qi) => (qi + 1) * 100 * (ri + 1)))
      rounds.push({ name, type: 'normal', themes })
    }
    // Финал со ставками — только в телевизионном формате.
    if (!sport && st.jFinal) {
      const ri = rounds.length
      rounds.push({ name: 'Финал', type: 'final', themes: [this.buildTheme(ri, 0, 1, () => 0)] })
      rounds[ri].themes[0].name = this.themeName(ri, 0, 'Финал')
    }
    return rounds
  }

  // Ведущий вписывает название темы из своего листа (пустое название — вернуть «Тема N»).
  renameTheme(ri, ti, name) {
    const theme = this.rounds()[ri]?.themes[ti]
    if (!theme) throw new GameError('Тема не найдена')
    const clean = cleanText(name, 60)
    const names = this.s.names ?? (this.s.names = {})
    const row = names[ri] ?? (names[ri] = {})
    if (clean) row[ti] = clean
    else delete row[ti]
    if (!Object.keys(row).length) delete names[ri]
    return true
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
    s.names = isPlainObject(s.names) ? s.names : {}
    for (const [ri, row] of Object.entries(s.names)) {
      if (!isPlainObject(row)) delete s.names[ri]
      else for (const [ti, name] of Object.entries(row)) if (typeof name !== 'string' || !name) delete row[ti]
    }
    if (!Number.isInteger(s.roundIndex) || !this.round(s.roundIndex)) s.roundIndex = 0
    s.played = Array.isArray(s.played) ? s.played.filter((id) => this.find(id)) : []
    if (!STAGES.includes(s.stage)) s.stage = 'board'
    s.kinds = isPlainObject(s.kinds) ? Object.fromEntries(Object.entries(s.kinds).filter(([, k]) => this.kinds().includes(k))) : {}
    s.assign = isPlainObject(s.assign) ? s.assign : {}
    for (const [ri, teams] of Object.entries(s.assign)) {
      if (!isPlainObject(teams)) delete s.assign[ri]
      else for (const [tid, map] of Object.entries(teams)) if (!isPlainObject(map)) delete teams[tid]
    }
    if (!Number.isInteger(s.themeIndex) || !this.round()?.themes[s.themeIndex]) s.themeIndex = null
    const ph = s.phase
    if (!isPlainObject(ph) || !['round', 'theme'].includes(ph.scope) || !Array.isArray(ph.themes) || !Array.isArray(ph.ready)) {
      s.phase = null
    }
    if (s.stage === 'assign' && !s.phase) s.stage = 'board'
    if (s.stage === 'theme' && s.themeIndex == null) s.stage = 'board'
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
    if (!this.playableRounds().length) return 'В игре нет раундов — проверьте настройки'
    return null
  }

  // ───────────── спортивный формат: общие правила ─────────────

  isSport() {
    return this.settings.jFormat === 'sport'
  }

  // Финальный раунд со ставками играется только в телевизионном формате.
  playable(ri) {
    const r = this.round(ri)
    return !!r && (!this.isSport() || r.type !== 'final')
  }

  playableRounds() {
    return this.rounds()
      .map((_, i) => i)
      .filter((i) => this.playable(i))
  }

  // Виды раундов, которые может выбрать ведущий.
  kinds() {
    return KINDS
  }

  // Вид раунда: выбранный ведущим или по порядку — открытый, полуоткрытый, закрытый, командирский.
  kindOf(ri = this.s.roundIndex) {
    const chosen = this.s.kinds?.[ri]
    if (KINDS.includes(chosen)) return chosen
    const pos = Math.max(0, this.playableRounds().indexOf(ri))
    return KINDS[pos % KINDS.length]
  }

  // За столом по одному игроку от команды (иначе нажимать может любой участник команды).
  tablePlay() {
    return this.isSport() && this.settings.teamMode && this.settings.jTableMode === 'one'
  }

  priceOf(ri, ti, qi) {
    const q = this.rounds()[ri]?.themes[ti]?.questions[qi]
    if (!q) return 0
    if (!this.isSport()) return q.price
    return (qi + 1) * PRICE_STEP[this.settings.jPrices]
  }

  // Спецвопросы (кот в мешке, аукцион, без риска): в телевизионном формате всегда, в спортивном — если включены.
  specialsAllowed() {
    return !this.isSport() || this.settings.jSpecials
  }

  themeQuestionIds(ri, ti) {
    const theme = this.rounds()[ri]?.themes[ti]
    return theme ? theme.questions.map((_, qi) => `${ri}:${ti}:${qi}`) : []
  }

  themeComplete(ri, ti) {
    return this.themeQuestionIds(ri, ti).every((id) => this.s.played.includes(id))
  }

  themeStarted(ri, ti) {
    const s = this.s
    return (ri === s.roundIndex && ti === s.themeIndex) || this.themeQuestionIds(ri, ti).some((id) => s.played.includes(id))
  }

  // Видят ли игроки и зрители название темы: в полуоткрытом и закрытом раундах — только когда тема началась.
  themeVisible(ri, ti) {
    if (!this.isSport()) return true
    const kind = this.kindOf(ri)
    return kind === 'open' || kind === 'captain' || this.themeStarted(ri, ti)
  }

  nextThemeIndex() {
    const r = this.round()
    if (!r) return null
    const i = r.themes.findIndex((_, ti) => !this.themeComplete(this.s.roundIndex, ti))
    return i >= 0 ? i : null
  }

  // ───────────── спортивный формат: кто за столом ─────────────

  teamsWithPlayers() {
    return this.game.state.teams.filter((t) => this.game.teamMembers(t.id).length > 0)
  }

  roundAssign(ri) {
    if (!this.s.assign[ri]) this.s.assign[ri] = {}
    return this.s.assign[ri]
  }

  assignedPlayer(teamId, ri, ti) {
    const pid = this.s.assign?.[ri]?.[teamId]?.[ti]
    const p = pid ? this.game.player(pid) : null
    return p && p.teamId === teamId ? p.id : null
  }

  // Игрок команды, который играет тему (в командирском раунде — капитан; если никого не выбрали — тоже капитан).
  tablePlayer(teamId, ri, ti) {
    if (!this.tablePlay()) return null
    if (this.kindOf(ri) === 'captain') return this.game.captainOf(teamId)
    return this.assignedPlayer(teamId, ri, ti) ?? this.game.captainOf(teamId)
  }

  // Каждый играет не больше одной темы за раунд, если игроков в команде хватает на все темы.
  uniqueRequired(teamId, ri) {
    if (!this.settings.jOnePerPlayer) return false
    return this.game.teamMembers(teamId).length >= (this.round(ri)?.themes.length ?? 0)
  }

  setAssignment(teamId, ti, playerId, byCaptain) {
    const s = this.s
    const ri = s.roundIndex
    if (!this.tablePlay()) throw new GameError('Сейчас тему играет вся команда — выбирать игрока не нужно')
    if (this.kindOf(ri) === 'captain') throw new GameError('В командирском раунде играют капитаны')
    if (!this.game.team(teamId)) throw new GameError('Команда не найдена')
    const theme = this.round(ri)?.themes[ti]
    if (!theme) throw new GameError('Тема не найдена')
    const p = this.game.player(playerId)
    if (!p || p.teamId !== teamId) throw new GameError('Игрок не в этой команде')
    if (byCaptain) {
      if (s.stage !== 'assign' || !s.phase?.themes.includes(ti)) throw new GameError('Сейчас нельзя выбрать игрока на эту тему')
      if (s.phase.ready.includes(teamId)) throw new GameError('Выбор уже подтверждён')
    }
    const teams = this.roundAssign(ri)
    const map = teams[teamId] ?? (teams[teamId] = {})
    if (this.uniqueRequired(teamId, ri)) {
      const other = Object.keys(map).find((t) => map[t] === p.id && Number(t) !== ti)
      if (other !== undefined) {
        if (this.themeStarted(ri, Number(other))) throw new GameError(`${p.name} уже играл(а) тему в этом раунде`)
        delete map[other] // игрок переходит на новую тему, прежняя освобождается
      }
    }
    map[ti] = p.id
  }

  // Кого не выбрали — назначаем сами: сначала тех, кто ещё не играл в этом раунде (капитана — последним).
  fillAssignments(ri, themes) {
    for (const team of this.teamsWithPlayers()) {
      const members = this.game.teamMembers(team.id)
      const teams = this.roundAssign(ri)
      const map = teams[team.id] ?? (teams[team.id] = {})
      const captain = this.game.captainOf(team.id)
      for (const ti of themes) {
        if (this.assignedPlayer(team.id, ri, ti)) continue
        const used = new Map()
        for (const pid of Object.values(map)) used.set(pid, (used.get(pid) ?? 0) + 1)
        const pick = [...members].sort(
          (a, b) => (used.get(a.id) ?? 0) - (used.get(b.id) ?? 0) || Number(a.id === captain) - Number(b.id === captain),
        )[0]
        map[ti] = pick.id
      }
    }
  }

  themeAssignedAll(ri, ti) {
    return this.teamsWithPlayers().every((t) => this.assignedPlayer(t.id, ri, ti))
  }

  roundHasAssignments(ri) {
    return Object.values(this.s.assign?.[ri] ?? {}).some((map) => Object.keys(map).length > 0)
  }

  // Капитаны выбирают игроков: на все оставшиеся темы раунда (открытый, закрытый) или на одну тему (полуоткрытый).
  startAssign(scope, themeIndex = null) {
    const s = this.s
    const ri = s.roundIndex
    const r = this.round(ri)
    if (!r) return false
    const themes =
      scope === 'round'
        ? r.themes.map((_, i) => i).filter((i) => !this.themeStarted(ri, i))
        : [themeIndex].filter((i) => Number.isInteger(i) && r.themes[i])
    if (!themes.length || !this.teamsWithPlayers().length) return false
    this.game.stopTimers()
    this.game.setBuzzer('off')
    s.q = null
    s.stage = 'assign'
    s.phase = { scope, themes, ready: [] }
    if (scope === 'theme') s.themeIndex = themes[0] // тема объявлена — её название видно всем
    this.game.startTimer('assign', scope === 'round' ? this.settings.jAssignRoundTime : this.settings.jAssignThemeTime)
    this.game.log(
      scope === 'round'
        ? `Раунд «${r.name}»: капитаны распределяют игроков по темам`
        : `Тема «${r.themes[themes[0]].name}»: капитаны выбирают игрока`,
    )
    this.game.emitEvent('assignStart', { scope })
    return true
  }

  finishAssign() {
    const s = this.s
    if (s.stage !== 'assign' || !s.phase) return false
    const { scope, themes } = s.phase
    this.fillAssignments(s.roundIndex, themes)
    this.game.stopTimer('assign')
    s.phase = null
    this.game.emitEvent('assignDone', { scope })
    if (scope === 'theme') this.enterTheme(themes[0])
    else s.stage = 'board'
    return true
  }

  enterTheme(ti) {
    const s = this.s
    s.themeIndex = ti
    s.q = null
    s.stage = 'theme'
    this.game.stopTimers()
    this.game.setBuzzer('off')
    this.game.log(`Тема: «${this.round().themes[ti].name}»`)
    this.game.emitEvent('theme', { index: ti })
  }

  needSport() {
    if (!this.isSport()) throw new GameError('Это действие есть только в спортивном формате')
  }

  startTheme(ti) {
    this.needSport()
    const s = this.s
    const between = ['board', 'theme', 'roundEnd'].includes(s.stage) || (s.stage === 'question' && s.q?.step === 'reveal')
    if (!between) throw new GameError('Сначала закончите текущий вопрос')
    if (!Number.isInteger(ti) || !this.round()?.themes[ti]) throw new GameError('Тема не найдена')
    this.game.pushUndo('Начало темы')
    if (this.tablePlay() && this.kindOf() === 'semi' && !this.themeAssignedAll(s.roundIndex, ti)) {
      this.startAssign('theme', ti)
    } else {
      this.enterTheme(ti)
    }
    return true
  }

  // «Дальше»: следующий вопрос темы → обзор тем → следующая тема → следующий раунд.
  next() {
    this.needSport()
    const s = this.s
    const ri = s.roundIndex
    if (s.stage === 'assign') return this.assignDone()
    if (s.stage === 'roundEnd') return this.nextRound()
    if (s.stage === 'question') {
      if (!s.q || s.q.step !== 'reveal') throw new GameError('Сначала закончите вопрос')
      const ti = this.find(s.q.id)?.ti
      if (ti != null && !this.themeComplete(ri, ti)) return this.selectNextInTheme(ti)
      this.game.pushUndo('Тема сыграна')
      s.q = null
      this.game.stopTimers()
      this.game.setBuzzer('off')
      s.themeIndex = null
      s.stage = this.roundComplete(ri) ? 'roundEnd' : 'board'
      this.game.emitEvent('board')
      return true
    }
    if (s.stage === 'theme') {
      if (s.themeIndex != null && !this.themeComplete(ri, s.themeIndex)) return this.selectNextInTheme(s.themeIndex)
      s.stage = 'board'
    }
    if (s.stage === 'board') {
      const ti = s.themeIndex != null && !this.themeComplete(ri, s.themeIndex) ? s.themeIndex : this.nextThemeIndex()
      if (ti == null) {
        this.game.pushUndo('Раунд окончен')
        s.stage = 'roundEnd'
        return true
      }
      return this.startTheme(ti)
    }
    throw new GameError('Сейчас нельзя перейти дальше')
  }

  selectNextInTheme(ti) {
    const ri = this.s.roundIndex
    const id = this.themeQuestionIds(ri, ti).find((x) => !this.s.played.includes(x))
    if (!id) throw new GameError('В теме не осталось вопросов')
    return this.select(id)
  }

  setKind(kind) {
    this.needSport()
    if (!this.kinds().includes(kind)) throw new GameError('Неизвестный вид раунда')
    const s = this.s
    const ri = s.roundIndex
    if (this.kindOf(ri) === kind) return true
    this.game.pushUndo('Вид раунда')
    s.kinds = { ...s.kinds, [ri]: kind }
    this.game.log(`Раунд «${this.round().name}» — ${KIND_LABEL[kind]}`)
    // Раунд ещё не начался — распределяем игроков заново по правилам нового вида.
    const started = this.roundQuestionIds(ri).some((id) => s.played.includes(id))
    if (!started && ['board', 'assign', 'theme'].includes(s.stage)) {
      delete s.assign[ri]
      this.enterRound(ri)
    }
    return true
  }

  // Ведущий заново запускает выбор игроков (например, после замены в команде).
  restartAssign() {
    this.needSport()
    const s = this.s
    if (!this.tablePlay()) throw new GameError('Выбор игроков нужен только в командной игре «один игрок от команды»')
    if (this.kindOf() === 'captain') throw new GameError('В командирском раунде играют капитаны')
    if (!['board', 'theme', 'assign'].includes(s.stage)) throw new GameError('Сначала закончите вопрос')
    this.game.pushUndo('Выбор игроков')
    const scope = this.kindOf() === 'semi' ? 'theme' : 'round'
    const ti = s.themeIndex ?? this.nextThemeIndex()
    if (!this.startAssign(scope, ti)) throw new GameError('Не осталось тем для выбора игроков')
    return true
  }

  hostAssign(teamId, ti, playerId) {
    this.needSport()
    this.game.pushUndo('Смена игрока за столом')
    this.setAssignment(teamId, ti, playerId, false)
    const p = this.game.player(playerId)
    this.game.log(`${this.game.competitorName(teamId)}: тему «${this.round().themes[ti].name}» играет ${p.name}`)
    return true
  }

  assignDone() {
    this.needSport()
    if (this.s.stage !== 'assign') throw new GameError('Сейчас игроков не выбирают')
    this.game.pushUndo('Выбор игроков завершён')
    return this.finishAssign()
  }

  // Нажимать может только игрок команды, который сидит за столом в этой теме.
  buzzDenied(cid, playerId) {
    if (!this.tablePlay()) return null
    const s = this.s
    if (s.stage !== 'question' || !s.q) return null
    const f = this.find(s.q.id)
    if (!f) return null
    const allowed = this.tablePlayer(cid, f.ri, f.ti)
    return allowed && allowed !== playerId ? 'notAtTable' : null
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

  // Вызывается при старте игры, смене режима или формата игры.
  start() {
    const s = this.s
    if (!s.chooserId || !this.game.competitor(s.chooserId)) s.chooserId = this.randomCompetitor()
    if (s.stage === 'results') {
      this.game.stopTimers()
      this.game.setBuzzer('off')
      return
    }
    this.enterRound(this.playable(s.roundIndex) ? s.roundIndex : (this.playableRounds()[0] ?? 0))
  }

  enterRound(index) {
    const r = this.round(index)
    if (!r) throw new GameError('Нет такого раунда')
    const s = this.s
    s.roundIndex = index
    s.q = null
    s.themeIndex = null
    s.phase = null
    this.game.stopTimers()
    this.game.setBuzzer('off')
    if (this.isSport()) {
      s.final = null
      if (this.roundComplete(index)) {
        s.stage = 'roundEnd'
        return
      }
      s.stage = 'board'
      // Открытый и закрытый раунды начинаются с распределения игроков по темам.
      const kind = this.kindOf(index)
      if (this.tablePlay() && (kind === 'open' || kind === 'closed') && !this.roundHasAssignments(index)) {
        this.startAssign('round')
      }
      return
    }
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
    const sport = this.isSport()
    const canNow = sport
      ? ['board', 'theme'].includes(s.stage) || (s.stage === 'question' && s.q?.step === 'reveal')
      : s.stage === 'board'
    if (!canNow && !(force && s.stage === 'roundEnd')) throw new GameError('Сейчас нельзя выбрать вопрос')
    const f = this.find(id)
    if (!f || f.ri !== s.roundIndex || f.round.type === 'final') throw new GameError('Вопрос не найден')
    if (s.played.includes(id) && !force) throw new GameError('Этот вопрос уже сыгран')
    this.game.pushUndo('Выбор вопроса')
    if (!s.played.includes(id)) s.played.push(id)
    if (sport) s.themeIndex = f.ti
    const base = this.priceOf(f.ri, f.ti, f.qi)
    s.stage = 'question'
    s.q = { id, type: 'normal', basePrice: base, price: base, step: 'reading', responderId: null, attempts: [] }
    this.game.stopTimers()
    this.game.openBuzzer()
    this.game.log(`Вопрос: «${f.theme.name}» за ${base}`)
    this.game.emitEvent('questionSelected', { id, type: 'normal' })
    return true
  }

  // Ведущий дошёл в своём листе до спецвопроса и отмечает его, пока кнопки ещё не открыты.
  markSpecial(type) {
    const s = this.s
    const q = s.q
    if (!Q_TYPES.includes(type) || type === 'normal') throw new GameError('Неизвестный вид вопроса')
    if (!this.specialsAllowed()) throw new GameError('Спецвопросы выключены в настройках')
    if (s.stage !== 'question' || !q || q.step !== 'reading' || q.type !== 'normal') {
      throw new GameError('Спецвопрос отмечают до того, как открыты кнопки')
    }
    this.game.pushUndo(`Спецвопрос: ${TYPE_LABEL[type]}`)
    q.type = type
    q.step = 'special'
    q.responderId = null
    this.game.stopTimers()
    this.game.setBuzzer('off')
    this.game.log(`Спецвопрос: ${TYPE_LABEL[type]}`)
    this.game.emitEvent('questionSelected', { id: q.id, type })
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
      if (this.continueAfterWrong(q)) return true
    }
    this.toReveal()
    return true
  }

  // После неверного ответа остальные могут попробовать ответить: кнопки открываются снова.
  // Возвращает false, если отвечать больше некому.
  continueAfterWrong(q) {
    if (this.game.eligibleCompetitors().length === 0) return false
    q.responderId = null
    q.step = 'buzzing'
    const at = this.game.armBuzzer()
    this.game.startTimer('buzz', this.settings.jBuzzTime, at)
    this.game.emitEvent('armed', { at, again: true })
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
    if (s.themeIndex != null && this.themeComplete(s.roundIndex, s.themeIndex)) s.themeIndex = null
    s.stage = this.roundComplete(s.roundIndex) ? 'roundEnd' : 'board'
    this.game.emitEvent('board')
    return true
  }

  goRound(index) {
    if (!Number.isInteger(index) || !this.round(index)) throw new GameError('Нет такого раунда')
    if (!this.playable(index)) throw new GameError('Финальный раунд со ставками есть только в телевизионном формате')
    this.game.pushUndo('Смена раунда')
    const prev = this.s.roundIndex
    this.enterRound(index)
    if (!this.isSport() && index !== prev && this.round(index).type !== 'final' && this.settings.jNewRoundChooser === 'lowest') {
      const low = this.lowestCompetitor()
      if (low) this.s.chooserId = low
    }
    this.game.log(`Раунд: ${this.round(index).name}`)
    this.game.emitEvent('round', { index })
    return true
  }

  nextRound() {
    const next = this.playableRounds().find((i) => i > this.s.roundIndex)
    if (next === undefined) return this.showResults()
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
    this.s.phase = null
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
    }
  }

  needFinal(steps) {
    const f = this.s.final
    const list = Array.isArray(steps) ? steps : [steps]
    if (this.s.stage !== 'final' || !f || !list.includes(f.step)) throw new GameError('Сейчас это действие недоступно')
    return f
  }

  finalTheme() {
    const f = this.s.final
    if (!f || f.themeIndex == null) return null
    return this.round()?.themes[f.themeIndex] ?? null
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
    if (!this.finalTheme()) throw new GameError('Не выбрана тема финала')
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

  // ───────────── действия игроков ─────────────

  playerAction(playerId, name, a) {
    if (this.game.state.stage !== 'game') throw new GameError('Игра ещё не началась')
    const cid = this.game.competitorOf(playerId)
    if (!cid) throw new GameError('Сначала выберите команду')
    switch (name) {
      case 'assign': {
        this.needCaptain(playerId, cid)
        this.setAssignment(cid, Number(a.themeIndex), String(a.playerId ?? ''), true)
        return true
      }
      case 'assignReady': {
        this.needCaptain(playerId, cid)
        const ph = this.s.phase
        if (this.s.stage !== 'assign' || !ph) throw new GameError('Сейчас игроков не выбирают')
        if (!ph.ready.includes(cid)) ph.ready.push(cid)
        this.game.emitEvent('assignReady', { competitorId: cid })
        // Все капитаны подтвердили выбор — не ждём конца времени.
        if (this.teamsWithPlayers().every((t) => ph.ready.includes(t.id))) this.finishAssign()
        return true
      }
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

  needCaptain(playerId, teamId) {
    if (!this.tablePlay()) throw new GameError('Сейчас тему играет вся команда')
    if (this.game.captainOf(teamId) !== playerId) throw new GameError('Выбирать игроков может только капитан команды')
  }

  // ───────────── таймеры ─────────────

  onTimerExpired(name) {
    const s = this.s
    if (name === 'assign' && s.stage === 'assign') {
      this.finishAssign()
      return
    }
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
    const rounds = this.rounds()
    if (!rounds.length) return null
    const r = this.round()
    const ri = s.roundIndex
    const sport = this.isSport()
    return {
      format: sport ? 'sport' : 'tv',
      stage: s.stage,
      roundIndex: ri,
      specials: this.specialsAllowed(),
      rounds: rounds.map((round, i) => ({
        name: round.name,
        type: round.type,
        complete: round.type === 'final' ? false : this.roundComplete(i),
        skip: !this.playable(i),
        kind: sport ? this.kindOf(i) : null,
      })),
      chooserId: s.chooserId,
      kind: sport ? this.kindOf(ri) : null,
      tablePlay: this.tablePlay(),
      themeIndex: sport ? s.themeIndex : null,
      board:
        r && r.type !== 'final'
          ? r.themes.map((t, ti) => {
              const visible = this.themeVisible(ri, ti)
              return {
                name: host || visible ? t.name : null,
                named: t.named,
                hidden: !visible,
                current: sport && ti === s.themeIndex,
                questions: t.questions.map((_, qi) => {
                  const id = `${ri}:${ti}:${qi}`
                  return { id, price: this.priceOf(ri, ti, qi), played: s.played.includes(id) }
                }),
              }
            })
          : null,
      phase: this.phaseView(host),
      table: this.tableView(),
      assign: this.assignView(host),
      question: this.questionView(host),
      final: this.finalView(host),
    }
  }

  playerRef(pid) {
    const p = pid ? this.game.player(pid) : null
    return p ? { playerId: p.id, name: p.name } : null
  }

  phaseView(host) {
    const ph = this.s.phase
    if (this.s.stage !== 'assign' || !ph) return null
    const r = this.round()
    return {
      scope: ph.scope,
      themes: ph.themes.map((ti) => ({ index: ti, name: host || this.themeVisible(this.s.roundIndex, ti) ? r.themes[ti]?.name ?? null : null })),
      ready: ph.ready,
    }
  }

  // Кто за столом в текущей теме — по команде.
  tableView() {
    const s = this.s
    if (!this.tablePlay() || s.themeIndex == null || !['theme', 'question'].includes(s.stage)) return null
    const out = {}
    for (const t of this.teamsWithPlayers()) out[t.id] = this.playerRef(this.tablePlayer(t.id, s.roundIndex, s.themeIndex))
    return out
  }

  // Расстановка игроков по темам раунда. Ведущий видит всё; игроки — после выбора и только по открытым темам.
  assignView(host) {
    const s = this.s
    if (!this.tablePlay()) return null
    const ri = s.roundIndex
    const r = this.round(ri)
    if (!r) return null
    const captainRound = this.kindOf(ri) === 'captain'
    const hiddenNow = s.stage === 'assign' && s.phase ? s.phase.themes : []
    const out = {}
    for (const t of this.teamsWithPlayers()) {
      const row = {}
      r.themes.forEach((_, ti) => {
        if (!host && (hiddenNow.includes(ti) || !this.themeVisible(ri, ti))) return
        const pid = captainRound ? this.game.captainOf(t.id) : this.assignedPlayer(t.id, ri, ti)
        const ref = this.playerRef(pid)
        if (ref) row[ti] = ref
      })
      out[t.id] = row
    }
    return out
  }

  questionView(host) {
    const q = this.s.q
    if (this.s.stage !== 'question' || !q) return null
    const f = this.find(q.id)
    if (!f) return null
    const visible = host || this.themeVisible(f.ri, f.ti)
    return {
      id: q.id,
      themeName: visible ? f.theme.name : null,
      number: f.qi + 1,
      type: q.type,
      step: q.step,
      basePrice: q.basePrice,
      price: q.price,
      responderId: q.responderId,
      attempts: q.attempts,
    }
  }

  finalView(host) {
    const f = this.s.final
    if (this.s.stage !== 'final' || !f) return null
    const theme = this.finalTheme()
    return {
      step: f.step,
      themes: f.themes,
      themeName: theme?.name ?? null,
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
    }
  }

  meView(cid, playerId) {
    const s = this.s
    const f = s.stage === 'final' ? s.final : null
    const participant = !!(f && cid && f.participants.includes(cid))
    const sport = this.isSport()
    return {
      ...this.sportMe(cid, playerId),
      isChooser: !sport && !!cid && cid === s.chooserId,
      canSelect: !sport && this.settings.phoneSelect && s.stage === 'board' && !!cid && cid === s.chooserId,
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

  // Личное для игрока в спортивном формате: капитан ли он, играет ли он текущую тему, выбор игроков.
  sportMe(teamId, playerId) {
    const s = this.s
    const empty = { isCaptain: false, atTable: null, tablePlayer: null, myThemes: [], captain: null }
    if (!this.tablePlay() || !teamId || !this.game.team(teamId)) return empty
    const ri = s.roundIndex
    const r = this.round(ri)
    const isCaptain = this.game.captainOf(teamId) === playerId
    const playing = s.themeIndex != null && ['theme', 'question'].includes(s.stage)
    const table = playing ? this.tablePlayer(teamId, ri, s.themeIndex) : null
    const hiddenNow = s.stage === 'assign' && s.phase ? s.phase.themes : []
    const myThemes = []
    r?.themes.forEach((t, ti) => {
      if (hiddenNow.includes(ti) && !isCaptain) return
      if (this.tablePlayer(teamId, ri, ti) === playerId && !this.themeComplete(ri, ti)) {
        myThemes.push({ index: ti, name: this.themeVisible(ri, ti) ? t.name : null })
      }
    })
    let captain = null
    if (isCaptain && s.stage === 'assign' && s.phase && r) {
      const played = new Set()
      r.themes.forEach((_, ti) => {
        const pid = this.assignedPlayer(teamId, ri, ti)
        if (pid && this.themeStarted(ri, ti) && !s.phase.themes.includes(ti)) played.add(pid)
      })
      captain = {
        themes: s.phase.themes.map((ti) => ({ index: ti, name: this.themeVisible(ri, ti) ? r.themes[ti]?.name ?? null : null })),
        members: this.game.teamMembers(teamId).map((p) => ({ id: p.id, name: p.name, played: played.has(p.id) })),
        picks: { ...(s.assign?.[ri]?.[teamId] ?? {}) },
        ready: s.phase.ready.includes(teamId),
        unique: this.uniqueRequired(teamId, ri),
      }
    }
    return {
      isCaptain,
      atTable: playing ? table === playerId : null,
      tablePlayer: this.playerRef(table),
      myThemes,
      captain,
    }
  }
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}
