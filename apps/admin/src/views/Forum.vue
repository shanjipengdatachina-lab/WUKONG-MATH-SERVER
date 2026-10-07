<template>
  <el-card>
    <template #header>
      <div class="head">
        <span>论坛管理</span>
        <span class="head__note">
          帖子按时间倒序，置顶自动排前面。<strong>删帖会连带回复一起删</strong>，谨慎操作。
        </span>
      </div>
    </template>

    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="mb" />
    <el-tag v-if="!canWrite" type="info" class="mb">只读（没有 forum.write）</el-tag>

    <el-tabs v-model="tab">
      <el-tab-pane label="帖子" name="posts">
        <div class="filter">
          <el-select v-model="filter.board" size="small" placeholder="所有板" clearable class="filter__sel" @change="loadPosts">
            <el-option v-for="b in boards" :key="b.code" :label="b.name" :value="b.code" />
          </el-select>
          <el-input v-model="filter.q" size="small" placeholder="按标题 / 正文搜" clearable class="filter__q" @change="loadPosts" />
          <el-button size="small" @click="loadPosts">刷新</el-button>
        </div>

        <el-table v-loading="postsLoading" :data="posts" stripe size="small">
          <el-table-column label="标题" min-width="280">
            <template #default="{ row }">
              <div class="post-title">
                <el-tag v-if="row.pinned" type="warning" size="small" effect="dark">置顶</el-tag>
                <el-tag v-if="row.good" type="danger" size="small" effect="dark">精</el-tag>
                <span>{{ row.title }}</span>
              </div>
              <div class="dim">{{ row.boardName }} · {{ row.authorName || '（匿名）' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="回复" width="70" align="center">
            <template #default="{ row }">{{ row.replies }}</template>
          </el-table-column>
          <el-table-column label="浏览" width="70" align="center">
            <template #default="{ row }">{{ row.views }}</template>
          </el-table-column>
          <el-table-column label="时间" width="160">
            <template #default="{ row }">{{ fmt(row.at) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="240" align="right">
            <template #default="{ row }">
              <el-button link type="warning" size="small" :disabled="!canWrite" @click="togglePin(row)">
                {{ row.pinned ? '取消置顶' : '置顶' }}
              </el-button>
              <el-button link type="danger" size="small" :disabled="!canWrite" @click="toggleGood(row)">
                {{ row.good ? '取消加精' : '加精' }}
              </el-button>
              <el-button link type="primary" size="small" :disabled="!canWrite" @click="openEdit(row)">改</el-button>
              <el-button link type="danger" size="small" :disabled="!canWrite" @click="removePost(row)">删</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="板块" name="boards">
        <div class="filter">
          <el-button size="small" type="primary" :disabled="!canWrite" @click="openBoardCreate">新建板块</el-button>
          <el-button size="small" @click="loadBoards">刷新</el-button>
        </div>

        <el-table v-loading="boardsLoading" :data="boards" stripe size="small">
          <el-table-column label="代码" width="120">
            <template #default="{ row }"><span class="mono">{{ row.code }}</span></template>
          </el-table-column>
          <el-table-column label="名称" min-width="140">
            <template #default="{ row }">{{ row.name }}</template>
          </el-table-column>
          <el-table-column label="说明" min-width="200">
            <template #default="{ row }">{{ row.desc || '—' }}</template>
          </el-table-column>
          <el-table-column label="帖子数" width="80" align="center">
            <template #default="{ row }">{{ row.posts }}</template>
          </el-table-column>
          <el-table-column label="序号" width="70" align="center">
            <template #default="{ row }">{{ row.order }}</template>
          </el-table-column>
          <el-table-column label="操作" width="140" align="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" :disabled="!canWrite" @click="openBoardEdit(row)">改</el-button>
              <el-button link type="danger" size="small" :disabled="!canWrite" @click="removeBoard(row)">删</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- 改帖正文 dialog -->
    <el-dialog v-model="postDialog.show" title="改帖" width="780px" top="6vh" :close-on-click-modal="false">
      <el-form :model="postForm" label-width="80px" size="default">
        <el-form-item label="标题" required>
          <el-input v-model="postForm.title" maxlength="120" show-word-limit />
        </el-form-item>
        <el-form-item label="正文" required>
          <el-input v-model="postForm.body" type="textarea" :rows="10" maxlength="20000" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="postDialog.show = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="savePost">保存</el-button>
      </template>
    </el-dialog>

    <!-- 板块 dialog -->
    <el-dialog v-model="boardDialog.show" :title="boardDialog.id ? '改板块' : '新建板块'" width="560px" :close-on-click-modal="false">
      <el-form :model="boardForm" label-width="80px" size="default">
        <el-form-item label="代码" required>
          <el-input v-model="boardForm.code" :disabled="boardDialog.id !== null" placeholder="study / help / exam 等，建好不能改" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="boardForm.name" maxlength="64" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="boardForm.desc" maxlength="191" placeholder="一句话简介" />
        </el-form-item>
        <el-form-item label="版规">
          <el-input v-model="boardForm.note" type="textarea" :rows="3" maxlength="5000" placeholder="发帖须知，较长的版规" />
        </el-form-item>
        <el-form-item label="序号">
          <el-input-number v-model="boardForm.order" :min="0" :max="9999" controls-position="right" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="boardDialog.show = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveBoard">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, can, type ApiError } from '../api';

type Post = {
  id: number; boardCode: string; boardName: string;
  title: string; authorName: string; authorId: number | null;
  views: number; replies: number;
  pinned: boolean; good: boolean;
  at: string;
};
type Board = {
  id: number; code: string; name: string;
  desc: string | null; note: string | null;
  order: number; posts: number;
};

const tab = ref<'posts' | 'boards'>('posts');
const error = ref('');
const saving = ref(false);
const canWrite = computed(() => can('forum.write'));

const posts = ref<Post[]>([]);
const postsLoading = ref(false);
const filter = reactive<{ board: string; q: string }>({ board: '', q: '' });

const boards = ref<Board[]>([]);
const boardsLoading = ref(false);

const postDialog = reactive<{ show: boolean; id: number | null }>({ show: false, id: null });
const postForm = reactive<{ title: string; body: string }>({ title: '', body: '' });

const boardDialog = reactive<{ show: boolean; id: number | null }>({ show: false, id: null });
const boardForm = reactive<{
  code: string; name: string;
  desc: string; note: string; order: number;
}>({ code: '', name: '', desc: '', note: '', order: 0 });

onMounted(() => {
  loadPosts();
  loadBoards();
});

function fmt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) { return iso; }
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function loadPosts(): Promise<void> {
  error.value = '';
  postsLoading.value = true;
  try {
    const q = new URLSearchParams();
    if (filter.board) { q.set('board', filter.board); }
    if (filter.q.trim()) { q.set('q', filter.q.trim()); }
    const qs = q.toString();
    const data = await api<{ total: number; items: Post[] }>(`/admin/forum/posts${qs ? '?' + qs : ''}`);
    posts.value = data.items;
  } catch (e) {
    const err = e as ApiError;
    error.value = err.message || '加载失败';
  } finally {
    postsLoading.value = false;
  }
}

async function loadBoards(): Promise<void> {
  boardsLoading.value = true;
  try {
    const data = await api<{ items: Board[] }>('/admin/forum/boards');
    boards.value = data.items;
  } catch (e) {
    const err = e as ApiError;
    ElMessage.error(err.message || '加载板块失败');
  } finally {
    boardsLoading.value = false;
  }
}

async function togglePin(row: Post): Promise<void> {
  try {
    await api(`/admin/forum/posts/${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned: !row.pinned }),
    });
    row.pinned = !row.pinned;
    ElMessage.success(row.pinned ? '已置顶' : '已取消置顶');
    /* 排序可能变了，重新拉一次 */
    await loadPosts();
  } catch (e) {
    const err = e as ApiError;
    ElMessage.error(err.message || '操作失败');
  }
}

async function toggleGood(row: Post): Promise<void> {
  try {
    await api(`/admin/forum/posts/${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ good: !row.good }),
    });
    row.good = !row.good;
    ElMessage.success(row.good ? '已加精' : '已取消加精');
  } catch (e) {
    const err = e as ApiError;
    ElMessage.error(err.message || '操作失败');
  }
}

function openEdit(row: Post): void {
  postDialog.id = row.id;
  /* 拿完整正文 —— 列表项里没有 body */
  api<Post & { body: string }>(`/forum/posts/${row.id}`).then((d) => {
    postForm.title = d.title;
    postForm.body = d.body;
    postDialog.show = true;
  }).catch((e: ApiError) => {
    ElMessage.error(e.message || '加载详情失败');
  });
}

async function savePost(): Promise<void> {
  if (!postForm.title.trim() || !postForm.body.trim()) {
    ElMessage.warning('标题和正文都不能空');
    return;
  }
  saving.value = true;
  try {
    await api(`/admin/forum/posts/${postDialog.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: postForm.title, body: postForm.body }),
    });
    ElMessage.success('已保存');
    postDialog.show = false;
    await loadPosts();
  } catch (e) {
    const err = e as ApiError;
    ElMessage.error(err.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

async function removePost(row: Post): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `删帖「${row.title}」？回复也会一起删，不能恢复。`,
      '确认删帖',
      { type: 'warning', confirmButtonText: '删', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    await api(`/admin/forum/posts/${row.id}`, { method: 'DELETE' });
    ElMessage.success('已删');
    await loadPosts();
  } catch (e) {
    const err = e as ApiError;
    ElMessage.error(err.message || '删除失败');
  }
}

function openBoardCreate(): void {
  boardDialog.id = null;
  boardForm.code = '';
  boardForm.name = '';
  boardForm.desc = '';
  boardForm.note = '';
  boardForm.order = boards.value.length;
  boardDialog.show = true;
}

function openBoardEdit(row: Board): void {
  boardDialog.id = row.id;
  boardForm.code = row.code;
  boardForm.name = row.name;
  boardForm.desc = row.desc || '';
  boardForm.note = row.note || '';
  boardForm.order = row.order;
  boardDialog.show = true;
}

async function saveBoard(): Promise<void> {
  if (!boardForm.code.trim() || !boardForm.name.trim()) {
    ElMessage.warning('代码和名称必填');
    return;
  }
  saving.value = true;
  try {
    const body = JSON.stringify({
      code: boardForm.code.trim(),
      name: boardForm.name.trim(),
      desc: boardForm.desc.trim() || null,
      note: boardForm.note.trim() || null,
      order: boardForm.order,
    });
    if (boardDialog.id === null) {
      await api('/admin/forum/boards', { method: 'POST', body });
      ElMessage.success('已新建');
    } else {
      /* code 字段在表单里禁用了，但传过去也无妨 —— 服务端会忽略没变的值 */
      await api(`/admin/forum/boards/${boardDialog.id}`, { method: 'PATCH', body });
      ElMessage.success('已保存');
    }
    boardDialog.show = false;
    await loadBoards();
    /* 板下拉可能多/少了一项，刷新一次 posts 的板选项 */
    if (tab.value === 'posts') { await loadPosts(); }
  } catch (e) {
    const err = e as ApiError;
    ElMessage.error(err.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

async function removeBoard(row: Board): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `删板块「${row.name}」？板块下还有帖时不让删。`,
      '确认删板块',
      { type: 'warning', confirmButtonText: '删', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    await api(`/admin/forum/boards/${row.id}`, { method: 'DELETE' });
    ElMessage.success('已删');
    await loadBoards();
  } catch (e) {
    const err = e as ApiError;
    ElMessage.error(err.message || '删除失败');
  }
}
</script>

<style scoped>
.head { display: flex; flex-direction: column; gap: 4px; }
.head__note { font-size: 12px; color: var(--admin-ink-3); }
.mb { margin-bottom: 12px; }

.filter { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; flex-wrap: wrap; }
.filter__q { max-width: 320px; }
.filter__sel { width: 160px; }

.post-title { display: flex; gap: 6px; align-items: center; font-weight: 500; }
.dim { font-size: 12px; color: var(--admin-ink-3); margin-top: 4px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
</style>
