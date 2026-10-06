/* ==========================================================================
   导库：把 seed/*.json 灌进库（M1 结构 + 卡片 + 正文；M2 账号；M3 学习数据）
   --------------------------------------------------------------------------
   为什么读 seed/ 而不直接读前端源码：seed/ 是 2026-10-05 **冻下来的快照**，是"原来那份"的
   证据；前端那几个文件接下来要改成读接口，导库不该再依赖它们。

   幂等：先按依赖顺序清空再插，跑多少次结果都一样。

   用法：npm run db:seed
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { seedAuth, DEMO_ACCOUNTS, ROLES, PERMS } from './auth.js';
import {
  clearLearning, readLearningSeed, seedLearning, seedDemoFavoritesAndNotes,
  type LearningPlan, type LearningCounts,
} from './learning.js';
import { clearPractice, readPracticeSeed, seedPractice, type PracticeCounts } from './practice.js';
import { clearForum, readForumSeed, seedForum, type ForumCounts } from './forum.js';
import { buildAxisFrom } from '../modules/tree/axis.service.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEED = process.env.SEED_DIR
  ? path.resolve(process.env.SEED_DIR)
  : path.resolve(HERE, '../../../../seed');

const prisma = new PrismaClient();

function readJson<T>(name: string): T {
  const file = path.join(SEED, name);
  if (!fs.existsSync(file)) {
    throw new Error(`找不到 ${file} —— 先在 WKMATH 仓库跑 node tools/export-demo-data.mjs`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

/* ---------------- 类型：照 seed/ 里的真实形状写，不多不少 ---------------- */

type TreeNode = {
  kind: string;
  name: string;
  no?: string;
  stage?: string;
  source?: string;
  field?: string;
  cn?: string;
  unit?: boolean;
  pending?: string;
  tone?: string;
  children?: TreeNode[];
};

type ChainSeg = { depth: number; name: string; stage?: string };

type SeedRecord = { cards?: { no: number; type: string; weight: number }[] };

/* 轴：与前端 assets/js/timeline-axis.js 的 buildAxis() **逐条一致**。
   不一致的后果很隐蔽 —— 卡片会挂到隔壁节点上，数量还对得上。 */
const STAGE_CN: Record<string, string> = { primary: '小学', junior: '初中', senior: '高中', olympiad: '竞赛' };

function gradeOf(bookName: string): string {
  const m = /^([一二三四五六七八九]年级)/.exec(bookName);
  if (m && m[1]) return m[1];
  if (bookName.startsWith('选择性必修')) return '高二';
  if (bookName.startsWith('必修')) return '高一';
  return '';
}

/* ---------------- 主流程 ---------------- */

async function main(): Promise<void> {
  const tree = readJson<TreeNode>('math-tree.json');
  const dict = readJson<{ cardTypes: { name: string; weight: number }[] }>('learning-dict.json');
  const learning = readJson<{ records: SeedRecord[] }>('learning-default.json');
  const counts = readJson<Record<string, number>>('_counts.json');
  const learningSeed = readLearningSeed(SEED);

  /* ---- 1) 清空（依赖顺序：越"里面"的越先删） ---- */
  await clearPractice(prisma);
  await clearForum(prisma);
  await clearLearning(prisma);
  await prisma.content.deleteMany();
  await prisma.card.deleteMany();
  await prisma.node.deleteMany();
  await prisma.cardType.deleteMany();

  /* ---- 2) 卡片类型字典（六类） ---- */
  await prisma.cardType.createMany({
    data: dict.cardTypes.map((c, i) => ({ name: c.name, defaultWeight: c.weight, order: i })),
  });

  /* ---- 3) 知识树：前序编号（先序 DFS），id 自己指定 ---- */
  const nodes: {
    id: number; kind: string; name: string; no: string | null; stage: string | null;
    source: string | null; field: string | null; cn: string | null; unit: boolean | null;
    pending: string | null; tone: string | null; order: number; parentId: number | null;
  }[] = [];

  let seq = 0;
  const idByNode = new Map<TreeNode, number>();

  function collect(node: TreeNode, parentId: number | null, order: number): number {
    seq += 1;
    const id = seq;
    idByNode.set(node, id);
    nodes.push({
      id,
      kind: node.kind,
      name: node.name,
      no: node.no ?? null,
      stage: node.stage ?? null,
      source: node.source ?? null,
      field: node.field ?? null,
      cn: node.cn ?? null,
      unit: node.unit ?? null,
      pending: node.pending ?? null,
      tone: node.tone ?? null,
      order,
      parentId,
    });
    (node.children ?? []).forEach((kid, i) => collect(kid, id, i));
    return id;
  }
  collect(tree, null, 0);

  /* 1391 行一次插，SQLite 的变量上限顶不住 —— 切块 */
  const CHUNK = 200;
  for (let i = 0; i < nodes.length; i += CHUNK) {
    await prisma.node.createMany({ data: nodes.slice(i, i + CHUNK) });
  }

  /* ---- 4) 轴：谁上轴、按什么顺序 ----
     规则**只留在 modules/tree/axis.service.ts 一处**（原来这里自己复刻了一份 DFS，
     加上前端那份就是两处 —— 改一处忘一处，症状是"卡片挂到隔壁格上，数量还对得上"）。 */
  const axis = buildAxisFrom(nodes.map((n) => ({
    id: n.id, kind: n.kind, name: n.name, parentId: n.parentId, order: n.order,
  })));
  const axisNodeIds = axis.order;

  /* ---- 5) 卡片：轴第 i 格上的卡片 → 那一格的节点 ---- */
  const cardRows: { nodeId: number; no: number; typeName: string; weight: number }[] = [];
  learning.records.forEach((rec, i) => {
    const nodeId = axisNodeIds[i];
    if (nodeId === undefined || !rec.cards) return;
    rec.cards.forEach((c) => {
      cardRows.push({ nodeId, no: c.no, typeName: c.type, weight: c.weight });
    });
  });
  for (let i = 0; i < cardRows.length; i += CHUNK) {
    await prisma.card.createMany({ data: cardRows.slice(i, i + CHUNK) });
  }

  /* ---- 6) 唯一一篇正文（1.2 有理数 · 数轴 · 知识点 2） ----
     seed/content-authored.json 是从 reader.html 的 #knowledge-point **原样**抽出来的。
     按坐标走树找节点：**找不到就报错，不静默跳过** —— 静默跳过的后果是正文悄悄不在库里，
     而"少一条正文"这种错，用数量检查是看不出来的。 */
  const authoredFile = path.join(SEED, 'content-authored.json');
  let authoredNodeId: number | null = null;
  let authoredChars = 0;

  if (fs.existsSync(authoredFile)) {
    const authored = JSON.parse(fs.readFileSync(authoredFile, 'utf8')) as {
      target: { stage: string; bookName: string; chapterNo: string; sectionNo: string; pointNo: string };
      html: string;
    };
    const t = authored.target;
    type NodeRow = (typeof nodes)[number];
    const childOf = (parentId: number | null, kind: string, match: (n: NodeRow) => boolean): NodeRow | undefined =>
      nodes.find((n) => n.parentId === parentId && n.kind === kind && match(n));

    /* 注意：册**不是根** —— 根是「数学知识网络」，册挂在它下面，所以 parentId 不为 null。
       按名字找，并用 stage 兜一层（同名册理论上可能在不同学段各有一份）。 */
    const book = nodes.find((n) => n.kind === 'book' && n.name === t.bookName && n.stage === t.stage);
    const chapter = book ? childOf(book.id, 'chapter', (n) => n.no === t.chapterNo) : undefined;
    const section = chapter ? childOf(chapter.id, 'section', (n) => n.no === t.sectionNo) : undefined;
    const point = section ? childOf(section.id, 'point', (n) => n.no === t.pointNo) : undefined;

    if (!book || !chapter || !section || !point) {
      throw new Error(
        '正文挂不上 —— 按坐标走树走不到：' +
          `册「${t.bookName}」${book ? 'OK' : '缺'} / 章 ${t.chapterNo} ${chapter ? 'OK' : '缺'} / ` +
          `节 ${t.sectionNo} ${section ? 'OK' : '缺'} / 知识点 ${t.pointNo} ${point ? 'OK' : '缺'}`,
      );
    }

    authoredNodeId = point.id;
    authoredChars = authored.html.length;
    await prisma.content.create({
      data: { nodeId: point.id, html: authored.html, version: 1, publishedAt: new Date() },
    });
    console.log(
      `\n正文已挂：${book.name} / ${chapter.name} / ${section.name} / 知识点 ${t.pointNo}「${point.name}」—— ${authoredChars} 字符（nodeId=${authoredNodeId}）`,
    );
  } else {
    console.log('\n[warn] 没有 seed/content-authored.json，跳过正文（先在 WKMATH 跑一遍导出器）');
  }

  /* ---- 7) 账号与权限（M2） ---- */
  const authCounts = await seedAuth(prisma);
  console.log(`\n账号：${authCounts.roles} 个角色 / ${authCounts.perms} 个权限点 / ${authCounts.users} 个演示账号`);
  DEMO_ACCOUNTS.forEach((a) => console.log(`  ${a.role.padEnd(8)} ${a.username.padEnd(11)} ${a.password.padEnd(14)} ${a.nickname}`));

  /* ---- 8) 学习数据（M3） ----
     数据集怎么分（见 auth.ts 里 DEMO_ACCOUNTS 的 learning 字段）：
       · student（林一鸣）  → learning-default.json（**线上演示学生那一份**，含 15 场考试）
       · 另两位            → learning-students.json 里自己那一份（有轨迹，没有考试）
     注意：learning-students.json 里**也有一份林一鸣**（seed 893185），但他不是线上那一个
     （线上是 DEFAULT_SEED 20260929 / 43.7%）。那份先用不上，留作对照，别拿它当"线上数据"。 */
  const users = await prisma.user.findMany({ select: { id: true, username: true } });
  const userIdOf = new Map(users.map((u) => [u.username, u.id]));

  const plans: LearningPlan[] = [];
  for (const acc of DEMO_ACCOUNTS) {
    if (!acc.learning) { continue; }
    const userId = userIdOf.get(acc.username);
    if (userId === undefined) { throw new Error(`找不到账号 ${acc.username}，学习数据挂不上`); }

    if (acc.learning === 'default') {
      plans.push({
        userId, username: acc.username,
        records: learningSeed.defaultSet.records,
        exams: learningSeed.defaultSet.timeline.exams,
        todayAt: learningSeed.defaultSet.timeline.today,
      });
    } else {
      const set = learningSeed.students[acc.learning];
      if (!set) {
        throw new Error(
          `账号 ${acc.username} 要学习数据集「${acc.learning}」，但 learning-students.json 里只有：` +
          Object.keys(learningSeed.students).join(' / '),
        );
      }
      plans.push({ userId, username: acc.username, records: set.records });
    }
  }

  const nodeNames = new Map(nodes.map((n) => [n.id, n.name]));
  const learnCounts: LearningCounts = await seedLearning(prisma, axisNodeIds, plans, nodeNames);
  const demoUser = userIdOf.get('student');
  const extra = demoUser === undefined
    ? { favorites: 0, notes: 0 }
    : await seedDemoFavoritesAndNotes(prisma, demoUser);
  learnCounts.favorites = extra.favorites;
  learnCounts.notes = extra.notes;

  console.log(
    `\n学习数据：${learnCounts.records} 格记录（${learnCounts.withTrajectory} 格有轨迹）/ ` +
    `${learnCounts.events} 个事件 / ${learnCounts.exams} 场考试 / ${learnCounts.papers} 道卷面 / ` +
    `${learnCounts.mistakes} 道错题 / ${learnCounts.marks} 个标记`,
  );
  console.log(`演示账号的收藏 ${learnCounts.favorites} 条、笔记 ${learnCounts.notes} 条（这两个 seed/ 里没有，是按真实节点造的演示数据）`);

  /* ---- 9) 题库（M4）与论坛（M5） ---- */
  const practiceSeed = readPracticeSeed(SEED);
  const practiceCounts: PracticeCounts = await seedPractice(prisma, practiceSeed);
  console.log(
    `\n题库：${practiceCounts.total} 道 —— 可判分 ${practiceCounts.choice + practiceCounts.blank} 道` +
    `（单选 ${practiceCounts.choice} / 填空 ${practiceCounts.blank}）` +
    `，只有题面 ${practiceCounts.board} 道（白板那些，判不了分）`,
  );

  const forumSeed = readForumSeed(SEED);
  const forumCounts: ForumCounts = await seedForum(prisma, forumSeed);
  console.log(`论坛：${forumCounts.boards} 块板 / ${forumCounts.posts} 帖 / ${forumCounts.replies} 条回复（从 localStorage 那份搬进库）`);

  /* ---- 10) 对数：逐项比 seed/_counts.json ---- */
  const kindCounts = await prisma.node.groupBy({ by: ['kind'], _count: { _all: true } });
  const actual: Record<string, number> = {
    treeNodes: await prisma.node.count(),
    axisItems: axisNodeIds.length,
    /* 册 / 章 / 节 / 知识点 的总数取**轴统计**：它跟轴走的是同一遍遍历，
       轴规则要是被改坏了，这几行会立刻报红。 */
    book: axis.total.book,
    chapter: axis.total.chapter,
    section: axis.total.section,
    point: axis.total.point,
  };
  kindCounts.forEach((k) => { actual[k.kind] = k._count._all; });

  /* 学习数据那几行不写死数字，**从刚组装好的 plans 现算**：
     写死就等于抄一遍预期答案，输入真丢了也看不出来。 */
  const wantRecords = plans.reduce((a, p) => a + p.records.length, 0);
  const wantWithTraj = plans.reduce((a, p) => a + p.records.filter((r) => r.events && r.events.length).length, 0);
  const wantEvents = plans.reduce(
    (a, p) => a + p.records.reduce((b, r) => b + (r.events ?? []).length, 0), 0,
  );
  const wantExams = plans.reduce((a, p) => a + (p.exams ?? []).length, 0);
  const wantPapers = plans.reduce((a, p) => a + (p.exams ?? []).reduce((b, e) => b + e.paper.length, 0), 0);
  const wantMistakes = plans.reduce(
    (a, p) => a + (p.exams ?? []).reduce((b, e) => b + e.paper.filter((q) => q.score * 5 < q.full * 3).length, 0), 0,
  );

  const checks: [string, number, number][] = [
    ['tree 总节点', counts.treeNodes ?? 0, actual.treeNodes ?? 0],
    ['册 book', counts.book ?? 0, actual.book ?? 0],
    ['章 chapter', counts.chapter ?? 0, actual.chapter ?? 0],
    ['节 section', counts.section ?? 0, actual.section ?? 0],
    ['知识点 point', counts.point ?? 0, actual.point ?? 0],
    ['轴的格子', counts.axisItems ?? 0, actual.axisItems ?? 0],
    ['卡片类型', 6, await prisma.cardType.count()],
    ['卡片', cardRows.length, await prisma.card.count()],
    ['正文条数', counts.authoredContents ?? 0, await prisma.content.count()],
    ['正文字符数', counts.authoredChars ?? 0, authoredChars],
    ['角色', ROLES.length, await prisma.role.count()],
    ['权限点', PERMS.length, await prisma.permission.count()],
    ['演示账号', DEMO_ACCOUNTS.length, await prisma.user.count()],
    ['学习记录', wantRecords, await prisma.learningRecord.count()],
    ['有轨迹的格', wantWithTraj, await prisma.learningRecord.count({ where: { events: { some: {} } } })],
    ['轨迹事件', wantEvents, await prisma.learningEvent.count()],
    ['考试', wantExams, await prisma.exam.count()],
    ['卷面题', wantPapers, await prisma.examPaper.count()],
    ['错题', wantMistakes, await prisma.mistake.count()],
    ['可判分的题', counts.practiceQuestions ?? 0, await prisma.question.count({ where: { kind: { in: ['choice', 'blank'] } } })],
    ['只有题面的题', counts.wbProblems ?? 0, await prisma.question.count({ where: { kind: 'board' } })],
    ['论坛板', counts.forumBoards ?? 0, await prisma.board.count()],
    ['论坛帖', counts.forumPosts ?? 0, await prisma.post.count()],
    ['论坛回复', forumSeed.posts.reduce((a, p) => a + (p.floors ? p.floors.length : 0), 0), await prisma.reply.count()],
  ];

  console.log('\n导库对数（seed/ 现算  vs  库里实际）：');
  let bad = 0;
  checks.forEach(([label, want, got]) => {
    const ok = want === got;
    if (!ok) bad += 1;
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label.padEnd(14)} ${String(want).padStart(6)}  ${String(got).padStart(6)}`);
  });
  console.log(bad === 0 ? '\n全部一致。' : `\n有 ${bad} 项对不上 —— 别放过。`);
  if (bad > 0) process.exitCode = 1;
}

main()
  .catch((err: unknown) => {
    console.error('[seed] 导库失败：', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
