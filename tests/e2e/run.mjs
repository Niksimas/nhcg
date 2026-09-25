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
      const m = /localhost:(\d+)\//.exec(log)
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

  // ignore — какие ещё сообщения консоли ожидаемы на этой странице (например, 404 при проверке неверного кода).
  async page(name, options, ignore = null) {
    const ctx = await this.browser.newContext(options)
    const page = await ctx.newPage()
    this.pages[name] = page
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') {
        const text = m.text()
        // Ожидаемые сообщения браузера, пока сервер перезапускается, ошибками не считаем.
        if (/ERR_CONNECTION_REFUSED|favicon/i.test(text) || ignore?.test(text)) return
        this.errors.push(`[${name}] ${m.type()}: ${text}`)
      }
    })
    page.on('pageerror', (e) => this.errors.push(`[${name}] pageerror: ${e.message}`))
    return page
  }

  shot(page, name) {
    // Анимации отключаются, чтобы на снимке было итоговое состояние, а не середина перехода.
    return page.screenshot({ path: path.join(OUT, this.name, `${name}.png`), animations: 'disabled' })
  }

  async failShots() {
    for (const [n, p] of Object.entries(this.pages)) {
      await p.screenshot({ path: path.join(OUT, this.name, `fail-${n}.png`) }).catch(() => {})
    }
  }
}

const tap = (page) => page.locator('.buzzer').click({ force: true })
// Счёт команды в списке у ведущего (в карточках других команд тоже встречаются названия — в списке «перевести в команду»).
const teamScore = (page, team, score) =>
  page
    .locator('.comp')
    .filter({ has: page.locator('.comp-main .name', { hasText: team }) })
    .locator('.score', { hasText: new RegExp(`^${score}$`) })

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

    step('Правила как в телепередаче, пакет и старт')
    await host.locator('button[title="Настройки"]').click()
    await host.locator('label.field', { hasText: 'Правила' }).locator('select').selectOption('tv')
    await sleep(300)
    await s.shot(host, 'host-settings')
    await host.keyboard.press('Escape')
    await host.getByRole('button', { name: 'Выбрать пакет' }).click()
    await host.locator('.pack', { hasText: 'Демо: Своя игра' }).waitFor()
    await s.shot(host, 'host-packs')
    await host.locator('.pack', { hasText: 'Демо: Своя игра' }).getByRole('button', { name: 'Играть' }).click()
    await host.getByRole('button', { name: 'Начать игру' }).click()
    await host.locator('.board').waitFor()
    const chooser = await host.locator('.board-head .chooser').textContent()
    if (!chooser.includes('Аня')) await host.locator('.comp', { hasText: 'Аня' }).getByTitle(/Сделать выбирающим/).click()
    await anna.getByText('Выберите вопрос:').waitFor()
    await s.shot(screen, 'screen-board')

    step('Выбор с телефона, раннее нажатие, честная кнопка')
    await anna.locator('.board .cell', { hasText: '100' }).first().click()
    await host.locator('.q-head').waitFor()
    await tap(boris)
    await boris.getByText('Рано!').waitFor()
    await host.keyboard.press('Space')
    await vika.locator('.buzzer.go').waitFor()
    await s.shot(vika, 'phone-go')
    await tap(vika)
    await host.locator('.responder', { hasText: 'Вика' }).waitFor()
    await vika.getByText('Ваш ответ!').waitFor()
    await s.shot(vika, 'phone-winner')
    await s.shot(host, 'host-answering')
    await s.shot(screen, 'screen-question')
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
    await host.getByText('Если вопрос не взят — его очки переходят на следующий вопрос').click()
    await sleep(300)
    await host.keyboard.press('Escape')

    step('Бой трёх команд: фальстарт, неверный ответ, верный ответ')
    await host.getByRole('button', { name: 'Начать игру' }).click()
    await host.getByText('Первый бой: кто играет?').waitFor()
    await s.shot(screen, 'screen-before-battle')
    for (const team of ['Красные', 'Синие', 'Зелёные']) {
      const chip = host.locator('.setup .pick', { hasText: team })
      if (!(await chip.evaluate((el) => el.classList.contains('on')))) await chip.click()
    }
    await host.getByRole('button', { name: /Начать бой №1/ }).click()
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

    step('Завершение боя и турнирная таблица')
    host.once('dialog', (d) => d.accept())
    await host.getByRole('button', { name: /Завершить бой/ }).click()
    await host.getByText('Победа: Красные (+1)').waitFor()
    await screen.getByText('Бой №1: победа «Красные»').waitFor()
    await s.shot(screen, 'screen-battle-end')

    step('Второй бой: играют только две команды')
    await host.getByText('Следующий бой: кто играет?').waitFor()
    for (const team of ['Красные', 'Синие', 'Зелёные']) {
      const chip = host.locator('.setup .pick', { hasText: team })
      const on = await chip.evaluate((el) => el.classList.contains('on'))
      if (on !== (team !== 'Зелёные')) await chip.click()
    }
    await host.getByRole('button', { name: /Начать бой №2/ }).click()
    await olya2.getByText('Сейчас играют').waitFor()
    await host.getByRole('button', { name: /Первый вопрос/ }).click()
    await host.getByRole('button', { name: /ВРЕМЯ!/ }).waitFor()
    await host.keyboard.press('Space')
    await phones['Коля'].locator('.buzzer.go').waitFor()
    await tap(phones['Коля'])
    await host.locator('.responder', { hasText: 'Синие' }).waitFor()
    await host.keyboard.press('Enter')
    await s.shot(screen, 'screen-battle-2')
    await s.shot(olya2, 'phone-not-in-battle')
    host.once('dialog', (d) => d.accept())
    await host.getByRole('button', { name: /Завершить бой/ }).click()
    await host.getByText('Победа: Синие (+1)').waitFor()
    host.once('dialog', (d) => d.accept())
    await host.getByRole('button', { name: /Итоги турнира/ }).click()
    await screen.locator('table.standings').waitFor()
    await sleep(600)
    await s.shot(screen, 'screen-standings')
    await s.shot(host, 'host-standings')
  } catch (err) {
    await s.failShots()
    throw err
  } finally {
    await server.stop()
  }
  return s.errors
}

// ───────────────────────────── Спортивная «Своя игра» командами ─────────────────────────────
async function sportScenario(browser, step) {
  const server = await startServer()
  const s = new Session(browser, 'sport-teams')
  const BASE = server.base
  try {
    step('Две команды по два игрока, капитаны — первые вошедшие')
    const host = await s.page('host', { viewport: { width: 1440, height: 900 } })
    await host.goto(`${BASE}/host`)
    await host.getByText('Подключите игроков').waitFor()
    await host.getByText('Командная игра').click()
    for (const team of ['Совы', 'Ежи']) {
      await host.getByPlaceholder('Название новой команды').fill(team)
      await host.getByPlaceholder('Название новой команды').press('Enter')
    }
    await host.locator('.comp', { hasText: 'Ежи' }).waitFor()
    const phones = {}
    for (const [name, team] of [
      ['Аня', 'Совы'],
      ['Боря', 'Совы'],
      ['Вика', 'Ежи'],
      ['Гена', 'Ежи'],
    ]) {
      const p = await s.page(name, { ...devices['Pixel 7'] })
      await p.goto(`${BASE}/`)
      await p.getByPlaceholder('Например, Аня').fill(name)
      await p.locator('.team', { hasText: team }).click()
      await p.getByRole('button', { name: 'Войти в игру' }).click()
      await p.locator('.buzzer').waitFor()
      phones[name] = p
    }
    const screen = await s.page('screen', { viewport: { width: 1280, height: 720 } })
    await screen.goto(`${BASE}/screen`)
    await screen.getByRole('button', { name: 'Включить звук' }).click()

    step('Открытый раунд: капитаны распределяют игроков по темам')
    await host.getByRole('button', { name: 'Выбрать пакет' }).click()
    await host.locator('.pack', { hasText: 'Демо: спортивная Своя игра' }).getByRole('button', { name: 'Играть' }).click()
    await host.getByRole('button', { name: 'Начать игру' }).click()
    await host.getByText('Капитаны распределяют игроков по темам').first().waitFor()
    const anna = phones['Аня']
    await anna.getByText('Вы капитан — кто играет?').waitFor()
    await s.shot(anna, 'phone-captain')
    await s.shot(screen, 'screen-assign')
    await s.shot(host, 'host-assign')
    const annaTheme = (name) => anna.locator('.cap .theme', { hasText: name })
    await annaTheme('Столицы').locator('.member', { hasText: 'Боря' }).click()
    await annaTheme('Животные').locator('.member', { hasText: 'Аня' }).click()
    await annaTheme('Русская литература').locator('.member', { hasText: 'Боря' }).click()
    await anna.getByRole('button', { name: /Готово/ }).click()
    await anna.getByText('Выбор отправлен').waitFor()
    await phones['Вика'].getByRole('button', { name: /Готово/ }).click()
    await host.getByRole('button', { name: /Следующая тема: «Столицы»/ }).waitFor()

    step('Тема: за столом по одному игроку от команды')
    await host.keyboard.press('Enter')
    await screen.getByText('За столом').waitFor()
    await s.shot(screen, 'screen-theme')
    await host.keyboard.press('Enter')
    await host.locator('.q-head').waitFor()
    await host.keyboard.press('Space')
    await phones['Боря'].locator('.buzzer.go').waitFor()
    await anna.getByText('Тему играет').waitFor()
    await s.shot(anna, 'phone-not-at-table')
    await tap(phones['Боря'])
    await host.locator('.responder', { hasText: 'Совы' }).waitFor()
    await host.keyboard.press('Enter')
    await host.getByText('Ответ показан на экране').waitFor()
    await host.locator('.comp', { hasText: 'Совы' }).locator('.score', { hasText: '10' }).waitFor()
    await host.keyboard.press('Enter')
    await host.locator('.q-head', { hasText: '20' }).waitFor()
    await s.shot(host, 'host-question')

    step('Полуоткрытый раунд: тема объявляется, капитан выбирает игрока')
    await host.keyboard.press('Escape')
    await host.getByText('Ответ показан на экране').waitFor()
    await host.locator('.round-tab', { hasText: 'Полуоткрытый раунд' }).click()
    await host.getByRole('button', { name: /Следующая тема/ }).click()
    await host.getByText(/капитаны выбирают игрока/).first().waitFor()
    await anna.locator('.cap .theme', { hasText: 'Наука' }).locator('.member', { hasText: 'Аня' }).click()
    await anna.getByRole('button', { name: /Готово/ }).click()
    await phones['Вика'].getByRole('button', { name: /Готово/ }).click()
    await host.getByRole('button', { name: /Первый вопрос за 10/ }).waitFor()
    await s.shot(screen, 'screen-semi-theme')
  } catch (err) {
    await s.failShots()
    throw err
  } finally {
    await server.stop()
  }
  return s.errors
}

// ───────────────────────────── «Хамса» ─────────────────────────────
async function khamsaScenario(browser, step) {
  const server = await startServer()
  const s = new Session(browser, 'khamsa')
  const BASE = server.base
  try {
    step('Режим «Хамса», три команды: Альфа (Аня — капитан, Боря), Бета (Вика), Гамма (Гена)')
    const host = await s.page('host', { viewport: { width: 1440, height: 900 } })
    await host.goto(`${BASE}/host`)
    await host.getByText('Подключите игроков').waitFor()
    await host.locator('.mode', { hasText: 'Хамса' }).click()
    await host.getByText('Командная игра').click()
    for (const team of ['Альфа', 'Бета', 'Гамма']) {
      await host.getByPlaceholder('Название новой команды').fill(team)
      await host.getByPlaceholder('Название новой команды').press('Enter')
    }
    await host.locator('.comp', { hasText: 'Гамма' }).waitFor()
    const phones = {}
    for (const [name, team] of [
      ['Аня', 'Альфа'],
      ['Боря', 'Альфа'],
      ['Вика', 'Бета'],
      ['Гена', 'Гамма'],
    ]) {
      const p = await s.page(name, { ...devices['Pixel 7'] })
      await p.goto(`${BASE}/`)
      await p.getByPlaceholder('Например, Аня').fill(name)
      await p.locator('.team', { hasText: team }).click()
      await p.getByRole('button', { name: 'Войти в игру' }).click()
      await p.locator('.buzzer').waitFor()
      phones[name] = p
    }
    const { Аня: anna, Боря: borya, Вика: vika, Гена: gena } = phones
    const screen = await s.page('screen', { viewport: { width: 1280, height: 720 } })
    await screen.goto(`${BASE}/screen`)
    await screen.getByRole('button', { name: 'Включить звук' }).click()

    step('Явный раунд: капитаны расставляют игроков, вопросы от 100')
    await host.getByRole('button', { name: 'Выбрать пакет' }).click()
    await host.locator('.pack', { hasText: 'Демо: Хамса' }).getByRole('button', { name: 'Играть' }).click()
    await host.getByRole('button', { name: 'Начать игру' }).click()
    await host.getByText('Капитаны распределяют игроков по темам').first().waitFor()
    await anna.getByText('Вы капитан — кто играет?').waitFor()
    await anna.locator('.cap .theme', { hasText: 'Столицы' }).locator('.member', { hasText: 'Боря' }).click()
    await anna.getByRole('button', { name: /Готово/ }).click()
    await vika.getByRole('button', { name: /Готово/ }).click()
    await gena.getByRole('button', { name: /Готово/ }).click()
    await host.getByRole('button', { name: /Следующая тема: «Столицы»/ }).waitFor()
    await screen.locator('.round-title', { hasText: 'Явный раунд' }).waitFor()
    await host.keyboard.press('Enter')
    await screen.getByText('За столом').waitFor()
    await host.keyboard.press('Enter')
    await host.locator('.q-head', { hasText: '100' }).waitFor()

    step('Фальстарт: Боря нажал, пока читают вопрос, — Альфа не отвечает')
    await tap(borya)
    await borya.getByText('Фальстарт').waitFor()
    await s.shot(borya, 'phone-false-start')

    step('Очередь: Бета ошибается, право ответа переходит к Гамме, нажавшей следом')
    await host.keyboard.press('Space')
    await vika.locator('.buzzer.go').waitFor()
    await tap(vika)
    await host.locator('.responder', { hasText: 'Бета' }).waitFor()
    await gena.locator('.buzzer.queue').waitFor()
    await s.shot(gena, 'phone-queue')
    await tap(gena)
    await gena.getByText('Вы в очереди на ответ').waitFor()
    await host.keyboard.press('Backspace')
    await host.locator('.responder', { hasText: 'Гамма' }).waitFor()
    await gena.getByText('Ваш ответ!').waitFor()
    await host.keyboard.press('Enter')
    await host.getByText('Ответ показан на экране').waitFor()
    await teamScore(host, 'Гамма', '100').waitFor()

    step('Четвёртый раунд: капитаны выбирают игрока, команды убирают темы с телефонов')
    await host.locator('.round-tab', { hasText: 'Четвёртый' }).click()
    await host.getByText('Капитаны выбирают игрока четвёртого раунда').waitFor()
    await anna.getByText('Кто играет четвёртый раунд').waitFor()
    await s.shot(anna, 'phone-leader')
    await screen.getByText('Капитаны выбирают одного игрока на весь раунд').waitFor()
    await s.shot(screen, 'screen-leader-assign')
    await anna.locator('.cap .member', { hasText: 'Боря' }).click()
    await anna.getByRole('button', { name: /Готово/ }).click()
    await vika.getByRole('button', { name: /Готово/ }).click()
    await gena.getByRole('button', { name: /Готово/ }).click()
    // Очередь — от меньшего счёта к большему: Бета (−100), Альфа (0), Гамма (100).
    await vika.getByText('Ваша очередь — уберите тему').waitFor()
    await screen.getByText('Команды по очереди убирают темы').waitFor()
    await s.shot(vika, 'phone-strike')
    await vika.locator('.strike .theme', { hasText: 'Космос' }).click()
    await vika.getByRole('button', { name: 'Убрать «Космос»' }).click()
    await borya.getByText('Ваша очередь — уберите тему').waitFor()
    await borya.locator('.strike .theme', { hasText: 'Живопись' }).click()
    await borya.getByRole('button', { name: 'Убрать «Живопись»' }).click()
    await gena.getByText('Ваша очередь — уберите тему').waitFor()
    await gena.locator('.strike .theme', { hasText: 'Компьютеры' }).click()
    await gena.getByRole('button', { name: /Убрать «Компьютеры/ }).click()
    await screen.locator('.strike-theme.struck', { hasText: 'Компьютеры' }).waitFor()
    await s.shot(screen, 'screen-strike')
    await s.shot(host, 'host-strike')
    await host.locator('.strike-theme', { hasText: 'Архитектура' }).click()
    await screen.locator('.theme-big', { hasText: 'Мифология' }).waitFor()
    await borya.getByText(/Мифология — вы за столом/).waitFor()
    await s.shot(screen, 'screen-leader-theme')

    step('Тему играет выбранный игрок: 400 очков')
    await host.keyboard.press('Enter')
    await host.locator('.q-head', { hasText: '400' }).waitFor()
    await host.keyboard.press('Space')
    await anna.getByText('Тему играет').waitFor()
    await borya.locator('.buzzer.go').waitFor()
    await tap(borya)
    await host.locator('.responder', { hasText: 'Альфа' }).waitFor()
    await host.keyboard.press('Enter')
    await host.getByText('Ответ показан на экране').waitFor()
    await teamScore(host, 'Альфа', '400').waitFor()

    step('Раунд «Хамса»: ставки команд с плюсом, ответы с телефонов')
    await host.locator('.round-tab', { hasText: 'Хамса' }).click()
    await host.getByText('Раунд «Хамса»').waitFor()
    await screen.locator('.round-title', { hasText: 'Хамса' }).waitFor()
    await vika.getByText('Вы не участвуете в этом раунде').waitFor()
    await anna.getByText('Сделайте ставку').waitFor()
    await anna.locator('.bet-input').fill('300')
    await anna.getByRole('button', { name: 'Поставить' }).click()
    await anna.getByText('Ставка принята').waitFor()
    await gena.locator('.quick button', { hasText: 'Ва-банк' }).click()
    await gena.getByText('Ставка принята').waitFor()
    await host.getByRole('button', { name: /Показать вопрос/ }).click()
    await borya.locator('textarea.answer').fill('Твёрдый знак')
    await borya.getByRole('button', { name: 'Отправить ответ' }).click()
    await gena.locator('textarea.answer').fill('Мягкий знак')
    await gena.getByRole('button', { name: 'Отправить ответ' }).click()
    await host.locator('.part', { hasText: '«Мягкий знак»' }).waitFor()
    await host.getByRole('button', { name: 'Закончить приём ответов' }).click()
    for (const [who, ok] of [
      ['Альфа', true],
      ['Гамма', false],
    ]) {
      const row = host.locator('.part.reveal', { hasText: who })
      await row.getByRole('button', { name: 'Показать' }).click()
      await row.locator(ok ? '.btn.ok' : '.btn.bad').click()
    }
    await teamScore(host, 'Альфа', '700').waitFor()
    await host.getByRole('button', { name: /Показать правильный ответ/ }).click()
    await s.shot(screen, 'screen-khamsa-reveal')
    await host.getByRole('button', { name: /Итоги игры/ }).click()
    await anna.getByText('Игра окончена!').waitFor()
  } catch (err) {
    await s.failShots()
    throw err
  } finally {
    await server.stop()
  }
  return s.errors
}

// ───────────────────────────── Сервер комнат, игра через интернет ─────────────────────────────
async function roomsScenario(browser, step) {
  const server = await startServer(['--rooms'])
  const s = new Session(browser, 'rooms-online')
  const BASE = server.base
  try {
    step('Главная страница и создание комнаты')
    const host = await s.page('host', { viewport: { width: 1440, height: 900 } })
    await host.goto(`${BASE}/`)
    await host.getByRole('heading', { name: 'Провести игру' }).waitFor()
    await s.shot(host, 'landing-desktop')
    await host.getByRole('button', { name: /Создать комнату/ }).click()
    await host.waitForURL(/\/r\/\d{6}\/host$/)
    const code = /\/r\/(\d{6})\/host/.exec(host.url())[1]
    await host.getByText('Подключите игроков').waitFor()
    await host.locator('.room-chip', { hasText: `${code.slice(0, 3)} ${code.slice(3)}` }).waitFor()
    await s.shot(host, 'host-lobby')

    step('Игроки входят по коду комнаты')
    const phones = {}
    for (const [name, device] of [
      ['Аня', 'Pixel 7'],
      ['Борис', 'iPhone 13'],
      ['Вика', 'Pixel 7'],
    ]) {
      const p = await s.page(name, { ...devices[device] })
      await p.goto(`${BASE}/`)
      await p.locator('.code-input').fill(code)
      if (name === 'Аня') await s.shot(p, 'phone-landing')
      await p.getByRole('button', { name: /^Войти/ }).click()
      await p.waitForURL(new RegExp(`/r/${code}$`))
      await p.getByPlaceholder('Например, Аня').fill(name)
      await p.getByRole('button', { name: 'Войти в игру' }).click()
      await p.locator('.buzzer').waitFor()
      phones[name] = p
    }
    const { Аня: anna, Борис: boris, Вика: vika } = phones

    step('Неверный код и несуществующая комната')
    const wrong = code === '999999' ? '999998' : '999999'
    const lost = await s.page('lost', { ...devices['Pixel 7'] }, /status of 404/)
    await lost.goto(`${BASE}/`)
    await lost.locator('.code-input').fill(wrong)
    await lost.getByRole('button', { name: /^Войти/ }).click()
    await lost.getByText('Комната не найдена').waitFor()
    await lost.goto(`${BASE}/r/${wrong}`)
    await lost.getByText('Игра не найдена').waitFor()

    step('Экран для зрителей по коду')
    const screen = await s.page('screen', { viewport: { width: 1280, height: 720 } })
    await screen.goto(`${BASE}/`)
    await screen.locator('.code-input').fill(code)
    await screen.getByRole('button', { name: /как экран/ }).click()
    await screen.waitForURL(new RegExp(`/r/${code}/screen$`))
    await screen.getByRole('button', { name: 'Включить звук' }).click()
    await screen.locator('.url.code').waitFor()
    await s.shot(screen, 'screen-lobby')

    step('Режим «Игроки в разных местах»')
    await host.getByRole('button', { name: /Показать QR крупно/ }).click()
    await host.getByText('Код комнаты', { exact: true }).waitFor()
    await host.locator('.modal').getByLabel(/Игроки в разных местах/).check()
    await sleep(300)
    await s.shot(host, 'host-join-modal')
    await host.keyboard.press('Escape')

    step('Синхронный старт: «Внимание…», затем «Жми!»')
    await host.getByRole('button', { name: 'Выбрать пакет' }).click()
    await host.locator('.pack', { hasText: 'Демо: Своя игра' }).getByRole('button', { name: 'Играть' }).click()
    await host.getByRole('button', { name: 'Начать игру' }).click()
    await host.locator('.board').waitFor()
    await host.locator('.board .cell', { hasText: '10' }).first().click()
    await host.locator('.q-head').waitFor()
    await host.keyboard.press('Space')
    await anna.getByText('Внимание…').waitFor({ timeout: 2000 })
    await anna.locator('.buzzer.go').waitFor()
    await tap(anna)
    await host.locator('.responder', { hasText: 'Аня' }).waitFor()
    await anna.getByText('Ваш ответ!').waitFor()
    await host.keyboard.press('Enter')
    await host.getByText('Ответ показан на экране').waitFor()
    await host.getByRole('button', { name: 'К темам' }).click()
    await host.locator('.board').waitFor()

    step('Устройства игроков становятся экраном и пультом ведущего')
    host.once('dialog', (d) => d.accept())
    await host.locator('.comp', { hasText: 'Борис' }).getByTitle(/Сделать экраном/).click()
    await boris.waitForURL(new RegExp(`/r/${code}/screen$`))
    await boris.getByText('Экран игры').waitFor()
    host.once('dialog', (d) => d.accept())
    await host.locator('.comp', { hasText: 'Вика' }).getByTitle(/Сделать ведущим/).click()
    await vika.waitForURL(new RegExp(`/r/${code}/host$`))
    await vika.locator('.room-chip').waitFor()
    await s.shot(vika, 'phone-as-host')

    step('Редактор пакетов комнаты: копия и сохранение в библиотеке ведущего')
    const editor = await host.context().newPage()
    await editor.setViewportSize({ width: 1440, height: 900 })
    await editor.goto(`${BASE}/r/${code}/editor/demo-svoya-igra`)
    await editor.getByRole('button', { name: /Сделать копию/ }).click()
    await editor.getByText('Создана копия').waitFor()
    await editor.waitForURL(new RegExp(`/r/${code}/editor/`))
    await editor.locator('.q-chip').first().click()
    await editor.locator('input.answer').fill('Тихий океан (онлайн)')
    await editor.keyboard.press('Control+s')
    await editor.getByText('Сохранено').waitFor()
    await editor.close()
    await host.locator('button.pack-btn').click()
    // Копия встроенного пакета попала в библиотеку ведущего — её можно редактировать.
    await host.locator('.pack').filter({ has: host.getByRole('button', { name: 'Редактировать' }) }).first().waitFor()
    await host.keyboard.press('Escape')

    step('Закрытие комнаты')
    await host.locator('button[title="Настройки"]').click()
    host.once('dialog', (d) => d.accept())
    await host.getByRole('button', { name: /Закрыть комнату/ }).click()
    await host.waitForURL(`${BASE}/`)
    await host.getByRole('heading', { name: 'Провести игру' }).waitFor()
    await anna.getByText('Игра завершена').waitFor()
    await boris.getByText('Игра завершена').waitFor()
    await s.shot(anna, 'phone-room-closed')
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
  ['Спортивная «Своя игра» командами', sportScenario],
  ['«Хамса» командами', khamsaScenario],
  ['Комнаты и игра через интернет', roomsScenario],
]) {
  if (process.env.E2E_ONLY && !title.includes(process.env.E2E_ONLY)) continue
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
