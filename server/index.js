#!/usr/bin/env node
// Точка входа: запускает HTTP + WebSocket сервер на этом компьютере.
// Телефоны игроков подключаются к нему через браузер по Wi-Fi.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import express from 'express'
import { loadConfig, HELP } from './config.js'
import { Game } from './game/game.js'
import { PackStore } from './packs/store.js'
import { Hub } from './hub.js'
import { mountApi, errorHandler } from './http.js'
import { getLanAddresses, isLocalAddress } from './net.js'

const config = loadConfig()
if (config.help) {
  console.log(HELP)
  process.exit(0)
}

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 20 || (major === 20 && minor < 19) || (major === 22 && minor < 12)) {
  console.error(`Нужен Node.js 20.19+ или 22.12+ (сейчас ${process.version}). Скачайте LTS-версию: https://nodejs.org`)
  process.exit(1)
}

fs.mkdirSync(config.dataDir, { recursive: true })

function loadHostKey(dir) {
  const file = path.join(dir, 'host-key.txt')
  try {
    const key = fs.readFileSync(file, 'utf8').trim()
    if (/^[A-Z0-9]{6,32}$/.test(key)) return key
  } catch {
    // ключа ещё нет
  }
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const key = [...randomBytes(8)].map((b) => alphabet[b % alphabet.length]).join('')
  fs.writeFileSync(file, `${key}\n`)
  return key
}

const hostKey = loadHostKey(config.dataDir)
const store = new PackStore({ dataDir: config.dataDir, builtinDir: path.join(config.root, 'server', 'demo-packs') })
const statePath = path.join(config.dataDir, 'game-state.json')
const game = new Game({
  packStore: store,
  persist: {
    save(data) {
      const tmp = `${statePath}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(data))
      fs.renameSync(tmp, statePath)
    },
  },
})

if (fs.existsSync(statePath)) {
  try {
    await game.restore(JSON.parse(fs.readFileSync(statePath, 'utf8')))
  } catch (err) {
    console.warn('Не удалось восстановить прошлую игру:', err.message)
  }
}

let port = config.port

function joinUrl() {
  const addresses = getLanAddresses()
  const chosen = game.settings.joinAddress
  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(chosen)
  const host = chosen && (!isIp || addresses.some((a) => a.address === chosen)) ? chosen : addresses[0]?.address ?? 'localhost'
  return `http://${host}${port === 80 ? '' : `:${port}`}/`
}

function serverInfo() {
  const url = joinUrl()
  return {
    addresses: getLanAddresses().map(({ name, address }) => ({ name, address })),
    port,
    joinUrl: url,
    hostKey,
    hostUrl: `${url}host?key=${hostKey}`,
    dataDir: config.dataDir,
  }
}

// С этого же компьютера панель ведущего открывается без ключа (если не запрошено иное).
const isLocalRequest = (req) => !config.requireKey && isLocalAddress(req.socket.remoteAddress)

const app = express()
app.disable('x-powered-by')
const server = http.createServer(app)
const hub = new Hub({ game, hostKey, isLocalRequest, serverInfo })

mountApi(app, { store, game, hostKey, isLocalRequest })

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
  // Все остальные адреса (/, /host, /screen, /editor/...) — это одностраничное приложение.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (req.path.startsWith('/api/') || req.path.startsWith('/media/')) return next()
    res.set('Cache-Control', 'no-cache')
    res.sendFile(path.join(config.distDir, 'index.html'))
  })
}
app.use(errorHandler)

server.on('upgrade', (req, socket, head) => {
  let pathname = ''
  try {
    pathname = new URL(req.url, 'http://localhost').pathname
  } catch {
    // некорректный адрес
  }
  if (pathname === '/ws') hub.handleUpgrade(req, socket, head)
  else if (!config.dev) socket.destroy()
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

const info = serverInfo()
const others = info.addresses.slice(1).map((a) => `${a.address} (${a.name})`)
const line = '═'.repeat(64)
console.log(`
${line}
  Своя игра / Брейн-ринг — сервер запущен${config.dev ? ' (режим разработки)' : ''}

  Панель ведущего (на этом компьютере):  http://localhost:${port}/host
  Экран для зрителей / проектора:        http://localhost:${port}/screen

  Игрокам — открыть на телефоне в той же Wi-Fi сети:
      ${info.joinUrl}
      (или отсканировать QR-код в панели ведущего)
${others.length ? `  Другие адреса этого компьютера: ${others.join(', ')}\n` : ''}${info.addresses.length ? '' : '  ВНИМАНИЕ: компьютер не подключён к локальной сети — телефоны не смогут подключиться.\n'}
  Ключ ведущего (управление с другого устройства): ${hostKey}
  Данные и пакеты: ${config.dataDir}
  Остановить сервер: Ctrl+C
${line}
`)

if (config.open) openBrowser(`http://localhost:${port}/host${config.requireKey ? `?key=${hostKey}` : ''}`)

let stopping = false
function shutdown() {
  if (stopping) return
  stopping = true
  console.log('\nСохраняю игру и останавливаю сервер...')
  game.saveNow()
  hub.close()
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
