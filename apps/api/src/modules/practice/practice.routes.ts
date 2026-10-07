/* ==========================================================================
   /api/practice/* —— 题库与做题
   --------------------------------------------------------------------------
   **题库是要登录的**（用户 2026-10-05 的原话："真题可以一直看，方法也是公共的…
   但是要用题库那时候，我就需要登录了"）。所以这一支全部挂 `requireAuth`。

   两条不能破的规矩：
     1. **取题时不带答案。** 带了就等于把答案连同链接一起发给浏览器，
        判分也就成了前端说了算 —— 前端说了不算（设计稿 §3.6）。
     2. **一个会话只能交一次。** 重复提交会把错题本刷成一堆重复条目。
     3. **判不了分的题不判错。** 白板题（kind=board）只有题面、没有答案 ——
        把它们当错会让学生背一件系统自己说做不到的事。它们记「做了」但不进判分，
        所以正确率的分母是 `judged`（判得了分的题数），不是 `total`。
   ========================================================================== */
import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../../openapi.js';
import { prisma } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePerk, canUse, quotaOf } from '../../middleware/perk.js';

/* 题库里现在有两类题：
     · 判得了分的（choice / blank，有 answer）—— 参与判分与正确率
     · 白板题（board，只有题面）—— 学生能真做完，但系统判不了分，
       所以它记「做了」，不参与判分（PracticeSession.judged 那一列就是为它加的） */
const QuestionOut = z.object({
  id: z.number(), kind: z.string(), code: z.string(), tag: z.string().nullable(),
  stem: z.string(),
  options: z.array(z.object({ key: z.string(), text: z.string() })),
  blanks: z.array(z.object({ label: z.string() })),
  order: z.number(),
});

const SessionIn = z.object({
  count: z.number().int().min(1).max(20).optional().describe('抽几道，默认全抽'),
});
const SessionOut = z.object({
  sessionId: z.number(),
  total: z.number(),
  questions: z.array(QuestionOut),
});

const SubmitIn = z.object({
  answers: z.array(z.object({
    questionId: z.number(),
    given: z.string().max(191),
  })),
});
const SubmitOut = z.object({
  sessionId: z.number(),
  total: z.number().describe('这次真做了几道（跳过的白板题不算）'),
  judged: z.number().describe('其中判得了分的几道 —— 正确率的分母是它，不是 total'),
  correct: z.number(),
  score: z.number().nullable().describe('百分制得分；一道都判不了分时是 null（不是 0）'),
  details: z.array(z.object({
    questionId: z.number(), code: z.string(), stem: z.string(),
    given: z.string(), answer: z.string(),
    correct: z.boolean().nullable().describe('白板题判不了分，所以是 null'),
    judged: z.boolean(),
    explanation: z.string().nullable(),
  })),
});

const ResultOut = z.object({
  id: z.number(),
  total: z.number(), judged: z.number(), correct: z.number(),
  score: z.number().nullable(),
  submittedAt: z.string(), createdAt: z.string(),
  hasSolution: z.boolean(),
  details: z.array(z.object({
    questionId: z.number(), code: z.string(), kind: z.string(), tag: z.string().nullable(),
    stem: z.string(), given: z.string().nullable(), answer: z.string().nullable(),
    correct: z.boolean().nullable(), judged: z.boolean(), explanation: z.string().nullable(),
  })),
});

registry.registerPath({
  method: 'get', path: '/api/practice/questions', summary: '题库（需登录，不带答案）',
  responses: { 200: { description: '题目' }, 401: { description: '未登录' } },
});
registry.registerPath({
  method: 'get', path: '/api/practice/sessions/{id}', summary: '一次已提交练习的结果（需登录）',
  responses: {
    200: { description: '逐题结果', content: { 'application/json': { schema: ResultOut } } },
    400: { description: '这次练习还没交' },
    404: { description: '没有这次练习' },
  },
});
registry.registerPath({
  method: 'post', path: '/api/practice/sessions', summary: '开始一次练习（需登录）',
  request: { body: { content: { 'application/json': { schema: SessionIn } } } },
  responses: { 201: { description: '会话与题目', content: { 'application/json': { schema: SessionOut } } }, 401: { description: '未登录' } },
});
registry.registerPath({
  method: 'post', path: '/api/practice/sessions/{id}/submit', summary: '提交判分（需登录）',
  request: { body: { content: { 'application/json': { schema: SubmitIn } } } },
  responses: {
    200: { description: '逐题结果', content: { 'application/json': { schema: SubmitOut } } },
    400: { description: '这个会话交过了' },
    404: { description: '没有这个会话' },
  },
});
registry.registerPath({
  method: 'get', path: '/api/practice/sessions', summary: '我的练习记录（需登录）',
  responses: { 200: { description: '记录' }, 401: { description: '未登录' } },
});

export const practiceRouter = Router();

function parseOptions(raw: string | null): { key: string; text: string }[] {
  if (!raw) { return []; }
  try { return JSON.parse(raw) as { key: string; text: string }[]; } catch { return []; }
}

function parseBlanks(raw: string | null): { label: string }[] {
  if (!raw) { return []; }
  try {
    return (JSON.parse(raw) as { label: string }[]).map((b) => ({ label: b.label }));
  } catch { return []; }
}

/** 判分：单选比字符串；填空按 `|` 拆开、逐个 trim 后比（顺序要对上）。 */
function judge(kind: string, answer: string | null, given: string): boolean {
  if (!answer) { return false; }
  const a = given.trim();
  if (kind === 'blank') {
    const want = answer.split('|').map((s) => s.trim());
    const got = a.split('|').map((s) => s.trim());
    if (want.length !== got.length) { return false; }
    return want.every((w, i) => w === got[i]);
  }
  return a.toUpperCase() === answer.trim().toUpperCase();
}

/** 判得了分的题：有答案、且不是白板题（白板题按定义 answer 就是 null）。 */
function isJudgeable(q: { kind: string; answer: string | null }): boolean {
  return q.kind !== 'board' && !!q.answer;
}

/** Fisher–Yates。白板题要是每次都固定取最前面那几道，后面五十来道等于没进题库。 */
function shuffle<T>(rows: T[]): T[] {
  const out = rows.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = out[i]!;
    out[i] = out[j]!;
    out[j] = t;
  }
  return out;
}

/* 题库是"一项服务"：后台把 question_bank 从某个套餐上取消，这里立刻 403。
   判定在服务端 —— 前端把那一页藏起来不算权限（设计稿 §3.6）。 */
practiceRouter.get('/practice/questions', requireAuth, requirePerk('question_bank'), async (_req, res) => {
  /* 白板题也在题库里 —— 它们有真题面，只是判不了分（见下面提交那一段） */
  const rows = await prisma.question.findMany({ orderBy: { order: 'asc' } });
  res.json({
    total: rows.length,
    items: rows.map((q) => ({
      id: q.id, kind: q.kind, code: q.code, tag: q.tag, stem: q.stem,
      options: parseOptions(q.options), blanks: parseBlanks(q.blanks), order: q.order,
    })),
  });
});

practiceRouter.post('/practice/sessions', requireAuth, requirePerk('question_bank'), async (req, res) => {
  const parsed = SessionIn.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'count 要是 1~20 的整数' } });
    return;
  }

  const pool = await prisma.question.findMany({ orderBy: { order: 'asc' } });
  if (!pool.length) {
    res.status(503).json({ error: { code: 'NO_QUESTION', message: '题库还是空的，先跑一次 npm run db:seed' } });
    return;
  }

  /* 抽题：**先把判得了分的都取上**（判分与正确率是这一支的主业），再用白板题补足。
     白板题只有题面、判不了分，但题面是真的 —— 学生能在白板上真做完，
     记一笔「做了」进习题量，只是不参与判分。 */
  const take = Math.min(parsed.data.count ?? pool.length, pool.length);
  const judgeable = pool.filter(isJudgeable);
  const board = shuffle(pool.filter((q) => !isJudgeable(q)));
  const picked = [
    ...judgeable.slice(0, take),
    ...board.slice(0, Math.max(0, take - judgeable.length)),
  ];

  const session = await prisma.practiceSession.create({
    data: {
      userId: req.user!.id,
      total: picked.length,
      answers: {
        create: picked.map((q, i) => ({ questionId: q.id, order: i })),
      },
    },
  });

  res.status(201).json({
    sessionId: session.id,
    total: picked.length,
    questions: picked.map((q) => ({
      id: q.id, kind: q.kind, code: q.code, tag: q.tag, stem: q.stem,
      options: parseOptions(q.options), blanks: parseBlanks(q.blanks), order: q.order,
    })),
  });
});

practiceRouter.post('/practice/sessions/:id/submit', requireAuth, requirePerk('question_bank'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '会话 id 不对' } });
    return;
  }
  const parsed = SubmitIn.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'answers 形状不对' } });
    return;
  }

  const session = await prisma.practiceSession.findFirst({
    where: { id, userId: req.user!.id },
    include: { answers: { include: { question: true }, orderBy: { order: 'asc' } } },
  });
  if (!session) {
    res.status(404).json({ error: { code: 'NO_SESSION', message: '没有这次练习' } });
    return;
  }
  /* 交过就不再判 —— 否则点两下"提交"，错题本里同一道题出现两遍 */
  if (session.submittedAt) {
    res.status(400).json({ error: { code: 'ALREADY_SUBMITTED', message: '这次练习已经交过了' } });
    return;
  }

  /* 题解是**另一项**服务：判分和正确答案是免费的，分步思路是会员的。
     不给权益就把 explanation 抹成 null —— 不是"前端藏起来"，是根本不发出去。 */
  const withSolution = await canUse(req.user!.id, 'member_solution');

  const givenOf = new Map(parsed.data.answers.map((a) => [a.questionId, a.given]));

  /* 白板题**做不做都行**。没标记「做完了」的整条撤掉 ——
     这样 total 只算真做了的题；不然点开就跳过也能把「习题量」刷上去。 */
  const skipped = session.answers.filter((a) => !isJudgeable(a.question) && !givenOf.has(a.questionId));
  if (skipped.length) {
    await prisma.practiceAnswer.deleteMany({ where: { id: { in: skipped.map((a) => a.id) } } });
  }
  const skippedIds = new Set(skipped.map((a) => a.id));

  const details: {
    questionId: number; code: string; stem: string;
    given: string; answer: string; correct: boolean | null; explanation: string | null;
    judged: boolean; kind: string;
  }[] = [];

  for (const a of session.answers) {
    if (skippedIds.has(a.id)) { continue; }
    const given = givenOf.get(a.questionId) ?? '';
    const judged = isJudgeable(a.question);
    /* 判不了分的题**不判错**，记 null —— 判成错等于让学生背一件系统自己说做不到的事。 */
    const correct = judged ? judge(a.question.kind, a.question.answer, given) : null;
    await prisma.practiceAnswer.update({
      where: { id: a.id },
      data: { given, correct },
    });
    details.push({
      questionId: a.questionId,
      code: a.question.code,
      stem: a.question.stem,
      given,
      answer: a.question.answer ?? '',
      correct,
      explanation: withSolution ? a.question.explanation : null,
      judged,
      kind: a.question.kind,
    });
  }

  const total = details.length;
  const correctCount = details.filter((d) => d.correct === true).length;
  const judgedCount = details.filter((d) => d.judged).length;
  await prisma.practiceSession.update({
    where: { id: session.id },
    data: { total, correct: correctCount, judged: judgedCount, submittedAt: new Date() },
  });

  /* 错的自动进错题本。
     `source: 'practice'` 与考试错题分开 —— 练习错题没有卷面、没有轴上的格子，
     那几列留空即可（见 schema 里 Mistake 的注释）。

     **错题本有容量**（免费版 50 道，后台能配）。到顶就不再归档。
     这里的取舍：满了就静默丢几条最像 bug，所以把丢了几道**数出来回给前台**，
     让它明说"有 3 道没归档进去，因为错题本满了" —— 学生不会莫名其妙少几条。 */
  /* 只有真判错的进错题本；白板题是 null，不算错也不进本子 */
  const wrongOnes = details.filter((d) => d.correct === false);
  /* 三层含义分清楚：undefined = 这个套餐压根没有错题本这一项（归档 0 条）；
     null = 不限；数字 = 上限就是它 */
  const cap = await quotaOf(req.user!.id, 'mistake_capacity');
  const unlimited = cap === null;
  /* 只有 cap 是个数时才当上限；undefined（没这一项）按 0 算 —— 见上面那三层含义 */
  const limit = typeof cap === 'number' ? cap : 0;

  let archived = 0;
  let dropped = 0;

  if (wrongOnes.length) {
    const used = await prisma.mistake.count({ where: { userId: req.user!.id } });
    const room = unlimited ? wrongOnes.length : Math.max(0, limit - used);
    const take = wrongOnes.slice(0, room);
    archived = take.length;
    dropped = wrongOnes.length - take.length;

    if (take.length) {
      await prisma.mistake.createMany({
        data: take.map((d) => ({
          userId: req.user!.id,
          source: 'practice',
          nodeId: null,
          examCode: null,
          cellIndex: null,
          cardNo: null,
          causes: null,
          questionId: d.questionId,
          given: d.given,
          score: 0,
          full: 1,
          at: BigInt(Date.now()),
          status: 'open',
        })),
      });
    }
  }

  res.json({
    sessionId: session.id,
    /* 这次**真做了**几道（跳过的白板题没算） */
    total,
    /* 其中**判得了分**的几道 —— 正确率的分母是它，不是 total */
    judged: judgedCount,
    correct: correctCount,
    score: judgedCount ? Math.round((correctCount / judgedCount) * 100) : null,
    /* 错题归档的结果如实说：进去几道、因为容量满了丢了几道 */
    archived,
    dropped,
    /* 题解这次给没给 —— 前台据此显示"会员专属"的引导，
       而不是空一片让人以为页面坏了 */
    hasSolution: withSolution,
    details: details.map(({ kind: _k, ...rest }) => rest),
  });
});

/* 一次练习的**结果**（学生端「看这次的结果」那一页）。
   只给已提交的会话 —— 没交就把答案发出去，等于开了一个偷看答案的后门。 */
practiceRouter.get('/practice/sessions/:id', requireAuth, requirePerk('question_bank'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '会话 id 不对' } });
    return;
  }

  const session = await prisma.practiceSession.findFirst({
    where: { id, userId: req.user!.id },
    include: { answers: { orderBy: { order: 'asc' }, include: { question: true } } },
  });
  if (!session) {
    res.status(404).json({ error: { code: 'NO_SESSION', message: '没有这次练习' } });
    return;
  }
  if (!session.submittedAt) {
    res.status(400).json({ error: { code: 'NOT_SUBMITTED', message: '这次练习还没交，没有结果可看' } });
    return;
  }

  /* 题解照旧是会员那一项：没权益就不发 explanation（不是前端藏起来） */
  const withSolution = await canUse(req.user!.id, 'member_solution');

  res.json({
    id: session.id,
    total: session.total,
    judged: session.judged,
    correct: session.correct,
    score: session.judged ? Math.round(((session.correct ?? 0) / session.judged) * 100) : null,
    submittedAt: session.submittedAt.toISOString(),
    createdAt: session.createdAt.toISOString(),
    hasSolution: withSolution,
    details: session.answers.map((a) => ({
      questionId: a.questionId,
      code: a.question.code,
      kind: a.question.kind,
      tag: a.question.tag,
      stem: a.question.stem,
      given: a.given,
      answer: a.question.answer,
      correct: a.correct,
      judged: isJudgeable(a.question),
      explanation: withSolution ? a.question.explanation : null,
    })),
  });
});

practiceRouter.get('/practice/sessions', requireAuth, async (req, res) => {
  const rows = await prisma.practiceSession.findMany({
    where: { userId: req.user!.id },
    orderBy: { id: 'desc' },
    take: 20,
  });
  res.json({
    total: rows.length,
    items: rows.map((s) => ({
      id: s.id,
      total: s.total,
      correct: s.correct,
      submittedAt: s.submittedAt ? s.submittedAt.toISOString() : null,
      createdAt: s.createdAt.toISOString(),
      judged: s.judged,
      score: s.submittedAt && s.judged ? Math.round(((s.correct ?? 0) / s.judged) * 100) : null,
    })),
  });
});
