/* ==========================================================================
   知识树 · 取数
   --------------------------------------------------------------------------
   一次拉全树。**章节 / 图谱 / 时间轴 三处共用这一份** —— 所以这里不按页面裁剪字段，
   前端的规矩是"树里有什么就画什么"。

   返回的形状与前端原来的 `window.MATH_TREE` **一模一样**（学生端要能直接换数据源、
   视图层一行不动），只多了一个 `id`：前端会忽略不认识的字段，而正文要靠它去取。
   ========================================================================== */
import { createHash } from 'node:crypto';
import { prisma } from '../../db.js';

export type TreeNode = {
  id: number;
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

/** 一棵树 + 它的内容哈希。哈希给缓存用：树没变，ETag 就不变，前端不用重下。 */
export async function loadTree(): Promise<{ version: string; tree: TreeNode }> {
  const rows = await prisma.node.findMany({
    orderBy: [{ parentId: 'asc' }, { order: 'asc' }, { id: 'asc' }],
  });

  const byId = new Map<number, TreeNode>();
  for (const r of rows) {
    const node: TreeNode = { id: r.id, kind: r.kind, name: r.name };
    /* 只把**有值**的字段放进去。前端里有 `'no' in node` 这类判断 —— 塞一堆 null
       进去看着差不多，行为不一定一样。 */
    if (r.no !== null) node.no = r.no;
    if (r.stage !== null) node.stage = r.stage;
    if (r.source !== null) node.source = r.source;
    if (r.field !== null) node.field = r.field;
    if (r.cn !== null) node.cn = r.cn;
    if (r.unit !== null) node.unit = r.unit;
    if (r.pending !== null) node.pending = r.pending;
    if (r.tone !== null) node.tone = r.tone;
    byId.set(r.id, node);
  }

  let root: TreeNode | undefined;
  for (const r of rows) {
    const node = byId.get(r.id);
    if (!node) continue;
    if (r.parentId === null) {
      root = node;
      continue;
    }
    const parent = byId.get(r.parentId);
    if (!parent) continue;
    if (!parent.children) parent.children = [];
    parent.children.push(node);
  }

  if (!root) throw new Error('知识树是空的 —— 先跑 npm run db:seed');

  const version = createHash('sha1').update(JSON.stringify(root)).digest('hex').slice(0, 12);
  return { version, tree: root };
}
