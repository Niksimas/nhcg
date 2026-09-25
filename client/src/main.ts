import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { loadServerMeta } from './lib/room'
import '@fontsource-variable/manrope'
import './styles/base.css'

// Сначала узнаём режим сервера (одна игра или комнаты) — от него зависит главная страница.
void loadServerMeta().then(() => {
  createApp(App).use(router).mount('#app')
})
