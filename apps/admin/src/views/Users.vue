<template>
  <el-card>
    <template #header>
      <div class="head">
        <span>用户（{{ rows.length }}）</span>
        <span class="head__note">能不能用某个功能由服务端判定；这里管的是"谁是谁、还能不能进"</span>
      </div>
    </template>

    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="mb" />

    <el-table v-loading="loading" :data="rows" stripe>
      <el-table-column prop="id" label="#" width="70" />
      <el-table-column label="账号" min-width="170">
        <template #default="{ row }">
          <!-- 点账号进详情 —— "这一行是谁"最自然的下钻入口就在名字上 -->
          <router-link class="mono link" :to="`/users/${row.id}`">{{ row.username }}</router-link>
          <el-tag v-if="isSelf(row)" size="small" effect="plain" class="self">就是你</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="nickname" label="昵称" min-width="110" />
      <el-table-column label="年级" min-width="130">
        <template #default="{ row }">
          <span v-if="row.grade">{{ row.grade }}</span>
          <span v-else class="dim">—</span>
        </template>
      </el-table-column>

      <el-table-column label="角色" width="140">
        <template #default="{ row }">
          <el-select
            :model-value="row.role"
            size="small"
            :disabled="isSelf(row) || busy === row.id"
            @change="setRole(row, $event)"
          >
            <el-option label="管理员" value="admin" />
            <el-option label="学生" value="student" />
          </el-select>
        </template>
      </el-table-column>

      <el-table-column label="状态" width="150">
        <template #default="{ row }">
          <template v-if="row.disabledAt">
            <el-tag size="small" type="info" effect="light">已停用</el-tag>
            <div class="dim small mono">{{ when(row.disabledAt) }}</div>
          </template>
          <el-tag v-else size="small" type="success" effect="light">正常</el-tag>
        </template>
      </el-table-column>

      <el-table-column label="注册时间" min-width="170">
        <template #default="{ row }">
          <span class="mono dim">{{ when(row.createdAt) }}</span>
        </template>
      </el-table-column>

      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="openDetail(row)">详情</el-button>
          <el-button
            v-if="row.disabledAt"
            size="small"
            :disabled="busy === row.id"
            @click="setDisabled(row, false)"
          >启用</el-button>
          <el-button
            v-else
            size="small"
            type="danger"
            plain
            :disabled="isSelf(row) || busy === row.id"
            @click="confirmDisable(row)"
          >停用</el-button>
        </template>
      </el-table-column>
    </el-table>

    <p class="foot">
      护栏只有一条，由服务端兜着：<strong>不能改自己</strong>（改了自己就没人能把你放回来）。
      自己那一行的下拉与按钮在这里是灰的，但那只是省一次白跑 —— 真正管事的是服务端那道判定。
    </p>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, auth, type ApiError } from '../api';

type Row = {
  id: number; username: string; nickname: string; grade: string | null;
  role: string; createdAt: string; disabledAt: string | null;
};

const rows = ref<Row[]>([]);
const error = ref('');
const loading = ref(false);
/** 正在提交的那一行 —— 提交期间禁掉它自己的控件，免得连点两下 */
const busy = ref<number | null>(null);

const router = useRouter();

/** 下钻到"这一个学生的全部情况"。**只读页** —— 改还是走这一行上的角色/停用。 */
function openDetail(row: Row): void {
  void router.push(`/users/${row.id}`);
}

/** 库里存的是 ISO 时间；直接摆给人看太生硬，换成"2026-10-05 22:31"。 */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) { return iso; }
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function roleName(code: string): string {
  return code === 'admin' ? '管理员' : '学生';
}

/** 是不是"我自己"。服务端会拒，这里只是别让人白点一下。 */
function isSelf(row: Row): boolean {
  return !!auth.user && auth.user.id === row.id;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    rows.value = (await api<{ total: number; items: Row[] }>('/admin/users')).items;
    error.value = '';
  } catch (e) {
    error.value = (e as ApiError).message;
  } finally {
    loading.value = false;
  }
}

/** 只发变了的那一个字段。回来之后**以服务端那份为准**覆盖整行 ——
   失败时重新拉一次，绝不把界面留在一个"看着改了、其实没改"的状态上。 */
async function patch(row: Row, body: { role?: string; disabled?: boolean }, note: string): Promise<void> {
  busy.value = row.id;
  try {
    Object.assign(row, await api<Row>(`/admin/users/${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }));
    error.value = '';
    ElMessage.success(note);
  } catch (e) {
    error.value = (e as ApiError).message;
    await load();
  } finally {
    busy.value = null;
  }
}

function setRole(row: Row, v: unknown): void {
  const role = String(v);
  if (role === row.role) { return; }
  void patch(row, { role }, `「${row.username}」已改为${roleName(role)}`);
}

function setDisabled(row: Row, disabled: boolean): void {
  void patch(row, { disabled },
    disabled ? `「${row.username}」已停用，他会被立刻踢下线` : `「${row.username}」已恢复`);
}

/** 停用是"把人踢出去"，先问一句 —— 误点的代价是他上不了课。 */
async function confirmDisable(row: Row): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `停用后「${row.username}」会被立刻踢下线，也登不进来。确定吗？`,
      '停用账号',
      { type: 'warning', confirmButtonText: '停用', cancelButtonText: '算了' },
    );
  } catch {
    return; /* 点了"算了" */
  }
  setDisabled(row, true);
}

onMounted(load);
</script>

<style scoped>
.mb { margin-bottom: 12px; }
.head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.head__note { font-size: 12px; font-weight: 400; color: var(--admin-ink-3); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.link { color: var(--el-color-primary); text-decoration: none; }
.link:hover { text-decoration: underline; }
.dim { color: var(--admin-ink-3); }
.small { font-size: 11px; margin-top: 2px; }
.self { margin-left: 6px; }
.foot { margin: 14px 0 0; font-size: 12px; line-height: 1.9; color: var(--admin-ink-3); }
</style>
