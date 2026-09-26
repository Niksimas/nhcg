<script setup lang="ts">
// Экран для зрителей (проектор / телевизор / второй монитор). Ответы здесь не видны, пока их не откроет ведущий.
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { GameConnection } from '../lib/connection'
import { SoundEngine, soundForEvent } from '../lib/sound'
import { competitorMap, textOn, timerLeft, useConnMessage, useServerNow } from '../lib/util'
import ScreenLobby from './screen/ScreenLobby.vue'
import ScreenJeopardy from './screen/ScreenJeopardy.vue'
import ScreenBrainRing from './screen/ScreenBrainRing.vue'
import ScreenReaction from './screen/ScreenReaction.vue'
import QrCode from '../components/QrCode.vue'
import Icon from '../components/Icon.vue'

const conn = new GameConnection('screen')
const sound = new SoundEngine('quiz.sound.screen')
const now = useServerNow(conn, 100)
const state = conn.state

const started = ref(false)
const showQr = ref(false)
const flash = reactive<Record<string, number>>({})
const overlay = ref<{ text: string; sub?: string; color: string; kind: string } | null>(null)
const cursorHidden = ref(false)
let overlayTimer = 0
let cursorTimer = 0

onMounted(() => {
  conn.start()
  window.addEventListener('keydown', onKey)
  window.addEventListener('mousemove', onMouse)
})
onUnmounted(() => {
  conn.stop()
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('mousemove', onMouse)
  clearTimeout(overlayTimer)
  clearTimeout(cursorTimer)
})

function start() {
  sound.unlock()
  started.value = true
}

function fullscreen() {
  sound.unlock()
  started.value = true
  if (document.fullscreenElement) void document.exitFullscreen?.()
  else void document.documentElement.requestFullscreen?.().catch(() => {})
}

function onKey(e: KeyboardEvent) {
  if (!started.value) start()
  if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') fullscreen()
  if (e.key === 'q' || e.key === 'Q' || e.key === 'й' || e.key === 'Й') showQr.value = !showQr.value
}

function onMouse() {
  cursorHidden.value = false
  clearTimeout(cursorTimer)
  cursorTimer = window.setTimeout(() => (cursorHidden.value = true), 2500)
}

const comps = computed(() => competitorMap(state.value))

// События, после которых заставка «кто нажал» больше не актуальна.
const CLEARS_OVERLAY = new Set([
  'questionSelected',
  'assigned',
  'reveal',
  'correct',
  'wrong',
  'board',
  'round',
  'results',
  'brQuestion',
  'brWinner',
  'burned',
  'finalTheme',
  'finalQuestion',
  'undo',
  'gameStart',
  'theme',
  'assignStart',
  'battleStart',
  'battleEnd',
  'strikeStart',
  'strike',
  'reactionStart',
])

function showOverlay(o: { text: string; sub?: string; color: string; kind: string }, ms: number) {
  overlay.value = o
  clearTimeout(overlayTimer)
  overlayTimer = window.setTimeout(() => (overlay.value = null), ms)
}

useConnMessage(conn, 'event', (msg) => {
  const name: string = msg.name
  const data = msg.data ?? {}
  const snd = soundForEvent(name, data)
  if (snd) sound.play(snd, typeof data.at === 'number' ? data.at - conn.serverNow() : 0)
  if (CLEARS_OVERLAY.has(name)) {
    overlay.value = null
    clearTimeout(overlayTimer)
  }
  if (name === 'test' || name === 'join') {
    const ids = [data.playerId, data.competitorId].filter(Boolean) as string[]
    for (const id of ids) flash[id] = (flash[id] ?? 0) + 1
  }
  if (name === 'buzzWinner') {
    const c = comps.value.get(data.competitorId)
    const p = state.value?.players.find((x) => x.id === data.playerId)
    if (c) {
      showOverlay(
        { text: c.name, sub: state.value?.settings.teamMode && p ? p.name : undefined, color: c.color, kind: 'buzz' },
        1300,
      )
    }
  }
  if (name === 'falseStart') {
    const c = comps.value.get(data.competitorId)
    if (c) showOverlay({ text: 'Фальстарт!', sub: c.name, color: '#dc2626', kind: 'false' }, 1600)
  }
  if (name === 'soundTest' && !sound.unlocked.value) {
    showOverlay({ text: 'Щёлкните здесь', sub: 'чтобы браузер разрешил звук', color: '#4f46e5', kind: 'hint' }, 3000)
  }
})

// Звуковые предупреждения таймера «Брейн-ринга»: за 10 секунд и последние 5 секунд.
const mainSecs = computed(() => {
  const t = state.value?.timers.main
  return t?.running ? Math.ceil(timerLeft(t, now.value) / 1000) : null
})
watch(mainSecs, (s, prev) => {
  if (s == null || prev == null || s >= prev) return
  if (s === 10) sound.play('warn')
  else if (s <= 5 && s > 0) sound.play('tick')
})
const finalSecs = computed(() => {
  const t = state.value?.timers.final
  return t?.running ? Math.ceil(timerLeft(t, now.value) / 1000) : null
})
watch(finalSecs, (s, prev) => {
  if (s == null || prev == null || s >= prev) return
  if (s <= 10 && s > 0) sound.play('tick')
})

const mode = computed(() => state.value?.mode)
</script>

<template>
  <div class="screen" :class="{ nocursor: cursorHidden && started }" @click="start">
    <div v-if="conn.status.value === 'noroom'" class="wait center gone">
      <p>{{ conn.errorCode.value === 'room_closed' ? 'Игра завершена' : 'Игра не найдена' }}</p>
      <p class="muted small">{{ conn.errorMessage.value }}</p>
      <a class="btn big" href="/">На главную</a>
    </div>

    <div v-else-if="!state" class="wait center">
      <p>Подключение к серверу игры…</p>
    </div>

    <template v-else>
      <ScreenLobby v-if="state.stage === 'lobby'" :state="state" :flash="flash" />
      <ScreenJeopardy
        v-else-if="(mode === 'jeopardy' || mode === 'khamsa') && state.jeopardy"
        :state="state"
        :j="state.jeopardy"
        :now="now"
        :flash="flash"
      />
      <ScreenBrainRing
        v-else-if="mode === 'brainring' && state.brainring"
        :state="state"
        :br="state.brainring"
        :now="now"
        :flash="flash"
      />
      <ScreenReaction v-else-if="mode === 'reaction' && state.reaction" :state="state" :r="state.reaction" :now="now" />
      <div v-else class="wait center"><p>Ведущий готовит игру…</p></div>

      <div v-if="showQr && state.stage !== 'lobby'" class="corner-qr">
        <QrCode :text="state.joinUrl" />
        <div class="corner-url">{{ state.joinUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') }}</div>
      </div>
    </template>

    <Transition name="fade">
      <div
        v-if="overlay"
        class="overlay"
        :class="overlay.kind"
        :style="{ '--c': overlay.color, '--t': textOn(overlay.color) }"
      >
        <div class="overlay-text">{{ overlay.text }}</div>
        <div v-if="overlay.sub" class="overlay-sub">{{ overlay.sub }}</div>
      </div>
    </Transition>

    <div v-if="conn.status.value !== 'online' && conn.status.value !== 'noroom' && state" class="offline">
      <Icon name="wifiOff" /> Нет связи с сервером — переподключаемся…
    </div>

    <div v-if="!started" class="start" @click.stop="start">
      <div class="start-card">
        <h2>Экран игры</h2>
        <p>Нажмите в любом месте, чтобы включить звук.</p>
        <div class="row center">
          <button class="btn primary big" @click.stop="start"><Icon name="volume" /> Включить звук</button>
          <button class="btn big" @click.stop="fullscreen"><Icon name="expand" /> Во весь экран</button>
        </div>
        <p class="muted small">Клавиши: <span class="kbd">F</span> — полный экран, <span class="kbd">Q</span> — QR-код для подключения</p>
      </div>
    </div>

    <button v-else class="fs-btn btn flat icon" title="Полный экран (F)" @click.stop="fullscreen">
      <Icon name="expand" />
    </button>
  </div>
</template>

<style scoped>
.screen {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background:
    radial-gradient(60vw 45vh at 8% -8%, rgba(99, 102, 241, 0.16), transparent 70%),
    radial-gradient(55vw 45vh at 105% 108%, rgba(236, 72, 153, 0.11), transparent 70%),
    radial-gradient(45vw 40vh at -5% 105%, rgba(6, 182, 212, 0.1), transparent 70%),
    var(--bg);
  user-select: none;
}
.screen.nocursor {
  cursor: none;
}
.wait {
  height: 100%;
  font-size: 2rem;
  color: var(--muted);
}
.wait.gone {
  flex-direction: column;
  gap: 18px;
  text-align: center;
}
.wait.gone p {
  margin: 0;
}
.corner-qr {
  position: absolute;
  right: 16px;
  top: 16px;
  width: 150px;
  padding: 8px;
  background: var(--panel);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-lg);
  border-radius: 16px;
  text-align: center;
}
.corner-url {
  font-size: 0.8rem;
  margin-top: 4px;
  font-weight: 700;
}
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2vh;
  background: radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--c) 82%, white), var(--c) 75%);
  color: var(--t);
  z-index: 20;
  pointer-events: none;
}
.overlay.false {
  color: #fff;
}
.overlay-text {
  font-size: clamp(3rem, 12vw, 12rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  text-align: center;
  animation: pop 0.35s ease;
  line-height: 1.05;
  padding: 0 4vw;
}
.overlay-sub {
  font-size: clamp(1.5rem, 4vw, 4rem);
  font-weight: 800;
  opacity: 0.9;
}
.offline {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  background: rgba(220, 38, 38, 0.9);
  color: #fff;
  padding: 8px 16px;
  border-radius: 99px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 30;
}
.start {
  position: absolute;
  inset: 0;
  z-index: 40;
  background: rgba(243, 245, 250, 0.72);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.start-card {
  background: var(--panel);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-lg);
  border-radius: 24px;
  padding: 28px 36px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 560px;
}
.start-card h2 {
  margin: 0;
  color: var(--accent);
}
.start-card p {
  margin: 0;
}
.small {
  font-size: 0.9rem;
}
.fs-btn {
  position: absolute;
  right: 10px;
  bottom: 10px;
  opacity: 0.35;
  z-index: 25;
}
.fs-btn:hover {
  opacity: 1;
}
.nocursor .fs-btn {
  opacity: 0;
}
</style>
