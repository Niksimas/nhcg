import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectivePressTime, collectWindow, rankPresses, median } from '../game/buzzer.js'

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

test('медиана', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 2, 3]), 2.5)
  assert.equal(median([]), null)
})
