/* ==========================================================================
   /api/exams 与 /api/admin/exams —— 真题题库
   --------------------------------------------------------------------------
   与 `/practice`（演示阶段那 4 道练习题）**是两回事**：
     · practice 是录入死的、不分年份地区、不绑章节的练习题，判分走 PracticeSession
     · exams  是中考 / 高考 / 模拟卷上的真题，按"年份 / 地区 / 卷型 / 章节"筛

   两条不能破的规矩（与 practice 同一）：
     ① **列表不带答案。** 列表只给题面摘要，不把 answer 和 explanation 发出去 ——
        不然等于把所有题的答案连同列表一起端出去。
     ② **题解是会员专属。** 详情接口里 explanation 字段：有 `member_solution` 权益
        就给，没有就给 null —— 前台照这个标志决定显不显"会员可见"的引导，
        而不是空一片让人以为页面坏了。判分本身（对不对）是免费的，
        真题只看答案对不对的话**前端能自己比**，所以不另开判分接口。
   ========================================================================== */
import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../../openapi.js';
import { prisma } from '../../db.js';
import { requireAuth, requirePerm } from '../../middleware/auth.js';
import { canUse } from '../../middleware/perk.js';

const ErrOut = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/* ---- 出参形状 ---- */
const ExamListItem = z.object({
  id: z.number(),
  kind: z.string(),
  code: z.string(),
  stem: z.string().describe('题干 HTML，列表只给前面一截摘要也行 —— 这一版给全量，前端自截'),
  year: z.number(),
  region: z.string(),
  paperType: z.string(),
  qtype: z.string(),
  difficulty: z.number(),
  no: z.string().nullable(),
  nodeId: z.number().nullable(),
  nodeName: z.string().describe('挂靠章节名；没挂就是空串'),
  source: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ExamDetail = ExamListItem.extend({
  options: z.array(z.object({ key: z.string(), text: z.string() })),
  blanks: z.array(z.object({ label: z.string() })),
  answer: z.string().nullable(),
  explanation: z.string().nullable().describe('会员可见；没权益就 null'),
});

const ExamListOut = z.object({ total: z.number(), items: z.array(ExamListItem) });

registry.registerPath({
  method: 'get', path: '/api/exams', summary: '真题列表（带筛选，不带答案）',
  responses: { 200: { description: '列表', content: { 'application/json': { schema: ExamListOut } } }, 401: { description: '未登录' } },
});
registry.registerPath({
  method: 'get', path: '/api/exams/facets', summary: '筛选项的可用值（年份 / 地区 / 卷型 / 题型）',
  responses: { 200: { description: '可用值', content: { 'application/json': { schema: z.object({
    years: z.array(z.number()),
    regions: z.array(z.string()),
    paperTypes: z.array(z.string()),
    qtypes: z.array(z.string()),
  }) } } }, 401: { description: '未登录' } },
});
registry.registerPath({
  method: 'get', path: '/api/exams/{id}', summary: '真题详情（带答案；解析按权益）',
  responses: {
    200: { description: '详情', content: { 'application/json': { schema: ExamDetail } } },
    401: { description: '未登录' },
    404: { description: '没有这道题', content: { 'application/json': { schema: ErrOut } } },
  },
});

/* ---- 录入 / 修改入参 ---- */
const OptionIn = z.object({ key: z.string().max(8), text: z.string().max(2000) });
const BlankIn = z.object({ label: z.string().max(64) });

const ExamIn = z.object({
  kind: z.enum(['choice', 'blank', 'board']),
  code: z.string().max(64).optional().describe('不填由服务端用 id 拼'),
  stem: z.string().min(1).max(20000),
  options: z.array(OptionIn).max(10).optional(),
  blanks: z.array(BlankIn).max(10).optional(),
  answer: z.string().max(64).nullable().optional(),
  explanation: z.string().max(20000).nullable().optional(),
  year: z.number().int().min(1900).max(2100),
  region: z.string().min(1).max(64),
  paperType: z.string().min(1).max(32),
  qtype: z.string().min(1).max(32),
  difficulty: z.number().int().min(1).max(5).default(3),
  no: z.string().max(16).nullable().optional(),
  nodeId: z.number().int().positive().nullable().optional(),
  source: z.string().max(191).nullable().optional(),
});

const ExamAdminRow = ExamListItem;
const ExamAdminList = z.object({ total: z.number(), items: z.array(ExamAdminRow) });

registry.registerPath({
  method: 'get', path: '/api/admin/exams', summary: '真题列表（管理端，需 exam.read）',
  responses: { 200: { description: '列表', content: { 'application/json': { schema: ExamAdminList } } }, 403: { description: '没权限' } },
});
registry.registerPath({
  method: 'post', path: '/api/admin/exams', summary: '录一道真题（需 exam.write）',
  request: { body: { content: { 'application/json': { schema: ExamIn } } } },
  responses: {
    201: { description: '录好了', content: { 'application/json': { schema: ExamAdminRow } } },
    400: { description: '入参不对', content: { 'application/json': { schema: ErrOut } } },
    403: { description: '没权限', content: { 'application/json': { schema: ErrOut } } },
  },
});
registry.registerPath({
  method: 'patch', path: '/api/admin/exams/{id}', summary: '改一道真题（需 exam.write）',
  request: { body: { content: { 'application/json': { schema: ExamIn.partial() } } } },
  responses: {
    200: { description: '改好了', content: { 'application/json': { schema: ExamAdminRow } } },
    404: { description: '没有这道题', content: { 'application/json': { schema: ErrOut } } },
    403: { description: '没权限', content: { 'application/json': { schema: ErrOut } } },
  },
});
registry.registerPath({
  method: 'get', path: '/api/admin/exams/{id}', summary: '真题详情（管理端，全字段，需 exam.read）',
  responses: {
    200: { description: '详情', content: { 'application/json': { schema: ExamDetail } } },
    404: { description: '没有这道题', content: { 'application/json': { schema: ErrOut } } },
  },
});

registry.registerPath({
  method: 'delete', path: '/api/admin/exams/{id}', summary: '删一道真题（需 exam.write）',
  responses: { 204: { description: '删掉了' }, 404: { description: '没有这道题' } },
});

export const examsRouter = Router();

function parseOptions(raw: string | null): { key: string; text: string }[] {
  if (!raw) { return []; }
  try { return JSON.parse(raw) as { key: string; text: string }[]; } catch { return []; }
}
function parseBlanks(raw: string | null): { label: string }[] {
  if (!raw) { return []; }
  try { return (JSON.parse(raw) as { label: string }[]).map((b) => ({ label: b.label })); } catch { return []; }
}

async function nameMap(ids: number[]): Promise<Map<number, string>> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) { return new Map(); }
  const rows = await prisma.node.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } });
  return new Map(rows.map((n) => [n.id, n.name]));
}

type Row = {
  id: number; kind: string; code: string; stem: string;
  options: string | null; blanks: string | null; answer: string | null; explanation: string | null;
  year: number; region: string; paperType: string; qtype: string; difficulty: number; no: string | null;
  nodeId: number | null; source: string | null;
  createdAt: Date; updatedAt: Date;
};

async function toListItem(r: Row, names?: Map<number, string>): Promise<{
  id: number; kind: string; code: string; stem: string;
  year: number; region: string; paperType: string; qtype: string;
  difficulty: number; no: string | null; nodeId: number | null; nodeName: string;
  source: string | null; createdAt: string; updatedAt: string;
}> {
  let nm = '';
  if (r.nodeId) { nm = names ? (names.get(r.nodeId) ?? '') : ((await nameMap([r.nodeId])).get(r.nodeId) ?? ''); }
  return {
    id: r.id, kind: r.kind, code: r.code, stem: r.stem,
    year: r.year, region: r.region, paperType: r.paperType, qtype: r.qtype,
    difficulty: r.difficulty, no: r.no,
    nodeId: r.nodeId, nodeName: nm,
    source: r.source,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}

/* ---- 学生端：列表（带筛选，不带答案）---- */
examsRouter.get('/exams', requireAuth, async (req, res) => {
  const q = req.query;
  const where = {
    ...(typeof q.year === 'string' && q.year ? { year: Number(q.year) } : {}),
    ...(typeof q.region === 'string' && q.region ? { region: q.region } : {}),
    ...(typeof q.paperType === 'string' && q.paperType ? { paperType: q.paperType } : {}),
    ...(typeof q.qtype === 'string' && q.qtype ? { qtype: q.qtype } : {}),
    ...(typeof q.kind === 'string' && q.kind ? { kind: q.kind } : {}),
    ...(typeof q.difficulty === 'string' && q.difficulty ? { difficulty: Number(q.difficulty) } : {}),
    ...(typeof q.nodeId === 'string' && q.nodeId ? { nodeId: Number(q.nodeId) } : {}),
  };
  const rows = await prisma.examQuestion.findMany({
    where,
    orderBy: [{ year: 'desc' }, { id: 'desc' }],
    take: 200,
  });
  const names = await nameMap(rows.map((r) => r.nodeId).filter((x): x is number => x !== null));
  const items = await Promise.all(rows.map((r) => toListItem(r, names)));
  res.json({ total: items.length, items });
});

/* ---- 学生端：筛选项可用值 ---- */
/* 放在 :id 之前注册，免得 "facets" 被当成 id */
examsRouter.get('/exams/facets', requireAuth, async (_req, res) => {
  const [years, regions, paperTypes, qtypes] = await Promise.all([
    prisma.examQuestion.findMany({ distinct: ['year'], select: { year: true }, orderBy: { year: 'desc' } }),
    prisma.examQuestion.findMany({ distinct: ['region'], select: { region: true }, orderBy: { region: 'asc' } }),
    prisma.examQuestion.findMany({ distinct: ['paperType'], select: { paperType: true }, orderBy: { paperType: 'asc' } }),
    prisma.examQuestion.findMany({ distinct: ['qtype'], select: { qtype: true }, orderBy: { qtype: 'asc' } }),
  ]);
  res.json({
    years: years.map((x) => x.year),
    regions: regions.map((x) => x.region),
    paperTypes: paperTypes.map((x) => x.paperType),
    qtypes: qtypes.map((x) => x.qtype),
  });
});

/* ---- 学生端：详情（带答案；解析按权益）---- */
examsRouter.get('/exams/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'id 不对' } });
    return;
  }
  const r = await prisma.examQuestion.findUnique({ where: { id } });
  if (!r) {
    res.status(404).json({ error: { code: 'NO_EXAM', message: '没有这道题' } });
    return;
  }
  /* 题解是另一项服务：判分和正确答案是免费的，分步思路是会员的。
     和 practice.routes 同一套口径 —— 两边用的是同一份权益点。 */
  const withSolution = await canUse(req.user!.id, 'member_solution');
  const base = await toListItem(r);
  res.json({
    ...base,
    options: parseOptions(r.options),
    blanks: parseBlanks(r.blanks),
    answer: r.answer,
    explanation: withSolution ? r.explanation : null,
    hasSolution: withSolution,
  });
});

/* ==========================================================================
   管理端
   ========================================================================== */
export const examsAdminRouter = Router();

/* ---- 列表 ---- */
examsAdminRouter.get('/admin/exams', requireAuth, requirePerm('exam.read'), async (req, res) => {
  const q = req.query;
  const where = {
    ...(typeof q.year === 'string' && q.year ? { year: Number(q.year) } : {}),
    ...(typeof q.region === 'string' && q.region ? { region: q.region } : {}),
    ...(typeof q.paperType === 'string' && q.paperType ? { paperType: q.paperType } : {}),
    ...(typeof q.qtype === 'string' && q.qtype ? { qtype: q.qtype } : {}),
    ...(typeof q.kind === 'string' && q.kind ? { kind: q.kind } : {}),
    ...(typeof q.difficulty === 'string' && q.difficulty ? { difficulty: Number(q.difficulty) } : {}),
    ...(typeof q.nodeId === 'string' && q.nodeId ? { nodeId: Number(q.nodeId) } : {}),
    ...(typeof q.q === 'string' && q.q ? { OR: [
      { code: { contains: q.q } },
      { stem: { contains: q.q } },
      { region: { contains: q.q } },
      { source: { contains: q.q } },
    ] } : {}),
  };
  const rows = await prisma.examQuestion.findMany({
    where,
    orderBy: [{ year: 'desc' }, { id: 'desc' }],
    take: 500,
  });
  const names = await nameMap(rows.map((r) => r.nodeId).filter((x): x is number => x !== null));
  const items = await Promise.all(rows.map((r) => toListItem(r, names)));
  res.json({ total: items.length, items });
});

/* ---- 详情（管理端，全字段，不带权益判定 —— 管理员录入时该能看自己写的解析）---- */
examsAdminRouter.get('/admin/exams/:id', requireAuth, requirePerm('exam.read'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'id 不对' } });
    return;
  }
  const r = await prisma.examQuestion.findUnique({ where: { id } });
  if (!r) {
    res.status(404).json({ error: { code: 'NO_EXAM', message: '没有这道题' } });
    return;
  }
  const base = await toListItem(r);
  res.json({
    ...base,
    options: parseOptions(r.options),
    blanks: parseBlanks(r.blanks),
    answer: r.answer,
    explanation: r.explanation,
    hasSolution: true,
  });
});

/* ---- 录入 ---- */
examsAdminRouter.post('/admin/exams', requireAuth, requirePerm('exam.write'), async (req, res) => {
  const parsed = ExamIn.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '入参不对' } });
    return;
  }
  const d = parsed.data;

  /* 校验 kind 与配套字段：
     · choice 必须有 options 与 answer
     · blank 必须有 blanks 与 answer
     · board 不要 options / blanks / answer */
  if (d.kind === 'choice' && (!d.options || !d.options.length || !d.answer)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '选择题必须有 options 和 answer' } });
    return;
  }
  if (d.kind === 'blank' && (!d.blanks || !d.blanks.length || !d.answer)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '填空题必须有 blanks 和 answer' } });
    return;
  }
  if (d.kind === 'board' && (d.options || d.blanks || d.answer)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '白板题不要 options / blanks / answer' } });
    return;
  }

  /* code 不填就先用一个临时唯一值（时间戳+随机），create 完用 id 回填 ——
     因为 code 是 unique，固定写 "exam-0" 第二次就插不进去 */
  const tempCode = d.code ?? `exam-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await prisma.examQuestion.create({
    data: {
      kind: d.kind,
      code: tempCode,
      stem: d.stem,
      options: d.options ? JSON.stringify(d.options) : null,
      blanks: d.blanks ? JSON.stringify(d.blanks) : null,
      answer: d.answer ?? null,
      explanation: d.explanation ?? null,
      year: d.year,
      region: d.region,
      paperType: d.paperType,
      qtype: d.qtype,
      difficulty: d.difficulty,
      no: d.no ?? null,
      nodeId: d.nodeId ?? null,
      source: d.source ?? null,
      creatorId: req.user!.id,
    },
  });

  /* code 没填就用 id 拼 —— 这样不依赖前端给一个，且保证 unique */
  if (!d.code) {
    await prisma.examQuestion.update({ where: { id: created.id }, data: { code: `exam-${created.id}` } });
    created.code = `exam-${created.id}`;
  }

  const full = await prisma.examQuestion.findUnique({ where: { id: created.id } });
  res.status(201).json(await toListItem(full!));
});

/* ---- 改 ---- */
examsAdminRouter.patch('/admin/exams/:id', requireAuth, requirePerm('exam.write'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'id 不对' } });
    return;
  }
  const parsed = ExamIn.partial().safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '入参不对' } });
    return;
  }
  const d = parsed.data;

  const exists = await prisma.examQuestion.findUnique({ where: { id } });
  if (!exists) {
    res.status(404).json({ error: { code: 'NO_EXAM', message: '没有这道题' } });
    return;
  }

  const data: Record<string, unknown> = {};
  if (d.kind !== undefined) { data.kind = d.kind; }
  if (d.code !== undefined) { data.code = d.code; }
  if (d.stem !== undefined) { data.stem = d.stem; }
  if (d.options !== undefined) { data.options = d.options ? JSON.stringify(d.options) : null; }
  if (d.blanks !== undefined) { data.blanks = d.blanks ? JSON.stringify(d.blanks) : null; }
  if (d.answer !== undefined) { data.answer = d.answer ?? null; }
  if (d.explanation !== undefined) { data.explanation = d.explanation ?? null; }
  if (d.year !== undefined) { data.year = d.year; }
  if (d.region !== undefined) { data.region = d.region; }
  if (d.paperType !== undefined) { data.paperType = d.paperType; }
  if (d.qtype !== undefined) { data.qtype = d.qtype; }
  if (d.difficulty !== undefined) { data.difficulty = d.difficulty; }
  if (d.no !== undefined) { data.no = d.no ?? null; }
  if (d.nodeId !== undefined) { data.nodeId = d.nodeId ?? null; }
  if (d.source !== undefined) { data.source = d.source ?? null; }

  if (Object.keys(data).length === 0) {
    res.json(await toListItem(exists));
    return;
  }

  const updated = await prisma.examQuestion.update({ where: { id }, data });
  res.json(await toListItem(updated));
});

/* ---- 删 ---- */
examsAdminRouter.delete('/admin/exams/:id', requireAuth, requirePerm('exam.write'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'id 不对' } });
    return;
  }
  const exists = await prisma.examQuestion.findUnique({ where: { id } });
  if (!exists) {
    res.status(404).json({ error: { code: 'NO_EXAM', message: '没有这道题' } });
    return;
  }
  await prisma.examQuestion.delete({ where: { id } });
  res.status(204).end();
});
