import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeGame, addPlayers } from './helpers.js'
import { Game } from '../game/game.js'

// Телевизионный формат с маленьким табло: один раунд из двух тем по два вопроса (100 и 200) и финал.
const TV = { jFormat: 'tv', jRounds: 1, jThemes: 2, jQuestions: 2 }

// По умолчанию — телевизионный формат (табло, спецвопросы, финал); спортивный проверяется отдельно.
async function startJeopardy(names = ['Аня', 'Боря', 'Вика'], patch = TV) {
  const ctx = makeGame()
  const players = addPlayers(ctx.game, names)
  ctx.game.hostCommand('settings.update', { patch })
  ctx.game.hostCommand('game.start')
  return { ...ctx, players }
}

test('в лобби нажатие — проверка кнопки', () => {
  const { game, events } = makeGame()
  const [a] = addPlayers(game, ['Аня'])
  assert.equal(game.buzz(a.id, game.now()).result, 'test')
  assert.ok(events.some((e) => e.name === 'test' && e.data.playerId === a.id))
})

test('имя должно быть уникальным, но можно вернуться под своим именем', () => {
  const { game } = makeGame()
  const [a] = addPlayers(game, ['Аня'])
  assert.throws(() => game.join({ name: 'аня' }), /занято/)
  game.detach(a.id)
  assert.throws(() => game.join({ name: 'Аня' }), (err) => err.code === 'nameTaken' && err.canTakeover)
  const back = game.join({ name: 'Аня', takeover: true })
  assert.equal(back.id, a.id)
})

test('«Своя игра» начинается без пакета: раунды и темы строятся из настроек', () => {
  const { game } = makeGame()
  game.hostCommand('game.start')
  const view = game.buildViews().pub.jeopardy
  assert.equal(view.format, 'sport')
  assert.deepEqual(
    view.rounds.map((r) => r.name),
    ['Открытый раунд', 'Полуоткрытый раунд', 'Закрытый раунд', 'Командирский раунд'],
  )
  assert.equal(view.board.length, 4, 'по умолчанию 4 темы')
  assert.deepEqual(
    view.board[0].questions.map((q) => q.price),
    [10, 20, 30, 40, 50],
  )
  assert.equal(view.board[2].name, 'Тема 3')
})

test('ведущий вписывает названия тем, пустое название возвращает «Тема N»', () => {
  const { game } = makeGame({ settings: TV })
  game.hostCommand('game.start')
  game.hostCommand('j.theme.name', { round: 0, theme: 1, name: '  Столицы  ' })
  game.hostCommand('j.theme.name', { round: 1, theme: 0, name: 'Космос' })
  let view = game.buildViews().pub.jeopardy
  assert.equal(view.board[1].name, 'Столицы')
  assert.equal(view.board[1].named, true)
  assert.equal(view.board[0].name, 'Тема 1')
  game.hostCommand('j.select', { id: '0:1:0' })
  assert.equal(game.buildViews().pub.jeopardy.question.themeName, 'Столицы')
  game.hostCommand('j.theme.name', { round: 0, theme: 1, name: '' })
  view = game.buildViews().pub.jeopardy
  assert.equal(view.board[1].name, 'Тема 2')
  assert.throws(() => game.hostCommand('j.theme.name', { round: 0, theme: 9, name: 'x' }), /не найдена/)
  // Финал со ставками — тоже тема, её можно назвать.
  game.hostCommand('j.theme.name', { round: 1, theme: 0, name: 'Космос' })
  assert.equal(game.state.jeopardy.names[1][0], 'Космос')
})

test('скелет игры меняется в настройках, сыгранные вопросы остаются сыгранными', async () => {
  const { game } = await startJeopardy()
  game.hostCommand('j.select', { id: '0:1:1' })
  game.hostCommand('j.reveal')
  game.hostCommand('j.close')
  game.hostCommand('settings.update', { patch: { jThemes: 3, jQuestions: 3 } })
  const view = game.buildViews().pub.jeopardy
  assert.equal(view.board.length, 3)
  assert.deepEqual(
    view.board[0].questions.map((q) => q.price),
    [100, 200, 300],
  )
  assert.equal(view.board[1].questions[1].played, true)
  assert.equal(game.state.jeopardy.stage, 'board')
})

test('обычный вопрос: блокировка за раннее нажатие, честный победитель, штраф и повтор', async () => {
  const { game, time, players } = await startJeopardy()
  const [a, b, c] = players
  const j = game.state.jeopardy
  assert.equal(j.stage, 'board')
  game.hostCommand('j.select', { id: '0:0:0' })
  assert.equal(j.q.step, 'reading')

  // Аня нажала раньше, чем ведущий разрешил ответы → блокировка на 1 секунду
  const early = game.buzz(a.id, time.now())
  assert.equal(early.result, 'early')
  time.advance(200)
  game.hostCommand('j.arm')
  assert.equal(game.state.buzzer.status, 'armed')
  // Аня ещё заблокирована
  time.advance(100)
  assert.equal(game.buzz(a.id, time.now()).result, 'early')

  // Боря нажал позже Вики, но его сообщение дошло раньше (у Вики медленный Wi-Fi)
  game.updatePing(c.id, 200)
  game.updatePing(c.id, 200)
  game.updatePing(c.id, 200)
  const vikaPressedAt = time.now() + 10
  time.advance(40)
  assert.equal(game.buzz(b.id, time.now() - 5).result, 'pressed') // Боря нажал в +35
  assert.equal(game.state.buzzer.status, 'collecting')
  time.advance(100)
  assert.equal(game.buzz(c.id, vikaPressedAt).result, 'pressed') // Вика нажала в +10, пришло в +140
  time.advance(300)
  assert.equal(game.state.buzzer.status, 'answering')
  assert.equal(game.state.buzzer.winner.competitorId, c.id)
  assert.equal(j.q.responderId, c.id)
  assert.ok(game.state.timers.answer)

  // Неверный ответ: минус цена, Вика заблокирована, кнопки снова открыты
  game.hostCommand('j.judge', { correct: false })
  assert.equal(game.score(c.id), -100)
  assert.equal(j.q.step, 'buzzing')
  assert.equal(game.state.buzzer.status, 'armed')
  assert.equal(game.buzz(c.id, time.now()).result, 'locked')

  time.advance(1500)
  assert.equal(game.buzz(a.id, time.now()).result, 'pressed')
  time.advance(300)
  assert.equal(j.q.responderId, a.id)
  game.hostCommand('j.judge', { correct: true })
  assert.equal(game.score(a.id), 100)
  assert.equal(j.chooserId, a.id)
  assert.equal(j.q.step, 'reveal')

  game.hostCommand('j.close')
  assert.equal(j.stage, 'board')
  assert.ok(j.played.includes('0:0:0'))
  assert.throws(() => game.hostCommand('j.select', { id: '0:0:0' }), /сыгран/)
})

test('время на нажатие вышло — показывается ответ', async () => {
  const { game, time } = await startJeopardy()
  game.hostCommand('j.select', { id: '0:0:0' })
  game.hostCommand('j.arm')
  time.advance(10_500)
  assert.equal(game.state.jeopardy.q.step, 'reveal')
})

test('если все ответили неверно — вопрос закрывается', async () => {
  const { game, time, players } = await startJeopardy(['Аня', 'Боря'])
  game.hostCommand('j.select', { id: '0:0:0' })
  game.hostCommand('j.arm')
  for (const p of players) {
    time.advance(500)
    game.buzz(p.id, time.now())
    time.advance(300)
    game.hostCommand('j.judge', { correct: false })
  }
  assert.equal(game.state.jeopardy.q.step, 'reveal')
  assert.equal(game.score(players[0].id), -100)
  assert.equal(game.score(players[1].id), -100)
})

test('кот в мешке, аукцион и вопрос без риска ведущий отмечает сам', async () => {
  const { game, players } = await startJeopardy()
  const [a, b] = players
  let j = game.state.jeopardy

  game.hostCommand('j.select', { id: '0:0:1' })
  assert.equal(j.q.step, 'reading', 'обычный вопрос, пока ведущий не отметил спецвопрос')
  game.hostCommand('j.special', { type: 'cat' })
  assert.equal(j.q.step, 'special')
  assert.equal(game.state.buzzer.status, 'off', 'у спецвопроса кнопки выключены')
  assert.equal(game.buildViews().pub.jeopardy.question.type, 'cat')
  game.hostCommand('j.assign', { competitorId: b.id, price: 500 })
  assert.equal(j.q.responderId, b.id)
  game.hostCommand('j.judge', { correct: true })
  assert.equal(game.score(b.id), 500)
  game.hostCommand('j.close')

  game.hostCommand('j.select', { id: '0:1:0' })
  game.hostCommand('j.arm')
  assert.throws(() => game.hostCommand('j.special', { type: 'auction' }), /до того, как открыты кнопки/)
  game.hostCommand('undo')
  j = game.state.jeopardy // после отмены состояние восстановлено из снимка
  game.hostCommand('j.special', { type: 'auction' })
  game.hostCommand('j.assign', { competitorId: a.id, price: 300 })
  game.hostCommand('j.judge', { correct: false })
  assert.equal(game.score(a.id), -300)
  assert.equal(j.q.step, 'reveal', 'у спецвопроса одна попытка')
  game.hostCommand('j.close')

  game.hostCommand('j.select', { id: '0:1:1' })
  game.hostCommand('j.special', { type: 'norisk' })
  game.hostCommand('j.assign', { competitorId: a.id })
  game.hostCommand('j.judge', { correct: false })
  assert.equal(game.score(a.id), -300, 'без риска — без штрафа')
  game.hostCommand('undo')
  game.hostCommand('j.judge', { correct: true })
  assert.equal(game.score(a.id), 100, 'без риска — двойная цена')
})

test('в спортивном формате спецвопросы включаются в настройках', async () => {
  const { game } = await startJeopardy(['Аня'], { jFormat: 'sport' })
  game.hostCommand('j.next')
  game.hostCommand('j.next')
  assert.throws(() => game.hostCommand('j.special', { type: 'cat' }), /выключены/)
  game.hostCommand('settings.update', { patch: { jSpecials: true } })
  game.hostCommand('j.special', { type: 'norisk' })
  assert.equal(game.state.jeopardy.q.type, 'norisk')
})

test('отмена последнего действия возвращает счёт и отвечающего', async () => {
  const { game, time, players } = await startJeopardy()
  const [a] = players
  game.hostCommand('j.select', { id: '0:0:0' })
  game.hostCommand('j.arm')
  time.advance(300)
  game.buzz(a.id, time.now())
  time.advance(300)
  game.hostCommand('j.judge', { correct: false })
  assert.equal(game.score(a.id), -100)
  game.hostCommand('undo')
  assert.equal(game.score(a.id), 0)
  assert.equal(game.state.jeopardy.q.step, 'answering')
  assert.equal(game.state.jeopardy.q.responderId, a.id)
  game.hostCommand('j.judge', { correct: true })
  assert.equal(game.score(a.id), 100)
})

test('выбор вопроса с телефона — только выбирающим', async () => {
  const { game, players } = await startJeopardy()
  const [a, b] = players
  game.hostCommand('j.chooser', { competitorId: a.id })
  assert.throws(() => game.playerAction(b.id, 'select', { id: '0:0:0' }), /другой игрок/)
  game.playerAction(a.id, 'select', { id: '0:0:0' })
  assert.equal(game.state.jeopardy.stage, 'question')
})

test('финал: ставки, ответы с телефонов и подсчёт', async () => {
  const { game, players } = await startJeopardy()
  const [a, b, c] = players
  game.state.scores[a.id] = 500
  game.state.scores[b.id] = 300
  game.state.scores[c.id] = -100
  game.hostCommand('j.round', { index: 1 })
  const j = game.state.jeopardy
  assert.equal(j.stage, 'final')
  assert.deepEqual(j.final.participants.sort(), [a.id, b.id].sort(), 'с отрицательным счётом в финал не проходят')
  assert.equal(j.final.step, 'bets', 'тема финала одна — сразу ставки')
  assert.equal(game.buildViews().pub.jeopardy.final.themeName, 'Финал')

  assert.throws(() => game.playerAction(a.id, 'finalBet', { amount: 600 }), /от 1 до 500/)
  game.playerAction(a.id, 'finalBet', { amount: 400 })
  assert.throws(() => game.playerAction(c.id, 'finalBet', { amount: 1 }), /не участвуете/)
  game.hostCommand('j.final.bet', { competitorId: b.id, amount: 300 })

  const pubBets = game.buildViews().pub.jeopardy.final.participants
  assert.ok(pubBets.every((p) => p.bet === null), 'ставки скрыты от зрителей')

  game.hostCommand('j.final.question')
  assert.equal(j.final.step, 'question')
  game.playerAction(a.id, 'finalAnswer', { text: '  Ф2 ' })
  game.playerAction(b.id, 'finalAnswer', { text: 'не знаю' })
  game.hostCommand('j.final.close')
  game.hostCommand('j.final.show', { competitorId: a.id })
  game.hostCommand('j.final.judge', { competitorId: a.id, correct: true })
  game.hostCommand('j.final.judge', { competitorId: b.id, correct: false })
  assert.equal(game.score(a.id), 900)
  assert.equal(game.score(b.id), 0)
  // Передумали — пересуживаем
  game.hostCommand('j.final.judge', { competitorId: b.id, correct: true })
  assert.equal(game.score(b.id), 600)
  game.hostCommand('j.results')
  assert.equal(j.stage, 'results')
})

test('новый раунд начинает игрок с наименьшим счётом', async () => {
  const { game } = makeGame({ settings: { ...TV, jRounds: 2 } })
  const [a, b] = addPlayers(game, ['Аня', 'Боря'])
  game.hostCommand('game.start')
  game.state.scores[a.id] = 500
  game.state.scores[b.id] = 100
  game.hostCommand('j.chooser', { competitorId: a.id })
  game.hostCommand('j.nextRound')
  assert.equal(game.state.jeopardy.roundIndex, 1)
  assert.equal(game.state.jeopardy.chooserId, b.id)
})

test('командный режим: кнопка любого участника — за команду', async () => {
  const { game, time } = makeGame()
  game.hostCommand('settings.update', { patch: { teamMode: true } })
  const red = game.createTeam('Красные')
  const blue = game.createTeam('Синие')
  const r1 = game.join({ name: 'Р1', teamId: red.id })
  const r2 = game.join({ name: 'Р2', teamId: red.id })
  const b1 = game.join({ name: 'С1', newTeamName: 'синие' })
  assert.equal(b1.teamId, blue.id, 'существующая команда находится по названию')
  const loner = game.join({ name: 'Без команды' })
  for (const p of [r1, r2, b1, loner]) game.attach(p.id)
  assert.equal(game.buzz(loner.id, time.now()).result, 'noTeam')

  game.hostCommand('mode.set', { mode: 'brainring' })
  game.hostCommand('game.start')
  game.hostCommand('br.next')
  game.hostCommand('br.start')
  time.advance(500)
  game.buzz(r2.id, time.now())
  game.buzz(r1.id, time.now())
  time.advance(300)
  assert.equal(game.state.buzzer.winner.competitorId, red.id)
  assert.equal(game.state.buzzer.winner.playerId, r2.id)
  game.hostCommand('br.judge', { correct: true })
  assert.equal(game.score(red.id), 1)
})

test('«Брейн-ринг»: фальстарт, минута, 20 секунд после ошибки, перенос очков', () => {
  const { game, time, events } = makeGame()
  const [a, b, c] = addPlayers(game, ['Альфа', 'Бета', 'Гамма'])
  game.hostCommand('settings.update', { patch: { brCarryOver: true } })
  game.hostCommand('mode.set', { mode: 'brainring' })
  game.hostCommand('game.start')
  const br = game.state.brainring
  game.hostCommand('br.next')
  assert.equal(br.stage, 'reading')
  assert.equal(br.qIndex, 0)

  // Гамма нажала до сигнала — фальстарт
  assert.equal(game.buzz(c.id, time.now()).result, 'falseStart')
  assert.ok(events.some((e) => e.name === 'falseStart'))
  game.hostCommand('br.start')
  time.advance(50_000)
  assert.equal(game.buzz(c.id, time.now()).result, 'locked')
  game.buzz(a.id, time.now())
  time.advance(200)
  assert.equal(br.stage, 'answering')
  const remaining = game.timerRemaining('main')
  assert.ok(remaining > 9_000 && remaining < 10_500, `осталось ~10 с, а не ${remaining}`)
  game.hostCommand('br.judge', { correct: false })
  assert.equal(br.stage, 'armed')
  assert.equal(game.timerRemaining('main'), 20_000, 'после ошибки даётся не меньше 20 секунд')

  // Никто не ответил — вопрос сгорает, очко переходит дальше
  time.advance(20_100)
  assert.equal(br.stage, 'reveal')
  assert.equal(br.carry, 1)
  game.hostCommand('br.next')
  assert.equal(br.value, 2)
  game.hostCommand('br.start')
  time.advance(3000)
  game.buzz(b.id, time.now())
  time.advance(300)
  game.hostCommand('br.judge', { correct: true })
  assert.equal(game.score(b.id), 2)
  assert.equal(br.carry, 0)
})

// Команда отвечает на вопрос брейн-ринга (кнопка + «верно»).
function brAnswer(game, time, player, correct = true) {
  game.hostCommand('br.next')
  game.hostCommand('br.start')
  time.advance(1000)
  assert.equal(game.buzz(player.id, time.now()).result, 'pressed')
  time.advance(300)
  game.hostCommand('br.judge', { correct })
}

function brBurn(game) {
  game.hostCommand('br.next')
  game.hostCommand('br.burn')
}

function teamsGame(teamNames) {
  const ctx = makeGame()
  ctx.game.hostCommand('settings.update', { patch: { teamMode: true } })
  const teams = teamNames.map((name) => ctx.game.createTeam(name))
  const players = teams.map((t, i) => {
    const p = ctx.game.join({ name: `Игрок ${i + 1}`, teamId: t.id })
    ctx.game.attach(p.id)
    ctx.game.updatePing(p.id, 20)
    return p
  })
  ctx.game.hostCommand('mode.set', { mode: 'brainring' })
  ctx.game.hostCommand('game.start')
  return { ...ctx, teams, players }
}

test('«Брейн-ринг»: бой из 5 вопросов, +1 за победу и сквозной счёт', () => {
  const { game, time, teams, players } = teamsGame(['Альфа', 'Бета'])
  const [A, B] = teams
  const [pa, pb] = players
  const br = () => game.state.brainring
  // Две команды — бой начинается сам с первым вопросом.
  brAnswer(game, time, pa)
  assert.deepEqual(br().battle.teams, [A.id, B.id])
  brAnswer(game, time, pb)
  brAnswer(game, time, pa)
  brBurn(game)
  assert.equal(br().stage, 'reveal')
  brAnswer(game, time, pa) // 5-й вопрос: 3:1
  assert.equal(br().stage, 'battleEnd')
  assert.equal(br().battle, null)
  const last = br().battles[0]
  assert.equal(last.winnerId, A.id)
  assert.deepEqual(last.scores, { [A.id]: 3, [B.id]: 1 })
  // Сквозной счёт: взятые вопросы + 1 очко за победу.
  assert.equal(game.score(A.id), 4)
  assert.equal(game.score(B.id), 1)
  const table = game.buildViews().pub.brainring.standings
  assert.equal(table[0].competitorId, A.id)
  assert.deepEqual(
    { played: table[0].played, wins: table[0].wins, taken: table[0].taken, total: table[0].total },
    { played: 1, wins: 1, taken: 3, total: 4 },
  )
  // Второй бой: вопросы и счёт боя начинаются заново, турнирный — копится.
  brAnswer(game, time, pb)
  assert.equal(br().battle.no, 2)
  assert.deepEqual(br().battle.scores, { [A.id]: 0, [B.id]: 1 })
  assert.equal(game.score(B.id), 2)
})

test('«Брейн-ринг»: ничья — дополнительный вопрос, ничья по выбору ведущего, очки только за победы', () => {
  const { game, time, teams, players } = teamsGame(['Альфа', 'Бета'])
  const [A, B] = teams
  const [pa, pb] = players
  const br = () => game.state.brainring
  game.hostCommand('settings.update', { patch: { brBattleQuestions: 2 } })
  brAnswer(game, time, pa)
  brAnswer(game, time, pb) // 1:1 после двух вопросов — дополнительный вопрос
  assert.equal(br().stage, 'reveal')
  assert.equal(br().battle.extra, 1)
  brBurn(game) // не взят — снова ничья, ещё вопрос
  assert.equal(br().battle.extra, 2)
  brAnswer(game, time, pb)
  assert.equal(br().battles[0].winnerId, B.id)

  game.hostCommand('settings.update', { patch: { brTieMode: 'ask', brTotal: 'wins', brDrawPoints: 0.5 } })
  brAnswer(game, time, pa)
  brAnswer(game, time, pb)
  assert.equal(br().battle.tie, true)
  assert.throws(() => game.hostCommand('br.next'), /Ничья/)
  game.hostCommand('br.draw')
  assert.equal(br().battles[1].winnerId, null)
  // В режиме «только победы» взятые вопросы в сквозной счёт не идут: А — 1 (прошлый бой) + 0.5, Б — 2 + 1 + 0.5.
  assert.equal(game.score(A.id), 1.5)
  assert.equal(game.score(B.id), 3.5)
})

test('«Брейн-ринг»: в бою играют только выбранные команды, следующая пара — кто ещё не встречался', () => {
  const { game, time, teams, players } = teamsGame(['Альфа', 'Бета', 'Гамма'])
  const [A, B, C] = teams
  const [pa, pb, pc] = players
  assert.throws(() => game.hostCommand('br.next'), /Выберите/)
  let pair = game.buildViews().host.brainring.nextPair
  assert.equal(pair.length, 2)
  game.hostCommand('br.battle', { teams: [A.id, B.id] })
  game.hostCommand('br.next')
  game.hostCommand('br.start')
  time.advance(500)
  assert.equal(game.buzz(pc.id, time.now()).result, 'notInBattle')
  assert.equal(game.buildViews().me(pc.id).brainring.inBattle, false)
  assert.equal(game.buildViews().me(pa.id).brainring.inBattle, true)
  game.buzz(pb.id, time.now())
  time.advance(300)
  game.hostCommand('br.judge', { correct: true })
  game.hostCommand('br.endBattle')
  assert.equal(game.state.brainring.battles[0].winnerId, B.id)
  pair = game.buildViews().host.brainring.nextPair
  assert.ok(pair.includes(C.id), 'следующей играет команда, у которой ещё не было боя')
  // Итоги турнира и продолжение.
  game.hostCommand('br.finish')
  assert.equal(game.state.brainring.stage, 'finished')
  assert.equal(game.state.brainring.winnerId, B.id)
  game.hostCommand('br.continue')
  assert.equal(game.state.brainring.stage, 'idle')
  void pa
})

test('«Брейн-ринг»: бой до заданного счёта заканчивается досрочно', () => {
  const { game, time, teams, players } = teamsGame(['Альфа', 'Бета'])
  game.hostCommand('settings.update', { patch: { brTargetScore: 2, brBattleQuestions: 0 } })
  brAnswer(game, time, players[0])
  brAnswer(game, time, players[0])
  assert.equal(game.state.brainring.stage, 'battleEnd')
  assert.equal(game.state.brainring.battles[0].winnerId, teams[0].id)
})

test('«Брейн-ринг»: вопросы читаются с листа, программа их только нумерует', () => {
  const { game, time } = makeGame()
  const [a] = addPlayers(game, ['Альфа'])
  game.hostCommand('mode.set', { mode: 'brainring' })
  game.hostCommand('game.start')
  game.hostCommand('br.next')
  game.hostCommand('br.start')
  time.advance(1000)
  game.buzz(a.id, time.now())
  time.advance(300)
  game.hostCommand('br.judge', { correct: true })
  game.hostCommand('br.next')
  const view = game.buildViews().pub.brainring
  assert.equal(view.qIndex, 1)
  assert.equal('question' in view, false, 'текста вопросов в программе нет')
  assert.equal(game.score(a.id), 1)
})

test('время вышло во время сбора нажатий — нажатие всё равно засчитывается', async () => {
  const { game, time, players } = await startJeopardy(['Аня', 'Боря'])
  game.updatePing(players[1].id, 250)
  game.updatePing(players[1].id, 250)
  game.hostCommand('j.select', { id: '0:0:0' })
  game.hostCommand('j.arm')
  time.advance(9_990)
  game.buzz(players[0].id, time.now())
  time.advance(20) // таймер истёк, но окно сбора ещё открыто
  assert.equal(game.state.jeopardy.q.step, 'answering')
  assert.equal(game.state.jeopardy.q.responderId, players[0].id)
})

test('сохранение и восстановление после перезапуска', async () => {
  const { game, time, players } = await startJeopardy(['Аня', 'Боря'])
  game.hostCommand('j.select', { id: '0:0:0' })
  game.hostCommand('j.arm')
  time.advance(500)
  game.buzz(players[0].id, time.now())
  time.advance(300)
  game.hostCommand('j.judge', { correct: true })
  const saved = JSON.parse(JSON.stringify(game.serialize()))

  const { game: fresh } = makeGame()
  assert.equal(await fresh.restore(saved), true)
  assert.equal(fresh.state.stage, 'game')
  assert.equal(fresh.score(players[0].id), 100)
  assert.equal(fresh.playerByToken(players[0].token).id, players[0].id)
  assert.equal(fresh.settings.jThemes, 2, 'скелет игры восстанавливается из настроек')
  assert.equal(fresh.state.jeopardy.q.step, 'reveal')
  assert.equal(fresh.isConnected(players[0].id), false)
})

test('повреждённое сохранение не ломает сервер', async () => {
  const { game } = makeGame()
  assert.equal(await game.restore({ v: 1, players: 'мусор', jeopardy: 5 }), true)
  assert.deepEqual(game.state.players, [])
  assert.equal(await game.restore(null), false)
  assert.equal(await game.restore({ v: 99 }), false)
})

test('представление игрока содержит его место в очереди нажатий', async () => {
  const { game, time, players } = await startJeopardy(['Аня', 'Боря'])
  const [a, b] = players
  game.hostCommand('j.select', { id: '0:0:0' })
  game.hostCommand('j.arm')
  time.advance(400)
  game.buzz(a.id, time.now())
  time.advance(10)
  game.buzz(b.id, time.now())
  time.advance(300)
  const views = game.buildViews()
  const meA = views.me(a.id)
  const meB = views.me(b.id)
  assert.equal(meA.rank, 1)
  assert.equal(meA.isWinner, true)
  assert.equal(meB.rank, 2)
  assert.equal(meB.delta, 10)
})

test('удалённый игрок пропадает, его счёт тоже', () => {
  const { game } = makeGame()
  const kicked = []
  game.on('kick', (id) => kicked.push(id))
  const [a] = addPlayers(game, ['Аня'])
  game.state.scores[a.id] = 10
  game.hostCommand('player.remove', { playerId: a.id })
  assert.deepEqual(kicked, [a.id])
  assert.equal(game.player(a.id), null)
  assert.equal(game.state.scores[a.id], undefined)
})

test('Game можно создать без параметров', () => {
  const g = new Game()
  assert.equal(g.state.stage, 'lobby')
  assert.equal(g.buildViews().pub.mode, 'jeopardy')
})

test('после перезапуска открытый вопрос возвращается к чтению, а кот в мешке — остаётся у отвечающего', async () => {
  const { game, time, players } = await startJeopardy(['Аня', 'Боря'])
  game.hostCommand('j.select', { id: '0:0:0' })
  game.hostCommand('j.arm')
  time.advance(300)
  game.buzz(players[0].id, time.now())
  time.advance(300)
  assert.equal(game.state.buzzer.status, 'answering')
  const { game: g1 } = makeGame()
  await g1.restore(JSON.parse(JSON.stringify(game.serialize())))
  assert.equal(g1.state.jeopardy.q.step, 'reading')
  assert.equal(g1.state.buzzer.status, 'closed')
  assert.equal(g1.state.buzzer.winner, null)
  g1.hostCommand('j.arm')
  assert.equal(g1.state.buzzer.status, 'armed')

  game.hostCommand('j.reveal')
  game.hostCommand('j.close')
  game.hostCommand('j.select', { id: '0:0:1' })
  game.hostCommand('j.special', { type: 'cat' })
  game.hostCommand('j.assign', { competitorId: players[1].id })
  const { game: g2 } = makeGame()
  await g2.restore(JSON.parse(JSON.stringify(game.serialize())))
  assert.equal(g2.state.jeopardy.q.step, 'answering')
  assert.equal(g2.state.jeopardy.q.responderId, players[1].id)
  g2.hostCommand('j.judge', { correct: true })
  assert.equal(g2.score(players[1].id), 200)
})

test('проверка звука отправляет событие экранам', () => {
  const { game, events } = makeGame()
  game.hostCommand('sound.test')
  assert.ok(events.some((e) => e.name === 'soundTest'))
})

test('игра по интернету: кнопки и время на нажатие стартуют одновременно у всех', async () => {
  const { game, time, players, events } = await startJeopardy()
  const [a, b] = players
  game.hostCommand('settings.update', { patch: { onlineMode: true } })
  game.hostCommand('j.select', { id: '0:0:0' })
  const t0 = time.now()
  game.hostCommand('j.arm')
  const buzzer = game.state.buzzer
  assert.equal(buzzer.armedAt, t0 + 400, 'сигнал назначен на момент, когда он дойдёт до всех')
  assert.equal(events.find((e) => e.name === 'armed').data.at, buzzer.armedAt)
  assert.equal(game.state.timers.buzz.endsAt, buzzer.armedAt + 10_000)
  assert.equal(game.timerRemaining('buzz'), 10_000)
  // Нажатие до сигнала — раннее, как нажатие до разрешения ведущего.
  time.advance(100)
  assert.equal(game.buzz(a.id, time.now()).result, 'early')
  time.advance(400)
  assert.equal(game.buzz(b.id, time.now()).result, 'pressed')
  time.advance(300)
  assert.equal(buzzer.winner.competitorId, b.id)
  assert.equal(Math.round(buzzer.winner.reaction), 100)
})

test('«Брейн-ринг» по интернету: нажатие до сигнала на экране — фальстарт', () => {
  const { game, time } = makeGame()
  const [a, b] = addPlayers(game, ['Альфа', 'Бета'], 300)
  game.hostCommand('settings.update', { patch: { onlineMode: true } })
  game.hostCommand('mode.set', { mode: 'brainring' })
  game.hostCommand('game.start')
  game.hostCommand('br.next')
  const t0 = time.now()
  game.hostCommand('br.start')
  assert.equal(game.state.buzzer.armedAt, t0 + 550)
  time.advance(200)
  assert.equal(game.timerRemaining('main'), 60_000, 'минута начинается только с сигнала')
  assert.equal(game.buzz(a.id, time.now()).result, 'falseStart')
  time.advance(400)
  assert.equal(game.buzz(b.id, time.now()).result, 'pressed')
  time.advance(1000)
  assert.equal(game.state.brainring.stage, 'answering')
  assert.equal(game.state.buzzer.winner.competitorId, b.id)
})

test('закрытый вход: новые игроки не входят, но свои могут вернуться', () => {
  const { game } = makeGame()
  const [a] = addPlayers(game, ['Аня'])
  game.hostCommand('settings.update', { patch: { joinLocked: true } })
  assert.throws(() => game.join({ name: 'Боря' }), /закрыл вход/)
  game.detach(a.id)
  assert.equal(game.join({ name: 'Аня', takeover: true }).id, a.id)
})

// ───────────── Спортивная «Своя игра» (правила «Эрудит-квартета») ─────────────

// Спортивный формат с двумя темами в раунде (по 5 вопросов, 4 раунда).
const SPORT = { jFormat: 'sport', jThemes: 2 }

// Правильный/неправильный ответ игрока на открытый вопрос.
function jAnswer(game, time, player, correct) {
  game.hostCommand('j.arm')
  time.advance(100)
  assert.equal(game.buzz(player.id, time.now()).result, 'pressed')
  time.advance(300)
  game.hostCommand('j.judge', { correct })
}

test('спортивная «Своя игра»: темы по 5 вопросов подряд, 10–50 очков, минус за ошибку', async () => {
  const { game, time } = makeGame({ settings: SPORT })
  const [a, b] = addPlayers(game, ['Аня', 'Боря'])
  game.hostCommand('game.start')
  const j = () => game.state.jeopardy
  assert.equal(j().stage, 'board', 'без команд распределять игроков не нужно')
  let view = game.buildViews().pub.jeopardy
  assert.equal(view.format, 'sport')
  assert.equal(view.kind, 'open')
  assert.deepEqual(
    view.board[0].questions.map((q) => q.price),
    [10, 20, 30, 40, 50],
  )
  assert.equal(view.rounds.length, 4, 'финала со ставками в спортивном формате нет')

  game.hostCommand('j.next') // тема 1
  assert.equal(j().stage, 'theme')
  assert.equal(j().themeIndex, 0)
  game.hostCommand('j.next') // вопрос за 10
  assert.equal(j().q.price, 10)
  jAnswer(game, time, a, false)
  assert.equal(game.score(a.id), -10, 'за ошибку снимается стоимость вопроса')
  time.advance(1500)
  assert.equal(game.buzz(b.id, time.now()).result, 'pressed')
  time.advance(300)
  game.hostCommand('j.judge', { correct: true })
  assert.equal(game.score(b.id), 10)
  for (const price of [20, 30, 40, 50]) {
    game.hostCommand('j.next')
    assert.equal(j().q.price, price)
    game.hostCommand('j.reveal')
  }
  game.hostCommand('j.next') // тема сыграна — обзор тем
  assert.equal(j().stage, 'board')
  game.hostCommand('j.next')
  assert.equal(j().themeIndex, 1)
  for (let i = 0; i < 5; i++) {
    game.hostCommand('j.next')
    game.hostCommand('j.reveal')
  }
  game.hostCommand('j.next')
  assert.equal(j().stage, 'roundEnd')
  game.hostCommand('j.next')
  assert.equal(j().roundIndex, 1)
  assert.equal(game.buildViews().pub.jeopardy.kind, 'semi')
  // Без штрафа за ошибку
  game.hostCommand('settings.update', { patch: { jWrongPenalty: false, jPrices: 'x1' } })
  game.hostCommand('j.next')
  game.hostCommand('j.next')
  assert.equal(j().q.price, 1)
  jAnswer(game, time, b, false)
  assert.equal(game.score(b.id), 10)
})

function sportTeams() {
  const ctx = makeGame({ settings: SPORT })
  const { game } = ctx
  game.hostCommand('settings.update', { patch: { teamMode: true } })
  const red = game.createTeam('Красные')
  const blue = game.createTeam('Синие')
  const join = (name, team) => {
    const p = game.join({ name, teamId: team.id })
    game.attach(p.id)
    game.updatePing(p.id, 20)
    return p
  }
  const r1 = join('Р1', red)
  const r2 = join('Р2', red)
  const b1 = join('С1', blue)
  const b2 = join('С2', blue)
  return { ...ctx, red, blue, r1, r2, b1, b2 }
}

test('спортивная «Своя игра» в командах: капитаны распределяют игроков, за столом один игрок от команды', async () => {
  const { game, time, red, blue, r1, r2, b1, b2 } = sportTeams()
  assert.equal(game.captainOf(red.id), r1.id, 'первый вошедший — капитан')
  game.hostCommand('game.start')
  const j = () => game.state.jeopardy
  // Открытый раунд начинается с распределения игроков по темам.
  assert.equal(j().stage, 'assign')
  assert.ok(game.state.timers.assign)
  const me = game.buildViews().me(r1.id).jeopardy
  assert.equal(me.isCaptain, true)
  assert.deepEqual(
    me.captain.themes.map((t) => t.name),
    ['Тема 1', 'Тема 2'],
    'в открытом раунде темы видны сразу',
  )
  assert.throws(() => game.playerAction(r2.id, 'assign', { themeIndex: 0, playerId: r2.id }), /только капитан/)
  game.playerAction(r1.id, 'assign', { themeIndex: 0, playerId: r2.id })
  game.playerAction(r1.id, 'assign', { themeIndex: 1, playerId: r1.id })
  // Один игрок — одна тема: если поставить Р2 на вторую тему, первая освободится.
  game.playerAction(r1.id, 'assign', { themeIndex: 1, playerId: r2.id })
  assert.equal(j().assign[0][red.id][0], undefined)
  game.playerAction(r1.id, 'assign', { themeIndex: 0, playerId: r1.id })
  game.playerAction(r1.id, 'assignReady')
  assert.equal(j().stage, 'assign', 'ждём второго капитана')
  // Время вышло — за Синих игроки назначаются сами.
  time.advance(60_500)
  assert.equal(j().stage, 'board')
  const blueMap = j().assign[0][blue.id]
  assert.notEqual(blueMap[0], blueMap[1], 'каждый играет свою тему')
  assert.equal(blueMap[1], b1.id, 'капитан — последним')

  game.hostCommand('j.next') // тема 1: от Красных — Р1, от Синих — С2
  const table = game.buildViews().pub.jeopardy.table
  assert.equal(table[red.id].playerId, r1.id)
  assert.equal(table[blue.id].playerId, b2.id)
  game.hostCommand('j.next')
  game.hostCommand('j.arm')
  time.advance(100)
  assert.equal(game.buzz(r2.id, time.now()).result, 'notAtTable', 'эту тему играет другой игрок команды')
  assert.equal(game.buildViews().me(r2.id).jeopardy.atTable, false)
  assert.equal(game.buildViews().me(r1.id).jeopardy.atTable, true)
  assert.equal(game.buzz(b2.id, time.now()).result, 'pressed')
  time.advance(300)
  game.hostCommand('j.judge', { correct: true })
  assert.equal(game.score(blue.id), 10, 'очки — команде')

  // Ведущий может заменить игрока за столом.
  game.hostCommand('j.assign.set', { teamId: red.id, themeIndex: 0, playerId: r2.id })
  game.hostCommand('j.next')
  game.hostCommand('j.arm')
  time.advance(100)
  assert.equal(game.buzz(r2.id, time.now()).result, 'pressed')
})

test('виды раундов: полуоткрытый — выбор перед темой, закрытый — темы скрыты, командирский — капитаны', async () => {
  const { game, time, red, blue, r1, r2, b1 } = sportTeams()
  game.hostCommand('game.start')
  const j = () => game.state.jeopardy
  game.hostCommand('j.assign.done')
  // Второй раунд — полуоткрытый.
  game.hostCommand('j.round', { index: 1 })
  assert.equal(game.buildViews().pub.jeopardy.kind, 'semi')
  assert.equal(j().stage, 'board')
  let pub = game.buildViews().pub.jeopardy
  assert.equal(pub.board[0].name, null, 'в полуоткрытом раунде тема не видна до начала')
  game.hostCommand('j.next')
  assert.equal(j().stage, 'assign')
  assert.equal(j().phase.scope, 'theme')
  pub = game.buildViews().pub.jeopardy
  assert.equal(pub.board[0].name, 'Тема 1', 'тему объявили перед выбором игрока')
  assert.equal(pub.board[1].name, null)
  game.playerAction(r1.id, 'assign', { themeIndex: 0, playerId: r2.id })
  game.playerAction(r1.id, 'assignReady')
  game.playerAction(b1.id, 'assignReady')
  assert.equal(j().stage, 'theme', 'оба капитана готовы — тема начинается')
  assert.equal(game.buildViews().pub.jeopardy.table[red.id].playerId, r2.id)

  // Третий раунд — закрытый: капитаны ставят игроков, не зная тем.
  game.hostCommand('j.round', { index: 2 })
  assert.equal(game.buildViews().pub.jeopardy.kind, 'closed')
  assert.equal(j().stage, 'assign')
  const cap = game.buildViews().me(r1.id).jeopardy.captain
  assert.deepEqual(
    cap.themes.map((t) => t.name),
    [null, null],
  )
  game.hostCommand('j.theme.name', { round: 2, theme: 0, name: 'Живопись' })
  assert.equal(game.buildViews().host.jeopardy.phase.themes[0].name, 'Живопись', 'ведущий видит темы')
  assert.equal(game.buildViews().me(r1.id).jeopardy.captain.themes[0].name, null, 'капитаны — нет')

  // Четвёртый — командирский: играют капитаны, выбирать никого не нужно.
  game.hostCommand('j.round', { index: 3 })
  assert.equal(game.buildViews().pub.jeopardy.kind, 'captain')
  assert.equal(j().stage, 'board')
  game.hostCommand('j.next')
  game.hostCommand('j.next')
  game.hostCommand('j.arm')
  time.advance(100)
  assert.equal(game.buzz(r2.id, time.now()).result, 'notAtTable')
  assert.equal(game.buzz(r1.id, time.now()).result, 'pressed')
  void blue

  // Ведущий меняет вид раунда, пока раунд не начался.
  game.hostCommand('j.round', { index: 1 })
  assert.throws(() => game.hostCommand('j.kind', { kind: 'bad' }), /вид/)
})

test('капитан: назначается автоматически, переходит к другому игроку, выбирается ведущим', () => {
  const { game, red, r1, r2 } = sportTeams()
  assert.equal(game.captainOf(red.id), r1.id)
  game.hostCommand('team.captain', { teamId: red.id, playerId: r2.id })
  assert.equal(game.captainOf(red.id), r2.id)
  assert.equal(game.buildViews().pub.teams.find((t) => t.id === red.id).captainId, r2.id)
  game.hostCommand('player.remove', { playerId: r2.id })
  assert.equal(game.captainOf(red.id), r1.id, 'капитан ушёл — капитаном становится другой игрок')
})

test('спортивный формат: выбор игроков переживает перезапуск сервера', async () => {
  const { game, red, r1, r2 } = sportTeams()
  game.hostCommand('game.start')
  game.playerAction(r1.id, 'assign', { themeIndex: 0, playerId: r2.id })
  const { game: g2 } = makeGame()
  await g2.restore(JSON.parse(JSON.stringify(game.serialize())))
  assert.equal(g2.state.jeopardy.stage, 'assign')
  assert.equal(g2.state.jeopardy.assign[0][red.id][0], r2.id)
  g2.hostCommand('j.assign.done')
  assert.equal(g2.state.jeopardy.stage, 'board')
})
