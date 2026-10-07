<template>
  <div>
    <el-card v-loading="loading">
      <template #header>
        <div class="head">
          <div>
            <el-button link @click="back">← 班级</el-button>
            <span class="title">{{ head }}</span>
            <el-tag v-if="cls" size="small" effect="plain" class="ml">{{ cls.stageName }}</el-tag>
            <el-tag v-if="cls && !cls.active" size="small" type="info" class="ml">已停用</el-tag>
          </div>
          <span v-if="cls" class="head__note">
            班主任：<b>{{ cls.teacherName || '未指定' }}</b> ·
            {{ cls.grade || '未填年级' }} · {{ cls.students }} 人
          </span>
        </div>
      </template>

      <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="mb" />

      <template v-if="data">
        <div class="kpis">
          <div class="kpi"><b>{{ data.metrics.students }}</b><span>人数</span></div>
          <div class="kpi"><b>{{ data.metrics.learned }}</b><span>已学格数</span></div>
          <div class="kpi">
            <b>{{ data.metrics.masteryAvg === null ? '—' : data.metrics.masteryAvg }}</b><span>平均掌握度</span>
          </div>
          <div class="kpi"><b>{{ data.metrics.exams }}</b><span>考试场次</span></div>
          <div class="kpi">
            <b>{{ data.metrics.avgRate === null ? '—' : pct(data.metrics.avgRate) }}</b><span>平均得分率</span>
          </div>
          <div class="kpi"><b>{{ data.metrics.mistakes }}</b><span>错题</span></div>
          <div class="kpi">
            <b>{{ data.metrics.practice.questions }}</b><span>做题数</span>
          </div>
          <div class="kpi">
            <b>{{ data.metrics.practice.accuracy === null ? '—' : pct(data.metrics.practice.accuracy) }}</b>
            <span>练习正确率</span>
          </div>
        </div>
        <p class="dim small mt">
          平均掌握度是<strong>总掌握度 ÷ 总已学格数</strong>，不是"各人平均值的平均" ——
          后者会让只学了 10 格的人和学了 700 格的人一样重。
          没有数据的格子显示「—」，<strong>不拿 0 顶替</strong>。
        </p>

        <h4 class="h4">花名册 <span class="dim">点昵称看这个人的成长曲线</span></h4>
        <el-table :data="data.items" size="small" stripe>
          <el-table-column label="账号" width="150" sortable :sort-method="(a: Row, b: Row) => a.username.localeCompare(b.username)">
            <template #default="{ row }"><span class="mono">{{ row.username }}</span></template>
          </el-table-column>
          <el-table-column label="昵称" min-width="110" sortable prop="nickname">
            <template #default="{ row }">
              <router-link class="link" :to="`/users/${row.id}`">{{ row.nickname }}</router-link>
            </template>
          </el-table-column>
          <el-table-column label="年级" min-width="120" sortable prop="grade">
            <template #default="{ row }">
              <span v-if="row.grade">{{ row.grade }}</span><span v-else class="dim">—</span>
            </template>
          </el-table-column>
          <el-table-column label="已学格数" width="110" align="right" sortable prop="learned" />
          <el-table-column label="平均掌握度" width="120" align="right" sortable prop="masteryAvg">
            <template #default="{ row }">
              <b v-if="row.masteryAvg !== null">{{ row.masteryAvg }}</b><span v-else class="dim">—</span>
            </template>
          </el-table-column>
          <el-table-column label="考试场次" width="100" align="right" sortable prop="exams" />
          <el-table-column label="平均得分率" width="120" align="right" sortable prop="avgRate">
            <template #default="{ row }">
              <span v-if="row.avgRate !== null">{{ pct(row.avgRate) }}</span><span v-else class="dim">—</span>
            </template>
          </el-table-column>
          <el-table-column label="错题" width="90" align="right" sortable prop="mistakes" />
          <el-table-column label="做题数" width="100" align="right" sortable :sort-method="(a: Row, b: Row) => a.practice.questions - b.practice.questions">
            <template #default="{ row }">{{ row.practice.questions }}</template>
          </el-table-column>
          <el-table-column label="练习正确率" width="120" align="right" sortable :sort-method="(a: Row, b: Row) => (a.practice.accuracy ?? -1) - (b.practice.accuracy ?? -1)">
            <template #default="{ row }">
              <span v-if="row.practice.accuracy !== null">{{ pct(row.practice.accuracy) }}</span>
              <span v-else class="dim">暂无练习数据</span>
            </template>
          </el-table-column>
        </el-table>

        <p v-if="!data.items.length" class="empty">这个班还没有学生。</p>
      </template>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type ApiError } from '../api';

type Row = {
  id: number; username: string; nickname: string; grade: string | null; stage: string | null;
  learned: number; masteryAvg: number | null;
  exams: number; avgRate: number | null; mistakes: number;
  practice: { sessions: number; questions: number; correct: number; accuracy: number | null; lastAt: string | null };
};
type Payload = {
  class: {
    id: number; name: string; stage: string; stageName: string; grade: string | null;
    teacherName: string | null; active: boolean; students: number;
  };
  metrics: {
    students: number; learned: number; masteryAvg: number | null;
    exams: number; avgRate: number | null; mistakes: number;
    practice: { sessions: number; questions: number; correct: number; accuracy: number | null; lastAt: string | null };
  };
  items: Row[];
};

const route = useRoute();
const router = useRouter();
const data = ref<Payload | null>(null);
const error = ref('');
const loading = ref(false);

const cls = computed(() => data.value?.class ?? null);
const head = computed(() => cls.value?.name ?? '班级详情');

function pct(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

function back(): void {
  void router.push('/classes');
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    data.value = await api<Payload>(`/admin/classes/${String(route.params.id)}/roster`);
    error.value = '';
  } catch (e) {
    error.value = (e as ApiError).message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
/* 从花名册点进学生详情再退回来时，路由参数没变但数据可能已经不同了 —— 监听一下更稳 */
watch(() => route.params.id, load);
</script>

<style scoped>
.mb { margin-bottom: 12px; }
.head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.title { font-weight: 600; font-size: 15px; margin-left: 8px; }
.head__note { font-size: 12px; font-weight: 400; color: var(--admin-ink-3); }

.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; }
.kpi { border: 1px solid var(--admin-border, #e4e7ed); border-radius: 8px; padding: 10px 12px; }
.kpi b { display: block; font-size: 18px; font-variant-numeric: tabular-nums; }
.kpi span { font-size: 12px; color: var(--admin-ink-3); }

.h4 { font-size: 13px; font-weight: 600; margin: 22px 0 10px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.link { color: var(--el-color-primary); text-decoration: none; }
.link:hover { text-decoration: underline; }
.dim { color: var(--admin-ink-3); }
.small { font-size: 12px; }
.mt { margin-top: 10px; }
.ml { margin-left: 6px; }
.empty { padding: 20px 0; font-size: 13px; color: var(--admin-ink-3); }
</style>
