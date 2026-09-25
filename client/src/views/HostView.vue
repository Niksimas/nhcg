<script setup lang="ts">
// Панель ведущего.
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { GameConnection } from '../lib/connection'
import { getHostKey, setHostKey } from '../lib/api'
import { formatCode, room, roomKey, roomPath, serverMeta } from '../lib/room'
import { SoundEngine, soundForEvent } from '../lib/sound'
import type { Mode } from '../lib/types'
import { storage, timerLeft, useConnMessage, useServerNow } from '../lib/util'
import Icon from '../components/Icon.vue'
import Modal from '../components/Modal.vue'
import QrCode from '../components/QrCode.vue'
import HostRoster from './host/HostRoster.vue'
import HostLobby from './host/HostLobby.vue'
import HostJeopardy from './host/HostJeopardy.vue'
import HostBrainRing from './host/HostBrainRing.vue'
import HostBuzzPanel from './host/HostBuzzPanel.vue'
import HostSettings from './host/HostSettings.vue'
import HostPacks from './host/HostPacks.vue'
import HostJoin from './host/HostJoin.vue'
import { provideHost } from './host/ctx'

const initialKey = getHostKey()
const conn = new GameConnection('host', () => ({ key: storage.get(roomKey('quiz.hostKey')) ?? initialKey }))
const sound = new SoundEngine('quiz.sound.host')
const now = useServerNow(conn, 100)
const state = conn.state
const status = conn.status

type SoundMode = 'auto' | 'on' | 'off'
const soundMode = ref<SoundMode>((storage.get('quiz.hostSoundMode') as SoundMode) || 'auto')
const modal = ref<'settings' | 'packs' | 'join' | null>(null)
const keyInput = ref('')
const toasts = ref<{ id: number; text: string; kind: 'ok' | 'err' }[]>([])
const flash = reactive<Record<string, number>>({})
let toastSeq = 0

function toast(text: string, kind: 'ok' | 'err' = 'ok') {
  const id = ++toastSeq
  toasts.value = [...toasts.value.slice(-3), { id, text, kind }]
  window.setTimeout(() => (toasts.value = toasts.value.filter((t) => t.id !== id)), kind === 'err' ? 5000 : 2500)
}

async function run(name: string, args?: Record<string, unknown>): Promise<boolean> {
  sound.unlock()
  try {
    await conn.cmd(name, args)
    return true
  } catch (e) {
    toast((e as Error).message, 'err')
    return false
  }
}

provideHost({
  conn,
  state,
  now,
  run,
  toast,
  flash,
  openPacks: () => (modal.value = 'packs'),
  openJoin: () => (modal.value = 'join'),
})

// Звук играет на панели ведущего, если выбран режим «вкл» или если не подключён ни один экран.
const hostPlays = computed(() => soundMode.value === 'on' || (soundMode.value === 'auto' && (state.value?.screens ?? 0) === 0))

function cycleSound() {
  const order: SoundMode[] = ['auto', 'on', 'off']
  soundMode.value = order[(order.indexOf(soundMode.value) + 1) % order.length]
  storage.set('quiz.hostSoundMode', soundMode.value)
  sound.unlock()
}
const soundTitle = computed(
  () =>
    ({
      auto: 'Звук: авто (играет здесь, только если не открыт экран для зрителей)',
      on: 'Звук: всегда на этом компьютере',
      off: 'Звук выключен',
    })[soundMode.value],
)

useConnMessage(conn, 'event', (msg) => {
  const data = msg.data ?? {}
  if (msg.name === 'test' || msg.name === 'join') {
    for (const id of [data.playerId, data.competitorId].filter(Boolean) as string[]) flash[id] = (flash[id] ?? 0) + 1
  }
  if (!hostPlays.value) return
  const snd = soundForEvent(msg.name, data)
  if (snd) sound.play(snd, typeof data.at === 'number' ? data.at - conn.serverNow() : 0)
})

// Предупреждения таймера «Брейн-ринга», если звук играет здесь.
let lastSec: number | null = null
const secTimer = window.setInterval(() => {
  const t = state.value?.timers.main
  const sec = t?.running ? Math.ceil(timerLeft(t, conn.serverNow()) / 1000) : null
  if (hostPlays.value && sec != null && lastSec != null && sec < lastSec) {
    if (sec === 10) sound.play('warn')
    else if (sec <= 5 && sec > 0) sound.play('tick')
  }
  lastSec = sec
}, 100)

function submitKey() {
  const key = keyInput.value.trim().toUpperCase()
  if (!key) return
  setHostKey(key)
  conn.reconnectNow()
}

// ── Горячие клавиши ──
function onKey(e: KeyboardEvent) {
  const s = state.value
  if (!s || modal.value) return
  const target = e.target as HTMLElement | null
  const tag = target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return
  if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyZ' || e.key === 'z' || e.key === 'я')) {
    e.preventDefault()
    if (s.undo) void run('undo')
    return
  }
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
  if (e.code === 'KeyP') {
    const entry = Object.entries(s.timers).find(([, t]) => timerLeft(t, conn.serverNow()) > 0)
    if (entry) {
      e.preventDefault()
      void run(entry[1].running ? 'timer.pause' : 'timer.resume', { name: entry[0] })
    }
    return
  }
  if (s.stage !== 'game') return
  const action = hotkeyAction(e)
  if (action) {
    e.preventDefault()
    // Снимаем фокус с кнопки, чтобы Пробел/Enter не «нажали» её повторно.
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    void run(action.name, action.args)
  }
}

function hotkeyAction(e: KeyboardEvent): { name: string; args?: Record<string, unknown> } | null {
  const s = state.value!
  const key = e.code === 'Space' ? 'space' : e.key === 'Enter' ? 'enter' : e.key === 'Backspace' || e.key === 'Delete' ? 'wrong' : e.key === 'Escape' ? 'esc' : e.key === 'ArrowRight' ? 'right' : null
  if (!key) return null
  if (s.mode === 'jeopardy' && s.jeopardy) {
    const j = s.jeopardy
    const q = j.question
    if (j.stage === 'question' && q) {
      if (key === 'space' && q.step === 'reading') return { name: 'j.arm' }
      if (key === 'enter' && q.step === 'answering') return { name: 'j.judge', args: { correct: true } }
      if (key === 'wrong' && q.step === 'answering') return { name: 'j.judge', args: { correct: false } }
      if (key === 'esc' && (q.step === 'reading' || q.step === 'buzzing')) return { name: 'j.reveal' }
      if (key === 'enter' && q.step === 'reveal') return { name: 'j.close' }
    }
    if (j.stage === 'roundEnd' && key === 'enter') return { name: 'j.nextRound' }
    return null
  }
  if (s.mode === 'brainring' && s.brainring) {
    const br = s.brainring
    if (key === 'space' && br.stage === 'reading') return { name: 'br.start' }
    if (key === 'enter' && br.stage === 'answering') return { name: 'br.judge', args: { correct: true } }
    if (key === 'wrong' && br.stage === 'answering') return { name: 'br.judge', args: { correct: false } }
    const atEnd = br.total != null && br.qIndex >= br.total - 1
    if ((key === 'enter' || key === 'right') && (br.stage === 'reveal' || br.stage === 'idle') && !atEnd) return { name: 'br.next' }
  }
  return null
}

onMounted(() => {
  conn.start()
  window.addEventListener('keydown', onKey)
  window.addEventListener('pointerdown', unlockSound, { once: true })
})
onUnmounted(() => {
  conn.stop()
  window.removeEventListener('keydown', onKey)
  clearInterval(secTimer)
})
function unlockSound() {
  sound.unlock()
}

const mode = computed<Mode>(() => state.value?.mode ?? 'jeopardy')
const joinShort = computed(() => (state.value?.joinUrl ?? '').replace(/^https?:\/\//, '').replace(/\/$/, ''))
const roomCode = computed(() => (state.value?.room?.mode === 'rooms' ? state.value.room.code : null))

async function switchMode(m: Mode) {
  if (m === mode.value) return
  if (state.value?.stage === 'game' && !confirm('Идёт игра. Переключить режим?')) return
  await run('mode.set', { mode: m })
}

function openScreen() {
  window.open(roomPath('/screen'), 'quiz-screen', 'width=1280,height=720')
}

const lastLog = computed(() => [...(state.value?.log ?? [])].reverse().slice(0, 30))
function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
</script>

<template>
  <div class="host">
    <!-- Вход по ключу (если панель открыта не на компьютере-сервере) -->
    <div v-if="status === 'noroom'" class="auth center">
      <div class="card auth-card">
        <h2>{{ conn.errorCode.value === 'room_closed' ? 'Комната закрыта' : 'Комната не найдена' }}</h2>
        <p class="muted">{{ conn.errorMessage.value || 'Комнаты с таким кодом нет или её уже закрыли.' }}</p>
        <a class="btn primary big" href="/">На главную</a>
      </div>
    </div>

    <div v-else-if="status === 'auth'" class="auth center">
      <form class="card auth-card" @submit.prevent="submitKey">
        <h2>Панель ведущего{{ room.code && serverMeta.mode === 'rooms' ? ` · комната ${formatCode(room.code)}` : '' }}</h2>
        <p v-if="serverMeta.mode === 'rooms'" class="muted">
          Чтобы управлять этой игрой, введите ключ ведущего комнаты. Его видно в панели ведущего на устройстве, где
          создали комнату: кнопка с QR-кодом → «Управлять игрой с другого устройства».
        </p>
        <p v-else class="muted">
          Чтобы управлять игрой с этого устройства, введите ключ ведущего. Он показан в окне сервера (консоли) и в панели
          ведущего на компьютере с игрой: кнопка с QR-кодом → «Управлять игрой с другого устройства».
        </p>
        <input v-model="keyInput" class="input" placeholder="Ключ ведущего" autocapitalize="characters" autocomplete="off" />
        <p v-if="conn.errorMessage.value" class="err">{{ conn.errorMessage.value }}</p>
        <button class="btn primary big" type="submit">Войти</button>
        <a class="muted small" :href="roomPath()">Я игрок →</a>
      </form>
    </div>

    <div v-else-if="!state" class="auth center">
      <p class="muted">{{ status === 'offline' ? 'Нет связи с сервером. Он запущен? Переподключаемся…' : 'Подключение…' }}</p>
    </div>

    <template v-else>
      <header class="bar">
        <div class="brand">
          <span class="logo-dot" />
          <button v-if="roomCode" class="room-chip" title="Код комнаты — игроки вводят его на главной странице сайта" @click="modal = 'join'">
            <span class="room-lbl">Комната</span> <b class="nums">{{ formatCode(roomCode) }}</b>
          </button>
          <div class="modes">
            <button class="mode-btn" :class="{ on: mode === 'jeopardy' }" @click="switchMode('jeopardy')">Своя игра</button>
            <button class="mode-btn" :class="{ on: mode === 'brainring' }" @click="switchMode('brainring')">Брейн-ринг</button>
          </div>
        </div>
        <button class="pack-btn" title="Пакеты вопросов" @click="modal = 'packs'">
          <Icon name="folder" />
          <span class="ellipsis">{{ state.pack?.title ?? 'Пакет не выбран' }}</span>
        </button>
        <div class="grow" />
        <button class="btn small" :disabled="!state.undo" :title="state.undo ? `Отменить: ${state.undo} (Ctrl+Z)` : 'Нечего отменять'" @click="run('undo')">
          <Icon name="undo" /> Отменить
        </button>
        <button class="btn small icon" :title="soundTitle" @click="cycleSound">
          <Icon :name="soundMode === 'off' ? 'mute' : 'volume'" />
          <span v-if="soundMode === 'auto'" class="auto-tag">A</span>
        </button>
        <button class="btn small" title="Открыть экран для зрителей в новом окне" @click="openScreen">
          <Icon name="monitor" /> Экран
          <span v-if="state.screens" class="chip mini">{{ state.screens }}</span>
        </button>
        <button class="btn small icon" title="Настройки" @click="modal = 'settings'"><Icon name="settings" /></button>
        <button class="join-btn" title="Как подключиться" @click="modal = 'join'">
          <QrCode class="mini-qr" :text="state.joinUrl" />
          <span class="join-url">{{ joinShort }}</span>
        </button>
        <span class="conn" :class="status" :title="status === 'online' ? 'Связь с сервером есть' : 'Нет связи'">
          <Icon :name="status === 'online' ? 'wifi' : 'wifiOff'" />
        </span>
      </header>

      <div class="layout">
        <aside class="side scroll">
          <HostRoster />
          <div v-if="lastLog.length" class="log">
            <div class="label">Журнал</div>
            <div v-for="(l, i) in lastLog" :key="i" class="log-row">
              <span class="faint nums">{{ fmtTime(l.at) }}</span> {{ l.text }}
            </div>
          </div>
        </aside>

        <main class="main scroll">
          <HostLobby v-if="state.stage === 'lobby'" />
          <HostJeopardy v-else-if="mode === 'jeopardy' && state.jeopardy" :host-plays="hostPlays" />
          <HostBrainRing v-else-if="mode === 'brainring' && state.brainring" :host-plays="hostPlays" />
          <div v-else class="card muted">
            Для «Своей игры» нужен пакет вопросов.
            <button class="btn small" @click="modal = 'packs'">Выбрать пакет</button>
          </div>
        </main>

        <aside class="right scroll">
          <HostBuzzPanel />
          <div class="keys card">
            <div class="label">Клавиши</div>
            <template v-if="mode === 'jeopardy'">
              <div><span class="kbd">Пробел</span> принимать ответы</div>
              <div><span class="kbd">Enter</span> верно / далее</div>
              <div><span class="kbd">Backspace</span> неверно</div>
              <div><span class="kbd">Esc</span> показать ответ</div>
            </template>
            <template v-else>
              <div><span class="kbd">Пробел</span> «Время!»</div>
              <div><span class="kbd">Enter</span> верно / следующий вопрос</div>
              <div><span class="kbd">Backspace</span> неверно</div>
            </template>
            <div><span class="kbd">P</span> пауза таймера</div>
            <div><span class="kbd">Ctrl+Z</span> отменить</div>
          </div>
        </aside>
      </div>
    </template>

    <Modal v-if="modal === 'settings' && state" title="Настройки" width="820px" @close="modal = null">
      <HostSettings />
    </Modal>
    <Modal v-if="modal === 'packs' && state" title="Пакеты вопросов" width="860px" @close="modal = null">
      <HostPacks @close="modal = null" />
    </Modal>
    <Modal v-if="modal === 'join' && state" title="Подключение игроков" width="620px" @close="modal = null">
      <HostJoin />
    </Modal>

    <div class="toasts">
      <TransitionGroup name="fade">
        <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind">{{ t.text }}</div>
      </TransitionGroup>
    </div>
  </div>
</template>

<style scoped>
.host {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.auth {
  flex: 1;
  padding: 20px;
}
.auth-card {
  max-width: 440px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.auth-card h2 {
  margin: 0;
  color: var(--accent);
}
.err {
  color: #ff8a8a;
  margin: 0;
}
.small {
  font-size: 0.85rem;
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-2);
  border-bottom: 1px solid var(--line);
  flex-wrap: wrap;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.room-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 10px;
  border: 1px solid var(--line-2);
  background: var(--panel-2);
  color: var(--text);
  font-size: 1.05rem;
  cursor: pointer;
  white-space: nowrap;
}
.room-chip b {
  letter-spacing: 0.06em;
}
.room-lbl {
  font-size: 0.75rem;
  color: var(--muted);
}
.logo-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 35%, #ff7676, #c21c1c);
  box-shadow: 0 0 0 3px var(--accent);
}
.modes {
  display: flex;
  background: var(--panel);
  border-radius: 10px;
  padding: 3px;
}
.mode-btn {
  border: none;
  background: transparent;
  color: var(--muted);
  font-weight: 800;
  padding: 0.4em 0.9em;
  border-radius: 8px;
  cursor: pointer;
}
.mode-btn.on {
  background: var(--accent);
  color: var(--accent-text);
}
.pack-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 280px;
  background: transparent;
  border: 1px dashed var(--line-2);
  color: var(--text);
  padding: 0.35em 0.7em;
  border-radius: 8px;
  cursor: pointer;
}
.auto-tag {
  font-size: 0.6rem;
  font-weight: 900;
  margin-left: -4px;
}
.chip.mini {
  padding: 0 0.45em;
  font-size: 0.75rem;
  background: var(--ok-2);
}
.join-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--panel);
  border: 1px solid var(--line-2);
  border-radius: 10px;
  padding: 3px 10px 3px 3px;
  cursor: pointer;
  color: var(--text);
}
.mini-qr {
  width: 34px;
  border-radius: 6px;
}
.join-url {
  font-weight: 800;
  color: var(--accent);
}
.conn {
  color: var(--ok);
  display: inline-flex;
}
.conn:not(.online) {
  color: var(--bad);
}
.layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr) 290px;
}
.side,
.right {
  padding: 12px;
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.right {
  border-right: none;
  border-left: 1px solid var(--line);
}
.main {
  padding: 14px 18px 30px;
}
.log {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 0.8rem;
  color: var(--muted);
}
.log-row {
  line-height: 1.3;
}
.keys {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 0.85rem;
  color: var(--muted);
  padding: 10px 12px;
}
.toasts {
  position: fixed;
  right: 16px;
  bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 200;
  pointer-events: none;
}
.toast {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--panel-3);
  border: 1px solid var(--line-2);
  box-shadow: var(--shadow);
  max-width: 420px;
}
.toast.err {
  background: #5a1d1d;
  border-color: #b91c1c;
}
.toast.ok {
  background: #14432a;
  border-color: #15803d;
}
@media (max-width: 1180px) {
  .layout {
    grid-template-columns: 270px minmax(0, 1fr);
  }
  .right {
    grid-column: 1 / -1;
    border-left: none;
    border-top: 1px solid var(--line);
    flex-direction: row;
    flex-wrap: wrap;
  }
  .right > * {
    flex: 1 1 260px;
  }
  .host {
    height: auto;
    min-height: 100vh;
    overflow: visible;
  }
}
@media (max-width: 760px) {
  .layout {
    grid-template-columns: 1fr;
  }
  .side {
    border-right: none;
    border-bottom: 1px solid var(--line);
  }
  .join-url {
    display: none;
  }
}
</style>
