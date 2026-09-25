// Типы состояния, которое присылает сервер (см. server/game/views.js).

export type Mode = 'jeopardy' | 'brainring'
export type Role = 'host' | 'screen' | 'player'
export type BuzzerStatus = 'test' | 'off' | 'closed' | 'armed' | 'collecting' | 'answering'

export interface ContentItem {
  type: 'text' | 'image' | 'audio' | 'video'
  text?: string
  src?: string
}

export interface Settings {
  teamMode: boolean
  allowPlayerTeams: boolean
  joinAddress: string
  showQuestionOnPhones: boolean
  phoneSelect: boolean
  hideAnswerOnHost: boolean
  onlineMode: boolean
  joinLocked: boolean
  jBuzzTime: number
  jAnswerTime: number
  jWrongPenalty: boolean
  jEarlyLockMs: number
  jFinalTime: number
  jFinalOnlyPositive: boolean
  jNewRoundChooser: 'lowest' | 'keep'
  brMainTime: number
  brAfterWrongTime: number
  brAfterWrongMode: 'atLeast' | 'fixed' | 'remaining'
  brAnswerTime: number
  brTargetScore: number
  brCarryOver: boolean
  brQuestionValue: number
  brAutoShowQuestion: boolean
  brShowAnswer: boolean
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

export interface PackInfo {
  id: string
  title: string
  author: string
  rounds: { name: string; type: 'normal' | 'final'; themes: number }[]
}

export type QType = 'normal' | 'cat' | 'auction' | 'norisk'
export type QStep = 'special' | 'reading' | 'buzzing' | 'answering' | 'reveal'

export interface Attempt {
  competitorId: string
  correct: boolean
  delta: number
}

export interface JQuestion {
  id: string
  themeName: string
  type: QType
  step: QStep
  basePrice: number
  price: number
  responderId: string | null
  catTheme: string | null
  catPriceOptions: number[] | null
  catSelf: boolean | null
  content: ContentItem[] | null
  answer: string | null
  answerContent: ContentItem[] | null
  comment: string | null
  attempts: Attempt[]
}

export interface JBoardCell {
  id: string
  price: number
  played: boolean
  type?: QType
}

export interface JBoardTheme {
  name: string
  questions: JBoardCell[]
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
  participants: JFinalParticipant[]
  current: string | null
  content: ContentItem[] | null
  answer: string | null
  answerContent: ContentItem[] | null
  comment: string | null
  answerShown: boolean
}

export interface JeopardyView {
  stage: 'board' | 'question' | 'roundEnd' | 'final' | 'results'
  roundIndex: number
  rounds: { name: string; type: 'normal' | 'final'; complete: boolean }[]
  chooserId: string | null
  board: JBoardTheme[] | null
  question: JQuestion | null
  final: JFinal | null
}

export interface BrHistoryItem {
  index: number
  result: 'correct' | 'burned' | 'cancelled'
  competitorId: string | null
  value: number
}

export interface BrainRingView {
  stage: 'idle' | 'reading' | 'armed' | 'answering' | 'reveal' | 'finished'
  qIndex: number
  total: number | null
  value: number
  carry: number
  showQuestion: boolean
  answeredBy: string | null
  winnerId: string | null
  history: BrHistoryItem[]
  question: {
    themeName: string
    content: ContentItem[] | null
    answer: string | null
    answerContent: ContentItem[] | null
    comment: string | null
  } | null
  list: { themeName: string; preview: string }[] | null
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
  pack: PackInfo | null
  jeopardy: JeopardyView | null
  brainring: BrainRingView | null
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
  jeopardy: {
    isChooser: boolean
    canSelect: boolean
    final: {
      participant: boolean
      bet: number | null
      maxBet: number
      answer: string | null
      result: boolean | null
    } | null
  } | null
}

export interface GameEvent {
  name: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
}

export interface PackSummary {
  id: string
  title: string
  author: string
  description: string
  builtin: boolean
  rounds: { name: string; type: 'normal' | 'final'; themes: number }[]
  questions: number
  media: number
  updatedAt: number
}

// Полный пакет (редактор)
export interface PackQuestion {
  price: number
  type: QType
  content: ContentItem[]
  answer: string
  answerContent: ContentItem[]
  comment: string
  catTheme?: string
  catPrice?: number
  catPriceOptions?: number[]
  catSelf?: boolean
}

export interface PackTheme {
  name: string
  questions: PackQuestion[]
}

export interface PackRound {
  name: string
  type: 'normal' | 'final'
  themes: PackTheme[]
}

export interface Pack {
  id?: string
  builtin?: boolean
  title: string
  author: string
  description: string
  rounds: PackRound[]
}
