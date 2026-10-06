<template>
  <div class="home">
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
            <span>知识结构（按类型）</span>
            <span class="card-head__note">章节 / 图谱 / 时间轴三处共用这一份</span>
          </div>
        </template>
        <div class="kinds">
          <div v-for="(n, k) in stats?.nodes" :key="k" class="kind">
            <span class="kind__key">{{ k }}</span>
            <span class="kind__num">{{ n }}</span>
          </div>
        </div>
        <p class="note">
          10 种节点：册 / 章 / 节 / 知识点，加上方法、易错、真题那几个"卡片桶"。
          竞赛那支没有"年级"这一层，所以树不做成固定的五张表。
        </p>
      </el-card>

      <el-card>
        <template #header>这一版做了什么 / 还没做什么</template>
        <ul class="todo">
          <li class="todo__done">账号与权限：注册 / 登录 / 登出 / 重置密码，RBAC 按权限点放行</li>
          <li class="todo__done">知识结构：1391 节点与正文从库读，学生端三页改读接口</li>
          <li class="todo__done">学习数据：2307 格记录 / 15 场考试 / 158 道错题已入库</li>
          <li class="todo__done">题库与做题：判分在服务端，错的自动进错题本</li>
          <li class="todo__done">论坛：从 localStorage 搬进库，登录后跨设备同步</li>
          <li class="todo__todo">后台还只能<strong>看</strong> —— 改树、写正文、配套餐都还没做</li>
          <li class="todo__todo">会员与支付（M6）、部署（M7）没开工</li>
        </ul>
      </el-card>
    </div>
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
.home__err { margin-bottom: 16px; }

.stat {
  padding: 16px 18px;
  background: var(--admin-surface);
  border: 1px solid var(--admin-line);
  border-radius: 10px;
  box-shadow: 0 1px 2px rgba(16, 18, 21, 0.04);
}
.stat__num {
  margin: 0;
  font-size: 26px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--admin-ink);
}
.stat__label { margin: 6px 0 0; font-size: 13px; color: var(--admin-ink-3); }

.grid {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  gap: 16px;
  margin-top: 16px;
}

.card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.card-head__note { font-size: 12px; font-weight: 400; color: var(--admin-ink-3); }

.kinds { display: flex; flex-wrap: wrap; gap: 8px; }
.kind {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--admin-line);
  border-radius: 8px;
  background: #fafbfc;
}
.kind__key { font-size: 12px; color: var(--admin-ink-2); }
.kind__num { font-size: 13px; font-weight: 600; color: var(--admin-ink); }

.note { margin: 14px 0 0; font-size: 12px; line-height: 1.9; color: var(--admin-ink-3); }

.todo { margin: 0; padding: 0; list-style: none; }
.todo li {
  position: relative;
  padding: 7px 0 7px 22px;
  font-size: 13px;
  line-height: 1.75;
  color: var(--admin-ink-2);
  border-bottom: 1px dashed var(--admin-line-soft);
}
.todo li:last-child { border-bottom: none; }
.todo li::before {
  position: absolute;
  left: 2px;
  top: 12px;
  font-size: 12px;
}
.todo__done::before { content: '✓'; color: var(--el-color-primary); }
.todo__todo::before { content: '·'; color: var(--admin-ink-3); }
.todo__todo { color: var(--admin-ink-3); }
.todo strong { color: var(--admin-ink); }

@media (max-width: 1100px) {
  .grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
