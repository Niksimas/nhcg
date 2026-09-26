import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectivePressTime, greenTime, collectWindow, rankPresses, median, syncStartDelay, FAIRNESS_ONLINE } from '../game/buzzer.js'

test('заявленное время используется, если оно правдоподобно', () => {
  assert.equal(effectivePressTime({ claimed: 950, arrival: 1000, rtt: 100 }), 950)
})

test('нажатие «из будущего» обрезается до времени прихода', () => {
  assert.equal(effectivePressTime({ claimed: 1200, arrival: 1000, rtt: 100 }), 1000)
})

test('нельзя сдвинуть нажатие в прошлое дальше измеренной задержки', () => {
  // rtt 20 + запас 30 = максимум 50 мс назад
  assert.equal(effectivePressTime({ claimed: 500, arrival: 1000, rtt: 20 }), 950)
  // даже при огромном пинге — не больше 300 мс
  assert.equal(effectivePressTime({ claimed: 0, arrival: 1000, rtt: 5000 }), 700)
})

test('без синхронизации часов берётся половина RTT', () => {
  assert.equal(effectivePressTime({ claimed: null, arrival: 1000, rtt: 40 }), 980)
  // явно несинхронизированные часы (разница больше 5 секунд)
  assert.equal(effectivePressTime({ claimed: 123, arrival: 100_000, rtt: 40 }), 99_980)
})

test('окно сбора нажатий зависит от худшего пинга и ограничено', () => {
  assert.equal(collectWindow([]), 40)
  assert.equal(collectWindow([5, 10]), 40)
  assert.equal(collectWindow([20, 80]), 110)
  assert.equal(collectWindow([null]), 180)
  assert.equal(collectWindow([2000]), 300)
})

test('сортировка нажатий: по честному времени, затем по приходу', () => {
  const r = rankPresses([
    { id: 'a', t: 10, arrival: 50 },
    { id: 'b', t: 5, arrival: 60 },
    { id: 'c', t: 10, arrival: 40 },
  ])
  assert.deepEqual(r.map((x) => x.id), ['b', 'c', 'a'])
})

test('момент, когда кнопка загорелась: не раньше открытия и не позже задержки связи и отрисовки', () => {
  assert.equal(greenTime({ go: 1030, openedAt: 1000, rtt: 20 }), 1030)
  assert.equal(greenTime({ go: 990, openedAt: 1000, rtt: 20 }), 1000, 'раньше открытия кнопок загореться не могла')
  // rtt 20 + запас 30 + отрисовка 50 = не позже 100 мс после открытия
  assert.equal(greenTime({ go: 1500, openedAt: 1000, rtt: 20 }), 1100)
  assert.equal(greenTime({ go: null, openedAt: 1000, rtt: 20 }), 1000, 'телефон не сообщил — считаем от открытия')
  assert.equal(greenTime({ go: 1030, openedAt: null, rtt: 20 }), null)
})

test('сортировка нажатий по скорости: от момента, когда кнопка загорелась у игрока', () => {
  const r = rankPresses([
    { id: 'fast-wifi', t: 310, start: 10, arrival: 320 },
    { id: 'slow-wifi', t: 340, start: 90, arrival: 400 },
  ])
  assert.deepEqual(r.map((x) => x.id), ['slow-wifi', 'fast-wifi'], 'нажал позже, но среагировал быстрее')
})

test('медиана', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 2, 3]), 2.5)
  assert.equal(median([]), null)
})

test('синхронный старт по интернету: задержка зависит от худшего пинга и ограничена', () => {
  assert.equal(syncStartDelay([]), 400)
  assert.equal(syncStartDelay([20, 50]), 400)
  assert.equal(syncStartDelay([300, 40]), 550)
  assert.equal(syncStartDelay([null]), 500, 'неизвестный пинг считается как 250 мс')
  assert.equal(syncStartDelay([5000]), 1500)
})

test('по интернету допуски шире: большая задержка компенсируется сильнее', () => {
  const press = { claimed: 10_000, arrival: 10_700, rtt: 800 }
  assert.equal(effectivePressTime(press), 10_400, 'в локальной сети компенсация не больше 300 мс')
  assert.equal(effectivePressTime(press, FAIRNESS_ONLINE), 10_000)
  assert.equal(collectWindow([800], FAIRNESS_ONLINE), 860)
})
