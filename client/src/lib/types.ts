// Типы состояния, которое присылает сервер (см. server/game/views.js).

export type Mode = 'jeopardy' | 'brainring' | 'khamsa' | 'reaction'
export type Role = 'host' | 'screen' | 'player'
export type BuzzerStatus = 'test' | 'off' | 'closed' | 'armed' | 'collecting' | 'answering'

export interface Settings {
  teamMode: boolean
  allowPlayerTeams: boolean
  joinAddress: string
  phoneSelect: boolean
  onlineMode: boolean
  joinLocked: boolean
  jFormat: 'sport' | 'eq' | 'tv'
  jSportThemes: number
  jEqThemes: number
  jRounds: number
  jThemes: number
  jQuestions: number
  jFinal: boolean
  jPrices: 'x10' | 'x1' | 'x100'
  jTableMode: 'one' | 'team'
  jAssignRoundTime: number
  jAssignThemeTime: number
  jOnePerPlayer: boolean
  jSpecials: boolean
  jBuzzTime: number
  jAnswerTime: number
  hPriceBase: number
  hBuzzTime: number
  hAnswerTime: number
  hQueue: boolean
  hNextTime: number
  hWrongPenalty: boolean
  hAssignRoundTime: number
  hAssignThemeTime: number
  hBetTime: number
  hFinalTime: number
  jWrongPenalty: boolean
  jEarlyLockMs: number
  jBetTime: number
  jFinalTime: number
  jFinalOnlyPositive: boolean
  jNewRoundChooser: 'lowest' | 'keep'
  brMainTime: number
  brAfterWrongTime: number
  brAfterWrongMode: 'atLeast' | 'fixed' | 'remaining'
  brAnswerTime: number
  brTargetScore: number
  brBattleQuestions: number
  brWinPoints: number
  brDrawPoints: number
  brTieMode: 'extra' | 'draw' | 'ask'
  brTotal: 'sum' | 'wins'
  brTakenPoints: number
  brCarryOver: boolean
  brQuestionValue: number
  brOneButton: boolean
  rRandom: boolean
  rTimeout: number
}

export interface PlayerInfo {
  id: string
  name: string
  teamId: string | null
  color: string
  connected: boolean
}

export interface TeamInfo {
  id: string
  name: string
  color: string
  captainId: string | null
  // у кого кнопка команды в «Брейн-ринге» (null — если кнопка у каждого игрока)
  buttonId: string | null
}

export interface Competitor {
  id: string
  kind: 'team' | 'player'
  name: string
  color: string
  members: string[]
  connected: boolean
  canBuzz: boolean
  score: number
}

export interface TimerState {
  total: number
  running: boolean
  endsAt: number | null
  remaining: number
}

export interface RankEntry {
  competitorId: string
  playerId: string
  delta: number
  reaction: number | null
  late: boolean
}

export interface BuzzerView {
  status: BuzzerStatus
  armedAt: number | null
  winner: { competitorId: string; playerId: string; reaction: number } | null
  ranking: RankEntry[]
  lockedOut: string[]
  falseStarts: string[]
}

export type QType = 'normal' | 'cat' | 'auction' | 'norisk'
export type QStep = 'special' | 'reading' | 'buzzing' | 'answering' | 'reveal'

export interface Attempt {
  competitorId: string
  correct: boolean
  delta: number
}

// Вопрос ведущий читает с листа: программа знает только тему, номер и стоимость.
export interface JQuestion {
  id: string
  // null — название темы скрыто от игроков (закрытый раунд)
  themeName: string | null
  number: number
  type: QType
  step: QStep
  // ведущий дочитал вопрос (в «Хамсе» кнопки открыты с начала вопроса)
  read: boolean
  basePrice: number
  price: number
  responderId: string | null
  attempts: Attempt[]
}

export interface JBoardCell {
  id: string
  price: number
  played: boolean
}

export interface JBoardTheme {
  // null — тема ещё не объявлена (полуоткрытый и закрытый раунды)
  name: string | null
  // название вписал ведущий (иначе — «Тема N»)
  named?: boolean
  hidden?: boolean
  current?: boolean
  // вычеркнута командами (персональный раунд «Хамсы»)
  struck?: boolean
  questions: JBoardCell[]
}

// Виды раундов «Эрудит-квартета» и «Хамсы»: открытый (явный), полуоткрытый (полуявный), закрытый (тайный),
// личный (персональный) и раунд «Хамса» со ставками.
export type RoundKind = 'open' | 'semi' | 'closed' | 'personal' | 'khamsa'

export interface PlayerRef {
  playerId: string
  name: string
}

export interface JFinalParticipant {
  competitorId: string
  hasBet: boolean
  hasAnswer: boolean
  bet: number | null
  answer: string | null
  result: boolean | null
  shown: boolean
}

export interface JFinal {
  step: 'themes' | 'bets' | 'question' | 'reveal'
  themes: { index: number; name: string; removed: boolean }[]
  themeName: string | null
  // ставки ещё принимаются (время на ставку не вышло)
  betsOpen: boolean
  participants: JFinalParticipant[]
  current: string | null
}

export type JFormat = 'sport' | 'eq' | 'tv' | 'khamsa'

export interface JeopardyView {
  format: JFormat
  stage: 'board' | 'assign' | 'strike' | 'theme' | 'question' | 'roundEnd' | 'final' | 'results'
  roundIndex: number
  // ведущий может отметить кот в мешке, аукцион, вопрос без риска
  specials: boolean
  // кнопки открыты с начала вопроса — можно перебить ведущего («Хамса»)
  liveReading: boolean
  rounds: { name: string; type: 'normal' | 'final'; complete: boolean; skip: boolean; kind: RoundKind | null }[]
  chooserId: string | null
  kind: RoundKind | null
  tablePlay: boolean
  themeIndex: number | null
  board: JBoardTheme[] | null
  // выбор игроков капитанами
  phase: { scope: 'round' | 'theme' | 'leader'; themes: { index: number; name: string | null }[]; ready: string[] } | null
  // «Хамса»: номер раунда (1–5) и вычёркивание тем персонального раунда
  roundNumber?: number
  strike?: { order: string[]; turn: number; current: string | null; removed: number[] } | null
  // игроки личного (персонального) раунда: команда → игрок
  leaders: Record<string, PlayerRef | null> | null
  // кто за столом в текущей теме: команда → игрок
  table: Record<string, PlayerRef | null> | null
  // расстановка по темам раунда: команда → номер темы → игрок
  assign: Record<string, Record<string, PlayerRef>> | null
  question: JQuestion | null
  final: JFinal | null
}

export interface BrHistoryItem {
  index: number
  result: 'correct' | 'burned' | 'cancelled'
  competitorId: string | null
  value: number
}

export interface BrBattle {
  no: number
  teams: string[]
  scores: Record<string, number>
  played: number
  limit: number
  extra: number
  tie: boolean
}

export interface BrBattleResult {
  no: number
  teams: string[]
  scores: Record<string, number>
  winnerId: string | null
  played: number
}

export interface BrStanding {
  competitorId: string
  played: number
  wins: number
  draws: number
  losses: number
  taken: number
  against: number
  total: number
}

export interface BrainRingView {
  stage: 'idle' | 'reading' | 'armed' | 'answering' | 'reveal' | 'battleEnd' | 'finished'
  qIndex: number
  value: number
  carry: number
  answeredBy: string | null
  winnerId: string | null
  history: BrHistoryItem[]
  battle: BrBattle | null
  lastBattle: BrBattleResult | null
  battles: BrBattleResult[]
  standings: BrStanding[]
  nextPair: string[] | null
}

export interface ReactionResult {
  playerId: string
  // null — не нажал или нажал до сигнала (early)
  reaction: number | null
  early: boolean
}

export interface ReactionStat {
  playerId: string
  tries: number
  best: number | null
  avg: number | null
  last: number | null
  falseStarts: number
  misses: number
}

export interface ReactionView {
  stage: 'idle' | 'run' | 'done'
  no: number
  signalAt: number | null
  expected: string[]
  current: ReactionResult[]
  stats: ReactionStat[]
  attempts: number
}

export interface ServerInfo {
  mode: 'local' | 'rooms'
  code: string
  addresses: { name: string; address: string }[]
  origin: string | null
  port: number
  joinUrl: string
  hostKey: string
  hostUrl: string
  dataDir: string | null
}

export interface RoomInfo {
  code: string
  mode: 'local' | 'rooms'
  isDefault: boolean
}

export interface GameState {
  stage: 'lobby' | 'game'
  mode: Mode
  settings: Settings
  players: PlayerInfo[]
  teams: TeamInfo[]
  competitors: Competitor[]
  buzzer: BuzzerView
  timers: Record<string, TimerState>
  jeopardy: JeopardyView | null
  brainring: BrainRingView | null
  reaction: ReactionView | null
  joinUrl: string
  room: RoomInfo | null
  screens: number
  hosts: number
  // только у ведущего
  log?: { at: number; text: string }[]
  undo?: string | null
  server?: ServerInfo
}

export interface MeView {
  playerId: string
  name: string
  teamId: string | null
  color: string
  competitorId: string | null
  score: number
  lockedOut: boolean
  falseStart: boolean
  earlyLockUntil: number | null
  rank: number | null
  delta: number | null
  reaction: number | null
  isWinner: boolean
  brainring: {
    inBattle: boolean | null
    // у кого кнопка команды (null — кнопка у каждого игрока)
    button: (PlayerRef & { connected: boolean }) | null
    isButton: boolean | null
  } | null
  // тест реакции
  reactionTest: {
    pressed: boolean
    early: boolean
    reaction: number | null
    place: number | null
    of: number
    best: number | null
    avg: number | null
    tries: number
    running: boolean
  } | null
  jeopardy: {
    isCaptain: boolean
    atTable: boolean | null
    tablePlayer: PlayerRef | null
    myThemes: { index: number; name: string | null }[]
    captain: {
      themes: { index: number; name: string | null }[]
      members: { id: string; name: string; played: boolean }[]
      picks: Record<string, string>
      ready: boolean
      unique: boolean
    } | null
    isChooser: boolean
    canSelect: boolean
    // игрок личного (персонального) раунда
    isLeader: boolean
    // «Хамса»: убрать тему может капитан или игрок персонального раунда
    canStrike?: boolean
    final: {
      participant: boolean
      bet: number | null
      maxBet: number
      answer: string | null
      result: boolean | null
      // кто сдаёт ставку и ответ за команду (если не этот игрок)
      writer: PlayerRef | null
      canBet: boolean
      canAnswer: boolean
    } | null
  } | null
}

export interface GameEvent {
  name: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
}
