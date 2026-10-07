/* ==========================================================================
   学生统计 · 计算层（学生管理 S2）
   --------------------------------------------------------------------------
   用户 2026-10-07："每个人的各自学习情况；考试情况；成长曲线，学习曲线，习题量等等。"

   **所有曲线由服务端算好分桶，前端不自己聚合。** 两个理由：
     · 同一份算法要喂两处（后台看学生、学生端 report.html 看自己），
       两套算法迟早给出两个"平均掌握度"，老师照着哪个数说话都可能是错的
       —— 这和 sliceReport() 踩过的坑是同一条。
     · 分桶本来该在 SQL 里做，但 dev 跑 SQLite、prod 跑 MySQL，
       strftime 与 DATE_FORMAT 不是一回事，写 raw SQL 就得维护两套。先在 JS 里聚合。

   一条贯穿全文件的规矩：**"没有数据"和"数据是 0"必须分开**。
   一次都没练过 → accuracy 是 null（前端显示"暂无练习数据"），不是 0%。
   这和切片报告"不拿 0 顶替"是同一条。
   ========================================================================== */
import { prisma } from '../../db.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export type PracticeStat = {
  sessions: number;
  questions: number;
  correct: number;
  /** 其中判得了分的题数 —— **正确率的分母是它**。
      白板题（kind=board）只有题面、判不了分，进了 questions 但不进这里 */
  judged: number;
  /** 正确率；一次都没练过是 null（**不是 0**） */
  accuracy: number | null;
  lastAt: string | null;
};

export type PersonMetrics = {
  learned: number;
  masteryAvg: number | null;
  exams: number;
  avgRate: number | null;
  mistakes: number;
  practice: PracticeStat;
};

export type GroupMetrics = PersonMetrics & { students: number };

const pct = (num: number, den: number): number | null =>
  den > 0 ? Math.round((num / den) * 1000) / 1000 : null;
const avgInt = (sum: number, n: number): number | null =>
  n > 0 ? Math.round(sum / n) : null;

/**
 * 逐个学生算指标。**批量查、内存里分组** —— 一个班 30 人逐个查是 30×5 次往返，
 * 而这里只要 5 次。演示规模（每人 769 格）完全吃得下；
 * 真到几千人一个班再上只读汇总表。
 */
export async function metricsByUser(userIds: number[]): Promise<Map<number, PersonMetrics>> {
  const out = new Map<number, PersonMetrics>();
  if (!userIds.length) { return out; }
  const ids = [...new Set(userIds)];
  ids.forEach((id) => out.set(id, {
    learned: 0, masteryAvg: null, exams: 0, avgRate: null, mistakes: 0,
    practice: { sessions: 0, questions: 0, correct: 0, judged: 0, accuracy: null, lastAt: null },
  }));

  const [records, exams, mistakes, sessions] = await Promise.all([
    prisma.learningRecord.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, mastery: true, learnedAt: true },
    }),
    prisma.exam.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, papers: { select: { score: true, full: true } } },
    }),
    prisma.mistake.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _count: { _all: true } }),
    prisma.practiceSession.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, total: true, correct: true, judged: true, submittedAt: true },
    }),
  ]);

  /* 已学 / 平均掌握度：**平均只按学过的算**（没学过的进平均就是拿 0 顶替） */
  const masterySum = new Map<number, number>();
  records.forEach((r) => {
    const m = out.get(r.userId);
    if (!m) { return; }
    if (r.learnedAt) {
      m.learned += 1;
      masterySum.set(r.userId, (masterySum.get(r.userId) ?? 0) + r.mastery);
    }
  });
  out.forEach((m, id) => { m.masteryAvg = avgInt(masterySum.get(id) ?? 0, m.learned); });

  /* 考试：场次 + 平均得分率（满分是 0 的场次不进平均 —— 那是脏数据，不是 0 分） */
  const rateNum = new Map<number, number>();
  const rateDen = new Map<number, number>();
  exams.forEach((e) => {
    const m = out.get(e.userId);
    if (!m) { return; }
    m.exams += 1;
    const score = e.papers.reduce((s, p) => s + p.score, 0);
    const full = e.papers.reduce((s, p) => s + p.full, 0);
    if (full > 0) {
      rateNum.set(e.userId, (rateNum.get(e.userId) ?? 0) + score / full);
      rateDen.set(e.userId, (rateDen.get(e.userId) ?? 0) + 1);
    }
  });
  out.forEach((m, id) => {
    m.avgRate = pct(rateNum.get(id) ?? 0, rateDen.get(id) ?? 0);
  });

  mistakes.forEach((g) => {
    const m = out.get(g.userId);
    if (m) { m.mistakes = g._count._all; }
  });

  sessions.forEach((s) => {
    const m = out.get(s.userId);
    if (!m) { return; }
    m.practice.sessions += 1;
    m.practice.questions += s.total;
    m.practice.correct += s.correct ?? 0;
    m.practice.judged += s.judged ?? 0;
    if (s.submittedAt) {
      const iso = s.submittedAt.toISOString();
      if (!m.practice.lastAt || iso > m.practice.lastAt) { m.practice.lastAt = iso; }
    }
  });
  /* 分母是**判得了分的题数**，不是 questions —— 白板题判不了分，
     拿 questions 当分母等于把它们全判成错的（见 practice.routes.ts 顶部那三条）。 */
  out.forEach((m) => {
    m.practice.accuracy = m.practice.judged > 0
      ? Math.round((m.practice.correct / m.practice.judged) * 1000) / 1000
      : null;
  });

  return out;
}

/** 一组成员的汇总。**平均掌握度是"总掌握度÷总已学格数"**，
    不是"各人平均值的平均" —— 后者会让学得少的人跟学得多的人一样重。 */
export async function metricsForUsers(userIds: number[]): Promise<GroupMetrics> {
  const ids = [...new Set(userIds)];
  const per = await metricsByUser(ids);

  let learned = 0;
  let masteryWeighted = 0;
  let exams = 0;
  let rateSum = 0;
  let rateN = 0;
  let mistakes = 0;
  let sessions = 0;
  let questions = 0;
  let correct = 0;
  let judged = 0;
  let lastAt: string | null = null;

  per.forEach((m) => {
    learned += m.learned;
    masteryWeighted += (m.masteryAvg ?? 0) * m.learned;
    exams += m.exams;
    if (m.avgRate !== null) { rateSum += m.avgRate; rateN += 1; }
    mistakes += m.mistakes;
    sessions += m.practice.sessions;
    questions += m.practice.questions;
    correct += m.practice.correct;
    judged += m.practice.judged;
    if (m.practice.lastAt && (!lastAt || m.practice.lastAt > lastAt)) { lastAt = m.practice.lastAt; }
  });

  return {
    students: ids.length,
    learned,
    masteryAvg: avgInt(masteryWeighted, learned),
    exams,
    avgRate: pct(rateSum, rateN),
    mistakes,
    practice: {
      sessions, questions, correct, judged,
      accuracy: judged > 0 ? Math.round((correct / judged) * 1000) / 1000 : null,
      lastAt,
    },
  };
}

/* ------------------------------------------------------------------------- */

type Granularity = 'week' | 'month';

function bucketKey(d: Date, g: Granularity): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  if (g === 'month') { return `${d.getFullYear()}-${p(d.getMonth() + 1)}`; }
  /* 周：用"那一周的周一"当键。周一比 ISO 周号好读得多（2020-W36 还得去查表） */
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (day.getDay() + 6) % 7;              // 周一 = 0
  day.setDate(day.getDate() - dow);
  return `${day.getFullYear()}-${p(day.getMonth() + 1)}-${p(day.getDate())}`;
}

function nextBucket(d: Date, g: Granularity): Date {
  const n = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (g === 'month') { n.setMonth(n.getMonth() + 1); return n; }
  n.setDate(n.getDate() + 7);
  return n;
}

function startOfBucket(d: Date, g: Granularity): Date {
  if (g === 'month') { return new Date(d.getFullYear(), d.getMonth(), 1); }
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  return s;
}

/** 空桶也要排出来：那段日子没学，图上就该是个 0，而不是把空白挤掉 */
function bucketsBetween(from: Date, to: Date, g: Granularity): Date[] {
  const out: Date[] = [];
  let cur = startOfBucket(from, g);
  let guard = 0;
  while (cur.getTime() < to.getTime() && guard < 600) {
    out.push(cur);
    cur = nextBucket(cur, g);
    guard += 1;
  }
  return out;
}

export type GrowthPoint = {
  key: string;
  /** 到这个桶结束时的平均掌握度（累计口径）。一个人还没有任何记录时是 null */
  masteryAvg: number | null;
  /** 到这个桶结束时，已经"首学"过的格数 */
  touched: number;
  /** 这个桶内发生了几次事件 */
  events: number;
};

export type ProgressPoint = { key: string; done: number; plan: number };

/**
 * 成长曲线：**掌握度随时间的推进（累计口径）**。
 *
 * 算法：把事件按时间扫一遍，维护"每一格当前的掌握度"；
 * 每个桶结束时算一次所有已触及格子的平均掌握度。
 *
 * 为什么不用"这个桶里事件的平均掌握度"：那是"这周新学的东西学得怎么样"，
 * 不是"这个人的水平到哪了" —— 后者才是成长曲线要回答的问题。
 */
export async function growthSeries(
  userId: number, from: Date, to: Date, g: Granularity,
): Promise<GrowthPoint[]> {
  const events = await prisma.learningEvent.findMany({
    where: { record: { userId }, at: { gte: BigInt(from.getTime()), lt: BigInt(to.getTime()) } },
    select: { recordId: true, at: true, mastery: true },
    orderBy: { at: 'asc' },
  });

  /* 桶起点之前的事件也要算进来，否则第一桶的累计是错的 —— 所以再单独取一次"更早的最后状态" */
  const earlier = await prisma.learningEvent.findMany({
    where: { record: { userId }, at: { lt: BigInt(from.getTime()) } },
    select: { recordId: true, at: true, mastery: true },
    orderBy: { at: 'asc' },
  });

  const cur = new Map<number, number>();
  earlier.forEach((e) => cur.set(e.recordId, e.mastery));

  const buckets = bucketsBetween(from, to, g);
  const out: GrowthPoint[] = [];
  let i = 0;

  for (const b of buckets) {
    const end = nextBucket(b, g).getTime();
    let count = 0;
    while (i < events.length && Number(events[i]!.at) < end) {
      const e = events[i]!;
      cur.set(e.recordId, e.mastery);
      count += 1;
      i += 1;
    }
    const vals = [...cur.values()];
    out.push({
      key: bucketKey(b, g),
      masteryAvg: vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null,
      touched: vals.length,
      events: count,
    });
  }
  return out;
}

/**
 * 学习曲线：**累计已学 vs 计划**（照 3D 时间轴那套口径，从 14 天桶换成周/月）。
 *   done = 到那一刻为止有过 `first` 事件的格数（真的开始学了）
 *   plan = 到那一刻为止 `plannedAt` 已到的格数（计划该学到哪）
 * 两条线放在一张图上，"跟不跟得上计划"一眼就看出来。
 */
export async function progressSeries(
  userId: number, from: Date, to: Date, g: Granularity,
): Promise<{ buckets: ProgressPoint[]; total: number }> {
  const [records, firstEvents] = await Promise.all([
    prisma.learningRecord.findMany({
      where: { userId },
      select: { id: true, plannedAt: true },
    }),
    prisma.learningEvent.groupBy({
      by: ['recordId'],
      where: { record: { userId }, kind: 'first' },
      _min: { at: true },
    }),
  ]);

  const firstAt = new Map(firstEvents.map((e) => [e.recordId, Number(e._min.at ?? 0)]));
  const planned = records
    .map((r) => (r.plannedAt ? Date.parse(`${r.plannedAt}T00:00:00`) : NaN))
    .filter((t) => !Number.isNaN(t));

  const buckets = bucketsBetween(from, to, g).map((b) => {
    const end = nextBucket(b, g).getTime();
    let done = 0;
    firstAt.forEach((t) => { if (t < end) { done += 1; } });
    let plan = 0;
    planned.forEach((t) => { if (t < end) { plan += 1; } });
    return { key: bucketKey(b, g), done, plan };
  });

  return { buckets, total: records.length };
}

export type ScorePoint = {
  code: string; name: string; date: string;
  score: number; full: number; rate: number | null;
};

export async function scoreSeries(userId: number): Promise<ScorePoint[]> {
  const exams = await prisma.exam.findMany({
    where: { userId },
    orderBy: { at: 'asc' },
    select: { code: true, name: true, date: true, papers: { select: { score: true, full: true } } },
  });
  return exams.map((e) => {
    const score = e.papers.reduce((s, p) => s + p.score, 0);
    const full = e.papers.reduce((s, p) => s + p.full, 0);
    return { code: e.code, name: e.name, date: e.date, score, full, rate: pct(score, full) };
  });
}

export type WeakChapter = {
  nodeId: number; name: string;
  /** 错题本里挂在这一章下的条数 */
  mistakes: number;
  /** 上传的卷子里框错、并挂在这一章下的条数 */
  boxes: number;
};

/**
 * 薄弱点：把"错题本"与"切片里框出的错题"都归到**章**上，按合计排序。
 *
 * 为什么归到章：知识点太散（一个人可能有几十个薄弱知识点，摆在报告里没法看），
 * 而老师要的是"这一章得再讲一遍"。章是两者都能落到的公共粒度。
 */
/** 节点表整张读进内存，给一个"往上走到章"的解析器。
    逐个查祖先才是真的慢：一个人几百个节点，每个都要递归查库。
    **weakChapters 与 chapterMastery 共用这一份**，别各建一个 map。 */
async function chapterResolver() {
  const nodes = await prisma.node.findMany({ select: { id: true, name: true, kind: true, parentId: true } });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (nid: number): { id: number; name: string } | null => {
    let cur = byId.get(nid);
    let guard = 0;
    while (cur && guard < 12) {
      if (cur.kind === 'chapter') { return { id: cur.id, name: cur.name }; }
      cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
      guard += 1;
    }
    return null;
  };
}

export type ChapterMastery = {
  nodeId: number; name: string;
  /** 这一章下学过的格数 */
  learned: number;
  /** 这一章的平均掌握度（**只按学过的算**） */
  masteryAvg: number;
};

/**
 * 按章的掌握度 —— 学生端「学习报告」里那一节要用。
 * 与"薄弱章节"是两件事：那个看的是**错题**（哪里错了），这个看的是**掌握度**（哪里学得浅）。
 */
export async function chapterMastery(userId: number, limit = 10): Promise<ChapterMastery[]> {
  const [records, chapterOf] = await Promise.all([
    prisma.learningRecord.findMany({
      where: { userId, learnedAt: { not: null } },
      select: { nodeId: true, mastery: true },
    }),
    chapterResolver(),
  ]);

  const acc = new Map<number, { name: string; sum: number; n: number }>();
  records.forEach((r) => {
    const ch = chapterOf(r.nodeId);
    if (!ch) { return; }
    const row = acc.get(ch.id) ?? { name: ch.name, sum: 0, n: 0 };
    row.sum += r.mastery;
    row.n += 1;
    acc.set(ch.id, row);
  });

  return [...acc.entries()]
    .map(([id, v]) => ({
      nodeId: id, name: v.name, learned: v.n,
      masteryAvg: Math.round(v.sum / v.n),
    }))
    /* 学得少的章不进榜 —— 只学过 1 格、那一格 40 分，不代表这一章"掌握度 40" */
    .filter((r) => r.learned >= 3)
    .sort((a, b) => a.masteryAvg - b.masteryAvg)
    .slice(0, limit);
}

export async function weakChapters(userId: number, limit = 12): Promise<WeakChapter[]> {
  const [mistakes, boxes, chapterOf] = await Promise.all([
    prisma.mistake.findMany({ where: { userId, nodeId: { not: null } }, select: { nodeId: true } }),
    prisma.examSliceBox.findMany({
      where: { slice: { userId }, nodeId: { not: null } },
      select: { nodeId: true },
    }),
    chapterResolver(),
  ]);

  const acc = new Map<number, WeakChapter>();
  const bump = (nid: number, field: 'mistakes' | 'boxes'): void => {
    const ch = chapterOf(nid);
    if (!ch) { return; }
    const row = acc.get(ch.id) ?? { nodeId: ch.id, name: ch.name, mistakes: 0, boxes: 0 };
    row[field] += 1;
    acc.set(ch.id, row);
  };

  mistakes.forEach((m) => { if (m.nodeId !== null) { bump(m.nodeId, 'mistakes'); } });
  boxes.forEach((b) => { if (b.nodeId !== null) { bump(b.nodeId, 'boxes'); } });

  return [...acc.values()]
    .sort((a, b) => (b.mistakes + b.boxes) - (a.mistakes + a.boxes))
    .slice(0, limit);
}

/** 学生详情用的一次性成长数据。拆成五个接口的话，页面会出五个各自转圈的方块。 */
export async function growthForStudent(
  userId: number,
  opts: { granularity: Granularity; from: Date; to: Date },
) {
  const [growth, progress, scores, metrics, weak, byChapter] = await Promise.all([
    growthSeries(userId, opts.from, opts.to, opts.granularity),
    progressSeries(userId, opts.from, opts.to, opts.granularity),
    scoreSeries(userId),
    metricsByUser([userId]),
    weakChapters(userId),
    chapterMastery(userId),
  ]);
  return {
    growth,
    progress,
    scores,
    practice: metrics.get(userId)?.practice ?? {
      sessions: 0, questions: 0, correct: 0, judged: 0, accuracy: null, lastAt: null,
    },
    weak,
    byChapter,
  };
}

/** 供路由解析 from/to 用（不传就给近 180 天的默认区间） */
export function defaultRange(fromRaw: unknown, toRaw: unknown): { from: Date; to: Date } {
  const to = typeof toRaw === 'string' && toRaw ? new Date(`${toRaw}T23:59:59`) : new Date();
  const from = typeof fromRaw === 'string' && fromRaw
    ? new Date(`${fromRaw}T00:00:00`)
    : new Date(to.getTime() - 180 * DAY_MS);
  return {
    from: Number.isNaN(from.getTime()) ? new Date(to.getTime() - 180 * DAY_MS) : from,
    to: Number.isNaN(to.getTime()) ? new Date() : to,
  };
}
