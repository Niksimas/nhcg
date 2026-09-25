<script setup lang="ts">
// Показ содержимого вопроса/ответа: текст, картинки, звук, видео.
// variant: screen — большой экран (медиа играет само), host — панель ведущего (с кнопками управления),
// phone — телефон игрока (звук и видео не воспроизводятся, только подсказка;
//         при игре через интернет — allowPlay: игрок может включить их сам).
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { ContentItem } from '../lib/types'
import Icon from './Icon.vue'

const props = withDefaults(
  defineProps<{
    items: ContentItem[] | null | undefined
    variant?: 'screen' | 'host' | 'phone'
    playing?: boolean | null
    replayKey?: number
    compact?: boolean
    allowPlay?: boolean
  }>(),
  { variant: 'host', playing: null, replayKey: 0, compact: false, allowPlay: false },
)

const root = ref<HTMLElement | null>(null)
const list = computed(() => props.items ?? [])
const textLength = computed(() =>
  list.value.filter((c) => c.type === 'text').reduce((sum, c) => sum + (c.text?.length ?? 0), 0),
)
const hasMedia = computed(() => list.value.some((c) => c.type !== 'text'))
const sizeClass = computed(() => {
  const n = textLength.value
  if (n < 50) return 'xl'
  if (n < 120) return 'lg'
  if (n < 260) return 'md'
  return 'sm'
})
const audioPlaying = ref(false)

function mediaEls(): HTMLMediaElement[] {
  return root.value ? Array.from(root.value.querySelectorAll<HTMLMediaElement>('audio, video')) : []
}

function applyPlaying() {
  if (props.playing === null || props.variant === 'phone') return
  for (const el of mediaEls()) {
    if (props.playing) {
      if (el.ended) continue
      void el.play().catch(() => {})
    } else {
      el.pause()
    }
  }
}

function restart() {
  for (const el of mediaEls()) {
    el.currentTime = 0
    if (props.playing !== false) void el.play().catch(() => {})
  }
}

watch(() => props.playing, applyPlaying)
watch(
  () => props.items,
  () => nextTick(applyPlaying),
)
watch(() => props.replayKey, restart)
onMounted(() => nextTick(applyPlaying))

function onPlay() {
  audioPlaying.value = true
}
function onStop() {
  audioPlaying.value = mediaEls().some((el) => !el.paused && !el.ended)
}

defineExpose({ restart })
</script>

<template>
  <div ref="root" class="content" :class="[variant, sizeClass, { withMedia: hasMedia, compact }]">
    <template v-for="(item, i) in list" :key="i">
      <p v-if="item.type === 'text'" class="text">{{ item.text }}</p>
      <img v-else-if="item.type === 'image'" class="image" :src="item.src" alt="" draggable="false" />
      <template v-else-if="item.type === 'audio'">
        <audio v-if="variant === 'phone' && allowPlay" class="player" :src="item.src" controls preload="none" />
        <div v-else-if="variant === 'phone'" class="hint"><Icon name="music" /> Звучит фрагмент — слушайте</div>
        <div v-else-if="variant === 'screen'" class="audio-visual" :class="{ on: audioPlaying }">
          <Icon name="music" size="3.2em" />
          <div class="eq"><i /><i /><i /><i /><i /></div>
          <audio :src="item.src" preload="auto" @play="onPlay" @pause="onStop" @ended="onStop" />
        </div>
        <audio v-else class="player" :src="item.src" controls preload="metadata" @play="onPlay" @pause="onStop" @ended="onStop" />
      </template>
      <template v-else-if="item.type === 'video'">
        <video v-if="variant === 'phone' && allowPlay" class="video" :src="item.src" controls playsinline preload="none" />
        <div v-else-if="variant === 'phone'" class="hint"><Icon name="video" /> Смотрите видео на экране</div>
        <video
          v-else
          class="video"
          :src="item.src"
          preload="auto"
          playsinline
          :controls="variant === 'host'"
          :muted="variant === 'host' && playing === null"
        />
      </template>
    </template>
  </div>
</template>

<style scoped>
.content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.8em;
  width: 100%;
  min-height: 0;
}
.text {
  margin: 0;
  white-space: pre-wrap;
  text-align: center;
  overflow-wrap: anywhere;
}
.image,
.video {
  max-width: 100%;
  object-fit: contain;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.25);
}
.hint {
  display: flex;
  align-items: center;
  gap: 0.5em;
  padding: 0.5em 0.9em;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--muted);
  font-size: 0.95rem;
}
.player {
  width: 100%;
  max-width: 420px;
}

/* Большой экран: содержимое занимает всю доступную высоту, картинка/видео ужимаются под неё */
.content.screen {
  flex: 1 1 auto;
  justify-content: center;
}
.screen .text {
  font-weight: 700;
  line-height: 1.25;
  text-wrap: balance;
}
.screen.xl .text {
  font-size: clamp(2rem, min(5.2vw, 9vh), 5rem);
}
.screen.lg .text {
  font-size: clamp(1.7rem, min(4vw, 7vh), 3.8rem);
}
.screen.md .text {
  font-size: clamp(1.4rem, min(3vw, 5.5vh), 2.8rem);
}
.screen.sm .text {
  font-size: clamp(1.15rem, min(2.2vw, 4vh), 2rem);
}
.screen.withMedia .text {
  font-size: clamp(1.2rem, min(2.6vw, 4.5vh), 2.4rem);
}
.screen.compact .text {
  font-size: clamp(1rem, min(2vw, 3.6vh), 1.8rem);
  font-weight: 600;
  opacity: 0.85;
}
.screen.compact .image,
.screen.compact .video {
  max-height: 28vh;
}
.screen .image,
.screen .video {
  flex: 1 1 0;
  min-height: 0;
  width: 100%;
  max-height: 62vh;
  background: transparent;
  border-radius: 0;
}
.audio-visual {
  display: flex;
  align-items: center;
  gap: 1rem;
  color: var(--accent);
  padding: 1rem 2rem;
}
.eq {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 3em;
}
.eq i {
  width: 10px;
  height: 20%;
  background: var(--accent);
  border-radius: 3px;
  opacity: 0.5;
}
.audio-visual.on .eq i {
  opacity: 1;
  animation: eq 0.9s ease-in-out infinite;
}
.audio-visual.on .eq i:nth-child(2) {
  animation-delay: -0.3s;
}
.audio-visual.on .eq i:nth-child(3) {
  animation-delay: -0.6s;
}
.audio-visual.on .eq i:nth-child(4) {
  animation-delay: -0.15s;
}
.audio-visual.on .eq i:nth-child(5) {
  animation-delay: -0.45s;
}
@keyframes eq {
  0%,
  100% {
    height: 20%;
  }
  50% {
    height: 100%;
  }
}

/* Ведущий */
.host .text {
  font-size: 1.25rem;
  font-weight: 600;
}
.host .image,
.host .video {
  max-height: 260px;
}

/* Телефон */
.phone {
  gap: 0.5em;
}
.phone .text {
  font-size: 1.05rem;
  font-weight: 600;
}
.phone .image {
  max-height: 30vh;
}
</style>
