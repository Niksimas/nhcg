import { Game } from '../game/game.js'
import { normalizePack } from '../packs/normalize.js'

// Управляемые «часы» и таймеры для детерминированных тестов.
export class FakeTime {
  constructor(start = 10_000) {
    this.t = start
    this.queue = []
    this.seq = 0
    this.now = () => this.t
    this.setTimeout = (fn, ms) => {
      const id = ++this.seq
      this.queue.push({ id, at: this.t + Math.max(0, ms ?? 0), fn })
      return id
    }
    this.clearTimeout = (id) => {
      this.queue = this.queue.filter((x) => x.id !== id)
    }
  }

  advance(ms) {
    const end = this.t + ms
    for (;;) {
      this.queue.sort((a, b) => a.at - b.at || a.id - b.id)
      const next = this.queue[0]
      if (!next || next.at > end) break
      this.queue.shift()
      this.t = next.at
      next.fn()
    }
    this.t = end
  }
}

export const TEST_PACK = normalizePack(
  {
    title: 'Тестовый пакет',
    author: 'Тест',
    rounds: [
      {
        name: 'Раунд 1',
        themes: [
          {
            name: 'Тема А',
            questions: [
              { price: 100, question: 'Вопрос А100', answer: 'Ответ А100' },
              { price: 200, question: 'Вопрос А200', answer: 'Ответ А200', type: 'cat', catTheme: 'Коты', catPrice: 500 },
            ],
          },
          {
            name: 'Тема Б',
            questions: [
              { price: 100, question: 'Вопрос Б100', answer: 'Ответ Б100', type: 'auction' },
              { price: 200, question: 'Вопрос Б200', answer: 'Ответ Б200', type: 'norisk' },
            ],
          },
        ],
      },
      {
        name: 'Финал',
        type: 'final',
        themes: [
          { name: 'Финал 1', questions: [{ price: 0, question: 'Финальный вопрос 1', answer: 'Ф1' }] },
          { name: 'Финал 2', questions: [{ price: 0, question: 'Финальный вопрос 2', answer: 'Ф2' }] },
        ],
      },
    ],
  },
  { id: 'test-pack' },
)

export function makeGame({ pack = TEST_PACK } = {}) {
  const time = new FakeTime()
  const game = new Game({
    clock: time.now,
    timers: { setTimeout: time.setTimeout, clearTimeout: time.clearTimeout },
    packStore: {
      async loadForGame(id) {
        if (pack && id === pack.id) return pack
        throw new Error('not found')
      },
    },
  })
  const events = []
  game.on('event', (e) => events.push(e))
  return { game, time, events }
}

// Добавляет игроков, «подключает» их и задаёт пинг.
export function addPlayers(game, names, ping = 20) {
  return names.map((name) => {
    const p = game.join({ name })
    game.attach(p.id)
    game.updatePing(p.id, ping)
    return p
  })
}
