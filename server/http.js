// HTTP API: комнаты, пакеты вопросов (список, импорт, экспорт, редактор) и раздача медиафайлов.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import multer from 'multer'
import { PackError } from './packs/store.js'
import { RoomError, libIdForOwner, originFromRequest } from './rooms.js'
import { RateLimiter, clientIp } from './ratelimit.js'

const MB = 1024 * 1024

export function mountApi(app, { manager, config, version }) {
  const uploadDir = path.join(os.tmpdir(), 'quiz-buzzer-uploads')
  fs.mkdirSync(uploadDir, { recursive: true })
  const upload = multer({
    dest: uploadDir,
    defParamCharset: 'utf8',
    limits: { fileSize: config.maxUploadMb * MB, files: 1, fields: 10 },
  })
  const createLimiter = new RateLimiter({ limit: config.roomCreateLimit, windowMs: 10 * 60_000 })
  const lookupLimiter = new RateLimiter({ limit: 30, windowMs: 60_000 })
  const ipOf = (req) => clientIp(req, config.trustProxy)

  const cleanup = (req) => {
    if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {})
  }

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
  const defaultRoom = () => {
    if (!manager.defaultRoom) throw new RoomError('Не найдено', 404)
    return manager.defaultRoom
  }

  app.get('/api/info', (_req, res) => {
    res.json({ mode: manager.mode, defaultRoom: manager.defaultRoom?.code ?? null, version })
  })

  app.post('/api/rooms', express.json({ limit: '4kb' }), async (req, res) => {
    if (manager.mode !== 'rooms') {
      throw new RoomError('Сервер запущен в режиме одной игры. Чтобы создавать комнаты, запустите его с параметром --rooms', 403)
    }
    const token = req.body?.ownerToken
    if (typeof token !== 'string' || token.length < 16 || token.length > 200) throw new RoomError('Неверный запрос')
    if (!createLimiter.hit(ipOf(req))) throw new RoomError('Слишком много новых комнат с вашего адреса. Подождите немного.', 429)
    const room = await manager.create({ libId: libIdForOwner(token), originHint: originFromRequest(req) })
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

  // ── Пакеты вопросов комнаты (библиотека её ведущего + встроенные пакеты) ──
  const packs = express.Router({ mergeParams: true })

  packs.get('/', async (req, res) => {
    res.json(await req.room.store.list())
  })

  packs.post('/', express.json({ limit: '50mb' }), async (req, res) => {
    await req.room.store.checkQuota(0)
    const id = await req.room.store.create(req.body?.pack ?? null)
    res.json({ id })
  })

  packs.post('/import', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) throw new PackError('Файл не получен')
      const id = await req.room.store.importFile(req.file.path, req.file.originalname)
      res.json({ id })
    } finally {
      cleanup(req)
    }
  })

  packs.get('/:id', async (req, res) => {
    res.json(await req.room.store.read(req.params.id))
  })

  packs.put('/:id', express.json({ limit: '50mb' }), async (req, res) => {
    const pack = await req.room.store.save(req.params.id, req.body)
    // Если пакет сейчас в игре — подхватываем правки (прогресс сохраняется, если структура не изменилась).
    const game = req.room.game
    if (game.state.packId === req.params.id) await game.refreshPack()
    res.json(pack)
  })

  packs.delete('/:id', async (req, res) => {
    await req.room.store.remove(req.params.id)
    const game = req.room.game
    if (game.state.packId === req.params.id) game.unloadPack()
    res.json({ ok: true })
  })

  packs.post('/:id/copy', async (req, res) => {
    res.json({ id: await req.room.store.duplicate(req.params.id) })
  })

  packs.post('/:id/media', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) throw new PackError('Файл не получен')
      res.json(await req.room.store.addMedia(req.params.id, req.file.path, req.file.originalname))
    } finally {
      cleanup(req)
    }
  })

  packs.get('/:id/export', async (req, res) => {
    const pack = await req.room.store.read(req.params.id)
    const name = `${pack.title.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'pack'}.zip`
    res.attachment(name)
    res.type('application/zip')
    await req.room.store.exportZip(req.params.id, res)
  })

  app.use('/api/rooms/:code/packs', hostAuth(roomFromParams), packs)
  // Короткий адрес для основной комнаты (режим одной игры).
  app.use('/api/packs', hostAuth(defaultRoom), packs)

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Не найдено' }))

  // Медиафайлы пакетов (картинки, звук, видео) — доступны всем устройствам игры.
  // CSP sandbox не даёт выполнить скрипт, даже если в пакет подложили «картинку» SVG со скриптом.
  app.get('/media/:lib/:id/:file', (req, res) => {
    const store = manager.existingLibrary(req.params.lib)
    const abs = store?.mediaPath(req.params.id, req.params.file)
    if (!abs) return res.status(404).end()
    res.set('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox")
    res.set('X-Content-Type-Options', 'nosniff')
    res.sendFile(abs, { maxAge: '1h', dotfiles: 'allow' })
  })
}

// Единый обработчик ошибок для API.
export function errorHandler(err, req, res, _next) {
  if (res.headersSent) {
    res.destroy?.()
    return
  }
  if (err instanceof RoomError) return res.status(err.status).json({ error: err.message })
  if (err instanceof PackError || err?.name === 'GameError') {
    return res.status(400).json({ error: err.message })
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Файл слишком большой' : `Ошибка загрузки: ${err.message}`
    return res.status(413).json({ error: message })
  }
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Слишком большой запрос' })
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Неверный JSON' })
  console.error('Ошибка HTTP', req.method, req.originalUrl, err)
  res.status(500).json({ error: 'Внутренняя ошибка сервера' })
}
