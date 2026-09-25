// Подключение к серверу по WebSocket: автопереподключение, синхронизация часов, запросы с ответом.
import { ref, shallowRef } from 'vue'
import type { GameState, MeView, Role } from './types'
import { room, wsPath } from './room'

// noroom — комнаты нет или её закрыли (переподключаться бессмысленно).
export type ConnStatus = 'connecting' | 'online' | 'offline' | 'auth' | 'noroom'

interface Sample {
  rtt: number
  offset: number
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (msg: any) => void

export class GameConnection {
  readonly status = ref<ConnStatus>('connecting')
  readonly state = shallowRef<GameState | null>(null)
  readonly me = shallowRef<MeView | null>(null)
  readonly playerId = ref<string | null>(null)
  readonly rtt = ref<number | null>(null)
  readonly pings = shallowRef<Record<string, number>>({})
  readonly errorMessage = ref<string | null>(null)

  // Смещение серверных часов относительно performance.now() этого устройства.
  offset = 0
  synced = false

  private ws: WebSocket | null = null
  private samples: Sample[] = []
  private retry = 0
  private reconnectTimer = 0
  private syncTimer = 0
  private burstTimer = 0
  private lastMessageAt = 0
  private stopped = true
  private handlers = new Map<string, Set<Handler>>()
  private pending = new Map<number, Pending>()
  private seq = 0

  // Код комнаты фиксируется при создании: у каждой страницы — своё подключение.
  readonly roomCode: string | null = room.code

  constructor(
    readonly role: Role,
    private helloExtra: () => Record<string, unknown> = () => ({}),
  ) {}

  start() {
    if (!this.stopped) return
    this.stopped = false
    this.connect()
    document.addEventListener('visibilitychange', this.onWake)
    window.addEventListener('online', this.onWake)
    window.addEventListener('pageshow', this.onWake)
  }

  stop() {
    this.stopped = true
    document.removeEventListener('visibilitychange', this.onWake)
    window.removeEventListener('online', this.onWake)
    window.removeEventListener('pageshow', this.onWake)
    clearTimeout(this.reconnectTimer)
    this.dropSocket(false)
  }

  // Переподключиться сразу (например, после ввода ключа ведущего).
  reconnectNow() {
    this.retry = 0
    this.dropSocket(false)
    this.connect()
  }

  serverNow(): number {
    return performance.now() + this.offset
  }

  toServerTime(localTime: number): number {
    return localTime + this.offset
  }

  on(type: string, fn: Handler): () => void {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    set.add(fn)
    return () => set.delete(fn)
  }

  send(msg: Record<string, unknown>): boolean {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    ws.send(JSON.stringify(msg))
    return true
  }

  request<T = unknown>(msg: Record<string, unknown>, timeout = 15000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = ++this.seq
      const timer = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Сервер не ответил'))
      }, timeout)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      if (!this.send({ ...msg, id })) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new Error('Нет связи с сервером'))
      }
    })
  }

  // Команда ведущего.
  cmd(name: string, args?: Record<string, unknown>) {
    return this.request({ t: 'cmd', name, args })
  }

  // Действие игрока.
  act(name: string, args?: Record<string, unknown>) {
    return this.request({ t: 'act', name, args })
  }

  private onWake = () => {
    if (this.stopped || document.visibilityState === 'hidden' || this.status.value === 'noroom') return
    const ws = this.ws
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      this.retry = 0
      clearTimeout(this.reconnectTimer)
      this.dropSocket(false)
      this.connect()
    } else if (ws.readyState === WebSocket.OPEN) {
      this.sendSync()
    }
  }

  private connect() {
    clearTimeout(this.reconnectTimer)
    if (this.stopped || this.ws) return
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    let ws: WebSocket
    try {
      ws = new WebSocket(`${proto}//${location.host}${wsPath(this.roomCode)}`)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = ws
    if (!this.isFinal()) this.status.value = 'connecting'
    ws.onopen = () => {
      this.samples = []
      this.lastMessageAt = performance.now()
      this.send({ t: 'hello', role: this.role, ...this.helloExtra() })
      this.startSync()
    }
    ws.onmessage = (ev) => {
      this.lastMessageAt = performance.now()
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      this.handle(msg)
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.dropSocket(!this.isFinal())
    }
    ws.onerror = () => {}
  }

  private dropSocket(reconnect: boolean) {
    const ws = this.ws
    clearInterval(this.syncTimer)
    clearTimeout(this.burstTimer)
    if (ws) {
      this.ws = null
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
      try {
        ws.close()
      } catch {
        // уже закрыт
      }
    }
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error('Нет связи с сервером'))
      this.pending.delete(id)
    }
    if (!this.isFinal()) this.status.value = 'offline'
    if (reconnect) this.scheduleReconnect()
  }

  // Состояния, из которых не выходим сами: нужен ключ ведущего или комнаты больше нет.
  private isFinal() {
    return this.status.value === 'auth' || this.status.value === 'noroom'
  }

  private scheduleReconnect(minDelay = 0) {
    if (this.stopped) return
    clearTimeout(this.reconnectTimer)
    const delay = Math.max(minDelay, Math.min(3000, 250 * 2 ** this.retry)) + Math.random() * 250
    this.retry++
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay)
  }

  private sendSync() {
    this.send({ t: 'sync', c: performance.now() })
  }

  private startSync() {
    let n = 0
    const burst = () => {
      this.sendSync()
      if (++n < 8) this.burstTimer = window.setTimeout(burst, 100)
    }
    burst()
    clearInterval(this.syncTimer)
    this.syncTimer = window.setInterval(() => {
      // Если сервер долго молчит — соединение «повисло» (например, телефон уснул), переподключаемся.
      if (performance.now() - this.lastMessageAt > 7000) {
        this.dropSocket(true)
        return
      }
      this.sendSync()
    }, 1500)
  }

  private onSync(c: number, s: number) {
    const now = performance.now()
    const rtt = now - c
    if (!(rtt >= 0 && rtt < 10000)) return
    this.samples.push({ rtt, offset: s - (c + now) / 2 })
    if (this.samples.length > 16) this.samples.shift()
    // Самый быстрый обмен — самый точный (меньше всего влияния очередей и энергосбережения Wi-Fi).
    let best = this.samples[0]
    for (const smp of this.samples) if (smp.rtt < best.rtt) best = smp
    this.offset = best.offset
    this.synced = true
    const sorted = this.samples.map((x) => x.rtt).sort((a, b) => a - b)
    this.rtt.value = Math.round(sorted[Math.floor(sorted.length / 2)])
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handle(msg: any) {
    switch (msg.t) {
      case 'sync':
        this.onSync(msg.c, msg.s)
        break
      case 'welcome':
        this.retry = 0
        this.status.value = 'online'
        this.errorMessage.value = null
        this.playerId.value = msg.playerId ?? null
        if (!this.synced && typeof msg.serverTime === 'number') this.offset = msg.serverTime - performance.now()
        break
      case 'joined':
        this.playerId.value = msg.playerId
        break
      case 'kicked':
        this.playerId.value = null
        this.me.value = null
        break
      case 'state':
        this.state.value = msg.s
        if ('me' in msg) this.me.value = msg.me
        break
      case 'pings':
        this.pings.value = msg.p ?? {}
        break
      case 'ack': {
        const p = this.pending.get(msg.id)
        if (p) {
          clearTimeout(p.timer)
          this.pending.delete(msg.id)
          if (msg.ok) p.resolve(msg.result)
          else p.reject(new Error(msg.error || 'Ошибка'))
        }
        break
      }
      case 'error':
        this.errorMessage.value = msg.message ?? 'Ошибка'
        if (msg.code === 'auth') this.status.value = 'auth'
        if (msg.code === 'room_not_found' || msg.code === 'room_closed') {
          this.status.value = 'noroom'
          clearTimeout(this.reconnectTimer)
        }
        if (msg.code === 'rate_limited') {
          // Слишком много попыток — подождём подольше.
          this.dropSocket(false)
          this.scheduleReconnect(30_000)
        }
        break
    }
    const set = this.handlers.get(msg.t)
    if (set) for (const fn of [...set]) fn(msg)
  }
}
