// Хранилище пакетов вопросов.
// Встроенные (демо) пакеты лежат в server/demo-packs и доступны только для чтения,
// пользовательские — в data/packs/<id>/pack.json + data/packs/<id>/media/*.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import yazl from 'yazl'
import { normalizePack, prepareForGame, packStats, isLocalMedia, PackError } from './normalize.js'
import { parseSiqXml, convertSiq } from './siq.js'

export { PackError }

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i
const MAX_ENTRY = 1024 * 1024 * 1024 // 1 ГБ на файл
const MAX_TOTAL = 4 * 1024 * 1024 * 1024 // 4 ГБ на пакет
const MAX_XML = 50 * 1024 * 1024

export const MEDIA_EXT = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'],
  audio: ['mp3', 'ogg', 'oga', 'wav', 'm4a', 'aac', 'opus', 'flac', 'weba'],
  video: ['mp4', 'webm', 'ogv', 'mov', 'm4v'],
}

export function mediaKind(name) {
  const ext = path.extname(String(name)).slice(1).toLowerCase()
  for (const [kind, list] of Object.entries(MEDIA_EXT)) if (list.includes(ext)) return kind
  return null
}

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '',
  ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'e', ґ: 'g',
}

export function slugify(title) {
  const base = String(title ?? '')
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base || 'pack'
}

// Безопасное имя файла для любой ОС.
export function safeFileName(name) {
  let base = String(name ?? '').split(/[\\/]/).pop() ?? ''
  base = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/^[.\s]+/, '').replace(/[.\s]+$/, '')
  if (!base) base = 'file'
  const ext = path.extname(base).slice(0, 12).toLowerCase()
  let stem = base.slice(0, base.length - path.extname(base).length).slice(0, 80) || 'file'
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(stem)) stem = `_${stem}`
  return stem + ext
}

function uniqueName(name, used) {
  let candidate = name
  const ext = path.extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let i = 1
  while (used.has(candidate.toLowerCase())) candidate = `${stem}-${i++}${ext}`
  used.add(candidate.toLowerCase())
  return candidate
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

async function readEntryBuffer(zip, entry, limit) {
  if (entry.uncompressedSize > limit) throw new PackError(`Файл ${entry.fileName} слишком большой`)
  const stream = await zip.openReadStreamPromise(entry)
  const chunks = []
  let size = 0
  for await (const chunk of stream) {
    size += chunk.length
    if (size > limit) {
      stream.destroy()
      throw new PackError(`Файл ${entry.fileName} слишком большой`)
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function bufferToText(buf) {
  let s = buf.toString('utf8')
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  return s
}

async function extractEntry(zip, entry, target) {
  if (entry.uncompressedSize > MAX_ENTRY) throw new PackError(`Файл ${entry.fileName} слишком большой`)
  const stream = await zip.openReadStreamPromise(entry)
  await pipeline(stream, fs.createWriteStream(target))
}

async function writeJsonAtomic(file, data) {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fsp.rename(tmp, file)
}

async function moveFile(from, to) {
  try {
    await fsp.rename(from, to)
  } catch (err) {
    if (err.code !== 'EXDEV') throw err
    await fsp.copyFile(from, to)
    await fsp.unlink(from).catch(() => {})
  }
}

export class PackStore {
  // libId — идентификатор библиотеки (входит в адреса медиафайлов), quotaBytes — лимит места (0 — без лимита).
  constructor({ dataDir, builtinDir, libId = 'local', quotaBytes = 0 }) {
    this.userDir = path.join(dataDir, 'packs')
    this.builtinDir = builtinDir
    this.libId = libId
    this.quotaBytes = quotaBytes
    fs.mkdirSync(this.userDir, { recursive: true })
  }

  // Сколько места занимают пакеты этой библиотеки (байты).
  async usage(dir = this.userDir) {
    let total = 0
    let entries = []
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return 0
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) total += await this.usage(full)
      else total += (await fsp.stat(full).catch(() => ({ size: 0 }))).size
    }
    return total
  }

  async checkQuota(extraBytes = 0) {
    if (!this.quotaBytes) return
    if ((await this.usage()) + extraBytes > this.quotaBytes) {
      throw new PackError(
        `Не хватает места для пакетов (лимит ${Math.round(this.quotaBytes / 1048576)} МБ). Удалите ненужные пакеты или сделайте их экспорт.`,
      )
    }
  }

  // Где лежит пакет: { dir, builtin } или null.
  locate(id) {
    if (typeof id !== 'string' || !ID_RE.test(id)) return null
    const user = path.join(this.userDir, id)
    if (fs.existsSync(path.join(user, 'pack.json'))) return { dir: user, builtin: false }
    if (this.builtinDir) {
      const builtin = path.join(this.builtinDir, id)
      if (fs.existsSync(path.join(builtin, 'pack.json'))) return { dir: builtin, builtin: true }
    }
    return null
  }

  async list() {
    const out = []
    const scan = async (root, builtin) => {
      if (!root || !fs.existsSync(root)) return
      for (const name of await fsp.readdir(root)) {
        if (!ID_RE.test(name)) continue
        if (builtin && out.some((p) => p.id === name)) continue
        const file = path.join(root, name, 'pack.json')
        try {
          const [raw, stat] = await Promise.all([fsp.readFile(file, 'utf8'), fsp.stat(file)])
          const pack = normalizePack(JSON.parse(raw))
          const stats = packStats(pack)
          out.push({
            id: name,
            title: pack.title,
            author: pack.author,
            description: pack.description,
            builtin,
            rounds: pack.rounds.map((r) => ({ name: r.name, type: r.type, themes: r.themes.length })),
            questions: stats.questions,
            media: stats.media,
            updatedAt: stat.mtimeMs,
          })
        } catch {
          // Повреждённый пакет просто не показываем.
        }
      }
    }
    await scan(this.userDir, false)
    await scan(this.builtinDir, true)
    out.sort((a, b) => Number(b.builtin) - Number(a.builtin) || b.updatedAt - a.updatedAt)
    return out
  }

  async read(id) {
    const loc = this.locate(id)
    if (!loc) throw new PackError('Пакет не найден')
    let raw
    try {
      raw = JSON.parse(bufferToText(await fsp.readFile(path.join(loc.dir, 'pack.json'))))
    } catch {
      throw new PackError('Файл пакета повреждён')
    }
    const pack = normalizePack(raw, { id })
    pack.builtin = loc.builtin
    return pack
  }

  // Пакет, готовый к игре: пустые темы убраны, у медиа — URL для браузера.
  async loadForGame(id) {
    const pack = await this.read(id)
    return prepareForGame(
      pack,
      (name) => `/media/${this.libId}/${encodeURIComponent(id)}/${encodeURIComponent(name)}`,
    )
  }

  async allocateId(title) {
    const base = slugify(title)
    for (;;) {
      const id = `${base}-${randomBytes(3).toString('hex')}`
      if (!this.locate(id) && !fs.existsSync(path.join(this.userDir, id))) return id
    }
  }

  async create(raw) {
    const pack = normalizePack(raw ?? { title: 'Новый пакет', rounds: [{ name: 'Раунд 1', themes: [] }] })
    const id = await this.allocateId(pack.title)
    const dir = path.join(this.userDir, id)
    await fsp.mkdir(path.join(dir, 'media'), { recursive: true })
    await writeJsonAtomic(path.join(dir, 'pack.json'), pack)
    return id
  }

  async save(id, raw) {
    const loc = this.locate(id)
    if (!loc) throw new PackError('Пакет не найден')
    if (loc.builtin) throw new PackError('Встроенный пакет нельзя изменить — сделайте копию')
    const pack = normalizePack(raw)
    await writeJsonAtomic(path.join(loc.dir, 'pack.json'), pack)
    return { ...pack, id }
  }

  async duplicate(id) {
    const pack = await this.read(id)
    const loc = this.locate(id)
    const title = loc.builtin ? pack.title : `${pack.title} (копия)`
    await this.checkQuota(await this.usage(path.join(loc.dir, 'media')))
    const newId = await this.allocateId(title)
    const dir = path.join(this.userDir, newId)
    await fsp.mkdir(path.join(dir, 'media'), { recursive: true })
    const media = path.join(loc.dir, 'media')
    if (fs.existsSync(media)) await fsp.cp(media, path.join(dir, 'media'), { recursive: true })
    const { id: _id, builtin: _b, ...rest } = pack
    await writeJsonAtomic(path.join(dir, 'pack.json'), { ...rest, title })
    return newId
  }

  async remove(id) {
    const loc = this.locate(id)
    if (!loc) throw new PackError('Пакет не найден')
    if (loc.builtin) throw new PackError('Встроенный пакет нельзя удалить')
    await fsp.rm(loc.dir, { recursive: true, force: true })
  }

  // Абсолютный путь к медиафайлу пакета или null (с защитой от выхода за пределы папки).
  mediaPath(id, name) {
    const loc = this.locate(id)
    if (!loc || typeof name !== 'string' || !name || /[\\/]/.test(name) || name === '..' || name === '.') return null
    const dir = path.join(loc.dir, 'media')
    const abs = path.join(dir, name)
    if (path.dirname(abs) !== dir) return null
    return fs.existsSync(abs) ? abs : null
  }

  async addMedia(id, tmpPath, originalName) {
    const loc = this.locate(id)
    if (!loc) throw new PackError('Пакет не найден')
    if (loc.builtin) throw new PackError('Встроенный пакет нельзя изменить — сделайте копию')
    const kind = mediaKind(originalName)
    if (!kind) throw new PackError('Неподдерживаемый тип файла. Можно: картинки, аудио (mp3, ogg, wav, m4a) и видео (mp4, webm)')
    const size = (await fsp.stat(tmpPath)).size
    await this.checkQuota(size)
    const dir = path.join(loc.dir, 'media')
    await fsp.mkdir(dir, { recursive: true })
    const used = new Set((await fsp.readdir(dir)).map((n) => n.toLowerCase()))
    const name = uniqueName(safeFileName(originalName), used)
    await moveFile(tmpPath, path.join(dir, name))
    return { name, kind }
  }

  // Импорт файла: .json, .zip (наш формат) или .siq (SIGame). Возвращает id нового пакета.
  async importFile(filePath, originalName = '') {
    const fd = await fsp.open(filePath, 'r')
    const head = Buffer.alloc(4)
    try {
      await fd.read(head, 0, 4, 0)
    } finally {
      await fd.close()
    }
    const isZip = head[0] === 0x50 && head[1] === 0x4b
    if (!isZip) {
      const ext = path.extname(originalName).toLowerCase()
      if (ext && ext !== '.json' && ext !== '.txt') {
        throw new PackError('Поддерживаются файлы .json, .zip (экспорт этой программы) и .siq (SIGame)')
      }
      const stat = await fsp.stat(filePath)
      if (stat.size > MAX_XML) throw new PackError('Слишком большой JSON-файл')
      await this.checkQuota(stat.size)
      let raw
      try {
        raw = JSON.parse(bufferToText(await fsp.readFile(filePath)))
      } catch (err) {
        throw new PackError(`Ошибка в JSON: ${err.message}`)
      }
      return this.create(raw)
    }
    return this.importZip(filePath, originalName)
  }

  async importZip(filePath, originalName) {
    let zip
    try {
      zip = await yauzl.openPromise(filePath, { autoClose: false, decodeStrings: true, strictFileNames: false })
    } catch {
      throw new PackError('Архив повреждён или это не zip')
    }
    try {
      const entries = []
      for await (const entry of zip.eachEntry()) {
        if (!entry.fileName.endsWith('/')) entries.push(entry)
      }
      const byLower = (name) => entries.find((e) => e.fileName.toLowerCase() === name)
      const contentXml = byLower('content.xml')
      if (contentXml) return await this.importSiqEntries(zip, entries, contentXml, originalName)
      const packJson = entries.find((e) => /(^|\/)pack\.json$/i.test(e.fileName) && e.fileName.split('/').length <= 2)
      if (packJson) return await this.importOwnZip(zip, entries, packJson)
      throw new PackError('В архиве нет ни content.xml (SIGame), ни pack.json')
    } finally {
      zip.close()
    }
  }

  async importOwnZip(zip, entries, packJson) {
    const prefix = packJson.fileName.slice(0, packJson.fileName.length - 'pack.json'.length)
    let raw
    try {
      raw = JSON.parse(bufferToText(await readEntryBuffer(zip, packJson, MAX_XML)))
    } catch (err) {
      if (err instanceof PackError) throw err
      throw new PackError(`Ошибка в pack.json: ${err.message}`)
    }
    const pack = normalizePack(raw)
    const mediaEntries = new Map()
    for (const e of entries) {
      const rel = e.fileName.slice(prefix.length)
      if (e.fileName.startsWith(prefix) && /^media\//i.test(rel)) mediaEntries.set(rel.slice(6), e)
    }
    const used = new Set()
    const plan = new Map() // entry -> новое имя
    const fix = (list) =>
      list
        .map((c) => {
          if (c.type === 'text' || !isLocalMedia(c.src)) return c
          const entry = mediaEntries.get(c.src)
          if (!entry) return null
          if (!plan.has(entry)) {
            plan.set(entry, uniqueName(safeFileName(c.src), used))
          }
          return { ...c, src: plan.get(entry) }
        })
        .filter(Boolean)
    for (const r of pack.rounds) {
      for (const t of r.themes) {
        for (const q of t.questions) {
          q.content = fix(q.content)
          q.answerContent = fix(q.answerContent)
        }
      }
    }
    return this.writeImported(zip, pack, plan)
  }

  async importSiqEntries(zip, entries, contentXml, originalName) {
    const xml = bufferToText(await readEntryBuffer(zip, contentXml, MAX_XML))
    const pkg = parseSiqXml(xml)
    // Индекс медиафайлов: «папка/имя» (раскодированное) и просто «имя» — без учёта регистра.
    const FOLDER = { image: 'images', audio: 'audio', video: 'video' }
    const index = new Map()
    const loose = new Map()
    for (const e of entries) {
      const parts = e.fileName.split('/')
      if (parts.length < 2) continue
      const folder = parts[0].toLowerCase()
      const name = safeDecode(parts.slice(1).join('/')).toLowerCase()
      index.set(`${folder}/${name}`, e)
      if (!loose.has(name)) loose.set(name, e)
    }
    const used = new Set()
    const plan = new Map()
    const resolveMedia = (kind, ref, isRef) => {
      if (!isRef && /^https?:\/\//i.test(ref)) return ref
      const name = safeDecode(ref).toLowerCase()
      const entry = index.get(`${FOLDER[kind]}/${name}`) ?? loose.get(name)
      if (!entry) return null
      if (!plan.has(entry)) plan.set(entry, uniqueName(safeFileName(safeDecode(ref)), used))
      return plan.get(entry)
    }
    const raw = convertSiq(pkg, resolveMedia)
    if (!raw.title || raw.title === 'Пакет SIGame') raw.title = path.basename(originalName, path.extname(originalName)) || raw.title
    const pack = normalizePack(raw)
    if (!pack.rounds.some((r) => r.themes.some((t) => t.questions.length))) {
      throw new PackError('В пакете SIGame не найдено ни одного вопроса')
    }
    return this.writeImported(zip, pack, plan)
  }

  async writeImported(zip, pack, plan) {
    const total = [...plan.keys()].reduce((sum, e) => sum + e.uncompressedSize, 0)
    if (total > MAX_TOTAL) throw new PackError('Медиафайлы пакета слишком большие')
    await this.checkQuota(total)
    const id = await this.allocateId(pack.title)
    const dir = path.join(this.userDir, id)
    const media = path.join(dir, 'media')
    await fsp.mkdir(media, { recursive: true })
    try {
      for (const [entry, name] of plan) await extractEntry(zip, entry, path.join(media, name))
      await writeJsonAtomic(path.join(dir, 'pack.json'), pack)
    } catch (err) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
      throw err
    }
    return id
  }

  // Экспорт в zip: pack.json + media/*. Пишет в поток (например, HTTP-ответ).
  async exportZip(id, output) {
    const pack = await this.read(id)
    const loc = this.locate(id)
    const { id: _id, builtin: _b, ...data } = pack
    const zip = new yazl.ZipFile()
    zip.addBuffer(Buffer.from(JSON.stringify(data, null, 2), 'utf8'), 'pack.json')
    const added = new Set()
    for (const r of pack.rounds) {
      for (const t of r.themes) {
        for (const q of t.questions) {
          for (const c of [...q.content, ...q.answerContent]) {
            if (c.type === 'text' || !isLocalMedia(c.src) || added.has(c.src)) continue
            const abs = path.join(loc.dir, 'media', c.src)
            if (path.dirname(abs) === path.join(loc.dir, 'media') && fs.existsSync(abs)) {
              zip.addFile(abs, `media/${c.src}`)
              added.add(c.src)
            }
          }
        }
      }
    }
    zip.end()
    await pipeline(zip.outputStream, output)
  }
}
