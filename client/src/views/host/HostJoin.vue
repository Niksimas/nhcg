<script setup lang="ts">
// Как подключиться: крупный QR-код, код комнаты, выбор сетевого адреса, подсказки на случай проблем.
import { computed } from 'vue'
import QrCode from '../../components/QrCode.vue'
import { formatCode } from '../../lib/room'
import { useHost } from './ctx'

const { state, run } = useHost()
const s = computed(() => state.value!)
const server = computed(() => s.value.server)
const rooms = computed(() => s.value.room?.mode === 'rooms')
const code = computed(() => s.value.room?.code ?? '')
const site = computed(() => {
  try {
    return new URL(s.value.joinUrl).host
  } catch {
    return ''
  }
})
// Игроки подключаются по адресу в локальной сети (http://192.168.…) — нужны подсказки про Wi-Fi.
const lanIp = computed(() => /^http:\/\/(\d+\.\d+\.\d+\.\d+)(:\d+)?\//.exec(s.value.joinUrl)?.[1] ?? '')

function choose(address: string) {
  void run('settings.update', { patch: { joinAddress: address } })
}
function setOnline(ev: Event) {
  void run('settings.update', { patch: { onlineMode: (ev.target as HTMLInputElement).checked } })
}
</script>

<template>
  <div class="join">
    <div class="main">
      <QrCode class="qr" :text="s.joinUrl" />
      <template v-if="rooms">
        <div class="code-line">
          <span class="muted">Код комнаты</span>
          <b class="code-big nums">{{ formatCode(code) }}</b>
        </div>
        <div class="muted center-text">
          Игроки открывают <b class="site">{{ site }}</b> и вводят код — или сканируют QR-код.
        </div>
        <div class="url-small">{{ s.joinUrl }}</div>
      </template>
      <div v-else class="url">{{ s.joinUrl }}</div>
    </div>

    <label class="check">
      <input type="checkbox" :checked="s.settings.onlineMode" @change="setOnline" />
      <span>
        Игроки в разных местах (через интернет)
        <span class="muted">— кнопки загораются у всех одновременно, допуски на задержку связи больше</span>
      </span>
    </label>

    <div v-if="lanIp && server && server.addresses.length > 1" class="field">
      <span>У компьютера несколько сетей. Выберите ту, к которой подключены телефоны:</span>
      <div class="addrs">
        <button
          v-for="a in server.addresses"
          :key="a.address"
          class="btn small"
          :class="{ primary: a.address === lanIp }"
          @click="choose(a.address)"
        >
          {{ a.address }} <span class="faint">({{ a.name }})</span>
        </button>
      </div>
    </div>
    <p v-if="lanIp && server && !server.addresses.length" class="warn">
      Компьютер не подключён ни к одной сети. Подключитесь к Wi-Fi или включите на компьютере мобильный хот-спот.
    </p>

    <details v-if="lanIp" class="help">
      <summary>Телефоны не подключаются?</summary>
      <ul>
        <li>Телефоны и компьютер должны быть в <b>одной</b> Wi-Fi сети. Гостевые сети роутеров часто запрещают устройствам «видеть» друг друга — используйте основную сеть.</li>
        <li>
          <b>Windows:</b> при первом запуске разрешите Node.js доступ в сеть в окне брандмауэра. Если окно не появилось — откройте
          «Брандмауэр Защитника Windows → Разрешить взаимодействие с приложением» и отметьте Node.js для частных сетей.
          Проверьте, что сеть Wi-Fi помечена как <b>частная</b>, а не общественная.
        </li>
        <li>Нет роутера? Включите на компьютере «Мобильный хот-спот» и подключите к нему телефоны.</li>
        <li>Мобильный интернет на телефоне не мешает, но телефон должен быть подключён именно к этой Wi-Fi сети.</li>
        <li>Адрес вводите точно, начиная с <b>http://</b> (не https).</li>
        <li>Игроки в разных городах? Нужен сервер в интернете или туннель — см. раздел «Игра через интернет» в README.</li>
      </ul>
    </details>
    <details v-else class="help">
      <summary>Как играть через интернет</summary>
      <ul>
        <li>Игрокам нужен только интернет на телефоне и этот код. Включите «Игроки в разных местах».</li>
        <li>
          Вопросы читайте голосом в видеозвонке (Zoom, Telegram, Discord…) или покажите экран для зрителей через
          демонстрацию экрана: кнопка «Экран» вверху.
        </li>
        <li>Кнопки загораются у всех одновременно по сигналу на телефоне, а не по голосу ведущего — задержка видеосвязи у всех разная.</li>
        <li>Если кто-то нажимает «до сигнала» — у него «Рано!» (Своя игра) или фальстарт (Брейн-ринг), как и в зале.</li>
      </ul>
    </details>

    <div v-if="server" class="remote">
      <div class="label">Управлять игрой с другого устройства (планшета, ноутбука)</div>
      <div class="remote-row">
        <QrCode class="qr-small" :text="server.hostUrl" />
        <div>
          <p class="muted small">Откройте этот адрес на устройстве ведущего. Не показывайте его игрокам — через него видны ответы.</p>
          <code class="code">{{ server.hostUrl }}</code>
          <p class="muted small">Ключ ведущего: <b class="nums">{{ server.hostKey }}</b></p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.join {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.main {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.qr {
  width: min(340px, 80vw);
}
.url {
  font-size: 1.6rem;
  font-weight: 900;
  color: var(--accent);
  text-align: center;
  word-break: break-all;
}
.code-line {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.code-big {
  font-size: 2.6rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  color: var(--accent);
}
.center-text {
  text-align: center;
}
.site {
  color: var(--text);
}
.url-small {
  font-size: 0.85rem;
  color: var(--faint);
  word-break: break-all;
  text-align: center;
}
.addrs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.warn {
  color: #ffd08a;
}
.help summary {
  cursor: pointer;
  font-weight: 700;
}
.help ul {
  margin: 8px 0 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--muted);
}
.remote {
  border-top: 1px solid var(--line);
  padding-top: 12px;
}
.remote-row {
  display: flex;
  gap: 14px;
  align-items: center;
  margin-top: 8px;
}
.qr-small {
  width: 120px;
  flex: none;
}
.small {
  font-size: 0.85rem;
}
.code {
  display: block;
  font-size: 0.85rem;
  word-break: break-all;
  background: var(--bg-2);
  padding: 6px 8px;
  border-radius: 6px;
}
</style>
