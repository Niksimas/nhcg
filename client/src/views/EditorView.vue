<script setup lang="ts">
// Редактор пакета вопросов: раунды → темы → вопросы (текст, картинки, звук, видео, ответ).
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, downloadUrl, getHostKey } from '../lib/api'
import type { Pack, PackQuestion, PackRound, PackTheme, QType } from '../lib/types'
import { contentText, TYPE_LABEL } from '../lib/util'
import Icon from '../components/Icon.vue'
import ContentEditor from './editor/ContentEditor.vue'

getHostKey()
const route = useRoute()
const router = useRouter()
const packId = computed(() => String(route.params.id ?? ''))

const pack = ref<Pack | null>(null)
const error = ref('')
const dirty = ref(false)
const saving = ref(false)
const message = ref('')
const roundIndex = ref(0)
const sel = reactive({ theme: -1, question: -1 })
let messageTimer = 0

function flash(text: string) {
  message.value = text
  clearTimeout(messageTimer)
  messageTimer = window.setTimeout(() => (message.value = ''), 3000)
}

async function load() {
  error.value = ''
  try {
    pack.value = await api<Pack>('GET', `/packs/${encodeURIComponent(packId.value)}`)
    dirty.value = false
    roundIndex.value = 0
    sel.theme = -1
    sel.question = -1
    document.title = `${pack.value.title} · Редактор`
  } catch (e) {
    error.value = (e as Error).message
  }
}

onMounted(() => {
  void load()
  window.addEventListener('beforeunload', onBeforeUnload)
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  window.removeEventListener('keydown', onKey)
})
watch(packId, () => void load())

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value) {
    e.preventDefault()
    e.returnValue = ''
  }
}

function onKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyS' || e.key === 's' || e.key === 'ы')) {
    e.preventDefault()
    void save()
  }
}

const readonly = computed(() => !!pack.value?.builtin)
const round = computed<PackRound | null>(() => pack.value?.rounds[roundIndex.value] ?? null)
const theme = computed<PackTheme | null>(() => (sel.theme >= 0 ? round.value?.themes[sel.theme] ?? null : null))
const question = computed<PackQuestion | null>(() => (theme.value && sel.question >= 0 ? theme.value.questions[sel.question] ?? null : null))

function touch() {
  dirty.value = true
}

async function save() {
  if (!pack.value || readonly.value || saving.value) return
  saving.value = true
  try {
    const saved = await api<Pack>('PUT', `/packs/${encodeURIComponent(packId.value)}`, pack.value)
    // Сервер мог поправить данные (обрезать лишнее) — но не сбиваем выделение.
    pack.value.title = saved.title
    dirty.value = false
    flash('Сохранено')
  } catch (e) {
    flash(`Ошибка: ${(e as Error).message}`)
  } finally {
    saving.value = false
  }
}

async function makeCopy() {
  try {
    const { id } = await api<{ id: string }>('POST', `/packs/${encodeURIComponent(packId.value)}/copy`)
    await router.replace(`/editor/${encodeURIComponent(id)}`)
    flash('Создана копия — теперь её можно редактировать')
  } catch (e) {
    flash(`Ошибка: ${(e as Error).message}`)
  }
}

async function playThis() {
  if (dirty.value) await save()
  window.open('/host', 'quiz-host')
  flash('Выберите этот пакет в панели ведущего: «Пакеты» → «Играть»')
}

// ── раунды ──
function addRound(type: 'normal' | 'final') {
  if (!pack.value) return
  const n = pack.value.rounds.filter((r) => r.type === 'normal').length + 1
  pack.value.rounds.push({ name: type === 'final' ? 'Финал' : `Раунд ${n}`, type, themes: [] })
  roundIndex.value = pack.value.rounds.length - 1
  sel.theme = -1
  sel.question = -1
  touch()
}

function removeRound(i: number) {
  if (!pack.value) return
  const r = pack.value.rounds[i]
  if (!confirm(`Удалить раунд «${r.name}» со всеми вопросами?`)) return
  pack.value.rounds.splice(i, 1)
  roundIndex.value = Math.max(0, Math.min(roundIndex.value, pack.value.rounds.length - 1))
  sel.theme = -1
  sel.question = -1
  touch()
}

function moveRound(i: number, d: -1 | 1) {
  if (!pack.value) return
  const j = i + d
  if (j < 0 || j >= pack.value.rounds.length) return
  const [r] = pack.value.rounds.splice(i, 1)
  pack.value.rounds.splice(j, 0, r)
  roundIndex.value = j
  touch()
}

function selectRound(i: number) {
  roundIndex.value = i
  sel.theme = -1
  sel.question = -1
}

// ── темы ──
function addTheme() {
  const r = round.value
  if (!r) return
  const t: PackTheme = { name: r.type === 'final' ? 'Тема финала' : `Тема ${r.themes.length + 1}`, questions: [] }
  r.themes.push(t)
  if (r.type === 'final') t.questions.push(newQuestion(0))
  touch()
}

function removeTheme(i: number) {
  const r = round.value
  if (!r) return
  if (r.themes[i].questions.length && !confirm(`Удалить тему «${r.themes[i].name}» со всеми вопросами?`)) return
  r.themes.splice(i, 1)
  if (sel.theme === i) {
    sel.theme = -1
    sel.question = -1
  } else if (sel.theme > i) sel.theme--
  touch()
}

function moveTheme(i: number, d: -1 | 1) {
  const r = round.value
  if (!r) return
  const j = i + d
  if (j < 0 || j >= r.themes.length) return
  const [t] = r.themes.splice(i, 1)
  r.themes.splice(j, 0, t)
  if (sel.theme === i) sel.theme = j
  else if (sel.theme === j) sel.theme = i
  touch()
}

// ── вопросы ──
function newQuestion(price: number): PackQuestion {
  return { price, type: 'normal', content: [{ type: 'text', text: '' }], answer: '', answerContent: [], comment: '' }
}

function addQuestion(ti: number) {
  const r = round.value
  if (!r) return
  const t = r.themes[ti]
  const prices = t.questions.map((q) => q.price)
  const step = prices.length >= 2 ? prices[prices.length - 1] - prices[prices.length - 2] : 100 * (roundIndex.value + 1)
  const last = prices[prices.length - 1] ?? 0
  const price = r.type === 'final' ? 0 : Math.max(0, last + (step > 0 ? step : 100))
  t.questions.push(newQuestion(price))
  sel.theme = ti
  sel.question = t.questions.length - 1
  touch()
}

function selectQuestion(ti: number, qi: number) {
  sel.theme = ti
  sel.question = qi
}

function removeQuestion() {
  const t = theme.value
  if (!t || sel.question < 0) return
  if (!confirm('Удалить этот вопрос?')) return
  t.questions.splice(sel.question, 1)
  sel.question = Math.min(sel.question, t.questions.length - 1)
  touch()
}

function moveQuestion(d: -1 | 1) {
  const t = theme.value
  if (!t) return
  const i = sel.question
  const j = i + d
  if (j < 0 || j >= t.questions.length) return
  const [q] = t.questions.splice(i, 1)
  t.questions.splice(j, 0, q)
  sel.question = j
  touch()
}

function setType(type: QType) {
  const q = question.value
  if (!q) return
  q.type = type
  if (type === 'cat') {
    q.catTheme ??= ''
    q.catPrice ??= q.price
    q.catSelf ??= false
  }
  touch()
}

function preview(q: PackQuestion) {
  const t = contentText(q.content).trim()
  if (t) return t.length > 60 ? `${t.slice(0, 58)}…` : t
  const m = q.content.find((c) => c.type !== 'text')
  return m ? `[${{ image: 'картинка', audio: 'звук', video: 'видео' }[m.type as 'image' | 'audio' | 'video']}]` : '(пусто)'
}

const warnings = computed(() => {
  const out: string[] = []
  const p = pack.value
  if (!p) return out
  if (!p.rounds.length) out.push('В пакете нет раундов.')
  p.rounds.forEach((r) => {
    if (!r.themes.length) out.push(`Раунд «${r.name}»: нет тем.`)
    r.themes.forEach((t) => {
      if (!t.questions.length) out.push(`«${r.name}» → «${t.name}»: нет вопросов (тема не попадёт в игру).`)
      if (r.type === 'final' && t.questions.length > 1) out.push(`Финал → «${t.name}»: в игре используется только первый вопрос темы.`)
      t.questions.forEach((q, i) => {
        if (!q.answer.trim()) out.push(`«${r.name}» → «${t.name}» → вопрос ${i + 1}: не указан ответ.`)
        if (!q.content.some((c) => (c.type === 'text' ? !!c.text?.trim() : !!c.src))) {
          out.push(`«${r.name}» → «${t.name}» → вопрос ${i + 1}: пустой вопрос.`)
        }
      })
    })
  })
  return out.slice(0, 12)
})

const exportUrl = computed(() => downloadUrl(`/packs/${encodeURIComponent(packId.value)}/export`))
</script>

<template>
  <div class="editor">
    <header class="bar">
      <a class="btn small ghost" href="/host"><Icon name="arrowLeft" /> Панель ведущего</a>
      <div class="grow title-wrap">
        <input v-if="pack" v-model="pack.title" class="input title" :readonly="readonly" placeholder="Название пакета" @input="touch" />
      </div>
      <span v-if="message" class="msg">{{ message }}</span>
      <span v-else-if="dirty" class="muted small">есть несохранённые изменения</span>
      <button v-if="!readonly" class="btn primary" :disabled="!dirty || saving" @click="save">
        <Icon name="save" /> {{ saving ? 'Сохраняю…' : 'Сохранить' }} <span class="kbd">Ctrl+S</span>
      </button>
      <a class="btn small" :href="exportUrl" title="Скачать пакет в .zip"><Icon name="download" /> Экспорт</a>
      <button class="btn small" @click="playThis"><Icon name="play" /> Играть</button>
    </header>

    <div v-if="error" class="card err-card">
      <p>{{ error }}</p>
      <a class="btn" href="/host">Вернуться</a>
    </div>

    <div v-else-if="!pack" class="muted pad">Загрузка…</div>

    <div v-else class="body">
      <div v-if="readonly" class="ro card">
        Это встроенный пакет — его нельзя изменить.
        <button class="btn primary small" @click="makeCopy"><Icon name="copy" /> Сделать копию для редактирования</button>
      </div>

      <div class="meta">
        <label class="field">
          <span>Автор</span>
          <input v-model="pack.author" class="input" :readonly="readonly" @input="touch" />
        </label>
        <label class="field grow">
          <span>Описание</span>
          <input v-model="pack.description" class="input" :readonly="readonly" @input="touch" />
        </label>
      </div>

      <div class="cols">
        <!-- Раунды -->
        <aside class="rounds card">
          <div class="label">Раунды</div>
          <div
            v-for="(r, i) in pack.rounds"
            :key="i"
            class="round"
            :class="{ on: i === roundIndex, final: r.type === 'final' }"
            @click="selectRound(i)"
          >
            <span class="grow ellipsis">{{ r.name }}</span>
            <span class="faint small" :title="`Тем: ${r.themes.length}`">{{ r.themes.length }}</span>
          </div>
          <template v-if="!readonly">
            <button class="btn small ghost" @click="addRound('normal')"><Icon name="plus" /> Раунд</button>
            <button class="btn small ghost" @click="addRound('final')"><Icon name="plus" /> Финал</button>
          </template>
          <div v-if="warnings.length" class="warnings">
            <div class="label">Проверка</div>
            <div v-for="(w, i) in warnings" :key="i" class="warn small">{{ w }}</div>
          </div>
        </aside>

        <!-- Темы раунда -->
        <section v-if="round" class="themes">
          <div class="round-head card">
            <label class="field grow">
              <span>Название раунда</span>
              <input v-model="round.name" class="input" :readonly="readonly" @input="touch" />
            </label>
            <label class="field">
              <span>Тип</span>
              <select v-model="round.type" class="select" :disabled="readonly" @change="touch">
                <option value="normal">Обычный (табло)</option>
                <option value="final">Финал (ставки)</option>
              </select>
            </label>
            <div v-if="!readonly" class="round-acts">
              <button class="btn small ghost icon" title="Раунд раньше" @click="moveRound(roundIndex, -1)"><Icon name="up" /></button>
              <button class="btn small ghost icon" title="Раунд позже" @click="moveRound(roundIndex, 1)"><Icon name="down" /></button>
              <button class="btn small ghost icon" title="Удалить раунд" @click="removeRound(roundIndex)"><Icon name="trash" /></button>
            </div>
          </div>
          <p v-if="round.type === 'final'" class="muted small">
            В финале каждая тема — один вопрос. Игроки убирают темы, пока не останется одна, делают ставки и пишут ответ на телефоне.
          </p>

          <div v-for="(t, ti) in round.themes" :key="ti" class="theme card" :class="{ on: sel.theme === ti }">
            <div class="theme-head">
              <input v-model="t.name" class="input theme-name" :readonly="readonly" placeholder="Тема" @input="touch" />
              <template v-if="!readonly">
                <button class="btn small flat icon" title="Выше" @click="moveTheme(ti, -1)"><Icon name="up" /></button>
                <button class="btn small flat icon" title="Ниже" @click="moveTheme(ti, 1)"><Icon name="down" /></button>
                <button class="btn small flat icon" title="Удалить тему" @click="removeTheme(ti)"><Icon name="trash" /></button>
              </template>
            </div>
            <div class="qs">
              <button
                v-for="(q, qi) in t.questions"
                :key="qi"
                class="q-chip"
                :class="{ on: sel.theme === ti && sel.question === qi, special: q.type !== 'normal', empty: !q.answer.trim() }"
                :title="preview(q)"
                @click="selectQuestion(ti, qi)"
              >
                <b class="nums">{{ round.type === 'final' ? 'Вопрос' : q.price }}</b>
                <span class="ellipsis q-prev">{{ preview(q) }}</span>
              </button>
              <button v-if="!readonly && (round.type !== 'final' || !t.questions.length)" class="btn small ghost" @click="addQuestion(ti)">
                <Icon name="plus" /> Вопрос
              </button>
            </div>
          </div>
          <button v-if="!readonly" class="btn ghost" @click="addTheme"><Icon name="plus" /> Добавить тему</button>
        </section>
        <section v-else class="themes muted">Добавьте раунд.</section>

        <!-- Вопрос -->
        <aside class="qedit card">
          <template v-if="question && theme && round">
            <div class="q-top">
              <div class="label grow">{{ theme.name }} · вопрос {{ sel.question + 1 }}</div>
              <template v-if="!readonly">
                <button class="btn small flat icon" title="Раньше" @click="moveQuestion(-1)"><Icon name="up" /></button>
                <button class="btn small flat icon" title="Позже" @click="moveQuestion(1)"><Icon name="down" /></button>
                <button class="btn small flat icon" title="Удалить вопрос" @click="removeQuestion"><Icon name="trash" /></button>
              </template>
            </div>
            <div v-if="round.type !== 'final'" class="row2">
              <label class="field">
                <span>Цена</span>
                <input v-model.number="question.price" class="input" type="number" min="0" :readonly="readonly" @input="touch" />
              </label>
              <label class="field">
                <span>Тип</span>
                <select class="select" :value="question.type" :disabled="readonly" @change="setType(($event.target as HTMLSelectElement).value as QType)">
                  <option v-for="(label, key) in TYPE_LABEL" :key="key" :value="key">{{ label }}</option>
                </select>
              </label>
            </div>
            <div v-if="question.type === 'cat' && round.type !== 'final'" class="cat card">
              <label class="field">
                <span>Тема кота в мешке (что увидят игроки)</span>
                <input v-model="question.catTheme" class="input" :readonly="readonly" @input="touch" />
              </label>
              <label class="field">
                <span>Стоимость кота</span>
                <input v-model.number="question.catPrice" class="input" type="number" min="0" :readonly="readonly" @input="touch" />
              </label>
              <label class="check">
                <input v-model="question.catSelf" type="checkbox" :disabled="readonly" @change="touch" />
                Можно оставить себе
              </label>
            </div>
            <p v-if="question.type === 'auction'" class="muted small">Аукцион: игроки торгуются, ведущий отмечает победителя и ставку.</p>
            <p v-if="question.type === 'norisk'" class="muted small">Без риска: отвечает выбравший; верно — двойная цена, ошибка без штрафа.</p>

            <div class="label">Вопрос</div>
            <ContentEditor :items="question.content" :pack-id="packId" :readonly="readonly" @change="touch" @error="flash" />

            <label class="field">
              <span>Правильный ответ</span>
              <input v-model="question.answer" class="input answer" :readonly="readonly" @input="touch" />
            </label>
            <div class="label">Показать вместе с ответом (необязательно)</div>
            <ContentEditor :items="question.answerContent" :pack-id="packId" :readonly="readonly" @change="touch" @error="flash" />
            <label class="field">
              <span>Комментарий для ведущего (игроки не видят)</span>
              <textarea v-model="question.comment" class="textarea" rows="2" :readonly="readonly" @input="touch" />
            </label>
          </template>
          <p v-else class="muted">Выберите вопрос в теме или добавьте новый.</p>
        </aside>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.bar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--bg-2);
  border-bottom: 1px solid var(--line);
  flex-wrap: wrap;
}
.title-wrap {
  min-width: 200px;
}
.title {
  font-size: 1.15rem;
  font-weight: 800;
}
.msg {
  color: var(--accent);
  font-weight: 700;
}
.small {
  font-size: 0.82rem;
}
.pad {
  padding: 20px;
}
.err-card {
  margin: 20px;
}
.body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ro {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  border-color: var(--warn);
}
.meta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.meta .field:first-child {
  width: 260px;
}
.cols {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr) minmax(320px, 420px);
  gap: 12px;
  align-items: start;
}
.rounds {
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: sticky;
  top: 64px;
}
.round {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--panel-2);
  cursor: pointer;
  font-weight: 700;
}
.round.on {
  background: var(--accent);
  color: var(--accent-text);
}
.round.on .faint {
  color: var(--accent-text);
}
.round.final:not(.on) {
  border: 1px solid rgba(255, 200, 61, 0.4);
}
.warnings {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.warn {
  color: #ffd08a;
}
.themes {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.round-head {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: flex-end;
}
.round-acts {
  display: flex;
  gap: 4px;
  padding-bottom: 2px;
}
.theme.on {
  border-color: rgba(255, 200, 61, 0.5);
}
.theme-head {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
}
.theme-name {
  font-weight: 800;
}
.qs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.q-chip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 150px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid var(--board-edge);
  background: linear-gradient(180deg, var(--board), var(--board-2));
  color: var(--text);
  cursor: pointer;
  text-align: left;
}
.q-chip b {
  color: var(--accent);
}
.q-chip.on {
  outline: 2px solid var(--accent);
}
.q-chip.special {
  background: linear-gradient(180deg, #3b2a8f, #241a5c);
}
.q-chip.empty {
  border-color: var(--warn);
}
.q-prev {
  width: 100%;
  font-size: 0.78rem;
  color: var(--muted);
}
.qedit {
  display: flex;
  flex-direction: column;
  gap: 10px;
  position: sticky;
  top: 64px;
  max-height: calc(100vh - 80px);
  overflow-y: auto;
}
.q-top {
  display: flex;
  align-items: center;
  gap: 4px;
}
.row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.cat {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: color-mix(in srgb, #6d55ff 10%, var(--panel));
}
.answer {
  font-weight: 800;
  color: var(--accent);
}
@media (max-width: 1100px) {
  .cols {
    grid-template-columns: 1fr;
  }
  .rounds,
  .qedit {
    position: static;
    max-height: none;
  }
}
</style>
