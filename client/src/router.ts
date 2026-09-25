import { createRouter, createWebHistory } from 'vue-router'
import { serverMeta, setRoom } from './lib/room'

const Player = () => import('./views/PlayerView.vue')
const Host = () => import('./views/HostView.vue')
const Screen = () => import('./views/ScreenView.vue')
const Editor = () => import('./views/EditorView.vue')
const Landing = () => import('./views/LandingView.vue')

// Код комнаты — 6 цифр.
const CODE = ':code(\\d{6})'

// Адреса без кода комнаты есть только у сервера в режиме «одна игра».
const onlyLocal = () => (serverMeta.mode === 'rooms' ? '/' : true)

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    // Главная: в режиме одной игры — сразу вход для игрока, на сервере комнат — ввод кода или создание комнаты.
    { path: '/', component: () => (serverMeta.mode === 'rooms' ? Landing() : Player()), meta: { title: 'Игрок' } },
    { path: '/host', component: Host, beforeEnter: onlyLocal, meta: { title: 'Ведущий' } },
    { path: '/screen', component: Screen, beforeEnter: onlyLocal, meta: { title: 'Экран' } },
    { path: '/editor/:id', component: Editor, beforeEnter: onlyLocal, meta: { title: 'Редактор пакета' } },
    { path: `/r/${CODE}`, component: Player, meta: { title: 'Игрок' } },
    { path: `/r/${CODE}/host`, component: Host, meta: { title: 'Ведущий' } },
    { path: `/r/${CODE}/screen`, component: Screen, meta: { title: 'Экран' } },
    { path: `/r/${CODE}/editor/:id`, component: Editor, meta: { title: 'Редактор пакета' } },
    // Короткая ссылка: сайт/482915
    { path: `/${CODE}`, redirect: (to) => `/r/${to.params.code}` },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach((to) => {
  setRoom(typeof to.params.code === 'string' ? to.params.code : null)
})

router.afterEach((to) => {
  const title = to.path === '/' && serverMeta.mode === 'rooms' ? 'Главная' : (to.meta.title ?? 'Игра')
  document.title = `${title} · Своя игра / Брейн-ринг`
})
