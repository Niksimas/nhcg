// Тест реакции: время каждого нажатия по сигналу, фальстарты, лучшая и средняя реакция.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeGame, addPlayers } from './helpers.js'

function reactionGame(names = ['Аня', 'Боря', 'Вика'], settings = {}) {
  const ctx = makeGame({ settings })
  const players = addPlayers(ctx.game, names)
  ctx.game.hostCommand('mode.set', { mode: 'reaction' })
  ctx.game.hostCommand('game.start')
  ctx.game.modes.reaction.random = () => 0 // сигнал через 1,5 с
  return { ...ctx, players }
}

test('тест реакции: по сигналу записывается время каждого нажатия, нажатие до сигнала — фальстарт', () => {
  const { game, time, players } = reactionGame()
  const [a, b, c] = players
  const r = () => game.state.reaction
  assert.equal(r().stage, 'idle')
  assert.equal(game.buzz(a.id, time.now()).result, 'off', 'до старта попытки нажатия не считаются')
  game.hostCommand('r.start')
  assert.equal(r().stage, 'run')
  const signalAt = r().signalAt
  assert.equal(signalAt, time.now() + 1500, 'сигнал — через случайное время')
  assert.equal(game.state.buzzer.status, 'armed')
  assert.equal(game.state.buzzer.armedAt, signalAt, 'телефоны зажгут «Жми!» в момент сигнала')
  // Вика не дождалась сигнала.
  time.advance(1000)
  assert.equal(game.buzz(c.id, time.now()).result, 'falseStart')
  assert.equal(game.buildViews().me(c.id).reactionTest.early, true)
  time.advance(100)
  assert.equal(game.buzz(c.id, time.now()).result, 'dup', 'второе нажатие в попытке не считается')
  time.advance(400 + 180)
  assert.deepEqual(game.buzz(a.id, time.now()), { result: 'pressed', reaction: 180 })
  const meA = game.buildViews().me(a.id).reactionTest
  assert.deepEqual({ reaction: meA.reaction, place: meA.place, running: meA.running }, { reaction: 180, place: 1, running: true })
  time.advance(40)
  // Боря нажал раньше, чем дошло его сообщение: время считается по моменту нажатия.
  game.buzz(b.id, time.now() - 10)
  assert.equal(r().stage, 'done', 'нажали все — попытка закончилась')
  assert.equal(game.state.buzzer.status, 'off')
  const view = game.buildViews().pub.reaction
  assert.deepEqual(
    view.current.map((x) => [x.playerId, x.reaction, x.early]),
    [
      [a.id, 180, false],
      [b.id, 210, false],
      [c.id, null, true],
    ],
  )
  assert.equal(view.stats[0].playerId, a.id)
  assert.equal(view.stats.find((x) => x.playerId === c.id).falseStarts, 1)
  assert.equal(game.buildViews().me(b.id).reactionTest.place, 2)
})

test('тест реакции: попытка заканчивается по времени, считаются лучшее и среднее время', () => {
  const { game, time, players } = reactionGame(['Аня', 'Боря'])
  const [a, b] = players
  for (const ms of [200, 300]) {
    game.hostCommand('r.start')
    time.advance(1500 + ms)
    game.buzz(a.id, time.now())
    time.advance(5100) // Боря не нажал — попытка кончилась через 5 секунд после сигнала
    assert.equal(game.state.reaction.stage, 'done')
  }
  const stats = game.buildViews().pub.reaction.stats
  const sa = stats.find((x) => x.playerId === a.id)
  assert.deepEqual({ tries: sa.tries, best: sa.best, avg: sa.avg, last: sa.last }, { tries: 2, best: 200, avg: 250, last: 300 })
  const sb = stats.find((x) => x.playerId === b.id)
  assert.deepEqual({ misses: sb.misses, avg: sb.avg }, { misses: 2, avg: null })
  // Отмена (Ctrl+Z) результаты теста не трогает: здесь она вернула бы игру в лобби.
  game.hostCommand('undo')
  assert.equal(game.state.stage, 'lobby')
  assert.equal(game.state.reaction.attempts.length, 2)
  game.hostCommand('game.start')
  // Ведущий может закончить попытку сам и сбросить результаты.
  game.hostCommand('r.start')
  assert.throws(() => game.hostCommand('r.start'), /уже идёт/)
  assert.throws(() => game.hostCommand('r.reset'), /закончите попытку/)
  game.hostCommand('r.stop')
  assert.equal(game.state.reaction.attempts.length, 3)
  game.hostCommand('r.reset')
  assert.equal(game.state.reaction.attempts.length, 0)
})

test('тест реакции: в командах записывается нажатие каждого игрока, в том числе без команды', () => {
  const ctx = makeGame({ settings: { teamMode: true, rRandom: false } })
  const { game, time } = ctx
  const red = game.createTeam('Красные')
  const join = (name, teamId) => {
    const p = game.join({ name, teamId })
    game.attach(p.id)
    game.updatePing(p.id, 20)
    return p
  }
  const r1 = join('Р1', red.id)
  const r2 = join('Р2', red.id)
  const loner = join('Без команды', null)
  game.hostCommand('mode.set', { mode: 'reaction' })
  game.hostCommand('game.start')
  game.hostCommand('r.start')
  // Без случайной задержки сигнал — сразу, как только команда дойдёт до всех телефонов.
  assert.equal(game.state.reaction.signalAt, time.now() + 400)
  time.advance(550)
  assert.equal(game.buzz(r1.id, time.now()).result, 'pressed')
  time.advance(20)
  assert.equal(game.buzz(r2.id, time.now()).result, 'pressed', 'второй игрок команды — тоже')
  time.advance(20)
  assert.equal(game.buzz(loner.id, time.now()).result, 'pressed')
  assert.deepEqual(
    game.buildViews().pub.reaction.current.map((x) => x.reaction),
    [150, 170, 190],
  )
  assert.equal(game.state.reaction.stage, 'done')
})

test('тест реакции: прерванная перезапуском попытка не считается', async () => {
  const { game, time, players } = reactionGame(['Аня', 'Боря'])
  game.hostCommand('r.start')
  time.advance(1700)
  game.buzz(players[0].id, time.now())
  const { game: g2 } = makeGame()
  await g2.restore(JSON.parse(JSON.stringify(game.serialize())))
  assert.equal(g2.state.mode, 'reaction')
  assert.equal(g2.state.reaction.stage, 'idle')
  assert.equal(g2.state.reaction.attempts.length, 0)
})

test('тест реакции: время — от момента, когда кнопка загорелась на телефоне, а не от команды ведущего', () => {
  const { game, time, players } = reactionGame(['Аня', 'Боря'])
  const [a, b] = players
  game.hostCommand('r.start')
  const signal = game.state.reaction.signalAt
  // У Бори кнопка ещё не загорелась (загорится через 60 мс после сигнала), а он уже нажал — фальстарт.
  time.advance(1500 + 40)
  assert.equal(game.buzz(b.id, signal + 40, time.now(), signal + 60).result, 'falseStart')
  // У Ани кнопка загорелась через 20 мс после сигнала — эти 20 мс в её время не входят.
  time.advance(260)
  assert.deepEqual(game.buzz(a.id, signal + 300, time.now(), signal + 20), { result: 'pressed', reaction: 280 })
  assert.deepEqual(
    game.buildViews().pub.reaction.current.map((x) => [x.playerId, x.reaction, x.early]),
    [
      [a.id, 280, false],
      [b.id, null, true],
    ],
  )
})
