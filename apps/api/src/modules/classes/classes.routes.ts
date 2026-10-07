/* ==========================================================================
   /api/admin/classes 与 /api/admin/stages —— 班级与学段（学生管理 · S1）
   --------------------------------------------------------------------------
   用户 2026-10-07："小学 中学 高中 奥赛分开管理；各自的班级和管理老师。"

   两条定死的规矩（设计稿 §4）：

   ① **老师只看自己带的班，而且这条必须在服务端。**
      不是"前端藏了别的班" —— 接口按 classScopeOf() 过滤；越界回 **404 而不是 403**：
      403 等于告诉对方「这个 id 存在，只是不给你看」，那本身就是个班级/学生探测器。

   ② **class.write 只给 admin。**
      老师要是能建班，他就能把自己塞进任何班，"只看自己班"立刻成一句空话。
      所以"能不能改"和"能看多宽"是两件事，一个走权限点，一个走数据范围。

   分组的唯一依据是 `stage`，不是 `grade` 文本 —— 理由见 schema 里 User.stage 那段注释。
   ========================================================================== */
import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../../openapi.js';
import { prisma } from '../../db.js';
import { requireAuth, requirePerm } from '../../middleware/auth.js';
import type { AuthUser } from '../../middleware/auth.js';
import type { Prisma } from '@prisma/client';
import {
  metricsByUser, metricsForUsers, growthForStudent, defaultRange,
} from './class-stats.service.js';

/** 四个学段。取值与 Node.stage **同一套**，不另发明。 */
export const STAGES = ['primary', 'junior', 'senior', 'olympiad'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_CN: Record<string, string> = {
  primary: '小学', junior: '初中', senior: '高中', olympiad: '奥赛',
};

const ErrOut = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

const StageOut = z.object({
  stage: z.string(), name: z.string(),
  classes: z.number(), students: z.number(),
});

const ClassRow = z.object({
  id: z.number(),
  name: z.string(),
  stage: z.string(),
  stageName: z.string(),
  grade: z.string().nullable(),
  teacherId: z.number().nullable(),
  teacherName: z.string().nullable(),
  note: z.string().nullable(),
  order: z.number(),
  active: z.boolean(),
  students: z.number(),
});

const ClassIn = z.object({
  name: z.string().min(1).max(64),
  stage: z.enum(STAGES),
  grade: z.string().max(64).nullable().optional(),
  teacherId: z.number().int().positive().nullable().optional(),
  note: z.string().max(5000).nullable().optional(),
  order: z.number().int().min(0).max(9999).optional(),
});

const ClassPatchIn = ClassIn.partial().refine(
  (d) => Object.keys(d).length > 0, { message: '没说要改什么' },
);

const AssignIn = z.object({
  userIds: z.array(z.number().int().positive()).min(1).max(200),
});

registry.registerPath({
  method: 'get', path: '/api/admin/stages', summary: '四个学段与各自的班级数/学生数（需 class.read）',
  responses: { 200: { description: '学段', content: { 'application/json': { schema: z.object({ items: z.array(StageOut) }) } } }, 403: { description: '没权限' } },
});
registry.registerPath({
  method: 'get', path: '/api/admin/classes', summary: '班级列表（老师只回自己带的，需 class.read）',
  responses: { 200: { description: '班级', content: { 'application/json': { schema: z.object({ total: z.number(), items: z.array(ClassRow) }) } } }, 403: { description: '没权限' } },
});
registry.registerPath({
  method: 'post', path: '/api/admin/classes', summary: '建班（需 class.write）',
  responses: { 201: { description: '建好了', content: { 'application/json': { schema: ClassRow } } }, 400: { description: '入参不对', content: { 'application/json': { schema: ErrOut } } } },
});
registry.registerPath({
  method: 'patch', path: '/api/admin/classes/{id}', summary: '改班（需 class.write）',
  responses: { 200: { description: '改好了', content: { 'application/json': { schema: ClassRow } } }, 404: { description: '没有这个班' } },
});
registry.registerPath({
  method: 'delete', path: '/api/admin/classes/{id}', summary: '删班（学生置空，不删人；需 class.write）',
  responses: { 200: { description: '删好了' }, 404: { description: '没有这个班' } },
});
registry.registerPath({
  method: 'get', path: '/api/admin/classes/{id}', summary: '班级详情与名单（需 class.read）',
  responses: { 200: { description: '班级' }, 404: { description: '没有这个班（或不在你带的班里）' } },
});
registry.registerPath({
  method: 'post', path: '/api/admin/classes/{id}/students', summary: '批量调学生进班（需 class.write）',
  responses: { 200: { description: '调好了' }, 400: { description: '入参不对' }, 404: { description: '没有这个班' } },
});
registry.registerPath({
  method: 'delete', path: '/api/admin/classes/{id}/students/{userId}', summary: '把某人移出班（需 class.write）',
  responses: { 200: { description: '移出了' }, 404: { description: '没有这个班' } },
});

export const classesRouter = Router();

/**
 * 这个人能看哪些班。**null = 不受限**（管理员）。
 *
 * 用 class.write 当"不受限"的判据，是因为它按设计只发给 admin（见文件头 ②）。
 * 以后真要再加一个"教学主任"能看全部，就在这里多一种判据 —— 而不是去改每个接口。
 */
async function classScopeOf(user: AuthUser): Promise<number[] | null> {
  if (user.perms.indexOf('class.write') >= 0) { return null; }
  const rows = await prisma.class.findMany({ where: { teacherId: user.id }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** 越界与"不存在"回同一句话 —— 不给班级 id 当探测器。 */
function noClass(res: { status: (n: number) => { json: (b: unknown) => void } }): void {
  res.status(404).json({ error: { code: 'NO_CLASS', message: '没有这个班' } });
}

function toClassRow(c: {
  id: number; name: string; stage: string; grade: string | null;
  teacherId: number | null; teacher: { nickname: string } | null;
  note: string | null; order: number; active: boolean;
  _count?: { students: number };
}): z.infer<typeof ClassRow> {
  return {
    id: c.id, name: c.name, stage: c.stage, stageName: STAGE_CN[c.stage] ?? c.stage,
    grade: c.grade,
    teacherId: c.teacherId,
    teacherName: c.teacher ? c.teacher.nickname : null,
    note: c.note, order: c.order, active: c.active,
    students: c._count ? c._count.students : 0,
  };
}

const CLASS_INCLUDE = {
  teacher: { select: { nickname: true } },
  _count: { select: { students: true } },
} as const;

/* ---- 学段总览（后台左上那四条分栏）---- */
classesRouter.get('/admin/stages', requireAuth, requirePerm('class.read'), async (req, res) => {
  const scope = await classScopeOf(req.user!);
  const where = scope === null ? {} : { id: { in: scope } };

  const [grouped, studentCounts, unstaged] = await Promise.all([
    prisma.class.groupBy({ by: ['stage'], where, _count: { _all: true } }),
    prisma.user.groupBy({
      by: ['stage'],
      where: { classId: { not: null }, ...(scope === null ? {} : { classId: { in: scope } }) },
      _count: { _all: true },
    }),
    /* 还没分学段的学生 —— 单列一栏，等人来指，不藏起来 */
    prisma.user.count({
      where: { role: { code: 'student' }, OR: [{ stage: null }, { stage: '' }] },
    }),
  ]);

  const cls = new Map(grouped.map((g) => [g.stage, g._count._all]));
  const stu = new Map(studentCounts.map((g) => [g.stage ?? '', g._count._all]));

  res.json({
    items: STAGES.map((s) => ({
      stage: s, name: STAGE_CN[s],
      classes: cls.get(s) ?? 0,
      students: stu.get(s) ?? 0,
    })),
    unstagedStudents: unstaged,
  });
});

/* ---- 班级列表 ---- */
classesRouter.get('/admin/classes', requireAuth, requirePerm('class.read'), async (req, res) => {
  const stage = typeof req.query.stage === 'string' ? req.query.stage : '';
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const scope = await classScopeOf(req.user!);

  const rows = await prisma.class.findMany({
    where: {
      ...(scope === null ? {} : { id: { in: scope } }),
      ...(stage ? { stage } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { grade: { contains: q } }] } : {}),
    },
    orderBy: [{ stage: 'asc' }, { order: 'asc' }, { id: 'asc' }],
    include: CLASS_INCLUDE,
  });
  res.json({ total: rows.length, items: rows.map(toClassRow) });
});

/* ---- 建班 ---- */
classesRouter.post('/admin/classes', requireAuth, requirePerm('class.write'), async (req, res) => {
  const parsed = ClassIn.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '入参不对' } });
    return;
  }
  const d = parsed.data;
  const teacher = await resolveTeacher(d.teacherId);
  if (teacher === 'bad') {
    res.status(400).json({ error: { code: 'BAD_TEACHER', message: '班主任得是 teacher 或 admin 角色的人' } });
    return;
  }
  const created = await prisma.class.create({
    data: {
      name: d.name, stage: d.stage, grade: d.grade ?? null,
      teacherId: d.teacherId ?? null, note: d.note ?? null, order: d.order ?? 0,
    },
    include: CLASS_INCLUDE,
  });
  res.status(201).json(toClassRow(created));
});

/* ---- 改班 ---- */
classesRouter.patch('/admin/classes/:id', requireAuth, requirePerm('class.write'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '班级 id 不对' } });
    return;
  }
  const parsed = ClassPatchIn.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '入参不对' } });
    return;
  }
  const d = parsed.data;
  const found = await prisma.class.findUnique({ where: { id } });
  if (!found) { noClass(res); return; }

  if (d.teacherId !== undefined) {
    const teacher = await resolveTeacher(d.teacherId);
    if (teacher === 'bad') {
      res.status(400).json({ error: { code: 'BAD_TEACHER', message: '班主任得是 teacher 或 admin 角色的人' } });
      return;
    }
  }

  const updated = await prisma.class.update({
    where: { id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.grade !== undefined ? { grade: d.grade } : {}),
      ...(d.teacherId !== undefined ? { teacherId: d.teacherId } : {}),
      ...(d.note !== undefined ? { note: d.note } : {}),
      ...(d.order !== undefined ? { order: d.order } : {}),
      /* 学段变了，班里的人跟着走 —— 分栏是按 stage 分的，班和人不一致就等于没分 */
      ...(d.stage !== undefined ? { stage: d.stage } : {}),
    },
    include: CLASS_INCLUDE,
  });

  if (d.stage !== undefined && d.stage !== found.stage) {
    await prisma.user.updateMany({ where: { classId: id }, data: { stage: d.stage } });
  }
  res.json(toClassRow(updated));
});

/* ---- 删班 ---- */
/* 学生不会跟着没：User.class 是 onDelete: SetNull（schema 里写明了理由）。
   班散了人是还在的，只是暂时没班。 */
classesRouter.delete('/admin/classes/:id', requireAuth, requirePerm('class.write'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '班级 id 不对' } });
    return;
  }
  const found = await prisma.class.findUnique({ where: { id }, include: { _count: { select: { students: true } } } });
  if (!found) { noClass(res); return; }
  await prisma.class.delete({ where: { id } });
  res.json({ ok: true, id, movedOut: found._count.students });
});

/* ---- 班级详情（含名单）---- */
classesRouter.get('/admin/classes/:id', requireAuth, requirePerm('class.read'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '班级 id 不对' } });
    return;
  }
  const scope = await classScopeOf(req.user!);
  if (scope !== null && scope.indexOf(id) < 0) { noClass(res); return; }

  const c = await prisma.class.findUnique({
    where: { id },
    include: { ...CLASS_INCLUDE, students: { orderBy: { id: 'asc' } } },
  });
  if (!c) { noClass(res); return; }

  res.json({
    class: toClassRow(c),
    students: c.students.map((u) => ({
      id: u.id, username: u.username, nickname: u.nickname,
      grade: u.grade, stage: u.stage,
      disabledAt: u.disabledAt ? u.disabledAt.toISOString() : null,
    })),
  });
});

/* ---- 批量调学生进班 ---- */
/* **学生的 stage 跟着班的 stage 走**：分栏是按班分的，一个人在小班却标着初中，
   那么"按学段统计"立刻就是错的。这条同步是刻意的，不是顺手写的。 */
classesRouter.post('/admin/classes/:id/students', requireAuth, requirePerm('class.write'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '班级 id 不对' } });
    return;
  }
  const parsed = AssignIn.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '要给一批 userId' } });
    return;
  }
  const c = await prisma.class.findUnique({ where: { id } });
  if (!c) { noClass(res); return; }

  /* 只收学生 —— 把老师塞进班里当学生是明显的误操作，挡掉比事后查好 */
  const result = await prisma.user.updateMany({
    where: { id: { in: parsed.data.userIds }, role: { code: 'student' } },
    data: { classId: id, stage: c.stage },
  });
  const skipped = parsed.data.userIds.length - result.count;
  res.json({ ok: true, moved: result.count, skipped, stage: c.stage });
});

/* ---- 把某人移出班 ---- */
classesRouter.delete('/admin/classes/:id/students/:userId', requireAuth, requirePerm('class.write'), async (req, res) => {
  const id = Number(req.params.id);
  const userId = Number(req.params.userId);
  if (!Number.isInteger(id) || !Number.isInteger(userId)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'id 不对' } });
    return;
  }
  const c = await prisma.class.findUnique({ where: { id } });
  if (!c) { noClass(res); return; }
  /* 只动真的在这个班里的那一个 —— 不然会把别人从别的班里踢出来 */
  const result = await prisma.user.updateMany({
    where: { id: userId, classId: id },
    data: { classId: null },
  });
  if (result.count === 0) {
    res.status(404).json({ error: { code: 'NOT_IN_CLASS', message: '这个人不在这个班里' } });
    return;
  }
  res.json({ ok: true });
});

/** 班主任只能是教师或管理员。返回 'ok' | 'none' | 'bad'。 */
async function resolveTeacher(teacherId: number | null | undefined): Promise<'ok' | 'none' | 'bad'> {
  if (teacherId === null || teacherId === undefined) { return 'none'; }
  const u = await prisma.user.findUnique({ where: { id: teacherId }, include: { role: true } });
  if (!u) { return 'bad'; }
  return u.role.code === 'teacher' || u.role.code === 'admin' ? 'ok' : 'bad';
}

/* ==========================================================================
   统计接口（S2）
   --------------------------------------------------------------------------
   三条：一组成员的汇总、一个班的花名册、一个学生的成长数据。
   算法全在 class-stats.service.ts 里，这里只负责"谁有资格看什么"。

   老师的数据范围仍然由 classScopeOf() 守着，越界一律 404（理由见文件头）。
   ========================================================================== */

const Granularity = z.enum(['week', 'month']);

const PersonBrief = z.object({
  id: z.number(), username: z.string(), nickname: z.string(),
  grade: z.string().nullable(), stage: z.string().nullable(),
  learned: z.number(),
  masteryAvg: z.number().nullable(),
  exams: z.number(),
  avgRate: z.number().nullable(),
  mistakes: z.number(),
  practice: z.object({
    sessions: z.number(), questions: z.number(), correct: z.number(),
    accuracy: z.number().nullable(), lastAt: z.string().nullable(),
  }),
});

registry.registerPath({
  method: 'get', path: '/api/admin/stats/overview', summary: '学段/班级汇总（需 class.read）',
  responses: { 200: { description: '汇总' }, 403: { description: '没权限' } },
});
registry.registerPath({
  method: 'get', path: '/api/admin/classes/{id}/roster', summary: '班级花名册（每人一行核心指标，需 class.read）',
  responses: { 200: { description: '花名册' }, 404: { description: '没有这个班（或不在你带的班里）' } },
});
registry.registerPath({
  method: 'get', path: '/api/admin/students/{id}/growth', summary: '学生成长数据（需 student.read）',
  responses: { 200: { description: '成长/学习/成绩/习题量/薄弱点' }, 404: { description: '没有这个学生（或不在你带的班里）' } },
});

/** 老师能看的"人"的范围：自己带的班里的人；admin 不受限。
    E2 的明细接口也用它 —— 范围判定只在这一处，多一个入口就多一种口径。 */
export async function visibleUserIds(user: AuthUser): Promise<number[] | null> {
  const scope = await classScopeOf(user);
  if (scope === null) { return null; }
  if (!scope.length) { return []; }
  const rows = await prisma.user.findMany({ where: { classId: { in: scope } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/* ---- 一组成员的汇总：按学段 / 按班级 / 全班 ---- */
classesRouter.get('/admin/stats/overview', requireAuth, requirePerm('class.read'), async (req, res) => {
  const stage = typeof req.query.stage === 'string' ? req.query.stage : '';
  const classId = Number(req.query.classId);

  const scope = await classScopeOf(req.user!);
  const where: Prisma.UserWhereInput = {
    role: { code: 'student' },
    ...(stage ? { stage } : {}),
    ...(Number.isInteger(classId) && classId > 0 ? { classId } : {}),
    ...(scope === null ? {} : { classId: { in: scope } }),
  };

  const students = await prisma.user.findMany({ where, select: { id: true } });
  const metrics = await metricsForUsers(students.map((s) => s.id));
  res.json({ scope: { stage: stage || null, classId: Number.isInteger(classId) && classId > 0 ? classId : null }, metrics });
});

/* ---- 花名册：每人一行核心指标 ---- */
classesRouter.get('/admin/classes/:id/roster', requireAuth, requirePerm('class.read'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '班级 id 不对' } });
    return;
  }
  const scope = await classScopeOf(req.user!);
  if (scope !== null && scope.indexOf(id) < 0) { noClass(res); return; }

  const c = await prisma.class.findUnique({
    where: { id },
    include: { ...CLASS_INCLUDE, students: { orderBy: { id: 'asc' } } },
  });
  if (!c) { noClass(res); return; }

  const ids = c.students.map((s) => s.id);
  const per = await metricsByUser(ids);
  const empty = { learned: 0, masteryAvg: null, exams: 0, avgRate: null, mistakes: 0,
    practice: { sessions: 0, questions: 0, correct: 0, judged: 0, accuracy: null, lastAt: null } };

  res.json({
    class: toClassRow(c),
    metrics: await metricsForUsers(ids),
    items: c.students.map((u) => ({
      id: u.id, username: u.username, nickname: u.nickname,
      grade: u.grade, stage: u.stage,
      ...(per.get(u.id) ?? empty),
    })),
  });
});

/* ---- 学生看自己的成长数据 ----
   与 /admin/students/:id/growth **共用同一个 service 函数**，只是一个 userId 从 cookie 取、
   一个从路径取。两套算法迟早会给出两个不同的平均掌握度，学生和老师各拿一个数说话 ——
   这和 sliceReport() 的教训是同一条。 ---- */
classesRouter.get('/me/growth', requireAuth, async (req, res) => {
  const g = typeof req.query.granularity === 'string' && req.query.granularity === 'month' ? 'month' : 'week';
  const range = defaultRange(req.query.from, req.query.to);
  const me = req.user!.id;

  /* 没给 from 时，起点取**这个人自己的第一条事件** —— 与后台那条同样的理由：
     卡在「近 180 天」会让成长曲线变成一条平线，那不是没成长，是看错了窗口。 */
  if (typeof req.query.from !== 'string' || !req.query.from) {
    const first = await prisma.learningEvent.findFirst({
      where: { record: { userId: me } },
      orderBy: { at: 'asc' },
      select: { at: true },
    });
    if (first) { range.from = new Date(Number(first.at)); }
  }

  const data = await growthForStudent(me, { granularity: g, from: range.from, to: range.to });
  res.json({ range: { from: range.from.toISOString(), to: range.to.toISOString(), granularity: g }, ...data });
});

/* ---- 一个学生的成长数据 ---- */
classesRouter.get('/admin/students/:id/growth', requireAuth, requirePerm('student.read'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '学生 id 不对' } });
    return;
  }

  const u = await prisma.user.findUnique({
    where: { id },
    include: { role: true, class: { select: { id: true, name: true, stage: true } } },
  });
  if (!u || u.role.code !== 'student') {
    res.status(404).json({ error: { code: 'NO_STUDENT', message: '没有这个学生' } });
    return;
  }

  /* 老师只能看自己班的学生；越界与"没这个人"回同一句话 */
  const visible = await visibleUserIds(req.user!);
  if (visible !== null && visible.indexOf(id) < 0) {
    res.status(404).json({ error: { code: 'NO_STUDENT', message: '没有这个学生' } });
    return;
  }

  const g = typeof req.query.granularity === 'string' && req.query.granularity === 'month' ? 'month' : 'week';
  const range = defaultRange(req.query.from, req.query.to);
  /* 没给 from 时，起点取**这个人的第一条事件**，而不是「近 180 天」。
     演示数据的事件从 2020 年就开始了，卡在近 180 天的话，区间一开始状态就已经定型，
     成长曲线出来是一条平线 —— 那不是「没成长」，是**看错了窗口**。 */
  if (typeof req.query.from !== 'string' || !req.query.from) {
    const first = await prisma.learningEvent.findFirst({
      where: { record: { userId: id } },
      orderBy: { at: 'asc' },
      select: { at: true },
    });
    if (first) { range.from = new Date(Number(first.at)); }
  }
  const data = await growthForStudent(id, { granularity: g, from: range.from, to: range.to });

  res.json({
    student: {
      id: u.id, username: u.username, nickname: u.nickname,
      grade: u.grade, stage: u.stage,
      classId: u.class ? u.class.id : null,
      className: u.class ? u.class.name : null,
    },
    range: { from: range.from.toISOString(), to: range.to.toISOString(), granularity: g },
    ...data,
  });
});
