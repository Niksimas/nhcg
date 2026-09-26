// Построение состояния для разных ролей.
// pub  — экран зрителей и телефоны (без ответов и чужих ставок),
// host — ведущий (всё, включая ответы, комментарии, журнал),
// me   — личная часть для конкретного игрока.

import { rankPresses } from './buzzer.js'

export function buildViews(game) {
  const s = game.state
  const b = s.buzzer

  const competitors = game.competitors().map((c) => ({
    id: c.id,
    kind: c.kind,
    name: c.name,
    color: c.color,
    members: c.members,
    connected: c.connected,
    canBuzz: c.canBuzz,
    score: game.score(c.id),
  }))

  const ranking = rankPresses(b.presses)
  const first = ranking.find((p) => !p.late) ?? ranking[0]
  // Реакция — от момента, когда кнопка загорелась у этого игрока, до нажатия.
  const reactionOf = (p) => (p.start != null ? p.t - p.start : b.armedAt != null ? p.t - b.armedAt : null)
  const buzzer = {
    status: b.status,
    armedAt: b.armedAt,
    winner: b.winner
      ? { competitorId: b.winner.competitorId, playerId: b.winner.playerId, reaction: Math.round(b.winner.reaction) }
      : null,
    ranking: ranking.map((p) => {
      const reaction = reactionOf(p)
      const firstReaction = first ? reactionOf(first) : null
      return {
        competitorId: p.competitorId,
        playerId: p.playerId,
        delta: reaction != null && firstReaction != null ? Math.round(reaction - firstReaction) : 0,
        reaction: reaction != null ? Math.round(reaction) : null,
        late: p.late,
      }
    }),
    lockedOut: b.lockedOut,
    falseStarts: b.falseStarts,
  }

  const base = {
    stage: s.stage,
    mode: s.mode,
    settings: s.settings,
    players: s.players.map((p) => ({
      id: p.id,
      name: p.name,
      teamId: p.teamId,
      color: p.color,
      connected: game.isConnected(p.id),
    })),
    teams: s.teams.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      captainId: game.captainOf(t.id),
      // у кого кнопка команды в «Брейн-ринге» (если у команды одна кнопка)
      buttonId: s.settings.brOneButton ? game.buttonHolder(t.id) : null,
    })),
    competitors,
    buzzer,
    timers: s.timers,
  }

  // «Хамса» показывается так же, как «Своя игра» (темы, вопросы, раунд со ставками) — в поле jeopardy.
  const isJ = s.mode === 'jeopardy' || s.mode === 'khamsa'
  const isBr = s.mode === 'brainring'
  const isR = s.mode === 'reaction'
  const jMode = game.modes[s.mode === 'khamsa' ? 'khamsa' : 'jeopardy']
  const pub = {
    ...base,
    jeopardy: isJ ? jMode.view('public') : null,
    brainring: isBr ? game.modes.brainring.view('public') : null,
    reaction: isR ? game.modes.reaction.view() : null,
  }

  const last = game.undoStack[game.undoStack.length - 1]
  const host = {
    ...base,
    jeopardy: isJ ? jMode.view('host') : null,
    brainring: isBr ? game.modes.brainring.view('host') : null,
    reaction: pub.reaction,
    log: s.log,
    undo: last ? last.label : null,
  }

  const now = game.now()
  const me = (playerId) => {
    const p = game.player(playerId)
    if (!p) return null
    const cid = game.competitorOf(playerId)
    const idx = cid ? buzzer.ranking.findIndex((x) => x.competitorId === cid) : -1
    const lock = cid ? game.earlyLocks.get(cid) : null
    return {
      playerId: p.id,
      name: p.name,
      teamId: p.teamId,
      color: p.color,
      competitorId: cid,
      score: cid ? game.score(cid) : 0,
      lockedOut: !!cid && b.lockedOut.includes(cid),
      falseStart: !!cid && b.falseStarts.includes(cid),
      earlyLockUntil: lock && lock > now ? lock : null,
      rank: idx >= 0 ? idx + 1 : null,
      delta: idx >= 0 ? buzzer.ranking[idx].delta : null,
      reaction: idx >= 0 ? buzzer.ranking[idx].reaction : null,
      isWinner: !!cid && b.winner?.competitorId === cid,
      jeopardy: isJ ? jMode.meView(cid, p.id) : null,
      brainring: isBr ? game.modes.brainring.meView(cid, p.id) : null,
      // тест реакции (поле reaction выше — время реакции в очереди нажатий обычного вопроса)
      reactionTest: isR ? game.modes.reaction.meView(p.id) : null,
    }
  }

  return { pub, host, me }
}
