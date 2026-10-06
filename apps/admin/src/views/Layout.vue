<template>
  <el-container class="lay">
    <el-aside width="224px" class="lay__aside">
      <div class="lay__brand">
        <span class="lay__mark" aria-hidden="true">悟</span>
        <span class="lay__brand-text">
          <b>悟空数学</b>
          <i>管理后台</i>
        </span>
      </div>

      <el-menu :default-active="active" router class="lay__menu">
        <el-menu-item index="/">
          <el-icon><Odometer /></el-icon>
          <span>概览</span>
        </el-menu-item>
        <el-menu-item index="/tree">
          <el-icon><Share /></el-icon>
          <span>知识结构</span>
        </el-menu-item>
        <!-- 菜单按权限显隐。注意：**这只是显隐**，真正的放行在服务端（requirePerm）——
             前端藏一个入口不算权限，直接敲地址照样要被 403 挡住。 -->
        <el-menu-item v-if="can('plan.write')" index="/plans">
          <el-icon><Money /></el-icon>
          <span>套餐与权益</span>
        </el-menu-item>
        <el-menu-item v-if="can('user.read')" index="/users">
          <el-icon><User /></el-icon>
          <span>用户</span>
        </el-menu-item>
      </el-menu>

      <div class="lay__foot">
        <p class="lay__foot-line">带后台版 v1.7</p>
        <p class="lay__foot-line">接口 {{ apiBase }}</p>
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
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Odometer, Share, User, Money } from '@element-plus/icons-vue';
import { api, auth, can, API_BASE } from '../api';

const route = useRoute();
const router = useRouter();
const active = computed(() => route.path);
const title = computed(() => (route.meta.title as string) || '');
const apiBase = API_BASE;

async function logout(): Promise<void> {
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* 登出失败也照样回登录页 */ }
  auth.user = null;
  await router.replace('/login');
}
</script>

<style scoped>
.lay { min-height: 100vh; }

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
</style>
