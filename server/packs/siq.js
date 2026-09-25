// Импорт пакетов SIGame (.siq) — zip-архив с content.xml и папками Images/, Audio/, Video/.
// Поддерживаются оба формата: старый (version 4, <scenario><atom>) и новый (version 5, <params><param><item>).

import { XMLParser } from 'fast-xml-parser'
import { PackError } from './normalize.js'

const ARRAY_TAGS = new Set(['round', 'theme', 'question', 'atom', 'answer', 'param', 'item', 'author', 'source', 'comments'])

export function parseSiqXml(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    processEntities: true,
    htmlEntities: true,
    isArray: (name) => ARRAY_TAGS.has(name),
  })
  let doc
  try {
    doc = parser.parse(xml)
  } catch (err) {
    throw new PackError(`Не удалось прочитать content.xml: ${err.message}`)
  }
  if (!doc || typeof doc !== 'object' || !doc.package) throw new PackError('Файл content.xml не похож на пакет SIGame')
  return doc.package
}

const arr = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v])
const attr = (node, name) => (node && typeof node === 'object' ? String(node[`@_${name}`] ?? '') : '')
const text = (node) => {
  if (node === undefined || node === null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node).trim()
  if (Array.isArray(node)) return node.map(text).filter(Boolean).join('\n')
  if (typeof node === 'object') return String(node['#text'] ?? '').trim()
  return ''
}

const MEDIA_KIND = { image: 'image', voice: 'audio', audio: 'audio', video: 'video' }

// resolveMedia(kind, ref, isRef) → строка src для нашего пакета или null.
function convertAtoms(atoms, resolveMedia) {
  const content = []
  const answerContent = []
  let target = content
  for (const atom of atoms) {
    const type = (typeof atom === 'object' && atom !== null ? attr(atom, 'type') : '') || 'text'
    const value = text(atom)
    if (type === 'marker') {
      target = answerContent
      continue
    }
    if (type === 'text' || type === 'say' || type === 'oral') {
      if (value) target.push({ type: 'text', text: value })
      continue
    }
    const kind = MEDIA_KIND[type]
    if (!kind || !value) continue
    const isRef = value.startsWith('@')
    const src = resolveMedia(kind, isRef ? value.slice(1) : value, isRef)
    if (src) target.push({ type: kind, src })
  }
  return { content, answerContent }
}

function convertItems(param, resolveMedia) {
  const out = []
  if (!param) return out
  const items = arr(param.item)
  if (!items.length) {
    const value = text(param)
    if (value) out.push({ type: 'text', text: value })
    return out
  }
  for (const item of items) {
    const type = (typeof item === 'object' && item !== null ? attr(item, 'type') : '') || 'text'
    const value = text(item)
    if (!value) continue
    if (type === 'text') {
      out.push({ type: 'text', text: value })
      continue
    }
    const kind = MEDIA_KIND[type]
    if (!kind) continue
    const isRef = attr(item, 'isRef').toLowerCase() === 'true' || !/^(https?:)/i.test(value)
    const src = resolveMedia(kind, value.replace(/^@/, ''), isRef)
    if (src) out.push({ type: kind, src })
  }
  return out
}

function questionComment(q) {
  const parts = []
  const comments = text(q.info?.comments)
  if (comments) parts.push(comments)
  const sources = arr(q.info?.sources?.source).map(text).filter(Boolean)
  if (sources.length) parts.push(`Источник: ${sources.join('; ')}`)
  return parts
}

function convertQuestion(q, resolveMedia) {
  const price = Number(attr(q, 'price'))
  const out = { price: Number.isFinite(price) && price >= 0 ? price : 0, type: 'normal', content: [], answerContent: [] }
  const answers = arr(q.right?.answer).map(text).filter(Boolean)
  const wrong = arr(q.wrong?.answer).map(text).filter(Boolean)
  out.answer = answers[0] ?? ''
  const comment = questionComment(q)
  if (answers.length > 1) comment.push(`Также засчитывается: ${answers.slice(1).join('; ')}`)
  if (wrong.length) comment.push(`Не засчитывается: ${wrong.join('; ')}`)

  if (q.scenario) {
    // Формат версии 4
    const { content, answerContent } = convertAtoms(arr(q.scenario.atom), resolveMedia)
    out.content = content
    out.answerContent = answerContent
    const typeNode = q.type && typeof q.type === 'object' ? q.type : null
    const typeName = attr(typeNode, 'name').toLowerCase()
    const params = arr(typeNode?.param)
    const param = (name) => text(params.find((p) => attr(p, 'name') === name))
    if (typeName === 'cat' || typeName === 'bagcat') {
      out.type = 'cat'
      out.catTheme = param('theme')
      const cost = Number(param('cost'))
      if (typeName === 'bagcat' && cost === 0) out.catPriceOptions = 'roundMinMax'
      else out.catPrice = Number.isFinite(cost) && cost > 0 ? cost : out.price
      out.catSelf = param('self').toLowerCase() === 'true'
    } else if (typeName === 'auction') {
      out.type = 'auction'
    } else if (typeName === 'sponsored') {
      out.type = 'norisk'
    }
  } else {
    // Формат версии 5
    const params = arr(q.params?.param)
    const param = (name) => params.find((p) => attr(p, 'name') === name)
    out.content = convertItems(param('question'), resolveMedia)
    out.answerContent = convertItems(param('answer'), resolveMedia)
    const type = attr(q, 'type').toLowerCase()
    if (type.startsWith('secret')) {
      out.type = 'cat'
      out.catTheme = text(param('theme'))
      const set = param('price')?.numberSet
      const min = Number(attr(set, 'minimum'))
      const max = Number(attr(set, 'maximum'))
      const step = Number(attr(set, 'step'))
      if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
        const options = []
        const st = Number.isFinite(step) && step > 0 ? step : max - min
        for (let v = min; v <= max && options.length < 20; v += st) options.push(v)
        if (options[options.length - 1] !== max) options.push(max)
        out.catPriceOptions = options
        out.catPrice = min
      } else if (Number.isFinite(min) && min > 0) {
        out.catPrice = min
      } else {
        out.catPrice = out.price
      }
      out.catSelf = text(param('selectionMode')).toLowerCase() === 'any'
    } else if (type === 'stake' || type === 'auction') {
      out.type = 'auction'
    } else if (type === 'norisk' || type === 'sponsored') {
      out.type = 'norisk'
    }
  }
  if (!out.content.length && !out.answerContent.length && !out.answer) return null
  out.comment = comment.join('\n')
  return out
}

// Преобразует разобранный content.xml в «сырой» пакет нашего формата (потом его проверит normalizePack).
export function convertSiq(pkg, resolveMedia) {
  const authors = arr(pkg.info?.authors?.author).map(text).filter(Boolean)
  const rounds = arr(pkg.rounds?.round).map((r, ri) => {
    const themes = arr(r.themes?.theme).map((t, ti) => ({
      name: attr(t, 'name') || `Тема ${ti + 1}`,
      questions: arr(t.questions?.question)
        .map((q) => convertQuestion(q, resolveMedia))
        .filter(Boolean),
    }))
    // «Кот в мешке» со стоимостью 0 в старом формате: выбирается минимальная или максимальная цена раунда.
    const prices = themes.flatMap((t) => t.questions.map((q) => q.price)).filter((p) => p > 0)
    for (const t of themes) {
      for (const q of t.questions) {
        if (q.catPriceOptions === 'roundMinMax') {
          const min = prices.length ? Math.min(...prices) : q.price
          const max = prices.length ? Math.max(...prices) : q.price
          q.catPriceOptions = min === max ? undefined : [min, max]
          q.catPrice = min
        }
      }
    }
    return {
      name: attr(r, 'name') || `Раунд ${ri + 1}`,
      type: attr(r, 'type').toLowerCase() === 'final' ? 'final' : 'normal',
      themes,
    }
  })
  return {
    title: attr(pkg, 'name') || 'Пакет SIGame',
    author: authors.join(', '),
    description: text(pkg.info?.comments),
    rounds,
  }
}
