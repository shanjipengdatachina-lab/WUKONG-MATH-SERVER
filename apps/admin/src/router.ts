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
      { path: 'classes', name: 'classes', component: () => import('./views/Classes.vue'), meta: { title: '班级', perm: 'class.read' } },
      { path: 'classes/:id', name: 'class-detail', component: () => import('./views/ClassDetail.vue'), meta: { title: '班级详情', perm: 'class.read' } },
      /* 一个学生的全部情况。**只读** —— 角色/停用仍在列表页那一行上改。 */
      { path: 'users/:id', name: 'user-detail', component: () => import('./views/UserDetail.vue'), meta: { title: '学生详情', perm: 'user.read' } },
      { path: 'orders', name: 'orders', component: () => import('./views/Orders.vue'), meta: { title: '订单', perm: 'order.read' } },
      { path: 'finance', name: 'finance', component: () => import('./views/Finance.vue'), meta: { title: '财务', perm: 'order.read' } },
      { path: 'exams', name: 'exams', component: () => import('./views/ExamBank.vue'), meta: { title: '真题题库', perm: 'exam.read' } },
      { path: 'plans', name: 'plans', component: () => import('./views/Plans.vue'), meta: { title: '套餐与服务项目', perm: 'plan.write' } },
      { path: 'forum', name: 'forum', component: () => import('./views/Forum.vue'), meta: { title: '论坛', perm: 'forum.read' } },
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
