/* ==========================================================================
   /api/admin/plans* 与 /api/admin/services* —— 后台配套餐与服务项目
   --------------------------------------------------------------------------
   用户的原话："我们的系统收费可以在后台设置套餐和服务项目，然后在前台显示出来。"

   这张配置就是**两列一矩阵**：
     · 列 = 套餐（免费 / 半年 / 一年 / 三年）—— 可改名称、价格、时长、卖点、推荐、上架、排序
     · 行 = 服务项目 —— 可增删改、排序、上下架
     · 交叉的每一格 = `PlanService`（含不含 + 这一格显示什么字）

   为什么下单接口不在这里：这一版只做到"配得出来、前台看得到"。
   订单与支付是下一步（要商户号），但**权益判定的位置现在就定下了** ——
   在服务端（`/api/me/entitlement`），前台藏个按钮不算权限（设计稿 §3.6）。
   ========================================================================== */
import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../../openapi.js';
import { prisma } from '../../db.js';
import { requireAuth, requirePerm } from '../../middleware/auth.js';

const Err = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const IdParam = z.object({ id: z.coerce.number().int().positive() });

/* 价格一律**以分入库**，接口也收分 —— 让"元"只出现在界面那一层，
   中间任何一环都不做浮点换算。 */
const PlanIn = z.object({
  code: z.string().min(1).max(32).regex(/^[a-z0-9-]+$/).describe('英文代号，建了之后不改'),
  name: z.string().min(1).max(64),
  priceCents: z.number().int().min(0).max(100_000_000),
  originalCents: z.number().int().min(0).max(100_000_000).optional(),
  days: z.number().int().min(0).max(36500),
  tagline: z.string().max(191).nullable().optional(),
  featured: z.boolean().optional(),
  active: z.boolean().optional(),
  order: z.number().int().optional(),
});

const PlanPatch = PlanIn.partial().omit({ code: true });

const ServiceIn = z.object({
  code: z.string().min(1).max(32).regex(/^[a-z0-9_]+$/),
  name: z.string().min(1).max(64),
  desc: z.string().max(191).nullable().optional(),
  order: z.number().int().optional(),
  active: z.boolean().optional(),
});
const ServicePatch = ServiceIn.partial().omit({ code: true });

/** 改一格：这个套餐在这一项上是"有"还是"没有"，以及要显示什么字 */
const CellIn = z.object({
  planId: z.number().int().positive(),
  serviceId: z.number().int().positive(),
  included: z.boolean(),
  value: z.string().max(64).nullable().optional(),
});

registry.registerPath({
  method: 'get', path: '/api/admin/plans', summary: '套餐与服务项目全量配置（需 plan.write）',
  responses: { 200: { description: '配置' }, 403: { description: '没权限' } },
});
registry.registerPath({
  method: 'post', path: '/api/admin/plans', summary: '新增套餐（需 plan.write）',
  request: { body: { content: { 'application/json': { schema: PlanIn } } } },
  responses: { 201: { description: '建好了' }, 409: { description: '代号重复', content: { 'application/json': { schema: Err } } } },
});
registry.registerPath({
  method: 'patch', path: '/api/admin/plans/{id}', summary: '改套餐（需 plan.write）',
  request: { params: IdParam, body: { content: { 'application/json': { schema: PlanPatch } } } },
  responses: { 200: { description: '改好了' }, 404: { description: '没有这个套餐' } },
});
registry.registerPath({
  method: 'delete', path: '/api/admin/plans/{id}', summary: '删套餐（需 plan.write；有人买过就不许删）',
  request: { params: IdParam },
  responses: { 200: { description: '删掉了' }, 400: { description: '有人在用，改成下架' } },
});
registry.registerPath({
  method: 'post', path: '/api/admin/services', summary: '新增服务项目（需 plan.write）',
  request: { body: { content: { 'application/json': { schema: ServiceIn } } } },
  responses: { 201: { description: '建好了' }, 409: { description: '代号重复' } },
});
registry.registerPath({
  method: 'patch', path: '/api/admin/services/{id}', summary: '改服务项目（需 plan.write）',
  request: { params: IdParam, body: { content: { 'application/json': { schema: ServicePatch } } } },
  responses: { 200: { description: '改好了' } },
});
registry.registerPath({
  method: 'delete', path: '/api/admin/services/{id}', summary: '删服务项目（需 plan.write）',
  request: { params: IdParam },
  responses: { 200: { description: '删掉了' } },
});
registry.registerPath({
  method: 'put', path: '/api/admin/plan-services', summary: '改矩阵里的一格（需 plan.write）',
  request: { body: { content: { 'application/json': { schema: CellIn } } } },
  responses: { 200: { description: '改好了' } },
});

export const plansAdminRouter = Router();

type PlanRow = {
  id: number; code: string; name: string; priceCents: number; originalCents: number;
  days: number; tagline: string | null; featured: boolean; active: boolean; order: number;
};

/* ---------------- 全量配置 ---------------- */

async function fullConfig() {
  const [plans, services, links] = await Promise.all([
    prisma.plan.findMany({ orderBy: [{ order: 'asc' }, { id: 'asc' }] }),
    prisma.serviceItem.findMany({ orderBy: [{ order: 'asc' }, { id: 'asc' }] }),
    prisma.planService.findMany(),
  ]);
  /* 每个人的订阅数：删套餐前要拦"有人买过" */
  const subCounts = await prisma.subscription.groupBy({ by: ['planId'], _count: { _all: true } });
  const subsOf = new Map(subCounts.map((s) => [s.planId, s._count._all]));

  return {
    plans: plans.map((p) => ({ ...p, subscribers: subsOf.get(p.id) ?? 0 })),
    services,
    /* 矩阵：`${planId}:${serviceId}` → 那一格 */
    cells: links.map((l) => ({
      planId: l.planId, serviceId: l.serviceId, included: l.included, value: l.value,
    })),
  };
}

plansAdminRouter.get('/admin/plans', requireAuth, requirePerm('plan.write'), async (_req, res) => {
  res.json(await fullConfig());
});

/* ---------------- 套餐 ---------------- */

plansAdminRouter.post('/admin/plans', requireAuth, requirePerm('plan.write'), async (req, res) => {
  const parsed = PlanIn.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '入参不对' } });
    return;
  }
  const d = parsed.data;
  if (await prisma.plan.findUnique({ where: { code: d.code } })) {
    res.status(409).json({ error: { code: 'TAKEN', message: `代号 ${d.code} 已经用了` } });
    return;
  }
  const last = await prisma.plan.findFirst({ orderBy: { order: 'desc' }, select: { order: true } });
  const created = await prisma.plan.create({
    data: {
      code: d.code, name: d.name, priceCents: d.priceCents,
      originalCents: d.originalCents ?? 0, days: d.days,
      tagline: d.tagline ?? null, featured: d.featured ?? false,
      active: d.active ?? true, order: d.order ?? ((last?.order ?? -1) + 1),
    },
  });

  /* 新套餐的每一格默认"不含" —— 配出来就是漏的，不会看起来"包含" */
  const services = await prisma.serviceItem.findMany({ select: { id: true } });
  if (services.length) {
    await prisma.planService.createMany({
      data: services.map((s) => ({ planId: created.id, serviceId: s.id, included: false, value: null })),
    });
  }

  res.status(201).json({ plan: created as PlanRow });
});

plansAdminRouter.patch('/admin/plans/:id', requireAuth, requirePerm('plan.write'), async (req, res) => {
  const id = IdParam.safeParse(req.params);
  const body = PlanPatch.safeParse(req.body ?? {});
  if (!id.success) { res.status(400).json({ error: { code: 'BAD_PARAM', message: 'id 得是正整数' } }); return; }
  if (!body.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: body.error.issues[0]?.message ?? '入参不对' } });
    return;
  }
  const exists = await prisma.plan.findUnique({ where: { id: id.data.id } });
  if (!exists) { res.status(404).json({ error: { code: 'NO_PLAN', message: '没有这个套餐' } }); return; }

  const updated = await prisma.plan.update({ where: { id: id.data.id }, data: body.data });
  res.json({ plan: updated as PlanRow });
});

plansAdminRouter.delete('/admin/plans/:id', requireAuth, requirePerm('plan.write'), async (req, res) => {
  const id = IdParam.safeParse(req.params);
  if (!id.success) { res.status(400).json({ error: { code: 'BAD_PARAM', message: 'id 得是正整数' } }); return; }

  const subs = await prisma.subscription.count({ where: { planId: id.data.id } });
  if (subs > 0) {
    res.status(400).json({
      error: { code: 'IN_USE', message: `有 ${subs} 个人的订阅指着这个套餐，删不得 —— 请改成"下架"` },
      subscribers: subs,
    });
    return;
  }
  const plan = await prisma.plan.findUnique({ where: { id: id.data.id } });
  if (!plan) { res.status(404).json({ error: { code: 'NO_PLAN', message: '没有这个套餐' } }); return; }
  if (plan.code === 'free') {
    res.status(400).json({ error: { code: 'FREE_REQUIRED', message: '免费版是兜底的那一档，不能删' } });
    return;
  }

  await prisma.planService.deleteMany({ where: { planId: plan.id } });
  await prisma.plan.delete({ where: { id: plan.id } });
  res.json({ deleted: 1 });
});

/* ---------------- 服务项目 ---------------- */

plansAdminRouter.post('/admin/services', requireAuth, requirePerm('plan.write'), async (req, res) => {
  const parsed = ServiceIn.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '入参不对' } });
    return;
  }
  const d = parsed.data;
  if (await prisma.serviceItem.findUnique({ where: { code: d.code } })) {
    res.status(409).json({ error: { code: 'TAKEN', message: `代号 ${d.code} 已经用了` } });
    return;
  }
  const last = await prisma.serviceItem.findFirst({ orderBy: { order: 'desc' }, select: { order: true } });
  const created = await prisma.serviceItem.create({
    data: {
      code: d.code, name: d.name, desc: d.desc ?? null,
      order: d.order ?? ((last?.order ?? -1) + 1), active: d.active ?? true,
    },
  });

  /* 新的一行给所有套餐补上"不含" */
  const plans = await prisma.plan.findMany({ select: { id: true } });
  if (plans.length) {
    await prisma.planService.createMany({
      data: plans.map((p) => ({ planId: p.id, serviceId: created.id, included: false, value: null })),
    });
  }
  res.status(201).json({ service: created });
});

plansAdminRouter.patch('/admin/services/:id', requireAuth, requirePerm('plan.write'), async (req, res) => {
  const id = IdParam.safeParse(req.params);
  const body = ServicePatch.safeParse(req.body ?? {});
  if (!id.success) { res.status(400).json({ error: { code: 'BAD_PARAM', message: 'id 得是正整数' } }); return; }
  if (!body.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: body.error.issues[0]?.message ?? '入参不对' } });
    return;
  }
  const exists = await prisma.serviceItem.findUnique({ where: { id: id.data.id } });
  if (!exists) { res.status(404).json({ error: { code: 'NO_SERVICE', message: '没有这个服务项目' } }); return; }
  const updated = await prisma.serviceItem.update({ where: { id: id.data.id }, data: body.data });
  res.json({ service: updated });
});

plansAdminRouter.delete('/admin/services/:id', requireAuth, requirePerm('plan.write'), async (req, res) => {
  const id = IdParam.safeParse(req.params);
  if (!id.success) { res.status(400).json({ error: { code: 'BAD_PARAM', message: 'id 得是正整数' } }); return; }
  const exists = await prisma.serviceItem.findUnique({ where: { id: id.data.id } });
  if (!exists) { res.status(404).json({ error: { code: 'NO_SERVICE', message: '没有这个服务项目' } }); return; }
  /* 连带删掉它在各套餐上的那一格（PlanService 是级联） */
  await prisma.serviceItem.delete({ where: { id: id.data.id } });
  res.json({ deleted: 1 });
});

/* ---------------- 矩阵的一格 ---------------- */

plansAdminRouter.put('/admin/plan-services', requireAuth, requirePerm('plan.write'), async (req, res) => {
  const parsed = CellIn.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '入参不对' } });
    return;
  }
  const { planId, serviceId, included, value } = parsed.data;
  const [plan, service] = await Promise.all([
    prisma.plan.findUnique({ where: { id: planId }, select: { id: true } }),
    prisma.serviceItem.findUnique({ where: { id: serviceId }, select: { id: true } }),
  ]);
  if (!plan || !service) {
    res.status(400).json({ error: { code: 'BAD_REF', message: '套餐或服务项目不存在' } });
    return;
  }

  const cell = await prisma.planService.upsert({
    where: { planId_serviceId: { planId, serviceId } },
    create: { planId, serviceId, included, value: value ?? null },
    update: { included, value: value ?? null },
  });
  res.json({ cell });
});
