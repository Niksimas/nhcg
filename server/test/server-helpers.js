// Общие помощники интеграционных тестов: запуск настоящего сервера и WebSocket-клиент.
import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// Запускает сервер в отдельном процессе с временной папкой данных (или с указанной — для проверки перезапуска).
export async function startServer(args = [], { dataDir: existingDir = null } = {}) {
  const dataDir = existingDir ?? (await fsp.mkdtemp(path.join(os.tmpdir(), 'quiz-int-')))
  let port = 40000 + Math.floor(Math.random() * 20000)
  const proc = spawn(process.execPath, ['server/index.js', '--no-open', '--port', String(port), '--data', dataDir, ...args], {
    cwd: root,
    env: { ...process.env, NO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${log}`)), 60000)
    const onData = (d) => {
      log += d.toString()
      const m = /localhost:(\d+)\//.exec(log)
      if (m) {
        port = Number(m[1])
        clearTimeout(timer)
        resolve()
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', (d) => (log += d.toString()))
    proc.on('exit', (code) => reject(new Error(`server exited with ${code}:\n${log}`)))
  })
  return {
    proc,
    port,
    dataDir,
    url: `http://localhost:${port}`,
    log: () => log,
    // keepData — оставить папку данных (сервер перезапустят на ней же).
    async stop({ keepData = false } = {}) {
      if (proc.exitCode === null) {
        const exited = new Promise((r) => proc.once('exit', r))
        proc.kill('SIGTERM')
        await exited
      }
      if (!keepData) await fsp.rm(dataDir, { recursive: true, force: true })
    },
  }
}

export class WsClient {
  // room — код комнаты (без него — основная комната режима «одна игра»).
  constructor(port, role, extra = {}, room = null) {
    this.port = port
    this.room = room
    this.role = role
    this.extra = extra
    this.messages = []
    this.waiters = []
    this.seq = 0
    this.state = null
    this.me = null
    this.closeCode = null
  }

  async connect() {
    const query = this.room ? `?room=${encodeURIComponent(this.room)}` : ''
    this.ws = new WebSocket(`ws://localhost:${this.port}/ws${query}`)
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
    this.ws.on('close', (code) => (this.closeCode = code))
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve)
      this.ws.once('error', reject)
    })
  }

  // Подключиться и представиться; возвращает welcome или error.
  async open() {
    await this.connect()
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
