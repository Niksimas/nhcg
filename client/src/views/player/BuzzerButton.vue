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
.buzzer {
  --bg1: #3a466f;
  --bg2: #232c4d;
  --fg: #cfd6f5;
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
  background: radial-gradient(circle at 50% 35%, var(--bg1), var(--bg2));
  color: var(--fg);
  box-shadow:
    0 12px 0 rgba(0, 0, 0, 0.35),
    0 20px 40px rgba(0, 0, 0, 0.45),
    inset 0 -8px 20px rgba(0, 0, 0, 0.25),
    inset 0 6px 14px rgba(255, 255, 255, 0.18);
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
    0 4px 0 rgba(0, 0, 0, 0.35),
    0 8px 20px rgba(0, 0, 0, 0.45),
    inset 0 -8px 20px rgba(0, 0, 0, 0.25);
}
.ring {
  position: absolute;
  inset: -10px;
  border-radius: 50%;
  border: 4px solid transparent;
  pointer-events: none;
}
.title {
  font-size: clamp(1.6rem, 9vw, 3.2rem);
  font-weight: 900;
  line-height: 1.05;
  text-align: center;
  letter-spacing: 0.01em;
}
.sub {
  font-size: clamp(0.85rem, 3.6vw, 1.1rem);
  font-weight: 600;
  text-align: center;
  opacity: 0.9;
  line-height: 1.25;
}

.test {
  --bg1: #4f7bff;
  --bg2: #2a47b8;
  --fg: #fff;
}
.idle {
  --bg1: #2d3657;
  --bg2: #1c2340;
  --fg: #8e99c4;
}
.wait {
  --bg1: #f0a53a;
  --bg2: #b96c00;
  --fg: #2b1700;
}
.go {
  --bg1: #3fe07f;
  --bg2: #129444;
  --fg: #052b12;
  animation: pulse 0.9s ease-in-out infinite;
}
.go .ring {
  border-color: rgba(63, 224, 127, 0.55);
  animation: pulse 0.9s ease-in-out infinite;
}
.pressed {
  --bg1: #7bf0a8;
  --bg2: #2cb865;
  --fg: #052b12;
}
.winner {
  --bg1: #ffe07a;
  --bg2: #f0a800;
  --fg: #2b1d00;
  animation: pop 0.4s ease;
}
.winner .ring {
  border-color: #ffd54a;
  box-shadow: 0 0 40px rgba(255, 213, 74, 0.8);
}
.other {
  --bg1: #515c86;
  --bg2: #2f375a;
  --fg: #e6e9ff;
}
.queue {
  --bg1: #3cc8dc;
  --bg2: #147a8c;
  --fg: #03222a;
}
.locked {
  --bg1: #ef5b5b;
  --bg2: #a51d1d;
  --fg: #fff;
}
.early {
  --bg1: #ff8a3d;
  --bg2: #c2410c;
  --fg: #fff;
  animation: shake 0.35s ease;
}
.offline {
  --bg1: #444;
  --bg2: #222;
  --fg: #aaa;
}
</style>
