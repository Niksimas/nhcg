// Текущая комната: код из адреса (/r/123456/...) или основная комната сервера в режиме «одна игра».
import { reactive } from 'vue'
import { storage } from './util'

export type ServerMode = 'local' | 'rooms'

// Что это за сервер: одна игра на компьютере ведущего или сервер комнат.
export const serverMeta = reactive<{ mode: ServerMode; version: string; loaded: boolean }>({
  mode: 'local',
  version: '',
  loaded: false,
})

export const room = reactive<{ code: string | null }>({ code: null })

export async function loadServerMeta(): Promise<void> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), 4000)
  try {
    const res = await fetch('/api/info', { signal: ctrl.signal })
    if (res.ok) {
      const data = await res.json()
      if (data?.mode === 'rooms' || data?.mode === 'local') serverMeta.mode = data.mode
      serverMeta.version = String(data?.version ?? '')
    }
  } catch {
    // Сервер недоступен — считаем, что это одна игра; соединение само переподключится.
  } finally {
    clearTimeout(timer)
    serverMeta.loaded = true
  }
}

export function setRoom(code: string | null) {
  room.code = code
}

// Адрес страницы в текущей комнате: roomPath('/host') → /r/123456/host (или /host для основной комнаты).
export function roomPath(sub = '', code: string | null = room.code): string {
  return code ? `/r/${code}${sub}` : sub || '/'
}

export function apiBase(code: string | null = room.code): string {
  return code ? `/api/rooms/${code}` : '/api'
}

export function wsPath(code: string | null = room.code): string {
  return code ? `/ws?room=${code}` : '/ws'
}

// Ключ localStorage, свой для каждой комнаты (у основной комнаты — как в первой версии).
export function roomKey(base: string, code: string | null = room.code): string {
  return code ? `${base}.${code}` : base
}

export function normalizeCode(input: string): string {
  return String(input ?? '').replace(/\D/g, '').slice(0, 6)
}

export function formatCode(code: string | null | undefined): string {
  const c = code ?? ''
  return c.length === 6 ? `${c.slice(0, 3)} ${c.slice(3)}` : c
}

// Комнаты, созданные в этом браузере (для быстрого возврата в панель ведущего).
export interface MyRoom {
  code: string
  createdAt: number
}

const MY_ROOMS = 'quiz.myRooms'

export function myRooms(): MyRoom[] {
  try {
    const list = JSON.parse(storage.get(MY_ROOMS) ?? '[]')
    return Array.isArray(list)
      ? list.filter((r) => r && typeof r.code === 'string' && /^\d{6}$/.test(r.code)).slice(0, 20)
      : []
  } catch {
    return []
  }
}

export function rememberRoom(code: string) {
  const list = myRooms().filter((r) => r.code !== code)
  list.unshift({ code, createdAt: Date.now() })
  storage.set(MY_ROOMS, JSON.stringify(list.slice(0, 20)))
}

export function forgetRoom(code: string) {
  storage.set(MY_ROOMS, JSON.stringify(myRooms().filter((r) => r.code !== code)))
  storage.set(roomKey('quiz.hostKey', code), null)
}
