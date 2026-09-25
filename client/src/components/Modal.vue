<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

withDefaults(defineProps<{ title?: string; width?: string }>(), { title: '', width: '560px' })
const emit = defineEmits<{ close: [] }>()

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  }
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onUnmounted(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" @mousedown.self="emit('close')">
      <div class="modal" :style="{ maxWidth: width }" role="dialog" aria-modal="true">
        <header v-if="title || $slots.header" class="head">
          <slot name="header">
            <h3>{{ title }}</h3>
          </slot>
          <button class="btn flat icon close" title="Закрыть (Esc)" @click="emit('close')">✕</button>
        </header>
        <div class="body scroll">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="foot">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(21, 26, 45, 0.38);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  animation: fadeUp 0.15s ease;
}
.modal {
  width: 100%;
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 20px;
  box-shadow: var(--shadow-lg);
}
.head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 14px 16px 6px 20px;
}
.head h3 {
  margin: 0;
  flex: 1;
  font-size: 1.2rem;
  font-weight: 800;
}
.close {
  font-size: 1.1rem;
  width: 2.2em;
}
.body {
  padding: 10px 20px 18px;
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--line);
  background: var(--panel-2);
  border-radius: 0 0 20px 20px;
}
</style>
