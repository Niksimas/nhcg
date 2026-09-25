// Браузерные сквозные тесты: сервер + панель ведущего + экран + несколько «телефонов».
//
// Нужен Playwright (не входит в зависимости проекта, чтобы не утяжелять установку):
//   npm i --no-save playwright && npx playwright install chromium
//   npm run test:e2e
// Переменные окружения: PLAYWRIGHT_MODULE — путь к модулю playwright, CHROMIUM_PATH — путь к браузеру.
// Скриншоты сохраняются в test-results/e2e/.
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = path.join(ROOT, 'test-results', 'e2e')
const require = createRequire(import.meta.url)

function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright'].filter(Boolean)
  for (const c of candidates) {
    try {
      return require(c)
    } catch {
      // пробуем следующий вариант
    }
  }
  console.error('Не найден Playwright. Установите: npm i --no-save playwright && npx playwright install chromium')
  process.exit(2)
}

const { chromium, devices } = loadPlaywright()
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function startServer(extraArgs = []) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-e2e-'))
  const port = 45000 + Math.floor(Math.random() * 5000)
  const proc = spawn(process.execPath, ['server/index.js', '--no-open', '--port', String(port), '--data', dataDir, ...extraArgs], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  proc.stdout.on('data', (d) => (log += d))
  proc.stderr.on('data', (d) => (log += d))
  const actualPort = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Сервер не запустился:\n${log}`)), 120000)
    const iv = setInterval(() => {
      const m = /localhost:(\d+)\/host/.exec(log)
      if (m) {
        clearInterval(iv)
        clearTimeout(timer)
        resolve(Number(m[1]))
      }
    }, 100)
    proc.once('exit', (code) => reject(new Error(`Сервер завершился (${code}):\n${log}`)))
  })
  return {
    base: `http://localhost:${actualPort}`,
    log: () => log,
    async stop() {
      if (proc.exitCode === null) {
        const exited = new Promise((r) => proc.once('exit', r))
        proc.kill('SIGTERM')
        await exited
      }
      fs.rmSync(dataDir, { recursive: true, force: true })
    },
  }
}

class Session {
  constructor(browser, name) {
    this.browser = browser
    this.name = name
    this.errors = []
    this.pages = {}
    fs.mkdirSync(path.join(OUT, name), { recursive: true })
  }

  async page(name, options) {
    const ctx = await this.browser.newContext(options)
    const page = await ctx.newPage()
    this.pages[name] = page
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') {
        const text = m.text()
        // Ожидаемые сообщения браузера, пока сервер перезапускается, ошибками не считаем.
        if (!/ERR_CONNECTION_REFUSED|favicon/i.test(text)) this.errors.push(`[${name}] ${m.type()}: ${text}`)
      }
    })
    page.on('pageerror', (e) => this.errors.push(`[${name}] pageerror: ${e.message}`))
    return page
  }

  shot(page, name) {
    return page.screenshot({ path: path.join(OUT, this.name, `${name}.png`) })
  }

  async failShots() {
    for (const [n, p] of Object.entries(this.pages)) {
      await p.screenshot({ path: path.join(OUT, this.name, `fail-${n}.png`) }).catch(() => {})
    }
  }
}

const tap = (page) => page.locator('.buzzer').click({ force: true })

// ───────────────────────────── «Своя игра» ─────────────────────────────
async function jeopardyScenario(browser, step) {
  const server = await startServer()
  const s = new Session(browser, 'jeopardy')
  const BASE = server.base
  try {
    step('Панель ведущего, экран и три игрока')
    const host = await s.page('host', { viewport: { width: 1440, height: 900 } })
    const screen = await s.page('screen', { viewport: { width: 1280, height: 720 } })
    await host.goto(`${BASE}/host`)
    await host.getByText('Подключите игроков').waitFor()
    await screen.goto(`${BASE}/screen`)
    await screen.getByRole('button', { name: 'Включить звук' }).click()
    const phones = []
    for (const [name, device] of [
      ['Аня', 'Pixel 7'],
      ['Борис', 'Pixel 7'],
      ['Вика', 'iPhone 13'],
    ]) {
      const p = await s.page(name, { ...devices[device] })
      await p.goto(`${BASE}/`)
      await p.getByPlaceholder('Например, Аня').fill(name)
      await p.getByRole('button', { name: 'Войти в игру' }).click()
      await p.locator('.buzzer').waitFor()
      phones.push(p)
    }
    const [anna, boris, vika] = phones
    await tap(anna)
    await anna.getByText('Работает!').waitFor()
    await s.shot(host, 'host-lobby')
    await s.shot(screen, 'screen-lobby')
    await s.shot(anna, 'phone-lobby')

    step('Пакет и старт')
    await host.getByRole('button', { name: 'Выбрать пакет' }).click()
    await host.locator('.pack', { hasText: 'Демо: Своя игра' }).getByRole('button', { name: 'Играть' }).click()
    await host.getByRole('button', { name: 'Начать игру' }).click()
    await host.locator('.board').waitFor()
    const chooser = await host.locator('.board-head .chooser').textContent()
    if (!chooser.includes('Аня')) await host.locator('.comp', { hasText: 'Аня' }).getByText('сделать выбирающим').click()
    await anna.getByText('Выберите вопрос:').waitFor()
    await s.shot(screen, 'screen-board')

    step('Выбор с телефона, раннее нажатие, честная кнопка')
    await anna.locator('.board .cell', { hasText: '100' }).first().click()
    await host.locator('.q-head').waitFor()
    await tap(boris)
    await boris.getByText('Рано!').waitFor()
    await host.keyboard.press('Space')
    await vika.locator('.buzzer.go').waitFor()
    await tap(vika)
    await host.locator('.responder', { hasText: 'Вика' }).waitFor()
    await vika.getByText('Ваш ответ!').waitFor()
    await s.shot(host, 'host-answering')
    await host.keyboard.press('Backspace')
    await anna.locator('.buzzer.go').waitFor()
    await tap(anna)
    await host.locator('.responder', { hasText: 'Аня' }).waitFor()
    await host.keyboard.press('Enter')
    await host.getByText('Ответ показан на экране').waitFor()
    await s.shot(screen, 'screen-reveal')
    await host.keyboard.press('Enter')
    await host.locator('.board').waitFor()

    step('Кот в мешке')
    await host.locator('.board .cell').nth(2 * 5 + 2).click()
    await host.getByText('Кот в мешке — тема').waitFor()
    await host.locator('.pick', { hasText: 'Борис' }).click()
    await host.getByRole('button', { name: /Отдать вопрос/ }).click()
    await boris.getByText('Ваш ответ!').waitFor()
    await host.getByRole('button', { name: /Верно/ }).click()
    await host.getByRole('button', { name: /К табло/ }).click()
    await host.locator('.board').waitFor()

    step('Музыкальный вопрос: звук играет на экране')
    await host.locator('.board .cell').nth(4 * 5).click()
    await host.locator('.q-head').waitFor()
    await sleep(1200)
    const audio = await screen.evaluate(() => {
      const a = document.querySelector('audio')
      return a ? { paused: a.paused, time: a.currentTime } : null
    })
    if (!audio || audio.paused || audio.time <= 0) throw new Error(`Звук на экране не играет: ${JSON.stringify(audio)}`)
    await host.keyboard.press('Escape')
    await host.getByText('Ответ показан на экране').waitFor()
    await host.keyboard.press('Enter')
    await host.locator('.board').waitFor()

    step('Финал со ставками и ответами с телефонов')
    await host.locator('.round-tab', { hasText: 'Финал' }).click()
    await host.getByText('Уберите темы').waitFor()
    await host.locator('.theme-row', { hasText: 'Космос' }).getByRole('button', { name: /Убрать/ }).click()
    await host.locator('.theme-row', { hasText: 'Изобретения' }).getByRole('button', { name: /Убрать/ }).click()
    await anna.getByText('Сделайте ставку').waitFor()
    await anna.locator('.bet-input').fill('50')
    await anna.getByRole('button', { name: 'Поставить' }).click()
    await anna.getByText('Ставка принята').waitFor()
    await boris.locator('.quick button', { hasText: 'Ва-банк' }).click()
    await boris.getByText('Ставка принята').waitFor()
    await host.getByRole('button', { name: /Показать вопрос/ }).click()
    await anna.locator('textarea.answer').fill('33')
    await anna.getByRole('button', { name: 'Отправить ответ' }).click()
    await boris.locator('textarea.answer').fill('32')
    await boris.getByRole('button', { name: 'Отправить ответ' }).click()
    await host.locator('.part', { hasText: '«33»' }).waitFor()
    await host.getByRole('button', { name: 'Закончить приём ответов' }).click()
    for (const [who, ok] of [
      ['Аня', true],
      ['Борис', false],
    ]) {
      const row = host.locator('.part.reveal', { hasText: who })
      await row.getByRole('button', { name: 'Показать' }).click()
      await row.locator(ok ? '.btn.ok' : '.btn.bad').click()
    }
    await host.getByRole('button', { name: /Показать правильный ответ/ }).click()
    await s.shot(screen, 'screen-final-reveal')
    await host.getByRole('button', { name: /Итоги игры/ }).click()
    await anna.getByText('Игра окончена!').waitFor()
    await sleep(1200)
    await s.shot(screen, 'screen-results')

    step('Редактор пакетов: копия встроенного и сохранение')
    const editor = await s.page('editor', { viewport: { width: 1440, height: 900 } })
    await editor.goto(`${BASE}/editor/demo-svoya-igra`)
    await editor.getByRole('button', { name: /Сделать копию/ }).click()
    await editor.getByText('Создана копия').waitFor()
    await editor.locator('.q-chip').first().click()
    await editor.locator('input.answer').fill('Тихий океан (исправлено)')
    await editor.keyboard.press('Control+s')
    await editor.getByText('Сохранено').waitFor()
    await s.shot(editor, 'editor')
  } catch (err) {
    await s.failShots()
    throw err
  } finally {
    await server.stop()
  }
  return s.errors
}

// ───────────────────────────── «Брейн-ринг», команды ─────────────────────────────
async function teamsScenario(browser, step) {
  const server = await startServer(['--require-key'])
  const s = new Session(browser, 'brainring-teams')
  const BASE = server.base
  try {
    const hostKey = /Ключ ведущего[^:]*:\s*([A-Z0-9]+)/.exec(server.log())[1]
    step('Вход ведущего по ключу')
    const host = await s.page('host', { viewport: { width: 1366, height: 800 } })
    await host.goto(`${BASE}/host`)
    await host.getByPlaceholder('Ключ ведущего').fill('НЕВЕРНЫЙ')
    await host.getByRole('button', { name: 'Войти' }).click()
    await host.getByText('Неверный ключ ведущего').waitFor()
    await host.getByPlaceholder('Ключ ведущего').fill(hostKey.toLowerCase())
    await host.getByRole('button', { name: 'Войти' }).click()
    await host.getByText('Подключите игроков').waitFor()

    step('Команды')
    await host.getByText('Командная игра').click()
    for (const team of ['Красные', 'Синие']) {
      await host.getByPlaceholder('Название новой команды').fill(team)
      await host.getByPlaceholder('Название новой команды').press('Enter')
    }
    await host.locator('.comp', { hasText: 'Синие' }).waitFor()
    await host.locator('.mode', { hasText: 'Брейн-ринг' }).click()
    const phones = {}
    for (const [name, team] of [
      ['Петя', 'Красные'],
      ['Маша', 'Красные'],
      ['Коля', 'Синие'],
      ['Оля', null],
    ]) {
      const p = await s.page(name, { ...devices['Pixel 7'] })
      await p.goto(`${BASE}/`)
      await p.getByPlaceholder('Например, Аня').fill(name)
      if (team) await p.locator('.team', { hasText: team }).click()
      else await p.getByPlaceholder('или новая команда').fill('Зелёные')
      await p.getByRole('button', { name: 'Войти в игру' }).click()
      await p.locator('.buzzer').waitFor()
      phones[name] = p
    }
    const screen = await s.page('screen', { viewport: { width: 1280, height: 720 } })
    await screen.goto(`${BASE}/screen`)
    await screen.getByRole('button', { name: 'Включить звук' }).click()
    await s.shot(screen, 'screen-lobby-teams')

    step('Настройки: 5 секунд на вопрос')
    await host.locator('button[title="Настройки"]').click()
    const mainTime = host.locator('label.field', { hasText: 'Время на вопрос, с' }).locator('input')
    await mainTime.fill('5')
    await mainTime.press('Tab')
    await sleep(300)
    await host.keyboard.press('Escape')

    step('Бой: фальстарт, неверный ответ, верный ответ')
    await host.getByRole('button', { name: 'Начать игру' }).click()
    await host.getByRole('button', { name: /Первый вопрос/ }).click()
    await host.getByRole('button', { name: /ВРЕМЯ!/ }).waitFor()
    await tap(phones['Оля'])
    await phones['Оля'].getByText('Фальстарт').first().waitFor()
    await host.keyboard.press('Space')
    await phones['Коля'].locator('.buzzer.go').waitFor()
    await tap(phones['Коля'])
    await host.locator('.responder', { hasText: 'Синие' }).waitFor()
    await s.shot(screen, 'screen-answering')
    await host.keyboard.press('Backspace')
    await phones['Петя'].locator('.buzzer.go').waitFor()
    await tap(phones['Маша'])
    await host.locator('.responder', { hasText: 'Красные' }).waitFor()
    await host.keyboard.press('Enter')
    await host.locator('.result.ok', { hasText: 'Красные' }).waitFor()

    step('Никто не ответил — очко переходит дальше')
    await host.keyboard.press('Enter')
    await host.getByRole('button', { name: /ВРЕМЯ!/ }).waitFor()
    await host.keyboard.press('Space')
    await host.locator('.result.burned').waitFor({ timeout: 10000 })
    await host.keyboard.press('Enter')
    await host.getByText('Стоимость: 2').waitFor()

    step('Игрок возвращается с другого телефона')
    await phones['Оля'].context().close()
    const olyaRow = host.locator('.member').filter({ has: host.getByText('Оля', { exact: true }) })
    await olyaRow.locator('.conn-dot.off').waitFor()
    const olya2 = await s.page('Оля-2', { ...devices['iPhone 13'] })
    await olya2.goto(`${BASE}/`)
    await olya2.getByPlaceholder('Например, Аня').fill('оля')
    await olya2.locator('.team', { hasText: 'Зелёные' }).click()
    await olya2.getByRole('button', { name: 'Войти в игру' }).click()
    await olya2.getByRole('button', { name: /Это я — продолжить за «Оля»/ }).click()
    await olya2.locator('.buzzer').waitFor()
    await olyaRow.locator('.conn-dot.good').waitFor()

    step('Завершение боя')
    host.once('dialog', (d) => d.accept())
    await host.getByRole('button', { name: /Завершить бой/ }).click()
    await host.getByText('Победа: Красные!').first().waitFor()
    await sleep(600)
    await s.shot(screen, 'screen-finished')
  } catch (err) {
    await s.failShots()
    throw err
  } finally {
    await server.stop()
  }
  return s.errors
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--autoplay-policy=no-user-gesture-required'],
})
let failed = false
for (const [title, scenario] of [
  ['«Своя игра»', jeopardyScenario],
  ['«Брейн-ринг» в командах', teamsScenario],
]) {
  console.log(`\n${title}`)
  try {
    const errors = await scenario(browser, (t) => console.log(`  • ${t}`))
    if (errors.length) {
      failed = true
      console.log('  ✗ Ошибки в консоли браузера:')
      for (const e of errors) console.log(`    ${e}`)
    } else {
      console.log('  ✓ пройдено, ошибок в консоли нет')
    }
  } catch (err) {
    failed = true
    console.log(`  ✗ ${err.message}`)
  }
}
await browser.close()
console.log(`\nСкриншоты: ${path.relative(ROOT, OUT)}`)
process.exit(failed ? 1 : 0)
