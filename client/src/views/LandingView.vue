<script setup lang="ts">
// Главная страница сервера комнат: войти в игру по коду или создать свою комнату и стать ведущим.
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiRoot, setHostKey } from '../lib/api'
import { formatCode, forgetRoom, myRooms, normalizeCode, rememberRoom, serverMeta, type MyRoom } from '../lib/room'
import { plural } from '../lib/util'
import Icon from '../components/Icon.vue'

const router = useRouter()
const route = useRoute()

const codeInput = ref(formatCode(normalizeCode(String(route.query.code ?? ''))))
const code = computed(() => normalizeCode(codeInput.value))
const joinError = ref('')
const joining = ref(false)
const creating = ref(false)
const createError = ref('')
const mine = ref<MyRoom[]>(myRooms())

function onCodeInput(e: Event) {
  const el = e.target as HTMLInputElement
  const digits = normalizeCode(el.value)
  codeInput.value = digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits
  // Если введена не цифра, значение не изменилось и Vue не перерисует поле — поправляем сами.
  if (el.value !== codeInput.value) el.value = codeInput.value
  joinError.value = ''
}

async function checkRoom(c: string): Promise<boolean> {
  try {
    await apiRoot('GET', `/rooms/${c}`)
    return true
  } catch (e) {
    joinError.value = (e as Error).message
    return false
  }
}

async function enter(as: 'player' | 'screen') {
  if (code.value.length !== 6 || joining.value) {
    joinError.value = 'Код комнаты — 6 цифр'
    return
  }
  joining.value = true
  joinError.value = ''
  try {
    if (!(await checkRoom(code.value))) return
    await router.push(as === 'screen' ? `/r/${code.value}/screen` : `/r/${code.value}`)
  } finally {
    joining.value = false
  }
}

async function create() {
  if (creating.value) return
  creating.value = true
  createError.value = ''
  try {
    const res = await apiRoot<{ code: string; hostKey: string }>('POST', '/rooms', {})
    setHostKey(res.hostKey, res.code)
    rememberRoom(res.code)
    await router.push(`/r/${res.code}/host`)
  } catch (e) {
    createError.value = (e as Error).message
  } finally {
    creating.value = false
  }
}

function forget(c: string) {
  if (!confirm(`Убрать комнату ${formatCode(c)} из списка? Сама комната на сервере останется до автоматического удаления.`)) return
  forgetRoom(c)
  mine.value = myRooms()
}

function ago(ts: number): string {
  const min = Math.max(0, Math.round((Date.now() - ts) / 60000))
  if (min < 1) return 'только что'
  if (min < 60) return `${min} ${plural(min, 'минуту', 'минуты', 'минут')} назад`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} ${plural(h, 'час', 'часа', 'часов')} назад`
  const d = Math.round(h / 24)
  return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`
}

// Убираем из списка комнаты, которые сервер уже удалил.
onMounted(async () => {
  for (const r of mine.value.slice(0, 10)) {
    try {
      await apiRoot('GET', `/rooms/${r.code}`)
    } catch (e) {
      if (/не найдена/i.test((e as Error).message)) forgetRoom(r.code)
    }
  }
  mine.value = myRooms()
})
</script>

<template>
  <div class="landing scroll">
    <div class="wrap">
      <header class="hero">
        <div class="logo-buzz" />
        <h1>Своя игра · Брейн-ринг · Хамса</h1>
        <p class="muted">Телефоны игроков — кнопки, экран — табло. В одной комнате или через интернет.</p>
      </header>

      <section class="card block">
        <h2>Войти в игру</h2>
        <form class="code-form" @submit.prevent="enter('player')">
          <input
            class="input code-input nums"
            :value="codeInput"
            inputmode="numeric"
            autocomplete="off"
            enterkeyhint="go"
            placeholder="000 000"
            aria-label="Код комнаты"
            maxlength="7"
            @input="onCodeInput"
          />
          <button class="btn primary big" type="submit" :disabled="joining">
            Войти <Icon name="arrowRight" />
          </button>
        </form>
        <p class="muted small">Код комнаты подскажет ведущий — он виден на его экране.</p>
        <p v-if="joinError" class="err">{{ joinError }}</p>
        <button class="linkish small" type="button" :disabled="joining" @click="enter('screen')">
          <Icon name="monitor" /> Открыть эту игру как экран для зрителей
        </button>
      </section>

      <section class="card block">
        <h2>Провести игру</h2>
        <p class="muted">
          Создайте комнату — вы станете ведущим. Покажите игрокам код и читайте вопросы со своего листа.
        </p>
        <button class="btn big host-btn" :disabled="creating" @click="create">
          <Icon name="plus" /> {{ creating ? 'Создаём…' : 'Создать комнату' }}
        </button>
        <p v-if="createError" class="err">{{ createError }}</p>

        <div v-if="mine.length" class="mine">
          <div class="label">Мои комнаты</div>
          <div v-for="r in mine" :key="r.code" class="mine-row">
            <div class="grow">
              <b class="nums room-code">{{ formatCode(r.code) }}</b>
              <div class="faint small">создана {{ ago(r.createdAt) }}</div>
            </div>
            <RouterLink class="btn small" :to="`/r/${r.code}/host`">Ведущий</RouterLink>
            <a class="btn small ghost" :href="`/r/${r.code}/screen`" target="_blank" rel="noopener">Экран</a>
            <button class="btn small flat icon" title="Убрать из списка" @click="forget(r.code)"><Icon name="x" /></button>
          </div>
        </div>
      </section>

      <section class="how">
        <div class="step">
          <b>1</b>
          <span>Ведущий создаёт комнату и выбирает игру. Вопросы он читает со своего листа — программа ведёт кнопки, время и счёт.</span>
        </div>
        <div class="step">
          <b>2</b>
          <span>Игроки открывают этот сайт на телефонах и вводят код — или сканируют QR-код с экрана.</span>
        </div>
        <div class="step">
          <b>3</b>
          <span>Экран с табло — на телевизоре, проекторе или в демонстрации экрана в видеозвонке.</span>
        </div>
      </section>

      <footer class="faint small">{{ serverMeta.version ? `Версия ${serverMeta.version}` : '' }}</footer>
    </div>
  </div>
</template>

<style scoped>
.landing {
  height: 100vh;
  height: 100dvh;
  background:
    radial-gradient(70vw 40vh at 10% -5%, rgba(99, 102, 241, 0.16), transparent 70%),
    radial-gradient(60vw 40vh at 100% 0%, rgba(236, 72, 153, 0.1), transparent 70%),
    var(--bg);
}
.wrap {
  max-width: 560px;
  margin: 0 auto;
  padding: max(24px, env(safe-area-inset-top)) 16px 32px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.hero {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.hero h1 {
  font-size: clamp(1.6rem, 6vw, 2.3rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  margin: 10px 0 0;
  background: linear-gradient(100deg, #4f46e5, #7c3aed 60%, #db2777);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hero p {
  margin: 0;
}
.logo-buzz {
  width: 72px;
  height: 72px;
  border-radius: 20px;
  background: url('/favicon.svg') center / contain no-repeat;
  box-shadow: 0 18px 34px -14px rgba(79, 70, 229, 0.7);
}
.block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.block h2 {
  margin: 0;
  font-size: 1.3rem;
  font-weight: 800;
}
.block p {
  margin: 0;
}
.code-form {
  display: flex;
  gap: 10px;
}
.code-input {
  flex: 1;
  min-width: 0;
  font-size: 1.9rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-align: center;
  padding: 10px 12px;
}
.host-btn {
  align-self: flex-start;
}
.err {
  color: var(--bad);
}
.small {
  font-size: 0.85rem;
}
.linkish {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  padding: 2px 0;
  color: var(--accent);
  font-weight: 600;
  cursor: pointer;
}
.linkish:disabled {
  opacity: 0.6;
}
.mine {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 6px;
}
.mine-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 12px;
  background: var(--panel-2);
  border: 1px solid var(--line);
}
.room-code {
  font-size: 1.15rem;
  letter-spacing: 0.06em;
}
.how {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 4px;
}
.step {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  color: var(--muted);
}
.step b {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  background: var(--accent-soft);
  color: var(--accent);
}
footer {
  text-align: center;
}
</style>
