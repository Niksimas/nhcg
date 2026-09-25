// HTTP API: пакеты вопросов (список, импорт, экспорт, редактор) и раздача медиафайлов.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import multer from 'multer'
import { PackError } from './packs/store.js'

export function mountApi(app, { store, game, hostKey, isLocalRequest }) {
  const uploadDir = path.join(os.tmpdir(), 'quiz-buzzer-uploads')
  fs.mkdirSync(uploadDir, { recursive: true })
  const upload = multer({
    dest: uploadDir,
    defParamCharset: 'utf8',
    limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 1, fields: 10 },
  })

  const requireHost = (req, res, next) => {
    const key = String(req.get('x-host-key') ?? req.query.key ?? '').trim().toUpperCase()
    if (isLocalRequest(req) || key === hostKey) return next()
    res.status(403).json({ error: 'Нужен ключ ведущего' })
  }

  const cleanup = (req) => {
    if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {})
  }

  const api = express.Router()
  api.use(requireHost)

  api.get('/packs', async (_req, res) => {
    res.json(await store.list())
  })

  api.post('/packs', express.json({ limit: '50mb' }), async (req, res) => {
    const id = await store.create(req.body?.pack ?? null)
    res.json({ id })
  })

  api.post('/packs/import', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) throw new PackError('Файл не получен')
      const id = await store.importFile(req.file.path, req.file.originalname)
      res.json({ id })
    } finally {
      cleanup(req)
    }
  })

  api.get('/packs/:id', async (req, res) => {
    res.json(await store.read(req.params.id))
  })

  api.put('/packs/:id', express.json({ limit: '50mb' }), async (req, res) => {
    const pack = await store.save(req.params.id, req.body)
    // Если пакет сейчас в игре — подхватываем правки (прогресс сохраняется, если структура не изменилась).
    if (game.state.packId === req.params.id) await game.refreshPack()
    res.json(pack)
  })

  api.delete('/packs/:id', async (req, res) => {
    await store.remove(req.params.id)
    if (game.state.packId === req.params.id) game.unloadPack()
    res.json({ ok: true })
  })

  api.post('/packs/:id/copy', async (req, res) => {
    res.json({ id: await store.duplicate(req.params.id) })
  })

  api.post('/packs/:id/media', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) throw new PackError('Файл не получен')
      res.json(await store.addMedia(req.params.id, req.file.path, req.file.originalname))
    } finally {
      cleanup(req)
    }
  })

  api.get('/packs/:id/export', async (req, res) => {
    const pack = await store.read(req.params.id)
    const name = `${pack.title.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'pack'}.zip`
    res.attachment(name)
    res.type('application/zip')
    await store.exportZip(req.params.id, res)
  })

  api.use((_req, res) => res.status(404).json({ error: 'Не найдено' }))

  app.use('/api', api)

  // Медиафайлы пакетов (картинки, звук, видео) — доступны всем устройствам игры.
  app.get('/media/:id/:file', (req, res) => {
    const abs = store.mediaPath(req.params.id, req.params.file)
    if (!abs) return res.status(404).end()
    res.sendFile(abs, { maxAge: '1h', dotfiles: 'allow' })
  })
}

// Единый обработчик ошибок для API.
export function errorHandler(err, req, res, _next) {
  if (res.headersSent) {
    res.destroy?.()
    return
  }
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
