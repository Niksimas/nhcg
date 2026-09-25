// WebSocket-хаб: подключения ведущего, экранов и игроков; рассылка состояния; синхронизация часов.
import { WebSocketServer, WebSocket } from 'ws'
import { GameError } from './game/util.js'

const HELLO_TIMEOUT = 10_000
const DEAD_TIMEOUT = 12_000
const HEARTBEAT = 2_000

export class Hub {
  // opts: { game, hostKey, isLocalRequest(req), serverInfo() }
  constructor({ game, hostKey, isLocalRequest, serverInfo }) {
    this.game = game
    this.hostKey = hostKey
    this.isLocalRequest = isLocalRequest
    this.serverInfo = serverInfo
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false })
    this.clients = new Set()
    this.flushScheduled = false
    this.lastPingsJson = ''
    game.on('change', () => this.scheduleFlush())
    game.on('event', (e) => this.broadcastEvent(e))
    game.on('kick', (playerId) => this.kick(playerId))
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT)
    this.pingsTimer = setInterval(() => this.sendPings(), 3000)
  }

  close() {
    clearInterval(this.heartbeatTimer)
    clearInterval(this.pingsTimer)
    for (const c of this.clients) c.ws.terminate()
    this.wss.close()
  }

  handleUpgrade(req, socket, head) {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, req))
  }

  onConnection(ws, req) {
    const client = {
      ws,
      role: null,
      playerId: null,
      isLocal: this.isLocalRequest(req),
      pingAt: 0,
      rtt: null,
      lastBuzz: 0,
    }
    this.clients.add(client)
    client.helloTimer = setTimeout(() => {
      if (!client.role) ws.close(4000, 'hello timeout')
    }, HELLO_TIMEOUT)

    ws.on('message', (data, isBinary) => {
      const arrival = this.game.now()
      if (isBinary) return
      let msg
      try {
        msg = JSON.parse(data.toString())
      } catch {
        return
      }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return
      try {
        this.onMessage(client, msg, arrival)
      } catch (err) {
        this.reportError(client, err, msg)
      }
    })
    ws.on('pong', () => {
      if (!client.pingAt) return
      client.rtt = this.game.now() - client.pingAt
      client.pingAt = 0
      if (client.playerId) this.game.updatePing(client.playerId, client.rtt)
    })
    ws.on('close', () => this.onClose(client))
    ws.on('error', () => {})
  }

  onClose(client) {
    clearTimeout(client.helloTimer)
    this.clients.delete(client)
    if (client.playerId) this.game.detach(client.playerId)
    if (client.role === 'screen' || client.role === 'host') this.scheduleFlush()
  }

  send(client, obj) {
    if (client.ws.readyState === WebSocket.OPEN) client.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj))
  }

  reportError(client, err, msg) {
    const known = err instanceof GameError || err?.name === 'PackError'
    if (!known) console.error('Ошибка обработки сообщения', msg?.t, err)
    const message = known ? err.message : 'Внутренняя ошибка сервера'
    if (msg && msg.id !== undefined) this.send(client, { t: 'ack', id: msg.id, ok: false, error: message })
    else this.send(client, { t: 'error', message })
  }

  ack(client, msg, result) {
    if (msg.id !== undefined) this.send(client, { t: 'ack', id: msg.id, ok: true, result: result ?? null })
  }

  pingNow(client) {
    if (client.pingAt || client.ws.readyState !== WebSocket.OPEN) return
    client.pingAt = this.game.now()
    try {
      client.ws.ping()
    } catch {
      client.pingAt = 0
    }
  }

  onMessage(client, msg, arrival) {
    const game = this.game
    switch (msg.t) {
      case 'sync':
        // Как можно быстрее отвечаем текущим серверным временем — по нему клиент считает смещение часов.
        this.send(client, { t: 'sync', c: msg.c, s: game.now() })
        return
      case 'hello':
        this.onHello(client, msg)
        return
    }
    if (!client.role) return

    if (client.role === 'player') {
      switch (msg.t) {
        case 'buzz': {
          if (!client.playerId) return
          if (arrival - client.lastBuzz < 40) return // защита от «дребезга» и спама
          client.lastBuzz = arrival
          const at = typeof msg.at === 'number' && Number.isFinite(msg.at) ? msg.at : null
          const res = game.buzz(client.playerId, at, arrival)
          this.send(client, { t: 'buzzAck', result: res.result, until: res.until ?? null })
          return
        }
        case 'join':
          this.onJoin(client, msg)
          return
        case 'act':
          if (!client.playerId) throw new GameError('Сначала войдите в игру')
          game.playerAction(client.playerId, String(msg.name ?? ''), msg.args)
          this.ack(client, msg)
          return
        case 'leave':
          if (client.playerId) game.removePlayer(client.playerId)
          this.ack(client, msg)
          return
      }
      return
    }

    if (client.role === 'host' && msg.t === 'cmd') {
      const result = game.hostCommand(String(msg.name ?? ''), msg.args)
      if (result && typeof result.then === 'function') {
        result.then(
          () => this.ack(client, msg),
          (err) => this.reportError(client, err, msg),
        )
      } else {
        this.ack(client, msg)
      }
    }
  }

  onHello(client, msg) {
    if (client.role) return
    const role = msg.role
    if (role === 'host') {
      const key = typeof msg.key === 'string' ? msg.key.trim().toUpperCase() : ''
      if (!client.isLocal && key !== this.hostKey) {
        this.send(client, { t: 'error', code: 'auth', message: key ? 'Неверный ключ ведущего' : 'Нужен ключ ведущего' })
        client.ws.close(4001, 'auth')
        return
      }
      client.role = 'host'
    } else if (role === 'screen') {
      client.role = 'screen'
    } else if (role === 'player') {
      client.role = 'player'
      const p = this.game.playerByToken(msg.token)
      if (p) this.attachPlayer(client, p.id)
    } else {
      client.ws.close(4002, 'bad role')
      return
    }
    clearTimeout(client.helloTimer)
    this.send(client, {
      t: 'welcome',
      role: client.role,
      playerId: client.playerId,
      serverTime: this.game.now(),
    })
    this.pingNow(client)
    this.sendState(client)
    if (client.role !== 'player') this.scheduleFlush()
  }

  attachPlayer(client, playerId) {
    client.playerId = playerId
    this.game.attach(playerId)
    if (client.rtt != null) this.game.updatePing(playerId, client.rtt)
  }

  onJoin(client, msg) {
    if (client.playerId) return
    try {
      const p = this.game.join({
        name: msg.name,
        teamId: typeof msg.teamId === 'string' ? msg.teamId : null,
        newTeamName: msg.newTeamName,
        takeover: msg.takeover === true,
      })
      this.attachPlayer(client, p.id)
      this.send(client, { t: 'joined', playerId: p.id, token: p.token })
      this.sendState(client)
    } catch (err) {
      if (!(err instanceof GameError)) throw err
      this.send(client, {
        t: 'joinError',
        message: err.message,
        code: err.code ?? null,
        canTakeover: !!err.canTakeover,
        existingName: err.existingName ?? null,
      })
    }
  }

  kick(playerId) {
    for (const c of this.clients) {
      if (c.playerId !== playerId) continue
      c.playerId = null
      this.send(c, { t: 'kicked' })
    }
  }

  heartbeat() {
    const now = this.game.now()
    for (const c of this.clients) {
      if (c.pingAt && now - c.pingAt > DEAD_TIMEOUT) {
        c.ws.terminate()
        continue
      }
      this.pingNow(c)
    }
  }

  // Пинги игроков — только ведущему, отдельно от состояния (чтобы не рассылать всё каждые 2 секунды).
  sendPings() {
    const pings = {}
    for (const p of this.game.state.players) {
      const v = this.game.pingOf(p.id)
      if (v != null) pings[p.id] = Math.round(v)
    }
    const json = JSON.stringify({ t: 'pings', p: pings })
    if (json === this.lastPingsJson) return
    this.lastPingsJson = json
    for (const c of this.clients) if (c.role === 'host') this.send(c, json)
  }

  broadcastEvent(event) {
    const json = JSON.stringify({ t: 'event', name: event.name, data: event.data })
    for (const c of this.clients) if (c.role) this.send(c, json)
  }

  counts() {
    let screens = 0
    let hosts = 0
    for (const c of this.clients) {
      if (c.role === 'screen') screens++
      else if (c.role === 'host') hosts++
    }
    return { screens, hosts }
  }

  scheduleFlush() {
    if (this.flushScheduled) return
    this.flushScheduled = true
    setImmediate(() => this.flush())
  }

  buildPayloads() {
    const views = this.game.buildViews()
    const info = this.serverInfo()
    const extra = { joinUrl: info.joinUrl, ...this.counts() }
    const pub = JSON.stringify({ ...views.pub, ...extra })
    const host = JSON.stringify({ t: 'state', s: { ...views.host, ...extra, server: info } })
    return { views, pub, host }
  }

  flush() {
    this.flushScheduled = false
    if (!this.clients.size) return
    const { views, pub, host } = this.buildPayloads()
    for (const c of this.clients) this.sendPayload(c, views, pub, host)
  }

  sendState(client) {
    const { views, pub, host } = this.buildPayloads()
    this.sendPayload(client, views, pub, host)
  }

  sendPayload(c, views, pub, host) {
    if (c.role === 'host') this.send(c, host)
    else if (c.role === 'screen') this.send(c, `{"t":"state","s":${pub}}`)
    else if (c.role === 'player') {
      const me = c.playerId ? views.me(c.playerId) : null
      this.send(c, `{"t":"state","s":${pub},"me":${JSON.stringify(me)}}`)
    }
  }
}
