<script setup lang="ts">
// Настройки игры. Каждое изменение сразу отправляется на сервер.
import { computed } from 'vue'
import type { Settings } from '../../lib/types'
import Icon from '../../components/Icon.vue'
import { useHost } from './ctx'

const { state, run } = useHost()
const st = computed(() => state.value!.settings)

function set<K extends keyof Settings>(key: K, value: Settings[K]) {
  void run('settings.update', { patch: { [key]: value } })
}
function num(key: keyof Settings, ev: Event) {
  const v = Number((ev.target as HTMLInputElement).value)
  if (Number.isFinite(v)) set(key, v as never)
}
function bool(key: keyof Settings, ev: Event) {
  set(key, (ev.target as HTMLInputElement).checked as never)
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
    <section>
      <h4>Общие</h4>
      <label class="check">
        <input type="checkbox" :checked="st.teamMode" @change="bool('teamMode', $event)" />
        <span>Командная игра <span class="muted">(лучше включать до начала игры)</span></span>
      </label>
      <label class="check">
        <input type="checkbox" :checked="st.allowPlayerTeams" @change="bool('allowPlayerTeams', $event)" />
        Игроки могут сами создавать команды
      </label>
      <label class="check">
        <input type="checkbox" :checked="st.showQuestionOnPhones" @change="bool('showQuestionOnPhones', $event)" />
        Показывать текст вопроса на телефонах игроков
      </label>
      <label class="check">
        <input type="checkbox" :checked="st.hideAnswerOnHost" @change="bool('hideAnswerOnHost', $event)" />
        Скрывать ответ на панели ведущего (виден при наведении) — если игроки видят ваш экран
      </label>
    </section>

    <section>
      <h4>Своя игра</h4>
      <div class="grid">
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
        <label class="field">
          <span>Время на ответ в финале, с</span>
          <input class="input" type="number" min="5" max="600" :value="st.jFinalTime" @change="num('jFinalTime', $event)" />
        </label>
      </div>
      <label class="check">
        <input type="checkbox" :checked="st.jWrongPenalty" @change="bool('jWrongPenalty', $event)" />
        Неверный ответ отнимает стоимость вопроса
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
    </section>

    <section>
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
          <span>Бой до стольких очков (0 — без ограничения)</span>
          <input class="input" type="number" min="0" max="1000" :value="st.brTargetScore" @change="num('brTargetScore', $event)" />
        </label>
        <label class="field">
          <span>Стоимость вопроса</span>
          <input class="input" type="number" min="1" max="1000" :value="st.brQuestionValue" @change="num('brQuestionValue', $event)" />
        </label>
      </div>
      <label class="check">
        <input type="checkbox" :checked="st.brCarryOver" @change="bool('brCarryOver', $event)" />
        Если вопрос не взят — его очки переходят на следующий вопрос
      </label>
      <label class="check">
        <input type="checkbox" :checked="st.brAutoShowQuestion" @change="bool('brAutoShowQuestion', $event)" />
        Сразу показывать текст вопроса на экране (иначе — по кнопке)
      </label>
      <label class="check">
        <input type="checkbox" :checked="st.brShowAnswer" @change="bool('brShowAnswer', $event)" />
        Показывать правильный ответ на экране после вопроса
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
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
h4 {
  margin: 0;
  color: var(--accent);
  font-size: 1rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 14px;
}
@media (max-width: 640px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
