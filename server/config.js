// Настройки запуска: аргументы командной строки и переменные окружения.
//   node server/index.js [--port 3000] [--host 0.0.0.0] [--data ./data] [--no-open] [--dev]
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

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
    },
    strict: false,
  })
  const port = Number(values.port ?? env.PORT ?? 3000)
  return {
    help: !!values.help,
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 3000,
    host: values.host ?? env.HOST ?? '0.0.0.0',
    dataDir: path.resolve(values.data ?? env.DATA_DIR ?? path.join(ROOT, 'data')),
    dev: !!values.dev,
    open: !(values['no-open'] || env.NO_OPEN === '1' || env.CI),
    requireKey: !!values['require-key'] || env.REQUIRE_HOST_KEY === '1',
    distDir: path.join(ROOT, 'dist'),
    root: ROOT,
  }
}

export const HELP = `
Своя игра / Брейн-ринг — сервер для игры по Wi-Fi

  npm start                  запустить (при первом запуске соберёт интерфейс)
  npm run dev                режим разработки (горячая перезагрузка интерфейса)

Параметры:
  --port <число>             порт (по умолчанию 3000, если занят — следующий свободный)
  --host <адрес>             на каком адресе слушать (по умолчанию 0.0.0.0 — все сети)
  --data <папка>             где хранить пакеты и сохранения (по умолчанию ./data)
  --no-open                  не открывать браузер автоматически
  --require-key              спрашивать ключ ведущего даже на этом компьютере
`
