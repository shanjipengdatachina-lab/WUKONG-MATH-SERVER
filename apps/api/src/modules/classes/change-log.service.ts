/* ==========================================================================
   后台改学生数据的留痕（模块 E）
   --------------------------------------------------------------------------
   这个文件只有一个职责：**保证"改动"和"留痕"一起发生，或者都不发生。**

   为什么值得单开一个文件、还值得为它写这么多注释：
   允许后台改学生的数据，等于给学生的报告、成长曲线、花名册开了**第二个入口**。
   当初的约定是"只读，改数据走各自那一处"，理由是"两边迟早对不上"。
   现在需求变了（老师要能改错录的分数），所以入口开了 —— 但那条担心的东西必须被接住：
   不是"不能开第二个入口"，而是**"不能开一个没人记得的入口"**。

   所以规矩只有一条，而且它是硬的：
     **任何时候都不许绕过 applyChange() 直接 prisma.update / delete 学生数据。**
   因为留痕和改动在**同一个事务**里提交 —— 留痕写不进去，改动也一起回滚。
   这样"忘了记一笔"在物理上就不可能发生。
   ========================================================================== */
import { randomBytes } from 'node:crypto';
import { prisma } from '../../db.js';
import type { Prisma } from '@prisma/client';

/** 一个字段的一次改动 */
export type FieldChange = {
  field: string;
  oldValue: string | null;
  newValue: string | null;
};

/** 同一次保存产生的一批改动共用一个批次号，回放时能看成"一次操作" */
export function newBatchId(): string {
  return randomBytes(12).toString('hex');
}

/** 值 → 留痕里存的字符串。null / undefined 一律记成 null（"本来就没有"），
    不记成空串 —— 空串和"没有"在回放时是两件事。 */
function toText(v: unknown): string | null {
  if (v === null || v === undefined) { return null; }
  if (v instanceof Date) { return v.toISOString(); }
  if (typeof v === 'object') { return JSON.stringify(v); }
  return String(v);
}

/**
 * 比对"改之前"和"这次要写的"，只留下**真的变了**的字段。
 *
 * 为什么要比：照单全写会留下"掌握度 85 → 85"这种噪音，看变更记录的人
 * 得先学会忽略一半的行。而且它会让"这次到底改了什么"变得看不出来。
 */
export function diffOf(
  before: Record<string, unknown>,
  next: Record<string, unknown>,
): FieldChange[] {
  const out: FieldChange[] = [];
  for (const field of Object.keys(next)) {
    const b = next[field];
    if (b === undefined) { continue; }          // undefined = 这次没打算改它
    const oldText = toText(before[field]);
    const newText = toText(b);
    if (oldText === newText) { continue; }
    out.push({ field, oldValue: oldText, newValue: newText });
  }
  return out;
}

/**
 * 改一笔数据，并记一笔留痕。**两件事在同一个事务里。**
 *
 * `write` 拿到的是事务客户端 —— 调用方**必须**用它来写，不能用外面的 prisma，
 * 否则那段写就不在事务里，留痕失败时它照样提交了，"一起回滚"的保证就没了。
 *
 * 没有任何字段真的变化时**直接抛错**，而不是静默放行：
 * 调用方应该在调之前就用 diffOf 判断，真调到这说明调用方算错了 ——
 * 静默返回会让"我明明改了"和"其实没改"看起来一样。
 */
export type Applied<T> = { result: T; batchId: string };

export async function applyChange<T>(opts: {
  actorId: number;
  targetId: number;
  entity: string;
  entityId: string | number;
  label: string;
  reason?: string | null;
  changes: FieldChange[];
  write: (tx: Prisma.TransactionClient) => Promise<T>;
}): Promise<Applied<T>> {
  if (!opts.changes.length) {
    throw new Error('applyChange：没有任何字段发生变化，不该走到这里');
  }
  const batchId = newBatchId();
  const reason = opts.reason ? opts.reason.slice(0, 191) : null;
  const label = opts.label.slice(0, 191);

  return prisma.$transaction<Applied<T>>(async (tx) => {
    const result = await opts.write(tx);
    /* 逐条 create 而不是 createMany：字段数本来就个位数，
       少一个"这个数据库支持不支持 createMany"的变量。 */
    for (const c of opts.changes) {
      await tx.dataChange.create({
        data: {
          batchId,
          actorId: opts.actorId,
          targetId: opts.targetId,
          entity: opts.entity,
          entityId: String(opts.entityId),
          label,
          field: c.field,
          oldValue: c.oldValue,
          newValue: c.newValue,
          reason,
        },
      });
    }
    return { result, batchId };
  });
}

export type ChangeRow = {
  id: number; batchId: string;
  actorId: number; actorName: string;
  entity: string; entityId: string; label: string;
  field: string; oldValue: string | null; newValue: string | null;
  reason: string | null; at: string;
};

/** 一个学生的变更历史，按时间倒序。同一次保存的多行挨在一起（batchId 相同）。 */
export async function listChanges(
  userId: number, opts: { page: number; pageSize: number },
): Promise<{ total: number; items: ChangeRow[] }> {
  const [total, rows] = await Promise.all([
    prisma.dataChange.count({ where: { targetId: userId } }),
    prisma.dataChange.findMany({
      where: { targetId: userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      include: { actor: { select: { username: true, nickname: true } } },
    }),
  ]);

  return {
    total,
    items: rows.map((c) => ({
      id: c.id,
      batchId: c.batchId,
      actorId: c.actorId,
      actorName: c.actor.nickname || c.actor.username,
      entity: c.entity,
      entityId: c.entityId,
      label: c.label,
      field: c.field,
      oldValue: c.oldValue,
      newValue: c.newValue,
      reason: c.reason,
      at: c.createdAt.toISOString(),
    })),
  };
}
