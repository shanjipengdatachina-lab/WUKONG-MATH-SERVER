/* ==========================================================================
   导入「公式速查」的卡片（seed/content-formulas.json → 知识树）
   --------------------------------------------------------------------------
   为什么另起一份 seed，而不是往 math-tree.json 里塞：
   math-tree.json 是**冻结快照**（1391 个节点，导库时逐条复刻）。往里加东西要重导整棵树，
   而重导会连带把演示数据（会员、订单）一起冲掉。公式是**增量**，用增量文件表达更合适。

   落点：挂在章下面，形状与既有的两种桶完全一样 ——
     章 → group(方法速学, tone=method) → method 卡片
     章 → group(易错速析, tone=error)  → error 卡片
     章 → group(公式速查, tone=formula) → formula 卡片   ← 本文建的

   公式正文放哪：放在节点的 **Content** 里（`<p>公式</p>`）。
   理由：Content 是这个模型里唯一的正文位，而且后台的节点编辑器本来就能改它 ——
   于是"学生卡片上那句话"和"方法/易错卡片上那句话"走的是同一条路（取正文首段），
   不用为公式多发明一个字段。

   幂等：按 (parentId, kind, name) 找，找到就更新、没找到才建。反复跑不会长出重复节点。
   ========================================================================== */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const here = dirname(fileURLToPath(import.meta.url));
/** seed/ 在仓库根下（apps/api/src/seed → ../../../seed） */
const SEED_FILE = resolve(here, '../../../../seed/content-formulas.json');

const GROUP_NAME = '公式速查';
const GROUP_TONE = 'formula';

type Card = { name: string; formula: string; code: string };
type Group = { book: string; bookLabel: string; chapter: string; cards: Card[] };

export type FormulaSeed = { groups: Group[] };

function readSeed(path: string): FormulaSeed {
  return JSON.parse(readFileSync(path, 'utf8')) as FormulaSeed;
}

export async function importFormulas(prisma: PrismaClient, seedPath = SEED_FILE): Promise<void> {
  const seed = readSeed(seedPath);
  const root = await prisma.node.findFirst({ where: { kind: 'root' } });
  if (!root) { throw new Error('没有 root 节点 —— 先把知识树导进去（npm run db:seed）'); }

  const report: string[] = [];
  let created = 0;
  let updated = 0;

  for (const g of seed.groups) {
    const book = await prisma.node.findFirst({
      where: { kind: 'book', name: g.book, parentId: root.id },
    });
    if (!book) { throw new Error(`找不到册：${g.book}`); }

    const chapter = await prisma.node.findFirst({
      where: { kind: 'chapter', name: g.chapter, parentId: book.id },
    });
    if (!chapter) { throw new Error(`找不到章：${g.book} / ${g.chapter}`); }

    /* 桶：这一章下若已有"公式速查"，复用；否则建在现有兄弟之后 */
    let group = await prisma.node.findFirst({
      where: { kind: 'group', name: GROUP_NAME, parentId: chapter.id },
    });
    if (!group) {
      const siblings = await prisma.node.count({ where: { parentId: chapter.id } });
      group = await prisma.node.create({
        data: {
          kind: 'group', name: GROUP_NAME, tone: GROUP_TONE,
          parentId: chapter.id, order: siblings,
        },
      });
    }

    const existing = await prisma.node.findMany({
      where: { parentId: group.id, kind: 'formula' },
    });
    const byName = new Map(existing.map((n) => [n.name, n]));

    /* 用 entries() 而不是 g.cards[i] —— 开了 noUncheckedIndexedAccess，下标取出来是 T | undefined */
    for (const [i, c] of g.cards.entries()) {
      const no = String(i + 1);
      const html = `<p>${c.formula || ''}</p>`;
      const prev = byName.get(c.name);

      if (prev) {
        await prisma.node.update({ where: { id: prev.id }, data: { no, order: i } });
        await upsertContent(prisma, prev.id, html);
        updated += 1;
      } else {
        const node = await prisma.node.create({
          data: { kind: 'formula', name: c.name, no, parentId: group.id, order: i },
        });
        await upsertContent(prisma, node.id, html);
        created += 1;
      }
    }
    report.push(`  ${g.bookLabel} ${g.chapter} → ${g.cards.length} 条`);
  }

  console.log('[formulas] 公式速查已入库：');
  report.forEach((l) => console.log(l));
  console.log(`[formulas] 新建 ${created} 条 / 更新 ${updated} 条`);
}

/** 正文只写 v1（没有才写）—— 已经有人改过的节点，**不许被重导覆盖**。
    这和导库那条规矩一致：seed 负责"第一次落下来"，之后编辑走后台，不再由 seed 说了算。 */
async function upsertContent(prisma: PrismaClient, nodeId: number, html: string): Promise<void> {
  const exists = await prisma.content.findFirst({ where: { nodeId, version: 1 } });
  if (exists) { return; }
  await prisma.content.create({ data: { nodeId, version: 1, html, publishedAt: new Date() } });
}

/* 直接跑：tsx src/seed/formulas.ts */
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const prisma = new PrismaClient();
  importFormulas(prisma)
    .catch((e) => { console.error('[formulas] 失败：', e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
