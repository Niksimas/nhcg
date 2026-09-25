<script setup lang="ts">
// Как подключиться: крупный QR-код, выбор сетевого адреса, подсказки на случай проблем.
import { computed } from 'vue'
import QrCode from '../../components/QrCode.vue'
import { useHost } from './ctx'

const { state, run } = useHost()
const s = computed(() => state.value!)
const server = computed(() => s.value.server)
const current = computed(() => {
  const m = /^http:\/\/([^/:]+)/.exec(s.value.joinUrl)
  return m?.[1] ?? ''
})

function choose(address: string) {
  void run('settings.update', { patch: { joinAddress: address } })
}
</script>

<template>
  <div class="join">
    <div class="main">
      <QrCode class="qr" :text="s.joinUrl" />
      <div class="url">{{ s.joinUrl }}</div>
    </div>

    <div v-if="server && server.addresses.length > 1" class="field">
      <span>У компьютера несколько сетей. Выберите ту, к которой подключены телефоны:</span>
      <div class="addrs">
        <button
          v-for="a in server.addresses"
          :key="a.address"
          class="btn small"
          :class="{ primary: a.address === current }"
          @click="choose(a.address)"
        >
          {{ a.address }} <span class="faint">({{ a.name }})</span>
        </button>
      </div>
    </div>
    <p v-if="server && !server.addresses.length" class="warn">
      Компьютер не подключён ни к одной сети. Подключитесь к Wi-Fi или включите на компьютере мобильный хот-спот.
    </p>

    <details class="help">
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
      </ul>
    </details>

    <div v-if="server" class="remote">
      <div class="label">Управлять игрой с другого устройства (планшета, ноутбука)</div>
      <div class="remote-row">
        <QrCode class="qr-small" :text="server.hostUrl" />
        <div>
          <p class="muted small">Откройте этот адрес на устройстве ведущего. Не показывайте его игрокам — через него видны ответы.</p>
          <code class="code">{{ server.hostUrl }}</code>
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
