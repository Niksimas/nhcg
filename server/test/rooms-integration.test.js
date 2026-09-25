// Режим комнат по-настоящему: сервер с --rooms, создание комнат по HTTP, подключение по коду.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, WsClient } from './server-helpers.js'

let srv

before(async () => {
  srv = await startServer(['--rooms', '--room-create-limit', '5'])
})

after(async () => {
  await srv?.stop()
})

const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function createRoom() {
  const res = await fetch(`${srv.url}/api/rooms`, json({}))
  assert.equal(res.status, 200)
  return res.json()
}

test('создание комнаты, вход по коду и права ведущего', async () => {
  const info = await (await fetch(`${srv.url}/api/info`)).json()
  assert.equal(info.mode, 'rooms')
  assert.equal(info.defaultRoom, null)

  const { code, hostKey } = await createRoom()
  assert.match(code, /^\d{6}$/)

  const found = await fetch(`${srv.url}/api/rooms/${code.slice(0, 3)}-${code.slice(3)}`)
  assert.equal(found.status, 200)
  assert.equal((await found.json()).code, code)
  const missing = code === '999999' ? '999998' : '999999'
  assert.equal((await fetch(`${srv.url}/api/rooms/${missing}`)).status, 404)

  // Неизвестная комната — понятная ошибка вместо обрыва связи.
  const lost = new WsClient(srv.port, 'player', {}, missing)
  await lost.connect()
  const err = await lost.wait((m) => m.t === 'error')
  assert.equal(err.code, 'room_not_found')
  const noCode = new WsClient(srv.port, 'player')
  await noCode.connect()
  assert.equal((await noCode.wait((m) => m.t === 'error')).code, 'room_not_found')

  // Ведущий без ключа не пускается даже с этого же компьютера.
  const intruder = new WsClient(srv.port, 'host', {}, code)
  assert.equal((await intruder.open()).code, 'auth')

  const host = new WsClient(srv.port, 'host', { key: hostKey.toLowerCase() }, code)
  const welcome = await host.open()
  assert.equal(welcome.t, 'welcome')
  assert.equal(welcome.room.code, code)
  await host.waitState((s) => !!s.server)
  assert.ok(host.state.server.joinUrl.endsWith(`/r/${code}`))
  assert.equal(host.state.server.dataDir, null)

  const screen = new WsClient(srv.port, 'screen', {}, code)
  await screen.open()
  await screen.waitState((s) => s.room?.code === code)

  // Закрытый вход: новые игроки не могут войти.
  const anna = new WsClient(srv.port, 'player', {}, code)
  await anna.open()
  anna.send({ t: 'join', name: 'Аня' })
  await anna.wait((m) => m.t === 'joined')
  await host.cmd('settings.update', { patch: { joinLocked: true } })
  assert.equal((await (await fetch(`${srv.url}/api/rooms/${code}`)).json()).joinLocked, true)
  const late = new WsClient(srv.port, 'player', {}, code)
  await late.open()
  late.send({ t: 'join', name: 'Опоздавший' })
  assert.match((await late.wait((m) => m.t === 'joinError')).message, /закрыл вход/)
  await host.cmd('settings.update', { patch: { joinLocked: false } })
  late.send({ t: 'join', name: 'Опоздавший' })
  const lateId = (await late.wait((m) => m.t === 'joined')).playerId

  // Устройство игрока становится вторым пультом ведущего.
  await host.cmd('player.promote', { playerId: lateId, role: 'host' })
  const promo = await late.wait((m) => m.t === 'promote')
  assert.equal(promo.role, 'host')
  assert.equal(promo.hostKey, hostKey)
  await host.waitState((s) => !s.players.some((p) => p.id === lateId))

  // Ведущий удаляет комнату — все устройства получают сообщение.
  assert.equal((await fetch(`${srv.url}/api/rooms/${code}`, { method: 'DELETE' })).status, 403)
  const del = await fetch(`${srv.url}/api/rooms/${code}`, { method: 'DELETE', headers: { 'x-host-key': hostKey } })
  assert.equal(del.status, 200)
  const closed = await anna.wait((m) => m.t === 'error')
  assert.equal(closed.code, 'room_closed')
  await screen.wait((m) => m.t === 'error' && m.code === 'room_closed')
  assert.equal((await fetch(`${srv.url}/api/rooms/${code}`)).status, 404)
  for (const c of [lost, noCode, intruder, host, screen, anna, late]) c.close()
})

test('комнаты независимы: ключ одной комнаты не подходит к другой', async () => {
  const a = await createRoom()
  const b = await createRoom()
  const c = await createRoom()
  const del = (room, key) => fetch(`${srv.url}/api/rooms/${room.code}`, { method: 'DELETE', headers: { 'x-host-key': key } })
  assert.equal((await del(a, b.hostKey)).status, 403, 'ключ другой комнаты не подходит')
  const host = new WsClient(srv.port, 'host', { key: b.hostKey }, b.code)
  await host.open()
  await host.cmd('game.start')
  await host.waitState((s) => s.jeopardy?.stage === 'board' || s.jeopardy?.stage === 'assign')
  host.close()
  assert.equal((await del(c, c.hostKey)).status, 200)
  assert.equal((await fetch(`${srv.url}/api/rooms/${c.code}`)).status, 404)
  assert.equal((await fetch(`${srv.url}/api/rooms/${a.code}`)).status, 200)
})

test('игра по интернету: кнопки открываются у всех одновременно', async () => {
  const room = await createRoom()
  const host = new WsClient(srv.port, 'host', { key: room.hostKey }, room.code)
  await host.open()
  const p = new WsClient(srv.port, 'player', {}, room.code)
  await p.open()
  p.send({ t: 'join', name: 'Игрок' })
  await p.wait((m) => m.t === 'joined')
  await host.cmd('settings.update', { patch: { onlineMode: true, jFormat: 'tv' } })
  await host.cmd('game.start')
  await host.cmd('j.select', { id: '0:0:0' })
  await p.waitState((s) => s.jeopardy?.question?.step === 'reading')

  const before = await p.serverTime()
  await host.cmd('j.arm')
  const armed = await p.wait((m) => m.t === 'event' && m.name === 'armed')
  const at = armed.data.at
  assert.ok(at - before >= 350, `кнопки открываются с задержкой для синхронного старта (${Math.round(at - before)} мс)`)
  await p.waitState((s) => s.buzzer.status === 'armed' && s.buzzer.armedAt === at)
  // Нажатие до сигнала — ранний (кнопка блокируется на секунду), как в «Своей игре».
  p.send({ t: 'buzz', at: await p.serverTime() })
  assert.equal((await p.wait((m) => m.t === 'buzzAck')).result, 'early')
  host.close()
  p.close()
})

test('после перезапуска сервера комната, счёт и игроки на месте', async () => {
  const first = await startServer(['--rooms'])
  let second = null
  try {
    const res = await fetch(`${first.url}/api/rooms`, json({}))
    const room = await res.json()
    const host = new WsClient(first.port, 'host', { key: room.hostKey }, room.code)
    await host.open()
    const p = new WsClient(first.port, 'player', {}, room.code)
    await p.open()
    p.send({ t: 'join', name: 'Аня' })
    const joined = await p.wait((m) => m.t === 'joined')
    await host.cmd('score.set', { competitorId: joined.playerId, value: 700 })
    host.close()
    p.close()
    await first.stop({ keepData: true })

    second = await startServer(['--rooms'], { dataDir: first.dataDir })
    const again = new WsClient(second.port, 'player', { token: joined.token }, room.code)
    const welcome = await again.open()
    assert.equal(welcome.t, 'welcome')
    assert.equal(welcome.playerId, joined.playerId, 'игрок узнан по сохранённому токену')
    await again.waitState((s, me) => me?.score === 700)
    const host2 = new WsClient(second.port, 'host', { key: room.hostKey }, room.code)
    assert.equal((await host2.open()).t, 'welcome', 'ключ ведущего прежний')
    again.close()
    host2.close()
  } finally {
    if (second) await second.stop()
    else await first.stop()
  }
})

test('ограничение частоты создания комнат', async () => {
  // Лимит 5 за 10 минут; 5 комнат уже созданы предыдущими тестами этого файла.
  const res = await fetch(`${srv.url}/api/rooms`, json({}))
  assert.equal(res.status, 429)
  assert.match((await res.json()).error, /Слишком много/)
})
