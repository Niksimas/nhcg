// Проверка и приведение пакета вопросов к единому формату.
//
// Формат пакета (pack.json):
// {
//   "title": "Название", "author": "Автор", "description": "...",
//   "rounds": [
//     { "name": "Раунд 1", "type": "normal" | "final",
//       "themes": [
//         { "name": "Тема",
//           "questions": [
//             { "price": 100,
//               "type": "normal" | "cat" | "auction" | "norisk",
//               "content": [ { "type": "text", "text": "Вопрос" }, { "type": "image", "src": "file.jpg" } ],
//               "answer": "Ответ",
//               "answerContent": [ ... ],     // что показать вместе с ответом (необязательно)
//               "comment": "Заметка для ведущего",
//               "catTheme": "...", "catPrice": 500, "catPriceOptions": [100, 500], "catSelf": false
//             } ] } ] } ] }
//
// Для удобства ручного написания принимаются сокращения: "question": "текст", "image": "file.jpg",
// "audio", "video", плоский список "questions" без раундов/тем и т.п.

export class PackError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PackError'
  }
}

const LIMITS = { rounds: 100, themes: 100, questions: 100, content: 30, title: 200, text: 5000, answer: 2000 }
const MEDIA = ['image', 'audio', 'video']

const str = (v, max) => {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v)
  if (typeof v !== 'string') return ''
  return v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max)
}

const QUESTION_TYPES = {
  normal: 'normal',
  simple: 'normal',
  cat: 'cat',
  bagcat: 'cat',
  secret: 'cat',
  secretpublicprice: 'cat',
  secretnoquestion: 'cat',
  'кот': 'cat',
  'кот в мешке': 'cat',
  auction: 'auction',
  stake: 'auction',
  'аукцион': 'auction',
  norisk: 'norisk',
  sponsored: 'norisk',
  'без риска': 'norisk',
}

// Проверка ссылки на медиафайл: либо имя файла в папке media пакета, либо http(s)/data-URL.
export function cleanMediaSrc(src) {
  if (typeof src !== 'string') return null
  const s = src.trim()
  if (!s) return null
  if (/^https?:\/\//i.test(s)) return s.slice(0, 2000)
  if (/^data:(image|audio|video)\//i.test(s)) return s.length <= 15_000_000 ? s : null
  const name = s.replace(/^media[\\/]/, '').replace(/^@/, '')
  if (!name || name.length > 255 || /[\\/]/.test(name) || name === '.' || name === '..') return null
  return name
}

export function isLocalMedia(src) {
  return typeof src === 'string' && !/^(https?:|data:)/i.test(src)
}

function normalizeContent(raw) {
  if (raw == null) return []
  const list = Array.isArray(raw) ? raw : [raw]
  const out = []
  for (const item of list) {
    if (out.length >= LIMITS.content) break
    if (typeof item === 'string' || typeof item === 'number') {
      const text = str(item, LIMITS.text)
      if (text) out.push({ type: 'text', text })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const type = String(item.type ?? 'text').toLowerCase()
    if (type === 'text' || type === 'say') {
      const text = str(item.text ?? item.value, LIMITS.text)
      if (text) out.push({ type: 'text', text })
    } else if (MEDIA.includes(type) || type === 'voice') {
      const src = cleanMediaSrc(item.src ?? item.value ?? item.file)
      if (src) out.push({ type: type === 'voice' ? 'audio' : type, src })
    }
  }
  return out
}

function normalizeQuestion(raw, index) {
  if (typeof raw === 'string') raw = { question: raw }
  if (!raw || typeof raw !== 'object') return null
  let content = normalizeContent(raw.content)
  if (!content.length) {
    const text = str(raw.question ?? raw.text, LIMITS.text)
    if (text) content.push({ type: 'text', text })
    for (const kind of MEDIA) {
      const src = cleanMediaSrc(raw[kind])
      if (src) content.push({ type: kind, src })
    }
  }
  const priceNum = Number(raw.price)
  const price = Number.isFinite(priceNum) && priceNum >= 0 ? Math.min(1e9, Math.round(priceNum)) : (index + 1) * 100
  const typeKey = String(raw.type ?? 'normal').toLowerCase().trim()
  const type = QUESTION_TYPES[typeKey] ?? 'normal'
  let answer = raw.answer
  if (Array.isArray(answer)) answer = answer.map((a) => str(a, LIMITS.answer)).filter(Boolean).join(' / ')
  const q = {
    price,
    type,
    content,
    answer: str(answer, LIMITS.answer),
    answerContent: normalizeContent(raw.answerContent),
    comment: str(raw.comment, LIMITS.text),
  }
  if (type === 'cat') {
    q.catTheme = str(raw.catTheme, LIMITS.title)
    const cp = Number(raw.catPrice)
    q.catPrice = Number.isFinite(cp) && cp >= 0 ? Math.round(cp) : price
    if (Array.isArray(raw.catPriceOptions)) {
      const opts = [...new Set(raw.catPriceOptions.map(Number).filter((n) => Number.isFinite(n) && n >= 0).map(Math.round))]
      if (opts.length > 1) q.catPriceOptions = opts.slice(0, 20)
    }
    q.catSelf = raw.catSelf === true
  }
  return q
}

function normalizeTheme(raw, ti) {
  if (!raw || typeof raw !== 'object') return null
  const questions = (Array.isArray(raw.questions) ? raw.questions : [])
    .slice(0, LIMITS.questions)
    .map((q, i) => normalizeQuestion(q, i))
    .filter(Boolean)
  return { name: str(raw.name ?? raw.title, LIMITS.title) || `Тема ${ti + 1}`, questions }
}

function normalizeRound(raw, ri) {
  if (!raw || typeof raw !== 'object') return null
  const typeRaw = String(raw.type ?? '').toLowerCase()
  const type = typeRaw === 'final' || typeRaw === 'финал' ? 'final' : 'normal'
  const name = str(raw.name ?? raw.title, LIMITS.title) || (type === 'final' ? 'Финал' : `Раунд ${ri + 1}`)
  let themesRaw = Array.isArray(raw.themes) ? raw.themes : null
  if (!themesRaw && Array.isArray(raw.questions)) themesRaw = [{ name, questions: raw.questions }]
  const themes = (themesRaw ?? [])
    .slice(0, LIMITS.themes)
    .map((t, i) => normalizeTheme(t, i))
    .filter(Boolean)
  return { name, type, themes }
}

// Приводит «сырой» объект (из JSON-файла, редактора или импорта) к формату пакета.
export function normalizePack(raw, { id } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    if (Array.isArray(raw)) raw = { questions: raw }
    else throw new PackError('Файл пакета должен содержать JSON-объект')
  }
  const title = str(raw.title ?? raw.name, LIMITS.title) || 'Без названия'
  let roundsRaw = Array.isArray(raw.rounds) ? raw.rounds : null
  if (!roundsRaw && Array.isArray(raw.themes)) roundsRaw = [{ name: 'Раунд 1', themes: raw.themes }]
  if (!roundsRaw && Array.isArray(raw.questions)) roundsRaw = [{ name: 'Вопросы', themes: [{ name: 'Вопросы', questions: raw.questions }] }]
  if (!roundsRaw) throw new PackError('В пакете нет раундов (поле "rounds") или списка вопросов ("questions")')
  const rounds = roundsRaw
    .slice(0, LIMITS.rounds)
    .map((r, i) => normalizeRound(r, i))
    .filter(Boolean)
  const pack = {
    title,
    author: str(raw.author, LIMITS.title),
    description: str(raw.description, LIMITS.text),
    rounds,
  }
  if (id) pack.id = id
  return pack
}

// Подготовка пакета к игре: убираются пустые темы/раунды, пути к медиа превращаются в URL.
export function prepareForGame(pack, mediaUrl) {
  const mapContent = (list) =>
    list.map((c) => (c.type === 'text' || !isLocalMedia(c.src) ? { ...c } : { ...c, src: mediaUrl(c.src) }))
  const rounds = pack.rounds
    .map((r) => ({
      ...r,
      themes: r.themes
        .filter((t) => t.questions.length > 0)
        .map((t) => ({
          ...t,
          questions: t.questions.map((q) => ({
            ...q,
            content: mapContent(q.content),
            answerContent: mapContent(q.answerContent),
          })),
        })),
    }))
    .filter((r) => r.themes.length > 0)
  if (!rounds.length) throw new PackError('В пакете нет ни одного вопроса')
  return { ...pack, rounds }
}

// Статистика для списка пакетов.
export function packStats(pack) {
  let questions = 0
  let media = 0
  for (const r of pack.rounds) {
    for (const t of r.themes) {
      questions += t.questions.length
      for (const q of t.questions) media += q.content.filter((c) => c.type !== 'text').length
    }
  }
  return { rounds: pack.rounds.length, questions, media }
}
