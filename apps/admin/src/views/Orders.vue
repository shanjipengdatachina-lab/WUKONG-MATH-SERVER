<template>
  <el-card>
    <template #header>
      <div class="head">
        <span>订单（{{ rows.length }}）</span>
        <span class="head__note">收了钱要看得见，也要看得清哪一笔是测试单</span>
      </div>
    </template>

    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="mb" />

    <div class="sum">
      <div class="sum__item">
        <span class="sum__label">真实收款</span>
        <span class="sum__value">{{ money(summary.realPaidCents) }}</span>
        <span class="sum__sub">共 {{ summary.realPaidCount }} 笔 · 不含测试通道</span>
      </div>
      <div class="sum__item">
        <span class="sum__label">全部已支付</span>
        <span class="sum__value">{{ money(summary.paidCents) }}</span>
        <span class="sum__sub">共 {{ summary.paidCount }} 笔 · 含测试单</span>
      </div>
      <div class="sum__item">
        <span class="sum__label">待支付</span>
        <span class="sum__value">{{ summary.pendingCount }}</span>
        <span class="sum__sub">笔</span>
      </div>
      <div class="sum__item">
        <span class="sum__label">已超时</span>
        <span class="sum__value">{{ summary.expiredCount }}</span>
        <span class="sum__sub">笔</span>
      </div>
    </div>

    <p class="hint">
      「真实收款」那一栏<strong>只算非测试通道</strong>的单。把测试单混进去，对账的人会把它当成真钱 ——
      而那正是最不该发生的事。现在还没有真实通道（商户资质在申请），所以这个数是 0：
      <strong>这是对的，不是 bug</strong>。
    </p>

    <el-radio-group v-model="status" size="small" class="mb" @change="load">
      <el-radio-button value="">全部</el-radio-button>
      <el-radio-button value="paid">已支付</el-radio-button>
      <el-radio-button value="pending">待支付</el-radio-button>
      <el-radio-button value="expired">已超时</el-radio-button>
    </el-radio-group>

    <el-table v-loading="loading" :data="rows" stripe>
      <el-table-column label="订单号" min-width="180">
        <template #default="{ row }">
          <span class="mono">{{ row.orderNo }}</span>
        </template>
      </el-table-column>
      <el-table-column label="下单人" min-width="150">
        <template #default="{ row }">
          {{ row.nickname }}
          <span class="dim mono">{{ row.username }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="planName" label="方案" min-width="110" />
      <el-table-column label="金额" width="140" align="right">
        <template #default="{ row }">
          <span class="num">{{ money(row.amountCents) }}</span>
          <el-tag v-if="row.isTest" size="small" type="warning" effect="plain" class="tag">测试</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag size="small" :type="toneOf(row.status)" effect="light">{{ statusText(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="通道" width="110">
        <template #default="{ row }">
          <span :class="{ dim: row.isTest }">{{ row.channelName }}</span>
        </template>
      </el-table-column>
      <el-table-column label="时间" min-width="170">
        <template #default="{ row }">
          <span class="mono dim">{{ when(row.paidAt || row.createdAt) }}</span>
        </template>
      </el-table-column>
    </el-table>

    <p class="foot">
      状态是<strong>读的时候现算</strong>的：待支付过了超时时间就显示「已超时」，
      不需要定时任务去翻它（和会员到期同一套办法）。
      现在最多列最近 200 笔；再多就该做分页，而不是把整张表拉给浏览器。
    </p>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, type ApiError } from '../api';

type Row = {
  orderNo: string; username: string; nickname: string; planName: string;
  amountCents: number; status: string; channel: string; channelName: string;
  isTest: boolean; createdAt: string; expiresAt: string; paidAt: string | null;
};
type Summary = {
  paidCount: number; paidCents: number; realPaidCount: number; realPaidCents: number;
  pendingCount: number; expiredCount: number;
};

const rows = ref<Row[]>([]);
const summary = ref<Summary>({
  paidCount: 0, paidCents: 0, realPaidCount: 0, realPaidCents: 0, pendingCount: 0, expiredCount: 0,
});
const status = ref('');
const error = ref('');
const loading = ref(false);

function money(cents: number): string {
  return '¥' + (cents / 100).toFixed(2);
}

function when(iso: string | null): string {
  if (!iso) { return '—'; }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) { return iso; }
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function statusText(s: string): string {
  return { paid: '已支付', pending: '待支付', expired: '已超时', canceled: '已取消' }[s] ?? s;
}

function toneOf(s: string): 'success' | 'warning' | 'info' | 'danger' {
  if (s === 'paid') { return 'success'; }
  if (s === 'pending') { return 'warning'; }
  if (s === 'canceled') { return 'danger'; }
  return 'info';
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const q = status.value ? `?status=${encodeURIComponent(status.value)}` : '';
    const got = await api<{ total: number; items: Row[]; summary: Summary }>(`/admin/orders${q}`);
    rows.value = got.items;
    summary.value = got.summary;
    error.value = '';
  } catch (e) {
    error.value = (e as ApiError).message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.mb { margin-bottom: 12px; }
.head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.head__note { font-size: 12px; font-weight: 400; color: var(--admin-ink-3); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.dim { color: var(--admin-ink-3); }
.num { font-variant-numeric: tabular-nums; }
.tag { margin-left: 6px; }

.sum { display: flex; flex-wrap: wrap; gap: 28px; padding: 4px 0 14px; }
.sum__item { display: flex; flex-direction: column; gap: 2px; }
.sum__label { font-size: 12px; color: var(--admin-ink-3); }
.sum__value { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--admin-ink); }
.sum__sub { font-size: 12px; color: var(--admin-ink-3); }

.hint { margin: 0 0 14px; font-size: 12px; line-height: 1.9; color: var(--admin-ink-3); }
.foot { margin: 14px 0 0; font-size: 12px; line-height: 1.9; color: var(--admin-ink-3); }
</style>
