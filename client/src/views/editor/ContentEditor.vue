<script setup lang="ts">
// Редактирование списка элементов вопроса/ответа: текст, картинка, звук, видео.
import { ref } from 'vue'
import { upload } from '../../lib/api'
import type { ContentItem } from '../../lib/types'
import Icon from '../../components/Icon.vue'

const props = defineProps<{ items: ContentItem[]; packId: string; readonly: boolean }>()
const emit = defineEmits<{ change: []; error: [message: string] }>()

const uploadingIndex = ref<number | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
let pendingIndex = -1
let pendingKind: ContentItem['type'] = 'image'

const ACCEPT: Record<string, string> = {
  image: 'image/*',
  audio: 'audio/*,.mp3,.ogg,.wav,.m4a,.opus,.flac',
  video: 'video/*,.mp4,.webm,.mov',
}

function srcUrl(src?: string) {
  if (!src) return ''
  if (/^(https?:|data:)/i.test(src)) return src
  return `/media/${encodeURIComponent(props.packId)}/${encodeURIComponent(src)}`
}

function add(type: ContentItem['type']) {
  if (type === 'text') {
    props.items.push({ type: 'text', text: '' })
    emit('change')
    return
  }
  pendingIndex = props.items.length
  pendingKind = type
  pickFile(type)
}

function replace(i: number) {
  pendingIndex = i
  pendingKind = props.items[i].type
  pickFile(pendingKind)
}

function pickFile(type: ContentItem['type']) {
  if (!fileInput.value) return
  fileInput.value.accept = ACCEPT[type] ?? ''
  fileInput.value.click()
}

async function onFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const index = pendingIndex
  uploadingIndex.value = index
  try {
    const res = await upload<{ name: string; kind: ContentItem['type'] }>(`/packs/${encodeURIComponent(props.packId)}/media`, file)
    const item: ContentItem = { type: res.kind ?? pendingKind, src: res.name }
    if (index >= props.items.length) props.items.push(item)
    else props.items.splice(index, 1, item)
    emit('change')
  } catch (e) {
    emit('error', (e as Error).message)
  } finally {
    uploadingIndex.value = null
  }
}

function remove(i: number) {
  props.items.splice(i, 1)
  emit('change')
}

function move(i: number, d: -1 | 1) {
  const j = i + d
  if (j < 0 || j >= props.items.length) return
  const [x] = props.items.splice(i, 1)
  props.items.splice(j, 0, x)
  emit('change')
}
</script>

<template>
  <div class="ce">
    <div v-for="(item, i) in items" :key="i" class="item">
      <div class="item-body">
        <textarea
          v-if="item.type === 'text'"
          v-model="item.text"
          class="textarea"
          rows="2"
          :readonly="readonly"
          placeholder="Текст"
          @input="emit('change')"
        />
        <img v-else-if="item.type === 'image'" class="preview" :src="srcUrl(item.src)" alt="" />
        <audio v-else-if="item.type === 'audio'" class="audio" :src="srcUrl(item.src)" controls preload="none" />
        <video v-else-if="item.type === 'video'" class="preview" :src="srcUrl(item.src)" controls preload="metadata" />
        <div v-if="item.type !== 'text'" class="faint small ellipsis">{{ item.src }}</div>
        <div v-if="uploadingIndex === i" class="muted small">Загрузка…</div>
      </div>
      <div v-if="!readonly" class="item-acts">
        <button class="btn small flat icon" title="Выше" :disabled="i === 0" @click="move(i, -1)"><Icon name="up" /></button>
        <button class="btn small flat icon" title="Ниже" :disabled="i === items.length - 1" @click="move(i, 1)"><Icon name="down" /></button>
        <button v-if="item.type !== 'text'" class="btn small flat icon" title="Заменить файл" @click="replace(i)"><Icon name="upload" /></button>
        <button class="btn small flat icon" title="Удалить" @click="remove(i)"><Icon name="trash" /></button>
      </div>
    </div>
    <div v-if="uploadingIndex !== null && uploadingIndex >= items.length" class="muted small">Загрузка файла…</div>
    <div v-if="!readonly" class="adds">
      <button class="btn small ghost" @click="add('text')"><Icon name="text" /> Текст</button>
      <button class="btn small ghost" @click="add('image')"><Icon name="image" /> Картинка</button>
      <button class="btn small ghost" @click="add('audio')"><Icon name="music" /> Звук</button>
      <button class="btn small ghost" @click="add('video')"><Icon name="video" /> Видео</button>
    </div>
    <input ref="fileInput" type="file" hidden @change="onFile" />
  </div>
</template>

<style scoped>
.ce {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.item {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  padding: 6px;
  border-radius: 10px;
  background: var(--bg-2);
  border: 1px solid var(--line);
}
.item-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.item-acts {
  display: flex;
  flex-direction: column;
}
.preview {
  max-width: 100%;
  max-height: 180px;
  object-fit: contain;
  border-radius: 8px;
  align-self: flex-start;
}
.audio {
  width: 100%;
}
.adds {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.small {
  font-size: 0.8rem;
}
</style>
