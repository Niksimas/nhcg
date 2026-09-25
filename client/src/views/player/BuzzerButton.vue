<script setup lang="ts">
// Большая кнопка игрока. Реагирует на касание (pointerdown), а не на click — так быстрее на ~100 мс.
defineProps<{ cls: string; title: string; sub?: string; active: boolean; color?: string }>()
const emit = defineEmits<{ press: [ev: Event] }>()

function onDown(ev: PointerEvent) {
  if (ev.button !== 0 && ev.pointerType === 'mouse') return
  emit('press', ev)
}
</script>

<template>
  <button
    class="buzzer"
    :class="[cls, { active }]"
    :style="color ? { '--me': color } : undefined"
    @pointerdown.prevent="onDown"
    @contextmenu.prevent
    @keydown.space.prevent
    @keydown.enter.prevent
  >
    <span class="ring" />
    <span class="title">{{ title }}</span>
    <span v-if="sub" class="sub">{{ sub }}</span>
  </button>
</template>

<style scoped>
/* Каждое состояние задаёт цвета: --bg1/--bg2 — градиент, --edge — «бортик» кнопки, --fg — текст. */
.buzzer {
  --bg1: #eef1f8;
  --bg2: #d9dfec;
  --edge: #c3cbdc;
  --fg: #5f6882;
  position: relative;
  width: min(78vw, 52vh, 420px);
  aspect-ratio: 1;
  border-radius: 50%;
  border: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4em;
  padding: 12%;
  background: radial-gradient(circle at 50% 30%, var(--bg1), var(--bg2) 78%);
  color: var(--fg);
  box-shadow:
    0 10px 0 var(--edge),
    0 30px 50px -20px color-mix(in srgb, var(--bg2) 70%, transparent),
    inset 0 -10px 24px rgba(0, 0, 0, 0.1),
    inset 0 8px 18px rgba(255, 255, 255, 0.45);
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: none;
  transition:
    transform 0.05s ease,
    box-shadow 0.05s ease,
    background 0.2s ease;
  outline: none;
}
.buzzer:active {
  transform: translateY(8px);
  box-shadow:
    0 2px 0 var(--edge),
    0 12px 24px -12px color-mix(in srgb, var(--bg2) 70%, transparent),
    inset 0 -10px 24px rgba(0, 0, 0, 0.1);
}
.ring {
  position: absolute;
  inset: -12px;
  border-radius: 50%;
  border: 4px solid transparent;
  pointer-events: none;
}
.title {
  font-size: clamp(1.6rem, 9vw, 3.2rem);
  font-weight: 800;
  line-height: 1.05;
  text-align: center;
  letter-spacing: -0.01em;
}
.sub {
  font-size: clamp(0.85rem, 3.6vw, 1.1rem);
  font-weight: 700;
  text-align: center;
  opacity: 0.9;
  line-height: 1.25;
}

.test {
  --bg1: #a5b4fc;
  --bg2: #4f46e5;
  --edge: #3730a3;
  --fg: #fff;
}
.idle {
  --bg1: #f7f8fc;
  --bg2: #e4e8f1;
  --edge: #cfd6e4;
  --fg: #7c86a2;
}
.wait {
  --bg1: #fde68a;
  --bg2: #f59e0b;
  --edge: #b45309;
  --fg: #422006;
}
.go {
  --bg1: #86efac;
  --bg2: #16a34a;
  --edge: #166534;
  --fg: #fff;
  animation: pulse 0.9s ease-in-out infinite;
}
.go .ring {
  border-color: rgba(34, 197, 94, 0.45);
  animation: pulse 0.9s ease-in-out infinite;
}
.pressed {
  --bg1: #dcfce7;
  --bg2: #4ade80;
  --edge: #16a34a;
  --fg: #14532d;
}
.winner {
  --bg1: #fef3c7;
  --bg2: #f59e0b;
  --edge: #b45309;
  --fg: #451a03;
  animation: pop 0.4s ease;
}
.winner .ring {
  border-color: #fbbf24;
  box-shadow: 0 0 44px rgba(251, 191, 36, 0.7);
}
.other {
  --bg1: #eef2ff;
  --bg2: #a5b4fc;
  --edge: #6366f1;
  --fg: #1e1b4b;
}
.queue {
  --bg1: #a5f3fc;
  --bg2: #0891b2;
  --edge: #155e75;
  --fg: #fff;
}
.locked {
  --bg1: #fca5a5;
  --bg2: #dc2626;
  --edge: #991b1b;
  --fg: #fff;
}
.early {
  --bg1: #fed7aa;
  --bg2: #ea580c;
  --edge: #9a3412;
  --fg: #fff;
  animation: shake 0.35s ease;
}
.offline {
  --bg1: #e5e7eb;
  --bg2: #9ca3af;
  --edge: #6b7280;
  --fg: #374151;
}
</style>
