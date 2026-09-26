<script setup lang="ts">
// Настройки игры. Каждое изменение сразу отправляется на сервер.
// Разделены на вкладки: общие и по каждой игре; открываются на вкладке текущей игры.
import { computed, ref } from 'vue'
import type { Mode, Settings } from '../../lib/types'
import { api } from '../../lib/api'
import { forgetRoom, formatCode } from '../../lib/room'
import Icon from '../../components/Icon.vue'
import { useHost } from './ctx'

const { state, run, toast } = useHost()
const st = computed(() => state.value!.settings)
const roomCode = computed(() => (state.value?.room?.mode === 'rooms' ? state.value.room.code : null))

type Tab = 'common' | Mode
const TABS: { id: Tab; title: string }[] = [
  { id: 'common', title: 'Общие' },
  { id: 'jeopardy', title: 'Своя игра' },
  { id: 'khamsa', title: 'Хамса' },
  { id: 'brainring', title: 'Брейн-ринг' },
  { id: 'reaction', title: 'Реакция' },
]
const tab = ref<Tab>(state.value?.mode ?? 'common')

async function closeRoom() {
  const code = roomCode.value
  if (!code) return
  if (!confirm(`Закрыть комнату ${formatCode(code)}? Игра и счёт будут удалены, все устройства отключатся.`)) return
  try {
    await api('DELETE', '')
    forgetRoom(code)
    location.href = '/'
  } catch (e) {
    toast((e as Error).message, 'err')
  }
}

function set<K extends keyof Settings>(key: K, value: Settings[K]) {
  void run('settings.update', { patch: { [key]: value } })
}
function num(key: keyof Settings, ev: Event) {
  const v = Number((ev.target as HTMLInputElement).value.replace(',', '.'))
  if (Number.isFinite(v)) set(key, v as never)
}
function bool(key: keyof Settings, ev: Event) {
  set(key, (ev.target as HTMLInputElement).checked as never)
}

async function resetReaction() {
  if (!confirm('Сбросить результаты теста реакции?')) return
  await run('r.reset')
}

async function newGame(keepPlayers: boolean) {
  const text = keepPlayers
    ? 'Начать новую игру? Счёт и прогресс обнулятся, игроки останутся.'
    : 'Сбросить всё? Будут удалены все игроки, команды и счёт.'
  if (!confirm(text)) return
  await run('game.reset', { keepPlayers })
}
</script>

<template>
  <div class="settings">
    <div class="tabs" role="tablist">
      <button
        v-for="t in TABS"
        :key="t.id"
        class="tab"
        :class="{ on: tab === t.id, current: t.id === state?.mode }"
        role="tab"
        :aria-selected="tab === t.id"
        @click="tab = t.id"
      >
        {{ t.title }}
      </button>
    </div>

    <template v-if="tab === 'common'">
    <section>
      <h4>Команды</h4>
      <label class="check">
        <input type="checkbox" :checked="st.teamMode" @change="bool('teamMode', $event)" />
        <span>Командная игра <span class="muted">(лучше включать до начала игры)</span></span>
      </label>
      <label class="check">
        <input type="checkbox" :checked="st.allowPlayerTeams" @change="bool('allowPlayerTeams', $event)" />
        Игроки могут сами создавать команды
      </label>
    </section>

    <section>
      <h4>Подключение игроков</h4>
      <label class="check">
        <input type="checkbox" :checked="st.onlineMode" @change="bool('onlineMode', $event)" />
        <span>
          Игроки в разных местах (игра через интернет)
          <span class="muted">
            — кнопки загораются у всех одновременно через полсекунды после команды, допуски на задержку связи больше
          </span>
        </span>
      </label>
      <label class="check">
        <input type="checkbox" :checked="st.joinLocked" @change="bool('joinLocked', $event)" />
        <span>Закрыть вход для новых игроков <span class="muted">(вернуться под своим именем можно)</span></span>
      </label>
    </section>

    <section>
      <h4>Игра</h4>
      <div class="row wrap">
        <button class="btn" @click="run('game.lobby')"><Icon name="home" /> Вернуться в лобби</button>
        <button class="btn" @click="newGame(true)"><Icon name="refresh" /> Новая игра (игроки остаются)</button>
        <button class="btn bad" @click="newGame(false)"><Icon name="trash" /> Сбросить всё</button>
      </div>
    </section>

    <section v-if="roomCode">
      <h4>Комната {{ formatCode(roomCode) }}</h4>
      <p class="muted note">Комната удаляется сама, если в ней долго никого нет.</p>
      <div class="row wrap">
        <button class="btn bad" @click="closeRoom"><Icon name="logout" /> Закрыть комнату</button>
      </div>
    </section>
    </template>

    <section v-else-if="tab === 'jeopardy'">
      <h4>Своя игра</h4>
      <label class="field">
        <span>Правила</span>
        <select class="select" :value="st.jFormat" @change="set('jFormat', ($event.target as HTMLSelectElement).value as Settings['jFormat'])">
          <option value="sport">Спортивная: личный зачёт, один бой из 10 тем по 5 вопросов подряд</option>
          <option value="eq">«Эрудит-квартет»: команды, 4 раунда — открытый, полуоткрытый, закрытый, личный</option>
          <option value="tv">Как в телепередаче: табло, кот в мешке, аукцион, финал со ставками</option>
        </select>
      </label>
      <p class="muted note">
        {{
          st.jFormat === 'sport'
            ? 'Спортивная игра — личный зачёт: при выборе этих правил командная игра выключается.'
            : st.jFormat === 'eq'
              ? '«Эрудит-квартет» — командная игра: при выборе этих правил командная игра включается.'
              : 'Играть можно и лично, и командами (командная игра — на вкладке «Общие»).'
        }}
      </p>
      <div class="grid">
        <label v-if="st.jFormat === 'sport'" class="field">
          <span>Тем в бою</span>
          <input class="input" type="number" min="1" max="30" :value="st.jSportThemes" @change="num('jSportThemes', $event)" />
        </label>
        <label v-if="st.jFormat === 'eq'" class="field">
          <span>Тем в каждом раунде</span>
          <input class="input" type="number" min="1" max="12" :value="st.jEqThemes" @change="num('jEqThemes', $event)" />
        </label>
        <template v-if="st.jFormat === 'tv'">
          <label class="field">
            <span>Раундов</span>
            <input class="input" type="number" min="1" max="20" :value="st.jRounds" @change="num('jRounds', $event)" />
          </label>
          <label class="field">
            <span>Тем в раунде</span>
            <input class="input" type="number" min="1" max="12" :value="st.jThemes" @change="num('jThemes', $event)" />
          </label>
        </template>
        <label class="field">
          <span>Вопросов в теме</span>
          <input class="input" type="number" min="1" max="10" :value="st.jQuestions" @change="num('jQuestions', $event)" />
        </label>
        <label v-if="st.jFormat !== 'tv'" class="field">
          <span>Стоимость вопросов темы</span>
          <select class="select" :value="st.jPrices" @change="set('jPrices', ($event.target as HTMLSelectElement).value as Settings['jPrices'])">
            <option value="x10">10, 20, 30, 40, 50</option>
            <option value="x1">1, 2, 3, 4, 5</option>
            <option value="x100">100, 200, 300, 400, 500</option>
          </select>
        </label>
        <template v-if="st.jFormat === 'eq'">
          <label class="field">
            <span>Кто от команды играет тему</span>
            <select class="select" :value="st.jTableMode" @change="set('jTableMode', ($event.target as HTMLSelectElement).value as Settings['jTableMode'])">
              <option value="one">один игрок — его выбирает капитан</option>
              <option value="team">вся команда</option>
            </select>
          </label>
          <label class="field">
            <span>Время капитанам на расстановку (открытый, закрытый, личный раунды), с</span>
            <input class="input" type="number" min="0" max="600" :value="st.jAssignRoundTime" @change="num('jAssignRoundTime', $event)" />
          </label>
          <label class="field">
            <span>Время капитану на выбор игрока (полуоткрытый раунд), с</span>
            <input class="input" type="number" min="0" max="600" :value="st.jAssignThemeTime" @change="num('jAssignThemeTime', $event)" />
          </label>
        </template>
        <label class="field">
          <span>Время на нажатие кнопки, с (0 — без ограничения)</span>
          <input class="input" type="number" min="0" max="600" :value="st.jBuzzTime" @change="num('jBuzzTime', $event)" />
        </label>
        <label class="field">
          <span>Время на ответ, с (0 — без ограничения)</span>
          <input class="input" type="number" min="0" max="600" :value="st.jAnswerTime" @change="num('jAnswerTime', $event)" />
        </label>
        <label class="field">
          <span>Блокировка за раннее нажатие, мс (0 — нет)</span>
          <input class="input" type="number" min="0" max="10000" step="100" :value="st.jEarlyLockMs" @change="num('jEarlyLockMs', $event)" />
        </label>
        <template v-if="st.jFormat === 'tv'">
          <label class="field">
            <span>Время на ставку в финале, с (0 — без ограничения)</span>
            <input class="input" type="number" min="0" max="600" :value="st.jBetTime" @change="num('jBetTime', $event)" />
          </label>
          <label class="field">
            <span>Время на ответ в финале, с</span>
            <input class="input" type="number" min="5" max="600" :value="st.jFinalTime" @change="num('jFinalTime', $event)" />
          </label>
        </template>
      </div>
      <label class="check">
        <input type="checkbox" :checked="st.jWrongPenalty" @change="bool('jWrongPenalty', $event)" />
        Неверный ответ отнимает стоимость вопроса
      </label>
      <template v-if="st.jFormat !== 'tv'">
        <label v-if="st.jFormat === 'eq'" class="check">
          <input type="checkbox" :checked="st.jOnePerPlayer" @change="bool('jOnePerPlayer', $event)" />
          Каждый игрок команды играет не больше одной темы за раунд (если игроков хватает)
        </label>
        <label class="check">
          <input type="checkbox" :checked="st.jSpecials" @change="bool('jSpecials', $event)" />
          Кот в мешке, аукцион и вопрос без риска (ведущий отмечает их сам, когда дойдёт до них в листе)
        </label>
      </template>
      <template v-else>
        <label class="check">
          <input type="checkbox" :checked="st.jFinal" @change="bool('jFinal', $event)" />
          Финал со ставками после раундов
        </label>
        <label class="check">
          <input type="checkbox" :checked="st.phoneSelect" @change="bool('phoneSelect', $event)" />
          Выбирающий может выбрать вопрос со своего телефона
        </label>
        <label class="check">
          <input type="checkbox" :checked="st.jFinalOnlyPositive" @change="bool('jFinalOnlyPositive', $event)" />
          В финал проходят только игроки с положительным счётом
        </label>
        <label class="check">
          <input
            type="checkbox"
            :checked="st.jNewRoundChooser === 'lowest'"
            @change="set('jNewRoundChooser', ($event.target as HTMLInputElement).checked ? 'lowest' : 'keep')"
          />
          Новый раунд начинает игрок с наименьшим счётом
        </label>
        <p class="muted note">Ставку в финале делают один раз — изменить её может только ведущий.</p>
      </template>
    </section>

    <section v-else-if="tab === 'khamsa'">
      <h4>Хамса</h4>
      <div class="grid">
        <label class="field">
          <span>Стоимость вопроса в первом раунде (во втором — вдвое больше и т.д.)</span>
          <input class="input" type="number" min="1" max="1000" :value="st.hPriceBase" @change="num('hPriceBase', $event)" />
        </label>
        <label class="field">
          <span>Время на обдумывание, когда вопрос дочитан, с (0 — без ограничения)</span>
          <input class="input" type="number" min="0" max="600" :value="st.hBuzzTime" @change="num('hBuzzTime', $event)" />
        </label>
        <label class="field">
          <span>Время на ответ после нажатия, с</span>
          <input class="input" type="number" min="0" max="600" :value="st.hAnswerTime" @change="num('hAnswerTime', $event)" />
        </label>
        <label class="field">
          <span>Время следующему игроку после неверного ответа, с</span>
          <input class="input" type="number" min="0" max="600" :value="st.hNextTime" @change="num('hNextTime', $event)" />
        </label>
        <label class="field">
          <span>Время капитанам на расстановку (явный и тайный раунды, выбор игрока персонального раунда), с</span>
          <input class="input" type="number" min="0" max="600" :value="st.hAssignRoundTime" @change="num('hAssignRoundTime', $event)" />
        </label>
        <label class="field">
          <span>Время капитану на выбор игрока (полуявный раунд), с</span>
          <input class="input" type="number" min="0" max="600" :value="st.hAssignThemeTime" @change="num('hAssignThemeTime', $event)" />
        </label>
        <label class="field">
          <span>Время капитану на ставку в раунде «Хамса», с (0 — без ограничения)</span>
          <input class="input" type="number" min="0" max="600" :value="st.hBetTime" @change="num('hBetTime', $event)" />
        </label>
        <label class="field">
          <span>Время на обсуждение и ответ в раунде «Хамса», с</span>
          <input class="input" type="number" min="5" max="600" :value="st.hFinalTime" @change="num('hFinalTime', $event)" />
        </label>
      </div>
      <label class="check">
        <input type="checkbox" :checked="st.hQueue" @change="bool('hQueue', $event)" />
        После неверного ответа отвечает следующий, кто нажал (иначе кнопки открываются снова)
      </label>
      <label class="check">
        <input type="checkbox" :checked="st.hWrongPenalty" @change="bool('hWrongPenalty', $event)" />
        Неверный ответ отнимает стоимость вопроса
      </label>
      <p class="muted note">
        Фальстарта нет: кнопки открыты с начала вопроса, игрок может перебить ведущего. Когда вы дочитали вопрос,
        нажмите «Вопрос прочитан» — пойдёт время на обдумывание. Раунды идут по правилам: явный, полуявный, тайный,
        персональный и «Хамса»; ставку капитан делает один раз.
      </p>
    </section>

    <section v-else-if="tab === 'brainring'">
      <h4>Брейн-ринг</h4>
      <div class="grid">
        <label class="field">
          <span>Время на вопрос, с</span>
          <input class="input" type="number" min="5" max="600" :value="st.brMainTime" @change="num('brMainTime', $event)" />
        </label>
        <label class="field">
          <span>После неверного ответа соперникам</span>
          <select class="select" :value="st.brAfterWrongMode" @change="set('brAfterWrongMode', ($event.target as HTMLSelectElement).value as Settings['brAfterWrongMode'])">
            <option value="atLeast">оставшееся время, но не меньше N с</option>
            <option value="fixed">ровно N секунд</option>
            <option value="remaining">только оставшееся время</option>
          </select>
        </label>
        <label class="field">
          <span>N — секунд после неверного ответа</span>
          <input class="input" type="number" min="0" max="600" :value="st.brAfterWrongTime" @change="num('brAfterWrongTime', $event)" />
        </label>
        <label class="field">
          <span>Время на ответ после нажатия, с (0 — не ограничено)</span>
          <input class="input" type="number" min="0" max="600" :value="st.brAnswerTime" @change="num('brAnswerTime', $event)" />
        </label>
        <label class="field">
          <span>Вопросов в бою (0 — без ограничения)</span>
          <input class="input" type="number" min="0" max="100" :value="st.brBattleQuestions" @change="num('brBattleQuestions', $event)" />
        </label>
        <label class="field">
          <span>Бой до стольких очков (0 — только по числу вопросов)</span>
          <input class="input" type="number" min="0" max="1000" :value="st.brTargetScore" @change="num('brTargetScore', $event)" />
        </label>
        <label class="field">
          <span>Если после всех вопросов боя ничья</span>
          <select class="select" :value="st.brTieMode" @change="set('brTieMode', ($event.target as HTMLSelectElement).value as Settings['brTieMode'])">
            <option value="extra">дополнительный вопрос до первого верного ответа</option>
            <option value="draw">ничья</option>
            <option value="ask">решает ведущий</option>
          </select>
        </label>
        <label class="field">
          <span>Стоимость вопроса в бою</span>
          <input class="input" type="number" min="1" max="1000" :value="st.brQuestionValue" @change="num('brQuestionValue', $event)" />
        </label>
      </div>
      <label class="check">
        <input type="checkbox" :checked="st.brOneButton" @change="bool('brOneButton', $event)" />
        <span>
          Одна кнопка на команду
          <span class="muted">— нажимает капитан или игрок, которому ведущий отдал кнопку (меню «⋯» у игрока в списке)</span>
        </span>
      </label>
      <label class="check">
        <input type="checkbox" :checked="st.brCarryOver" @change="bool('brCarryOver', $event)" />
        Если вопрос не взят — его очки переходят на следующий вопрос
      </label>

      <h4 class="sub-h">Турнирная таблица</h4>
      <div class="grid">
        <label class="field">
          <span>Счёт турнира</span>
          <select class="select" :value="st.brTotal" @change="set('brTotal', ($event.target as HTMLSelectElement).value as Settings['brTotal'])">
            <option value="sum">сквозной: взятые вопросы + очки за победы</option>
            <option value="wins">только очки за победы и ничьи</option>
          </select>
        </label>
        <label v-if="st.brTotal === 'sum'" class="field">
          <span>Очков за каждый взятый вопрос</span>
          <input
            class="input"
            type="number"
            min="0"
            max="100"
            step="0.1"
            inputmode="decimal"
            :value="st.brTakenPoints"
            @change="num('brTakenPoints', $event)"
          />
        </label>
        <label class="field">
          <span>Очки за победу в бою</span>
          <input class="input" type="number" min="0" max="100" step="0.5" :value="st.brWinPoints" @change="num('brWinPoints', $event)" />
        </label>
        <label class="field">
          <span>Очки за ничью</span>
          <input class="input" type="number" min="0" max="100" step="0.5" :value="st.brDrawPoints" @change="num('brDrawPoints', $event)" />
        </label>
      </div>
      <p class="muted note">
        <template v-if="st.brTotal === 'sum'">
          <b>Сквозной счёт:</b> в таблицу идут все взятые в боях вопросы (по {{ st.brTakenPoints.toLocaleString('ru-RU') }} за вопрос)
          плюс очки за победы и ничьи. Проигравшая команда тоже получает очки за свои вопросы, поэтому важен каждый вопрос.
        </template>
        <template v-else>
          <b>Только победы:</b> очки в таблицу дают лишь победы и ничьи, а взятые вопросы видны в таблице и решают, кто выше,
          только при равенстве очков (затем — разница взятых и отданных вопросов).
        </template>
      </p>
    </section>

    <section v-else>
      <h4>Тест реакции</h4>
      <label class="check">
        <input type="checkbox" :checked="st.rRandom" @change="bool('rRandom', $event)" />
        <span>Сигнал через случайное время <span class="muted">(1,5–4 с) — момент нельзя угадать</span></span>
      </label>
      <div class="grid">
        <label class="field">
          <span>Сколько секунд после сигнала ждать нажатий</span>
          <input class="input" type="number" min="1" max="60" :value="st.rTimeout" @change="num('rTimeout', $event)" />
        </label>
      </div>
      <p class="muted note">
        Время каждого нажатия считается от момента, когда «Жми!» загорелось на телефоне игрока, с поправкой на задержку
        Wi-Fi. Нажатие до сигнала — фальстарт этой попытки.
      </p>
      <div class="row wrap">
        <button class="btn" :disabled="!state?.reaction?.attempts" @click="resetReaction"><Icon name="trash" /> Сбросить результаты</button>
      </div>
    </section>
  </div>
</template>
<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.tabs {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(max-content, 1fr);
  overflow-x: auto;
  scrollbar-width: none;
  gap: 2px;
  height: var(--h-md);
  padding: 3px;
  border-radius: 12px;
  background: var(--panel-3);
  position: sticky;
  top: 0;
  z-index: 1;
  box-shadow: 0 0 0 6px var(--panel);
}
.tabs::-webkit-scrollbar {
  display: none;
}
.tab {
  position: relative;
  padding: 0 0.7em;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
}
.tab:hover:not(.on) {
  color: var(--text);
}
.tab.on {
  background: var(--panel);
  color: var(--accent);
  box-shadow: var(--shadow-sm);
}
/* Точка у вкладки игры, которая сейчас выбрана. */
.tab.current::after {
  content: '';
  position: absolute;
  top: 6px;
  right: 8px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}
section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 16px;
  background: var(--panel-2);
  border: 1px solid var(--line);
}
h4.sub-h {
  margin-top: 6px;
}
h4 {
  margin: 0;
  color: var(--accent);
  font-size: 0.9rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.07em;
}
.note {
  margin: 0;
  font-size: 0.9rem;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 14px;
  align-items: end;
}
@media (max-width: 640px) {
  .grid {
    grid-template-columns: 1fr;
  }
  /* Пять вкладок в строку не помещаются — переносим на вторую строку. */
  .tabs {
    display: flex;
    flex-wrap: wrap;
    height: auto;
    overflow: visible;
  }
  .tab {
    flex: 1 1 auto;
    min-height: calc(var(--h-md) - 6px);
    font-size: 0.88rem;
  }
  .tab.current::after {
    top: 4px;
    right: 4px;
  }
}
</style>
