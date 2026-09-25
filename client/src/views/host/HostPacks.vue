<script setup lang="ts">
// Пакеты вопросов: выбор для игры, импорт (.json, .zip, .siq), экспорт, копирование, удаление, редактор.
import { computed, onMounted, ref } from 'vue'
import { api, downloadUrl, upload } from '../../lib/api'
import type { PackSummary } from '../../lib/types'
import { plural } from '../../lib/util'
import Icon from '../../components/Icon.vue'
import { useHost } from './ctx'
import { roomPath } from '../../lib/room'

const emit = defineEmits<{ close: [] }>()
const { state, run, toast } = useHost()
const packs = ref<PackSummary[]>([])
const loading = ref(true)
const uploading = ref<number | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const currentId = computed(() => state.value?.pack?.id ?? null)

async function load() {
  loading.value = true
  try {
    packs.value = await api<PackSummary[]>('GET', '/packs')
  } catch (e) {
    toast((e as Error).message, 'err')
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function play(p: PackSummary) {
  if (state.value?.stage === 'game' && !confirm('Игра идёт. Загрузить другой пакет? Прогресс раунда начнётся заново.')) return
  if (await run('pack.load', { packId: p.id })) {
    toast(`Пакет «${p.title}» загружен`, 'ok')
    emit('close')
  }
}

function edit(id: string) {
  window.open(roomPath(`/editor/${encodeURIComponent(id)}`), '_blank')
}

async function copy(p: PackSummary) {
  try {
    const { id } = await api<{ id: string }>('POST', `/packs/${encodeURIComponent(p.id)}/copy`)
    await load()
    if (p.builtin) edit(id)
    else toast('Копия создана', 'ok')
  } catch (e) {
    toast((e as Error).message, 'err')
  }
}

async function remove(p: PackSummary) {
  if (!confirm(`Удалить пакет «${p.title}»? Это нельзя отменить.`)) return
  try {
    await api('DELETE', `/packs/${encodeURIComponent(p.id)}`)
    await load()
  } catch (e) {
    toast((e as Error).message, 'err')
  }
}

async function create() {
  try {
    const { id } = await api<{ id: string }>('POST', '/packs', {})
    await load()
    edit(id)
  } catch (e) {
    toast((e as Error).message, 'err')
  }
}

async function onFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploading.value = 0
  try {
    const { id } = await upload<{ id: string }>('/packs/import', file, (f) => (uploading.value = f))
    await load()
    const p = packs.value.find((x) => x.id === id)
    toast(`Пакет «${p?.title ?? file.name}» импортирован`, 'ok')
  } catch (e) {
    toast((e as Error).message, 'err')
  } finally {
    uploading.value = null
  }
}
</script>

<template>
  <div class="packs">
    <div class="toolbar">
      <button class="btn primary" :disabled="uploading !== null" @click="fileInput?.click()">
        <Icon name="upload" /> Импорт файла
      </button>
      <button class="btn" @click="create"><Icon name="plus" /> Создать пакет</button>
      <input ref="fileInput" type="file" accept=".json,.zip,.siq,application/json,application/zip" hidden @change="onFile" />
      <span v-if="uploading !== null" class="muted">
        {{ uploading < 1 ? `Загрузка… ${Math.round(uploading * 100)}%` : 'Обработка пакета…' }}
      </span>
    </div>
    <p class="muted small">
      Поддерживаются пакеты SIGame (<b>.siq</b>), архивы этой программы (<b>.zip</b>) и файлы <b>.json</b>.
      Пакеты для SIGame можно найти в интернете — скачайте .siq и импортируйте сюда.
    </p>

    <p v-if="loading" class="muted">Загрузка…</p>
    <div v-else class="list">
      <div v-for="p in packs" :key="p.id" class="pack" :class="{ current: p.id === currentId }">
        <div class="info">
          <div class="title">
            {{ p.title }}
            <span v-if="p.builtin" class="chip">встроенный</span>
            <span v-if="p.id === currentId" class="chip cur">в игре</span>
          </div>
          <div class="muted small">
            <template v-if="p.author">{{ p.author }} · </template>
            {{ p.rounds.length }} {{ plural(p.rounds.length, 'раунд', 'раунда', 'раундов') }},
            {{ p.questions }} {{ plural(p.questions, 'вопрос', 'вопроса', 'вопросов') }}
            <template v-if="p.media"> · медиа: {{ p.media }}</template>
          </div>
          <div v-if="p.description" class="faint small desc">{{ p.description }}</div>
        </div>
        <div class="acts">
          <button class="btn primary small" @click="play(p)"><Icon name="play" /> Играть</button>
          <button v-if="!p.builtin" class="btn small" @click="edit(p.id)"><Icon name="edit" /> Редактировать</button>
          <button class="btn small" :title="p.builtin ? 'Создать копию и открыть в редакторе' : 'Создать копию'" @click="copy(p)">
            <Icon name="copy" /> {{ p.builtin ? 'Копия для правки' : 'Копия' }}
          </button>
          <a class="btn small ghost" :href="downloadUrl(`/packs/${encodeURIComponent(p.id)}/export`)" title="Скачать .zip"><Icon name="download" /></a>
          <button v-if="!p.builtin" class="btn small ghost" title="Удалить" @click="remove(p)"><Icon name="trash" /></button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.packs {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.small {
  font-size: 0.85rem;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pack {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 12px;
  background: var(--panel-2);
  border: 1px solid var(--line);
  flex-wrap: wrap;
}
.pack.current {
  border-color: var(--accent);
}
.info {
  flex: 1 1 280px;
  min-width: 0;
}
.title {
  font-weight: 800;
  font-size: 1.05rem;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.chip.cur {
  background: var(--accent);
  color: var(--accent-text);
}
.desc {
  margin-top: 4px;
}
.acts {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
</style>
