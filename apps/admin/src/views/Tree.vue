<template>
  <el-card>
    <template #header>
      <span>知识结构</span>
      <el-tag v-if="version" size="small" type="success" class="ver">version {{ version }}</el-tag>
      <el-tag v-if="from" size="small" type="info" class="ver">来自 {{ from }}</el-tag>
    </template>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" />
    <el-tree
      v-if="tree"
      :data="[tree]"
      :props="{ label: 'name', children: 'children' }"
      node-key="id"
      default-expand-all
      :expand-on-click-node="false"
      class="tree"
    >
      <template #default="{ data }">
        <span class="node">
          <span class="node__name">{{ data.name }}</span>
          <el-tag size="small" class="node__kind">{{ data.kind }}</el-tag>
          <span v-if="data.no" class="node__no">no {{ data.no }}</span>
          <span v-if="data.field" class="node__no">{{ data.field }}</span>
          <span v-if="data.pending" class="node__warn">待核</span>
        </span>
      </template>
    </el-tree>
  </el-card>
</template>

<script setup lang="ts">
/* 直接读公开的 /api/tree —— 后台和学生端看的是**同一份**树，不是两套。 */
import { onMounted, ref } from 'vue';
import { api, type ApiError } from '../api';

type Node = { id: number; kind: string; name: string; no?: string; field?: string; pending?: string; children?: Node[] };

const tree = ref<Node | null>(null);
const version = ref('');
const from = ref('');
const error = ref('');

onMounted(async () => {
  try {
    const got = await api<{ version: string; tree: Node }>('/tree');
    tree.value = got.tree;
    version.value = got.version;
    from.value = (window as unknown as { WK_TREE_META?: { from?: string } }).WK_TREE_META?.from ?? '接口';
  } catch (e) {
    error.value = (e as ApiError).message;
  }
});
</script>

<style scoped>
.ver { margin-left: 10px; }
.tree { max-height: 68vh; overflow: auto; }
.node { display: inline-flex; align-items: center; gap: 8px; }
.node__kind { transform: scale(0.9); }
.node__no { color: #909399; font-size: 12px; }
.node__warn { color: var(--el-color-warning); font-size: 12px; }
</style>
