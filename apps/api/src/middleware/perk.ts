/* ==========================================================================
   按"服务项目"放行 —— 也就是"后台配的套餐到底管不管用"
   --------------------------------------------------------------------------
   设计稿 §3.6：**能不能用某个功能，判定必须在服务端**。这一份就是那个判定。
   后台在「套餐与服务项目」页勾掉某一项，这里立刻不放行 —— 不用改代码、不用发版。

   有一类功能**服务端拦不住**（典型是 3D 图谱）：它的数据来自公开的知识树接口，
   服务端给不出"这一份数据只给会员"的切法。那种只能在前台按 /api/me/entitlement
   给的 perks 决定渲不渲染。这不是偷懒，是这类功能本身的性质 ——
   所以这里同时导出两条路：
     · requirePerk(code) 服务端拦得住的那类（题库、题解、额度）
     · canUse / perkOf   前台要用的同一份判定（两边用的是同一个函数，不会各算各的）
   ========================================================================== */
import type { RequestHandler } from 'express';
import { currentEntitlement, loadPerks, type Perk } from '../modules/plans/plans.routes.js';

/** 这个人当前的这一项是什么样。`undefined` = 没有这一项（免费版不含）。 */
export async function perkOf(userId: number, code: string): Promise<Perk | undefined> {
  const ent = await currentEntitlement(userId);
  if (!ent.plan) { return undefined; }
  const perks = await loadPerks(ent.plan.code);
  return perks[code];
}

export async function canUse(userId: number, code: string): Promise<boolean> {
  return (await perkOf(userId, code)) !== undefined;
}

/**
 * 额度。三层含义要分清，别混：
 *   undefined → 根本没有这一项（要开通）
 *   null      → 有这一项，但不限量
 *   数字      → 有这一项，上限就是这个数
 */
export async function quotaOf(userId: number, code: string): Promise<number | null | undefined> {
  const p = await perkOf(userId, code);
  return p === undefined ? undefined : p.quota;
}

/** 按服务项目放行。缺哪一项明确告诉前台，好让它直接给出"去开通"的入口。 */
export function requirePerk(code: string): RequestHandler {
  return async (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: '请先登录' } });
      return;
    }
    if (!(await canUse(req.user.id, code))) {
      res.status(403).json({
        error: {
          code: 'PERK_REQUIRED',
          message: '这一项要开通会员才能用',
          /** 缺的是哪一项 —— 前台照这个说清楚"要开通什么" */
          perk: code,
        },
      });
      return;
    }
    next();
  };
}
