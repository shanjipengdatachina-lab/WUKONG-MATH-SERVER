<template>
  <div class="ud">
    <el-card>
      <template #header>
        <div class="head">
          <span>
            <el-button link type="primary" data-qa="back" @click="back">← 用户列表</el-button>
          </span>
          <span class="head__note">
            这一页<strong>只读</strong>：把散在各处的数摆到一起看一眼。改数据仍走各自那一处。
          </span>
        </div>
      </template>

      <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="mb" />
      <el-skeleton v-if="loading" :rows="6" animated />

      <template v-else-if="ov">
        <!-- 头顶一行：他是谁、还能不能进 -->
        <div class="who">
          <span class="who__name">{{ ov.user.nickname || ov.user.username }}</span>
          <span class="mono dim">@{{ ov.user.username }}</span>
          <el-tag size="small" effect="plain">{{ ov.user.role === 'admin' ? '管理员' : '学生' }}</el-tag>
          <el-tag v-if="ov.user.grade" size="small" effect="plain" type="info">{{ ov.user.grade }}</el-tag>
          <el-tag v-if="ov.user.disabledAt" size="small" type="info">已停用</el-tag>
          <el-tag v-else size="small" type="success" effect="light">正常</el-tag>
          <el-tag :type="ov.membership.isMember ? 'warning' : 'info'" size="small" effect="light">
            {{ ov.membership.planName || '—' }}
          </el-tag>
          <span v-if="ov.user.disabledAt" class="dim small">停用于 {{ when(ov.user.disabledAt) }}</span>
        </div>

        <!-- ① 基本资料 -->
        <el-descriptions title="基本资料" :column="3" border class="sec">
          <el-descriptions-item label="账号"><span class="mono">{{ ov.user.username }}</span></el-descriptions-item>
          <el-descriptions-item label="昵称">{{ ov.user.nickname || '—' }}</el-descriptions-item>
          <el-descriptions-item label="年级">{{ ov.user.grade || '—' }}</el-descriptions-item>
          <el-descriptions-item label="注册时间">{{ when(ov.user.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="角色">{{ ov.user.role === 'admin' ? '管理员' : '学生' }}</el-descriptions-item>
          <el-descriptions-item label="用户 id"><span class="mono">{{ ov.user.id }}</span></el-descriptions-item>
        </el-descriptions>

        <!-- ② 会员与订单 -->
        <div class="sec">
          <h3 class="h3">会员与订单</h3>
          <div class="kpis">
            <div class="kpi">
              <b>{{ ov.membership.planName || '—' }}</b>
              <span>当前套餐</span>
            </div>
            <div class="kpi">
              <b>{{ ov.membership.daysLeft === null ? (ov.membership.isMember ? '不限' : '—') : ov.membership.daysLeft }}</b>
              <span>天后到期</span>
            </div>
            <div class="kpi">
              <b>{{ ov.orders.length }}</b>
              <span>订单数</span>
            </div>
            <div class="kpi">
              <b>{{ money(paidCents) }}</b>
              <span>已付款（不含测试通道）</span>
            </div>
          </div>
          <p v-if="ov.membership.endAt" class="dim small">到期于 {{ when(ov.membership.endAt) }}</p>

          <el-table v-if="ov.orders.length" :data="ov.orders" stripe size="small" class="mt">
            <el-table-column prop="orderNo" label="订单号" min-width="180">
              <template #default="{ row }"><span class="mono">{{ row.orderNo }}</span></template>
            </el-table-column>
            <el-table-column prop="planName" label="套餐" min-width="110" />
            <el-table-column label="金额" width="110">
              <template #default="{ row }"><span class="mono">{{ money(row.amountCents) }}</span></template>
            </el-table-column>
            <el-table-column label="状态" width="130">
              <template #default="{ row }">
                <el-tag size="small" :type="statusType(row.status)" effect="light">{{ statusName(row.status) }}</el-tag>
                <el-tag v-if="row.isTest" size="small" type="info" effect="plain" class="ml">测试</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="channelName" label="通道" width="110" />
            <el-table-column label="创建" min-width="150">
              <template #default="{ row }"><span class="mono dim">{{ when(row.createdAt) }}</span></template>
            </el-table-column>
          </el-table>
          <p v-else class="dim small mt">还没有订单。</p>
        </div>

        <!-- ③ 考试成绩 -->
        <div class="sec">
          <h3 class="h3">考试成绩 <span class="h3__sub">演示数据里导入的那 {{ ov.exams.length }} 场</span></h3>
          <el-table v-if="ov.exams.length" :data="ov.exams" stripe size="small">
            <el-table-column prop="code" label="编号" width="80">
              <template #default="{ row }"><span class="mono">{{ row.code }}</span></template>
            </el-table-column>
            <el-table-column prop="name" label="考试" min-width="180" />
            <el-table-column prop="date" label="日期" width="120">
              <template #default="{ row }"><span class="mono">{{ row.date }}</span></template>
            </el-table-column>
            <el-table-column label="得分" width="120">
              <template #default="{ row }"><span class="mono">{{ row.score }} / {{ row.full }}</span></template>
            </el-table-column>
            <el-table-column label="得分率" width="110">
              <template #default="{ row }">
                <span v-if="row.rate === null" class="dim">—</span>
                <span v-else class="mono">{{ pct(row.rate) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="错题" width="90">
              <template #default="{ row }">
                <span v-if="row.wrong" class="mono">{{ row.wrong }}</span>
                <span v-else class="dim">0</span>
              </template>
            </el-table-column>
          </el-table>
          <p v-else class="dim small">这个账号还没有考试成绩。</p>
        </div>

        <!-- ④ 考情切片（学生自己传的）-->
        <div class="sec">
          <h3 class="h3">考情切片 <span class="h3__sub">学生自己上传的卷子，共 {{ ov.slices.total }} 张</span></h3>

          <div class="kpis">
            <div class="kpi">
              <b>{{ ov.slices.report.summary.count }}</b>
              <span>切片数</span>
            </div>
            <div class="kpi">
              <b>{{ ov.slices.report.summary.withScore }} / {{ ov.slices.report.summary.count }}</b>
              <span>填了分数</span>
            </div>
            <div class="kpi">
              <b>{{ ov.slices.report.summary.avgRate === null ? '—' : pct(ov.slices.report.summary.avgRate) }}</b>
              <span>平均得分率</span>
            </div>
            <div class="kpi">
              <b>{{ ov.slices.report.summary.best === null ? '—' : pct(ov.slices.report.summary.best.rate) }}</b>
              <span>最好</span>
            </div>
            <div class="kpi">
              <b>{{ ov.slices.report.summary.worst === null ? '—' : pct(ov.slices.report.summary.worst.rate) }}</b>
              <span>最差</span>
            </div>
          </div>
          <p v-if="ov.slices.report.summary.firstDate" class="dim small">
            {{ ov.slices.report.summary.firstDate }} ~ {{ ov.slices.report.summary.lastDate }}
            · 一共框了 {{ ov.slices.report.boxes.total }} 道错题，
            其中 {{ ov.slices.report.boxes.withNode }} 道挂了知识点
            <template v-if="ov.slices.report.summary.best">
              · 最好：{{ ov.slices.report.summary.best.name }}
              （{{ pct(ov.slices.report.summary.best.rate) }}）
            </template>
            <template v-if="ov.slices.report.summary.worst">
              · 最差：{{ ov.slices.report.summary.worst.name }}
              （{{ pct(ov.slices.report.summary.worst.rate) }}）
            </template>
          </p>

          <el-table v-if="ov.slices.items.length" :data="ov.slices.items" stripe size="small" class="mt">
            <el-table-column prop="name" label="名称" min-width="150" />
            <el-table-column prop="date" label="日期" width="120">
              <template #default="{ row }"><span class="mono">{{ row.date }}</span></template>
            </el-table-column>
            <el-table-column label="科目 / 卷型" min-width="130">
              <template #default="{ row }">{{ row.subject }} · {{ row.paperType }}</template>
            </el-table-column>
            <el-table-column label="得分" width="120">
              <template #default="{ row }">
                <span v-if="row.score === null" class="dim">没记分数</span>
                <span v-else class="mono">{{ row.score }} / {{ row.full }}
                  <span v-if="row.rate !== null" class="dim">（{{ pct(row.rate) }}）</span>
                </span>
              </template>
            </el-table-column>
            <el-table-column label="照片 / 错题 / 章节" width="150">
              <template #default="{ row }">
                <span class="mono">{{ row.images }} / {{ row.boxes }} / {{ row.nodes }}</span>
              </template>
            </el-table-column>
          </el-table>
          <p v-else class="dim small mt">本人还没有上传过卷子。</p>

          <template v-if="ov.slices.report.byChapter.length">
            <h4 class="h4">薄弱章节 <span class="h3__sub">按"框出来的错题数"排</span></h4>
            <ul class="chaps">
              <li v-for="c in ov.slices.report.byChapter" :key="c.nodeId">
                <span>{{ c.name }}</span>
                <span class="dim small">错题 {{ c.boxes }} 道 · 考过 {{ c.slices }} 次</span>
              </li>
            </ul>
          </template>
        </div>

        <!-- ⑤ 学习进度 -->
        <div class="sec">
          <h3 class="h3">学习进度</h3>
          <div class="kpis">
            <div class="kpi"><b>{{ ov.learning.learned }} / {{ ov.learning.records }}</b><span>已学知识点</span></div>
            <div class="kpi"><b>{{ ov.learning.masteryAvg === null ? '—' : ov.learning.masteryAvg }}</b><span>平均掌握度</span></div>
            <div class="kpi"><b>{{ ov.learning.mastered }}</b><span>已掌握（≥85）</span></div>
            <div class="kpi"><b>{{ ov.learning.events }}</b><span>学习事件</span></div>
            <div class="kpi"><b>{{ ov.learning.marks }}</b><span>标记点</span></div>
            <div class="kpi"><b>{{ ov.learning.blocked }}</b><span>前置未满足</span></div>
          </div>
          <p class="dim small mt">
            平均掌握度<strong>只按学过的那 {{ ov.learning.learned }} 个知识点算</strong> ——
            没学过的不进平均（不拿 0 顶替，和考情报告同一个口径）。
          </p>
        </div>

        <!-- ⑥ 互动与内容 -->
        <div class="sec">
          <h3 class="h3">互动与内容</h3>
          <div class="kpis">
            <div class="kpi"><b>{{ ov.content.mistakes }}</b><span>错题本</span></div>
            <div class="kpi"><b>{{ ov.content.favorites }}</b><span>收藏</span></div>
            <div class="kpi"><b>{{ ov.content.notes }}</b><span>笔记</span></div>
            <div class="kpi"><b>{{ ov.content.posts }}</b><span>发帖</span></div>
            <div class="kpi"><b>{{ ov.content.replies }}</b><span>回帖</span></div>
          </div>
        </div>
      </template>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type ApiError } from '../api';

type OrderRow = {
  orderNo: string; planCode: string; planName: string; amountCents: number;
  status: string; channel: string; channelName: string; isTest: boolean;
  createdAt: string; paidAt: string | null;
};
type ExamRow = {
  code: string; name: string; date: string; score: number; full: number;
  rate: number | null; wrong: number;
};
type SliceRow = {
  id: number; name: string; date: string; subject: string; paperType: string;
  score: number | null; full: number | null; rate: number | null; note: string | null;
  images: number; boxes: number; nodes: number;
};
type ChapRow = { nodeId: number; name: string; boxes: number; slices: number };
/** 成绩走向上的一个点。`best` / `worst` 不是数，是**这张切片本身** ——
    所以取分要 `.rate`，直接把对象丢给 pct() 会算出 NaN%。 */
type TrendPoint = {
  sliceId: number; date: string; name: string; subject: string;
  score: number; full: number; rate: number;
};
type Overview = {
  user: {
    id: number; username: string; nickname: string; grade: string | null;
    role: string; createdAt: string; disabledAt: string | null;
  };
  membership: {
    planCode: string | null; planName: string | null;
    isMember: boolean; endAt: string | null; daysLeft: number | null;
  };
  orders: OrderRow[];
  exams: ExamRow[];
  slices: {
    total: number; items: SliceRow[];
    report: {
      summary: {
        count: number; withScore: number; firstDate: string | null;
        lastDate: string | null; avgRate: number | null;
        best: TrendPoint | null; worst: TrendPoint | null;
      };
      byChapter: ChapRow[];
      boxes: { total: number; withNode: number; withoutNode: number };
    };
  };
  learning: {
    records: number; learned: number; mastered: number; masteryAvg: number | null;
    events: number; marks: number; blocked: number;
  };
  content: {
    mistakes: number; mistakesOpen: number; favorites: number;
    notes: number; posts: number; replies: number;
  };
};

const route = useRoute();
const router = useRouter();
const ov = ref<Overview | null>(null);
const error = ref('');
const loading = ref(false);

/** 真实收款：**测试通道的单不算** —— 和订单页同一个口径，不在这里另定一套。 */
const paidCents = computed(() => (ov.value?.orders ?? [])
  .filter((o) => o.status === 'paid' && !o.isTest)
  .reduce((s, o) => s + o.amountCents, 0));

function money(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}
function pct(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}
/** 库里存的是 ISO 时间；直接摆给人看太生硬，换成"2026-10-05 22:31"。 */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) { return iso; }
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function statusName(s: string): string {
  return ({ paid: '已支付', pending: '待支付', canceled: '已取消', expired: '已超时' } as Record<string, string>)[s] ?? s;
}
function statusType(s: string): 'success' | 'warning' | 'info' | 'danger' {
  if (s === 'paid') { return 'success'; }
  if (s === 'pending') { return 'warning'; }
  return 'info';
}
function back(): void {
  void router.push('/users');
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    ov.value = await api<Overview>(`/admin/users/${String(route.params.id)}/overview`);
    error.value = '';
  } catch (e) {
    error.value = (e as ApiError).message;
    ov.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.ud { max-width: 1100px; }
.mb { margin-bottom: 12px; }
.mt { margin-top: 12px; }
.ml { margin-left: 6px; }
.head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.head__note { font-size: 12px; font-weight: 400; color: var(--admin-ink-3); }

.who { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.who__name { font-size: 18px; font-weight: 600; color: var(--admin-ink); }

.sec { margin-top: 22px; }
.h3 { margin: 0 0 10px; font-size: 14px; font-weight: 600; color: var(--admin-ink); }
.h4 { margin: 18px 0 8px; font-size: 13px; font-weight: 600; color: var(--admin-ink); }
.h3__sub { font-size: 12px; font-weight: 400; color: var(--admin-ink-3); }

.kpis { display: flex; flex-wrap: wrap; gap: 26px; }
.kpi { display: flex; flex-direction: column; gap: 2px; }
.kpi b { font-size: 20px; font-weight: 600; color: var(--admin-ink); font-variant-numeric: tabular-nums; }
.kpi span { font-size: 12px; color: var(--admin-ink-3); }

.chaps { margin: 0; padding: 0; list-style: none; }
.chaps li {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  padding: 7px 0; border-bottom: 1px solid var(--admin-line-soft); font-size: 13px;
  color: var(--admin-ink-2);
}

.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.dim { color: var(--admin-ink-3); }
.small { font-size: 12px; line-height: 1.8; }
</style>
