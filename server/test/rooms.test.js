// Комнаты: коды, сохранение и восстановление, удаление старых, права ведущего на этом компьютере.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  RoomManager,
  normalizeCode,
  isValidCode,
  libIdForOwner,
  isValidLibId,
  isLocalHostHeader,
  originFromRequest,
} from '../rooms.js'

const builtinDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'demo-packs')

async function makeManager(overrides = {}) {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'quiz-rooms-'))
  const config = {
    rooms: true,
    dataDir,
    port: 3000,
    maxRooms: 500,
    roomTtlHours: 12,
    libraryQuotaMb: 500,
    libraryTtlDays: 90,
    requireKey: false,
    publicUrl: null,
    tls: null,
    ...overrides,
  }
  const manager = new RoomManager({ config, builtinDir })
  return {
    manager,
    dataDir,
    async cleanup() {
      manager.closeAll()
      await fsp.rm(dataDir, { recursive: true, force: true })
    },
  }
}

const fakeReq = (ip, headers = {}) => ({ socket: { remoteAddress: ip }, headers })

test('коды комнат и идентификаторы библиотек', () => {
  assert.equal(normalizeCode(' 482 915 '), '482915')
  assert.equal(normalizeCode('48-29-15-99'), '482915')
  assert.ok(isValidCode('482915'))
  assert.ok(!isValidCode('48291'))
  assert.ok(!isValidCode('abcdef'))
  const lib = libIdForOwner('секретный-токен-браузера')
  assert.match(lib, /^[0-9a-f]{20}$/)
  assert.equal(lib, libIdForOwner('секретный-токен-браузера'))
  assert.notEqual(lib, libIdForOwner('другой-токен-браузера'))
  assert.ok(isValidLibId(lib))
  assert.ok(isValidLibId('local'))
  assert.ok(!isValidLibId('../etc'))
})

test('создание, поиск, сохранение и удаление комнаты', async () => {
  const { manager, dataDir, cleanup } = await makeManager()
  try {
    const room = await manager.create({ libId: libIdForOwner('владелец-1-xxxxxxxx') })
    assert.match(room.code, /^\d{6}$/)
    assert.match(room.hostKey, /^[A-Z2-9]{10}$/)
    assert.equal(manager.get(`${room.code.slice(0, 3)} ${room.code.slice(3)}`), room)
    assert.ok(fs.existsSync(path.join(dataDir, 'rooms', room.code, 'room.json')))
    // Пакеты комнаты лежат в библиотеке её ведущего, а не в общей папке.
    assert.equal(room.store.userDir, path.join(dataDir, 'libraries', room.libId, 'packs'))
    assert.equal(manager.serverInfo(room).joinUrl.endsWith(`/r/${room.code}`), true)

    assert.ok(manager.remove(room.code))
    assert.equal(manager.get(room.code), null)
    assert.ok(!fs.existsSync(path.join(dataDir, 'rooms', room.code)))
    assert.equal(manager.remove(room.code), false)
  } finally {
    await cleanup()
  }
})

test('в режиме одной игры комнаты создавать нельзя, а лимит комнат соблюдается', async () => {
  const local = await makeManager({ rooms: false })
  try {
    await assert.rejects(local.manager.create({ libId: 'local' }), (err) => err.status === 403)
    const def = await local.manager.ensureDefaultRoom()
    assert.ok(def.isDefault)
    assert.equal(local.manager.roomPath(def), '/')
    assert.equal(local.manager.roomPath(def, '/host'), '/host')
  } finally {
    await local.cleanup()
  }
  const limited = await makeManager({ maxRooms: 2 })
  try {
    await limited.manager.create({ libId: 'local' })
    await limited.manager.create({ libId: 'local' })
    await assert.rejects(limited.manager.create({ libId: 'local' }), (err) => err.status === 503)
  } finally {
    await limited.cleanup()
  }
})

test('после перезапуска комнаты и игры восстанавливаются, старые — удаляются', async () => {
  const first = await makeManager()
  const lib = libIdForOwner('владелец-2-xxxxxxxx')
  const room = await first.manager.create({ libId: lib })
  room.game.join({ name: 'Аня' })
  room.game.saveNow()
  const old = await first.manager.create({ libId: lib })
  old.lastActive = Date.now() - 13 * 3600_000
  old.saveMeta()
  // «Перезапуск»: новый менеджер на той же папке.
  first.manager.closeAll()
  const second = new RoomManager({ config: first.manager.config, builtinDir })
  try {
    await second.loadAll()
    const restored = second.get(room.code)
    assert.ok(restored, 'комната восстановлена')
    assert.equal(restored.hostKey, room.hostKey)
    assert.deepEqual(
      restored.game.state.players.map((p) => p.name),
      ['Аня'],
    )
    assert.equal(second.get(old.code), null, 'давно брошенная комната удалена')
    assert.ok(!fs.existsSync(path.join(first.dataDir, 'rooms', old.code)))

    // Та же папка в режиме одной игры не поднимает чужие комнаты.
    const localManager = new RoomManager({ config: { ...first.manager.config, rooms: false }, builtinDir })
    await localManager.loadAll()
    assert.equal(localManager.rooms.size, 0)
    localManager.closeAll()
  } finally {
    second.closeAll()
    await fsp.rm(first.dataDir, { recursive: true, force: true })
  }
})

test('неактивные комнаты без подключений удаляются при уборке', async () => {
  const { manager, cleanup } = await makeManager({ roomTtlHours: 1 })
  try {
    const active = await manager.create({ libId: 'local' })
    const stale = await manager.create({ libId: 'local' })
    stale.lastActive = Date.now() - 2 * 3600_000
    assert.equal(manager.sweep(), 1)
    assert.ok(manager.get(active.code))
    assert.equal(manager.get(stale.code), null)
  } finally {
    await cleanup()
  }
})

test('основная комната: постоянный ключ и перенос сохранения первой версии', async () => {
  const { manager, dataDir, cleanup } = await makeManager({ rooms: false })
  try {
    fs.writeFileSync(path.join(dataDir, 'host-key.txt'), 'ABCD2345\n')
    const legacy = {
      v: 1,
      stage: 'lobby',
      mode: 'jeopardy',
      settings: {},
      players: [{ id: 'p1', token: 't1', name: 'Старый игрок', teamId: null, color: '#fff', joinedAt: 1 }],
      teams: [],
      scores: { p1: 300 },
    }
    fs.writeFileSync(path.join(dataDir, 'game-state.json'), JSON.stringify(legacy))
    const room = await manager.ensureDefaultRoom()
    assert.equal(room.hostKey, 'ABCD2345')
    assert.equal(await manager.ensureDefaultRoom(), room)
    assert.ok(fs.existsSync(path.join(dataDir, 'game-state.json.migrated')))
    assert.equal(room.game.player('p1')?.name, 'Старый игрок')
    assert.equal(room.game.score('p1'), 300)
    assert.equal(room.store.userDir, path.join(dataDir, 'packs'))
  } finally {
    await cleanup()
  }
})

test('без ключа пускается только браузер самого компьютера и только со своей страницы', async () => {
  const { manager, cleanup } = await makeManager({ rooms: false })
  try {
    const room = await manager.ensureDefaultRoom()
    const ok = fakeReq('127.0.0.1', { host: 'localhost:3000' })
    assert.ok(manager.isTrustedLocal(ok, room))
    assert.ok(manager.isTrustedLocal(fakeReq('::ffff:127.0.0.1', { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' }), room))
    // Чужой сайт в браузере ведущего.
    assert.ok(!manager.isTrustedLocal(fakeReq('127.0.0.1', { host: 'localhost:3000', origin: 'https://evil.example' }), room))
    // DNS rebinding: имя сайта злоумышленника указывает на 127.0.0.1.
    assert.ok(!manager.isTrustedLocal(fakeReq('127.0.0.1', { host: 'evil.example:3000', origin: 'http://evil.example:3000' }), room))
    // Запрос через туннель или прокси.
    assert.ok(!manager.isTrustedLocal(fakeReq('127.0.0.1', { host: 'localhost:3000', 'x-forwarded-for': '8.8.8.8' }), room))
    // Другое устройство в сети.
    assert.ok(!manager.isTrustedLocal(fakeReq('203.0.113.7', { host: 'localhost:3000' }), room))
    manager.config.requireKey = true
    assert.ok(!manager.isTrustedLocal(ok, room))
  } finally {
    await cleanup()
  }
  const rooms = await makeManager()
  try {
    const room = await rooms.manager.create({ libId: 'local' })
    assert.ok(!rooms.manager.isTrustedLocal(fakeReq('127.0.0.1', { host: 'localhost:3000' }), room), 'в режиме комнат ключ нужен всегда')
  } finally {
    await rooms.cleanup()
  }
})

test('адрес для игроков: публичный адрес, выбранный ведущим, адрес из браузера ведущего', async () => {
  const { manager, cleanup } = await makeManager()
  try {
    const room = await manager.create({ libId: 'local' })
    room.originHint = 'https://abc.trycloudflare.com'
    assert.equal(manager.serverInfo(room).joinUrl, `https://abc.trycloudflare.com/r/${room.code}`)
    room.game.updateSettings({ joinAddress: 'https://quiz.example.ru/' })
    assert.equal(manager.baseUrl(room), 'https://quiz.example.ru')
    manager.config.publicUrl = 'https://public.example.com'
    const info = manager.serverInfo(room)
    assert.equal(info.joinUrl, `https://public.example.com/r/${room.code}`)
    assert.equal(info.hostUrl, `https://public.example.com/r/${room.code}/host?key=${room.hostKey}`)
    assert.equal(info.dataDir, null, 'папку данных сервера не показываем в режиме комнат')
  } finally {
    await cleanup()
  }
  assert.equal(originFromRequest(fakeReq('1.2.3.4', { host: 'localhost:3000' })), null)
  assert.equal(
    originFromRequest(fakeReq('1.2.3.4', { host: 'x', 'x-forwarded-host': 'quiz.example.ru', 'x-forwarded-proto': 'https' })),
    'https://quiz.example.ru',
  )
  assert.ok(isLocalHostHeader('localhost:3000'))
  assert.ok(isLocalHostHeader('127.0.0.1'))
  assert.ok(isLocalHostHeader('[::1]:3000'))
  assert.ok(!isLocalHostHeader('evil.example'))
})

test('забытые библиотеки пакетов удаляются, используемые — остаются', async () => {
  const { manager, dataDir, cleanup } = await makeManager({ libraryTtlDays: 30 })
  try {
    const active = await manager.create({ libId: libIdForOwner('владелец-5-xxxxxxxx') })
    await active.store.create(null)
    const oldLib = libIdForOwner('владелец-6-xxxxxxxx')
    const old = await manager.create({ libId: oldLib })
    await old.store.create(null)
    manager.remove(old.code)
    const later = Date.now() + 31 * 86400_000
    assert.equal(manager.sweepLibraries(later), 1)
    assert.ok(!fs.existsSync(path.join(dataDir, 'libraries', oldLib)))
    assert.ok(fs.existsSync(path.join(dataDir, 'libraries', active.libId)), 'библиотека открытой комнаты не удаляется')
    assert.equal(manager.sweepLibraries(Date.now()), 0)
  } finally {
    await cleanup()
  }
})

test('квота библиотеки пакетов ведущего', async () => {
  const { manager, cleanup } = await makeManager({ libraryQuotaMb: 1 })
  try {
    const room = await manager.create({ libId: libIdForOwner('владелец-3-xxxxxxxx') })
    const id = await room.store.create(null)
    const big = path.join(os.tmpdir(), `quiz-big-${process.pid}.png`)
    fs.writeFileSync(big, Buffer.alloc(1.5 * 1024 * 1024))
    try {
      await assert.rejects(room.store.addMedia(id, big, 'big.png'), /Не хватает места/)
    } finally {
      fs.rmSync(big, { force: true })
    }
    // В чужой библиотеке пакета нет.
    const other = await manager.create({ libId: libIdForOwner('владелец-4-xxxxxxxx') })
    assert.ok(!(await other.store.list()).some((p) => p.id === id))
    assert.ok((await other.store.list()).some((p) => p.id === 'demo-svoya-igra'), 'встроенные пакеты видны всем')
  } finally {
    await cleanup()
  }
})

test('IP игрока за прокси и туннелем', async () => {
  const { clientIp } = await import('../ratelimit.js')
  const req = (ip, fwd) => ({ socket: { remoteAddress: ip }, headers: fwd ? { 'x-forwarded-for': fwd } : {} })
  assert.equal(clientIp(req('::ffff:203.0.113.5'), false), '203.0.113.5')
  assert.equal(clientIp(req('203.0.113.5', '1.2.3.4'), false), '203.0.113.5', 'чужой заголовок не принимаем')
  assert.equal(clientIp(req('127.0.0.1', '1.2.3.4, 10.0.0.1'), false), '1.2.3.4', 'локальный туннель или прокси')
  assert.equal(clientIp(req('172.18.0.3', '1.2.3.4'), true), '1.2.3.4', 'прокси в соседнем контейнере')
})
