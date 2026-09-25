<script setup lang="ts">
// Подготовка к игре: подключение игроков, выбор режима и пакета, старт.
import { computed, ref } from 'vue'
import type { Mode } from '../../lib/types'
import { plural } from '../../lib/util'
import QrCode from '../../components/QrCode.vue'
import Icon from '../../components/Icon.vue'
import { useHost } from './ctx'
import { formatCode, roomPath } from '../../lib/room'

const { state, run, openPacks, openJoin } = useHost()
const s = computed(() => state.value!)
const url = computed(() => s.value.joinUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''))
const connected = computed(() => s.value.players.filter((p) => p.connected).length)
const code = computed(() => (s.value.room?.mode === 'rooms' ? s.value.room.code : null))
const lan = computed(() => /^http:\/\/\d+\.\d+\.\d+\.\d+/.test(s.value.joinUrl))
const site = computed(() => {
  try {
    return new URL(s.value.joinUrl).host
  } catch {
    return url.value
  }
})
const newTeam = ref('')

const MODES: { id: Mode; title: string; text: string }[] = [
  {
    id: 'jeopardy',
    title: 'Своя игра',
    text: 'Темы по 5 вопросов (10–50), за ошибку — минус. Раунды: открытый, полуоткрытый, закрытый, командирский. Нужен пакет вопросов.',
  },
  {
    id: 'brainring',
    title: 'Брейн-ринг',
    text: 'Бои команд по 5 вопросов, минута на обсуждение, фальстарты. За победу в бою +1 в сквозную таблицу. Можно без пакета.',
  },
]

const canStart = computed(() => s.value.mode === 'brainring' || !!s.value.pack)

function setMode(mode: Mode) {
  if (mode !== s.value.mode) void run('mode.set', { mode })
}

function toggleOnline() {
  void run('settings.update', { patch: { onlineMode: !s.value.settings.onlineMode } })
}

function toggleTeams() {
  void run('settings.update', { patch: { teamMode: !s.value.settings.teamMode } })
}

async function addTeam() {
  const name = newTeam.value.trim()
  if (!name) return
  // Очищаем поле сразу, чтобы можно было вводить следующую команду; при ошибке — вернём текст.
  newTeam.value = ''
  if (!(await run('team.add', { name })) && !newTeam.value) newTeam.value = name
}

async function start() {
  if (!s.value.competitors.length && !confirm('Никто ещё не подключился. Всё равно начать?')) return
  await run('game.start')
}

function openScreen() {
  window.open(roomPath('/screen'), 'quiz-screen', 'width=1280,height=720')
}
</script>

<template>
  <div class="lobby">
    <section class="card join-card">
      <div class="step-title"><span class="num">1</span> Подключите игроков</div>
      <div class="join">
        <button class="qr-btn" title="Показать крупно" @click="openJoin">
          <QrCode :text="s.joinUrl" />
        </button>
        <div class="join-text">
          <template v-if="code">
            <p>
              {{ lan ? 'Телефоны в той же Wi-Fi сети открывают' : 'Игроки открывают на телефонах' }} <b>{{ site }}</b> и вводят код
              комнаты (или сканируют QR-код):
            </p>
            <div class="url code nums">{{ formatCode(code) }}</div>
            <label class="check online">
              <input type="checkbox" :checked="s.settings.onlineMode" @change="toggleOnline" />
              <span>
                <b>Игроки в разных местах</b>
                <span class="muted"> — игра через интернет: кнопки загораются у всех одновременно</span>
              </span>
            </label>
          </template>
          <template v-else>
            <p>Телефоны должны быть в <b>той же Wi-Fi сети</b>, что и этот компьютер. Отсканируйте QR-код или откройте адрес:</p>
            <div class="url">{{ url }}</div>
          </template>
          <p class="muted">
            Подключено: <b>{{ connected }}</b> {{ plural(connected, 'игрок', 'игрока', 'игроков') }}.
            Игроки могут нажать кнопку — их имя мигнёт в списке слева.
          </p>
          <div class="row wrap">
            <button class="btn" @click="openScreen"><Icon name="monitor" /> Экран для зрителей</button>
            <button
              v-if="s.screens"
              class="btn ghost"
              title="Сыграть мелодию на экране для зрителей. Если не слышно — щёлкните по окну экрана один раз"
              @click="run('sound.test')"
            >
              <Icon name="volume" /> Проверить звук на экране
            </button>
            <button class="btn ghost" @click="openJoin"><Icon name="qr" /> Показать QR крупно / не подключаются?</button>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="step-title"><span class="num">2</span> Выберите режим</div>
      <div class="modes">
        <button v-for="m in MODES" :key="m.id" class="mode" :class="{ on: s.mode === m.id }" @click="setMode(m.id)">
          <div class="mode-title">{{ m.title }}</div>
          <div class="mode-text">{{ m.text }}</div>
        </button>
      </div>
      <div class="teams-row">
        <label class="check">
          <input type="checkbox" :checked="s.settings.teamMode" @change="toggleTeams" />
          <span>
            <b>Командная игра</b>
            <span class="muted"> — игроки объединяются в команды, нажать может любой участник команды</span>
          </span>
        </label>
        <div v-if="s.settings.teamMode" class="row add-team">
          <input v-model="newTeam" class="input" maxlength="32" placeholder="Название новой команды" @keydown.enter="addTeam" />
          <button class="btn" :disabled="!newTeam.trim()" @click="addTeam"><Icon name="plus" /> Добавить</button>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="step-title"><span class="num">3</span> Пакет вопросов</div>
      <div class="pack-row">
        <div class="grow">
          <template v-if="s.pack">
            <div class="pack-title">{{ s.pack.title }}</div>
            <div class="muted small">
              {{ s.pack.rounds.map((r) => r.name).join(' · ') }}
            </div>
          </template>
          <template v-else>
            <div class="pack-title muted">Пакет не выбран</div>
            <div class="muted small">
              {{ s.mode === 'brainring' ? 'Для брейн-ринга пакет не обязателен.' : 'Для «Своей игры» выберите пакет — например, встроенный демо-пакет.' }}
            </div>
          </template>
        </div>
        <button class="btn" @click="openPacks"><Icon name="folder" /> {{ s.pack ? 'Сменить' : 'Выбрать пакет' }}</button>
        <button v-if="s.pack && s.mode === 'brainring'" class="btn ghost" @click="run('pack.unload')">Без пакета</button>
      </div>
    </section>

    <div class="start-row">
      <button class="btn primary huge" :disabled="!canStart" @click="start">
        <Icon name="play" /> Начать игру
      </button>
      <p v-if="!canStart" class="muted">Выберите пакет вопросов, чтобы начать «Свою игру».</p>
    </div>
  </div>
</template>

<style scoped>
.lobby {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 980px;
  margin: 0 auto;
  width: 100%;
}
.step-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.15rem;
  font-weight: 800;
  margin-bottom: 12px;
}
.num {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.95rem;
}
.join {
  display: flex;
  gap: 20px;
  align-items: center;
}
.qr-btn {
  width: 170px;
  flex: none;
  border: none;
  padding: 0;
  background: none;
  cursor: zoom-in;
}
.join-text p {
  margin: 0 0 8px;
}
.url {
  font-size: 1.9rem;
  font-weight: 900;
  color: var(--accent);
  margin-bottom: 8px;
  word-break: break-all;
}
.url.code {
  font-size: 2.4rem;
  letter-spacing: 0.08em;
}
.check.online {
  margin: 2px 0 10px;
}
.modes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.mode {
  text-align: left;
  padding: 16px;
  border-radius: 14px;
  border: 2px solid var(--line-2);
  background: var(--panel-2);
  cursor: pointer;
  color: var(--text);
}
.mode.on {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, var(--panel-2));
}
.mode-title {
  font-size: 1.3rem;
  font-weight: 900;
  margin-bottom: 4px;
}
.mode.on .mode-title {
  color: var(--accent);
}
.mode-text {
  color: var(--muted);
  font-size: 0.92rem;
}
.teams-row {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.add-team {
  max-width: 520px;
}
.pack-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.pack-title {
  font-size: 1.15rem;
  font-weight: 800;
}
.small {
  font-size: 0.85rem;
}
.start-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 8px 0 20px;
}
@media (max-width: 760px) {
  .join {
    flex-direction: column;
  }
  .modes {
    grid-template-columns: 1fr;
  }
}
</style>
