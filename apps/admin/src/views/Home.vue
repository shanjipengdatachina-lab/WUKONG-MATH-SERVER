<template>
  <div>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="mb" />
    <el-row :gutter="16">
      <el-col :span="6" v-for="c in cards" :key="c.label">
        <el-card class="stat">
          <div class="stat__num">{{ c.value ?? '—' }}</div>
          <div class="stat__label">{{ c.label }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card class="mt" header="知识结构（按类型）">
      <el-tag v-for="(n, k) in stats?.nodes" :key="k" class="tag" type="info">{{ k }} {{ n }}</el-tag>
      <p class="hint">这一份树是**章节 / 图谱 / 时间轴三处共用**的同一份数据。</p>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, type ApiError } from '../api';

type Stats = {
  nodes: Record<string, number>; nodeTotal: number; cards: number;
  contents: number; users: number; sessionsAlive: number; roles: number;
};
const stats = ref<Stats | null>(null);
const error = ref('');

const cards = computed(() => [
  { label: '知识树节点', value: stats.value?.nodeTotal },
  { label: '卡片', value: stats.value?.cards },
  { label: '正文篇数', value: stats.value?.contents },
  { label: '用户', value: stats.value?.users },
  { label: '在线会话', value: stats.value?.sessionsAlive },
  { label: '角色', value: stats.value?.roles },
]);

onMounted(async () => {
  try { stats.value = await api<Stats>('/admin/stats'); }
  catch (e) { error.value = (e as ApiError).message; }
});
</script>

<style scoped>
.mb { margin-bottom: 16px; }
.mt { margin-top: 16px; }
.tag { margin: 0 8px 8px 0; }
.stat { text-align: center; }
.stat__num { font-size: 26px; font-weight: 600; }
.stat__label { margin-top: 6px; color: #909399; font-size: 13px; }
.hint { margin: 8px 0 0; color: #909399; font-size: 12px; }
</style>
