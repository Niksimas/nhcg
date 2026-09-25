// «Хамса»: пять раундов, растущая стоимость, фальстарт, переход права ответа, вычёркивание тем, раунд со ставками.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeGame } from './helpers.js'

// Четыре команды по два игрока (капитан — первый).
function teamsSetup(teamCount = 4) {
  const ctx = makeGame()
  const { game } = ctx
  game.hostCommand('settings.update', { patch: { teamMode: true } })
  const teams = []
  const names = ['Жёлтые', 'Красные', 'Синие', 'Зелёные']
  for (let i = 0; i < teamCount; i++) {
    const team = game.createTeam(names[i])
    const members = [1, 2].map((n) => {
      const p = game.join({ name: `${names[i]} ${n}`, teamId: team.id })
      game.attach(p.id)
      game.updatePing(p.id, 20)
      return p
    })
    teams.push({ team, members })
  }
  game.hostCommand('mode.set', { mode: 'khamsa' })
  return { ...ctx, teams }
}

async function start(ctx) {
  ctx.game.hostCommand('game.start')
}

const kh = (game) => game.state.khamsa

test('«Хамса»: раунды явный, полуявный, тайный, четвёртый и «Хамса», стоимость растёт от раунда к раунду', async () => {
  const ctx = makeGame()
  const { game } = ctx
  game.hostCommand('mode.set', { mode: 'khamsa' })
  await start(ctx)
  const view = () => game.buildViews().pub.jeopardy
  assert.equal(view().format, 'khamsa')
  assert.deepEqual(
    view().rounds.map((r) => r.kind),
    ['open', 'semi', 'closed', 'leaders', 'khamsa'],
  )
  assert.deepEqual(
    view().rounds.map((r) => r.name),
    ['Явный раунд', 'Полуявный раунд', 'Тайный раунд', 'Четвёртый раунд', 'Хамса'],
  )
  assert.equal(view().board.length, 5, 'в раунде пять тем')
  assert.deepEqual(
    view().board[0].questions.map((q) => q.price),
    [100, 200, 300, 400, 500],
  )
  game.hostCommand('j.round', { index: 1 })
  assert.deepEqual(
    view().board[0].questions.map((q) => q.price),
    [200, 400, 600, 800, 1000],
  )
  game.hostCommand('j.round', { index: 2 })
  assert.equal(view().board[0].questions[4].price, 1500)
  game.hostCommand('j.round', { index: 3 })
  assert.equal(view().board[0].questions[4].price, 2000)
  // Своя игра и «Хамса» хранят игру отдельно.
  assert.equal(game.state.jeopardy.roundIndex, 0)
})

test('«Хамса»: фальстарт лишает права ответа, на ответ 3 секунды, ошибка — минус', async () => {
  const ctx = teamsSetup(2)
  const { game, time, teams } = ctx
  await start(ctx)
  game.hostCommand('j.assign.done') // игроков распределяет программа
  game.hostCommand('j.next') // тема 1
  game.hostCommand('j.next') // вопрос за 100
  const [y, r] = teams
  const yTable = kh(game).assign[0][y.team.id][0]
  const rTable = kh(game).assign[0][r.team.id][0]
  assert.equal(game.buzz(yTable, time.now()).result, 'falseStart', 'нажал, пока вопрос читают')
  game.hostCommand('j.arm')
  time.advance(100)
  assert.equal(game.buzz(yTable, time.now()).result, 'locked')
  assert.equal(game.buzz(rTable, time.now()).result, 'pressed')
  time.advance(300)
  assert.equal(game.state.timers.answer.total, 3000)
  game.hostCommand('j.judge', { correct: false })
  assert.equal(game.score(r.team.id), -100)
  assert.equal(kh(game).q.step, 'reveal', 'отвечать больше некому')
})

test('«Хамса»: после неверного ответа право ответа переходит к следующему нажавшему', async () => {
  const ctx = teamsSetup(3)
  const { game, time, teams } = ctx
  await start(ctx)
  game.hostCommand('j.assign.done')
  game.hostCommand('j.next')
  game.hostCommand('j.next')
  const table = teams.map((t) => kh(game).assign[0][t.team.id][0])
  game.hostCommand('j.arm')
  time.advance(100)
  game.buzz(table[1], time.now()) // вторые нажали первыми
  time.advance(20)
  game.buzz(table[2], time.now())
  time.advance(300)
  assert.equal(kh(game).q.responderId, teams[1].team.id)
  game.buzz(table[0], time.now()) // нажал, пока отвечали вторые
  game.hostCommand('j.judge', { correct: false })
  assert.equal(kh(game).q.step, 'answering', 'кнопки заново не открываются')
  assert.equal(kh(game).q.responderId, teams[2].team.id, 'отвечает следующий по времени нажатия')
  assert.equal(game.state.timers.answer.total, 5000, 'на обдумывание — 5 секунд')
  game.hostCommand('j.judge', { correct: false })
  assert.equal(kh(game).q.responderId, teams[0].team.id)
  game.hostCommand('j.judge', { correct: true })
  assert.equal(game.score(teams[0].team.id), 100)
  assert.equal(game.score(teams[1].team.id), -100)
  assert.equal(game.score(teams[2].team.id), -100)

  // Без очереди — кнопки открываются снова, как в «Своей игре».
  game.hostCommand('settings.update', { patch: { hQueue: false } })
  game.hostCommand('j.next')
  game.hostCommand('j.arm')
  time.advance(100)
  game.buzz(table[0], time.now())
  game.buzz(table[1], time.now())
  time.advance(300)
  game.hostCommand('j.judge', { correct: false })
  assert.equal(kh(game).q.step, 'buzzing')
})

test('«Хамса»: в четвёртом раунде капитаны выбирают игрока, команды по очереди убирают темы', async () => {
  const ctx = teamsSetup(4)
  const { game, time, teams } = ctx
  await start(ctx)
  const [y, r, b, g] = teams
  game.state.scores = { [y.team.id]: 300, [r.team.id]: 100, [b.team.id]: 200, [g.team.id]: 400 }
  game.hostCommand('j.round', { index: 3 })
  assert.equal(kh(game).stage, 'assign')
  assert.equal(kh(game).phase.scope, 'leader')
  const cap = game.buildViews().me(y.members[0].id).jeopardy.captain
  assert.equal(cap.themes.length, 1)
  assert.equal(game.buildViews().pub.jeopardy.leaders[y.team.id], undefined, 'пока капитаны выбирают, выбор скрыт')
  assert.equal(game.buildViews().me(y.members[0].id).jeopardy.isLeader, false)
  game.playerAction(y.members[0].id, 'assign', { themeIndex: -1, playerId: y.members[1].id })
  game.hostCommand('j.assign.done')
  // Вычёркивают от меньшего счёта к большему: Красные, Синие, Жёлтые, Зелёные.
  assert.equal(kh(game).stage, 'strike')
  assert.deepEqual(kh(game).strike.order, [r.team.id, b.team.id, y.team.id, g.team.id])
  assert.throws(() => game.playerAction(y.members[0].id, 'strike', { index: 0 }), /другая команда/)
  assert.equal(game.buildViews().me(r.members[0].id).jeopardy.canStrike, true)
  game.playerAction(r.members[0].id, 'strike', { index: 0 })
  game.playerAction(b.members[0].id, 'strike', { index: 1 })
  game.playerAction(y.members[1].id, 'strike', { index: 2 }) // игрок раунда тоже может
  game.hostCommand('j.strike', { index: 4 }) // ведущий — за Зелёных
  assert.equal(kh(game).stage, 'theme')
  assert.equal(kh(game).themeIndex, 3, 'осталась одна тема')
  assert.deepEqual(game.buildViews().pub.jeopardy.board.map((t) => t.struck), [true, true, true, false, true])
  const meJ = (p) => game.buildViews().me(p.id).jeopardy
  assert.equal(meJ(y.members[1]).isLeader, true)
  assert.deepEqual(meJ(y.members[1]).myThemes.map((t) => t.index), [3], 'игрок раунда играет оставшуюся тему')
  assert.equal(meJ(y.members[0]).isLeader, false)
  assert.equal(meJ(r.members[0]).isLeader, true, 'капитан играет, если никого не выбрали')
  // Тему играет выбранный игрок, остальные — нет.
  game.hostCommand('j.next')
  assert.equal(kh(game).q.price, 400)
  game.hostCommand('j.arm')
  time.advance(100)
  assert.equal(game.buzz(y.members[0].id, time.now()).result, 'notAtTable')
  assert.equal(game.buzz(y.members[1].id, time.now()).result, 'pressed')
  time.advance(300)
  game.hostCommand('j.judge', { correct: true })
  for (let i = 0; i < 4; i++) {
    game.hostCommand('j.next')
    game.hostCommand('j.reveal')
  }
  game.hostCommand('j.next')
  assert.equal(kh(game).stage, 'roundEnd', 'в четвёртом раунде играется одна тема')
})

test('«Хамса»: в последнем раунде команды с плюсом ставят очки на один вопрос', async () => {
  const ctx = teamsSetup(3)
  const { game, teams } = ctx
  await start(ctx)
  const [y, r, b] = teams
  game.state.scores = { [y.team.id]: 1500, [r.team.id]: -200, [b.team.id]: 700 }
  game.hostCommand('j.round', { index: 4 })
  const f = () => kh(game).final
  assert.equal(kh(game).stage, 'final')
  assert.deepEqual(f().participants, [y.team.id, b.team.id], 'с отрицательным счётом не играют')
  assert.equal(f().step, 'bets')
  assert.throws(() => game.playerAction(y.members[0].id, 'finalBet', { amount: 1600 }), /от 1 до 1500/)
  game.playerAction(y.members[0].id, 'finalBet', { amount: 1000 })
  game.playerAction(b.members[1].id, 'finalBet', { amount: 700 })
  game.hostCommand('j.final.question')
  assert.equal(game.state.timers.final.total, 70_000, 'минута на обсуждение и 10 секунд на ответ')
  game.playerAction(y.members[1].id, 'finalAnswer', { text: 'Ответ' })
  game.playerAction(b.members[0].id, 'finalAnswer', { text: 'Не знаем' })
  game.hostCommand('j.final.close')
  game.hostCommand('j.final.judge', { competitorId: y.team.id, correct: true })
  game.hostCommand('j.final.judge', { competitorId: b.team.id, correct: false })
  assert.equal(game.score(y.team.id), 2500)
  assert.equal(game.score(b.team.id), 0)
  game.hostCommand('j.results')
  assert.equal(kh(game).stage, 'results')
})

test('«Хамса»: вычёркивание тем переживает перезапуск, отмена возвращает тему', async () => {
  const ctx = teamsSetup(2)
  const { game, teams } = ctx
  await start(ctx)
  game.hostCommand('j.round', { index: 3 })
  game.hostCommand('j.assign.done')
  const first = kh(game).strike.order[0]
  const cap = teams.find((t) => t.team.id === first).members[0]
  game.playerAction(cap.id, 'strike', { index: 2 })
  const { game: g2 } = makeGame()
  await g2.restore(JSON.parse(JSON.stringify(game.serialize())))
  assert.equal(g2.state.mode, 'khamsa')
  assert.equal(g2.state.khamsa.stage, 'strike')
  assert.deepEqual(g2.state.khamsa.strike.removed, [2])
  game.hostCommand('undo')
  assert.deepEqual(kh(game).strike.removed, [])
})

test('«Хамса»: ведущий сам ставит игрока четвёртого раунда и может заменить его', async () => {
  const ctx = teamsSetup(2)
  const { game, teams } = ctx
  await start(ctx)
  game.hostCommand('j.round', { index: 3 })
  const [y] = teams
  game.hostCommand('j.assign.set', { teamId: y.team.id, themeIndex: -1, playerId: y.members[1].id })
  assert.equal(kh(game).leaders[3][y.team.id], y.members[1].id)
  game.hostCommand('j.assign.done')
  game.hostCommand('j.assign.start')
  assert.equal(kh(game).stage, 'assign')
  assert.equal(kh(game).leaders[3], undefined, 'выбор начинается заново')
})
