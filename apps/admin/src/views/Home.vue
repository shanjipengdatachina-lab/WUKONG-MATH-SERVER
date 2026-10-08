<template>
  <div class="home">
    <div class="home__intro">
      <div>
        <p class="home__eyebrow">悟空数学 AI 自习系统 · 初中试点版</p>
        <h2>教学工作台</h2>
      </div>
      <div class="home__controls">
        <el-select v-if="can('class.read')" v-model="stage" aria-label="学段" @change="load">
          <el-option label="初中" value="junior" /><el-option label="小学" value="primary" />
          <el-option label="高中" value="senior" /><el-option label="竞赛" value="olympiad" /><el-option label="全部学段" value="all" />
        </el-select>
        <el-tooltip content="刷新数据"><el-button size="small" :icon="Refresh" aria-label="刷新数据" :loading="loading" @click="load" /></el-tooltip>
      </div>
    </div>

    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="home__err" />

    <el-row :gutter="16">
      <el-col v-for="c in cards" :key="c.label" :xs="12" :sm="8" :md="4">
        <div class="stat">
          <p class="stat__num">{{ c.value ?? '—' }}</p>
          <p class="stat__label">{{ c.label }}</p>
        </div>
      </el-col>
    </el-row>

    <div class="grid">
      <el-card>
        <template #header>
          <div class="card-head">
            <span>工作入口</span>
          </div>
        </template>
        <div class="actions">
          <router-link v-if="can('tree.write') || can('content.read')" to="/tree" class="action">
            <span class="action__step">01</span>
            <span><b>课程与知识内容</b></span>
          </router-link>
          <router-link v-if="can('exam.read')" to="/exams" class="action">
            <span class="action__step">02</span>
            <span><b>真题资源库</b></span>
          </router-link>
          <router-link v-if="can('class.read')" to="/classes" class="action">
            <span class="action__step">03</span>
            <span><b>班级与花名册</b></span>
          </router-link>
          <router-link v-if="can('user.read')" to="/users" class="action">
            <span class="action__step">04</span>
            <span><b>学生与账号</b></span>
          </router-link>
        </div>
        <p v-if="!actionsVisible" class="empty">当前账号没有可用的管理权限，请联系管理员分配工作范围。</p>
      </el-card>

      <el-card v-if="stats">
        <template #header>
          <div class="card-head">
            <span>课程资源概况</span>
            <span class="card-head__note">正文按节点去重</span>
          </div>
        </template>
        <div class="kinds">
          <div v-for="(n, k) in stats.nodes" :key="k" class="kind">
            <span class="kind__key">{{ kindName(k) }}</span>
            <span class="kind__num">{{ n }}</span>
          </div>
        </div>
        <div v-if="coverage" class="coverage">
          <div v-for="row in coverage.stages" :key="row.stage" class="coverage__row" :class="{ 'coverage__row--pilot': row.stage === 'junior' }">
            <b>{{ row.name }}{{ row.stage === 'junior' ? ' · 试点' : '' }}</b>
            <span>可学习节点 {{ row.learningNodes }}</span>
            <span>正文覆盖 {{ row.contentNodes }} / {{ row.learningNodes }}</span>
            <span>真题覆盖 {{ row.examQuestionNodes }} / {{ row.learningNodes }}</span>
            <span class="coverage__warn">待补正文 {{ row.missingContentNodes }} · 待关联真题 {{ row.missingQuestionNodes }}</span>
          </div>
        </div>
        <p class="note">真题覆盖只统计已实际关联知识点的真题；旧练习题尚未建立知识点关联，不能被虚假计入覆盖率。</p>
      </el-card>

      <el-card v-if="learning">
        <template #header>
          <div class="card-head">
            <span>当前可见学员学习概况</span>
            <span class="card-head__note">教师仅看到自己负责班级</span>
          </div>
        </template>
        <div class="learning-grid">
          <div><b>{{ learning.students }}</b><span>学生</span></div>
          <div><b>{{ learning.learned }}</b><span>已学习格数</span></div>
          <div><b data-qa="mastery">{{ masteryPercent(learning.masteryAvg) }}</b><span>平均掌握度</span></div>
          <div><b>{{ learning.exams }}</b><span>个人考试记录</span></div>
          <div><b>{{ learning.mistakes }}</b><span>错题总数</span></div>
          <div><b>{{ learning.practice.questions }}</b><span>累计练习题量</span></div>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { api, can, type ApiError } from '../api';

type Stats = {
  nodes: Record<string, number>; nodeTotal: number; cards: number;
  contents: number; users: number; sessionsAlive: number; roles: number;
};
type LearningMetrics = {
  students: number; learned: number; masteryAvg: number | null; exams: number;
  avgRate: number | null; mistakes: number;
  practice: { sessions: number; questions: number; correct: number; judged: number; accuracy: number | null };
};
type ContentCoverage = {
  stages: Array<{
    stage: string; name: string; learningNodes: number; contentNodes: number; missingContentNodes: number;
    examQuestionNodes: number; examQuestions: number; missingQuestionNodes: number;
  }>;
};

const stats = ref<Stats | null>(null);
const learning = ref<LearningMetrics | null>(null);
const coverage = ref<ContentCoverage | null>(null);
const error = ref('');
const loading = ref(false);
const stage = ref('junior');
let revision = 0;

const cards = computed(() => {
  const out: { label: string; value: string | number | null }[] = [];
  if (learning.value) {
    out.push(
      { label: '当前可见学生', value: learning.value.students },
      { label: '平均掌握度', value: masteryPercent(learning.value.masteryAvg) },
      { label: '错题总数', value: learning.value.mistakes },
      { label: '累计练习题量', value: learning.value.practice.questions },
    );
  }
  if (stats.value) {
    out.push({ label: '知识树节点', value: stats.value.nodeTotal }, { label: '正文版本数', value: stats.value.contents });
  }
  return out;
});

const actionsVisible = computed(() => can('tree.write') || can('content.read') || can('exam.read') || can('class.read') || can('user.read'));

function masteryPercent(value: number | null): string { return value === null ? '暂无数据' : `${Math.round(value)}%`; }

function kindName(kind: string): string {
  const names: Record<string, string> = {
    root: '根', book: '教材册', chapter: '章', section: '节', point: '知识点', group: '内容组',
    method: '方法', error: '易错', exam: '真题', formula: '公式', track: '竞赛轨道',
  };
  return names[kind] || kind;
}

async function load(): Promise<void> {
  const request = ++revision;
  loading.value = true;
  error.value = '';
  stats.value = null;
  learning.value = null;
  coverage.value = null;
  const jobs: Promise<void>[] = [];
  if (can('content.read')) {
    jobs.push(api<Stats>('/admin/stats').then((d) => { if (request === revision) stats.value = d; }));
    jobs.push(api<ContentCoverage>('/admin/content-coverage').then((d) => { if (request === revision) coverage.value = d; }));
  }
  if (can('class.read')) { jobs.push(api<{ metrics: LearningMetrics }>(`/admin/stats/overview?stage=${stage.value === 'all' ? '' : stage.value}`).then((d) => { if (request === revision) learning.value = d.metrics; })); }
  const results = await Promise.allSettled(jobs);
  if (request !== revision) return;
  error.value = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map(r => (r.reason as ApiError).message).join('；');
  loading.value = false;
}

onMounted(load);
</script>

<style scoped>
.home__intro { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin: 2px 0 20px; }
.home__eyebrow { margin: 0 0 6px; color: var(--el-color-primary); font-size: 12px; font-weight: 600; }
.home__controls { display: flex; gap: 12px; align-items: center; }
.home__controls .el-select { width: 140px; }
.home__intro h2 { margin: 0; font-size: 22px; line-height: 1.35; color: var(--admin-ink); }
.home__intro p:last-child { margin: 7px 0 0; font-size: 13px; color: var(--admin-ink-3); }
.home__err { margin-bottom: 16px; }
.stat { min-height: 98px; padding: 16px 18px; background: var(--admin-surface); border: 1px solid var(--admin-line); border-radius: 8px; }
.stat__num { margin: 0; font-size: 26px; font-weight: 600; line-height: 1.2; color: var(--admin-ink); }
.stat__label { margin: 7px 0 0; font-size: 13px; color: var(--admin-ink-3); }
.grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; margin-top: 16px; }
.grid :deep(.el-card) { border: none; border-radius: 0; box-shadow: none; background: transparent; }
.grid :deep(.el-card__header) { padding: 16px 0; }
.grid :deep(.el-card__body) { padding: 16px 0; }
.card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.card-head__note { font-size: 12px; font-weight: 400; color: var(--admin-ink-3); }
.actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.action { display: flex; align-items: center; gap: 11px; min-height: 54px; padding: 12px; color: inherit; text-decoration: none; border: 1px solid var(--admin-line); border-radius: 8px; background: #fcfcfd; transition: border-color .16s ease, background .16s ease; }
.action:hover { border-color: var(--el-color-primary-light-5); background: var(--el-color-primary-light-9); }
.action__step { color: var(--el-color-primary); font-size: 12px; font-weight: 700; line-height: 1.6; }
.action b, .action i { display: block; }
.action b { font-size: 13px; color: var(--admin-ink); }
.action i { margin-top: 4px; font-size: 12px; font-style: normal; line-height: 1.45; color: var(--admin-ink-3); }
.empty, .note { margin: 12px 0 0; font-size: 12px; line-height: 1.8; color: var(--admin-ink-3); }
.principles { margin: 0; padding: 0; list-style: none; }
.principles li { padding: 8px 0; border-bottom: 1px dashed var(--admin-line-soft); color: var(--admin-ink-2); font-size: 13px; line-height: 1.7; }
.principles li:last-child { border-bottom: none; }
.principles b { color: var(--admin-ink); }
.kinds { display: flex; flex-wrap: wrap; gap: 8px; }
.kind { display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 10px; border: 1px solid var(--admin-line); border-radius: 8px; background: #fafbfc; }
.kind__key { font-size: 12px; color: var(--admin-ink-2); }
.kind__num { font-size: 13px; font-weight: 600; color: var(--admin-ink); }
.coverage { display: grid; gap: 8px; margin-top: 14px; }
.coverage__row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; align-items: center; padding: 9px 10px; border-bottom: 1px solid var(--admin-line-soft); color: var(--admin-ink-2); font-size: 12px; }
.coverage__row--pilot { background: #f0faf5; }
.coverage__row b { color: var(--admin-ink); }
.coverage__warn { color: #a56a13; }
.learning-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.learning-grid div { min-height: 72px; padding: 12px 0; border-bottom: 1px solid var(--admin-line-soft); }
.learning-grid b, .learning-grid span { display: block; }
.learning-grid b { font-size: 20px; color: var(--admin-ink); }
.learning-grid span { margin-top: 5px; font-size: 12px; color: var(--admin-ink-3); }
@media (max-width: 1100px) { .grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 700px) { .home__intro { align-items: flex-start; flex-direction: column; } .actions, .learning-grid { grid-template-columns: minmax(0, 1fr); } .coverage__row { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
