<template>
  <el-card>
    <template #header>
      <div class="head">
        <span>用户（{{ total }}）</span>
        <span class="head__note">能不能用某个功能由服务端判定；这里管的是"谁是谁、还能不能进"</span>
      </div>
    </template>

    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="mb" />

    <!-- 工具条：搜索 + 两个筛选 + 新建 -->
    <div class="bar">
      <el-input
        v-model="q"
        placeholder="搜账号 / 昵称"
        clearable
        class="bar__q"
        @keyup.enter="reload"
        @clear="reload"
      >
        <template #append><el-button @click="reload">搜索</el-button></template>
      </el-input>

      <el-select v-model="role" placeholder="所有角色" clearable class="bar__sel" @change="reload">
        <el-option v-for="r in roles" :key="r.code" :label="`${r.name}（${r.users}）`" :value="r.code" />
      </el-select>

      <el-select v-model="status" placeholder="所有状态" clearable class="bar__sel" @change="reload">
        <el-option label="正常" value="normal" />
        <el-option label="已停用" value="disabled" />
      </el-select>

      <span class="bar__gap" />
      <el-button :disabled="!canWrite" type="primary" @click="openCreate">新建账号</el-button>
      <el-button :loading="loading" @click="reload">刷新</el-button>
    </div>

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
            :disabled="isSelf(row) || busy === row.id || !canWrite"
            @change="setRole(row, $event)"
          >
            <el-option v-for="r in roles" :key="r.code" :label="r.name" :value="r.code" />
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

      <el-table-column label="操作" width="290" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="openDetail(row)">详情</el-button>
          <el-button size="small" :disabled="!canWrite" @click="openEdit(row)">改资料</el-button>
          <el-button size="small" :disabled="!canWrite || busy === row.id" @click="openPassword(row)">重置密码</el-button>
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
            :disabled="isSelf(row) || busy === row.id || !canWrite"
            @click="confirmDisable(row)"
          >停用</el-button>
          <el-button
            size="small"
            type="danger"
            :disabled="isSelf(row) || busy === row.id || !canWrite"
            @click="confirmDelete(row)"
          >删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <el-pagination
        layout="total, sizes, prev, pager, next"
        :total="total"
        :current-page="page"
        :page-size="pageSize"
        :page-sizes="[10, 20, 50, 100]"
        @current-change="onPage"
        @size-change="onSize"
      />
    </div>

    <p class="foot">
      护栏都由服务端兜着：<strong>不能改/删自己</strong>（改了自己就没人能把你放回来）；
      <strong>名下有已付款订单的账号不许删</strong>（删用户会连订单一起 cascade 掉，而订单是账）——
      真要停一个人，用「停用」，那才是这件事的正解。
      这里把按钮置灰只是省一次白跑，真正管事的是服务端那两道判定。
    </p>

    <!-- 新建 / 改资料 -->
    <el-dialog v-model="edit.show" :title="edit.id === null ? '新建账号' : '改资料'" width="480px">
      <el-form label-width="72px">
        <el-form-item label="账号" required>
          <el-input v-model="edit.username" :disabled="edit.id !== null" placeholder="字母数字和 _ . -，3~32 位" />
        </el-form-item>
        <el-form-item v-if="edit.id === null" label="密码" required>
          <el-input v-model="edit.password" type="password" show-password placeholder="至少 8 位，含字母和数字" />
        </el-form-item>
        <el-form-item label="昵称" required>
          <el-input v-model="edit.nickname" maxlength="32" />
        </el-form-item>
        <el-form-item label="年级">
          <el-input v-model="edit.grade" maxlength="32" placeholder="例如 七年级（下）；留空就是不填" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="edit.role" :disabled="edit.id !== null && edit.isSelf">
            <el-option v-for="r in roles" :key="r.code" :label="r.name" :value="r.code" />
          </el-select>
          <span v-if="edit.id !== null" class="hint">建好之后角色也能在这一行上直接改</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="edit.show = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 重置密码 -->
    <el-dialog v-model="pwd.show" title="重置密码" width="440px">
      <p class="hint">
        给「<b>{{ pwd.username }}</b>」设一个新密码。保存后<strong>他会被立刻踢下线</strong>，
        要用新密码重新登录 —— 这正是"账号被人拿了"时该有的效果。
      </p>
      <el-input v-model="pwd.password" type="password" show-password placeholder="至少 8 位，含字母和数字" />
      <template #footer>
        <el-button @click="pwd.show = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="savePassword">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, auth, can, type ApiError } from '../api';

type Row = {
  id: number; username: string; nickname: string; grade: string | null;
  role: string; createdAt: string; disabledAt: string | null;
};
type RoleItem = { code: string; name: string; users: number };

const rows = ref<Row[]>([]);
const roles = ref<RoleItem[]>([]);
const error = ref('');
const loading = ref(false);
const saving = ref(false);
/** 正在提交的那一行 —— 提交期间禁掉它自己的控件，免得连点两下 */
const busy = ref<number | null>(null);

/* 列表状态：搜索 / 筛选 / 分页。改一个就重新拉一次。 */
const q = ref('');
const role = ref('');
const status = ref('');
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);

const canWrite = computed(() => can('user.write'));

const router = useRouter();

const edit = reactive<{
  show: boolean; id: number | null; isSelf: boolean;
  username: string; password: string; nickname: string; grade: string; role: string;
}>({ show: false, id: null, isSelf: false, username: '', password: '', nickname: '', grade: '', role: 'student' });

const pwd = reactive<{ show: boolean; id: number | null; username: string; password: string }>(
  { show: false, id: null, username: '', password: '' },
);

/** 下钻到"这一个学生的全部情况"。**只读页** —— 改还是走这一行上的按钮。 */
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

/** 是不是"我自己"。服务端会拒（角色/停用/删除），这里只是别让人白点一下。 */
function isSelf(row: Row): boolean {
  return !!auth.user && auth.user.id === row.id;
}

/** 拉列表。**四个条件都带上** —— 服务端才是筛选的唯一出处，前端不自己过滤一遍。 */
async function load(): Promise<void> {
  loading.value = true;
  try {
    const p = new URLSearchParams();
    if (q.value.trim()) { p.set('q', q.value.trim()); }
    if (role.value) { p.set('role', role.value); }
    if (status.value) { p.set('status', status.value); }
    p.set('page', String(page.value));
    p.set('pageSize', String(pageSize.value));

    const d = await api<{ total: number; page: number; pageSize: number; items: Row[] }>(
      `/admin/users?${p.toString()}`,
    );
    rows.value = d.items;
    total.value = d.total;
    error.value = '';
  } catch (e) {
    error.value = (e as ApiError).message;
  } finally {
    loading.value = false;
  }
}

/** 改了搜索词 / 筛选条件就回第一页 —— 停在第 3 页会让人以为"什么都没搜到"。 */
function reload(): void {
  page.value = 1;
  void load();
}

function onPage(n: number): void {
  page.value = n;
  void load();
}

function onSize(n: number): void {
  pageSize.value = n;
  page.value = 1;
  void load();
}

async function loadRoles(): Promise<void> {
  try {
    roles.value = (await api<{ items: RoleItem[] }>('/admin/roles')).items;
  } catch {
    /* 角色拉不到就退回内置两项，别让整页空掉 */
    roles.value = [{ code: 'admin', name: '管理员', users: 0 }, { code: 'student', name: '学生', users: 0 }];
  }
}

/** 只发变了的那一个字段。回来之后**以服务端那份为准**覆盖整行 ——
    失败时重新拉一次，绝不把界面留在一个"看着改了、其实没改"的状态上。 */
async function patch(row: Row, body: Record<string, unknown>, note: string): Promise<void> {
  busy.value = row.id;
  try {
    Object.assign(row, await api<Row>(`/admin/users/${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }));
    error.value = '';
    ElMessage.success(note);
  } catch (e) {
    ElMessage.error((e as ApiError).message);
    await load();
  } finally {
    busy.value = null;
  }
}

function setRole(row: Row, v: unknown): void {
  const next = String(v);
  if (next === row.role) { return; }
  void patch(row, { role: next }, `「${row.username}」已改角色`);
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

/** 删除是不可逆的（他的学习数据、帖子、切片会一起没），问的话得说清这一点。 */
async function confirmDelete(row: Row): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `删除「${row.username}」后不可恢复：他的学习记录、帖子、上传的卷子都会一起没。\n` +
        '只是不想让他登录的话，用「停用」。',
      '删除账号',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '算了', confirmButtonClass: 'el-button--danger' },
    );
  } catch {
    return;
  }
  busy.value = row.id;
  try {
    await api(`/admin/users/${row.id}`, { method: 'DELETE' });
    ElMessage.success(`「${row.username}」已删除`);
    /* 删完这一页可能空了，往回退一页再拉 */
    if (rows.value.length === 1 && page.value > 1) { page.value -= 1; }
    await Promise.all([load(), loadRoles()]);
  } catch (e) {
    ElMessage.error((e as ApiError).message);
  } finally {
    busy.value = null;
  }
}

function openCreate(): void {
  edit.id = null;
  edit.isSelf = false;
  edit.username = '';
  edit.password = '';
  edit.nickname = '';
  edit.grade = '';
  edit.role = 'student';
  edit.show = true;
}

function openEdit(row: Row): void {
  edit.id = row.id;
  edit.isSelf = isSelf(row);
  edit.username = row.username;
  edit.password = '';
  edit.nickname = row.nickname;
  edit.grade = row.grade || '';
  edit.role = row.role;
  edit.show = true;
}

async function saveEdit(): Promise<void> {
  if (edit.id === null) {
    if (!edit.username.trim() || !edit.password || !edit.nickname.trim()) {
      ElMessage.warning('账号、密码、昵称都要填');
      return;
    }
  } else if (!edit.nickname.trim()) {
    ElMessage.warning('昵称不能空');
    return;
  }

  saving.value = true;
  try {
    if (edit.id === null) {
      await api('/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          username: edit.username.trim(),
          password: edit.password,
          nickname: edit.nickname.trim(),
          grade: edit.grade.trim() || null,
          role: edit.role,
        }),
      });
      ElMessage.success('已新建');
    } else {
      /* 只发昵称/年级 —— 角色走列表那一行的下拉，避免两个入口改同一个字段。
         自己的角色不允许在这里改（服务端也会拒）。 */
      await api(`/admin/users/${edit.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ nickname: edit.nickname.trim(), grade: edit.grade.trim() || null }),
      });
      ElMessage.success('已保存');
    }
    edit.show = false;
    await Promise.all([load(), loadRoles()]);
  } catch (e) {
    ElMessage.error((e as ApiError).message);
  } finally {
    saving.value = false;
  }
}

function openPassword(row: Row): void {
  pwd.id = row.id;
  pwd.username = row.username;
  pwd.password = '';
  pwd.show = true;
}

async function savePassword(): Promise<void> {
  if (!pwd.password) { ElMessage.warning('先填一个新密码'); return; }
  saving.value = true;
  try {
    await api(`/admin/users/${pwd.id}/password`, {
      method: 'POST',
      body: JSON.stringify({ password: pwd.password }),
    });
    ElMessage.success(`「${pwd.username}」的密码已重置，他已下线`);
    pwd.show = false;
  } catch (e) {
    ElMessage.error((e as ApiError).message);
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void loadRoles();
  void load();
});
</script>

<style scoped>
.mb { margin-bottom: 12px; }
.head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.head__note { font-size: 12px; font-weight: 400; color: var(--admin-ink-3); }

.bar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.bar__q { max-width: 300px; }
.bar__sel { width: 150px; }
.bar__gap { flex: 1; }

.pager { display: flex; justify-content: flex-end; margin-top: 14px; }

.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.link { color: var(--el-color-primary); text-decoration: none; }
.link:hover { text-decoration: underline; }
.dim { color: var(--admin-ink-3); }
.small { font-size: 11px; margin-top: 2px; }
.self { margin-left: 6px; }
.hint { font-size: 12px; line-height: 1.8; color: var(--admin-ink-3); margin-left: 8px; }
.foot { margin: 14px 0 0; font-size: 12px; line-height: 1.9; color: var(--admin-ink-3); }
</style>
