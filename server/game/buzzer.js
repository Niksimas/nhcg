// Чистые функции «честной кнопки».
//
// Идея: каждый клиент синхронизирует часы с сервером (как NTP) и присылает вместе с нажатием
// момент нажатия уже в серверном времени, а также момент, когда кнопка загорелась зелёным на его экране.
// Скорость нажатия считается от момента, когда кнопка загорелась, — так телефон с медленным Wi-Fi
// не проигрывает телефону с быстрым ни при получении сигнала, ни при отправке нажатия. Чтобы подменой
// времени нельзя было выиграть, оба заявленных момента ограничиваются измеренной сервером задержкой (RTT)
// конкретного устройства.

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

export const FAIRNESS = {
  maxCompensation: 300, // мс — больше этого «назад во времени» нажатие не сдвигаем
  slack: 30, // мс — запас на джиттер
  defaultRtt: 150, // мс — если задержка устройства ещё не измерена
  minWindow: 40, // мс — минимальное окно сбора нажатий
  maxWindow: 300, // мс — максимальное окно сбора нажатий
  maxClockError: 5000, // мс — если заявленное время дальше, клиент явно не синхронизирован
  renderLag: 50, // мс — сколько сверх задержки сети может занять отрисовка зелёной кнопки на телефоне
}

// Для игры по интернету задержки больше и нестабильнее — допуски шире.
export const FAIRNESS_ONLINE = {
  ...FAIRNESS,
  maxCompensation: 1000,
  slack: 60,
  defaultRtt: 250,
  maxWindow: 1000,
}

// Через сколько миллисекунд после команды ведущего открыть кнопки, чтобы сигнал успел дойти
// до всех устройств и загорелся у всех одновременно (для игры по интернету).
export function syncStartDelay(rtts) {
  let worst = 0
  for (const r of rtts) worst = Math.max(worst, finite(r) ? r : FAIRNESS_ONLINE.defaultRtt)
  return Math.round(Math.min(1500, Math.max(400, worst + 250)))
}

// Эффективный (честный) момент нажатия в серверном времени.
// claimed — время, которое прислал клиент (может отсутствовать), arrival — когда сообщение пришло,
// rtt — измеренная сервером задержка «туда-обратно» до этого устройства.
export function effectivePressTime({ claimed, arrival, rtt }, opts = FAIRNESS) {
  const r = finite(rtt) ? rtt : opts.defaultRtt
  const maxComp = Math.max(0, Math.min(opts.maxCompensation, r + opts.slack))
  let t
  if (finite(claimed) && Math.abs(claimed - arrival) <= opts.maxClockError) {
    t = claimed
  } else {
    // Клиент не прислал время или его часы не синхронизированы — считаем, что сообщение
    // летело половину RTT.
    t = arrival - Math.min(maxComp, r / 2)
  }
  if (t > arrival) t = arrival
  if (t < arrival - maxComp) t = arrival - maxComp
  return t
}

// Момент, когда кнопка загорелась зелёным у игрока (go — его сообщает телефон, в серверном времени).
// Не раньше открытия кнопок (openedAt) и не позже, чем сигнал мог идти до этого телефона и отрисовываться.
// Телефон не сообщил момент (старая версия, часы не синхронизированы) — считаем от открытия кнопок.
export function greenTime({ go, openedAt, rtt }, opts = FAIRNESS) {
  if (!finite(openedAt)) return null
  if (!finite(go)) return openedAt
  const r = finite(rtt) ? rtt : opts.defaultRtt
  const maxLag = Math.max(0, Math.min(opts.maxCompensation, r + opts.slack)) + opts.renderLag
  return Math.min(Math.max(go, openedAt), openedAt + maxLag)
}

// Сколько ждать после первого пришедшего нажатия, чтобы успели дойти нажатия от устройств
// с большей задержкой, которые на самом деле могли быть раньше.
export function collectWindow(rtts, opts = FAIRNESS) {
  let worst = 0
  for (const r of rtts) worst = Math.max(worst, finite(r) ? r : opts.defaultRtt)
  return Math.round(Math.min(opts.maxWindow, Math.max(opts.minWindow, worst + opts.slack)))
}

// Упорядочивание нажатий: по скорости — от момента, когда кнопка загорелась у игрока (start), до нажатия;
// при равенстве — по времени прихода. Без start (все кнопки загорелись одновременно) — по честному времени нажатия.
export function rankPresses(presses) {
  const reaction = (p) => p.t - (finite(p.start) ? p.start : 0)
  return [...presses].sort((a, b) => reaction(a) - reaction(b) || a.arrival - b.arrival)
}

// Медиана массива чисел (для сглаживания пинга).
export function median(values) {
  const arr = values.filter(finite).sort((a, b) => a - b)
  if (!arr.length) return null
  const mid = arr.length >> 1
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2
}
