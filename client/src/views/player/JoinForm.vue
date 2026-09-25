<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { GameState } from '../../lib/types'
import { textOn } from '../../lib/util'
import { formatCode, room } from '../../lib/room'
import { MODE_TITLE } from '../../lib/rules'

const props = defineProps<{
  state: GameState | null
  defaultName: string
  error: string
  canTakeover: boolean
  takeoverName?: string
  busy: boolean
  kicked: boolean
}>()
const emit = defineEmits<{
  join: [payload: { name: string; teamId: string | null; newTeamName: string; takeover: boolean }]
}>()

const name = ref(props.defaultName)
const teamId = ref<string | null>(null)
const newTeam = ref('')
const teamMode = computed(() => !!props.state?.settings.teamMode)
const allowNewTeam = computed(() => !!props.state?.settings.allowPlayerTeams)
const teams = computed(() => props.state?.teams ?? [])
const title = computed(() => (props.state ? MODE_TITLE[props.state.mode] : 'Своя игра'))

watch(teams, (list) => {
  if (teamId.value && !list.some((t) => t.id === teamId.value)) teamId.value = null
})

const canSubmit = computed(() => {
  if (!name.value.trim() || props.busy) return false
  if (teamMode.value && !teamId.value && !newTeam.value.trim()) return false
  return true
})

function submit(takeover = false) {
  if (!takeover && !canSubmit.value) return
  emit('join', {
    name: name.value.trim(),
    teamId: teamId.value,
    newTeamName: teamId.value ? '' : newTeam.value.trim(),
    takeover,
  })
}
</script>

<template>
  <form class="join" @submit.prevent="submit(false)">
    <div class="logo">
      <div class="logo-buzz" />
      <h1>{{ title }}</h1>
      <p class="muted">{{ room.code ? `Комната ${formatCode(room.code)}` : 'Подключение к игре' }}</p>
    </div>

    <p v-if="kicked" class="notice">Ведущий удалил вас из игры. Можно войти снова.</p>
    <p v-if="state?.settings.joinLocked" class="notice">
      Ведущий закрыл вход для новых игроков. Если вы уже играли — введите своё прежнее имя.
    </p>

    <label class="field">
      <span>Ваше имя</span>
      <input
        v-model="name"
        class="input big"
        maxlength="24"
        autocomplete="nickname"
        autocapitalize="words"
        enterkeyhint="go"
        placeholder="Например, Аня"
      />
    </label>

    <div v-if="teamMode" class="field">
      <span>Команда</span>
      <div class="teams">
        <button
          v-for="t in teams"
          :key="t.id"
          type="button"
          class="team"
          :class="{ on: teamId === t.id }"
          :style="{ '--c': t.color, '--t': textOn(t.color) }"
          @click="teamId = teamId === t.id ? null : t.id"
        >
          {{ t.name }}
        </button>
      </div>
      <input
        v-if="allowNewTeam && !teamId"
        v-model="newTeam"
        class="input"
        maxlength="32"
        :placeholder="teams.length ? 'или новая команда' : 'Название команды'"
      />
      <p v-if="!teams.length && !allowNewTeam" class="muted small">Ведущий ещё не создал команды — подождите.</p>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <button v-if="canTakeover" type="button" class="btn ok big block" :disabled="busy" @click="submit(true)">
      Это я — продолжить за «{{ takeoverName || name.trim() }}»
    </button>

    <button type="submit" class="btn primary big block" :disabled="!canSubmit">
      {{ busy ? 'Подключаюсь…' : 'Войти в игру' }}
    </button>
    <p class="muted small center-text">Держите телефон включённым — это ваша кнопка.</p>
  </form>
</template>

<style scoped>
.join {
  width: 100%;
  max-width: 420px;
  margin: 0 auto;
  padding: 24px 18px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.logo {
  text-align: center;
  margin-bottom: 4px;
}
.logo h1 {
  margin: 10px 0 0;
  font-size: 2rem;
  color: var(--accent);
}
.logo p {
  margin: 4px 0 0;
}
.logo-buzz {
  width: 72px;
  height: 72px;
  margin: 0 auto;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 35%, #ff7676, #c21c1c);
  box-shadow:
    0 6px 0 #7a0f0f,
    0 0 0 8px rgba(255, 200, 61, 0.9);
}
.input.big {
  font-size: 1.2rem;
  padding: 0.7em 0.9em;
}
.teams {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.team {
  padding: 0.55em 1em;
  border-radius: 99px;
  border: 2px solid var(--c);
  background: transparent;
  color: var(--text);
  font-weight: 700;
  cursor: pointer;
}
.team.on {
  background: var(--c);
  color: var(--t);
}
.error {
  margin: 0;
  color: #ff8a8a;
  font-weight: 600;
}
.notice {
  margin: 0;
  padding: 0.6em 0.8em;
  border-radius: 10px;
  background: rgba(245, 158, 11, 0.15);
  color: #ffd08a;
}
.small {
  font-size: 0.85rem;
  margin: 0;
}
.center-text {
  text-align: center;
}
</style>
