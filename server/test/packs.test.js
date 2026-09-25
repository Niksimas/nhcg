import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'
import yazl from 'yazl'
import { normalizePack, prepareForGame, cleanMediaSrc } from '../packs/normalize.js'
import { PackStore, safeFileName, slugify } from '../packs/store.js'

let tmp
let store

before(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'quiz-packs-'))
  store = new PackStore({ dataDir: tmp, builtinDir: path.join(process.cwd(), 'server', 'demo-packs') })
})

after(async () => {
  await fsp.rm(tmp, { recursive: true, force: true })
})

async function makeZip(files) {
  const zip = new yazl.ZipFile()
  for (const [name, content] of Object.entries(files)) zip.addBuffer(Buffer.from(content), name)
  zip.end()
  const chunks = []
  for await (const c of zip.outputStream) chunks.push(c)
  const file = path.join(tmp, `upload-${Math.random().toString(16).slice(2)}.bin`)
  await fsp.writeFile(file, Buffer.concat(chunks))
  return file
}

test('сокращённый формат JSON превращается в полный', () => {
  const pack = normalizePack({
    name: 'Мини',
    questions: [{ question: 'Q1', answer: 'A1', image: 'pic.png' }, 'Q2'],
  })
  assert.equal(pack.title, 'Мини')
  assert.equal(pack.rounds.length, 1)
  const [q1, q2] = pack.rounds[0].themes[0].questions
  assert.deepEqual(q1.content, [
    { type: 'text', text: 'Q1' },
    { type: 'image', src: 'pic.png' },
  ])
  assert.equal(q1.price, 100)
  assert.equal(q2.price, 200)
  assert.equal(q2.content[0].text, 'Q2')
})

test('типы вопросов и защита путей к медиа', () => {
  const pack = normalizePack({
    rounds: [
      {
        name: 'Р',
        themes: [
          {
            name: 'Т',
            questions: [
              { price: '300', type: 'Кот в мешке', question: 'x', catPrice: 700 },
              { price: 100, type: 'stake', question: 'y' },
              { price: 100, type: 'sponsored', question: 'z', video: '../../etc/passwd' },
            ],
          },
        ],
      },
    ],
  })
  const [cat, auction, norisk] = pack.rounds[0].themes[0].questions
  assert.equal(cat.type, 'cat')
  assert.equal(cat.price, 300)
  assert.equal(cat.catPrice, 700)
  assert.equal(auction.type, 'auction')
  assert.equal(norisk.type, 'norisk')
  assert.equal(norisk.content.length, 1, 'опасный путь отброшен')
  assert.equal(cleanMediaSrc('media/a.png'), 'a.png')
  assert.equal(cleanMediaSrc('a/b.png'), null)
  assert.equal(cleanMediaSrc('https://example.com/x.png'), 'https://example.com/x.png')
})

test('prepareForGame убирает пустые темы и строит URL медиа', () => {
  const pack = normalizePack({
    rounds: [
      { name: 'Пустой', themes: [{ name: 'Т', questions: [] }] },
      { name: 'Р', themes: [{ name: 'Т', questions: [{ question: 'q', image: 'кот 1.png' }] }] },
    ],
  })
  const game = prepareForGame(pack, (n) => `/media/x/${encodeURIComponent(n)}`)
  assert.equal(game.rounds.length, 1)
  assert.equal(game.rounds[0].themes[0].questions[0].content[1].src, '/media/x/%D0%BA%D0%BE%D1%82%201.png')
  assert.throws(() => prepareForGame(normalizePack({ rounds: [] }), (n) => n), /ни одного вопроса/)
})

test('имена файлов и идентификаторы', () => {
  assert.equal(safeFileName('../../evil.JPG'), 'evil.jpg')
  assert.equal(safeFileName('con.mp3'), '_con.mp3')
  assert.equal(safeFileName('a:b*c?.png'), 'a_b_c_.png')
  assert.equal(slugify('Моя Своя игра!'), 'moya-svoya-igra')
})

test('встроенные демо-пакеты видны и загружаются', async () => {
  const list = await store.list()
  const ids = list.map((p) => p.id)
  assert.ok(ids.includes('demo-svoya-igra'))
  assert.ok(ids.includes('demo-brain-ring'))
  const demo = await store.loadForGame('demo-svoya-igra')
  assert.ok(demo.rounds.length >= 2)
  assert.equal(demo.rounds.at(-1).type, 'final')
  await assert.rejects(store.save('demo-svoya-igra', demo), /Встроенный/)
  await assert.rejects(store.remove('demo-svoya-igra'), /Встроенный/)
})

test('создание, сохранение, копия и удаление пакета', async () => {
  const id = await store.create({ title: 'Мой пакет', rounds: [{ name: 'Р1', themes: [] }] })
  assert.match(id, /^moy-paket-[0-9a-f]{6}$/)
  await store.save(id, {
    title: 'Мой пакет 2',
    rounds: [{ name: 'Р1', themes: [{ name: 'Т', questions: [{ price: 100, question: 'Q', answer: 'A' }] }] }],
  })
  const read = await store.read(id)
  assert.equal(read.title, 'Мой пакет 2')
  const copy = await store.duplicate(id)
  assert.notEqual(copy, id)
  assert.equal((await store.read(copy)).title, 'Мой пакет 2 (копия)')
  await store.remove(copy)
  await assert.rejects(store.read(copy), /не найден/)
})

test('загрузка медиа и защита от выхода из папки', async () => {
  const id = await store.create({ title: 'Медиа', rounds: [] })
  const src = path.join(tmp, 'upload.png')
  await fsp.writeFile(src, 'PNGDATA')
  const { name, kind } = await store.addMedia(id, src, 'Картинка.PNG')
  assert.equal(kind, 'image')
  assert.equal(name, 'Картинка.png')
  assert.ok(store.mediaPath(id, name))
  assert.equal(store.mediaPath(id, '../pack.json'), null)
  assert.equal(store.mediaPath(id, 'pack.json'), null)
  const bad = path.join(tmp, 'upload.exe')
  await fsp.writeFile(bad, 'x')
  await assert.rejects(store.addMedia(id, bad, 'virus.exe'), /Неподдерживаемый/)
})

test('импорт JSON-файла', async () => {
  const file = path.join(tmp, 'pack.json')
  await fsp.writeFile(file, '﻿' + JSON.stringify({ title: 'Из JSON', questions: [{ question: 'Q', answer: 'A' }] }))
  const id = await store.importFile(file, 'pack.json')
  assert.equal((await store.read(id)).title, 'Из JSON')
  await fsp.writeFile(file, '{ сломано')
  await assert.rejects(store.importFile(file, 'pack.json'), /Ошибка в JSON/)
})

test('импорт SIGame 4 (.siq)', async () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<package name="Тест SIGame" version="4" xmlns="http://vladimirkhil.com/ygpackage3.0.xsd">
  <info><authors><author>Автор 1</author><author>Автор 2</author></authors></info>
  <rounds>
    <round name="1-й раунд">
      <themes>
        <theme name="Картинки &amp; звуки">
          <questions>
            <question price="100">
              <scenario>
                <atom>Кто на картинке?</atom>
                <atom type="image">@кот 1.jpg</atom>
                <atom type="marker" />
                <atom type="image">@answer.png</atom>
              </scenario>
              <right><answer>Кот</answer><answer>Котик</answer></right>
              <wrong><answer>Собака</answer></wrong>
              <info><comments>Просто кот</comments></info>
            </question>
            <question price="200">
              <type name="cat"><param name="theme">Кошки</param><param name="cost">500</param></type>
              <scenario><atom type="voice">@мяу.mp3</atom><atom>Кто это?</atom></scenario>
              <right><answer>Кошка</answer></right>
            </question>
            <question price="300">
              <type name="bagcat"><param name="theme">Мешок</param><param name="cost">0</param><param name="self">true</param></type>
              <scenario><atom>Q300</atom></scenario>
              <right><answer>A300</answer></right>
            </question>
            <question price="400">
              <type name="auction" />
              <scenario><atom>Q400</atom></scenario>
              <right><answer>A400</answer></right>
            </question>
            <question price="500">
              <type name="sponsored" />
              <scenario><atom type="video">@clip.mp4</atom></scenario>
              <right><answer>A500</answer></right>
            </question>
          </questions>
        </theme>
      </themes>
    </round>
    <round name="ФИНАЛ" type="final">
      <themes>
        <theme name="Финальная тема">
          <questions>
            <question price="0"><scenario><atom>Финальный вопрос</atom></scenario><right><answer>Финал</answer></right></question>
          </questions>
        </theme>
      </themes>
    </round>
  </rounds>
</package>`
  const file = await makeZip({
    'content.xml': xml,
    [`Images/${encodeURIComponent('кот 1.jpg')}`]: 'JPG',
    'Images/answer.png': 'PNG',
    [`Audio/${encodeURIComponent('мяу.mp3')}`]: 'MP3',
    'Video/clip.mp4': 'MP4',
    'Texts/authors.xml': '<authors/>',
  })
  const id = await store.importFile(file, 'test.siq')
  const pack = await store.read(id)
  assert.equal(pack.title, 'Тест SIGame')
  assert.equal(pack.author, 'Автор 1, Автор 2')
  const [r1, fin] = pack.rounds
  assert.equal(fin.type, 'final')
  assert.equal(r1.themes[0].name, 'Картинки & звуки')
  const [q1, q2, q3, q4, q5] = r1.themes[0].questions
  assert.deepEqual(q1.content, [
    { type: 'text', text: 'Кто на картинке?' },
    { type: 'image', src: 'кот 1.jpg' },
  ])
  assert.deepEqual(q1.answerContent, [{ type: 'image', src: 'answer.png' }])
  assert.equal(q1.answer, 'Кот')
  assert.match(q1.comment, /Просто кот/)
  assert.match(q1.comment, /Также засчитывается: Котик/)
  assert.match(q1.comment, /Не засчитывается: Собака/)
  assert.equal(q2.type, 'cat')
  assert.equal(q2.catTheme, 'Кошки')
  assert.equal(q2.catPrice, 500)
  assert.deepEqual(q2.content[0], { type: 'audio', src: 'мяу.mp3' })
  assert.equal(q3.type, 'cat')
  assert.deepEqual(q3.catPriceOptions, [100, 500])
  assert.equal(q3.catSelf, true)
  assert.equal(q4.type, 'auction')
  assert.equal(q5.type, 'norisk')
  assert.equal(q5.content[0].type, 'video')
  assert.equal(fs.readFileSync(store.mediaPath(id, 'кот 1.jpg'), 'utf8'), 'JPG')
  assert.equal(fs.readFileSync(store.mediaPath(id, 'мяу.mp3'), 'utf8'), 'MP3')
  assert.equal(store.mediaPath(id, 'authors.xml'), null, 'лишние файлы не распаковываются')
})

test('импорт SIGame 5 (.siq)', async () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<package name="Пакет 5" version="5" xmlns="https://github.com/VladimirKhil/SI/blob/master/assets/siq_5.xsd">
  <rounds>
    <round name="Раунд 1">
      <themes>
        <theme name="Тема">
          <questions>
            <question price="100">
              <params>
                <param name="question" type="content">
                  <item>Текст вопроса</item>
                  <item type="image" isRef="True">pic.png</item>
                </param>
                <param name="answer" type="content"><item type="image" isRef="True">ans.png</item></param>
              </params>
              <right><answer>Ответ</answer></right>
            </question>
            <question price="200" type="secret">
              <params>
                <param name="selectionMode">any</param>
                <param name="price" type="numberSet"><numberSet minimum="100" maximum="300" step="100" /></param>
                <param name="theme">Секрет</param>
                <param name="question" type="content"><item>Секретный вопрос</item></param>
              </params>
              <right><answer>Секрет</answer></right>
            </question>
            <question price="300" type="stake">
              <params><param name="question" type="content"><item type="audio" isRef="True">song.mp3</item></param></params>
              <right><answer>Песня</answer></right>
            </question>
            <question price="400" type="noRisk">
              <params><param name="question" type="content"><item>Без риска</item></param></params>
              <right><answer>Да</answer></right>
            </question>
          </questions>
        </theme>
      </themes>
    </round>
  </rounds>
</package>`
  const file = await makeZip({
    'content.xml': xml,
    'Images/pic.png': 'P',
    'Images/ans.png': 'A',
    'Audio/song.mp3': 'S',
  })
  const id = await store.importFile(file, 'pack5.siq')
  const [q1, q2, q3, q4] = (await store.read(id)).rounds[0].themes[0].questions
  assert.deepEqual(q1.content, [
    { type: 'text', text: 'Текст вопроса' },
    { type: 'image', src: 'pic.png' },
  ])
  assert.deepEqual(q1.answerContent, [{ type: 'image', src: 'ans.png' }])
  assert.equal(q2.type, 'cat')
  assert.equal(q2.catTheme, 'Секрет')
  assert.deepEqual(q2.catPriceOptions, [100, 200, 300])
  assert.equal(q2.catSelf, true)
  assert.equal(q3.type, 'auction')
  assert.equal(q3.content[0].type, 'audio')
  assert.equal(q4.type, 'norisk')
})

test('экспорт в zip и обратный импорт сохраняют медиа', async () => {
  const id = await store.create({ title: 'Экспорт', rounds: [] })
  const img = path.join(tmp, 'e.png')
  await fsp.writeFile(img, 'IMAGE')
  const { name } = await store.addMedia(id, img, 'e.png')
  await store.save(id, {
    title: 'Экспорт',
    rounds: [{ name: 'Р', themes: [{ name: 'Т', questions: [{ price: 100, question: 'Q', image: name, answer: 'A' }] }] }],
  })
  const chunks = []
  await store.exportZip(
    id,
    new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk)
        cb()
      },
    }),
  )
  const zipFile = path.join(tmp, 'export.zip')
  await fsp.writeFile(zipFile, Buffer.concat(chunks))
  const back = await store.importFile(zipFile, 'export.zip')
  const pack = await store.read(back)
  assert.equal(pack.title, 'Экспорт')
  const src = pack.rounds[0].themes[0].questions[0].content[1].src
  assert.equal(fs.readFileSync(store.mediaPath(back, src), 'utf8'), 'IMAGE')
})

test('мусор вместо архива даёт понятную ошибку', async () => {
  const file = path.join(tmp, 'broken.siq')
  await fsp.writeFile(file, Buffer.from('PK\u0003\u0004мусор'))
  await assert.rejects(store.importFile(file, 'broken.siq'), /повреждён/)
  const empty = await makeZip({ 'readme.txt': 'hi' })
  await assert.rejects(store.importFile(empty, 'x.zip'), /нет ни content.xml/)
})

test('список пакетов содержит раунды массивом и статистику', async () => {
  const list = await store.list()
  const demo = list.find((p) => p.id === 'demo-svoya-igra')
  assert.ok(Array.isArray(demo.rounds))
  assert.equal(demo.rounds.at(-1).type, 'final')
  assert.equal(typeof demo.questions, 'number')
  assert.ok(demo.questions >= 50)
  assert.ok(demo.media >= 7)
})
