// Простой ограничитель частоты запросов по ключу (обычно — IP-адрес) в скользящем окне.
export class RateLimiter {
  constructor({ limit, windowMs }) {
    this.limit = limit
    this.windowMs = windowMs
    this.hits = new Map()
  }

  entry(key, now) {
    let e = this.hits.get(key)
    if (!e || now - e.start >= this.windowMs) {
      e = { start: now, count: 0 }
      this.hits.set(key, e)
    }
    if (this.hits.size > 10_000) this.cleanup(now)
    return e
  }

  // Засчитать попытку. false — лимит превышен.
  hit(key, now = Date.now()) {
    const e = this.entry(key, now)
    e.count++
    return e.count <= this.limit
  }

  // Лимит уже исчерпан (попытку не засчитываем).
  blocked(key, now = Date.now()) {
    return this.entry(key, now).count >= this.limit
  }

  cleanup(now) {
    for (const [k, e] of this.hits) if (now - e.start >= this.windowMs) this.hits.delete(k)
  }
}

// IP клиента. Адрес из X-Forwarded-For берём, если так велено (TRUST_PROXY=1, прокси в другом контейнере)
// или если запрос пришёл с этого же компьютера — значит, его переслал локальный прокси или туннель.
// Подделать заголовок извне так нельзя: удалённый клиент не может быть 127.0.0.1.
export function clientIp(req, trustProxy) {
  let addr = String(req.socket?.remoteAddress ?? '')
  if (addr.startsWith('::ffff:')) addr = addr.slice(7)
  const fwd = String(req.headers?.['x-forwarded-for'] ?? '').split(',')[0].trim()
  if (fwd && (trustProxy || addr === '::1' || addr.startsWith('127.'))) return fwd
  return addr
}
