<template>
  <el-container class="lay">
    <el-aside width="224px" class="lay__aside">
      <div class="lay__brand">
        <span class="lay__mark" aria-hidden="true">悟</span>
        <span class="lay__brand-text">
          <b>悟空数学</b>
          <i>初中试点 · 管理后台</i>
        </span>
        <el-button class="lay__nav-toggle" :icon="Menu" aria-label="切换导航" :aria-expanded="mobileMenuOpen" @click="mobileMenuOpen = !mobileMenuOpen" />
      </div>

      <el-menu :default-active="active" :default-openeds="openGroups" router class="lay__menu" :class="{ 'lay__menu--open': mobileMenuOpen }" @select="mobileMenuOpen = false">
        <el-menu-item index="/">
          <el-icon><Odometer /></el-icon>
          <span>工作台</span>
        </el-menu-item>

        <!-- 菜单按权限显隐。注意：**这只是显隐**，真正的放行仍在服务端（requirePerm）。 -->
        <el-sub-menu index="content">
          <template #title><el-icon><Share /></el-icon><span>教学内容</span></template>
          <el-menu-item index="/tree">课程与知识结构</el-menu-item>
          <el-menu-item v-if="can('exam.read')" index="/exams">真题资源库</el-menu-item>
        </el-sub-menu>

        <el-sub-menu v-if="can('class.read') || can('user.read')" index="learners">
          <template #title><el-icon><School /></el-icon><span>学员与班级</span></template>
          <el-menu-item v-if="can('class.read')" index="/classes">班级与花名册</el-menu-item>
          <el-menu-item v-if="can('user.read')" index="/users">学生与账号</el-menu-item>
        </el-sub-menu>

        <el-sub-menu v-if="can('forum.read') || can('plan.write') || can('order.read')" index="operations">
          <template #title><el-icon><Coin /></el-icon><span>运营中心</span></template>
          <el-menu-item v-if="can('forum.read')" index="/forum">社区内容</el-menu-item>
          <el-menu-item v-if="can('plan.write')" index="/plans">套餐与权益</el-menu-item>
          <el-menu-item v-if="can('order.read')" index="/orders">订单</el-menu-item>
          <el-menu-item v-if="can('order.read')" index="/finance">财务分析</el-menu-item>
        </el-sub-menu>
        <el-sub-menu v-if="can('user.read')" index="system">
          <template #title><el-icon><Setting /></el-icon><span>系统与权限</span></template>
          <el-menu-item index="/system">角色与权限概况</el-menu-item>
        </el-sub-menu>
      </el-menu>

      <div class="lay__foot">
        <p class="lay__foot-line">初中试点版</p>
        <el-tag v-if="isDemo" size="small" type="warning" effect="plain">演示账号</el-tag>
      </div>
    </el-aside>

    <el-container class="lay__right">
      <el-header class="lay__head">
        <div class="lay__head-left">
          <h1 class="lay__title">{{ title }}</h1>
          <span class="lay__crumb">悟空数学 · 后台 / {{ title }}</span>
        </div>
        <div class="lay__who">
          <span class="lay__avatar" aria-hidden="true">{{ (auth.user?.nickname || '?').charAt(0) }}</span>
          <span class="lay__who-text">
            <b>{{ auth.user?.nickname }}</b>
            <i>{{ auth.user?.role }} · @{{ auth.user?.username }}</i>
          </span>
          <el-button link type="primary" data-qa="logout" @click="logout">退出</el-button>
        </div>
      </el-header>

      <el-main class="lay__main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Odometer, Share, Coin, School, Setting, Menu } from '@element-plus/icons-vue';
import { api, auth, can } from '../api';

const route = useRoute();
const router = useRouter();
const mobileMenuOpen = ref(false);
/* 菜单高亮看**第一段**：在 /users/144 这类子页面上，「用户」那一条也该亮着 ——
   直接拿 route.path 去比的话，一进详情页左侧就没有任何一项是选中的。 */
const active = computed(() => {
  const seg = route.path.split('/').filter(Boolean)[0];
  return seg ? `/${seg}` : '/';
});
const title = computed(() => (route.meta.title as string) || '');
const openGroups = ['content', 'learners', 'operations', 'system'];
const isDemo = computed(() => ['admin', 'teacher', 'student', 'zhouyutong', 'chenzihang'].includes(auth.user?.username || ''));

async function logout(): Promise<void> {
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* 登出失败也照样回登录页 */ }
  auth.user = null;
  await router.replace('/login');
}
</script>

<style scoped>
.lay { min-height: 100vh; }
.lay__nav-toggle { display: none; margin-left: auto; }

/* ---- 左侧 ---- */
.lay__aside {
  display: flex;
  flex-direction: column;
  background: var(--admin-surface);
  border-right: 1px solid var(--admin-line);
}
.lay__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 60px;
  padding: 0 18px;
  border-bottom: 1px solid var(--admin-line-soft);
}
.lay__mark {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
}
.lay__brand-text { display: flex; flex-direction: column; line-height: 1.25; }
.lay__brand-text b { font-size: 14px; color: var(--admin-ink); }
.lay__brand-text i { font-size: 12px; font-style: normal; color: var(--admin-ink-3); }

.lay__menu { flex: 1; border-right: none; padding: 10px 8px; }
.lay__menu :deep(.el-menu-item) {
  height: 40px;
  line-height: 40px;
  margin-bottom: 2px;
  border-radius: 8px;
  color: var(--admin-ink-2);
}
.lay__menu :deep(.el-menu-item:hover) { background: #f4f5f7; color: var(--admin-ink); }
.lay__menu :deep(.el-menu-item.is-active) {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}

.lay__foot { padding: 14px 18px; border-top: 1px solid var(--admin-line-soft); }
.lay__foot-line { margin: 0 0 4px; font-size: 12px; color: var(--admin-ink-3); }
.lay__foot-line:last-child { margin-bottom: 0; overflow-wrap: anywhere; }

/* ---- 右侧 ---- */
.lay__right { background: var(--admin-canvas); }
.lay__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 60px;
  padding: 0 24px;
  background: var(--admin-surface);
  border-bottom: 1px solid var(--admin-line);
}
.lay__head-left { display: flex; flex-direction: column; gap: 2px; }
.lay__title { margin: 0; font-size: 16px; font-weight: 600; color: var(--admin-ink); }
.lay__crumb { font-size: 12px; color: var(--admin-ink-3); }

.lay__who { display: inline-flex; align-items: center; gap: 10px; }
.lay__avatar {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 999px;
  background: var(--el-color-primary-light-8);
  color: var(--el-color-primary-dark-2);
  font-size: 13px;
  font-weight: 600;
}
.lay__who-text { display: flex; flex-direction: column; line-height: 1.3; }
.lay__who-text b { font-size: 13px; color: var(--admin-ink); }
.lay__who-text i { font-size: 12px; font-style: normal; color: var(--admin-ink-3); }

.lay__main { padding: 20px 24px 32px; }
@media (max-width: 700px) {
  .lay { flex-direction: column; }
  .lay__aside { width: 100% !important; border-right: none; border-bottom: 1px solid var(--admin-line); }
  .lay__brand { height: 54px; }
  .lay__menu { padding: 4px 8px; }
  .lay__menu:not(.lay__menu--open) { display: none; }
  .lay__nav-toggle { display: inline-flex; }
  .lay__foot { display: none; }
  .lay__right { min-width: 0; }
  .lay__head { padding: 12px; height: auto; gap: 8px; flex-wrap: wrap; }
  .lay__main { padding: 16px 12px; }
}
</style>
