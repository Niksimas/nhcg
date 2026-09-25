<script setup lang="ts">
// Полоса со счётом участников (на экране и у ведущего).
import type { Competitor } from '../lib/types'
import { fmtScore, textOn } from '../lib/util'

withDefaults(
  defineProps<{
    competitors: Competitor[]
    chooserId?: string | null
    activeId?: string | null
    lockedOut?: string[]
    flash?: Record<string, number>
    size?: 'normal' | 'large'
  }>(),
  { chooserId: null, activeId: null, lockedOut: () => [], flash: () => ({}), size: 'normal' },
)
</script>

<template>
  <div class="strip" :class="size">
    <div
      v-for="c in competitors"
      :key="`${c.id}-${flash[c.id] ?? 0}`"
      class="tile"
      :class="{
        active: c.id === activeId,
        chooser: c.id === chooserId,
        locked: lockedOut.includes(c.id),
        offline: !c.connected,
        flash: !!flash[c.id],
      }"
      :style="{ '--c': c.color, '--t': textOn(c.color) }"
    >
      <div class="name ellipsis">
        <span v-if="c.id === chooserId" class="chooser-mark" title="Выбирает вопрос">▶</span>
        {{ c.name }}
      </div>
      <div class="score nums" :class="{ neg: c.score < 0 }">{{ fmtScore(c.score) }}</div>
    </div>
  </div>
</template>

<style scoped>
.strip {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}
.tile {
  position: relative;
  min-width: 140px;
  max-width: 260px;
  flex: 1 1 140px;
  padding: 0.5em 0.9em 0.55em;
  border-radius: 14px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-top: 5px solid var(--c);
  box-shadow: var(--shadow);
  text-align: center;
  transition:
    transform 0.2s,
    background 0.2s;
}
.name {
  font-weight: 700;
  font-size: 1rem;
}
.score {
  font-size: 1.6rem;
  font-weight: 800;
  color: var(--accent);
}
.score.neg {
  color: var(--bad);
}
.tile.chooser {
  border-color: var(--gold);
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--gold) 45%, transparent),
    var(--shadow);
}
.chooser-mark {
  color: var(--gold);
  font-size: 0.8em;
}
.tile.active {
  background: var(--c);
  border-color: var(--c);
  color: var(--t);
  transform: translateY(-4px) scale(1.04);
  box-shadow:
    0 0 0 3px #fff,
    0 16px 34px -12px var(--c);
}
.tile.active .score {
  color: var(--t);
}
.tile.locked {
  opacity: 0.45;
}
.tile.offline .name::after {
  content: ' ⚠';
  color: var(--warn);
}
.tile.flash {
  animation: flash 0.7s ease;
}
.large .tile {
  min-width: 180px;
  max-width: 340px;
  padding: 0.7em 1em;
}
.large .name {
  font-size: clamp(1rem, 1.6vw, 1.6rem);
}
.large .score {
  font-size: clamp(1.6rem, 3vw, 3rem);
}
</style>
