/* ==========================================================================
   导库 · M3 学习数据（学习记录 / 轨迹 / 考试 / 卷面 / 错题 / 标记）
   --------------------------------------------------------------------------
   输入还是 `seed/` 那两份冻结快照，**不新造一份**：
     · learning-default.json   —— 演示学生（43.7%）那一份：769 格掌握度 + 336 格轨迹
                                  + 15 场考试 + 812 道卷面。**只有这一份带轨迹和考试。**
     · learning-students.json  —— 林一鸣 / 周雨桐 / 陈子航，各自一份（只有掌握度，没有轨迹）
   为什么只有默认那份带轨迹：导出时 `WK_LEARNING.build()` 只给掌握度，轨迹与考试要再调
   `buildTimeline()` 才灌得进去，而那一遍只对默认学生跑了。所以这里**照实导**：
   演示账号（林一鸣）拿默认那份（他在线上看到的就是它），另两位学生拿自己那份。

   几个"位置"的换算，错一个就会把记录/错题挂到隔壁格上（数量还照样对得上）：
     · 记录第 i 条        → 轴上第 i 格 → axisNodeIds[i]
     · 卷面题 `paper.index` → **就是轴上第几格**（timeline-data.js:335 `records[item.index]`），
                            不是"第几题"
     · 错题               = 卷面不到 60%（`score*5 < full*3`）。冻结数据里这一批**正好等于**
                            带 causes 的那 158 道，两条口径互相印证，不是拍脑袋定的。
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';

/* ---------------- 类型：照 seed 里的真实形状写 ---------------- */

type Factors = { acc: number; solo: number; gap: number; speed: number; err: number };

type SeedEvent = {
  at: number;
  kind: string;
  mastery: number;
  exam?: string;
  score?: number;
  full?: number;
  from?: number;
  to?: number;
};

type SeedRecord = {
  mastery: number;
  status: string;
  learnedAt?: string;
  reviewAt?: string;
  diff?: number;
  term?: string;
  factors?: Factors | null;
  cards?: { no: number; type: string; diff: number; acc: number; status: string; weight: number; at: string }[];
  marks?: string[];
  blocked?: boolean;
  plannedAt?: string;
  events?: SeedEvent[];
};

type SeedPaper = {
  index: number;
  full: number;
  score: number;
  card: number;
  also?: number[];
  causes?: { card: number; key: string; by: string; acc: number; k: number }[] | null;
};

export type SeedExam = {
  id: string;
  name: string;
  at: number;
  date: string;
  from: number;
  to: number;
  scope: string;
  paper: SeedPaper[];
};

type StudentSet = { grade: string; seed: number; progress: number; records: SeedRecord[] };

/** 一个学生要导的那一份 */
export type LearningPlan = {
  userId: number;
  username: string;
  records: SeedRecord[];
  exams?: SeedExam[];
  /** 时间轴那条"今天"线画在哪儿（跟数据走，见 LearningProfile 的注释） */
  todayAt?: string;
};

export type LearningCounts = {
  records: number;
  withTrajectory: number;
  events: number;
  exams: number;
  papers: number;
  mistakes: number;
  marks: number;
  favorites: number;
  notes: number;
};

/** 冻结数据是按这一天生成的（learning-default.json 的 timeline.today） */
export const FROZEN_TODAY = '2026-06-30';

const CHUNK = 200;

export function readLearningSeed(seedDir: string): {
  defaultSet: { records: SeedRecord[]; timeline: { exams: SeedExam[]; today?: string } };
  students: Record<string, StudentSet>;
} {
  const read = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(seedDir, name), 'utf8')) as T;

  const def = read<{ records: SeedRecord[]; timeline: { exams: SeedExam[]; today?: string } }>('learning-default.json');
  const students = read<Record<string, StudentSet>>('learning-students.json');

  if (!def.records || !def.records.length) { throw new Error('learning-default.json 里没有 records'); }
  if (!def.timeline || !def.timeline.exams) { throw new Error('learning-default.json 里没有 timeline.exams'); }
  return { defaultSet: def, students };
}

/** 清空 M3 那几张表（依赖顺序倒着删）。导库可重复跑靠它。 */
export async function clearLearning(prisma: PrismaClient): Promise<void> {
  await prisma.pointMark.deleteMany();
  await prisma.learningEvent.deleteMany();
  await prisma.learningProfile.deleteMany();
  await prisma.learningRecord.deleteMany();
  await prisma.examPaper.deleteMany();
  await prisma.exam.deleteMany();
  await prisma.mistake.deleteMany();
  await prisma.favorite.deleteMany();
  await prisma.note.deleteMany();
}

export async function seedLearning(
  prisma: PrismaClient,
  axisNodeIds: number[],
  plans: LearningPlan[],
  /** 节点 id → 名字。错题要存一份名字快照：节点删了，错题本还读得出来。 */
  nodeNames: Map<number, string> = new Map(),
): Promise<LearningCounts> {
  const out: LearningCounts = {
    records: 0, withTrajectory: 0, events: 0, exams: 0, papers: 0, mistakes: 0, marks: 0, favorites: 0, notes: 0,
  };

  for (const plan of plans) {
    /* ---- 1) 掌握度这一层 ---- */
    const rows = plan.records.map((rec, i) => {
      const nodeId = axisNodeIds[i];
      if (nodeId === undefined) {
        /* 记录比轴还长 = 两份数据不是同一套，必须报错。静默少几条，数量检查看不出来。 */
        throw new Error(`第 ${i} 条学习记录找不到对应的轴节点（轴只有 ${axisNodeIds.length} 格）`);
      }
      return {
        userId: plan.userId,
        nodeId,
        mastery: rec.mastery,
        status: rec.status,
        learnedAt: rec.learnedAt || null,
        reviewAt: rec.reviewAt || null,
        plannedAt: rec.plannedAt || null,
        diff: typeof rec.diff === 'number' ? rec.diff : null,
        term: rec.term || null,
        factors: rec.factors ? JSON.stringify(rec.factors) : null,
        cards: rec.cards && rec.cards.length ? JSON.stringify(rec.cards) : null,
        blocked: rec.blocked === true,
      };
    });

    for (let i = 0; i < rows.length; i += CHUNK) {
      await prisma.learningRecord.createMany({ data: rows.slice(i, i + CHUNK) });
    }
    out.records += rows.length;
    out.withTrajectory += plan.records.filter((r) => r.events && r.events.length).length;

    /* 时间轴的"今天"线 */
    await prisma.learningProfile.upsert({
      where: { userId: plan.userId },
      create: { userId: plan.userId, todayAt: plan.todayAt ?? FROZEN_TODAY },
      update: { todayAt: plan.todayAt ?? FROZEN_TODAY },
    });

    /* ---- 2) 轨迹与标记：建完记录才拿得到 recordId ---- */
    const created = await prisma.learningRecord.findMany({
      where: { userId: plan.userId },
      select: { id: true, nodeId: true },
    });
    const recordIdByNode = new Map<number, number>();
    created.forEach((r) => recordIdByNode.set(r.nodeId, r.id));

    const eventRows: {
      recordId: number; at: bigint; kind: string; mastery: number;
      examCode: string | null; score: number | null; full: number | null;
      fromVal: number | null; toVal: number | null;
    }[] = [];
    const markRows: { recordId: number; userId: number; nodeId: number; mark: string }[] = [];

    plan.records.forEach((rec, i) => {
      const nodeId = axisNodeIds[i];
      if (nodeId === undefined) { return; }
      const recordId = recordIdByNode.get(nodeId);
      if (recordId === undefined) { return; }

      (rec.events ?? []).forEach((ev) => {
        eventRows.push({
          recordId,
          at: BigInt(ev.at),
          kind: ev.kind,
          mastery: typeof ev.mastery === 'number' ? ev.mastery : 0,
          examCode: ev.exam ?? null,
          score: typeof ev.score === 'number' ? ev.score : null,
          full: typeof ev.full === 'number' ? ev.full : null,
          fromVal: typeof ev.from === 'number' ? ev.from : null,
          toVal: typeof ev.to === 'number' ? ev.to : null,
        });
      });

      (rec.marks ?? []).forEach((m) => {
        markRows.push({ recordId, userId: plan.userId, nodeId, mark: m });
      });
    });

    for (let i = 0; i < eventRows.length; i += CHUNK) {
      await prisma.learningEvent.createMany({ data: eventRows.slice(i, i + CHUNK) });
    }
    for (let i = 0; i < markRows.length; i += CHUNK) {
      await prisma.pointMark.createMany({ data: markRows.slice(i, i + CHUNK) });
    }
    out.events += eventRows.length;
    out.marks += markRows.length;

    /* ---- 3) 考试与卷面（只有默认学生那份有） ---- */
    for (const ex of plan.exams ?? []) {
      const created2 = await prisma.exam.create({
        data: {
          userId: plan.userId,
          code: ex.id,
          name: ex.name,
          at: BigInt(ex.at),
          date: ex.date,
          fromIdx: ex.from,
          toIdx: ex.to,
          scope: ex.scope,
        },
      });
      out.exams += 1;

      const paperRows = ex.paper.map((p) => {
        const nodeId = axisNodeIds[p.index];
        if (nodeId === undefined) {
          throw new Error(`考试 ${ex.id} 的卷面题指向第 ${p.index} 格，轴只有 ${axisNodeIds.length} 格`);
        }
        return {
          examId: created2.id,
          index: p.index,
          full: p.full,
          score: p.score,
          card: p.card,
          also: p.also && p.also.length ? JSON.stringify(p.also) : null,
          causes: p.causes && p.causes.length ? JSON.stringify(p.causes) : null,
          nodeId,
        };
      });

      /* nodeId 一起存：后台改树之后，卷面题要能映射回"现在"的第几格 */
      await prisma.examPaper.createMany({ data: paperRows });
      out.papers += paperRows.length;

      /* 错题：卷面不到 60%。挂到那一格对应的节点上。 */
      const wrong = paperRows.filter((p) => p.score * 5 < p.full * 3);
      if (wrong.length) {
        await prisma.mistake.createMany({
          data: wrong.map((p) => ({
            userId: plan.userId,
            source: 'exam',
            nodeId: p.nodeId,
            /* 快照：删了节点之后错题本上还能显示当时考的是哪个知识点 */
            nodeName: nodeNames.get(p.nodeId) ?? '',
            examCode: ex.id,
            cellIndex: p.index,
            cardNo: p.card,
            causes: p.causes ?? '[]',
            score: p.score,
            full: p.full,
            at: BigInt(ex.at),
            status: 'fixed', /* 冻结数据里每道错题后面都跟着一笔 fix 事件 —— 都订正过了 */
          })),
        });
        out.mistakes += wrong.length;
      }
    }
  }

  return out;
}

/* ==========================================================================
   收藏夹 / 笔记本的演示数据
   --------------------------------------------------------------------------
   **这两样在 seed/ 里没有**（冻结快照里没抽它们），页面上的"收藏 24 条"是写死在
   HTML 里的数字。为了演示账号进去不是空页，这里按**真实的树节点**造一小批：
   标题就是节点自己的名字，不是编的。要清掉就删这个函数调用。
   ========================================================================== */
export async function seedDemoFavoritesAndNotes(prisma: PrismaClient, userId: number): Promise<{ favorites: number; notes: number }> {
  const points = await prisma.node.findMany({
    where: { kind: 'point' },
    orderBy: { id: 'asc' },
    take: 24,
    select: { id: true, name: true, no: true, parentId: true },
  });
  if (!points.length) { return { favorites: 0, notes: 0 }; }

  const parentIds = [...new Set(points.map((p) => p.parentId).filter((x): x is number => x !== null))];
  const parents = await prisma.node.findMany({ where: { id: { in: parentIds } }, select: { id: true, name: true } });
  const parentName = new Map(parents.map((p) => [p.id, p.name]));

  const favRows = points.slice(0, 12).map((p) => ({
    userId,
    kind: 'point',
    refId: String(p.id),
    title: p.name,
    sub: p.parentId !== null ? (parentName.get(p.parentId) ?? '') : '',
  }));
  await prisma.favorite.createMany({ data: favRows });

  const noteRows = points.slice(0, 6).map((p, i) => ({
    userId,
    nodeId: p.id,
    title: p.name + ' · 我的笔记',
    body: [
      '这一条是演示笔记，挂在真实的知识点上（' + p.name + '）。',
      '',
      '需要记的是三件事：定义怎么写、什么条件下才成立、和相邻概念差在哪。',
      '第 ' + (i + 1) + ' 条先记下来，等做题之后再回来补。',
    ].join('\n'),
  }));
  await prisma.note.createMany({ data: noteRows });

  return { favorites: favRows.length, notes: noteRows.length };
}
