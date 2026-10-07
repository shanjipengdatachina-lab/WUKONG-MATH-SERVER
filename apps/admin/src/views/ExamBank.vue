<template>
  <el-card>
    <template #header>
      <div class="head">
        <span>真题题库（{{ rows.length }}）</span>
        <span class="head__note">
          中考 / 高考 / 模拟卷真题。<strong>列表不带答案</strong> —— 列表只给题面摘要；
          详情接口才把 answer / explanation 发出去。
        </span>
      </div>
    </template>

    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="mb" />
    <el-tag v-if="!canWrite" type="info" class="mb">只读（没有 exam.write）</el-tag>

    <!-- 筛选 -->
    <div class="filter">
      <el-input v-model="filter.q" size="small" placeholder="按编号 / 题干 / 地区 / 来源关键字搜" clearable class="filter__q" @change="load" />
      <el-select v-model="filter.year" size="small" placeholder="年份" clearable class="filter__sel" @change="load">
        <el-option v-for="y in facets.years" :key="y" :label="String(y)" :value="y" />
      </el-select>
      <el-select v-model="filter.region" size="small" placeholder="地区" clearable filterable class="filter__sel" @change="load">
        <el-option v-for="r in facets.regions" :key="r" :label="r" :value="r" />
      </el-select>
      <el-select v-model="filter.paperType" size="small" placeholder="卷型" clearable class="filter__sel" @change="load">
        <el-option v-for="p in facets.paperTypes" :key="p" :label="p" :value="p" />
      </el-select>
      <el-select v-model="filter.qtype" size="small" placeholder="题型" clearable class="filter__sel" @change="load">
        <el-option v-for="q in facets.qtypes" :key="q" :label="q" :value="q" />
      </el-select>
      <el-select v-model="filter.kind" size="small" placeholder="判分类型" clearable class="filter__sel" @change="load">
        <el-option label="选择题" value="choice" />
        <el-option label="填空题" value="blank" />
        <el-option label="白板题" value="board" />
      </el-select>
      <el-button size="small" type="primary" :disabled="!canWrite" @click="openCreate">录一道</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" stripe size="small">
      <el-table-column label="编号" width="140">
        <template #default="{ row }"><span class="mono">{{ row.code }}</span></template>
      </el-table-column>
      <el-table-column label="题干" min-width="280">
        <template #default="{ row }">
          <div class="stem" v-html="previewStem(row.stem)"></div>
        </template>
      </el-table-column>
      <el-table-column label="年份" width="80" align="center">
        <template #default="{ row }">{{ row.year }}</template>
      </el-table-column>
      <el-table-column label="地区" min-width="110">
        <template #default="{ row }">{{ row.region }}</template>
      </el-table-column>
      <el-table-column label="卷型" width="100">
        <template #default="{ row }">{{ row.paperType }}</template>
      </el-table-column>
      <el-table-column label="题型" width="100">
        <template #default="{ row }">{{ row.qtype }}</template>
      </el-table-column>
      <el-table-column label="难度" width="80" align="center">
        <template #default="{ row }">
          <el-rate :model-value="row.difficulty" disabled size="small" />
        </template>
      </el-table-column>
      <el-table-column label="章节" min-width="140">
        <template #default="{ row }">
          <span v-if="row.nodeId" class="dim">{{ row.nodeName }} <span class="mono">#{{ row.nodeId }}</span></span>
          <span v-else class="dim">—</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="140" align="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" :disabled="!canWrite" @click="openEdit(row)">改</el-button>
          <el-button link type="danger" size="small" :disabled="!canWrite" @click="remove(row)">删</el-button>
        </template>
      </el-table-column>
    </el-table>

    <p class="foot">
      最多列最近 500 道；再多就该分页。<br />
      列表项的题干做了<strong>纯文本预览</strong>（剥掉 HTML 标签），原样 HTML 在编辑表单里看。
    </p>

    <!-- 录入 / 编辑 dialog -->
    <el-dialog v-model="dialog.show" :title="dialog.id ? '改题' : '录入真题'" width="780px" top="6vh" :close-on-click-modal="false">
      <el-form :model="form" label-width="100px" size="default">
        <el-form-item label="判分类型" required>
          <el-radio-group v-model="form.kind" @change="onKindChange">
            <el-radio value="choice">选择题</el-radio>
            <el-radio value="blank">填空题</el-radio>
            <el-radio value="board">白板题（判不了分）</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="题干" required>
          <el-input v-model="form.stem" type="textarea" :rows="5" placeholder="HTML 文本，原样存原样渲染" />
        </el-form-item>

        <el-form-item v-if="form.kind === 'choice'" label="选项" required>
          <div class="opts">
            <div v-for="(op, i) in form.options" :key="i" class="opts__row">
              <el-input v-model="op.key" size="small" class="opts__key" placeholder="A" />
              <el-input v-model="op.text" size="small" class="opts__text" placeholder="选项文本" />
              <el-button link type="danger" size="small" @click="form.options.splice(i, 1)">删</el-button>
            </div>
            <el-button size="small" @click="form.options.push({ key: '', text: '' })">加一项</el-button>
          </div>
        </el-form-item>

        <el-form-item v-if="form.kind === 'blank'" label="空格" required>
          <div class="opts">
            <div v-for="(b, i) in form.blanks" :key="i" class="opts__row">
              <el-input v-model="b.label" size="small" class="opts__text" :placeholder="`第 ${i + 1} 空的提示`" />
              <el-button link type="danger" size="small" @click="form.blanks.splice(i, 1)">删</el-button>
            </div>
            <el-button size="small" @click="form.blanks.push({ label: '' })">加一空</el-button>
          </div>
        </el-form-item>

        <el-form-item v-if="form.kind !== 'board'" label="正确答案" required>
          <el-input v-model="form.answer" placeholder="单选填 B；多空用 | 分隔，如 -3|3" />
        </el-form-item>

        <el-form-item label="解析">
          <el-input v-model="form.explanation" type="textarea" :rows="4" placeholder="HTML；会员可见，免费看不到 —— 判分在服务端" />
        </el-form-item>

        <el-form-item label="年份" required>
          <el-input-number v-model="form.year" :min="1900" :max="2100" controls-position="right" />
        </el-form-item>

        <el-form-item label="地区" required>
          <el-input v-model="form.region" placeholder="北京 / 上海 / 全国卷Ⅰ / 海淀区二模" />
        </el-form-item>

        <el-form-item label="卷型" required>
          <el-input v-model="form.paperType" placeholder="中考 / 高考 / 模拟 / 期中 / 期末" />
        </el-form-item>

        <el-form-item label="题型" required>
          <el-input v-model="form.qtype" placeholder="选择题 / 填空题 / 解答题 / 证明题" />
        </el-form-item>

        <el-form-item label="难度">
          <el-rate v-model="form.difficulty" :max="5" />
        </el-form-item>

        <el-form-item label="题号">
          <el-input v-model="form.no" placeholder="卷面上的题号，例如 第 15 题；可空" />
        </el-form-item>

        <el-form-item label="章节">
          <el-tree-select
            v-model="form.nodeId"
            :data="treeData"
            :props="{ label: 'name', value: 'id', children: 'children' }"
            :render-after-expand="false"
            check-strictly
            clearable
            filterable
            :default-expand-all="false"
            placeholder="挂哪个章 / 节 / 知识点；可空"
            class="tree-sel"
          />
        </el-form-item>

        <el-form-item label="来源">
          <el-input v-model="form.source" placeholder="哪本教辅 / 第几页 / 网址；可空" />
        </el-form-item>

        <el-form-item label="编号">
          <el-input v-model="form.code" placeholder="不填由服务端用 id 拼，例如 exam-12" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialog.show = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessageBox } from 'element-plus';
import { api, auth, can, type ApiError } from '../api';

type Row = {
  id: number; kind: string; code: string; stem: string;
  year: number; region: string; paperType: string; qtype: string;
  difficulty: number; no: string | null; nodeId: number | null; nodeName: string;
  source: string | null; createdAt: string; updatedAt: string;
};
type Facets = { years: number[]; regions: string[]; paperTypes: string[]; qtypes: string[] };
type TreeNode = { id: number; name: string; children?: TreeNode[] };

const rows = ref<Row[]>([]);
const facets = reactive<Facets>({ years: [], regions: [], paperTypes: [], qtypes: [] });
const treeData = ref<TreeNode[]>([]);
const filter = reactive({
  q: '', year: null as number | null, region: '', paperType: '', qtype: '', kind: '',
});
const error = ref('');
const loading = ref(false);
const saving = ref(false);

const dialog = reactive({ show: false, id: 0 });
const form = reactive({
  kind: 'choice' as 'choice' | 'blank' | 'board',
  code: '',
  stem: '',
  options: [{ key: 'A', text: '' }] as { key: string; text: string }[],
  blanks: [{ label: '' }] as { label: string }[],
  answer: '',
  explanation: '',
  year: new Date().getFullYear(),
  region: '',
  paperType: '',
  qtype: '',
  difficulty: 3,
  no: '',
  nodeId: null as number | null,
  source: '',
});

const canWrite = computed(() => can('exam.write'));

function previewStem(html: string): string {
  // 列表里只给纯文本预览（剥 HTML），原样 HTML 在编辑 dialog 里看
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function onKindChange(): void {
  // 切换类型时清理不属于这一类型的字段，免得带着脏数据保存
  if (form.kind !== 'choice') { form.options = [{ key: 'A', text: '' }]; }
  if (form.kind !== 'blank') { form.blanks = [{ label: '' }]; }
  if (form.kind === 'board') { form.answer = ''; }
}

async function loadFacets(): Promise<void> {
  try {
    const got = await api<Facets>('/exams/facets');
    facets.years = got.years;
    facets.regions = got.regions;
    facets.paperTypes = got.paperTypes;
    facets.qtypes = got.qtypes;
  } catch { /* 题库可能还空着，facets 为空不算错 */ }
}

async function loadTree(): Promise<void> {
  try {
    const got = await api<{ tree: TreeNode }>('/tree');
    treeData.value = got.tree ? [got.tree] : [];
  } catch { /* 没树就空着，章节选择项空白 */ }
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const params = new URLSearchParams();
    if (filter.q) params.set('q', filter.q);
    if (filter.year) params.set('year', String(filter.year));
    if (filter.region) params.set('region', filter.region);
    if (filter.paperType) params.set('paperType', filter.paperType);
    if (filter.qtype) params.set('qtype', filter.qtype);
    if (filter.kind) params.set('kind', filter.kind);
    const q = params.toString() ? `?${params.toString()}` : '';
    const got = await api<{ total: number; items: Row[] }>(`/admin/exams${q}`);
    rows.value = got.items;
    error.value = '';
  } catch (e) {
    error.value = (e as ApiError).message;
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  dialog.id = 0;
  Object.assign(form, {
    kind: 'choice', code: '', stem: '',
    options: [{ key: 'A', text: '' }],
    blanks: [{ label: '' }],
    answer: '', explanation: '',
    year: new Date().getFullYear(),
    region: '', paperType: '', qtype: '',
    difficulty: 3, no: '', nodeId: null, source: '',
  });
  dialog.show = true;
}

async function openEdit(row: Row): Promise<void> {
  // 管理端详情接口给的是全字段（options / blanks / answer / explanation 都有）——
  // 列表项没这几样，编辑表单得另取一次详情，免得管理员每次重填答案与解析。
  let detail: { options: { key: string; text: string }[]; blanks: { label: string }[]; answer: string | null; explanation: string | null } | null = null;
  try {
    detail = await api<typeof detail>(`/admin/exams/${row.id}`);
  } catch (e) {
    error.value = (e as ApiError).message;
    return;
  }
  dialog.id = row.id;
  Object.assign(form, {
    kind: row.kind as 'choice' | 'blank' | 'board',
    code: row.code, stem: row.stem,
    options: detail && detail.options && detail.options.length ? detail.options.map((o) => ({ key: o.key, text: o.text })) : row.kind === 'choice' ? [{ key: 'A', text: '' }] : [],
    blanks: detail && detail.blanks && detail.blanks.length ? detail.blanks.map((b) => ({ label: b.label })) : row.kind === 'blank' ? [{ label: '' }] : [],
    answer: detail ? detail.answer ?? '' : '',
    explanation: detail ? detail.explanation ?? '' : '',
    year: row.year, region: row.region, paperType: row.paperType, qtype: row.qtype,
    difficulty: row.difficulty,
    no: row.no ?? '',
    nodeId: row.nodeId,
    source: row.source ?? '',
  });
  dialog.show = true;
}

async function save(): Promise<void> {
  // 基础校验：题干 / 年份 / 地区 / 卷型 / 题型 / 配套字段
  if (!form.stem.trim()) { error.value = '题干不能为空'; return; }
  if (!form.region.trim() || !form.paperType.trim() || !form.qtype.trim()) {
    error.value = '地区 / 卷型 / 题型都要填';
    return;
  }
  if (form.kind === 'choice' && (!form.options.length || !form.answer)) {
    error.value = '选择题必须有选项与正确答案'; return;
  }
  if (form.kind === 'blank' && (!form.blanks.length || !form.answer)) {
    error.value = '填空题必须有空格与正确答案'; return;
  }

  saving.value = true;
  try {
    const body: Record<string, unknown> = {
      kind: form.kind,
      stem: form.stem,
      year: form.year,
      region: form.region,
      paperType: form.paperType,
      qtype: form.qtype,
      difficulty: form.difficulty,
      no: form.no || null,
      nodeId: form.nodeId,
      source: form.source || null,
    };
    if (form.code) { body.code = form.code; }
    if (form.kind === 'choice') {
      body.options = form.options.filter((o) => o.key && o.text);
      body.answer = form.answer;
    } else if (form.kind === 'blank') {
      body.blanks = form.blanks.filter((b) => b.label);
      body.answer = form.answer;
    } else {
      // board 不要 options / blanks / answer
      body.options = [];
      body.blanks = [];
      body.answer = null;
    }
    if (form.explanation) { body.explanation = form.explanation; }

    if (dialog.id) {
      await api(`/admin/exams/${dialog.id}`, { method: 'PATCH', body: JSON.stringify(body) });
    } else {
      await api('/admin/exams', { method: 'POST', body: JSON.stringify(body) });
    }
    dialog.show = false;
    error.value = '';
    await load();
    await loadFacets();
  } catch (e) {
    error.value = (e as ApiError).message;
  } finally {
    saving.value = false;
  }
}

async function remove(row: Row): Promise<void> {
  try {
    await ElMessageBox.confirm(`删掉「${row.code}」？这道真题就没了`, '确认', {
      type: 'warning', confirmButtonText: '删', cancelButtonText: '取消',
    });
  } catch { return; /* 用户取消不算错 */ }
  try {
    await api(`/admin/exams/${row.id}`, { method: 'DELETE' });
    await load();
  } catch (e) {
    error.value = (e as ApiError).message;
  }
}

onMounted(() => {
  load();
  loadFacets();
  loadTree();
});
</script>

<style scoped>
.mb { margin-bottom: 12px; }
.head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.head__note { font-size: 12px; font-weight: 400; color: var(--admin-ink-3); max-width: 60%; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.dim { color: var(--admin-ink-3); }

.filter { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.filter__q { width: 280px; }
.filter__sel { width: 140px; }

.stem { line-height: 1.6; color: var(--admin-ink); }
.foot { margin: 14px 0 0; font-size: 12px; line-height: 1.9; color: var(--admin-ink-3); }

.opts { display: flex; flex-direction: column; gap: 6px; }
.opts__row { display: flex; align-items: center; gap: 6px; }
.opts__key { width: 70px; }
.opts__text { flex: 1; min-width: 200px; }

.tree-sel { width: 100%; }
</style>
