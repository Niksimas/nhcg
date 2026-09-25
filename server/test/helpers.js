import { Game } from '../game/game.js'

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

// Игра с управляемым временем. settings — настройки поверх стандартных (например, скелет «Своей игры»).
export function makeGame({ settings = null } = {}) {
  const time = new FakeTime()
  const game = new Game({
    clock: time.now,
    timers: { setTimeout: time.setTimeout, clearTimeout: time.clearTimeout },
  })
  if (settings) game.hostCommand('settings.update', { patch: settings })
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
