<template>
  <el-card>
    <template #header>用户（{{ rows.length }}）</template>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="mb" />
    <el-table :data="rows" stripe>
      <el-table-column prop="id" label="#" width="70" />
      <el-table-column prop="username" label="账号" min-width="140" />
      <el-table-column prop="nickname" label="昵称" min-width="120" />
      <el-table-column prop="grade" label="年级" min-width="140" />
      <el-table-column prop="role" label="角色" width="110">
        <template #default="{ row }">
          <el-tag size="small" :type="row.role === 'admin' ? 'danger' : 'info'">{{ row.role }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="createdAt" label="注册时间" min-width="200" />
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, type ApiError } from '../api';

type Row = { id: number; username: string; nickname: string; grade: string | null; role: string; createdAt: string };
const rows = ref<Row[]>([]);
const error = ref('');

onMounted(async () => {
  try { rows.value = (await api<{ total: number; items: Row[] }>('/admin/users')).items; }
  catch (e) { error.value = (e as ApiError).message; }
});
</script>

<style scoped>
.mb { margin-bottom: 12px; }
</style>
