#!/usr/bin/env node
// Точка входа: запускает HTTP + WebSocket сервер.
// Режим «одна игра» (по умолчанию): ведущий — этот компьютер, телефоны игроков подключаются по Wi-Fi.
// Режим комнат (--rooms): любой создаёт комнату и зовёт игроков по коду — в локальной сети или через интернет.
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { spawn } from 'node:child_process'
import express from 'express'
import { WebSocketServer } from 'ws'
import { loadConfig, HELP } from './config.js'
import { RoomManager } from './rooms.js'
import { mountApi, errorHandler } from './http.js'
import { getLanAddresses } from './net.js'
import { RateLimiter, clientIp } from './ratelimit.js'

const config = loadConfig()
if (config.help) {
  console.log(HELP)
  process.exit(0)
}
if (config.problems.length) {
  for (const p of config.problems) console.error(p)
  console.error('Справка по параметрам: npm start -- --help')
  process.exit(1)
}

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 20 || (major === 20 && minor < 19) || (major === 22 && minor < 12)) {
  console.error(`Нужен Node.js 20.19+ или 22.12+ (сейчас ${process.version}). Скачайте LTS-версию: https://nodejs.org`)
  process.exit(1)
}

const version = JSON.parse(fs.readFileSync(path.join(config.root, 'package.json'), 'utf8')).version
fs.mkdirSync(config.dataDir, { recursive: true })

const manager = new RoomManager({ config })
await manager.loadAll()
if (manager.mode === 'local') await manager.ensureDefaultRoom()

let tlsOptions = null
if (config.tls) {
  try {
    tlsOptions = { cert: fs.readFileSync(config.tls.cert), key: fs.readFileSync(config.tls.key) }
  } catch (err) {
    console.error(`Не удалось прочитать сертификат HTTPS: ${err.message}`)
    process.exit(1)
  }
}

const app = express()
app.disable('x-powered-by')
const server = tlsOptions ? https.createServer(tlsOptions, app) : http.createServer(app)

// Заголовки безопасности. Referrer-Policy не даёт ключу ведущего из адреса «утечь» на сторонние сайты.
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join('; ')
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff')
  res.set('Referrer-Policy', 'no-referrer')
  res.set('X-Frame-Options', 'SAMEORIGIN')
  if (!config.dev) res.set('Content-Security-Policy', APP_CSP)
  next()
})

mountApi(app, { manager, config, version })

// Нужно ли пересобрать интерфейс (нет сборки или исходники новее).
function newestMtime(dir) {
  let newest = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(full) : fs.statSync(full).mtimeMs)
  }
  return newest
}

async function ensureBuilt() {
  const index = path.join(config.distDir, 'index.html')
  const exists = fs.existsSync(index)
  const clientDir = path.join(config.root, 'client')
  const stale =
    exists &&
    fs.existsSync(clientDir) &&
    Math.max(newestMtime(clientDir), fs.statSync(path.join(config.root, 'vite.config.ts')).mtimeMs) > fs.statSync(index).mtimeMs
  if (exists && !stale) return
  let vite
  try {
    vite = await import('vite')
  } catch {
    if (exists) return
    console.error('Интерфейс не собран, а сборщик не найден. Выполните в папке программы: npm install')
    process.exit(1)
  }
  console.log(exists ? 'Исходники интерфейса изменились — пересобираю...' : 'Собираю интерфейс (нужно только при первом запуске)...')
  await vite.build({ configFile: path.join(config.root, 'vite.config.ts'), logLevel: 'warn' })
}

let vite = null
if (config.dev) {
  const { createServer } = await import('vite')
  vite = await createServer({
    configFile: path.join(config.root, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  })
  app.use(vite.middlewares)
} else {
  await ensureBuilt()
  app.use('/assets', express.static(path.join(config.distDir, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }))
  app.use(express.static(config.distDir, { index: false }))
  // Все остальные адреса (/, /host, /r/123456, /r/123456/host...) — это одностраничное приложение.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (req.path.startsWith('/api/')) return next()
    res.set('Cache-Control', 'no-cache')
    res.sendFile(path.join(config.distDir, 'index.html'))
  })
}
app.use(errorHandler)

// WebSocket: /ws?room=123456 (в режиме одной игры можно без кода — основная комната).
// Если комнаты нет, всё равно принимаем соединение, чтобы браузер получил понятную ошибку, а не «обрыв связи».
const rejectWss = new WebSocketServer({ noServer: true, maxPayload: 1024 })
const wsLookupLimiter = new RateLimiter({ limit: 30, windowMs: 60_000 })

function rejectSocket(req, socket, head, code, message) {
  rejectWss.handleUpgrade(req, socket, head, (ws) => {
    ws.on('error', () => {})
    ws.send(JSON.stringify({ t: 'error', code, message }))
    ws.close(4004, code)
  })
}

server.on('upgrade', (req, socket, head) => {
  let url = null
  try {
    url = new URL(req.url, 'http://localhost')
  } catch {
    // некорректный адрес
  }
  if (url?.pathname !== '/ws') {
    if (!config.dev) socket.destroy() // в режиме разработки остальные адреса обслуживает Vite (HMR)
    return
  }
  socket.on('error', () => {})
  const code = url.searchParams.get('room')
  const ip = clientIp(req, config.trustProxy)
  if (code && wsLookupLimiter.blocked(ip)) {
    rejectSocket(req, socket, head, 'rate_limited', 'Слишком много попыток. Подождите минуту.')
    return
  }
  const room = code ? manager.get(code) : manager.defaultRoom
  if (!room || room.closed) {
    if (code) wsLookupLimiter.hit(ip)
    rejectSocket(req, socket, head, 'room_not_found', 'Комната не найдена. Проверьте код.')
    return
  }
  room.hub.handleUpgrade(req, socket, head)
})

function listen(startPort, attempts = 20) {
  return new Promise((resolve, reject) => {
    const tryPort = (p, left) => {
      const onError = (err) => {
        server.off('listening', onListening)
        if (err.code === 'EADDRINUSE' && left > 0) {
          console.warn(`Порт ${p} занят, пробую ${p + 1}...`)
          tryPort(p + 1, left - 1)
        } else {
          reject(err)
        }
      }
      const onListening = () => {
        server.off('error', onError)
        resolve(p)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(p, config.host)
    }
    tryPort(startPort, attempts)
  })
}

let port
try {
  port = await listen(config.port)
} catch (err) {
  console.error(
    err.code === 'EACCES'
      ? `Нет прав на порт ${config.port}. Выберите другой: npm start -- --port 3000`
      : `Не удалось запустить сервер: ${err.message}`,
  )
  process.exit(1)
}
manager.port = port

// Давно брошенные комнаты удаляем (только в режиме комнат).
const sweepTimer = setInterval(() => {
  const removed = manager.sweep()
  if (removed) console.log(`Удалено неактивных комнат: ${removed}`)
}, 5 * 60_000)
sweepTimer.unref()

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
  } catch {
    // браузер откроют вручную
  }
}

const proto = manager.protocol
const local = `${proto}://localhost:${port}`
const line = '═'.repeat(64)
const lan = getLanAddresses()
const lanUrls = lan.map((a) => `${proto}://${a.address}:${port}/`)
if (manager.mode === 'local') {
  const room = manager.defaultRoom
  const info = manager.serverInfo(room)
  const others = info.addresses.slice(1).map((a) => `${a.address} (${a.name})`)
  console.log(`
${line}
  Своя игра / Брейн-ринг — сервер запущен${config.dev ? ' (режим разработки)' : ''}

  Панель ведущего (на этом компьютере):  ${local}/host
  Экран для зрителей / проектора:        ${local}/screen

  Игрокам — открыть на телефоне в той же Wi-Fi сети:
      ${info.joinUrl}
      (или отсканировать QR-код в панели ведущего)
${others.length ? `  Другие адреса этого компьютера: ${others.join(', ')}\n` : ''}${info.addresses.length || config.publicUrl ? '' : '  ВНИМАНИЕ: компьютер не подключён к локальной сети — телефоны не смогут подключиться.\n'}
  Ключ ведущего (управление с другого устройства): ${room.hostKey}
  Сохранения игр: ${config.dataDir}
  Игра через интернет и комнаты по коду: npm start -- --rooms (см. README)
  Остановить сервер: Ctrl+C
${line}
`)
} else {
  console.log(`
${line}
  Своя игра / Брейн-ринг — сервер комнат запущен${config.dev ? ' (режим разработки)' : ''}

  Создать игру или войти по коду:
      ${config.publicUrl ? `${config.publicUrl}/` : `${local}/`}
${!config.publicUrl && lanUrls.length ? `      в локальной сети: ${lanUrls.join(', ')}\n` : ''}
  Комнат сейчас: ${manager.rooms.size} (максимум ${config.maxRooms}, удаляются через ${config.roomTtlHours} ч без игры)
  Данные: ${config.dataDir}
  Остановить сервер: Ctrl+C
${line}
`)
}

if (config.open) {
  const key = manager.mode === 'local' && config.requireKey ? `?key=${manager.defaultRoom.hostKey}` : ''
  openBrowser(manager.mode === 'local' ? `${local}/host${key}` : `${local}/`)
}

let stopping = false
function shutdown() {
  if (stopping) return
  stopping = true
  console.log('\nСохраняю игры и останавливаю сервер...')
  clearInterval(sweepTimer)
  manager.closeAll()
  rejectWss.close()
  vite?.close()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1500).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('SIGHUP', shutdown)

// Во время игры сервер не должен падать из-за единичной ошибки — пишем её в консоль и работаем дальше.
process.on('uncaughtException', (err) => console.error('Непредвиденная ошибка:', err))
process.on('unhandledRejection', (err) => console.error('Непредвиденная ошибка:', err))
