import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./views/PlayerView.vue'), meta: { title: 'Игрок' } },
    { path: '/host', component: () => import('./views/HostView.vue'), meta: { title: 'Ведущий' } },
    { path: '/screen', component: () => import('./views/ScreenView.vue'), meta: { title: 'Экран' } },
    { path: '/editor/:id', component: () => import('./views/EditorView.vue'), meta: { title: 'Редактор пакета' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.afterEach((to) => {
  document.title = `${to.meta.title ?? 'Игра'} · Своя игра / Брейн-ринг`
})
