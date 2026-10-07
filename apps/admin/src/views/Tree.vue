<template>
  <el-card class="tree-card">
    <template #header>
      <div class="head">
        <div class="head__left">
          <span>知识结构</span>
          <el-tag v-if="version" size="small" type="success">version {{ version }}</el-tag>
          <el-tag v-if="canWrite" size="small" type="warning">可编辑</el-tag>
          <el-tag v-else size="small" type="info">只读（没有 tree.write）</el-tag>
        </div>
        <div class="head__right">
          <el-input v-model="keyword" size="small" clearable placeholder="搜节点名" class="head__search">
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <span class="head__count">{{ shownCount }} / {{ totalCount }} 个节点</span>
          <el-button size="small" @click="load">刷新</el-button>
        </div>
      </div>
    </template>

    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="mb" />

    <p class="tip">
      这份树是<strong>章节 / 图谱 / 时间轴三处共用</strong>的同一份 —— 在这里改一次，三处一起变
      （树的版本号是现算的，不用谁去清缓存）。
      <span v-if="canWrite">点一个节点，右边就能改字段、写正文、加子节点、移动和删除。</span>
    </p>

    <div class="pane">
      <div class="pane__tree">
        <el-tree
          v-if="tree"
          :data="shownTree"
          :props="{ label: 'name', children: 'children' }"
          node-key="id"
          default-expand-all
          :expand-on-click-node="false"
          :highlight-current="true"
          :current-node-key="selectedId ?? undefined"
          class="tree"
          @node-click="onPick"
        >
          <template #default="{ data }">
            <span class="node">
              <span class="node__name">{{ data.name }}</span>
              <span class="node__kind" :data-kind="data.kind">{{ kindLabel(data.kind) }}</span>
              <span v-if="data.no" class="node__meta">no {{ data.no }}</span>
              <span v-if="data.field" class="node__meta">{{ data.field }}</span>
              <span v-if="data.pending" class="node__warn" :title="data.pending">待核</span>
            </span>
          </template>
        </el-tree>

        <p v-if="tree && !shownCount" class="empty">没有名字里带「{{ keyword }}」的节点。</p>
      </div>

      <aside class="pane__editor">
        <NodeEditor :node-id="selectedId" :path="selectedPath" @changed="onChanged" />
      </aside>
    </div>
  </el-card>
</template>

<script setup lang="ts">
/* ==========================================================================
   知识结构 · 可编辑
   --------------------------------------------------------------------------
   交互只有一条：**左边点一个节点，右边改它**。不在树上挂一排小按钮 ——
   按钮要挤在节点行里、还会跟展开箭头打架，而且"加子节点"本来就需要先选父节点。

   搜索仍然是**按数据剪枝**（不是 el-tree 的命令式 filter，那个实测没生效，
   见文件下半段那句注释）。剪枝只影响"看得见哪些"，选中与编辑不受影响。
   ========================================================================== */
import { computed, onMounted, ref } from 'vue';
import { Search } from '@element-plus/icons-vue';
import { api, can, type ApiError } from '../api';
import NodeEditor from './NodeEditor.vue';

type TreeNode = {
  id: number; kind: string; name: string;
  no?: string; field?: string; stage?: string; pending?: string;
  children?: TreeNode[];
};

const KIND_CN: Record<string, string> = {
  root: '根', book: '册', chapter: '章', section: '节', point: '知识点',
  group: '组', method: '方法', error: '易错', exam: '真题', formula: '公式', track: '竞赛轨道',
};

const tree = ref<TreeNode | null>(null);
const version = ref('');
const error = ref('');
const keyword = ref('');
const totalCount = ref(0);
const selectedId = ref<number | null>(null);
const pathById = ref<Map<number, string[]>>(new Map());

const canWrite = computed(() => can('tree.write'));
const selectedPath = computed(() => (selectedId.value === null ? [] : (pathById.value.get(selectedId.value) ?? [])));

function kindLabel(k: string): string { return KIND_CN[k] || k; }

function countNodes(n: TreeNode): number {
  return 1 + (n.children || []).reduce((a, c) => a + countNodes(c), 0);
}

/** 按关键词剪枝：自己命中、或任一后代命中就留下（祖先链要保留，否则命中的节点没处挂） */
function prune(n: TreeNode, q: string): TreeNode | null {
  const kids = (n.children || []).map((c) => prune(c, q)).filter((c): c is TreeNode => c !== null);
  const selfHit = n.name.toLowerCase().indexOf(q) >= 0;
  if (!selfHit && !kids.length) { return null; }
  return { ...n, children: kids };
}

const shownTree = computed<TreeNode[]>(() => {
  const root = tree.value;
  if (!root) { return []; }
  const q = keyword.value.trim().toLowerCase();
  if (!q) { return [root]; }
  const kept = prune(root, q);
  return kept ? [kept] : [];
});

const shownCount = computed(() => {
  const first = shownTree.value[0];
  return first ? countNodes(first) : 0;
});

function onPick(data: TreeNode): void { selectedId.value = data.id; }

async function load(): Promise<void> {
  error.value = '';
  try {
    const got = await api<{ version: string; tree: TreeNode }>('/tree');
    tree.value = got.tree;
    version.value = got.version;
    totalCount.value = countNodes(got.tree);

    /* 一次遍历把"每个节点的祖先路径"记下来，右边面板要显示面包屑 */
    const paths = new Map<number, string[]>();
    const walk = (n: TreeNode, chain: string[]): void => {
      const next = chain.concat([n.name]);
      paths.set(n.id, next);
      (n.children || []).forEach((c) => walk(c, next));
    };
    walk(got.tree, []);
    pathById.value = paths;
  } catch (e) {
    error.value = (e as ApiError).message;
  }
}

/** 改完之后：重取树（版本号也跟着变），选中不变 —— 不然每改一下都得重新找节点 */
function onChanged(): void { void load(); }

onMounted(load);
</script>

<style scoped>
.mb { margin-bottom: 12px; }

.head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.head__left { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.head__right { display: inline-flex; align-items: center; gap: 10px; }
.head__search { width: 190px; }
.head__count { font-size: 12px; color: var(--admin-ink-3); }

.tip {
  margin: 0 0 12px; padding: 10px 12px;
  border: 1px solid var(--admin-line); border-radius: 8px; background: #fafbfc;
  font-size: 12px; line-height: 1.85; color: var(--admin-ink-2);
}
.tip strong { color: var(--admin-ink); }

.pane { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(340px, 1fr); gap: 18px; align-items: start; }

.pane__tree { min-width: 0; }
.tree { max-height: calc(100vh - 260px); overflow: auto; padding-right: 6px; }

.pane__editor {
  min-width: 0;
  max-height: calc(100vh - 260px);
  overflow: auto;
  padding: 14px 16px;
  border: 1px solid var(--admin-line);
  border-radius: 10px;
  background: #fcfcfd;
}

.node { display: inline-flex; align-items: center; gap: 8px; }
.node__name { color: var(--admin-ink); }
.node__kind {
  display: inline-flex; align-items: center; height: 18px; padding: 0 6px;
  border-radius: 4px; font-size: 11px; background: #f2f3f5; color: var(--admin-ink-2);
}
.node__kind[data-kind="book"] { background: #e7f2ed; color: #0b623f; }
.node__kind[data-kind="chapter"] { background: #eaf1fd; color: #2b5fb8; }
.node__kind[data-kind="section"] { background: #f0eefc; color: #5b45b8; }
.node__kind[data-kind="point"] { background: #fdf3e7; color: #9a6212; }
.node__kind[data-kind="track"] { background: #fdecef; color: #a53549; }
.node__meta { font-size: 12px; color: var(--admin-ink-3); }
.node__warn {
  font-size: 11px; padding: 0 6px; height: 18px; display: inline-flex; align-items: center;
  border-radius: 4px; background: #fdf3e7; color: #9a6212;
}

.empty { margin: 12px 0 0; font-size: 13px; color: var(--admin-ink-3); }

@media (max-width: 1180px) {
  .pane { grid-template-columns: minmax(0, 1fr); }
  .pane__editor { max-height: none; }
}
</style>
