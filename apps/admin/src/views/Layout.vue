<template>
  <el-container class="lay">
    <el-aside width="216px" class="lay__aside">
      <div class="lay__brand">悟空数学 · 后台</div>
      <el-menu :default-active="active" router class="lay__menu">
        <el-menu-item index="/">概览</el-menu-item>
        <el-menu-item index="/tree">知识结构</el-menu-item>
        <!-- 菜单按权限显隐。注意：**这只是显隐**，真正的放行在服务端（requirePerm） -->
        <el-menu-item v-if="can('user.read')" index="/users">用户</el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="lay__head">
        <span class="lay__title">{{ title }}</span>
        <span class="lay__who">
          {{ auth.user?.nickname }}
          <el-tag size="small" type="info" class="lay__role">{{ auth.user?.role }}</el-tag>
          <el-button link type="primary" data-qa="logout" @click="logout">退出</el-button>
        </span>
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
import { api, auth, can } from '../api';

const route = useRoute();
const router = useRouter();
const active = computed(() => route.path);
const title = computed(() => (route.meta.title as string) || '');

async function logout(): Promise<void> {
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* 登出失败也照样回登录页 */ }
  auth.user = null;
  await router.replace('/login');
}
</script>

<style scoped>
.lay { min-height: 100vh; }
.lay__aside { background: #141821; border-right: 1px solid #232a38; }
.lay__brand { height: 56px; line-height: 56px; padding: 0 18px; font-weight: 600; color: #e8ecf4; }
.lay__menu { border-right: none; background: transparent; }
.lay__head { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #232a38; }
.lay__title { font-weight: 600; }
.lay__who { display: inline-flex; align-items: center; gap: 8px; }
.lay__role { margin-right: 4px; }
.lay__main { background: #0f131a; }
</style>
