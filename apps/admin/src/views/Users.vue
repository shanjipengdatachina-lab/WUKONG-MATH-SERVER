<template>
  <el-card>
    <template #header>
      <div class="head">
        <span>用户（{{ rows.length }}）</span>
        <span class="head__note">这里只能看；改角色、停用账号还没做</span>
      </div>
    </template>

    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="mb" />

    <el-table :data="rows" stripe>
      <el-table-column prop="id" label="#" width="70" />
      <el-table-column label="账号" min-width="150">
        <template #default="{ row }">
          <span class="mono">{{ row.username }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="nickname" label="昵称" min-width="120" />
      <el-table-column label="年级" min-width="140">
        <template #default="{ row }">
          <span v-if="row.grade">{{ row.grade }}</span>
          <span v-else class="dim">—</span>
        </template>
      </el-table-column>
      <el-table-column label="角色" width="110">
        <template #default="{ row }">
          <el-tag size="small" :type="row.role === 'admin' ? 'danger' : 'success'" effect="light">
            {{ row.role === 'admin' ? '管理员' : '学生' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="注册时间" min-width="200">
        <template #default="{ row }">
          <span class="mono dim">{{ when(row.createdAt) }}</span>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, type ApiError } from '../api';

type Row = { id: number; username: string; nickname: string; grade: string | null; role: string; createdAt: string };
const rows = ref<Row[]>([]);
const error = ref('');

/** 库里存的是 ISO 时间；直接摆给人看太生硬，换成"2026-10-05 22:31"。 */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) { return iso; }
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

onMounted(async () => {
  try { rows.value = (await api<{ total: number; items: Row[] }>('/admin/users')).items; }
  catch (e) { error.value = (e as ApiError).message; }
});
</script>

<style scoped>
.mb { margin-bottom: 12px; }
.head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.head__note { font-size: 12px; font-weight: 400; color: var(--admin-ink-3); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.dim { color: var(--admin-ink-3); }
</style>
