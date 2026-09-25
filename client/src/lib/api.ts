// REST-запросы ведущего (пакеты вопросов, комнаты).
import { storage } from './util'
import { apiBase, roomKey } from './room'

// Ключ ведущего хранится отдельно для каждой комнаты.
const hostKeyName = (code?: string | null) => (code === undefined ? roomKey('quiz.hostKey') : roomKey('quiz.hostKey', code))

// Ключ ведущего: из адреса (?key=...) или сохранённый ранее.
export function getHostKey(): string | null {
  const url = new URL(location.href)
  const fromUrl = url.searchParams.get('key')
  if (fromUrl) {
    storage.set(hostKeyName(), fromUrl.trim().toUpperCase())
    url.searchParams.delete('key')
    history.replaceState(history.state, '', url.pathname + url.search + url.hash)
  }
  return storage.get(hostKeyName())
}

export function setHostKey(key: string | null, code?: string | null) {
  storage.set(hostKeyName(code), key)
}

function headers(): Record<string, string> {
  const key = storage.get(hostKeyName())
  return key ? { 'x-host-key': key } : {}
}

async function parseError(res: Response): Promise<Error> {
  try {
    const data = await res.json()
    return new Error(data.error || `Ошибка ${res.status}`)
  } catch {
    return new Error(`Ошибка ${res.status}`)
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const h = headers()
  let payload: BodyInit | undefined
  if (body !== undefined) {
    h['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let res: Response
  try {
    res = await fetch(`${apiBase()}${path}`, { method, headers: h, body: payload })
  } catch {
    throw new Error('Нет связи с сервером')
  }
  if (!res.ok) throw await parseError(res)
  return res.json() as Promise<T>
}

// Загрузка файла с прогрессом (для больших пакетов SIGame).
export function upload<T = unknown>(path: string, file: File, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${apiBase()}${path}`)
    for (const [k, v] of Object.entries(headers())) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      let data: { error?: string } | null = null
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        data = null
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T)
      else reject(new Error(data?.error || `Ошибка ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error('Нет связи с сервером'))
    const form = new FormData()
    form.append('file', file, file.name)
    xhr.send(form)
  })
}

export function downloadUrl(path: string): string {
  const key = storage.get(hostKeyName())
  return `${apiBase()}${path}${key ? `?key=${encodeURIComponent(key)}` : ''}`
}

// Запрос вне комнаты (создание комнаты, проверка кода).
export async function apiRoot<T = unknown>(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  const h: Record<string, string> = { ...extraHeaders }
  let payload: BodyInit | undefined
  if (body !== undefined) {
    h['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let res: Response
  try {
    res = await fetch(`/api${path}`, { method, headers: h, body: payload })
  } catch {
    throw new Error('Нет связи с сервером')
  }
  if (!res.ok) throw await parseError(res)
  return res.json() as Promise<T>
}
