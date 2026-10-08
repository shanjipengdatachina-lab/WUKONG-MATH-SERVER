<template>
  <section v-loading="loading">
    <div class="head"><h2>角色与权限概况</h2><el-tooltip content="刷新"><el-button :icon="Refresh" aria-label="刷新" @click="load" /></el-tooltip></div>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" />
    <el-table :data="roles">
      <el-table-column prop="name" label="角色" min-width="140" />
      <el-table-column prop="code" label="标识" min-width="120" />
      <el-table-column prop="users" label="账号数" width="100" />
    </el-table>
    <router-link to="/users">学生与账号管理</router-link>
    <h3>当前账号权限</h3>
    <div class="permissions"><el-tag v-for="p in auth.user?.perms" :key="p" effect="plain">{{ p }}</el-tag></div>
  </section>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { api, auth, type ApiError } from '../api';
const roles = ref<{ code: string; name: string; users: number }[]>([]);
const loading = ref(false);
const error = ref('');
async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try { roles.value = (await api<{ items: typeof roles.value }>('/admin/roles')).items; }
  catch (e) { error.value = (e as ApiError).message; }
  finally { loading.value = false; }
}
onMounted(load);
</script>
<style scoped>
.head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
h2 { font-size: 18px; margin: 0; }
h3 { font-size: 15px; margin-top: 28px; }
a { display: inline-block; font-size: 13px; margin-top: 16px; color: var(--el-color-primary); }
.permissions { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
