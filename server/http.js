// HTTP API: создание, поиск и закрытие комнат. Вопросы ведущий читает с листа — пакетов и медиафайлов нет.
import express from 'express'
import { RoomError, originFromRequest } from './rooms.js'
import { RateLimiter, clientIp } from './ratelimit.js'

export function mountApi(app, { manager, config, version }) {
  const createLimiter = new RateLimiter({ limit: config.roomCreateLimit, windowMs: 10 * 60_000 })
  const lookupLimiter = new RateLimiter({ limit: 30, windowMs: 60_000 })
  const ipOf = (req) => clientIp(req, config.trustProxy)

  // Поиск комнаты по коду с защитой от перебора кодов.
  const findRoom = (req, code) => {
    const ip = ipOf(req)
    if (lookupLimiter.blocked(ip)) throw new RoomError('Слишком много попыток. Подождите минуту.', 429)
    const room = manager.get(code)
    if (!room) {
      lookupLimiter.hit(ip)
      throw new RoomError('Комната не найдена. Проверьте код.', 404)
    }
    return room
  }

  // Права ведущего: ключ комнаты (заголовок x-host-key или ?key=) либо сам компьютер-сервер в режиме одной игры.
  const hostAuth = (resolve) => (req, res, next) => {
    const room = resolve(req)
    const key = String(req.get('x-host-key') ?? req.query.key ?? '')
      .trim()
      .toUpperCase()
    if (!manager.isTrustedLocal(req, room) && key !== room.hostKey) {
      return res.status(403).json({ error: 'Нужен ключ ведущего' })
    }
    room.touch()
    req.room = room
    next()
  }
  const roomFromParams = (req) => findRoom(req, req.params.code)

  app.get('/api/info', (_req, res) => {
    res.json({ mode: manager.mode, defaultRoom: manager.defaultRoom?.code ?? null, version })
  })

  app.post('/api/rooms', express.json({ limit: '4kb' }), async (req, res) => {
    if (manager.mode !== 'rooms') {
      throw new RoomError('Сервер запущен в режиме одной игры. Чтобы создавать комнаты, запустите его с параметром --rooms', 403)
    }
    if (!createLimiter.hit(ipOf(req))) throw new RoomError('Слишком много новых комнат с вашего адреса. Подождите немного.', 429)
    const room = await manager.create({ originHint: originFromRequest(req) })
    console.log(`Создана комната ${room.code}`)
    res.json({ code: room.code, hostKey: room.hostKey })
  })

  app.get('/api/rooms/:code', (req, res) => {
    const room = roomFromParams(req)
    res.json({ code: room.code, mode: manager.mode, joinLocked: room.game.settings.joinLocked })
  })

  app.delete('/api/rooms/:code', hostAuth(roomFromParams), (req, res) => {
    if (req.room.isDefault) throw new RoomError('Основную комнату этого компьютера удалить нельзя')
    manager.remove(req.room.code)
    console.log(`Комната ${req.room.code} удалена ведущим`)
    res.json({ ok: true })
  })

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Не найдено' }))
}

// Единый обработчик ошибок для API.
export function errorHandler(err, req, res, _next) {
  if (res.headersSent) {
    res.destroy?.()
    return
  }
  if (err instanceof RoomError) return res.status(err.status).json({ error: err.message })
  if (err?.name === 'GameError') return res.status(400).json({ error: err.message })
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Слишком большой запрос' })
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Неверный JSON' })
  console.error('Ошибка HTTP', req.method, req.originalUrl, err)
  res.status(500).json({ error: 'Внутренняя ошибка сервера' })
}
