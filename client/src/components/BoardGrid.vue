<script setup lang="ts">
// Табло «Своей игры»: темы слева, цены справа. Сыгранные вопросы пустеют.
import { computed } from 'vue'
import type { JBoardTheme } from '../lib/types'

const props = withDefaults(
  defineProps<{
    board: JBoardTheme[]
    variant?: 'screen' | 'host' | 'phone'
    clickable?: boolean
    selectedId?: string | null
    showTypes?: boolean
  }>(),
  { variant: 'screen', clickable: false, selectedId: null, showTypes: false },
)
const emit = defineEmits<{ select: [id: string, played: boolean] }>()

const cols = computed(() => Math.max(1, ...props.board.map((t) => t.questions.length)))
const MARK: Record<string, string> = { cat: '🐱', auction: '💰', norisk: '🛡' }

function click(id: string, played: boolean) {
  if (!props.clickable) return
  if (played && props.variant !== 'host') return
  emit('select', id, played)
}
</script>

<template>
  <div class="board" :class="variant" :style="{ '--cols': cols }">
    <template v-for="(theme, ti) in board" :key="ti">
      <div class="theme" :class="{ hidden: theme.hidden, current: theme.current }">
        <span v-if="theme.name">{{ theme.name }}</span>
        <span v-else class="secret">Тема {{ ti + 1 }}</span>
        <span v-if="theme.hidden && theme.name && variant === 'host'" class="secret-tag" title="Игроки ещё не видят название">скрыта</span>
      </div>
      <button
        v-for="q in theme.questions"
        :key="q.id"
        class="cell nums"
        :class="{ played: q.played, selected: q.id === selectedId, clickable: clickable && (!q.played || variant === 'host') }"
        :disabled="!clickable || (q.played && variant !== 'host')"
        :title="q.played ? 'Вопрос сыгран' : ''"
        @click="click(q.id, q.played)"
      >
        <span class="price">{{ q.played && variant !== 'host' ? '' : q.price }}</span>
        <span v-if="showTypes && q.type && MARK[q.type]" class="mark">{{ MARK[q.type] }}</span>
      </button>
      <div v-for="n in cols - theme.questions.length" :key="`e${n}`" class="cell empty" />
    </template>
  </div>
</template>

<style scoped>
.board {
  display: grid;
  grid-template-columns: minmax(0, 2.2fr) repeat(var(--cols), minmax(0, 1fr));
  gap: 6px;
  width: 100%;
}
.theme,
.cell {
  display: flex;
  align-items: center;
  border-radius: 8px;
  background: linear-gradient(180deg, var(--board), var(--board-2));
  border: 1px solid var(--board-edge);
  min-width: 0;
}
.theme.current {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent) inset;
}
.theme.hidden .secret,
.secret {
  opacity: 0.6;
  font-style: italic;
}
.secret-tag {
  margin-left: 0.5em;
  font-size: 0.7em;
  padding: 0.1em 0.4em;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.12);
  text-transform: none;
  font-weight: 600;
}
.theme {
  padding: 0.4em 0.8em;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  overflow-wrap: anywhere;
  line-height: 1.15;
}
.cell {
  position: relative;
  justify-content: center;
  color: var(--accent);
  font-weight: 800;
  cursor: default;
  padding: 0.3em;
  font-family: inherit;
}
.cell.clickable {
  cursor: pointer;
}
.cell.clickable:hover {
  filter: brightness(1.3);
}
.cell.played {
  background: rgba(20, 43, 133, 0.25);
  border-color: rgba(53, 88, 216, 0.3);
  color: rgba(255, 200, 61, 0.28);
}
.cell.selected {
  background: var(--accent);
  color: var(--accent-text);
  animation: flash 0.6s ease;
}
.cell.empty {
  background: transparent;
  border-color: transparent;
}
.mark {
  position: absolute;
  top: 2px;
  right: 4px;
  font-size: 0.7em;
}

.screen {
  gap: 8px;
  height: 100%;
  grid-auto-rows: minmax(0, 1fr);
}
.screen .theme {
  font-size: clamp(0.8rem, 1.5vw, 1.6rem);
}
.screen .cell {
  font-size: clamp(1.2rem, 3.2vw, 3.4rem);
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.35);
}

.host .theme {
  font-size: 0.85rem;
  min-height: 2.8em;
}
.host .cell {
  font-size: 1.15rem;
  min-height: 2.6em;
}
.host .cell.played {
  color: rgba(255, 200, 61, 0.35);
  text-decoration: line-through;
}

.phone {
  gap: 4px;
}
.phone .theme {
  font-size: 0.72rem;
  padding: 0.35em 0.5em;
  text-transform: none;
}
.phone .cell {
  font-size: 1rem;
  min-height: 2.6em;
}
</style>
