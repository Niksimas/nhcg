// Интеграционный тест: настоящий сервер, настоящие WebSocket-подключения ведущего и игроков.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
let server
let port
let dataDir

class Client {
  constructor(role, extra = {}) {
    this.role = role
    this.extra = extra
    this.messages = []
    this.waiters = []
    this.seq = 0
    this.state = null
    this.me = null
  }

  async open() {
    this.ws = new WebSocket(`ws://localhost:${port}/ws`)
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.t === 'state') {
        this.state = msg.s
        if ('me' in msg) this.me = msg.me
      }
      this.messages.push(msg)
      for (const w of [...this.waiters]) {
        if (w.pred(msg)) {
          this.waiters.splice(this.waiters.indexOf(w), 1)
          clearTimeout(w.timer)
          w.resolve(msg)
        }
      }
    })
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve)
      this.ws.once('error', reject)
    })
    this.send({ t: 'hello', role: this.role, ...this.extra })
    return this.wait((m) => m.t === 'welcome' || m.t === 'error')
  }

  send(msg) {
    this.ws.send(JSON.stringify(msg))
  }

  wait(pred, ms = 4000) {
    const found = this.messages.find(pred)
    if (found) {
      this.messages.splice(this.messages.indexOf(found), 1)
      return Promise.resolve(found)
    }
    return new Promise((resolve, reject) => {
      const w = { pred, resolve, timer: setTimeout(() => reject(new Error('timeout waiting for message')), ms) }
      this.waiters.push(w)
    })
  }

  // Ждём состояние, удовлетворяющее условию (проверяем и текущее).
  async waitState(pred, ms = 4000) {
    if (this.state && pred(this.state, this.me)) return this.state
    await this.wait((m) => m.t === 'state' && pred(m.s, 'me' in m ? m.me : this.me), ms)
    return this.state
  }

  async cmd(name, args) {
    const id = ++this.seq
    this.send({ t: 'cmd', name, args, id })
    const ack = await this.wait((m) => m.t === 'ack' && m.id === id)
    if (!ack.ok) throw new Error(ack.error)
    return ack
  }

  async act(name, args) {
    const id = ++this.seq
    this.send({ t: 'act', name, args, id })
    const ack = await this.wait((m) => m.t === 'ack' && m.id === id)
    if (!ack.ok) throw new Error(ack.error)
    return ack
  }

  async serverTime() {
    const c = performance.now()
    this.send({ t: 'sync', c })
    const msg = await this.wait((m) => m.t === 'sync' && m.c === c)
    const now = performance.now()
    return msg.s + (now - c) / 2
  }

  close() {
    this.ws?.close()
  }
}

before(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'quiz-int-'))
  port = 40000 + Math.floor(Math.random() * 20000)
  server = spawn(process.execPath, ['server/index.js', '--no-open', '--port', String(port), '--data', dataDir], {
    cwd: root,
    env: { ...process.env, NO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${log}`)), 60000)
    const onData = (d) => {
      log += d.toString()
      const m = /localhost:(\d+)\/host/.exec(log)
      if (m) {
        port = Number(m[1])
        clearTimeout(timer)
        resolve()
      }
    }
    server.stdout.on('data', onData)
    server.stderr.on('data', (d) => (log += d.toString()))
    server.on('exit', (code) => reject(new Error(`server exited with ${code}:\n${log}`)))
  })
})

after(async () => {
  server?.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 300))
  await fsp.rm(dataDir, { recursive: true, force: true })
})

test('полный цикл: ведущий, два игрока, «Своя игра» и переподключение', async () => {
  const host = new Client('host')
  const welcome = await host.open()
  assert.equal(welcome.t, 'welcome')
  assert.equal(welcome.role, 'host')
  await host.waitState((s) => s.stage === 'lobby' && typeof s.joinUrl === 'string')
  assert.ok(host.state.server.hostKey, 'ведущий получает ключ для удалённого управления')

  const screen = new Client('screen')
  await screen.open()
  await screen.waitState((s) => !!s)
  assert.equal(screen.state.server, undefined, 'экран не получает служебную информацию')

  const anna = new Client('player')
  const w1 = await anna.open()
  assert.equal(w1.playerId, null)
  anna.send({ t: 'join', name: 'Аня' })
  const joined = await anna.wait((m) => m.t === 'joined')
  assert.ok(joined.token)

  const boris = new Client('player')
  await boris.open()
  boris.send({ t: 'join', name: 'аня' })
  const err = await boris.wait((m) => m.t === 'joinError')
  assert.equal(err.code, 'nameTaken')
  boris.send({ t: 'join', name: 'Борис' })
  await boris.wait((m) => m.t === 'joined')

  await host.waitState((s) => s.players.length === 2 && s.players.every((p) => p.connected))

  // Проверка кнопки в лобби
  anna.send({ t: 'buzz', at: await anna.serverTime() })
  const ack = await anna.wait((m) => m.t === 'buzzAck')
  assert.equal(ack.result, 'test')
  await host.wait((m) => m.t === 'event' && m.name === 'test')

  await host.cmd('pack.load', { packId: 'demo-svoya-igra' })
  await host.cmd('game.start')
  await host.waitState((s) => s.stage === 'game' && s.jeopardy?.stage === 'board')
  await host.cmd('j.select', { id: '0:0:0' })
  await anna.waitState((s) => s.jeopardy?.question?.step === 'reading')
  assert.equal(anna.state.jeopardy.question.answer, null, 'игрок не видит ответ')
  assert.ok(host.state.jeopardy.question.answer, 'ведущий видит ответ')

  await host.cmd('j.arm')
  await anna.waitState((s) => s.buzzer.status === 'armed')
  await boris.waitState((s) => s.buzzer.status === 'armed')
  // Борис жмёт чуть позже Ани, но его сообщение уходит первым.
  const annaAt = await anna.serverTime()
  await new Promise((r) => setTimeout(r, 30))
  boris.send({ t: 'buzz', at: await boris.serverTime() })
  anna.send({ t: 'buzz', at: annaAt })
  await host.waitState((s) => s.buzzer.status === 'answering')
  const annaId = anna.me.playerId
  assert.equal(host.state.buzzer.winner.competitorId, annaId, 'побеждает нажавший раньше, а не тот, чьё сообщение пришло первым')
  const meB = (await boris.waitState((s, me) => s.buzzer.status === 'answering' && me?.rank === 2), boris.me)
  assert.ok(meB.delta >= 20, `отставание Бориса ${meB.delta} мс`)

  await host.cmd('j.judge', { correct: true })
  await anna.waitState((s, me) => me?.score === 100)
  assert.equal(anna.state.jeopardy.question.answer !== null, true, 'после ответа он открыт всем')

  // Переподключение с тем же токеном
  anna.close()
  await host.waitState((s) => s.players.some((p) => p.id === annaId && !p.connected))
  const again = new Client('player', { token: joined.token })
  const w2 = await again.open()
  assert.equal(w2.playerId, annaId)
  await again.waitState((s, me) => me?.score === 100)
  await host.waitState((s) => s.players.every((p) => p.connected))

  // Ошибочная команда даёт понятную ошибку
  await assert.rejects(host.cmd('j.judge', { correct: true }), /никто не отвечает/)

  // Игроку команды ведущего недоступны
  again.send({ t: 'cmd', name: 'score.reset', id: 1 })
  await new Promise((r) => setTimeout(r, 150))
  assert.equal(host.state.competitors.find((c) => c.id === annaId).score, 100)

  // Удаление игрока
  await host.cmd('player.remove', { playerId: boris.me.playerId })
  await boris.wait((m) => m.t === 'kicked')

  for (const c of [host, screen, again, boris]) c.close()
})

test('«Брейн-ринг» по сети: фальстарт и «Время!»', async () => {
  const host = new Client('host')
  await host.open()
  await host.cmd('game.reset', { keepPlayers: false })
  await host.cmd('mode.set', { mode: 'brainring' })
  const a = new Client('player')
  await a.open()
  a.send({ t: 'join', name: 'Альфа' })
  await a.wait((m) => m.t === 'joined')
  const b = new Client('player')
  await b.open()
  b.send({ t: 'join', name: 'Бета' })
  await b.wait((m) => m.t === 'joined')

  await host.cmd('game.start')
  await host.cmd('br.next')
  await a.waitState((s) => s.brainring?.stage === 'reading')
  a.send({ t: 'buzz', at: await a.serverTime() })
  const fs = await a.wait((m) => m.t === 'buzzAck')
  assert.equal(fs.result, 'falseStart')
  await host.wait((m) => m.t === 'event' && m.name === 'falseStart')

  await host.cmd('br.start')
  await b.waitState((s) => s.buzzer.status === 'armed')
  b.send({ t: 'buzz', at: await b.serverTime() })
  await host.waitState((s) => s.brainring?.stage === 'answering')
  await host.cmd('br.judge', { correct: true })
  await b.waitState((s, me) => me?.score === 1)
  for (const c of [host, a, b]) c.close()
})

test('HTTP: пакеты, медиа и защита путей', async () => {
  const base = `http://localhost:${port}`
  const list = await (await fetch(`${base}/api/packs`)).json()
  assert.ok(list.some((p) => p.id === 'demo-svoya-igra'))
  const media = await fetch(`${base}/media/demo-svoya-igra/flag-1.svg`)
  assert.equal(media.status, 200)
  const evil = await fetch(`${base}/media/demo-svoya-igra/..%2Fpack.json`)
  assert.equal(evil.status, 404)
  const created = await (
    await fetch(`${base}/api/packs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  ).json()
  assert.ok(created.id)
  const bad = await fetch(`${base}/api/packs/${created.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: '"строка"',
  })
  assert.equal(bad.status, 400)
  const page = await fetch(`${base}/screen`)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /<div id="app">/)
})
