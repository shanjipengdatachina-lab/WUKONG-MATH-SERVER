<template>
  <div class="pl">
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="pl__err" />
    <el-alert v-if="saved" :title="saved" type="success" show-icon :closable="false" class="pl__err" />

    <el-tag v-if="!canWrite" type="info" class="pl__ro">只读（没有 plan.write）</el-tag>

    <!-- ============ 套餐 ============ -->
    <section class="pl__sec">
      <div class="pl__head">
        <h2>套餐</h2>
        <span class="pl__note">
          价格以<strong>元</strong>填，入库按<strong>分</strong>存（浮点存钱早晚差一分）。
          时长按天：免费版填 0（不过期）。
        </span>
      </div>

      <el-table :data="plans" size="small" class="pl__table">
        <el-table-column label="名称" min-width="130">
          <template #default="{ row }"><el-input v-model="row.name" size="small" :disabled="!canWrite" /></template>
        </el-table-column>
        <el-table-column label="代号" width="110">
          <template #default="{ row }"><span class="pl__code">{{ row.code }}</span></template>
        </el-table-column>
        <el-table-column label="价格（元）" width="130">
          <template #default="{ row }">
            <el-input-number v-model="row.priceYuan" size="small" :min="0" :precision="2" :step="10"
              controls-position="right" style="width:100%" :disabled="!canWrite" />
          </template>
        </el-table-column>
        <el-table-column label="原价（元）" width="120">
          <template #default="{ row }">
            <el-input-number v-model="row.originalYuan" size="small" :min="0" :precision="2" :step="10"
              controls-position="right" style="width:100%" :disabled="!canWrite" />
          </template>
        </el-table-column>
        <el-table-column label="时长（天）" width="120">
          <template #default="{ row }">
            <el-input-number v-model="row.days" size="small" :min="0" :step="30"
              controls-position="right" style="width:100%" :disabled="!canWrite" />
          </template>
        </el-table-column>
        <el-table-column label="卖点" min-width="200">
          <template #default="{ row }"><el-input v-model="row.tagline" size="small" :disabled="!canWrite" /></template>
        </el-table-column>
        <el-table-column label="推荐" width="70" align="center">
          <template #default="{ row }"><el-switch v-model="row.featured" size="small" :disabled="!canWrite" /></template>
        </el-table-column>
        <el-table-column label="上架" width="70" align="center">
          <template #default="{ row }"><el-switch v-model="row.active" size="small" :disabled="!canWrite" /></template>
        </el-table-column>
        <el-table-column label="已购" width="70" align="center">
          <template #default="{ row }">
            <span :class="{ 'pl__warn': row.subscribers > 0 }">{{ row.subscribers }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" align="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" :disabled="!canWrite" @click="savePlan(row)">保存</el-button>
            <el-button link type="danger" size="small" :disabled="!canWrite || row.code === 'free'" @click="removePlan(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pl__add">
        <el-input v-model="newPlan.code" size="small" placeholder="代号（英文，建了不改）" class="pl__add-code" :disabled="!canWrite" />
        <el-input v-model="newPlan.name" size="small" placeholder="名称，例如 两年会员" class="pl__add-name" :disabled="!canWrite" />
        <el-input-number v-model="newPlan.priceYuan" size="small" :min="0" :precision="2" :step="10"
          controls-position="right" class="pl__add-num" :disabled="!canWrite" />
        <el-input-number v-model="newPlan.days" size="small" :min="0" :step="30"
          controls-position="right" class="pl__add-num" :disabled="!canWrite" />
        <el-button size="small" type="primary" :disabled="!canWrite || !newPlan.code || !newPlan.name" :loading="adding" @click="addPlan">新增套餐</el-button>
      </div>
    </section>

    <!-- ============ 服务项目 ============ -->
    <section class="pl__sec">
      <div class="pl__head">
        <h2>服务项目</h2>
        <span class="pl__note">对比表里的<strong>每一行</strong>。改一行，所有套餐上的那一格跟着走。</span>
      </div>

      <el-table :data="services" size="small" class="pl__table">
        <el-table-column label="名称" min-width="180">
          <template #default="{ row }"><el-input v-model="row.name" size="small" :disabled="!canWrite" /></template>
        </el-table-column>
        <el-table-column label="代号" width="150">
          <template #default="{ row }"><span class="pl__code">{{ row.code }}</span></template>
        </el-table-column>
        <el-table-column label="说明" min-width="220">
          <template #default="{ row }"><el-input v-model="row.desc" size="small" :disabled="!canWrite" /></template>
        </el-table-column>
        <el-table-column label="上架" width="70" align="center">
          <template #default="{ row }"><el-switch v-model="row.active" size="small" :disabled="!canWrite" /></template>
        </el-table-column>
        <el-table-column label="操作" width="140" align="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" :disabled="!canWrite" @click="saveService(row)">保存</el-button>
            <el-button link type="danger" size="small" :disabled="!canWrite" @click="removeService(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pl__add">
        <el-input v-model="newService.code" size="small" placeholder="代号（英文 + 下划线）" class="pl__add-code" :disabled="!canWrite" />
        <el-input v-model="newService.name" size="small" placeholder="名称，例如 试卷精讲" class="pl__add-name" :disabled="!canWrite" />
        <el-input v-model="newService.desc" size="small" placeholder="一句话说明" class="pl__add-desc" :disabled="!canWrite" />
        <el-button size="small" type="primary" :disabled="!canWrite || !newService.code || !newService.name" :loading="adding" @click="addService">新增服务项目</el-button>
      </div>
    </section>

    <!-- ============ 矩阵 ============ -->
    <section class="pl__sec">
      <div class="pl__head">
        <h2>权益对照</h2>
        <span class="pl__note">
          开关 = 这个套餐含不含这一项；中间那格填「显示什么字」（「50 道」「不限」「进阶」），
          留空就显示 ✓。最后那个「上限」只有额度型项目才出现 —— 它填的数字
          <strong>服务端真的会照着执行</strong>（比如错题本容量），
          所以"显示的说法"和"执行的数"是分开管的。改一格存一格。
        </span>
      </div>

      <div class="pl__matrix-wrap">
        <table class="pl__matrix">
          <thead>
            <tr>
              <th class="pl__mx-row">服务项目</th>
              <th v-for="p in plans" :key="p.id">
                {{ p.name }}
                <span v-if="!p.active" class="pl__off">已下架</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in services" :key="s.id">
              <th class="pl__mx-row">{{ s.name }}</th>
              <td v-for="p in plans" :key="p.id">
                <div class="pl__cell">
                  <el-switch
                    :model-value="!!cellOf(p.id, s.id).included"
                    size="small"
                    :disabled="!canWrite"
                    @update:model-value="(v) => setIncluded(p.id, s.id, !!v)"
                  />
                  <el-input
                    :model-value="cellOf(p.id, s.id).value"
                    size="small"
                    placeholder="留空 = ✓"
                    class="pl__cell-input"
                    :disabled="!canWrite || !cellOf(p.id, s.id).included"
                    @update:model-value="(v) => setValue(p.id, s.id, String(v))"
                    @blur="saveCell(p.id, s.id)"
                    @keyup.enter="saveCell(p.id, s.id)"
                  />
                  <!-- 上限只给"服务端真会按它执行"的项配输入框。
                       给每一项都摆一个，就会出现"填了数字、什么也没发生" —— 那是最糟的控件。 -->
                  <el-input
                    v-if="QUOTA_CODES.includes(s.code)"
                    :model-value="cellOf(p.id, s.id).quota === null ? '' : String(cellOf(p.id, s.id).quota)"
                    size="small"
                    placeholder="上限，留空=不限"
                    class="pl__cell-input pl__cell-quota"
                    :disabled="!canWrite || !cellOf(p.id, s.id).included"
                    @update:model-value="(v) => setQuota(p.id, s.id, String(v))"
                    @blur="saveCell(p.id, s.id)"
                    @keyup.enter="saveCell(p.id, s.id)"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="pl__hint">
        改完之后去学生端的「会员中心」刷新一下就能看到 —— 那一页的价格与权益全部来自这两个接口，
        页面里一处都没写死。
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
/* ==========================================================================
   套餐与服务项目
   --------------------------------------------------------------------------
   这张配置就是**两列一矩阵**：
     列 = 套餐（免费 / 半年 / 一年 / 三年，可增删）
     行 = 服务项目
     格 = 含不含 + 这一格显示什么字
   前台（学生端「会员中心」）整页照着它渲染 —— 价格、权益名一个都不写死在页面里。
   ========================================================================== */
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, can, type ApiError } from '../api';

type PlanRow = {
  id: number; code: string; name: string; priceCents: number; originalCents: number;
  days: number; tagline: string | null; featured: boolean; active: boolean; order: number;
  subscribers: number;
  /* 界面上按"元"编辑，提交时再乘 100 */
  priceYuan: number; originalYuan: number;
};
type ServiceRow = {
  id: number; code: string; name: string; desc: string | null; order: number; active: boolean;
};
type Cell = { planId: number; serviceId: number; included: boolean; value: string | null; quota: number | null };

/**
 * 服务端**会按"上限"执行**的服务项目。
 * 目前只有错题本容量（后台配 50，服务端就按 50 截断，见 apps/api/src/middleware/perk.ts）。
 * 加新的额度型项目时**这里和后端要一起动** —— 所以摆在一眼看得见的地方，
 * 别让它俩悄悄失配（失配的样子是：后台填了数字，实际什么也没发生）。
 */
const QUOTA_CODES = ['mistake_capacity'];

const plans = ref<PlanRow[]>([]);
const services = ref<ServiceRow[]>([]);
const cells = reactive<Record<string, Cell>>({});
const error = ref('');
const saved = ref('');
const adding = ref(false);

const newPlan = reactive({ code: '', name: '', priceYuan: 0, days: 365 });
const newService = reactive({ code: '', name: '', desc: '' });

const canWrite = computed(() => can('plan.write'));

function key(planId: number, serviceId: number): string { return planId + ':' + serviceId; }

/** 取一格。表里缺这一格（新加的行/列还没来得及补）时返回一个临时的"不含"。 */
function cellOf(planId: number, serviceId: number): Cell {
  const k = key(planId, serviceId);
  if (!cells[k]) { cells[k] = { planId, serviceId, included: false, value: null, quota: null }; }
  return cells[k];
}

function fail(e: unknown): void { error.value = (e as ApiError).message || String(e); }
function ok(msg: string): void {
  saved.value = msg;
  window.setTimeout(() => { if (saved.value === msg) { saved.value = ''; } }, 2500);
}

async function load(): Promise<void> {
  error.value = '';
  try {
    const got = await api<{
      plans: Omit<PlanRow, 'priceYuan' | 'originalYuan'>[];
      services: ServiceRow[];
      cells: Cell[];
    }>('/admin/plans');

    plans.value = got.plans.map((p) => ({
      ...p,
      priceYuan: p.priceCents / 100,
      originalYuan: p.originalCents / 100,
    }));
    services.value = got.services;

    Object.keys(cells).forEach((k) => { delete cells[k]; });
    got.cells.forEach((c) => { cells[key(c.planId, c.serviceId)] = { ...c }; });
  } catch (e) { fail(e); }
}

/* ---------------- 套餐 ---------------- */

async function savePlan(row: PlanRow): Promise<void> {
  error.value = '';
  try {
    await api(`/admin/plans/${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: row.name,
        priceCents: Math.round(row.priceYuan * 100),
        originalCents: Math.round(row.originalYuan * 100),
        days: row.days,
        tagline: row.tagline || null,
        featured: row.featured,
        active: row.active,
      }),
    });
    ok(`「${row.name}」已保存`);
  } catch (e) { fail(e); }
}

async function addPlan(): Promise<void> {
  adding.value = true;
  error.value = '';
  try {
    await api('/admin/plans', {
      method: 'POST',
      body: JSON.stringify({
        code: newPlan.code, name: newPlan.name,
        priceCents: Math.round(newPlan.priceYuan * 100), days: newPlan.days,
      }),
    });
    newPlan.code = ''; newPlan.name = ''; newPlan.priceYuan = 0; newPlan.days = 365;
    ok('套餐已新增（新套餐的每一格默认"不含"，记得去下面勾）');
    await load();
  } catch (e) { fail(e); } finally { adding.value = false; }
}

async function removePlan(row: PlanRow): Promise<void> {
  if (row.subscribers > 0) {
    ElMessage.warning(`有 ${row.subscribers} 个人的订阅指着它 —— 请改成下架，别删`);
    return;
  }
  try {
    await ElMessageBox.confirm(`确定删掉套餐「${row.name}」？它在各服务上的勾选会一起没。`, '删套餐',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '算了' });
  } catch { return; }
  error.value = '';
  try {
    await api(`/admin/plans/${row.id}`, { method: 'DELETE' });
    ok('套餐已删除');
    await load();
  } catch (e) { fail(e); }
}

/* ---------------- 服务项目 ---------------- */

async function saveService(row: ServiceRow): Promise<void> {
  error.value = '';
  try {
    await api(`/admin/services/${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: row.name, desc: row.desc || null, active: row.active }),
    });
    ok(`「${row.name}」已保存`);
  } catch (e) { fail(e); }
}

async function addService(): Promise<void> {
  adding.value = true;
  error.value = '';
  try {
    await api('/admin/services', {
      method: 'POST',
      body: JSON.stringify({ code: newService.code, name: newService.name, desc: newService.desc || null }),
    });
    newService.code = ''; newService.name = ''; newService.desc = '';
    ok('服务项目已新增（各套餐上默认"不含"）');
    await load();
  } catch (e) { fail(e); } finally { adding.value = false; }
}

async function removeService(row: ServiceRow): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删掉服务项目「${row.name}」？它在各套餐上的那一格会一起没。`, '删服务项目',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '算了' });
  } catch { return; }
  error.value = '';
  try {
    await api(`/admin/services/${row.id}`, { method: 'DELETE' });
    ok('服务项目已删除');
    await load();
  } catch (e) { fail(e); }
}

/* ---------------- 矩阵 ---------------- */

function setIncluded(planId: number, serviceId: number, v: boolean): void {
  cellOf(planId, serviceId).included = v;
  void saveCell(planId, serviceId);
}

function setValue(planId: number, serviceId: number, v: string): void {
  cellOf(planId, serviceId).value = v === '' ? null : v;
}

/** 上限：留空 = 不限（null）。填的不是非负整数就当没填 —— 但**不能**把 null 当成 0 写下去。 */
function setQuota(planId: number, serviceId: number, v: string): void {
  const t = v.trim();
  if (t === '') { cellOf(planId, serviceId).quota = null; return; }
  const n = Number(t);
  cellOf(planId, serviceId).quota = Number.isInteger(n) && n >= 0 ? n : null;
}

async function saveCell(planId: number, serviceId: number): Promise<void> {
  const cell = cellOf(planId, serviceId);
  error.value = '';
  try {
    await api('/admin/plan-services', {
      method: 'PUT',
      body: JSON.stringify({
        planId, serviceId, included: cell.included, value: cell.value, quota: cell.quota,
      }),
    });
    ok('这一格已保存');
  } catch (e) { fail(e); }
}

onMounted(load);
</script>

<style scoped>
.pl { display: flex; flex-direction: column; gap: 22px; }
.pl__err { margin-bottom: 0; }
.pl__ro { align-self: flex-start; }

.pl__sec { border-top: 1px solid var(--admin-line); padding-top: 18px; }
.pl__sec:first-of-type { border-top: none; padding-top: 0; }

.pl__head { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-bottom: 12px; }
.pl__head h2 { margin: 0; font-size: 15px; font-weight: 600; color: var(--admin-ink); }
.pl__note { font-size: 12px; line-height: 1.8; color: var(--admin-ink-3); max-width: 46em; }
.pl__note strong { color: var(--admin-ink-2); }

.pl__table { width: 100%; }
.pl__code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--admin-ink-3); }
.pl__warn { color: var(--el-color-warning); font-weight: 600; }

.pl__add { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 12px; }
.pl__add-code { width: 190px; }
.pl__add-name { width: 190px; }
.pl__add-desc { width: 220px; }
.pl__add-num { width: 130px; }

.pl__matrix-wrap { overflow-x: auto; }
.pl__matrix { width: 100%; border-collapse: collapse; font-size: 13px; }
.pl__matrix th, .pl__matrix td {
  border: 1px solid var(--admin-line);
  padding: 8px 10px;
  text-align: left;
  vertical-align: middle;
}
.pl__matrix thead th { background: #fafbfc; font-weight: 500; color: var(--admin-ink-2); }
.pl__mx-row { width: 190px; font-weight: 500; color: var(--admin-ink); background: #fcfcfd; }
.pl__off { margin-left: 6px; font-size: 11px; color: var(--admin-ink-3); }
.pl__cell { display: flex; align-items: center; gap: 8px; }
.pl__cell-input { width: 120px; }
/* 上限那一栏只有额度型项目才有。做得比文案栏窄一点、字色淡一点，
   一眼看得出"这一栏是可选的、而且它管的是数字不是说法" */
.pl__cell-quota { width: 140px; }
.pl__cell-quota :deep(.el-input__inner) { color: var(--admin-ink-2); }

.pl__hint { margin: 10px 0 0; font-size: 12px; line-height: 1.8; color: var(--admin-ink-3); }
</style>
