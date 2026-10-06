<template>
  <el-card class="tree-card">
    <template #header>
      <div class="head">
        <div class="head__left">
          <span>知识结构</span>
          <el-tag v-if="version" size="small" type="success">version {{ version }}</el-tag>
          <el-tag size="small" type="info">来自 {{ from }}</el-tag>
          <el-tag size="small" type="warning">只读</el-tag>
        </div>
        <div class="head__right">
          <el-input
            v-model="keyword"
            size="small"
            clearable
            placeholder="搜节点名"
            class="head__search"
          >
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <span class="head__count">{{ shownCount }} / {{ totalCount }} 个节点</span>
          <el-button size="small" @click="refresh">刷新</el-button>
        </div>
      </div>
    </template>

    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="mb" />

    <p class="tip">
      这一份树是<strong>章节 / 图谱 / 时间轴三处共用</strong>的同一份数据 —— 不是三套。
      后台现在只能看；改树、写正文还没做（见「概览」那一页的清单）。
    </p>

    <el-tree
      v-if="tree"
      :data="shownTree"
      :props="{ label: 'name', children: 'children' }"
      node-key="id"
      default-expand-all
      :expand-on-click-node="false"
      class="tree"
    >
      <template #default="{ data }">
        <span class="node">
          <span class="node__name">{{ data.name }}</span>
          <span class="node__kind" :data-kind="data.kind">{{ kindLabel(data.kind) }}</span>
          <span v-if="data.no" class="node__meta">no {{ data.no }}</span>
          <span v-if="data.field" class="node__meta">{{ data.field }}</span>
          <span v-if="data.stage" class="node__meta">{{ data.stage }}</span>
          <span v-if="data.pending" class="node__warn" :title="data.pending">待核</span>
        </span>
      </template>
    </el-tree>

    <p v-if="tree && !shownCount" class="empty">没有名字里带「{{ keyword }}」的节点。</p>
  </el-card>
</template>

<script setup lang="ts">
/* 直接读公开的 /api/tree —— 后台和学生端看的是**同一份**树，不是两套。
 *
 * 搜索为什么是"按数据裁剪"而不是 `el-tree` 的 `filter()`：
 * 先用 `treeRef.value.filter(kw)` 那套试过，实测**一个节点都没藏起来**
 * （1391 个 `.el-tree-node` 里 0 个 display:none），而计数器却变了 ——
 * 也就是"看着搜了、其实没搜"。改成自己把树剪成只含命中分支，
 * 结果完全由这段代码决定，不依赖组件内部怎么实现。
 */
import { computed, onMounted, ref } from 'vue';
import { Search } from '@element-plus/icons-vue';
import { api, type ApiError } from '../api';

type TreeNode = {
  id: number; kind: string; name: string;
  no?: string; field?: string; stage?: string; pending?: string;
  children?: TreeNode[];
};

const KIND_CN: Record<string, string> = {
  root: '根', book: '册', chapter: '章', section: '节', point: '知识点',
  group: '组', method: '方法', error: '易错', exam: '真题', track: '竞赛轨道',
};

const tree = ref<TreeNode | null>(null);
const version = ref('');
const from = ref('接口');
const error = ref('');
const keyword = ref('');
const totalCount = ref(0);

function kindLabel(k: string): string { return KIND_CN[k] || k; }

function countNodes(n: TreeNode): number {
  return 1 + (n.children || []).reduce((a, c) => a + countNodes(c), 0);
}

/** 按关键词剪枝：自己命中、或**任一后代命中**就留下（祖先链要留，否则命中的节点没处挂）。 */
function prune(n: TreeNode, q: string): TreeNode | null {
  const kids = (n.children || [])
    .map((c) => prune(c, q))
    .filter((c): c is TreeNode => c !== null);
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

async function load(): Promise<void> {
  error.value = '';
  try {
    const got = await api<{ version: string; tree: TreeNode }>('/tree');
    tree.value = got.tree;
    version.value = got.version;
    const meta = (window as unknown as { WK_TREE_META?: { from?: string } }).WK_TREE_META;
    from.value = meta?.from ?? '接口';
    totalCount.value = countNodes(got.tree);
  } catch (e) {
    error.value = (e as ApiError).message;
  }
}

function refresh(): void { void load(); }

onMounted(load);
</script>

<style scoped>
.mb { margin-bottom: 12px; }

.head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.head__left { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.head__right { display: inline-flex; align-items: center; gap: 10px; }
.head__search { width: 200px; }
.head__count { font-size: 12px; color: var(--admin-ink-3); }

.tip {
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px solid var(--admin-line);
  border-radius: 8px;
  background: #fafbfc;
  font-size: 12px;
  line-height: 1.85;
  color: var(--admin-ink-2);
}
.tip strong { color: var(--admin-ink); }

.tree { max-height: calc(100vh - 300px); overflow: auto; padding-right: 6px; }

.node { display: inline-flex; align-items: center; gap: 8px; }
.node__name { color: var(--admin-ink); }
.node__kind {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 11px;
  background: #f2f3f5;
  color: var(--admin-ink-2);
}
/* 十种节点各给一个色：一眼能分出"册 / 章 / 节 / 知识点"和那几个卡片桶 */
.node__kind[data-kind="book"] { background: #e7f2ed; color: #0b623f; }
.node__kind[data-kind="chapter"] { background: #eaf1fd; color: #2b5fb8; }
.node__kind[data-kind="section"] { background: #f0eefc; color: #5b45b8; }
.node__kind[data-kind="point"] { background: #fdf3e7; color: #9a6212; }
.node__kind[data-kind="track"] { background: #fdecef; color: #a53549; }
.node__meta { font-size: 12px; color: var(--admin-ink-3); }
.node__warn {
  font-size: 11px;
  padding: 0 6px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  border-radius: 4px;
  background: #fdf3e7;
  color: #9a6212;
}

.empty { margin: 12px 0 0; font-size: 13px; color: var(--admin-ink-3); }
</style>
