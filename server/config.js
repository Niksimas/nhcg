// Настройки запуска: аргументы командной строки и переменные окружения.
//   node server/index.js [--port 3000] [--host 0.0.0.0] [--data ./data] [--no-open] [--dev] [--rooms] ...
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim())

function intOption(raw, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}, name, problems) {
  if (raw === undefined || raw === null || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < min || n > max) {
    problems.push(`Неверное значение ${name}: ${raw} (нужно число от ${min} до ${max})`)
    return fallback
  }
  return Math.round(n)
}

function normalizePublicUrl(raw, problems) {
  if (!raw) return null
  let url
  try {
    url = new URL(String(raw).trim())
  } catch {
    problems.push(`Неверный адрес --public-url: ${raw} (пример: https://quiz.example.ru)`)
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    problems.push(`Адрес --public-url должен начинаться с http:// или https:// (сейчас: ${raw})`)
    return null
  }
  if (url.pathname.replace(/\/+$/, '')) {
    problems.push(`Размещение в подпапке не поддерживается: --public-url должен быть адресом сайта целиком (например, https://${url.host})`)
    return null
  }
  return `${url.protocol}//${url.host}`
}

export function loadConfig(argv = process.argv.slice(2), env = process.env) {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: 'string', short: 'p' },
      host: { type: 'string' },
      data: { type: 'string' },
      'no-open': { type: 'boolean' },
      'require-key': { type: 'boolean' },
      dev: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      rooms: { type: 'boolean' },
      'public-url': { type: 'string' },
      'trust-proxy': { type: 'boolean' },
      'max-rooms': { type: 'string' },
      'room-ttl': { type: 'string' },
      'room-create-limit': { type: 'string' },
      'tls-cert': { type: 'string' },
      'tls-key': { type: 'string' },
    },
    strict: false,
  })
  const problems = []
  const port = Number(values.port ?? env.PORT ?? 3000)
  const rooms = !!values.rooms || truthy(env.ROOMS) || String(env.QUIZ_MODE ?? '').toLowerCase() === 'rooms'
  const tlsCert = values['tls-cert'] ?? env.TLS_CERT ?? null
  const tlsKey = values['tls-key'] ?? env.TLS_KEY ?? null
  if (!!tlsCert !== !!tlsKey) problems.push('Для HTTPS нужны оба параметра: --tls-cert и --tls-key')
  const config = {
    help: !!values.help,
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 3000,
    host: values.host ?? env.HOST ?? '0.0.0.0',
    dataDir: path.resolve(values.data ?? env.DATA_DIR ?? path.join(ROOT, 'data')),
    dev: !!values.dev,
    open: !(values['no-open'] || truthy(env.NO_OPEN) || env.CI),
    requireKey: !!values['require-key'] || truthy(env.REQUIRE_HOST_KEY),
    // Режим комнат: сервер для многих игр (в интернете или в большой локальной сети).
    rooms,
    // Адрес сайта снаружи (для ссылок и QR-кодов), например https://quiz.example.ru
    publicUrl: normalizePublicUrl(values['public-url'] ?? env.PUBLIC_URL, problems),
    // Сервер стоит за nginx/Caddy/туннелем: IP игрока брать из X-Forwarded-For.
    trustProxy: !!values['trust-proxy'] || truthy(env.TRUST_PROXY),
    maxRooms: intOption(values['max-rooms'] ?? env.MAX_ROOMS, 500, { min: 1, max: 100_000 }, '--max-rooms', problems),
    roomTtlHours: intOption(values['room-ttl'] ?? env.ROOM_TTL_HOURS, 12, { min: 1, max: 24 * 365 }, '--room-ttl', problems),
    roomCreateLimit: intOption(values['room-create-limit'] ?? env.ROOM_CREATE_LIMIT, 10, { min: 1, max: 100_000 }, '--room-create-limit', problems),
    tls: tlsCert && tlsKey ? { cert: path.resolve(tlsCert), key: path.resolve(tlsKey) } : null,
    distDir: path.join(ROOT, 'dist'),
    root: ROOT,
    problems,
  }
  return config
}

export const HELP = `
Своя игра / Брейн-ринг / Хамса — сервер для игры по Wi-Fi и через интернет

  npm start                  запустить (при первом запуске соберёт интерфейс)
  npm run dev                режим разработки (горячая перезагрузка интерфейса)
  npm start -- --rooms       режим комнат: любой может создать игру и позвать игроков по коду

Параметры (в скобках — переменная окружения):
  --port <число>             порт (PORT; по умолчанию 3000, если занят — следующий свободный)
  --host <адрес>             на каком адресе слушать (HOST; по умолчанию 0.0.0.0 — все сети)
  --data <папка>             где хранить сохранения игр (DATA_DIR; по умолчанию ./data)
  --no-open                  не открывать браузер автоматически (NO_OPEN=1)
  --require-key              спрашивать ключ ведущего даже на этом компьютере (REQUIRE_HOST_KEY=1)

Игра через интернет:
  --rooms                    режим комнат (ROOMS=1)
  --public-url <адрес>       адрес сайта для ссылок и QR-кодов, например https://quiz.example.ru (PUBLIC_URL)
  --trust-proxy              сервер за nginx/Caddy/туннелем — брать IP игроков из X-Forwarded-For (TRUST_PROXY=1)
  --max-rooms <число>        максимум комнат одновременно (MAX_ROOMS; по умолчанию 500)
  --room-ttl <часы>          удалять комнату после стольких часов без игры (ROOM_TTL_HOURS; по умолчанию 12)
  --room-create-limit <N>    сколько комнат можно создать с одного IP за 10 минут (ROOM_CREATE_LIMIT; 10)
  --tls-cert <файл>          сертификат для HTTPS без прокси (TLS_CERT)
  --tls-key <файл>           закрытый ключ для HTTPS (TLS_KEY)
`
