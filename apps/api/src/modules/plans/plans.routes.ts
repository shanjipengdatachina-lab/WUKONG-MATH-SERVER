/* ==========================================================================
   /api/plans（公开）+ /api/me/entitlement（需登录）—— 会员与套餐
   --------------------------------------------------------------------------
   前台的会员中心整页都靠这两个接口，**一个价格都不写死在页面里** ——
   用户的原话："我们的系统收费可以在后台设置套餐和服务项目，然后在前台显示出来。"

   出参形状是**照着那张对比表来的**：行 = 服务项目，列 = 套餐。
   所以 services 里每一项带一张 `values` 表（键是套餐 code）——
   前端拿到就能直接画表格，不用自己去拼两个数组。
   ========================================================================== */
import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../../openapi.js';
import { prisma } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';

const PlanOut = z.object({
  code: z.string(), name: z.string(),
  priceCents: z.number().describe('价格，单位分'),
  originalCents: z.number().describe('划线原价，0 = 不显示'),
  days: z.number().describe('时长（天），0 = 不过期'),
  tagline: z.string().nullable(),
  featured: z.boolean(),
});

const CellOut = z.object({
  included: z.boolean(),
  value: z.string().nullable().describe('这一格要显示的字（"不限" / "进阶"）；空着就显示 ✓'),
});

const ServiceOut = z.object({
  code: z.string(), name: z.string(), desc: z.string().nullable(),
  values: z.record(z.string(), CellOut).describe('键 = 套餐 code'),
});

const PlansOut = z.object({
  plans: z.array(PlanOut),
  services: z.array(ServiceOut),
  version: z.string().describe('内容哈希，客户端可用它做协商缓存'),
});

const PerkOut = z.object({
  value: z.string().nullable().describe('这一项要显示的字；空着前台就显示 ✓'),
  quota: z.number().nullable().describe('数量上限；null = 不限（或这一项不是额度型）'),
});

const EntitlementOut = z.object({
  plan: PlanOut.nullable().describe('当前生效的套餐；没买过就是免费版'),
  endAt: z.string().nullable().describe('到期时间；免费版为 null'),
  isMember: z.boolean().describe('**判定在服务端** —— 前台藏个按钮不算权限'),
  daysLeft: z.number().nullable(),
  perks: z.record(z.string(), PerkOut)
    .describe('服务 code → 这一项的样子。**只列包含的**，键不在里面就是没这一项'),
});

registry.registerPath({
  method: 'get', path: '/api/plans', summary: '套餐与服务项目（公开——价目表本来就该先看见）',
  responses: { 200: { description: '套餐表', content: { 'application/json': { schema: PlansOut } } } },
});
registry.registerPath({
  method: 'get', path: '/api/me/entitlement', summary: '我当前的会员权益',
  responses: {
    200: { description: '权益', content: { 'application/json': { schema: EntitlementOut } } },
    401: { description: '未登录' },
  },
});

export const plansRouter = Router();

function planOut(p: {
  code: string; name: string; priceCents: number; originalCents: number;
  days: number; tagline: string | null; featured: boolean;
}) {
  return {
    code: p.code, name: p.name, priceCents: p.priceCents, originalCents: p.originalCents,
    days: p.days, tagline: p.tagline, featured: p.featured,
  };
}

/** 免费版的 code。没买过任何东西的人都按它算。 */
const FREE_CODE = 'free';

/**
 * 谁当前是什么套餐。
 * 判定就是**拿 endAt 跟当下比**，不靠定时任务去改标志位 ——
 * 定时任务一旦漏跑，会员就会变成永久的。
 */
export async function currentEntitlement(userId: number): Promise<{
  plan: { code: string; name: string; priceCents: number; originalCents: number; days: number; tagline: string | null; featured: boolean } | null;
  endAt: Date | null;
  isMember: boolean;
  daysLeft: number | null;
}> {
  const now = new Date();
  const sub = await prisma.subscription.findFirst({
    where: {
      userId,
      status: 'active',
      OR: [{ endAt: null }, { endAt: { gt: now } }],
    },
    orderBy: [{ endAt: 'desc' }, { id: 'desc' }],
    include: { plan: true },
  });

  if (sub) {
    const daysLeft = sub.endAt === null
      ? null
      : Math.max(0, Math.ceil((sub.endAt.getTime() - now.getTime()) / 86400000));
    return {
      plan: planOut(sub.plan),
      endAt: sub.endAt,
      /* 免费版也是"有效订阅"，但不算会员 —— 会员特指付费套餐 */
      isMember: sub.plan.code !== FREE_CODE,
      daysLeft,
    };
  }

  const free = await prisma.plan.findUnique({ where: { code: FREE_CODE } });
  return {
    plan: free ? planOut(free) : null,
    endAt: null,
    isMember: false,
    daysLeft: null,
  };
}

plansRouter.get('/plans', async (_req, res) => {
  const [plans, services] = await Promise.all([
    prisma.plan.findMany({ where: { active: true }, orderBy: [{ order: 'asc' }, { id: 'asc' }] }),
    prisma.serviceItem.findMany({
      where: { active: true },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      include: { plans: true },
    }),
  ]);

  const rows = services.map((s) => {
    const values: Record<string, { included: boolean; value: string | null }> = {};
    /* 先把所有上架套餐都填成"不含"，再按勾选覆盖 ——
       这样新加一个套餐时，那一列自动是"—"，不会因为漏配而看起来"包含" */
    plans.forEach((p) => { values[p.code] = { included: false, value: null }; });
    s.plans.forEach((link) => {
      const plan = plans.find((p) => p.id === link.planId);
      if (!plan) { return; }
      values[plan.code] = { included: link.included, value: link.value };
    });
    return { code: s.code, name: s.name, desc: s.desc, values };
  });

  const payload = { plans: plans.map(planOut), services: rows };
  /* 版本哈希：后台改一次价格，前台刷新就能看出来 —— 与 /api/tree 同一套路 */
  const version = createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 12);

  res.setHeader('Cache-Control', 'no-cache');
  res.json({ ...payload, version });
});

/** 一项服务的样子：给人看的字 + 给服务端算的数。 */
export type Perk = { value: string | null; quota: number | null };

/**
 * 某个套餐**实际包含**哪些服务。
 * 判定与显示都从这里出发，全项目只此一处 ——
 * 否则"套餐页上写的"和"接口放行的"迟早会不一样，而且没人会发现（两边都不报错）。
 */
export async function loadPerks(planCode: string): Promise<Record<string, Perk>> {
  const links = await prisma.planService.findMany({
    where: { plan: { code: planCode }, included: true, service: { active: true } },
    include: { service: true },
  });
  const out: Record<string, Perk> = {};
  links.forEach((l) => { out[l.service.code] = { value: l.value, quota: l.quota }; });
  return out;
}

plansRouter.get('/me/entitlement', requireAuth, async (req, res) => {
  const me = req.user!;
  const ent = await currentEntitlement(me.id);

  /* 把"有哪几项、各有多少额度"摊平成一张表给前端：
     省得它自己再跟套餐表对一遍，也省得它自己算"他算不算会员" */
  const perks = ent.plan ? await loadPerks(ent.plan.code) : {};

  res.json({
    plan: ent.plan,
    endAt: ent.endAt ? ent.endAt.toISOString() : null,
    isMember: ent.isMember,
    daysLeft: ent.daysLeft,
    perks,
  });
});
