// Проверка хаба без сети: поддельные сокеты, ведущий «с другого устройства».
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Hub } from '../hub.js'
import { makeGame } from './helpers.js'

class FakeWs extends EventEmitter {
  constructor() {
    super()
    this.readyState = 1
    this.sent = []
    this.closed = null
  }
  send(data) {
    this.sent.push(JSON.parse(data))
  }
  close(code, reason) {
    this.closed = { code, reason }
    this.readyState = 3
    this.emit('close')
  }
  terminate() {
    this.close(1006, 'terminated')
  }
  ping() {}
  msg(obj) {
    this.emit('message', Buffer.from(JSON.stringify(obj)), false)
  }
  last(type) {
    return [...this.sent].reverse().find((m) => m.t === type)
  }
}

function setup({ local = false } = {}) {
  const { game } = makeGame()
  const hub = new Hub({
    game,
    hostKey: 'SECRET42',
    isLocalRequest: () => local,
    serverInfo: () => ({ joinUrl: 'http://10.0.0.5:3000/', addresses: [], port: 3000, hostKey: 'SECRET42', hostUrl: '' }),
  })
  const connect = () => {
    const ws = new FakeWs()
    hub.onConnection(ws, {})
    return ws
  }
  return { game, hub, connect }
}

test('ведущий с чужого устройства без ключа не пускается', () => {
  const { hub, connect } = setup({ local: false })
  const ws = connect()
  ws.msg({ t: 'hello', role: 'host' })
  assert.equal(ws.last('error').code, 'auth')
  assert.equal(ws.closed.code, 4001)
  const ws2 = connect()
  ws2.msg({ t: 'hello', role: 'host', key: 'WRONG' })
  assert.equal(ws2.last('error').code, 'auth')
  assert.match(ws2.last('error').message, /Неверный ключ/)
  const ws3 = connect()
  ws3.msg({ t: 'hello', role: 'host', key: ' secret42 ' })
  assert.equal(ws3.last('welcome').role, 'host', 'ключ не зависит от регистра и пробелов')
  hub.close()
})

test('ведущий с ключом получает полное состояние', async () => {
  const { hub, connect } = setup({ local: false })
  const ws = connect()
  ws.msg({ t: 'hello', role: 'host', key: 'SECRET42' })
  assert.equal(ws.last('welcome').role, 'host')
  const state = ws.last('state').s
  assert.equal(state.server.hostKey, 'SECRET42')
  assert.equal(state.joinUrl, 'http://10.0.0.5:3000/')
  hub.close()
})

test('локальный ведущий входит без ключа, игрок не может отдавать команды ведущего', async () => {
  const { game, hub, connect } = setup({ local: true })
  const host = connect()
  host.msg({ t: 'hello', role: 'host' })
  assert.equal(host.last('welcome').role, 'host')

  const player = connect()
  player.msg({ t: 'hello', role: 'player' })
  assert.equal(player.last('welcome').playerId, null)
  player.msg({ t: 'join', name: 'Игрок' })
  const joined = player.last('joined')
  assert.ok(joined.token)
  player.msg({ t: 'cmd', name: 'score.reset', id: 1 })
  assert.equal(player.last('ack'), undefined, 'команда игрока проигнорирована')

  host.msg({ t: 'cmd', name: 'score.add', args: { competitorId: joined.playerId, delta: 50 }, id: 7 })
  assert.deepEqual(host.last('ack'), { t: 'ack', id: 7, ok: true, result: null })
  assert.equal(game.score(joined.playerId), 50)

  host.msg({ t: 'cmd', name: 'j.arm', id: 8 })
  const bad = host.last('ack')
  assert.equal(bad.ok, false)
  assert.match(bad.error, /начните игру/)

  // Мусор не роняет хаб
  host.emit('message', Buffer.from('не json'), false)
  host.emit('message', Buffer.from([1, 2, 3]), true)
  host.msg({ t: 'cmd', name: 'нет-такой', id: 9 })
  assert.equal(host.last('ack').ok, false)
  hub.close()
})

test('синхронизация часов отвечает серверным временем', () => {
  const { game, hub, connect } = setup()
  const ws = connect()
  ws.msg({ t: 'sync', c: 123.5 })
  const reply = ws.last('sync')
  assert.equal(reply.c, 123.5)
  assert.equal(reply.s, game.now())
  hub.close()
})

test('игрок переподключается по токену, отключение отмечается', async () => {
  const { game, hub, connect } = setup()
  const a = connect()
  a.msg({ t: 'hello', role: 'player' })
  a.msg({ t: 'join', name: 'Аня' })
  const { token, playerId } = a.last('joined')
  assert.equal(game.isConnected(playerId), true)
  a.close()
  assert.equal(game.isConnected(playerId), false)
  const b = connect()
  b.msg({ t: 'hello', role: 'player', token })
  assert.equal(b.last('welcome').playerId, playerId)
  assert.equal(game.isConnected(playerId), true)
  hub.close()
})

test('удалённый ведущим игрок получает kicked', async () => {
  const { hub, connect } = setup({ local: true })
  const host = connect()
  host.msg({ t: 'hello', role: 'host' })
  const p = connect()
  p.msg({ t: 'hello', role: 'player' })
  p.msg({ t: 'join', name: 'Уходящий' })
  const { playerId } = p.last('joined')
  host.msg({ t: 'cmd', name: 'player.remove', args: { playerId }, id: 1 })
  assert.ok(p.last('kicked'))
  p.msg({ t: 'buzz', at: 1 })
  assert.equal(p.last('buzzAck'), undefined, 'после удаления нажатия не принимаются')
  hub.close()
})
