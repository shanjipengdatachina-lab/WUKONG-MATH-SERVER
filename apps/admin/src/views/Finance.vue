<template>
  <el-card>
    <template #header>
      <div class="head">
        <span>财务</span>
        <span class="head__note">
          收款按<strong>到账时间</strong>归日；下面的明细按<strong>下单时间</strong>筛 ——
          两处口径不同，别拿两个数直接对。
        </span>
      </div>
    </template>

    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="mb" />

    <!-- 时间范围 + 粒度 -->
    <div class="bar">
      <el-radio-group v-model="preset" size="small" @change="applyPreset">
        <el-radio-button value="7">近 7 天</el-radio-button>
        <el-radio-button value="30">近 30 天</el-radio-button>
        <el-radio-button value="month">本月</el-radio-button>
        <el-radio-button value="year">今年</el-radio-button>
        <el-radio-button value="custom">自定义</el-radio-button>
      </el-radio-group>

      <el-date-picker
        v-model="range"
        type="daterange"
        size="small"
        value-format="YYYY-MM-DD"
        start-placeholder="起"
        end-placeholder="止"
        :clearable="false"
        class="bar__date"
        @change="onRangeChange"
      />

      <el-radio-group v-model="granularity" size="small" @change="loadSummary">
        <el-radio-button value="day">按日</el-radio-button>
        <el-radio-button value="month">按月</el-radio-button>
      </el-radio-group>
    </div>

    <!-- 汇总 -->
    <div class="cards">
      <div class="stat">
        <div class="stat__label">真实收款</div>
        <div class="stat__num">{{ money(summary.realCents) }}</div>
        <div class="stat__sub">{{ summary.realCount }} 笔 · <strong>不含测试通道</strong></div>
      </div>
      <div class="stat">
        <div class="stat__label">全部已支付</div>
        <div class="stat__num dim">{{ money(summary.cents) }}</div>
        <div class="stat__sub">{{ summary.count }} 笔 · 含测试单</div>
      </div>
      <div class="stat">
        <div class="stat__label">区间长度</div>
        <div class="stat__num">{{ series.length }}</div>
        <div class="stat__sub">{{ granularity === 'month' ? '个月' : '天' }}（没有收款的日子也占一格）</div>
      </div>
    </div>

    <!-- 趋势：纯 CSS 柱状，不引图表库（后台的依赖已经够重了） -->
    <div class="chart">
      <div class="chart__head">
        <span class="chart__title">收款趋势</span>
        <span class="chart__legend">
          <i class="dot dot--real" /> 真实
          <i class="dot dot--test" /> 测试通道
        </span>
      </div>
      <div v-if="!series.length" class="empty">这段时间没有收款记录。</div>
      <div v-else class="chart__scroll">
        <div class="chart__bars">
          <div v-for="b in series" :key="b.bucket" class="bar-col" :title="tip(b)">
            <div class="bar-col__stack">
              <div class="bar-col__seg bar-col__seg--test" :style="{ height: pct(b.cents - b.realCents) }" />
              <div class="bar-col__seg bar-col__seg--real" :style="{ height: pct(b.realCents) }" />
            </div>
            <div class="bar-col__x">{{ shortBucket(b.bucket) }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 分套餐 / 分渠道 -->
    <div class="split">
      <div>
        <div class="sub">按套餐</div>
        <el-table :data="byPlan" size="small" stripe>
          <el-table-column prop="planName" label="套餐" min-width="120" />
          <el-table-column label="笔数" width="70" align="center">
            <template #default="{ row }">{{ row.count }}</template>
          </el-table-column>
          <el-table-column label="合计" width="110" align="right">
            <template #default="{ row }"><span class="dim">{{ money(row.cents) }}</span></template>
          </el-table-column>
          <el-table-column label="真实" width="110" align="right">
            <template #default="{ row }">{{ money(row.realCents) }}</template>
          </el-table-column>
        </el-table>
      </div>
      <div>
        <div class="sub">按通道</div>
        <el-table :data="byChannel" size="small" stripe>
          <el-table-column label="通道" min-width="120">
            <template #default="{ row }">
              {{ row.channelName }}
              <el-tag v-if="row.isTest" size="small" type="warning" effect="light">测试</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="笔数" width="70" align="center">
            <template #default="{ row }">{{ row.count }}</template>
          </el-table-column>
          <el-table-column label="合计" width="110" align="right">
            <template #default="{ row }">{{ money(row.cents) }}</template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <el-divider />

    <!-- 明细 -->
    <div class="bar">
      <span class="sub sub--inline">订单明细</span>
      <el-select v-model="status" size="small" placeholder="全部状态" clearable class="bar__sel" @change="reloadOrders">
        <el-option label="已支付" value="paid" />
        <el-option label="待支付" value="pending" />
        <el-option label="已超时" value="expired" />
        <el-option label="已取消" value="canceled" />
      </el-select>
      <el-select v-model="channel" size="small" placeholder="全部通道" clearable class="bar__sel" @change="reloadOrders">
        <el-option v-for="c in channelOptions" :key="c.channel" :label="c.channelName" :value="c.channel" />
      </el-select>
      <span class="bar__gap" />
      <el-button size="small" :loading="loadingOrders" @click="reloadOrders">刷新</el-button>
      <el-button size="small" type="primary" plain @click="exportCsv">导出 CSV</el-button>
    </div>

    <el-table v-loading="loadingOrders" :data="items" size="small" stripe>
      <el-table-column prop="orderNo" label="订单号" width="190">
        <template #default="{ row }"><span class="mono">{{ row.orderNo }}</span></template>
      </el-table-column>
      <el-table-column label="下单人" min-width="130">
        <template #default="{ row }">
          {{ row.nickname }}<span class="dim"> · {{ row.username }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="planName" label="方案" min-width="100" />
      <el-table-column label="金额" width="120" align="right">
        <template #default="{ row }">
          <span>{{ money(row.amountCents) }}</span>
          <el-tag v-if="row.isTest" size="small" type="warning" effect="light" class="ml">测试</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag size="small" :type="toneOf(row.status)">{{ statusCn(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="下单时间" width="150">
        <template #default="{ row }"><span class="mono dim">{{ when(row.createdAt) }}</span></template>
      </el-table-column>
      <el-table-column label="支付时间" width="150">
        <template #default="{ row }">
          <span v-if="row.paidAt" class="mono dim">{{ when(row.paidAt) }}</span>
          <span v-else class="dim">—</span>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <span class="pager__all">当前筛选共 {{ orderTotal }} 单</span>
      <el-pagination
        layout="sizes, prev, pager, next"
        :total="orderTotal"
        :current-page="page"
        :page-size="pageSize"
        :page-sizes="[20, 50, 100]"
        @current-change="onPage"
        @size-change="onSize"
      />
    </div>

    <p class="foot">
      <strong>真实收款</strong>不含测试通道的单 —— 开发期的测试支付长得跟真收银台一样，
      混进收入里，对账的人会把它当成真钱。导出 CSV 导的是<strong>当前筛选条件下的全部</strong>（不是这一页）。
    </p>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api, type ApiError } from '../api';

type Bucket = { bucket: string; count: number; cents: number; realCount: number; realCents: number };
type PlanRow = { planCode: string; planName: string; count: number; cents: number; realCount: number; realCents: number };
type ChannelRow = { channel: string; channelName: string; isTest: boolean; count: number; cents: number; realCount: number; realCents: number };
type Summary = {
  range: { from: string; to: string; granularity: string };
  totals: { count: number; cents: number; realCount: number; realCents: number };
  series: Bucket[];
  byPlan: PlanRow[];
  byChannel: ChannelRow[];
};
type OrderRow = {
  orderNo: string; username: string; nickname: string; planName: string;
  amountCents: number; status: string; channel: string; channelName: string;
  isTest: boolean; createdAt: string; expiresAt: string; paidAt: string | null;
};

const error = ref('');
const preset = ref<'7' | '30' | 'month' | 'year' | 'custom'>('30');
const granularity = ref<'day' | 'month'>('day');
const range = ref<[string, string]>(span(30));

const series = ref<Bucket[]>([]);
const byPlan = ref<PlanRow[]>([]);
const byChannel = ref<ChannelRow[]>([]);
const summary = ref({ count: 0, cents: 0, realCount: 0, realCents: 0 });
const loadingSummary = ref(false);

const items = ref<OrderRow[]>([]);
const orderTotal = ref(0);
const page = ref(1);
const pageSize = ref(20);
const status = ref('');
const channel = ref('');
const loadingOrders = ref(false);

/** 通道下拉的选项直接用统计结果里的渠道 —— 不另开一个接口，也不会出现"下拉里有个从没出现过的通道" */
const channelOptions = computed(() => byChannel.value);

/** 本地日期 → `YYYY-MM-DD`。**不能用 toISOString()** —— 那是 UTC，东八区会差一天。 */
function ymd(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 近 N 天（含今天） */
function span(days: number): [string, string] {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return [ymd(from), ymd(to)];
}

function applyPreset(v: string | number | boolean | undefined): void {
  const key = String(v);
  const now = new Date();
  if (key === '7') { range.value = span(7); }
  else if (key === '30') { range.value = span(30); }
  else if (key === 'month') { range.value = [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd(now)]; }
  else if (key === 'year') { range.value = [ymd(new Date(now.getFullYear(), 0, 1)), ymd(now)]; }
  else { return; /* 自定义：等用户自己选，别覆盖他正在选的范围 */ }
  reloadOrders();
  void loadSummary();
}

function onRangeChange(): void {
  preset.value = 'custom';
  reloadOrders();
  void loadSummary();
}

function money(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) { return iso; }
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function statusCn(s: string): string {
  return { paid: '已支付', pending: '待支付', expired: '已超时', canceled: '已取消' }[s] ?? s;
}
function toneOf(s: string): 'success' | 'warning' | 'danger' | 'info' {
  if (s === 'paid') { return 'success'; }
  if (s === 'pending') { return 'warning'; }
  if (s === 'canceled') { return 'danger'; }
  return 'info';
}

/** 柱高按区间内最大值归一 —— 一根 288 元、一根 588 元的图，看的是相对高低 */
const peak = computed(() => Math.max(1, ...series.value.map((b) => b.cents)));
function pct(cents: number): string {
  if (cents <= 0) { return '0%'; }
  return `${Math.max(2, (cents / peak.value) * 100)}%`;
}

function shortBucket(b: string): string {
  return b.length === 7 ? b.slice(5) : b.slice(5);
}

function tip(b: Bucket): string {
  const test = b.cents - b.realCents;
  return `${b.bucket}\n共 ${b.count} 笔 ${money(b.cents)}\n真实 ${b.realCount} 笔 ${money(b.realCents)}` +
    (test > 0 ? `\n测试 ${money(test)}` : '');
}

function queryBase(): string {
  const p = new URLSearchParams();
  p.set('from', range.value[0]);
  p.set('to', range.value[1]);
  return p.toString();
}

async function loadSummary(): Promise<void> {
  loadingSummary.value = true;
  try {
    const p = new URLSearchParams(queryBase());
    p.set('granularity', granularity.value);
    const d = await api<Summary>(`/admin/finance/summary?${p.toString()}`);
    series.value = d.series;
    byPlan.value = d.byPlan;
    byChannel.value = d.byChannel;
    summary.value = d.totals;
    error.value = '';
  } catch (e) {
    error.value = (e as ApiError).message;
  } finally {
    loadingSummary.value = false;
  }
}

async function loadOrders(): Promise<void> {
  loadingOrders.value = true;
  try {
    const p = new URLSearchParams(queryBase());
    if (status.value) { p.set('status', status.value); }
    if (channel.value) { p.set('channel', channel.value); }
    p.set('page', String(page.value));
    p.set('pageSize', String(pageSize.value));
    const d = await api<{ total: number; items: OrderRow[] }>(`/admin/orders?${p.toString()}`);
    items.value = d.items;
    orderTotal.value = d.total;
    error.value = '';
  } catch (e) {
    error.value = (e as ApiError).message;
  } finally {
    loadingOrders.value = false;
  }
}

function reloadOrders(): void {
  page.value = 1;
  void loadOrders();
}

function onPage(n: number): void {
  page.value = n;
  void loadOrders();
}

function onSize(n: number): void {
  pageSize.value = n;
  page.value = 1;
  void loadOrders();
}

/** 导出**当前筛选条件下的全部**（不是这一页）—— 所以走一个独立的下拉链接，
    而不是把表格里这几行拼成 CSV。同源，Cookie 会自动带上。 */
function exportCsv(): void {
  const p = new URLSearchParams(queryBase());
  if (status.value) { p.set('status', status.value); }
  if (channel.value) { p.set('channel', channel.value); }
  const a = document.createElement('a');
  a.href = `/api/admin/orders/export?${p.toString()}`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  ElMessage.success('正在导出当前筛选的订单…');
}

onMounted(() => {
  void loadSummary();
  void loadOrders();
});
</script>

<style scoped>
.mb { margin-bottom: 12px; }
.head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.head__note { font-size: 12px; font-weight: 400; color: var(--admin-ink-3); }

.bar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.bar__date { max-width: 260px; }
.bar__sel { width: 140px; }
.bar__gap { flex: 1; }

.cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
.stat { border: 1px solid var(--admin-border, #e4e7ed); border-radius: 8px; padding: 14px 16px; }
.stat__label { font-size: 12px; color: var(--admin-ink-3); }
.stat__num { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; margin: 6px 0 4px; }
.stat__sub { font-size: 12px; color: var(--admin-ink-3); }

.chart { margin-bottom: 18px; }
.chart__head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px; }
.chart__title { font-size: 13px; font-weight: 600; }
.chart__legend { font-size: 12px; color: var(--admin-ink-3); }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin: 0 4px 0 10px; }
.dot--real { background: var(--el-color-primary); }
.dot--test { background: var(--el-color-warning); }

.chart__scroll { overflow-x: auto; }
.chart__bars { display: flex; align-items: flex-end; gap: 3px; min-height: 132px; }
.bar-col { flex: 1 0 14px; display: flex; flex-direction: column; align-items: center; }
.bar-col__stack {
  width: 100%; height: 110px; display: flex; flex-direction: column; justify-content: flex-end;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.03), rgba(0, 0, 0, 0));
  border-radius: 3px; overflow: hidden;
}
.bar-col__seg { width: 100%; }
.bar-col__seg--real { background: var(--el-color-primary); }
.bar-col__seg--test { background: var(--el-color-warning); opacity: 0.75; }
.bar-col__x { font-size: 10px; color: var(--admin-ink-3); margin-top: 4px; white-space: nowrap; }

.split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.sub { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
.sub--inline { margin-bottom: 0; margin-right: 6px; }

.pager { display: flex; align-items: center; justify-content: space-between; margin-top: 14px; }
.pager__all { font-size: 12px; color: var(--admin-ink-3); }

.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.dim { color: var(--admin-ink-3); }
.ml { margin-left: 6px; }
.empty { padding: 20px 0; font-size: 13px; color: var(--admin-ink-3); }
.foot { margin: 14px 0 0; font-size: 12px; line-height: 1.9; color: var(--admin-ink-3); }
</style>
