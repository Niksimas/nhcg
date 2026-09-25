<script setup lang="ts">
// Экран игрока на телефоне: вход в игру и большая кнопка.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { GameConnection } from '../lib/connection'
import { setHostKey } from '../lib/api'
import { formatCode, room, roomKey, roomPath, serverMeta } from '../lib/room'
import { SoundEngine } from '../lib/sound'
import type { ContentItem } from '../lib/types'
import { competitorMap, fmtScore, storage, textOn, TYPE_LABEL, useConnMessage, useServerNow } from '../lib/util'
import { keepAwake } from '../lib/wakeLock'
import BuzzerButton from './player/BuzzerButton.vue'
import JoinForm from './player/JoinForm.vue'
import FinalPanel from './player/FinalPanel.vue'
import CaptainAssign from './player/CaptainAssign.vue'
import BoardGrid from '../components/BoardGrid.vue'
import ContentView from '../components/ContentView.vue'
import TimerBar from '../components/TimerBar.vue'
import Modal from '../components/Modal.vue'
import Icon from '../components/Icon.vue'

const TOKEN = roomKey('quiz.token')
const NAME = 'quiz.name'
const VIBRO = 'quiz.vibro'

const router = useRouter()
const conn = new GameConnection('player', () => ({ token: storage.get(TOKEN) }))
const sound = new SoundEngine('quiz.sound.player')
const now = useServerNow(conn, 100)
const state = conn.state
const me = conn.me
const status = conn.status

const joinError = ref('')
const canTakeover = ref(false)
const takeoverName = ref('')
const joining = ref(false)
const kicked = ref(false)
const lastName = ref(storage.get(NAME) ?? '')
const vibro = ref(storage.get(VIBRO) !== 'off')
const menuOpen = ref(false)
const toast = ref('')
let toastTimer = 0
const pressedAt = ref(-1e12) // серверное время последнего нажатия
const testOkAt = ref(-1e12)
const earlyAckUntil = ref(0)

onMounted(() => {
  conn.start()
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  conn.stop()
  window.removeEventListener('keydown', onKey)
  clearTimeout(toastTimer)
  clearTimeout(armTimer)
})

function showToast(text: string) {
  toast.value = text
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = ''), 3500)
}

function vibrate(pattern: number | number[]) {
  if (!vibro.value) return
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // вибрация не поддерживается
  }
}

useConnMessage(conn, 'welcome', (msg) => {
  if (!msg.playerId) storage.set(TOKEN, null)
})
useConnMessage(conn, 'joined', (msg) => {
  storage.set(TOKEN, msg.token)
  joining.value = false
  joinError.value = ''
  canTakeover.value = false
  kicked.value = false
})
useConnMessage(conn, 'joinError', (msg) => {
  joining.value = false
  joinError.value = msg.message
  canTakeover.value = !!msg.canTakeover
  takeoverName.value = msg.existingName ?? ''
})
useConnMessage(conn, 'kicked', () => {
  storage.set(TOKEN, null)
  kicked.value = true
})
// Ведущий сделал это устройство вторым пультом ведущего или экраном для зрителей.
useConnMessage(conn, 'promote', (msg) => {
  storage.set(TOKEN, null)
  if (msg.role === 'host' && msg.hostKey) {
    setHostKey(msg.hostKey)
    void router.replace(roomPath('/host'))
  } else if (msg.role === 'screen') {
    void router.replace(roomPath('/screen'))
  }
})
useConnMessage(conn, 'buzzAck', (msg) => {
  if (msg.result === 'test') testOkAt.value = conn.serverNow()
  if (msg.result === 'early') {
    earlyAckUntil.value = msg.until ?? 0
    vibrate(160)
  }
  if (msg.result === 'falseStart') vibrate([200, 80, 200])
  if (msg.result === 'notAtTable') showToast('Эту тему играет другой игрок вашей команды')
  if (msg.result === 'notInBattle') showToast('Сейчас бой других команд')
})

watch(
  () => me.value?.isWinner,
  (win, was) => {
    if (win && !was) {
      vibrate([90, 50, 90])
      sound.play('buzz')
    }
  },
)

function join(payload: { name: string; teamId: string | null; newTeamName: string; takeover: boolean }) {
  sound.unlock()
  void keepAwake()
  joining.value = true
  joinError.value = ''
  lastName.value = payload.name
  storage.set(NAME, payload.name)
  if (!conn.send({ t: 'join', ...payload })) {
    joining.value = false
    joinError.value = 'Нет связи с сервером'
  }
}

const comps = computed(() => competitorMap(state.value))
const mode = computed(() => state.value?.mode ?? 'jeopardy')
const jv = computed(() => (mode.value === 'jeopardy' ? state.value?.jeopardy ?? null : null))
const br = computed(() => (mode.value === 'brainring' ? state.value?.brainring ?? null : null))
const jq = computed(() => (jv.value?.stage === 'question' ? jv.value.question : null))
const myComp = computed(() => (me.value?.competitorId ? comps.value.get(me.value.competitorId) ?? null : null))
const myTeam = computed(() => state.value?.teams.find((t) => t.id === me.value?.teamId) ?? null)
const nameOf = (id: string | null | undefined) => (id ? comps.value.get(id)?.name ?? '—' : '—')
const sport = computed(() => jv.value?.format === 'sport')
const meJ = computed(() => me.value?.jeopardy ?? null)
const battle = computed(() => br.value?.battle ?? null)
const battleLine = computed(() => {
  const bt = battle.value ?? (br.value?.stage === 'battleEnd' ? br.value.lastBattle : null)
  return bt ? bt.teams.map((id) => `${nameOf(id)} ${bt.scores[id] ?? 0}`).join(' : ') : ''
})

// При игре по интернету кнопки открываются в назначенный момент — одновременно у всех.
// До него показываем «Внимание…», а ровно в этот момент — «Жми!».
const armedSoon = ref(false)
let armTimer = 0
watch(
  () => [state.value?.buzzer.status, state.value?.buzzer.armedAt] as const,
  ([st, at]) => {
    clearTimeout(armTimer)
    const delay = st === 'armed' && typeof at === 'number' ? at - conn.serverNow() : 0
    armedSoon.value = delay > 0
    if (delay > 0) armTimer = window.setTimeout(() => (armedSoon.value = false), delay)
  },
)

const earlyUntil = computed(() => Math.max(me.value?.earlyLockUntil ?? 0, earlyAckUntil.value))
const earlyLeft = computed(() => Math.max(0, earlyUntil.value - now.value))

interface ButtonState {
  cls: string
  title: string
  sub?: string
  active: boolean
}

const button = computed<ButtonState>(() => {
  const s = state.value
  const m = me.value
  if (status.value !== 'online' || !s) return { cls: 'offline', title: 'Нет связи', sub: 'Переподключаемся…', active: false }
  if (!m) return { cls: 'idle', title: '…', active: false }
  const b = s.buzzer
  if (s.settings.teamMode && !m.competitorId) {
    return { cls: 'idle', title: 'Без команды', sub: 'Выберите команду в меню ☰', active: false }
  }
  // Спортивная «Своя игра»: тему играет другой игрок команды.
  if (meJ.value?.atTable === false && b.status !== 'test') {
    return { cls: 'idle', title: 'Тему играет', sub: meJ.value.tablePlayer?.name ?? 'другой игрок', active: false }
  }
  // «Брейн-ринг»: бой других команд.
  if (me.value?.brainring?.inBattle === false && b.status !== 'test') {
    return { cls: 'idle', title: 'Сейчас играют', sub: battleLine.value.replace(/ \d+/g, '').replace(/ : /g, ' — '), active: false }
  }
  if (b.status === 'test') {
    const ok = now.value - testOkAt.value < 1300
    return ok
      ? { cls: 'pressed', title: 'Работает!', sub: 'Кнопка на связи', active: true }
      : { cls: 'test', title: 'Проверка', sub: 'Нажмите, чтобы проверить кнопку', active: true }
  }
  const q = jq.value
  const iAnswer =
    (b.status === 'answering' && m.isWinner) || (!!q && q.step === 'answering' && !!m.competitorId && q.responderId === m.competitorId)
  if (iAnswer) {
    return {
      cls: 'winner',
      title: 'Ваш ответ!',
      sub: b.status === 'answering' && m.reaction != null ? `Реакция ${m.reaction} мс` : 'Отвечайте ведущему',
      active: false,
    }
  }
  if (m.falseStart) return { cls: 'locked', title: 'Фальстарт', sub: 'На этот вопрос вы уже не отвечаете', active: false }
  if (m.lockedOut) return { cls: 'locked', title: 'Уже отвечали', sub: 'Ждём следующий вопрос', active: false }
  if (b.status === 'answering' && b.winner) {
    return {
      cls: 'other',
      title: `Отвечает ${nameOf(b.winner.competitorId)}`,
      sub: m.rank ? `Вы ${m.rank}-й · +${m.delta} мс` : '',
      active: false,
    }
  }
  if (q && q.step === 'answering' && q.responderId) {
    return { cls: 'other', title: `Отвечает ${nameOf(q.responderId)}`, active: false }
  }
  if (q && q.step === 'special') return { cls: 'idle', title: TYPE_LABEL[q.type] ?? 'Спецвопрос', sub: 'Смотрите на экран', active: false }
  const open = b.status === 'closed' || b.status === 'armed' || b.status === 'collecting'
  if (open && earlyLeft.value > 0) {
    return { cls: 'early', title: 'Рано!', sub: `Блокировка ${(earlyLeft.value / 1000).toFixed(1)} с`, active: true }
  }
  if (b.status === 'armed' && armedSoon.value) {
    return { cls: 'wait', title: 'Внимание…', sub: 'Кнопка сейчас загорится', active: true }
  }
  if (b.status === 'armed' || b.status === 'collecting') {
    if (m.rank != null || now.value - pressedAt.value < 800) return { cls: 'pressed', title: 'Нажато!', sub: 'Ждём результат…', active: false }
    return { cls: 'go', title: 'Жми!', active: true }
  }
  if (b.status === 'closed') {
    return {
      cls: 'wait',
      title: 'Ждите',
      sub:
        mode.value === 'brainring'
          ? 'Нажатие до сигнала «Время!» — фальстарт'
          : 'Кнопка откроется, когда ведущий прочитает вопрос',
      active: true,
    }
  }
  if (jv.value?.stage === 'board') return { cls: 'idle', title: 'Выбор вопроса', active: false }
  if (q?.step === 'reveal' || br.value?.stage === 'reveal') return { cls: 'idle', title: 'Ответ на экране', active: false }
  return { cls: 'idle', title: 'Ждём вопрос', active: false }
})

function press(ev?: Event) {
  sound.unlock()
  void keepAwake()
  const btn = button.value
  if (!btn.active) return
  const ts = ev?.timeStamp ?? 0
  const local = ts > 0 && Math.abs(performance.now() - ts) < 1000 ? ts : performance.now()
  const at = conn.synced ? conn.toServerTime(local) : undefined
  if (conn.send({ t: 'buzz', at })) {
    pressedAt.value = conn.toServerTime(local)
    vibrate(25)
  }
}

function onKey(e: KeyboardEvent) {
  if (menuOpen.value || e.repeat) return
  const tag = (e.target as HTMLElement | null)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  if (e.code === 'Space' || e.key === 'Enter') {
    e.preventDefault()
    press(e)
  }
}

// ── Информация над кнопкой ──
interface Info {
  top: string
  main: string
  content: ContentItem[] | null
  answer: string | null
  timer: string | null
}

const info = computed<Info>(() => {
  const s = state.value
  const out: Info = { top: '', main: '', content: null, answer: null, timer: null }
  if (!s) return out
  const showQ = s.settings.showQuestionOnPhones
  if (s.stage === 'lobby') {
    out.top = s.mode === 'brainring' ? 'Брейн-ринг' : 'Своя игра'
    out.main = 'Ждём начала игры'
    return out
  }
  if (jv.value && sport.value && ['board', 'assign', 'theme'].includes(jv.value.stage)) {
    const j = jv.value
    const round = j.rounds[j.roundIndex]
    out.top = round?.name ?? ''
    if (j.stage === 'assign') {
      out.main = meJ.value?.isCaptain ? '' : 'Капитаны выбирают, кто играет темы'
      const mine = meJ.value?.myThemes ?? []
      if (!meJ.value?.isCaptain && mine.length) out.main += ` · вы играете: ${mine.map((t) => t.name ?? `тему ${t.index + 1}`).join(', ')}`
    } else if (j.stage === 'theme') {
      const theme = j.themeIndex != null ? j.board?.[j.themeIndex] : null
      out.main = `Тема: ${theme?.name ?? '…'}`
      if (meJ.value?.atTable === true) out.main += ' — вы за столом!'
    } else {
      const mine = meJ.value?.myThemes ?? []
      out.main = mine.length ? `Ваши темы: ${mine.map((t) => t.name ?? `тема ${t.index + 1}`).join(', ')}` : 'Ждём следующую тему'
    }
    return out
  }
  if (jv.value) {
    const j = jv.value
    const round = j.rounds[j.roundIndex]
    if (j.stage === 'board') {
      out.top = round?.name ?? ''
      out.main = me.value?.jeopardy?.isChooser ? 'Ваш выбор!' : `Выбирает: ${nameOf(j.chooserId)}`
    } else if (j.stage === 'question' && j.question) {
      const q = j.question
      out.top = `${q.themeName} · ${q.price}`
      if (q.step === 'special') {
        out.main =
          q.type === 'cat'
            ? `Кот в мешке! Тема: «${q.catTheme}»`
            : q.type === 'auction'
              ? 'Вопрос-аукцион!'
              : 'Вопрос без риска!'
      } else if (q.step === 'reveal') {
        out.answer = q.answer
      } else if (showQ) {
        out.content = q.content
      }
      out.timer = q.step === 'buzzing' ? 'buzz' : q.step === 'answering' ? 'answer' : null
    } else if (j.stage === 'roundEnd') {
      out.top = round?.name ?? ''
      out.main = 'Раунд окончен'
    } else if (j.stage === 'results') {
      out.main = 'Игра окончена!'
    }
    return out
  }
  if (br.value) {
    const b = br.value
    if (b.stage === 'idle' && !b.battle) {
      out.main = b.battles.length ? 'Ждём следующий бой' : 'Ждём начала боя'
      return out
    }
    if (b.stage === 'battleEnd' && b.lastBattle) {
      const last = b.lastBattle
      out.top = `Бой №${last.no}: ${last.teams.map((id) => `${nameOf(id)} ${last.scores[id] ?? 0}`).join(' : ')}`
      out.main = last.winnerId ? `Победа: ${nameOf(last.winnerId)}` : 'Ничья'
      out.answer = b.question?.answer ?? null
      return out
    }
    const bt = b.battle
    const n = bt ? Math.max(1, bt.played + (['reading', 'armed', 'answering'].includes(b.stage) ? 1 : 0)) : 0
    out.top = bt
      ? `Бой №${bt.no} · вопрос ${n}${bt.limit ? ` из ${bt.limit}` : ''}${b.value > 1 ? ` · стоимость ${b.value}` : ''}`
      : `Вопрос №${b.qIndex + 1}${b.value > 1 ? ` · стоимость ${b.value}` : ''}`
    if (battleLine.value) out.top += ` · ${battleLine.value}`
    if (b.stage === 'idle') out.main = 'Ждём вопрос'
    else if (b.stage === 'reading') out.main = 'Слушайте вопрос'
    else if (b.stage === 'armed') out.main = 'Время пошло!'
    else if (b.stage === 'answering') out.main = 'Идёт ответ'
    else if (b.stage === 'reveal') {
      out.main = b.answeredBy ? `Верно ответили: ${nameOf(b.answeredBy)}` : 'Вопрос не взят'
      out.answer = b.question?.answer ?? null
    } else if (b.stage === 'finished') {
      out.main = b.winnerId ? `Победитель турнира: ${nameOf(b.winnerId)}` : 'Итоги турнира'
    }
    if (showQ && b.showQuestion && b.stage !== 'reveal') out.content = b.question?.content ?? null
    out.timer = b.stage === 'armed' || b.stage === 'answering' ? 'main' : null
  }
  return out
})

const activeTimer = computed(() => (info.value.timer ? state.value?.timers[info.value.timer] : undefined))

const canSelect = computed(() => !!me.value?.jeopardy?.canSelect && jv.value?.stage === 'board' && !!jv.value.board)
const final = computed(() => (jv.value?.stage === 'final' ? jv.value.final : null))
const meFinal = computed(() => me.value?.jeopardy?.final ?? null)
const showResults = computed(() => jv.value?.stage === 'results' || br.value?.stage === 'finished')
const standings = computed(() => [...(state.value?.competitors ?? [])].sort((a, b) => b.score - a.score))

async function selectQuestion(id: string) {
  try {
    await conn.act('select', { id })
  } catch (e) {
    showToast((e as Error).message)
  }
}

// Капитан выбирает игроков на темы.
const assignBusy = ref(false)
async function pickPlayer(themeIndex: number, playerId: string) {
  assignBusy.value = true
  try {
    await conn.act('assign', { themeIndex, playerId })
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    assignBusy.value = false
  }
}
async function assignReady() {
  assignBusy.value = true
  try {
    await conn.act('assignReady')
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    assignBusy.value = false
  }
}

async function sendBet(amount: number) {
  try {
    await conn.act('finalBet', { amount })
  } catch (e) {
    showToast((e as Error).message)
  }
}

async function sendAnswer(text: string) {
  try {
    await conn.act('finalAnswer', { text })
    showToast('Ответ отправлен')
  } catch (e) {
    showToast((e as Error).message)
  }
}

// ── Меню ──
const newName = ref('')
const newTeamId = ref<string>('')
const newTeamName = ref('')

function openMenu() {
  newName.value = me.value?.name ?? ''
  newTeamId.value = me.value?.teamId ?? ''
  newTeamName.value = ''
  menuOpen.value = true
}

async function saveName() {
  try {
    await conn.act('rename', { name: newName.value })
    storage.set(NAME, newName.value.trim())
    showToast('Имя изменено')
  } catch (e) {
    showToast((e as Error).message)
  }
}

async function saveTeam() {
  try {
    await conn.act('setTeam', newTeamId.value ? { teamId: newTeamId.value } : { newTeamName: newTeamName.value })
    showToast('Команда изменена')
    menuOpen.value = false
  } catch (e) {
    showToast((e as Error).message)
  }
}

function toggleVibro() {
  vibro.value = !vibro.value
  storage.set(VIBRO, vibro.value ? 'on' : 'off')
  vibrate(30)
}

function fullscreen() {
  const el = document.documentElement
  if (document.fullscreenElement) void document.exitFullscreen?.()
  else void el.requestFullscreen?.().catch(() => showToast('Полноэкранный режим недоступен'))
  menuOpen.value = false
}

async function leave() {
  if (!confirm('Выйти из игры? Ваши очки будут удалены.')) return
  try {
    await conn.request({ t: 'leave' })
  } catch {
    // всё равно выходим
  }
  storage.set(TOKEN, null)
  menuOpen.value = false
  kicked.value = false
}

const pingClass = computed(() => {
  const r = conn.rtt.value
  if (status.value !== 'online') return 'bad'
  if (r == null) return ''
  return r < 80 ? 'good' : r < 200 ? 'mid' : 'bad'
})
</script>

<template>
  <div class="player" :style="{ '--me': me?.color ?? '#4f7bff', '--me-t': textOn(me?.color ?? '#4f7bff') }">
    <!-- Нет подключения и ещё не вошли -->
    <div v-if="status === 'noroom'" class="splash center">
      <h2>{{ conn.errorCode.value === 'room_closed' ? 'Игра завершена' : 'Игра не найдена' }}</h2>
      <p class="muted">{{ conn.errorMessage.value || 'Комната не найдена или уже закрыта.' }}</p>
      <p v-if="room.code" class="muted small">Код комнаты: {{ formatCode(room.code) }}</p>
      <a class="btn primary big" href="/">Ввести другой код</a>
    </div>

    <div v-else-if="!state && status !== 'online'" class="splash center">
      <div class="spinner" />
      <p>Подключаемся к игре…</p>
      <p class="muted small">
        {{
          serverMeta.mode === 'rooms'
            ? 'Проверьте, что телефон подключён к интернету.'
            : 'Телефон должен быть в той же Wi-Fi сети, что и компьютер ведущего.'
        }}
      </p>
    </div>

    <!-- Форма входа -->
    <div v-else-if="!me" class="scroll join-wrap">
      <JoinForm
        :state="state"
        :default-name="lastName"
        :error="joinError"
        :can-takeover="canTakeover"
        :takeover-name="takeoverName"
        :busy="joining || status !== 'online'"
        :kicked="kicked"
        @join="join"
      />
    </div>

    <!-- Игра -->
    <template v-else>
      <header class="top">
        <span class="dot me-dot" />
        <div class="who grow">
          <div class="name ellipsis">{{ me.name }}</div>
          <div v-if="myTeam" class="team ellipsis">{{ myTeam.name }}</div>
        </div>
        <div class="score nums" :class="{ neg: (myComp?.score ?? 0) < 0 }">{{ fmtScore(myComp?.score ?? 0) }}</div>
        <span class="conn" :class="pingClass" :title="conn.rtt.value != null ? `Пинг ${conn.rtt.value} мс` : ''">
          <Icon :name="status === 'online' ? 'wifi' : 'wifiOff'" />
        </span>
        <button class="btn flat icon" title="Меню" @click="openMenu"><Icon name="menu" /></button>
      </header>

      <section class="info">
        <div v-if="info.top" class="info-top">{{ info.top }}</div>
        <div v-if="info.main" class="info-main">{{ info.main }}</div>
        <ContentView
          v-if="info.content && !final"
          :items="info.content"
          variant="phone"
          :allow-play="state?.settings.onlineMode ?? false"
        />
        <div v-if="info.answer" class="answer">Ответ: <b>{{ info.answer }}</b></div>
        <TimerBar v-if="activeTimer && !final" :timer="activeTimer" :now="now" />
      </section>

      <main class="stage">
        <FinalPanel
          v-if="final && meFinal"
          :final="final"
          :me="meFinal"
          :timer="state?.timers.final"
          :now="now"
          :show-question="state?.settings.showQuestionOnPhones ?? true"
          @bet="sendBet"
          @answer="sendAnswer"
        />
        <div v-else-if="meJ?.captain" class="scroll cap-wrap">
          <CaptainAssign
            :captain="meJ.captain"
            :timer="state?.timers.assign"
            :now="now"
            :busy="assignBusy"
            @pick="pickPlayer"
            @ready="assignReady"
          />
        </div>
        <div v-else-if="canSelect && jv?.board" class="select-board">
          <p class="center-text">Выберите вопрос:</p>
          <BoardGrid :board="jv.board" variant="phone" clickable @select="selectQuestion" />
        </div>
        <div v-else-if="showResults" class="results">
          <h2>Итоги</h2>
          <ol>
            <li v-for="(c, i) in standings" :key="c.id" :class="{ mine: c.id === me.competitorId }">
              <span class="place">{{ i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.` }}</span>
              <span class="grow ellipsis">{{ c.name }}</span>
              <b class="nums">{{ fmtScore(c.score) }}</b>
            </li>
          </ol>
        </div>
        <BuzzerButton v-else :cls="button.cls" :title="button.title" :sub="button.sub" :active="button.active" @press="press" />
      </main>
    </template>

    <Transition name="fade">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </Transition>

    <Modal v-if="menuOpen && me" title="Меню" width="420px" @close="menuOpen = false">
      <div class="menu">
        <label class="field">
          <span>Имя</span>
          <div class="row">
            <input v-model="newName" class="input" maxlength="24" />
            <button class="btn" :disabled="!newName.trim() || newName.trim() === me.name" @click="saveName">Сохранить</button>
          </div>
        </label>
        <div v-if="state?.settings.teamMode" class="field">
          <span>Команда</span>
          <div class="row">
            <select v-model="newTeamId" class="select">
              <option value="">— новая команда —</option>
              <option v-for="t in state.teams" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
          </div>
          <input
            v-if="!newTeamId && state.settings.allowPlayerTeams"
            v-model="newTeamName"
            class="input"
            maxlength="32"
            placeholder="Название новой команды"
          />
          <button class="btn" :disabled="!newTeamId && !newTeamName.trim()" @click="saveTeam">Перейти в команду</button>
        </div>
        <label class="check"><input type="checkbox" :checked="vibro" @change="toggleVibro" /> Вибрация</label>
        <label class="check">
          <input type="checkbox" :checked="sound.enabled.value" @change="sound.setEnabled(!sound.enabled.value)" />
          Звук, когда вы отвечаете
        </label>
        <button class="btn ghost" @click="fullscreen"><Icon name="expand" /> Полный экран</button>
        <p class="muted small">
          Пинг до сервера: {{ conn.rtt.value ?? '—' }} мс. Если кнопка «тормозит», подойдите ближе к роутеру.
        </p>
        <button class="btn bad" @click="leave"><Icon name="logout" /> Выйти из игры</button>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.cap-wrap {
  width: 100%;
  max-height: 100%;
  align-self: stretch;
}

.player {
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background:
    radial-gradient(ellipse at 50% 120%, color-mix(in srgb, var(--me) 22%, transparent), transparent 60%),
    var(--bg);
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  user-select: none;
  -webkit-user-select: none;
}
.splash {
  flex: 1;
  flex-direction: column;
  gap: 12px;
  text-align: center;
  padding: 24px;
}
.spinner {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 4px solid var(--panel-3);
  border-top-color: var(--accent);
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.join-wrap {
  flex: 1;
  user-select: text;
  -webkit-user-select: text;
}
.top {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.25);
  border-bottom: 3px solid var(--me);
}
.me-dot {
  width: 14px;
  height: 14px;
  background: var(--me);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.15);
}
.who {
  line-height: 1.15;
}
.name {
  font-weight: 800;
  font-size: 1.05rem;
}
.team {
  font-size: 0.8rem;
  color: var(--muted);
}
.score {
  font-size: 1.5rem;
  font-weight: 900;
  color: var(--accent);
}
.score.neg {
  color: var(--bad);
}
.conn {
  color: var(--muted);
  display: inline-flex;
}
.conn.good {
  color: var(--ok);
}
.conn.mid {
  color: var(--warn);
}
.conn.bad {
  color: var(--bad);
}
.info {
  padding: 10px 16px 4px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  text-align: center;
  max-height: 42vh;
  overflow-y: auto;
}
.info-top {
  font-size: 0.85rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}
.info-main {
  font-size: 1.25rem;
  font-weight: 800;
}
.answer {
  font-size: 1.1rem;
}
.info :deep(.timer) {
  width: 100%;
}
.stage {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 16px 20px;
  overflow-y: auto;
}
.select-board {
  width: 100%;
  max-width: 560px;
}
.center-text {
  text-align: center;
  font-weight: 700;
}
.results {
  width: 100%;
  max-width: 420px;
}
.results h2 {
  text-align: center;
  color: var(--accent);
}
.results ol {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.results li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--panel);
  font-size: 1.1rem;
}
.results li.mine {
  outline: 2px solid var(--me);
}
.place {
  width: 2em;
  text-align: center;
}
.toast {
  position: fixed;
  left: 50%;
  bottom: calc(24px + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  background: rgba(20, 29, 63, 0.95);
  border: 1px solid var(--line-2);
  padding: 10px 16px;
  border-radius: 12px;
  z-index: 50;
  max-width: 90vw;
  text-align: center;
}
.menu {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.small {
  font-size: 0.85rem;
  margin: 0;
}
</style>
