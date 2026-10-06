<template>
  <div class="ed">
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="ed__err" />

    <template v-if="detail">
      <!-- ---------- 位置 ---------- -->
      <section class="ed__sec">
        <div class="ed__sec-head">
          <h3>这个节点</h3>
          <span class="ed__kind" :data-kind="detail.node.kind">{{ kindLabel(detail.node.kind) }}</span>
        </div>
        <p class="ed__path">
          <span v-for="(n, i) in path" :key="i">
            <span class="ed__path-sep" v-if="i">/</span>{{ n }}
          </span>
        </p>
        <div class="ed__meta">
          <span>子节点 <b>{{ detail.children }}</b></span>
          <span>后代 <b>{{ detail.descendants }}</b></span>
          <span>正文 <b>{{ detail.contentVersions }}</b> 版</span>
          <span>id <b>{{ detail.node.id }}</b></span>
        </div>
        <div class="ed__row">
          <el-button size="small" :disabled="!canWrite || detail.node.kind === 'root'" @click="move(-1)">上移</el-button>
          <el-button size="small" :disabled="!canWrite || detail.node.kind === 'root'" @click="move(1)">下移</el-button>
          <el-button size="small" type="danger" plain :disabled="!canWrite || detail.node.kind === 'root'" @click="remove">
            删除{{ detail.descendants ? `（含 ${detail.descendants} 个后代）` : '' }}
          </el-button>
        </div>
      </section>

      <!-- ---------- 字段 ---------- -->
      <section class="ed__sec">
        <div class="ed__sec-head"><h3>字段</h3></div>
        <el-form label-position="top" size="small" class="ed__form">
          <el-form-item label="名称">
            <el-input v-model="form.name" :disabled="!canWrite" placeholder="节点名" />
          </el-form-item>

          <el-form-item v-if="has('no')" label="序号 no">
            <el-input v-model="form.no" :disabled="!canWrite" placeholder="例如 1.2 / 01" />
          </el-form-item>

          <el-form-item v-if="has('stage')" label="学段 stage">
            <el-select v-model="form.stage" :disabled="!canWrite" clearable placeholder="选一个">
              <el-option v-for="s in STAGES" :key="s.key" :label="s.label" :value="s.key" />
            </el-select>
          </el-form-item>

          <el-form-item v-if="has('source')" label="出处 source">
            <el-input v-model="form.source" :disabled="!canWrite" placeholder="教材页 / 竞赛出处链接" />
          </el-form-item>

          <el-form-item v-if="has('field')" label="领域 field">
            <el-input v-model="form.field" :disabled="!canWrite" placeholder="数与代数 / 图形与几何 …" />
          </el-form-item>

          <el-form-item v-if="has('cn')" label="中文序号 cn">
            <el-input v-model="form.cn" :disabled="!canWrite" placeholder="一 / 二 / 三 …" />
          </el-form-item>

          <el-form-item v-if="has('unit')" label="单元标记 unit">
            <el-switch v-model="form.unit" :disabled="!canWrite" />
          </el-form-item>

          <el-form-item v-if="has('tone')" label="分组色调 tone">
            <el-select v-model="form.tone" :disabled="!canWrite" clearable placeholder="选一个">
              <el-option v-for="t in TONES" :key="t.key" :label="t.label" :value="t.key" />
            </el-select>
          </el-form-item>

          <el-form-item v-if="has('pending')" label="待核对说明 pending">
            <el-input v-model="form.pending" :disabled="!canWrite" type="textarea" :rows="2" />
          </el-form-item>

          <p class="ed__hint">
            每种节点只认自己该有的字段（册：学段 + 出处；章：序号 + 领域 + 中文序号 + 单元 + 待核；
            节 / 知识点 / 方法 / 易错 / 真题：序号；组：色调）。不在这一组里的会自动清空。
          </p>
        </el-form>
        <el-button type="primary" size="small" :disabled="!canWrite" :loading="saving" @click="saveFields">保存字段</el-button>
      </section>

      <!-- ---------- 加子节点 ---------- -->
      <section class="ed__sec">
        <div class="ed__sec-head"><h3>在这个节点下新增</h3></div>
        <div class="ed__row">
          <el-select v-model="newKind" size="small" class="ed__grow" :disabled="!canWrite">
            <el-option v-for="k in childKinds" :key="k" :label="kindLabel(k) + '（' + k + '）'" :value="k" />
          </el-select>
          <el-input v-model="newName" size="small" class="ed__grow" placeholder="新节点名" :disabled="!canWrite" @keyup.enter="addChild" />
          <el-button size="small" type="primary" :disabled="!canWrite || !newName" :loading="adding" @click="addChild">新增</el-button>
        </div>
      </section>

      <!-- ---------- 正文 ---------- -->
      <section class="ed__sec">
        <div class="ed__sec-head">
          <h3>正文</h3>
          <span class="ed__sec-note">
            {{ html.length }} 字符 · 已有 {{ detail.contentVersions }} 版
            <template v-if="detail.latestContentVersion">（最新 v{{ detail.latestContentVersion }}）</template>
          </span>
        </div>

        <div class="ed__tabs">
          <el-radio-group v-model="htmlMode" size="small">
            <el-radio-button value="edit">编辑源码</el-radio-button>
            <el-radio-button value="preview">预览</el-radio-button>
          </el-radio-group>
          <el-button
            v-if="detail.latestContentVersion"
            size="small"
            :disabled="!canRead"
            @click="loadLatest"
          >载入最新版</el-button>
        </div>

        <textarea
          v-if="htmlMode === 'edit'"
          v-model="html"
          class="ed__code"
          spellcheck="false"
          placeholder="<p>这一节的正文…</p>"
          :readonly="!canWriteContent"
        ></textarea>
        <div v-else class="ed__preview" v-html="html || '<p class=&quot;dim&quot;>还没有正文</p>'"></div>

        <div class="ed__row">
          <el-button
            type="primary" size="small"
            :disabled="!canWriteContent || !html"
            :loading="writing"
            @click="writeContent"
          >存成新版</el-button>
          <span class="ed__hint ed__hint--inline">改一次存一版，不覆盖历史 —— 改坏了能读回上一版。</span>
        </div>

        <div v-if="versions.length" class="ed__versions">
          <p class="ed__versions-title">历史版本</p>
          <div v-for="v in versions" :key="v.version" class="ed__version">
            <span class="ed__version-no">v{{ v.version }}</span>
            <span class="ed__version-meta">{{ v.chars }} 字符 · {{ short(v.createdAt) }}</span>
            <el-button link type="primary" size="small" :disabled="!canRead" @click="loadVersion(v.version)">载入</el-button>
          </div>
        </div>
      </section>
    </template>

    <el-empty v-else-if="!loading" description="左边点一个节点开始改" />
  </div>
</template>

<script setup lang="ts">
/* ==========================================================================
   节点编辑面板
   --------------------------------------------------------------------------
   字段是**按 kind 动态渲染**的：每种节点只认自己那几个字段（后台白名单与这里同源，
   都在 KIND_FIELDS）。不做成"一张大表单全列出来、不相关的置灰"——
   那会让人以为"节也能填学段"，而服务端会把那个值清掉。
   ========================================================================== */
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, can, type ApiError } from '../api';

const props = defineProps<{ nodeId: number | null; path?: string[] }>();
const emit = defineEmits<{ changed: []; 'update:path': [string[]] }>();

const STAGES = [
  { key: 'primary', label: '小学' },
  { key: 'junior', label: '初中' },
  { key: 'senior', label: '高中' },
  { key: 'olympiad', label: '竞赛' },
];
const TONES = [
  { key: 'method', label: '方法速学' },
  { key: 'error', label: '易错速析' },
  { key: 'exam', label: '真题速练' },
];
const KIND_CN: Record<string, string> = {
  root: '根', book: '册', chapter: '章', section: '节', point: '知识点',
  group: '组', method: '方法', error: '易错', exam: '真题', track: '竞赛轨道',
};

type Detail = {
  node: {
    id: number; kind: string; name: string; no: string | null; stage: string | null;
    source: string | null; field: string | null; cn: string | null; unit: boolean | null;
    pending: string | null; tone: string | null; order: number; parentId: number | null;
  };
  kindFields: string[];
  children: number;
  descendants: number;
  contentVersions: number;
  latestContentVersion: number | null;
};

const detail = ref<Detail | null>(null);
const versions = ref<{ version: number; chars: number; createdAt: string }[]>([]);
const html = ref('');
const htmlMode = ref<'edit' | 'preview'>('edit');
const loading = ref(false);
const saving = ref(false);
const adding = ref(false);
const writing = ref(false);
const error = ref('');

const form = reactive({
  name: '', no: '', stage: '', source: '', field: '', cn: '', unit: false, pending: '', tone: '',
});
/** 载入时的原值。提交时只发**跟它不一样的**字段 —— 见 saveFields 里那段注释。 */
const original = reactive({ ...form });
const newKind = ref('section');
const newName = ref('');

const canRead = computed(() => can('content.read'));
const canWrite = computed(() => can('tree.write'));
const canWriteContent = computed(() => can('content.write'));

const path = computed(() => props.path ?? []);

/* 子节点能建哪些类型：不给 root（只能有一个根），其余都可选 */
const childKinds = computed(() => Object.keys(KIND_CN).filter((k) => k !== 'root'));

const DEFAULT_CHILD: Record<string, string> = {
  root: 'book', book: 'chapter', track: 'chapter', chapter: 'section',
  section: 'point', point: 'method', group: 'method', method: 'noop', error: 'noop', exam: 'noop',
};

function kindLabel(k: string): string { return KIND_CN[k] || k; }
function has(f: string): boolean { return (detail.value?.kindFields ?? []).indexOf(f) >= 0; }
function short(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function fail(e: unknown): void { error.value = (e as ApiError).message || String(e); }

async function load(): Promise<void> {
  if (props.nodeId === null) { detail.value = null; versions.value = []; html.value = ''; return; }
  loading.value = true;
  error.value = '';
  try {
    const d = await api<Detail>(`/admin/nodes/${props.nodeId}`);
    detail.value = d;
    const n = d.node;
    form.name = n.name;
    form.no = n.no ?? '';
    form.stage = n.stage ?? '';
    form.source = n.source ?? '';
    form.field = n.field ?? '';
    form.cn = n.cn ?? '';
    form.unit = n.unit === true;
    form.pending = n.pending ?? '';
    form.tone = n.tone ?? '';
    Object.assign(original, form);
    newKind.value = DEFAULT_CHILD[n.kind] && DEFAULT_CHILD[n.kind] !== 'noop' ? DEFAULT_CHILD[n.kind]! : 'section';
    newName.value = '';

    await Promise.all([loadVersions(), loadLatest()]);
  } catch (e) { fail(e); } finally { loading.value = false; }
}

async function loadVersions(): Promise<void> {
  if (props.nodeId === null) { return; }
  try {
    const got = await api<{ items: { version: number; chars: number; createdAt: string }[] }>(`/admin/nodes/${props.nodeId}/content/versions`);
    versions.value = got.items;
  } catch { versions.value = []; }
}

async function loadLatest(): Promise<void> {
  if (props.nodeId === null) { return; }
  try {
    const got = await api<{ html: string }>(`/nodes/${props.nodeId}/content`);
    html.value = got.html;
  } catch { html.value = ''; }
}

async function loadVersion(v: number): Promise<void> {
  if (props.nodeId === null) { return; }
  try {
    const got = await api<{ html: string }>(`/admin/nodes/${props.nodeId}/content/versions/${v}`);
    html.value = got.html;
    htmlMode.value = 'edit';
    ElMessage.success(`已载入 v${v}（还没保存，改完点「存成新版」）`);
  } catch (e) { fail(e); }
}

async function saveFields(): Promise<void> {
  if (props.nodeId === null) { return; }
  saving.value = true;
  error.value = '';
  try {
    /* **只发改过的字段。** 原来是把整张表单都发上去，于是"本来没有 unit 这一项"的章
       被写成 `unit: false` —— 而前端里有 `'unit' in node` 这类判断，
       "没有这一项"和"这一项是 false"行为不一样，等于后台悄悄改坏了数据。
       空字符串照旧发 null（那是"清空"的意思，是用户明确做的动作）。 */
    const body: Record<string, unknown> = {};
    const put = (key: string, formVal: string | boolean, asNull: boolean): void => {
      const now = asNull ? (formVal || null) : formVal;
      const before = (original as Record<string, unknown>)[key];
      const beforeNorm = asNull ? (before || null) : before;
      if (now !== beforeNorm) { body[key] = now; }
    };
    put('name', form.name, false);
    if (has('no')) { put('no', form.no, true); }
    if (has('stage')) { put('stage', form.stage, true); }
    if (has('source')) { put('source', form.source, true); }
    if (has('field')) { put('field', form.field, true); }
    if (has('cn')) { put('cn', form.cn, true); }
    if (has('unit')) { put('unit', form.unit, false); }
    if (has('tone')) { put('tone', form.tone, true); }
    if (has('pending')) { put('pending', form.pending, true); }

    if (!Object.keys(body).length) { ElMessage.info('没有改动'); saving.value = false; return; }
    await api(`/admin/nodes/${props.nodeId}`, { method: 'PATCH', body: JSON.stringify(body) });
    ElMessage.success('字段已保存');
    emit('changed');
    await load();
  } catch (e) { fail(e); } finally { saving.value = false; }
}

async function addChild(): Promise<void> {
  if (props.nodeId === null || !newName.value.trim()) { return; }
  adding.value = true;
  error.value = '';
  try {
    await api('/admin/nodes', {
      method: 'POST',
      body: JSON.stringify({ parentId: props.nodeId, kind: newKind.value, name: newName.value.trim() }),
    });
    ElMessage.success('已新增');
    newName.value = '';
    emit('changed');
    await load();
  } catch (e) { fail(e); } finally { adding.value = false; }
}

async function move(delta: number): Promise<void> {
  const d = detail.value;
  if (!d) { return; }
  const target = d.node.order + delta;
  if (target < 0) { ElMessage.info('已经在最前面了'); return; }
  error.value = '';
  try {
    await api(`/admin/nodes/${d.node.id}/move`, {
      method: 'POST',
      body: JSON.stringify({ parentId: d.node.parentId, index: target }),
    });
    emit('changed');
    await load();
  } catch (e) { fail(e); }
}

async function remove(): Promise<void> {
  const d = detail.value;
  if (!d) { return; }
  const extra = d.descendants ? `\n\n它底下还有 ${d.descendants} 个节点，会一起删掉。` : '';
  try {
    await ElMessageBox.confirm(
      `确定删除「${d.node.name}」？${extra}\n\n删掉之后挂在它上面的学习记录与卡片也没了（错题记录会留名字快照）。`,
      '删除节点',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '算了' },
    );
  } catch { return; }
  error.value = '';
  try {
    await api(`/admin/nodes/${d.node.id}?withChildren=1`, { method: 'DELETE' });
    ElMessage.success('已删除');
    emit('changed');
  } catch (e) { fail(e); }
}

async function writeContent(): Promise<void> {
  if (props.nodeId === null || !html.value) { return; }
  writing.value = true;
  error.value = '';
  try {
    const got = await api<{ version: number }>(`/admin/nodes/${props.nodeId}/content`, {
      method: 'PUT',
      body: JSON.stringify({ html: html.value }),
    });
    ElMessage.success(`已存成 v${got.version}`);
    emit('changed');
    await load();
  } catch (e) { fail(e); } finally { writing.value = false; }
}

watch(() => props.nodeId, load, { immediate: true });
</script>

<style scoped>
.ed { display: flex; flex-direction: column; gap: 18px; }
.ed__err { margin-bottom: 4px; }

.ed__sec { border-bottom: 1px dashed var(--admin-line); padding-bottom: 16px; }
.ed__sec:last-child { border-bottom: none; padding-bottom: 0; }
.ed__sec-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.ed__sec-head h3 { margin: 0 0 10px; font-size: 14px; font-weight: 600; color: var(--admin-ink); }
.ed__sec-note { font-size: 12px; color: var(--admin-ink-3); }

.ed__kind {
  display: inline-flex; align-items: center; height: 20px; padding: 0 8px;
  border-radius: 4px; font-size: 12px; background: #f2f3f5; color: var(--admin-ink-2);
}
.ed__kind[data-kind="book"] { background: #e7f2ed; color: #0b623f; }
.ed__kind[data-kind="chapter"] { background: #eaf1fd; color: #2b5fb8; }
.ed__kind[data-kind="section"] { background: #f0eefc; color: #5b45b8; }
.ed__kind[data-kind="point"] { background: #fdf3e7; color: #9a6212; }
.ed__kind[data-kind="track"] { background: #fdecef; color: #a53549; }

.ed__path { margin: 0 0 8px; font-size: 12px; line-height: 1.8; color: var(--admin-ink-3); }
.ed__path-sep { margin: 0 6px; color: var(--admin-line); }

.ed__meta { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 12px; font-size: 12px; color: var(--admin-ink-3); }
.ed__meta b { color: var(--admin-ink); }

.ed__row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ed__grow { flex: 1 1 120px; min-width: 0; }

.ed__form :deep(.el-form-item) { margin-bottom: 12px; }
.ed__form :deep(.el-select) { width: 100%; }

.ed__hint { margin: 4px 0 12px; font-size: 12px; line-height: 1.8; color: var(--admin-ink-3); }
.ed__hint--inline { margin: 0; }

.ed__tabs { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }

.ed__code {
  width: 100%; min-height: 220px; padding: 10px 12px;
  border: 1px solid var(--admin-line); border-radius: 8px;
  background: #fafbfc; color: var(--admin-ink);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px; line-height: 1.75; resize: vertical;
}
.ed__code:focus { outline: none; border-color: var(--el-color-primary); box-shadow: 0 0 0 2px var(--el-color-primary-light-8); }

.ed__preview {
  min-height: 220px; max-height: 420px; overflow: auto; padding: 12px 14px;
  border: 1px solid var(--admin-line); border-radius: 8px; background: #fff;
  font-size: 13.5px; line-height: 1.9; color: var(--admin-ink);
}
.ed__preview :deep(.dim) { color: var(--admin-ink-3); }

.ed__versions { margin-top: 14px; }
.ed__versions-title { margin: 0 0 6px; font-size: 12px; color: var(--admin-ink-3); }
.ed__version { display: flex; align-items: center; gap: 10px; padding: 5px 0; border-bottom: 1px dashed var(--admin-line-soft); }
.ed__version:last-child { border-bottom: none; }
.ed__version-no { width: 42px; font-family: ui-monospace, monospace; font-size: 12px; color: var(--admin-ink); }
.ed__version-meta { flex: 1; font-size: 12px; color: var(--admin-ink-3); }
</style>
