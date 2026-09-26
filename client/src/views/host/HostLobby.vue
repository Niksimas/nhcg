<script setup lang="ts">
// Подготовка к игре: подключение игроков, выбор режима, ход игры (раунды и темы), старт.
// Вопросы ведущий читает со своего листа — программе нужен только «скелет» игры.
import { computed, ref } from 'vue'
import type { Mode, Settings } from '../../lib/types'
import { plural } from '../../lib/util'
import QrCode from '../../components/QrCode.vue'
import Icon from '../../components/Icon.vue'
import { useHost } from './ctx'
import { formatCode, roomPath } from '../../lib/room'

const { state, run, openJoin, openSettings, mobile, showPlayers } = useHost()
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
    text: 'Спортивная (личный зачёт, 10 тем), «Эрудит-квартет» (команды, 4 раунда) или как на ТВ. Темы по 5 вопросов, за ошибку — минус.',
  },
  {
    id: 'brainring',
    title: 'Брейн-ринг',
    text: 'Бои команд по 5 вопросов, одна кнопка на команду, минута на обсуждение, фальстарты. Сквозная турнирная таблица.',
  },
  {
    id: 'khamsa',
    title: 'Хамса',
    text: 'Команды по 5 игроков, 5 раундов: явный, полуявный, тайный, персональный и «Хамса» — вопрос на ставку. Фальстарта нет.',
  },
  {
    id: 'reaction',
    title: 'Тест реакции',
    text: 'По сигналу жмут все — программа записывает время каждого нажатия. Проверка кнопок и разминка перед игрой.',
  },
]

// Какие команды нажимают кнопку в выбранном режиме.
const teamHint = computed(() => {
  if (s.value.mode === 'brainring') return 'у команды одна кнопка — телефон капитана (ведущий может отдать её другому игроку)'
  if (s.value.mode === 'reaction') return 'в тесте реакции каждый игрок жмёт за себя'
  if (s.value.mode === 'jeopardy' && st.value.jFormat === 'tv') return 'нажать может любой участник команды'
  return 'тему от команды играет один игрок — его выбирает капитан'
})
// Формат «Своей игры» и зачёт не совпадают (например, после смены режима).
const formatWarning = computed(() => {
  if (s.value.mode !== 'jeopardy') return null
  if (st.value.jFormat === 'sport' && st.value.teamMode) {
    return { text: 'Спортивная игра — личный зачёт, а сейчас включена командная игра: нажатие любого игрока пойдёт в счёт команды.', fix: false }
  }
  if (st.value.jFormat === 'eq' && !st.value.teamMode) {
    return { text: '«Эрудит-квартет» — командная игра. Включите командную игру и создайте команды.', fix: true }
  }
  return null
})

const st = computed(() => s.value.settings)

function setNum(key: keyof Settings, ev: Event) {
  const v = Number((ev.target as HTMLInputElement).value)
  if (Number.isFinite(v)) void run('settings.update', { patch: { [key]: v } })
}
function setValue(key: keyof Settings, value: unknown) {
  void run('settings.update', { patch: { [key]: value } })
}

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
            Игроки могут нажать кнопку — их имя мигнёт
            <template v-if="mobile">на вкладке <button class="text-link" @click="showPlayers">«Игроки»</button>.</template>
            <template v-else>в списке слева.</template>
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
            <span class="muted"> — игроки объединяются в команды; {{ teamHint }}</span>
          </span>
        </label>
        <div v-if="s.settings.teamMode" class="row add-team">
          <input
            :value="newTeam"
            class="input"
            maxlength="32"
            placeholder="Название новой команды"
            @input="newTeam = ($event.target as HTMLInputElement).value"
            @keydown.enter="addTeam"
          />
          <button class="btn" :disabled="!newTeam.trim()" @click="addTeam"><Icon name="plus" /> Добавить</button>
        </div>
        <p v-if="formatWarning" class="warn-note">
          {{ formatWarning.text }}
          <button class="text-link" @click="toggleTeams">{{ formatWarning.fix ? 'Включить командную игру' : 'Выключить командную игру' }}</button>
        </p>
      </div>
    </section>

    <section class="card">
      <div class="step-title"><span class="num">3</span> {{ s.mode === 'reaction' ? 'Попытки' : 'Ход игры' }}</div>
      <p v-if="s.mode === 'reaction'" class="muted small sheet">
        Ведущий запускает попытку, и через случайное время у всех телефонов одновременно загорается «Жми!». Программа
        записывает время каждого нажатия; нажатие до сигнала — фальстарт. Лучшее и среднее время копятся по всем попыткам.
      </p>
      <p v-else class="muted small sheet">
        Вопросы вы читаете со своего листа — программа ведёт кнопки, время и счёт.
        {{ s.mode === 'brainring' ? '' : 'Названия тем можно вписать по ходу игры, щёлкнув по теме.' }}
      </p>
      <template v-if="s.mode === 'jeopardy'">
        <div class="shape">
          <label class="field wide">
            <span>Правила</span>
            <select class="select" :value="st.jFormat" @change="setValue('jFormat', ($event.target as HTMLSelectElement).value)">
              <option value="sport">спортивная (личный зачёт)</option>
              <option value="eq">«Эрудит-квартет» (команды)</option>
              <option value="tv">как на ТВ</option>
            </select>
          </label>
          <label v-if="st.jFormat === 'sport'" class="field">
            <span>Тем в бою</span>
            <input class="input nums" type="number" min="1" max="30" :value="st.jSportThemes" @change="setNum('jSportThemes', $event)" />
          </label>
          <label v-if="st.jFormat === 'eq'" class="field">
            <span>Тем в раунде</span>
            <input class="input nums" type="number" min="1" max="12" :value="st.jEqThemes" @change="setNum('jEqThemes', $event)" />
          </label>
          <template v-if="st.jFormat === 'tv'">
            <label class="field">
              <span>Раундов</span>
              <input class="input nums" type="number" min="1" max="20" :value="st.jRounds" @change="setNum('jRounds', $event)" />
            </label>
            <label class="field">
              <span>Тем в раунде</span>
              <input class="input nums" type="number" min="1" max="12" :value="st.jThemes" @change="setNum('jThemes', $event)" />
            </label>
          </template>
          <label class="field">
            <span>Вопросов в теме</span>
            <input class="input nums" type="number" min="1" max="10" :value="st.jQuestions" @change="setNum('jQuestions', $event)" />
          </label>
          <label v-if="st.jFormat !== 'tv'" class="field">
            <span>Стоимость</span>
            <select class="select" :value="st.jPrices" @change="setValue('jPrices', ($event.target as HTMLSelectElement).value)">
              <option value="x10">10, 20, 30…</option>
              <option value="x1">1, 2, 3…</option>
              <option value="x100">100, 200, 300…</option>
            </select>
          </label>
        </div>
        <p v-if="st.jFormat === 'sport'" class="shape-text small">
          Один бой: каждый играет за себя, темы идут по порядку, вопросы темы — подряд.
        </p>
        <p v-else-if="st.jFormat === 'eq'" class="shape-text small">
          4 раунда — <b>открытый, полуоткрытый, закрытый и личный</b>. Тему от команды играет один игрок, его выбирает
          капитан; в личном раунде один игрок играет за команду все темы.
        </p>
        <label v-else class="check">
          <input type="checkbox" :checked="st.jFinal" @change="setValue('jFinal', ($event.target as HTMLInputElement).checked)" />
          <span>Финал со ставками после раундов <span class="muted">(стоимость: 100–500 в первом раунде, 200–1000 во втором…)</span></span>
        </label>
      </template>
      <p v-else-if="s.mode === 'khamsa'" class="shape-text">
        4 раунда по 5 тем из 5 вопросов — <b>явный, полуявный, тайный, персональный</b> — и раунд <b>«Хамса»</b> на ставку.
        Стоимость: 100–500, 200–1000, 300–1500, 400–2000. Фальстарта нет — игроки могут перебить ведущего.
      </p>
      <div v-else-if="s.mode === 'reaction'" class="shape">
        <label class="check">
          <input type="checkbox" :checked="st.rRandom" @change="setValue('rRandom', ($event.target as HTMLInputElement).checked)" />
          <span>Сигнал через случайное время <span class="muted">(1,5–4 с)</span></span>
        </label>
        <label class="field">
          <span>Секунд на нажатие</span>
          <input class="input nums" type="number" min="1" max="60" :value="st.rTimeout" @change="setNum('rTimeout', $event)" />
        </label>
      </div>
      <div v-else class="shape">
        <label class="field">
          <span>Вопросов в бою</span>
          <input class="input nums" type="number" min="0" max="100" :value="st.brBattleQuestions" @change="setNum('brBattleQuestions', $event)" />
        </label>
        <label class="field">
          <span>Секунд на вопрос</span>
          <input class="input nums" type="number" min="5" max="600" :value="st.brMainTime" @change="setNum('brMainTime', $event)" />
        </label>
      </div>
      <button class="btn ghost small more" @click="openSettings">
        <Icon name="settings" /> {{ s.mode === 'reaction' ? 'Настройки' : 'Все настройки: время, штрафы, капитаны' }}
      </button>
    </section>

    <div class="start-row">
      <button class="btn primary huge" @click="start"><Icon name="play" /> {{ s.mode === 'reaction' ? 'Начать тест реакции' : 'Начать игру' }}</button>
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
  border-radius: 9px;
  background: linear-gradient(135deg, #6366f1, var(--accent-2));
  color: var(--accent-text);
  box-shadow: 0 4px 10px -4px rgba(79, 70, 229, 0.7);
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
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 8px;
  background: #fff;
  box-shadow: var(--shadow);
  cursor: zoom-in;
}
.join-text p {
  margin: 0 0 8px;
}
.url {
  font-size: 1.9rem;
  font-weight: 800;
  letter-spacing: -0.01em;
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
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.warn-note {
  margin: 0;
  padding: 8px 12px;
  border-radius: 12px;
  background: var(--warn-soft);
  color: #92400e;
  font-size: 0.9rem;
}
.mode {
  text-align: left;
  padding: 16px;
  border-radius: 16px;
  border: 1.5px solid var(--line);
  background: var(--panel-2);
  cursor: pointer;
  color: var(--text);
  transition:
    border-color 0.15s,
    background 0.15s,
    box-shadow 0.15s,
    transform 0.15s;
}
.mode:hover:not(.on) {
  border-color: var(--line-2);
  background: var(--panel);
  transform: translateY(-1px);
  box-shadow: var(--shadow);
}
.mode.on {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: var(--ring);
}
.mode-title {
  font-size: 1.25rem;
  font-weight: 800;
  letter-spacing: -0.01em;
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
.sheet {
  margin: -4px 0 12px;
}
.shape {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px 12px;
  margin-bottom: 10px;
}
.shape .field.wide {
  grid-column: span 2;
}
.shape-text {
  margin: 0 0 10px;
}
.shape-text.small {
  font-size: 0.9rem;
  color: var(--muted);
}
.more {
  margin-top: 4px;
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
@media (max-width: 1100px) {
  .modes {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 760px) {
  .join {
    flex-direction: column;
    align-items: stretch;
    gap: 14px;
  }
  .qr-btn {
    align-self: center;
    width: 150px;
  }
  .url {
    font-size: 1.5rem;
  }
  .url.code {
    font-size: 2rem;
  }
  .modes {
    grid-template-columns: 1fr;
  }
  .mode {
    padding: 12px 14px;
  }
  .start-row .btn,
  .join-text .row .btn {
    width: 100%;
    white-space: normal;
  }
}
</style>
