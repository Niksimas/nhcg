// Генерирует медиафайлы демо-пакета: флаги (SVG) и мелодии (WAV, синтез «музыкальной шкатулки»).
// Запуск: node scripts/make-demo-media.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const out = path.join(root, 'server', 'demo-packs', 'demo-svoya-igra', 'media')
fs.mkdirSync(out, { recursive: true })

const flags = {
  'flag-1.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600"><rect width="900" height="600" fill="#fff"/><circle cx="450" cy="300" r="180" fill="#bc002d"/></svg>`,
  'flag-2.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="1" height="2" fill="#009246"/><rect x="1" width="1" height="2" fill="#fff"/><rect x="2" width="1" height="2" fill="#ce2b37"/></svg>`,
  'flag-3.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 10"><rect width="16" height="10" fill="#006aa7"/><rect x="5" width="2" height="10" fill="#fecc00"/><rect y="4" width="16" height="2" fill="#fecc00"/></svg>`,
  'flag-4.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#da291c"/><rect x="13" y="6" width="6" height="20" fill="#fff"/><rect x="6" y="13" width="20" height="6" fill="#fff"/></svg>`,
  'flag-5.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 27 18"><rect width="27" height="18" fill="#0d5eaf"/>${[1, 3, 5, 7]
    .map((i) => `<rect y="${i * 2}" width="27" height="2" fill="#fff"/>`)
    .join('')}<rect width="10" height="10" fill="#0d5eaf"/><rect x="4" width="2" height="10" fill="#fff"/><rect y="4" width="10" height="2" fill="#fff"/></svg>`,
}
for (const [name, svg] of Object.entries(flags)) fs.writeFileSync(path.join(out, name), `${svg}\n`)

// ── синтез мелодий ──
const RATE = 16000
const NOTE = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }
function freq(name) {
  const m = /^([A-G])(#?)(\d)$/.exec(name)
  const semis = NOTE[m[1]] + (m[2] ? 1 : 0) + (Number(m[3]) - 4) * 12
  return 440 * 2 ** (semis / 12)
}

// notes: [[имя ноты | null (пауза), длительность в долях]]
function render(notes, beat) {
  const total = notes.reduce((s, [, d]) => s + d, 0) * beat + 1.2
  const buf = new Float32Array(Math.ceil(total * RATE))
  let t = 0
  for (const [name, dur] of notes) {
    if (name) {
      const f = freq(name)
      const start = Math.floor(t * RATE)
      const len = Math.floor((dur * beat + 0.9) * RATE)
      for (let i = 0; i < len && start + i < buf.length; i++) {
        const x = i / RATE
        const env = Math.min(1, x / 0.005) * Math.exp(-x * 3.2)
        const v =
          Math.sin(2 * Math.PI * f * x) * 0.6 +
          Math.sin(2 * Math.PI * f * 2 * x) * 0.25 * Math.exp(-x * 4) +
          Math.sin(2 * Math.PI * f * 3 * x) * 0.12 * Math.exp(-x * 6)
        buf[start + i] += v * env * 0.45
      }
    }
    t += dur * beat
  }
  return buf
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    data.writeInt16LE(Math.round(s * 32767), i * 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(RATE, 24)
  h.writeUInt32LE(RATE * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

// Бетховен, «Ода к радости» (первая фраза)
const ode = [
  ['E5', 1], ['E5', 1], ['F5', 1], ['G5', 1], ['G5', 1], ['F5', 1], ['E5', 1], ['D5', 1],
  ['C5', 1], ['C5', 1], ['D5', 1], ['E5', 1], ['E5', 1.5], ['D5', 0.5], ['D5', 2],
]
// Моцарт, «Маленькая ночная серенада» (начало)
const serenade = [
  ['G4', 1], [null, 0.5], ['D4', 0.5], ['G4', 1], [null, 0.5], ['D4', 0.5],
  ['G4', 0.5], ['D4', 0.5], ['G4', 0.5], ['B4', 0.5], ['D5', 1], [null, 1],
  ['C5', 1], [null, 0.5], ['A4', 0.5], ['C5', 1], [null, 0.5], ['A4', 0.5],
  ['C5', 0.5], ['A4', 0.5], ['F#4', 0.5], ['A4', 0.5], ['D4', 1],
]

fs.writeFileSync(path.join(out, 'melody-1.wav'), wav(render(ode, 0.36)))
fs.writeFileSync(path.join(out, 'melody-2.wav'), wav(render(serenade, 0.42)))
console.log('Готово:', fs.readdirSync(out).join(', '))
