import { randomBytes } from 'node:crypto'

// Ошибка, текст которой можно показать пользователю.
export class GameError extends Error {
  constructor(message, extra = {}) {
    super(message)
    this.name = 'GameError'
    Object.assign(this, extra)
  }
}

export const newId = (bytes = 6) => randomBytes(bytes).toString('base64url')

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export const finite = (v) => typeof v === 'number' && Number.isFinite(v)

// Очистка строки от управляющих символов и лишних пробелов.
export function cleanName(value, max = 24) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

// Как cleanName, но сохраняет переводы строк (для ответов в финале).
export function cleanText(value, max = 300) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f\u200b-\u200f\u2028-\u202e\ufeff]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max)
}
