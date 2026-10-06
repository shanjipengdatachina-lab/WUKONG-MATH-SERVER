/* ==========================================================================
   考情切片报告 —— **纯统计汇总**，不接任何模型
   --------------------------------------------------------------------------
   用户 2026-10-07 定的口径：把切片按日期 / 成绩 / 覆盖章节聚合成趋势与薄弱点，
   错题位置靠人工框选；**不接 AI 识别**（那是另一件事，要另配视觉模型）。

   三条"不猜"的规矩：
     · **没填分数的切片不进得分率统计**，也不拿 0 顶替 —— 用 0 会把平均分拉垮，
       而那个 0 从来不是学生的成绩，是"他没填"。所以报告里同时给出 withScore 有多少条。
     · **没挂知识点的框不进薄弱点统计**，但总数照算 —— 让人看得出"框了但没归类"。
     · 得分率只有 score 与 full 都有、且 full > 0 时才出现。
   ========================================================================== */
import { prisma } from '../../db.js';

export type TrendPoint = {
  sliceId: number; date: string; name: string; subject: string;
  score: number; full: number; rate: number;
};

export type ChapterStat = {
  nodeId: number; name: string;
  /** 有几次考试覆盖了这一章 */
  slices: number;
  /** 这些考试里，挂在这一章上的框一共多少个 */
  boxes: number;
  /** 学生自己写的错因（去重，最多给 6 条，够看出"反复错在哪"） */
  causes: string[];
};

export type SliceReport = {
  summary: {
    count: number;
    withScore: number;
    firstDate: string | null;
    lastDate: string | null;
    /** 平均得分率（0~1）；一条都没填分数时是 null，不是 0 */
    avgRate: number | null;
    best: TrendPoint | null;
    worst: TrendPoint | null;
  };
  trend: TrendPoint[];
  bySubject: { subject: string; count: number; withScore: number; avgRate: number | null }[];
  byChapter: ChapterStat[];
  boxes: { total: number; withNode: number; withoutNode: number };
};

const round = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * 某个学生的考情切片报告。
 * 前台（自己的）和后台（学生详情里看别人的）用的是**同一个函数** ——
 * 两处各算一份的话，迟早会出现"学生看到的和老师看到的不一样"。
 */
export async function sliceReport(userId: number): Promise<SliceReport> {
  const slices = await prisma.examSlice.findMany({
    where: { userId },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    include: {
      boxes: { select: { nodeId: true, cause: true } },
      nodes: { select: { nodeId: true } },
    },
  });

  /* 章节名字：一次查完，别一条章名查一次 */
  const nodeIds = new Set<number>();
  slices.forEach((s) => {
    s.nodes.forEach((n) => nodeIds.add(n.nodeId));
    s.boxes.forEach((b) => { if (b.nodeId !== null) { nodeIds.add(b.nodeId); } });
  });
  const named = nodeIds.size
    ? await prisma.node.findMany({ where: { id: { in: [...nodeIds] } }, select: { id: true, name: true } })
    : [];
  const nameOf = new Map(named.map((n) => [n.id, n.name]));

  /* ---- 趋势：只有 score 和 full 都有、且 full > 0 的才算得分率 ---- */
  const trend: TrendPoint[] = [];
  for (const s of slices) {
    if (s.score === null || s.full === null || s.full <= 0) { continue; }
    trend.push({
      sliceId: s.id, date: s.date, name: s.name, subject: s.subject,
      score: s.score, full: s.full, rate: round(s.score / s.full),
    });
  }

  const avgOf = (list: TrendPoint[]): number | null =>
    list.length ? round(list.reduce((a, p) => a + p.rate, 0) / list.length) : null;
  const sorted = [...trend].sort((a, b) => a.rate - b.rate);

  /* ---- 按科目 ---- */
  const subjectMap = new Map<string, { count: number; scored: TrendPoint[] }>();
  slices.forEach((s) => {
    const cur = subjectMap.get(s.subject) ?? { count: 0, scored: [] };
    cur.count += 1;
    const hit = trend.find((t) => t.sliceId === s.id);
    if (hit) { cur.scored.push(hit); }
    subjectMap.set(s.subject, cur);
  });

  /* ---- 按章节：覆盖次数 + 挂在这一章上的框 + 学生自己写的错因 ---- */
  const chapterMap = new Map<number, { slices: number; boxes: number; causes: string[] }>();
  const touch = (id: number): { slices: number; boxes: number; causes: string[] } => {
    const cur = chapterMap.get(id) ?? { slices: 0, boxes: 0, causes: [] };
    chapterMap.set(id, cur);
    return cur;
  };
  slices.forEach((s) => { s.nodes.forEach((n) => { touch(n.nodeId).slices += 1; }); });
  slices.forEach((s) => {
    s.boxes.forEach((b) => {
      if (b.nodeId === null) { return; }
      const cur = touch(b.nodeId);
      cur.boxes += 1;
      const c = (b.cause ?? '').trim();
      if (c && cur.causes.indexOf(c) < 0 && cur.causes.length < 6) { cur.causes.push(c); }
    });
  });

  const byChapter: ChapterStat[] = [...chapterMap.entries()]
    .map(([nodeId, v]) => ({
      nodeId, name: nameOf.get(nodeId) ?? '(已删除的知识点)',
      slices: v.slices, boxes: v.boxes, causes: v.causes,
    }))
    /* 框最多的排前面 —— 那就是最该补的地方 */
    .sort((a, b) => (b.boxes - a.boxes) || (b.slices - a.slices) || (a.nodeId - b.nodeId));

  const allBoxes = slices.reduce((a, s) => a + s.boxes.length, 0);
  const withNode = slices.reduce((a, s) => a + s.boxes.filter((b) => b.nodeId !== null).length, 0);

  return {
    summary: {
      count: slices.length,
      withScore: trend.length,
      firstDate: slices.length ? slices[0]!.date : null,
      lastDate: slices.length ? slices[slices.length - 1]!.date : null,
      avgRate: avgOf(trend),
      best: sorted.length ? sorted[sorted.length - 1]! : null,
      worst: sorted.length ? sorted[0]! : null,
    },
    trend,
    bySubject: [...subjectMap.entries()]
      .map(([subject, v]) => ({
        subject, count: v.count, withScore: v.scored.length, avgRate: avgOf(v.scored),
      }))
      .sort((a, b) => b.count - a.count),
    byChapter,
    boxes: { total: allBoxes, withNode, withoutNode: allBoxes - withNode },
  };
}
