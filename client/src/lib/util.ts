import { onUnmounted, ref, type Ref } from 'vue'
import type { GameConnection } from './connection'
import type { Competitor, ContentItem, GameState, TimerState } from './types'

// Чёрный или белый текст поверх цвета фона.
export function textOn(bg: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(bg || '')
  if (!m) return '#fff'
  const n = parseInt(m[1], 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  // Порог ниже середины: на жёлтом, оранжевом, бирюзовом тёмный текст читается лучше белого.
  return lum > 0.3 ? '#141a2e' : '#fff'
}

// Склонение: plural(5, 'игрок', 'игрока', 'игроков') → «игроков».
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  if (b === 1) return one
  return many
}

export function fmtScore(n: number): string {
  return n.toLocaleString('ru-RU')
}

export function contentText(items: ContentItem[] | null | undefined): string {
  return (items ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join(' ')
}

// Сколько осталось. Если таймер назначен на будущее (синхронный старт по интернету) — показываем полное время.
export function timerLeft(t: TimerState | undefined | null, now: number): number {
  if (!t) return 0
  return t.running && t.endsAt != null ? Math.min(t.total, Math.max(0, t.endsAt - now)) : Math.max(0, t.remaining)
}

export function competitorMap(state: GameState | null): Map<string, Competitor> {
  return new Map((state?.competitors ?? []).map((c) => [c.id, c]))
}

// «Серверное сейчас», обновляемое несколько раз в секунду — для таймеров.
export function useServerNow(conn: GameConnection, interval = 100): Ref<number> {
  const now = ref(conn.serverNow())
  const timer = window.setInterval(() => {
    now.value = conn.serverNow()
  }, interval)
  onUnmounted(() => clearInterval(timer))
  return now
}

// Подписка на сообщения соединения на время жизни компонента.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useConnMessage(conn: GameConnection, type: string, fn: (msg: any) => void) {
  const off = conn.on(type, fn)
  onUnmounted(off)
}

export function randomToken(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    } catch {
      // приватный режим — просто не запоминаем
    }
  },
}

export const TYPE_LABEL: Record<string, string> = {
  normal: 'Обычный',
  cat: 'Кот в мешке',
  auction: 'Аукцион',
  norisk: 'Без риска',
}
