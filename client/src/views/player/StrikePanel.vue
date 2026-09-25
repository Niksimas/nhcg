<script setup lang="ts">
// «Хамса», четвёртый раунд, на телефоне: команды по очереди убирают темы, пока не останется одна.
// Убирает капитан (или игрок раунда) той команды, чья очередь: сначала выбрать тему, потом подтвердить.
import { ref, watch } from 'vue'
import type { JBoardTheme } from '../../lib/types'

const props = defineProps<{
  board: JBoardTheme[]
  canStrike: boolean
  // очередь команды игрока, но убирает капитан или игрок раунда
  myTurn: boolean
  current: string
  isLeader: boolean
  busy: boolean
}>()
const emit = defineEmits<{ strike: [index: number] }>()

const picked = ref<number | null>(null)
watch(
  () => [props.canStrike, props.board.map((t) => t.struck).join()],
  () => (picked.value = null),
)

function pick(i: number) {
  if (!props.canStrike || props.board[i]?.struck) return
  picked.value = picked.value === i ? null : i
}
</script>

<template>
  <div class="strike">
    <div class="title">
      {{ canStrike ? 'Ваша очередь — уберите тему' : myTurn ? 'Тему убирает ваш капитан' : `Тему убирает: ${current}` }}
    </div>
    <p class="muted small">
      Останется одна тема — её сыграют игроки, которых выбрали капитаны.
      <b v-if="isLeader">От вашей команды играете вы.</b>
    </p>
    <div class="themes">
      <button
        v-for="(t, i) in board"
        :key="i"
        class="theme"
        :class="{ struck: t.struck, picked: picked === i, can: canStrike && !t.struck }"
        :disabled="!canStrike || t.struck || busy"
        @click="pick(i)"
      >
        {{ t.name ?? `Тема ${i + 1}` }}
      </button>
    </div>
    <button v-if="canStrike" class="btn bad big block" :disabled="picked === null || busy" @click="picked !== null && emit('strike', picked)">
      {{ picked === null ? 'Выберите тему' : `Убрать «${board[picked]?.name ?? `Тема ${picked + 1}`}»` }}
    </button>
  </div>
</template>

<style scoped>
.strike {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(520px, 100%);
  margin: 0 auto;
  padding: 4px 4px 12px;
}
.title {
  font-size: 1.3rem;
  font-weight: 900;
  text-align: center;
}
.small {
  font-size: 0.85rem;
  margin: 0;
  text-align: center;
}
.themes {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.theme {
  padding: 12px 14px;
  border-radius: 12px;
  border: 2px solid var(--line-2);
  background: var(--panel-2);
  color: var(--text);
  font: inherit;
  font-weight: 800;
  text-transform: uppercase;
  text-align: left;
}
.theme:disabled {
  opacity: 1;
}
.theme.can {
  cursor: pointer;
}
.theme.picked {
  border-color: var(--bad);
  background: color-mix(in srgb, var(--bad) 25%, var(--panel-2));
}
.theme.struck {
  opacity: 0.35;
  text-decoration: line-through;
}
</style>
