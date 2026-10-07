/* ==========================================================================
   知识轴 · 谁上轴、按什么顺序（服务端唯一一份）
   --------------------------------------------------------------------------
   "轴"是时间轴 / 3D 数轴那一根。它**不是把树拍平**，而是有条件地挑节点：

       point   一律上轴
       section 只在**没有 point 子节点**时上（有知识点就让位给知识点）
       chapter 只在**没有 section / point 直接子节点**时上
               （竞赛那四支的章底下只有章名，不认这一步整段竞赛就会从轴上消失）
       group / method / error / exam / formula / book / track / root  一律不上
       （group 那三类是"知识点卡片里的料"，不是学习路径上的一格）

   规则**逐条对照** assets/js/timeline-axis.js 的 buildAxis() 写的。
   为什么搬到服务端：后台改完树之后，学习记录要按新的轴顺序摆进数组 ——
   如果这条规则同时存在于前端、导库、接口三处，改一处忘两处，症状是
   "卡片挂到隔壁格上，数量还照样对得上"，极难查。

   为什么是**现算**而不是在节点上存一个 axisIndex：存了就得在每次增删改之后
   重排全部学生的学习记录；漏一次就永远对不上，而且没人会记得。
   现算只是 1391 行的一次 DFS，代价可以忽略。
   ========================================================================== */
import { prisma } from '../../db.js';

export type AxisNode = {
  id: number;
  kind: string;
  name: string;
  parentId: number | null;
  order: number;
};

export type AxisResult = {
  /** 轴上的节点 id，按顺序（第 i 个元素就是轴上第 i 格） */
  order: number[];
  /** 节点 id → 轴上第几格 */
  at: Map<number, number>;
  /** 各类节点总数（对数用） */
  total: { book: number; chapter: number; section: number; point: number };
};

/**
 * 从库里读全部节点算一次轴。
 * @param rows 已经有节点表时可以传进来，省一次查询（导库时用得上）
 */
export function buildAxisFrom(rows: AxisNode[]): AxisResult {
  const kidsOf = new Map<number | null, AxisNode[]>();
  for (const r of rows) {
    const list = kidsOf.get(r.parentId);
    if (list) { list.push(r); } else { kidsOf.set(r.parentId, [r]); }
  }
  /* 同一父节点下按 order 排 —— 与前端一致（前端拿到的树本来就是排好的） */
  for (const list of kidsOf.values()) { list.sort((a, b) => a.order - b.order || a.id - b.id); }

  const roots = kidsOf.get(null) ?? [];
  if (roots.length !== 1) {
    throw new Error(`知识树应该只有一个根，现在有 ${roots.length} 个 —— 先跑 npm run db:seed`);
  }

  const order: number[] = [];
  const total = { book: 0, chapter: 0, section: 0, point: 0 };

  function walk(node: AxisNode): void {
    const kids = kidsOf.get(node.id) ?? [];
    const finer = kids.filter((k) => k.kind === 'section' || k.kind === 'point');

    if (node.kind === 'book') { total.book += 1; }
    else if (node.kind === 'chapter') {
      total.chapter += 1;
      if (!finer.length) { order.push(node.id); }
    } else if (node.kind === 'section') {
      total.section += 1;
      if (!kids.some((k) => k.kind === 'point')) { order.push(node.id); }
    } else if (node.kind === 'point') {
      total.point += 1;
      order.push(node.id);
    }

    kids.forEach(walk);
  }

  walk(roots[0]!);

  const at = new Map<number, number>();
  order.forEach((id, i) => at.set(id, i));
  return { order, at, total };
}

export async function computeAxis(): Promise<AxisResult> {
  const rows = await prisma.node.findMany({
    select: { id: true, kind: true, name: true, parentId: true, order: true },
  });
  return buildAxisFrom(rows);
}
