<template>
  <el-card>
    <template #header>
      <div class="head">
        <span>班级</span>
        <span class="head__note">
          按<strong>学段</strong>分栏（小学 / 初中 / 高中 / 奥赛）——
          分组只看学段，不看"七年级（下）"这种文本。
        </span>
      </div>
    </template>

    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="mb" />
    <el-alert
      v-if="!canWrite"
      title="你只能看自己带的班。建班、调班、设班主任是管理员的事。"
      type="info" show-icon :closable="false" class="mb"
    />

    <el-tabs v-model="tab">
      <el-tab-pane
        v-for="s in stages"
        :key="s.stage"
        :name="s.stage"
        :label="`${s.name}（${s.classes} 班 / ${s.students} 人）`"
      >
        <div class="bar">
          <el-button v-if="canWrite" size="small" type="primary" @click="openCreate(s.stage)">
            在「{{ s.name }}」下建班
          </el-button>
          <span class="bar__gap" />
          <el-button size="small" :loading="loading" @click="reload">刷新</el-button>
        </div>

        <div v-if="!byStage(s.stage).length" class="empty">
          这一学段还没有班{{ canWrite ? '，用上面的按钮建一个' : '' }}。
        </div>

        <div v-else class="grid">
          <div v-for="c in byStage(s.stage)" :key="c.id" class="cls">
            <div class="cls__top">
              <span class="cls__name">{{ c.name }}</span>
              <el-tag size="small" effect="plain">{{ c.stageName }}</el-tag>
            </div>
            <div class="cls__meta">
              <span>{{ c.grade || '未填年级' }}</span>
              <span class="dim">·</span>
              <span>{{ c.students }} 人</span>
            </div>
            <div class="cls__teacher">
              班主任：<b>{{ c.teacherName || '未指定' }}</b>
            </div>
            <div class="cls__acts">
              <el-button size="small" type="primary" plain @click="openRoster(c)">花名册</el-button>
              <el-button size="small" @click="openDetail(c)">名单</el-button>
              <el-button v-if="canWrite" size="small" @click="openEdit(c)">改</el-button>
              <el-button v-if="canWrite" size="small" type="danger" plain @click="confirmDelete(c)">删</el-button>
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 名单 -->
    <el-drawer v-model="detail.show" :title="`${detail.name} · 名单`" size="620px">
      <div v-if="canWrite" class="addrow">
        <el-select
          v-model="detail.pick"
          multiple filterable remote
          :remote-method="searchStudents"
          :loading="searching"
          placeholder="搜账号或昵称，把学生加进来"
          class="addrow__sel"
        >
          <el-option
            v-for="u in candidates" :key="u.id"
            :label="`${u.nickname}（${u.username}）${u.className ? ' · 现在在 ' + u.className : ''}`"
            :value="u.id"
          />
        </el-select>
        <el-button :disabled="!detail.pick.length" :loading="saving" @click="addStudents">加入</el-button>
      </div>
      <el-alert
        v-else
        title="名单只读 —— 调班是管理员的事。"
        type="info" show-icon :closable="false" class="mb"
      />

      <el-table :data="detail.students" size="small" stripe>
        <el-table-column prop="username" label="账号" width="140">
          <template #default="{ row }"><span class="mono">{{ row.username }}</span></template>
        </el-table-column>
        <el-table-column prop="nickname" label="昵称" min-width="100" />
        <el-table-column label="年级" min-width="110">
          <template #default="{ row }">
            <span v-if="row.grade">{{ row.grade }}</span><span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.disabledAt" size="small" type="info">已停用</el-tag>
            <el-tag v-else size="small" type="success">正常</el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="canWrite" label="操作" width="90" align="right">
          <template #default="{ row }">
            <el-button link type="danger" size="small" @click="removeStudent(row)">移出</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-drawer>

    <!-- 建 / 改 -->
    <el-dialog v-model="edit.show" :title="edit.id === null ? '新建班级' : '改班级'" width="520px">
      <el-form label-width="80px">
        <el-form-item label="名称" required>
          <el-input v-model="edit.name" maxlength="64" placeholder="例如 七年级（下）· 周三班" />
        </el-form-item>
        <el-form-item label="学段" required>
          <el-select v-model="edit.stage">
            <el-option v-for="s in stages" :key="s.stage" :label="s.name" :value="s.stage" />
          </el-select>
          <span class="hint">改学段会把班里学生的学段一起改过去 —— 分栏是按学段分的</span>
        </el-form-item>
        <el-form-item label="年级">
          <el-input v-model="edit.grade" maxlength="64" placeholder="例如 七年级（下）；奥赛班可以留空" />
        </el-form-item>
        <el-form-item label="班主任">
          <el-select v-model="edit.teacherId" clearable placeholder="选一位教师" class="w100">
            <el-option
              v-for="t in teachers" :key="t.id"
              :label="`${t.nickname}（${t.username}）`" :value="t.id"
            />
          </el-select>
          <span class="hint">只有 teacher / admin 角色的人能被指为班主任</span>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="edit.note" type="textarea" :rows="2" maxlength="5000" placeholder="上课时间、教材版本这类" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="edit.show = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveClass">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRouter } from 'vue-router';
import { api, can, type ApiError } from '../api';

type StageRow = { stage: string; name: string; classes: number; students: number };
type ClassRow = {
  id: number; name: string; stage: string; stageName: string; grade: string | null;
  teacherId: number | null; teacherName: string | null; note: string | null;
  order: number; active: boolean; students: number;
};
type StudentRow = {
  id: number; username: string; nickname: string; grade: string | null;
  stage: string | null; disabledAt: string | null;
};
type Candidate = { id: number; username: string; nickname: string; className: string | null };

const error = ref('');
const loading = ref(false);
const saving = ref(false);
const searching = ref(false);
const canWrite = computed(() => can('class.write'));
const router = useRouter();

const stages = ref<StageRow[]>([]);
const rows = ref<ClassRow[]>([]);
const tab = ref('junior');
const teachers = ref<{ id: number; username: string; nickname: string }[]>([]);
const candidates = ref<Candidate[]>([]);

const detail = reactive<{ show: boolean; id: number | null; name: string; students: StudentRow[]; pick: number[] }>(
  { show: false, id: null, name: '', students: [], pick: [] },
);

const edit = reactive<{
  show: boolean; id: number | null;
  name: string; stage: string; grade: string; teacherId: number | null; note: string;
}>({ show: false, id: null, name: '', stage: 'primary', grade: '', teacherId: null, note: '' });

function byStage(s: string): ClassRow[] {
  return rows.value.filter((c) => c.stage === s);
}

async function loadStages(): Promise<void> {
  const d = await api<{ items: StageRow[] }>('/admin/stages');
  stages.value = d.items;
  if (!d.items.some((s) => s.stage === tab.value)) { tab.value = d.items[0]?.stage ?? 'junior'; }
}

async function loadClasses(): Promise<void> {
  loading.value = true;
  try {
    rows.value = (await api<{ total: number; items: ClassRow[] }>('/admin/classes')).items;
    error.value = '';
  } catch (e) {
    error.value = (e as ApiError).message;
  } finally {
    loading.value = false;
  }
}

async function reload(): Promise<void> {
  await Promise.all([loadStages(), loadClasses()]);
}

/** 班主任下拉的候选人。只有能改班的人才需要它 —— 而能改班的人一定有 user.read。 */
async function loadTeachers(): Promise<void> {
  if (!canWrite.value) { return; }
  try {
    const d = await api<{ items: { id: number; username: string; nickname: string; role: string }[] }>(
      '/admin/users?pageSize=100',
    );
    teachers.value = d.items.filter((u) => u.role === 'teacher' || u.role === 'admin');
  } catch { /* 拉不到就不给选，别把整页弄挂 */ }
}

async function searchStudents(q: string): Promise<void> {
  if (!canWrite.value) { return; }
  searching.value = true;
  try {
    const p = new URLSearchParams({ role: 'student', pageSize: '20' });
    if (q.trim()) { p.set('q', q.trim()); }
    const d = await api<{ items: Candidate[] }>(`/admin/users?${p.toString()}`);
    candidates.value = d.items.map((u) => ({
      id: u.id, username: u.username, nickname: u.nickname, className: u.className,
    }));
  } catch {
    candidates.value = [];
  } finally {
    searching.value = false;
  }
}

/** 花名册是单独一页（S3）—— 名单抽屉只管"谁在班里"，花名册带每人的指标 */
function openRoster(c: ClassRow): void {
  void router.push(`/classes/${c.id}`);
}

async function openDetail(c: ClassRow): Promise<void> {
  detail.id = c.id;
  detail.name = c.name;
  detail.pick = [];
  candidates.value = [];
  try {
    const d = await api<{ students: StudentRow[] }>(`/admin/classes/${c.id}`);
    detail.students = d.students;
    detail.show = true;
    if (canWrite.value) { void searchStudents(''); }
  } catch (e) {
    ElMessage.error((e as ApiError).message);
  }
}

async function addStudents(): Promise<void> {
  if (detail.id === null) { return; }
  saving.value = true;
  try {
    const r = await api<{ moved: number; skipped: number }>(
      `/admin/classes/${detail.id}/students`,
      { method: 'POST', body: JSON.stringify({ userIds: detail.pick }) },
    );
    ElMessage.success(`加入 ${r.moved} 人${r.skipped ? `，跳过 ${r.skipped} 个非学生账号` : ''}`);
    detail.pick = [];
    await openDetail({ id: detail.id, name: detail.name } as ClassRow);
    await reload();
  } catch (e) {
    ElMessage.error((e as ApiError).message);
  } finally {
    saving.value = false;
  }
}

async function removeStudent(u: StudentRow): Promise<void> {
  if (detail.id === null) { return; }
  try {
    await api(`/admin/classes/${detail.id}/students/${u.id}`, { method: 'DELETE' });
    ElMessage.success(`「${u.nickname}」已移出班级`);
    await openDetail({ id: detail.id, name: detail.name } as ClassRow);
    await reload();
  } catch (e) {
    ElMessage.error((e as ApiError).message);
  }
}

function openCreate(stage: string): void {
  edit.id = null;
  edit.name = '';
  edit.stage = stage;
  edit.grade = '';
  edit.teacherId = null;
  edit.note = '';
  edit.show = true;
}

function openEdit(c: ClassRow): void {
  edit.id = c.id;
  edit.name = c.name;
  edit.stage = c.stage;
  edit.grade = c.grade || '';
  edit.teacherId = c.teacherId;
  edit.note = c.note || '';
  edit.show = true;
}

async function saveClass(): Promise<void> {
  if (!edit.name.trim()) { ElMessage.warning('班级名称不能空'); return; }
  saving.value = true;
  try {
    const body = JSON.stringify({
      name: edit.name.trim(),
      stage: edit.stage,
      grade: edit.grade.trim() || null,
      teacherId: edit.teacherId,
      note: edit.note.trim() || null,
    });
    if (edit.id === null) {
      await api('/admin/classes', { method: 'POST', body });
      ElMessage.success('已建班');
    } else {
      await api(`/admin/classes/${edit.id}`, { method: 'PATCH', body });
      ElMessage.success('已保存');
    }
    edit.show = false;
    await reload();
  } catch (e) {
    ElMessage.error((e as ApiError).message);
  } finally {
    saving.value = false;
  }
}

/** 删班要说清后果：学生不会被删，只是没班了。 */
async function confirmDelete(c: ClassRow): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `删除「${c.name}」？班里的 ${c.students} 个学生不会被删除，只是暂时没有班。`,
      '删除班级',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '算了' },
    );
  } catch {
    return;
  }
  try {
    const r = await api<{ movedOut: number }>(`/admin/classes/${c.id}`, { method: 'DELETE' });
    ElMessage.success(`已删除，${r.movedOut} 个学生回到「未分班」`);
    await reload();
  } catch (e) {
    ElMessage.error((e as ApiError).message);
  }
}

onMounted(async () => {
  await Promise.all([reload(), loadTeachers()]);
});
</script>

<style scoped>
.mb { margin-bottom: 12px; }
.head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.head__note { font-size: 12px; font-weight: 400; color: var(--admin-ink-3); }

.bar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.bar__gap { flex: 1; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(268px, 1fr)); gap: 12px; }
.cls { border: 1px solid var(--admin-border, #e4e7ed); border-radius: 8px; padding: 14px; }
.cls__top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.cls__name { font-weight: 600; }
.cls__meta { font-size: 12px; color: var(--admin-ink-3); margin: 8px 0 4px; display: flex; gap: 6px; }
.cls__teacher { font-size: 12px; color: var(--admin-ink-3); }
.cls__acts { display: flex; gap: 6px; margin-top: 12px; }

.addrow { display: flex; gap: 8px; margin-bottom: 12px; }
.addrow__sel { flex: 1; }
.w100 { width: 100%; }

.hint { font-size: 12px; color: var(--admin-ink-3); margin-left: 8px; line-height: 1.7; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.dim { color: var(--admin-ink-3); }
.empty { padding: 24px 0; font-size: 13px; color: var(--admin-ink-3); }
</style>
