<script setup lang="ts">
// Табло «Своей игры»: темы слева, цены справа. Сыгранные вопросы пустеют.
// У ведущего название темы можно вписать щелчком (renamable).
import { computed } from 'vue'
import type { JBoardTheme } from '../lib/types'
import Icon from './Icon.vue'

const props = withDefaults(
  defineProps<{
    board: JBoardTheme[]
    variant?: 'screen' | 'host' | 'phone'
    clickable?: boolean
    selectedId?: string | null
    renamable?: boolean
  }>(),
  { variant: 'screen', clickable: false, selectedId: null, renamable: false },
)
const emit = defineEmits<{ select: [id: string, played: boolean]; rename: [themeIndex: number] }>()

const cols = computed(() => Math.max(1, ...props.board.map((t) => t.questions.length)))

function click(id: string, played: boolean) {
  if (!props.clickable) return
  if (played && props.variant !== 'host') return
  emit('select', id, played)
}
</script>

<template>
  <div class="board" :class="variant" :style="{ '--cols': cols }">
    <template v-for="(theme, ti) in board" :key="ti">
      <component
        :is="renamable ? 'button' : 'div'"
        class="theme"
        :class="{ hidden: theme.hidden, current: theme.current, struck: theme.struck, renamable, unnamed: renamable && !theme.named }"
        :title="renamable ? 'Вписать название темы' : undefined"
        @click="renamable && emit('rename', ti)"
      >
        <span v-if="theme.name">{{ theme.name }}</span>
        <span v-else class="secret">Тема {{ ti + 1 }}</span>
        <span v-if="theme.hidden && theme.name && variant === 'host'" class="secret-tag" title="Игроки ещё не видят название">скрыта</span>
        <Icon v-if="renamable" class="pen" name="edit" size="0.85em" />
      </component>
      <button
        v-for="q in theme.questions"
        :key="q.id"
        class="cell nums"
        :class="{
          played: q.played,
          struck: theme.struck,
          selected: q.id === selectedId,
          clickable: clickable && (!q.played || variant === 'host'),
        }"
        :disabled="!clickable || (q.played && variant !== 'host')"
        :title="q.played ? 'Вопрос сыгран' : ''"
        @click="click(q.id, q.played)"
      >
        <span class="price">{{ q.played && variant !== 'host' ? '' : q.price }}</span>
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
  border-radius: 12px;
  background: linear-gradient(180deg, var(--board), var(--board-2));
  border: 1px solid var(--board-edge);
  box-shadow: var(--shadow-sm);
  min-width: 0;
}
.theme.current {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent) inset;
}
.theme.struck {
  opacity: 0.35;
  text-decoration: line-through;
}
.cell.struck {
  opacity: 0.3;
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
  background: var(--panel-3);
  text-transform: none;
  font-weight: 600;
}
.theme {
  padding: 0.4em 0.8em;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  overflow-wrap: anywhere;
  line-height: 1.15;
  background: linear-gradient(180deg, #f4f5ff, var(--accent-soft));
  border-color: #dcdffb;
  color: #312e81;
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
  background: var(--panel-3);
  border-color: transparent;
  box-shadow: none;
  color: var(--faint);
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
button.theme {
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.theme.renamable:hover {
  border-color: var(--accent);
}
.theme.unnamed > span:first-child {
  color: var(--faint);
}
.pen {
  margin-left: auto;
  flex: none;
  opacity: 0.45;
}
.theme.renamable:hover .pen {
  opacity: 1;
  color: var(--accent);
}

.screen {
  gap: 8px;
  height: 100%;
  grid-auto-rows: minmax(0, 1fr);
}
.screen .theme {
  font-size: clamp(0.8rem, 1.5vw, 1.6rem);
}
.screen .theme,
.screen .cell {
  border-radius: clamp(10px, 1.2vw, 18px);
}
.screen .cell {
  font-size: clamp(1.2rem, 3.2vw, 3.4rem);
  letter-spacing: -0.02em;
  box-shadow: var(--shadow);
}
.screen .cell.played {
  box-shadow: none;
  background: rgba(234, 237, 245, 0.7);
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
  color: var(--faint);
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
