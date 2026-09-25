// Комнаты: несколько независимых игр на одном сервере.
//
// Режим «local» (по умолчанию): одна игра, ведущий — компьютер, на котором запущен сервер.
// Режим «rooms»: любой может создать комнату (станет её ведущим) и получить 6-значный код,
// по которому к ней подключаются игроки и экраны — в локальной сети или через интернет.
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes, randomInt } from 'node:crypto'
import { Game } from './game/game.js'
import { Hub } from './hub.js'
import { getLanAddresses, isLocalAddress } from './net.js'

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export class RoomError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'RoomError'
    this.status = status
  }
}

export function normalizeCode(code) {
  return String(code ?? '').replace(/\D/g, '').slice(0, 6)
}

export function isValidCode(code) {
  return /^\d{6}$/.test(code)
}

export function newHostKey(length = 10) {
  return [...randomBytes(length)].map((b) => KEY_ALPHABET[b % KEY_ALPHABET.length]).join('')
}

// Запрос пришёл через обратный прокси или туннель (nginx, Caddy, cloudflared, ngrok…)?
export function isProxied(req) {
  const h = req.headers ?? {}
  return !!(h['x-forwarded-for'] || h.forwarded || h['x-real-ip'] || h['cf-connecting-ip'] || h['x-forwarded-host'])
}

// Заголовок Host указывает на сам компьютер: localhost или один из его IP-адресов (не доменное имя).
export function isLocalHostHeader(host) {
  const m = /^(?:\[([^\]]+)\]|([^:]+))(?::\d+)?$/.exec(String(host ?? '').trim())
  if (!m) return false
  const name = (m[1] ?? m[2]).toLowerCase()
  return name === 'localhost' || isLocalAddress(name)
}

// Адрес сайта, как его видит пользователь (для ссылки и QR-кода). null — если это localhost.
export function originFromRequest(req) {
  const h = req.headers ?? {}
  const host = String(h['x-forwarded-host'] ?? h.host ?? '').split(',')[0].trim()
  if (!host || /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/i.test(host)) return null
  const proto = String(h['x-forwarded-proto'] ?? (req.socket?.encrypted ? 'https' : 'http')).split(',')[0].trim()
  return `${proto === 'https' ? 'https' : 'http'}://${host}`
}

function writeJsonAtomicSync(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${randomBytes(3).toString('hex')}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data))
  fs.renameSync(tmp, file)
}

export class Room {
  constructor(manager, meta) {
    this.manager = manager
    this.code = meta.code
    this.hostKey = meta.hostKey
    this.createdAt = meta.createdAt ?? Date.now()
    this.lastActive = meta.lastActive ?? Date.now()
    this.isDefault = !!meta.isDefault
    this.originHint = meta.originHint ?? null
    this.dir = path.join(manager.roomsDir, this.code)
    this.closed = false
    this.game = new Game({
      persist: { save: (data) => this.saveState(data) },
    })
    this.hub = new Hub({
      game: this.game,
      hostKey: this.hostKey,
      isLocalRequest: (req) => manager.isTrustedLocal(req, this),
      serverInfo: () => manager.serverInfo(this),
      roomInfo: () => ({ code: this.code, mode: manager.mode, isDefault: this.isDefault }),
      onActivity: () => this.touch(),
      onHostConnect: (req) => this.noteOrigin(req),
    })
  }

  touch() {
    this.lastActive = Date.now()
  }

  noteOrigin(req) {
    const origin = originFromRequest(req)
    if (origin && origin !== this.originHint) {
      this.originHint = origin
      this.saveMeta()
      this.game.changed()
    }
  }

  meta() {
    return {
      code: this.code,
      hostKey: this.hostKey,
      createdAt: this.createdAt,
      lastActive: this.lastActive,
      isDefault: this.isDefault,
      originHint: this.originHint,
    }
  }

  saveMeta() {
    if (this.closed) return
    try {
      writeJsonAtomicSync(path.join(this.dir, 'room.json'), this.meta())
    } catch (err) {
      console.error(`Не удалось сохранить комнату ${this.code}:`, err.message)
    }
  }

  saveState(data) {
    if (this.closed) return
    writeJsonAtomicSync(path.join(this.dir, 'state.json'), data)
    this.saveMeta()
  }

  async restoreState() {
    const file = path.join(this.dir, 'state.json')
    if (!fs.existsSync(file)) return false
    try {
      return await this.game.restore(JSON.parse(fs.readFileSync(file, 'utf8')))
    } catch (err) {
      console.warn(`Не удалось восстановить игру в комнате ${this.code}:`, err.message)
      return false
    }
  }

  connections() {
    return this.hub.clients.size
  }

  close(code = 'room_closed', message = 'Комната закрыта') {
    if (this.closed) return
    this.closed = true
    this.game.stopTimers()
    this.game.clearCollect()
    // Сначала вежливо сообщаем всем устройствам, что комнаты больше нет, и только потом обрываем связь.
    this.hub.closeAll(code, message)
    setTimeout(() => this.hub.close(), 1000).unref()
  }
}

export class RoomManager {
  constructor({ config }) {
    this.config = config
    this.mode = config.rooms ? 'rooms' : 'local'
    this.dataDir = config.dataDir
    this.roomsDir = path.join(config.dataDir, 'rooms')
    this.rooms = new Map()
    this.defaultRoom = null
    this.port = config.port
    this.protocol = config.tls ? 'https' : 'http'
    fs.mkdirSync(this.roomsDir, { recursive: true })
  }

  generateCode() {
    for (;;) {
      const code = String(randomInt(100000, 1000000))
      if (!this.rooms.has(code) && !fs.existsSync(path.join(this.roomsDir, code))) return code
    }
  }

  get(code) {
    return this.rooms.get(normalizeCode(code)) ?? null
  }

  async create({ originHint = null, isDefault = false, hostKey = null } = {}) {
    if (!isDefault && this.mode !== 'rooms') {
      throw new RoomError('Сервер запущен в режиме одной игры. Чтобы создавать комнаты, запустите его с параметром --rooms', 403)
    }
    if (!isDefault && this.rooms.size >= this.config.maxRooms) {
      throw new RoomError('На сервере слишком много комнат. Попробуйте позже.', 503)
    }
    const room = new Room(this, {
      code: this.generateCode(),
      hostKey: hostKey ?? newHostKey(),
      isDefault,
      originHint,
    })
    this.rooms.set(room.code, room)
    room.saveMeta()
    if (isDefault) this.defaultRoom = room
    return room
  }

  remove(code, reason = 'Комната закрыта ведущим') {
    const room = this.get(code)
    if (!room) return false
    room.close('room_closed', reason)
    this.rooms.delete(room.code)
    fs.rmSync(room.dir, { recursive: true, force: true })
    if (this.defaultRoom === room) this.defaultRoom = null
    return true
  }

  expired(meta) {
    return this.mode === 'rooms' && !meta.isDefault && Date.now() - (meta.lastActive ?? 0) > this.config.roomTtlHours * 3600_000
  }

  // Загрузка сохранённых комнат после перезапуска.
  async loadAll() {
    if (!fs.existsSync(this.roomsDir)) return
    for (const name of fs.readdirSync(this.roomsDir)) {
      if (!isValidCode(name)) continue
      const file = path.join(this.roomsDir, name, 'room.json')
      let meta
      try {
        meta = JSON.parse(fs.readFileSync(file, 'utf8'))
      } catch {
        continue
      }
      if (meta.code !== name || typeof meta.hostKey !== 'string') continue
      // Комнаты из другого режима не поднимаем: в local — только основная, в rooms — только обычные.
      if ((this.mode === 'local') !== !!meta.isDefault) continue
      if (this.expired(meta)) {
        fs.rmSync(path.join(this.roomsDir, name), { recursive: true, force: true })
        continue
      }
      const room = new Room(this, meta)
      this.rooms.set(room.code, room)
      if (room.isDefault) this.defaultRoom = room
      await room.restoreState()
    }
  }

  // Основная комната режима «одна игра». Ключ ведущего берётся из data/host-key.txt, чтобы не менялся.
  async ensureDefaultRoom() {
    if (this.defaultRoom) return this.defaultRoom
    const room = await this.create({ isDefault: true, hostKey: this.loadHostKey() })
    // Перенос сохранения из первой версии программы (data/game-state.json).
    const legacy = path.join(this.dataDir, 'game-state.json')
    if (fs.existsSync(legacy)) {
      try {
        await room.game.restore(JSON.parse(fs.readFileSync(legacy, 'utf8')))
        fs.renameSync(legacy, `${legacy}.migrated`)
      } catch {
        // старое сохранение повреждено — начинаем с чистого листа
      }
    }
    return room
  }

  loadHostKey() {
    const file = path.join(this.dataDir, 'host-key.txt')
    try {
      const key = fs.readFileSync(file, 'utf8').trim()
      if (/^[A-Z0-9]{6,32}$/.test(key)) return key
    } catch {
      // ключа ещё нет
    }
    const key = newHostKey(8)
    fs.writeFileSync(file, `${key}\n`)
    return key
  }

  // Удаление давно неактивных комнат (только в режиме комнат).
  sweep() {
    if (this.mode !== 'rooms') return 0
    let removed = 0
    for (const room of [...this.rooms.values()]) {
      if (room.connections() === 0 && this.expired(room)) {
        this.remove(room.code, 'Комната закрыта: давно не было игры')
        removed++
      }
    }
    return removed
  }

  saveAll() {
    for (const room of this.rooms.values()) room.game.saveNow()
  }

  closeAll() {
    for (const room of this.rooms.values()) {
      room.game.saveNow()
      room.hub.close()
    }
  }

  // Панель ведущего открыта на самом сервере — пускаем без ключа (только режим «одна игра»).
  // Запросы через прокси/туннель доверенными не считаются: для них адрес всегда «локальный».
  // Чужой сайт, открытый в браузере этого компьютера, тоже не должен получить права ведущего:
  // проверяем, что страница открыта с этого же сервера и по адресу-IP или localhost (защита от DNS rebinding).
  isTrustedLocal(req, room) {
    if (this.mode !== 'local' || !room.isDefault || this.config.requireKey) return false
    if (isProxied(req)) return false
    if (!isLocalAddress(req.socket?.remoteAddress)) return false
    const host = String(req.headers?.host ?? '')
    if (!isLocalHostHeader(host)) return false
    const origin = req.headers?.origin
    if (origin) {
      try {
        if (new URL(origin).host !== host) return false
      } catch {
        return false
      }
    }
    return true
  }

  baseUrl(room) {
    if (this.config.publicUrl) return this.config.publicUrl.replace(/\/+$/, '')
    const chosen = room.game.settings.joinAddress
    const addresses = getLanAddresses()
    const portPart = (this.protocol === 'http' && this.port === 80) || (this.protocol === 'https' && this.port === 443) ? '' : `:${this.port}`
    if (chosen) {
      if (/^https?:\/\//i.test(chosen)) return chosen.replace(/\/+$/, '')
      const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(chosen)
      if (!isIp || addresses.some((a) => a.address === chosen)) return `${this.protocol}://${chosen}${portPart}`
    }
    if (room.originHint) return room.originHint
    const host = addresses[0]?.address ?? 'localhost'
    return `${this.protocol}://${host}${portPart}`
  }

  roomPath(room, sub = '') {
    if (this.mode === 'local' && room.isDefault) return sub || '/'
    return `/r/${room.code}${sub}`
  }

  serverInfo(room) {
    const base = this.baseUrl(room)
    return {
      mode: this.mode,
      code: room.code,
      addresses: getLanAddresses().map(({ name, address }) => ({ name, address })),
      origin: room.originHint,
      port: this.port,
      joinUrl: `${base}${this.roomPath(room)}`,
      hostKey: room.hostKey,
      hostUrl: `${base}${this.roomPath(room, '/host')}?key=${room.hostKey}`,
      dataDir: this.mode === 'local' ? this.dataDir : null,
    }
  }
}
