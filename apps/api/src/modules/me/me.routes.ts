/* ==========================================================================
   /api/me/* 与 /api/learning/demo —— 学习数据出口
   --------------------------------------------------------------------------
   **出参形状就是前端原来那几个 js 的形状**（assets/js/timeline-data.js 的输出）：
   `records` 是按**轴下标**排好的一整条数组，每条自带 factors / cards / marks / events。
   这么设计只有一个目的：视图层（2D 轴 / 3D 轴 / 个人中心）一个字都不用改。

   为什么整条吐而不是分页：轴是这个产品的**主视图**，一屏就是几百格，
   分页等于把"一眼看出一段学得好不好"这件事拆掉。所以一次给全，客户端自己按视窗裁。

   `?version=` 与 `/api/tree` 同一套路：带上上次那版的哈希，没变就回 304。
   ========================================================================== */
import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../../openapi.js';
import { prisma } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { quotaOf } from '../../middleware/perk.js';
import { computeAxis, type AxisResult } from '../tree/axis.service.js';

/* ---------------- 出参形状 ---------------- */

const EventOut = z.object({
  at: z.number(), kind: z.string(), mastery: z.number(),
  exam: z.string().optional(), score: z.number().optional(), full: z.number().optional(),
  from: z.number().optional(), to: z.number().optional(),
});

const CardOut = z.object({
  no: z.number(), type: z.string(), diff: z.number(),
  acc: z.number(), status: z.string(), weight: z.number(), at: z.string(),
});

const RecordOut = z.object({
  /* 位置不在这里：数组下标就是轴上的位置（现算的，见 tree/axis.service.ts） */
  nodeId: z.number(),
  mastery: z.number(), status: z.string(),
  learnedAt: z.string(), reviewAt: z.string(), plannedAt: z.string(),
  diff: z.number(), term: z.string(),
  factors: z.record(z.string(), z.number()).nullable(),
  cards: z.array(CardOut),
  marks: z.array(z.string()),
  blocked: z.boolean(),
  events: z.array(EventOut),
});

const PaperOut = z.object({
  index: z.number(), full: z.number(), score: z.number(), card: z.number(),
  also: z.array(z.number()), causes: z.array(z.record(z.string(), z.unknown())),
});

const ExamOut = z.object({
  id: z.string(), name: z.string(), at: z.number(), date: z.string(),
  from: z.number(), to: z.number(), scope: z.string(), paper: z.array(PaperOut),
});

const LearningOut = z.object({
  viewer: z.string().describe('这一份是谁的'),
  mine: z.boolean().describe('true = 当前登录的人自己的；false = 演示学生'),
  version: z.string().describe('内容哈希，客户端拿它做协商缓存'),
  today: z.string(),
  records: z.array(RecordOut),
  exams: z.array(ExamOut),
});

const MistakeOut = z.object({
  id: z.number(),
  source: z.string().describe('exam = 考试卷面上错的；practice = 练习里错的'),
  examCode: z.string().nullable(), examName: z.string(), date: z.string(),
  nodeId: z.number().nullable(), nodeName: z.string(), path: z.array(z.string()),
  cellIndex: z.number().nullable().describe('这道错题落在轴上第几格（0 起）；练习错题没有'),
  score: z.number().nullable(), full: z.number().nullable(), cardNo: z.number().nullable(),
  causes: z.array(z.record(z.string(), z.unknown())), status: z.string(),
});

const ProfileOut = z.object({
  user: z.object({
    id: z.number(), username: z.string(), nickname: z.string(),
    grade: z.string().nullable(), role: z.string(),
  }),
  stats: z.record(z.string(), z.number()),
  todayAt: z.string().nullable(),
  stages: z.array(z.object({
    stage: z.string(), name: z.string(), learned: z.number(), total: z.number(), avg: z.number(),
  })),
  books: z.array(z.object({
    id: z.number(), name: z.string(), chapters: z.number(),
    learned: z.number(), total: z.number(), pct: z.number(), avg: z.number(),
  })),
  recent: z.array(z.object({
    at: z.number(), date: z.string(), kind: z.string(),
    nodeName: z.string(), mastery: z.number(), exam: z.string().optional(),
  })),
});

registry.registerPath({
  method: 'get', path: '/api/learning/demo', summary: '演示学生那一份学习数据（免登录）',
  responses: { 200: { description: '学习数据', content: { 'application/json': { schema: LearningOut } } } },
});
registry.registerPath({
  method: 'get', path: '/api/me/learning', summary: '我的学习数据',
  responses: {
    200: { description: '学习数据', content: { 'application/json': { schema: LearningOut } } },
    401: { description: '未登录' },
  },
});
registry.registerPath({
  method: 'get', path: '/api/me/profile', summary: '个人中心的统计与最近动态',
  responses: { 200: { description: '概览', content: { 'application/json': { schema: ProfileOut } } }, 401: { description: '未登录' } },
});
registry.registerPath({
  method: 'get', path: '/api/me/mistakes', summary: '我的错题本',
  responses: { 200: { description: '错题', content: { 'application/json': { schema: z.object({ total: z.number(), items: z.array(MistakeOut) }) } } }, 401: { description: '未登录' } },
});
registry.registerPath({
  method: 'get', path: '/api/me/favorites', summary: '我的收藏夹',
  responses: { 200: { description: '收藏' } },
});
registry.registerPath({
  method: 'get', path: '/api/me/notes', summary: '我的笔记',
  responses: { 200: { description: '笔记' } },
});

/* ---------------- 共用小工具 ---------------- */

const STAGE_CN: Record<string, string> = { primary: '小学', junior: '初中', senior: '高中', olympiad: '竞赛' };

/** 全站节点表（1391 行）：拿来拼路径、拿名字。每次请求读一遍，比逐条查父节点便宜得多。 */
async function nodeIndex(): Promise<{
  nameOf: Map<number, string>;
  parentOf: Map<number, number | null>;
  stageOf: Map<number, string | null>;
}> {
  const rows = await prisma.node.findMany({ select: { id: true, name: true, parentId: true, stage: true } });
  const nameOf = new Map<number, string>();
  const parentOf = new Map<number, number | null>();
  const stageOf = new Map<number, string | null>();
  rows.forEach((n) => { nameOf.set(n.id, n.name); parentOf.set(n.id, n.parentId); stageOf.set(n.id, n.stage); });
  return { nameOf, parentOf, stageOf };
}

function pathOf(nodeId: number, idx: { nameOf: Map<number, string>; parentOf: Map<number, number | null> }): string[] {
  const out: string[] = [];
  let cur: number | null | undefined = nodeId;
  let guard = 0;
  while (cur !== null && cur !== undefined && guard < 32) {
    const name = idx.nameOf.get(cur);
    if (name === undefined) { break; }
    out.unshift(name);
    cur = idx.parentOf.get(cur) ?? null;
    guard += 1;
  }
  return out;
}

function num(v: bigint): number { return Number(v); }

/* ---------------- 一个学生的整份学习数据 ---------------- */

type RawRecord = {
  id: number; nodeId: number; mastery: number; status: string;
  learnedAt: string | null; reviewAt: string | null; plannedAt: string | null;
  diff: number | null; term: string | null; factors: string | null; cards: string | null;
  blocked: boolean;
  marks: { mark: string }[];
  events: {
    at: bigint; kind: string; mastery: number;
    examCode: string | null; score: number | null; full: number | null;
    fromVal: number | null; toVal: number | null;
  }[];
};

type RawExam = {
  code: string; name: string; at: bigint; date: string; fromIdx: number; toIdx: number; scope: string;
  papers: {
    index: number; nodeId: number | null; full: number; score: number; card: number;
    also: string | null; causes: string | null;
  }[];
};

function json<T>(raw: string | null, fallback: T): T {
  if (!raw) { return fallback; }
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function toRecord(r: RawRecord) {
  return {
    nodeId: r.nodeId,
    mastery: r.mastery,
    status: r.status,
    learnedAt: r.learnedAt ?? '',
    reviewAt: r.reviewAt ?? '',
    plannedAt: r.plannedAt ?? '',
    diff: r.diff ?? 1,
    term: r.term ?? '',
    factors: json<Record<string, number> | null>(r.factors, null),
    cards: json<{ no: number; type: string; diff: number; acc: number; status: string; weight: number; at: string }[]>(r.cards, []),
    marks: r.marks.map((m) => m.mark),
    blocked: r.blocked,
    events: r.events.map((e) => {
      const out: Record<string, unknown> = { at: num(e.at), kind: e.kind, mastery: e.mastery };
      if (e.examCode) { out.exam = e.examCode; }
      if (e.score !== null) { out.score = e.score; }
      if (e.full !== null) { out.full = e.full; }
      if (e.fromVal !== null) { out.from = e.fromVal; }
      if (e.toVal !== null) { out.to = e.toVal; }
      return out;
    }),
  };
}

function toExam(e: RawExam, axis: AxisResult) {
  /* 卷面题的"第几格"**不存死数**：题上记的是 nodeId，这里映射到当前的轴。
     后台把某章挪个位置，卷面的位置跟着走，不会指到隔壁题上。
     节点被删掉的那种题（nodeId 已不在轴上）就丢掉 —— 它已经没有地方可画了。 */
  const paper = e.papers
    .map((p) => {
      const at = p.nodeId === null ? undefined : axis.at.get(p.nodeId);
      return at === undefined ? null : {
        index: at, full: p.full, score: p.score, card: p.card,
        also: json<number[]>(p.also, []),
        causes: json<Record<string, unknown>[]>(p.causes, []),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.index - b.index);

  const indices = paper.map((x) => x.index);
  return {
    id: e.code,
    name: e.name,
    at: num(e.at),
    date: e.date,
    /* 覆盖范围也现算：这一场考的是轴上哪一段，以它卷面上实际还有的题为准 */
    from: indices.length ? Math.min(...indices) : 0,
    to: indices.length ? Math.max(...indices) + 1 : 0,
    scope: e.scope,
    paper,
  };
}

/** 没学过的那一格长什么样 —— 与前端本机生成那份的"未开始"形状一致 */
function blankRecord(nodeId: number) {
  return {
    nodeId,
    mastery: 0,
    status: '未开始',
    learnedAt: '',
    reviewAt: '',
    plannedAt: '',
    diff: 1,
    term: '',
    factors: null,
    cards: [],
    marks: [] as string[],
    blocked: false,
    events: [] as ReturnType<typeof toRecord>['events'],
  };
}

async function loadLearning(userId: number, viewer: string, mine: boolean) {
  const [profile, axis, records, exams] = await Promise.all([
    prisma.learningProfile.findUnique({ where: { userId } }),
    computeAxis(),
    prisma.learningRecord.findMany({
      where: { userId },
      include: { marks: { select: { mark: true } }, events: { orderBy: { at: 'asc' } } },
    }) as unknown as Promise<RawRecord[]>,
    prisma.exam.findMany({
      where: { userId },
      orderBy: { at: 'asc' },
      include: { papers: { orderBy: { index: 'asc' } } },
    }) as unknown as Promise<RawExam[]>,
  ]);

  /* **按当前轴顺序摆成一条稠密数组**：第 i 个元素就是轴上第 i 格。
     视图是按下标索引它的（考试卷面的 index 也是下标），所以这里必须一位不差。
     学生没学过、或者新加了节点还没记录的格子，补一个"未开始"占位 ——
     不补的话数组会短一截，后面每一格都会错位，而且错得很隐蔽。 */
  const dense: ReturnType<typeof toRecord>[] = axis.order.map((nodeId) => blankRecord(nodeId));
  let placed = 0;
  for (const r of records) {
    const at = axis.at.get(r.nodeId);
    if (at === undefined) { continue; }   /* 这一格已经不在轴上了（节点被删/移出轴） */
    dense[at] = toRecord(r);
    placed += 1;
  }

  const payload = {
    viewer,
    mine,
    today: profile?.todayAt ?? '2026-06-30',
    records: dense,
    exams: exams.map((e) => toExam(e, axis)),
    /* 对数用：轴上有几格、其中几格有记录。前端不看这两个字段。 */
    axisItems: axis.order.length,
    recordsPlaced: placed,
  };
  const version = createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
  return { version, ...payload };
}

/* ---------------- 路由 ---------------- */

export const meRouter = Router();

/** 演示学生是谁：用户名写死 `student`（见 seed/auth.ts 的 DEMO_ACCOUNTS） */
const DEMO_USERNAME = 'student';

meRouter.get('/learning/demo', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { username: DEMO_USERNAME } });
  if (!user) { res.status(503).json({ error: { code: 'NO_DEMO', message: '还没有演示学生，先跑一次 npm run db:seed' } }); return; }

  const data = await loadLearning(user.id, user.nickname, false);
  const q = typeof req.query.version === 'string' ? req.query.version : '';
  res.setHeader('ETag', `"${data.version}"`);
  if (q !== '' && q === data.version) { res.status(304).end(); return; }
  res.json(data);
});

meRouter.get('/me/learning', requireAuth, async (req, res) => {
  const me = req.user!;
  const data = await loadLearning(me.id, me.nickname, true);
  const q = typeof req.query.version === 'string' ? req.query.version : '';
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('ETag', `"${data.version}"`);
  if (q !== '' && q === data.version) { res.status(304).end(); return; }
  res.json(data);
});

meRouter.get('/me/profile', requireAuth, async (req, res) => {
  const me = req.user!;
  const idx = await nodeIndex();

  const [records, counts, profile, recentEvents] = await Promise.all([
    prisma.learningRecord.findMany({
      where: { userId: me.id },
      select: { nodeId: true, mastery: true, status: true, cards: true, blocked: true },
    }),
    Promise.all([
      prisma.learningEvent.count({ where: { record: { userId: me.id } } }),
      prisma.exam.count({ where: { userId: me.id } }),
      prisma.examPaper.count({ where: { exam: { userId: me.id } } }),
      prisma.mistake.count({ where: { userId: me.id } }),
      prisma.mistake.count({ where: { userId: me.id, status: 'open' } }),
      prisma.pointMark.count({ where: { userId: me.id } }),
      prisma.favorite.count({ where: { userId: me.id } }),
      prisma.note.count({ where: { userId: me.id } }),
    ]),
    prisma.learningProfile.findUnique({ where: { userId: me.id } }),
    prisma.learningEvent.findMany({
      where: { record: { userId: me.id } },
      orderBy: { at: 'desc' },
      take: 12,
      include: { record: { select: { nodeId: true, mastery: true } } },
    }),
  ]);

  const learned = records.filter((r) => r.mastery > 0).length;
  const mastered = records.filter((r) => r.status === '已掌握' || r.status === '精通').length;
  const masteryAvg = learned
    ? Math.round(records.reduce((a, r) => a + r.mastery, 0) / learned)
    : 0;
  const cardCount = records.reduce((a, r) => a + json<unknown[]>(r.cards, []).length, 0);

  /* 按学段汇总：知识轴本来就是"小学→初中→高中→竞赛"一条线，
     一格一格看不如一段一段看。
     注意 stage 只写在 `book` / `track` 上，轴上的格子是 point / section / chapter，
     所以要**顺着父链往上找**第一个带 stage 的祖先 —— 直接读节点自己的 stage 会是空的。 */
  const stageOfDeep = new Map<number, string>();
  function stageUp(nodeId: number): string {
    const cached = stageOfDeep.get(nodeId);
    if (cached !== undefined) { return cached; }
    let cur: number | null | undefined = nodeId;
    let guard = 0;
    let found = '';
    while (cur !== null && cur !== undefined && guard < 32) {
      const st = idx.stageOf.get(cur);
      if (st) { found = st; break; }
      cur = idx.parentOf.get(cur) ?? null;
      guard += 1;
    }
    stageOfDeep.set(nodeId, found);
    return found;
  }

  const byStage = new Map<string, { total: number; learned: number; sum: number }>();
  records.forEach((r) => {
    const st = stageUp(r.nodeId);
    const cur = byStage.get(st) ?? { total: 0, learned: 0, sum: 0 };
    cur.total += 1;
    if (r.mastery > 0) { cur.learned += 1; cur.sum += r.mastery; }
    byStage.set(st, cur);
  });
  const order = ['primary', 'junior', 'senior', 'olympiad'];
  const stages = order
    .filter((s) => byStage.has(s))
    .map((s) => {
      const v = byStage.get(s)!;
      return {
        stage: s,
        name: STAGE_CN[s] ?? s,
        learned: v.learned,
        total: v.total,
        avg: v.learned ? Math.round(v.sum / v.learned) : 0,
      };
    });

  /* 按**册**汇总（学习进度页那几根条就是它）。
     一个格子的"册"要顺着父链往上找 `kind = 'book'` 的祖先 —— 和 stage 一样不在格子自己身上。
     章数 = 这一册下**真的落了格子**的章有几个（不是教材目录里的章数）。 */
  const kindOf = new Map<number, string>();
  {
    const kinds = await prisma.node.findMany({ select: { id: true, kind: true } });
    kinds.forEach((n) => kindOf.set(n.id, n.kind));
  }
  function upTo(nodeId: number, want: string): number | null {
    let cur: number | null | undefined = nodeId;
    let guard = 0;
    while (cur !== null && cur !== undefined && guard < 32) {
      if (kindOf.get(cur) === want) { return cur; }
      cur = idx.parentOf.get(cur) ?? null;
      guard += 1;
    }
    return null;
  }

  const bookAgg = new Map<number, { learned: number; total: number; sum: number; chapters: Set<number> }>();
  records.forEach((r) => {
    const bookId = upTo(r.nodeId, 'book');
    if (bookId === null) { return; }
    const cur = bookAgg.get(bookId) ?? { learned: 0, total: 0, sum: 0, chapters: new Set<number>() };
    cur.total += 1;
    if (r.mastery > 0) { cur.learned += 1; cur.sum += r.mastery; }
    const chId = upTo(r.nodeId, 'chapter');
    if (chId !== null) { cur.chapters.add(chId); }
    bookAgg.set(bookId, cur);
  });

  const books = [...bookAgg.entries()]
    .map(([id, v]) => ({
      id,
      name: idx.nameOf.get(id) ?? '',
      chapters: v.chapters.size,
      learned: v.learned,
      total: v.total,
      pct: v.total ? Math.round((v.learned / v.total) * 100) : 0,
      avg: v.learned ? Math.round(v.sum / v.learned) : 0,
    }))
    .sort((a, b) => b.pct - a.pct || a.id - b.id);

  const [events, exams, papers, mistakes, mistakesOpen, marks, favorites, notes] = counts;

  res.json({
    user: { id: me.id, username: me.username, nickname: me.nickname, grade: me.grade, role: me.roleCode },
    stats: {
      records: records.length,
      learned,
      mastered,
      masteryAvg,
      cards: cardCount,
      events,
      exams,
      papers,
      mistakes,
      mistakesOpen,
      marks,
      favorites,
      notes,
      blocked: records.filter((r) => r.blocked).length,
    },
    todayAt: profile?.todayAt ?? null,
    stages,
    books,
    recent: recentEvents.map((e) => {
      const out: Record<string, unknown> = {
        at: num(e.at),
        date: new Date(num(e.at)).toISOString().slice(0, 10),
        kind: e.kind,
        nodeName: idx.nameOf.get(e.record.nodeId) ?? '',
        mastery: e.record.mastery,
      };
      if (e.examCode) { out.exam = e.examCode; }
      return out;
    }),
  });
});

meRouter.get('/me/mistakes', requireAuth, async (req, res) => {
  const me = req.user!;
  const idx = await nodeIndex();
  const axis = await computeAxis();
  const examNames = new Map(
    (await prisma.exam.findMany({ where: { userId: me.id }, select: { code: true, name: true } }))
      .map((e) => [e.code, e.name]),
  );

  const rows = await prisma.mistake.findMany({ where: { userId: me.id }, orderBy: { at: 'desc' } });

  /* 容量一并回给前台：错题本那页要写"已用 37 / 上限 50"，
     到顶时还要能说清"再攒需要开通会员"。用的是和归档**同一个** quotaOf ——
     显示和实际执行各算各的，迟早会不一样 */
  const cap = await quotaOf(me.id, 'mistake_capacity');

  res.json({
    total: rows.length,
    /* null = 不限；数字 = 上限（0 表示这个套餐压根没有错题本这一项） */
    quota: cap === undefined ? 0 : cap,
    items: rows.map((m) => ({
      id: m.id,
      source: m.source,
      examCode: m.examCode,
      examName: m.examCode === null ? '' : (examNames.get(m.examCode) ?? m.examCode),
      date: new Date(num(m.at)).toISOString().slice(0, 10),
      nodeId: m.nodeId,
      /* 名字优先取**快照**：知识点被删掉之后，错题本上照样要显示当时考的是哪个点 */
      nodeName: m.nodeName || (m.nodeId === null ? '' : (idx.nameOf.get(m.nodeId) ?? '')),
      path: m.nodeId === null ? [] : pathOf(m.nodeId, idx),
      /* 轴上第几格现算 —— 树改过之后这个数会变，卷面位置也跟着走 */
      cellIndex: m.nodeId === null ? m.cellIndex : (axis.at.get(m.nodeId) ?? m.cellIndex),
      score: m.score,
      full: m.full,
      cardNo: m.cardNo,
      causes: json<Record<string, unknown>[]>(m.causes, []),
      status: m.status,
    })),
  });
});

meRouter.get('/me/favorites', requireAuth, async (req, res) => {
  const me = req.user!;
  const rows = await prisma.favorite.findMany({ where: { userId: me.id }, orderBy: { createdAt: 'desc' } });
  res.json({
    total: rows.length,
    items: rows.map((f) => ({
      id: f.id, kind: f.kind, refId: f.refId, title: f.title, sub: f.sub,
      createdAt: f.createdAt.toISOString(),
    })),
  });
});

meRouter.get('/me/notes', requireAuth, async (req, res) => {
  const me = req.user!;
  const idx = await nodeIndex();
  const rows = await prisma.note.findMany({ where: { userId: me.id }, orderBy: { updatedAt: 'desc' } });
  res.json({
    total: rows.length,
    items: rows.map((n) => ({
      id: n.id,
      nodeId: n.nodeId,
      nodeName: n.nodeId === null ? '' : (idx.nameOf.get(n.nodeId) ?? ''),
      title: n.title,
      body: n.body,
      updatedAt: n.updatedAt.toISOString(),
    })),
  });
});
