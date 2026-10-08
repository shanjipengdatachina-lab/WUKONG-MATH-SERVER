import { createRouter, createWebHistory } from 'vue-router';
import { auth, loadMe } from './api';

const routes = [
  { path: '/login', name: 'login', component: () => import('./views/Login.vue'), meta: { public: true } },
  {
    path: '/',
    component: () => import('./views/Layout.vue'),
    children: [
      { path: '', name: 'home', component: () => import('./views/Home.vue'), meta: { title: '工作台' } },
      { path: 'tree', name: 'tree', component: () => import('./views/Tree.vue'), meta: { title: '课程与知识内容' } },
      { path: 'system', name: 'system', component: () => import('./views/System.vue'), meta: { title: '系统与权限', perm: 'user.read' } },
      { path: 'users', name: 'users', component: () => import('./views/Users.vue'), meta: { title: '用户', perm: 'user.read' } },
      { path: 'classes', name: 'classes', component: () => import('./views/Classes.vue'), meta: { title: '班级', perm: 'class.read' } },
      { path: 'classes/:id', name: 'class-detail', component: () => import('./views/ClassDetail.vue'), meta: { title: '班级详情', perm: 'class.read' } },
      /* 一个学生的全部情况。**只读** —— 角色/停用仍在列表页那一行上改。 */
      { path: 'users/:id', name: 'user-detail', component: () => import('./views/UserDetail.vue'), meta: { title: '学生详情', perm: 'user.read' } },
      { path: 'orders', name: 'orders', component: () => import('./views/Orders.vue'), meta: { title: '订单', perm: 'order.read' } },
      { path: 'finance', name: 'finance', component: () => import('./views/Finance.vue'), meta: { title: '财务', perm: 'order.read' } },
      { path: 'exams', name: 'exams', component: () => import('./views/ExamBank.vue'), meta: { title: '真题资源库', perm: 'exam.read' } },
      { path: 'plans', name: 'plans', component: () => import('./views/Plans.vue'), meta: { title: '套餐与服务项目', perm: 'plan.write' } },
      { path: 'forum', name: 'forum', component: () => import('./views/Forum.vue'), meta: { title: '论坛', perm: 'forum.read' } },
    ],
  },
];

/* 后台侧的权限点 = 路由表里挂过 `meta.perm` 的那些。
   **从路由推导，不手写一份名单** —— 以后加后台页面，这里自动跟上，不会走散。
   （「概览」和「知识结构」两页本来就没挂 perm：前者拉的是 content.read 那份内容统计，
     后者读的是公开的 /api/tree —— 所以想拦人，只能拦在**外壳**这一层，
     而不是给这两页补 perm：补了反而会让老师一进后台就被弹回首页、来回打转。） */
const STAFF_PERMS: string[] = [];
for (const r of routes) {
  for (const c of (r as { children?: { meta?: { perm?: string } }[] }).children ?? []) {
    const p = c.meta?.perm;
    if (p) { STAFF_PERMS.push(p); }
  }
}

export const router = createRouter({ history: createWebHistory(import.meta.env.BASE_URL), routes });

/* 进每个页面前先确认"你是谁"。没登录 → 去登录页，并记住原来要去哪。 */
router.beforeEach(async (to) => {
  if (!auth.loaded) { await loadMe(); }
  if (to.meta.public) { return true; }
  if (!auth.user) { return { name: 'login', query: { returnTo: to.fullPath } }; }

  /* **不是后台的人，就别进这个外壳。**
     判据不是"角色名是不是 admin"，而是"手里有没有后台侧的权限" ——
     学生只有 content.read（一个学生端也有的权限），上面每一页的 perm 他都过不了。

     为什么这条非有不可：**cookie 是按主机共享的**。
     在 localhost:5173 用学生账号登过，这个后台（localhost:5174）会带着同一份 cookie 进来，
     `/api/me` 回的就是学生 —— 于是外壳照常渲染、概览页一屏 403 空面板。
     数据从来没漏（服务端每个接口自己拦，实测 /admin/users 与 /admin/stats/overview 都是 403），
     这条拦的是"外壳不该放他进来"。 */
  if (!auth.user.perms.some((p) => STAFF_PERMS.includes(p))) {
    /* 带上 denied=1：登录页据此说一句人话 ——
       否则"登录成功了但没进去"会让人以为是自己密码打错了。 */
    return { name: 'login', query: { returnTo: to.fullPath, denied: '1' } };
  }

  const need = to.meta.perm as string | undefined;
  if (need && !auth.user.perms.includes(need)) { return { name: 'home' }; }
  return true;
});
