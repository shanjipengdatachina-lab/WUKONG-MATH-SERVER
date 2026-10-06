import { createRouter, createWebHistory } from 'vue-router';
import { auth, loadMe } from './api';

const routes = [
  { path: '/login', name: 'login', component: () => import('./views/Login.vue'), meta: { public: true } },
  {
    path: '/',
    component: () => import('./views/Layout.vue'),
    children: [
      { path: '', name: 'home', component: () => import('./views/Home.vue'), meta: { title: '概览' } },
      { path: 'tree', name: 'tree', component: () => import('./views/Tree.vue'), meta: { title: '知识结构' } },
      { path: 'users', name: 'users', component: () => import('./views/Users.vue'), meta: { title: '用户', perm: 'user.read' } },
    ],
  },
];

export const router = createRouter({ history: createWebHistory(), routes });

/* 进每个页面前先确认"你是谁"。没登录 → 去登录页，并记住原来要去哪。 */
router.beforeEach(async (to) => {
  if (!auth.loaded) { await loadMe(); }
  if (to.meta.public) { return true; }
  if (!auth.user) { return { name: 'login', query: { returnTo: to.fullPath } }; }
  const need = to.meta.perm as string | undefined;
  if (need && !auth.user.perms.includes(need)) { return { name: 'home' }; }
  return true;
});
