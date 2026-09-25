<script setup lang="ts">
import { computed } from 'vue'
import type { GameState } from '../../lib/types'
import { plural, textOn } from '../../lib/util'
import QrCode from '../../components/QrCode.vue'
import { formatCode } from '../../lib/room'

const props = defineProps<{ state: GameState; flash: Record<string, number> }>()

const title = computed(() => (props.state.mode === 'brainring' ? 'Брейн-ринг' : 'Своя игра'))
const url = computed(() => props.state.joinUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''))
// Сервер комнат: игроки вводят код на главной странице сайта.
const code = computed(() => (props.state.room?.mode === 'rooms' ? props.state.room.code : null))
const site = computed(() => {
  try {
    return new URL(props.state.joinUrl).host
  } catch {
    return url.value
  }
})
// Адрес в локальной сети — значит, телефоны должны быть в той же Wi-Fi сети.
const lan = computed(() => /^http:\/\/\d+\.\d+\.\d+\.\d+/.test(props.state.joinUrl))
const teamMode = computed(() => props.state.settings.teamMode)
const playersByTeam = computed(() =>
  props.state.teams.map((t) => ({ team: t, players: props.state.players.filter((p) => p.teamId === t.id) })),
)
const loners = computed(() => (teamMode.value ? props.state.players.filter((p) => !p.teamId) : props.state.players))
const count = computed(() => props.state.players.length)
</script>

<template>
  <div class="lobby">
    <h1 class="title">{{ title }}</h1>
    <div class="join">
      <QrCode :text="state.joinUrl" class="qr" />
      <div v-if="code" class="how">
        <p class="step">{{ lan ? '1. Подключитесь к той же Wi-Fi сети и откройте' : '1. Откройте на телефоне' }}</p>
        <p class="url">{{ site }}</p>
        <p class="step">2. Введите код комнаты</p>
        <p class="url code nums">{{ formatCode(code) }}</p>
        <p class="step">3. Или просто наведите камеру на QR-код</p>
      </div>
      <div v-else class="how">
        <p class="step">1. Подключитесь к <b>той же Wi-Fi сети</b></p>
        <p class="step">2. Наведите камеру на QR-код или откройте в браузере:</p>
        <p class="url">{{ url }}</p>
        <p class="step">3. Введите имя — и телефон станет вашей кнопкой</p>
      </div>
    </div>

    <div class="players">
      <p class="count">
        {{ count ? `${count} ${plural(count, 'игрок', 'игрока', 'игроков')} в игре` : 'Ждём игроков…' }}
        <span v-if="count" class="muted"> · нажмите кнопку на телефоне, чтобы проверить её</span>
      </p>
      <div v-if="teamMode" class="teams">
        <div
          v-for="{ team, players } in playersByTeam"
          :key="team.id"
          class="team"
          :style="{ '--c': team.color, '--t': textOn(team.color) }"
        >
          <div class="team-name">{{ team.name }}</div>
          <div class="members">
            <span
              v-for="p in players"
              :key="`${p.id}-${flash[p.id] ?? 0}`"
              class="member"
              :class="{ off: !p.connected, flash: !!flash[p.id] }"
              >{{ p.name }}</span
            >
            <span v-if="!players.length" class="muted">пока никого</span>
          </div>
        </div>
      </div>
      <div class="chips">
        <span
          v-for="p in loners"
          :key="`${p.id}-${flash[p.id] ?? 0}`"
          class="player-chip"
          :class="{ off: !p.connected, flash: !!flash[p.id] }"
          :style="{ '--c': p.color, '--t': textOn(p.color) }"
          >{{ p.name }}</span
        >
      </div>
    </div>
  </div>
</template>

<style scoped>
.lobby {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3vh;
  padding: 4vh 4vw;
}
.title {
  font-size: clamp(2.5rem, 7vw, 6.5rem);
  margin: 0;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  text-shadow: 0 6px 30px rgba(255, 200, 61, 0.35);
}
.join {
  display: flex;
  align-items: center;
  gap: 4vw;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 24px;
  padding: 3vh 3vw;
}
.qr {
  width: clamp(180px, 26vh, 340px);
}
.how {
  display: flex;
  flex-direction: column;
  gap: 1.2vh;
  font-size: clamp(1rem, 1.8vw, 1.7rem);
}
.step {
  margin: 0;
}
.url {
  margin: 0;
  font-size: clamp(1.6rem, 3.4vw, 3.4rem);
  font-weight: 900;
  color: var(--accent);
  letter-spacing: 0.02em;
}
.url.code {
  font-size: clamp(2.4rem, 6vw, 5.5rem);
  letter-spacing: 0.1em;
  line-height: 1.05;
}
.players {
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2vh;
}
.count {
  margin: 0;
  font-size: clamp(1rem, 1.8vw, 1.6rem);
  font-weight: 700;
}
.chips,
.teams {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  justify-content: center;
}
.player-chip {
  padding: 0.35em 0.9em;
  border-radius: 99px;
  background: var(--c);
  color: var(--t);
  font-weight: 800;
  font-size: clamp(1rem, 1.9vw, 1.8rem);
  animation: pop 0.35s ease;
}
.team {
  min-width: 220px;
  border-radius: 16px;
  background: var(--panel);
  border-top: 6px solid var(--c);
  padding: 12px 16px;
}
.team-name {
  font-weight: 900;
  font-size: clamp(1.1rem, 2vw, 2rem);
  color: var(--c);
  filter: brightness(1.3);
}
.members {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.member {
  padding: 0.2em 0.7em;
  border-radius: 99px;
  background: var(--panel-3);
  font-weight: 700;
}
.off {
  opacity: 0.4;
}
.flash {
  animation: flash 0.7s ease;
}
</style>
