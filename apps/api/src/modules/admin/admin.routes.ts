/* ==========================================================================
   管理后台专用接口
   --------------------------------------------------------------------------
   **每一个都挂 requirePerm** —— 后台接口是权限最该收紧的地方：
   它比学生端能看到更多东西（用户表、统计、将来的订单）。
   权限点写在路由声明上，不在处理函数里手写角色判断（§7.1）。
   ========================================================================== */
import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../../openapi.js';
import { prisma } from '../../db.js';
import { requireAuth, requirePerm } from '../../middleware/auth.js';
import { channelOf, CHANNELS } from '../pay/channels.js';
import { statusOf } from '../pay/pay.service.js';
/* 学生详情页要用的两块，都**复用学生端那一处**，不在这里另写一套：
   · currentEntitlement —— 套餐判定的唯一出处（会员到期也是它算的）
   · sliceReport       —— 考情切片报告的同一个函数（老师看到的数与学生看到的一致） */
import { currentEntitlement } from '../plans/plans.routes.js';
import { sliceReport } from '../slices/slice-report.service.js';
import { hashPassword, setPassword } from '../auth/auth.service.js';
import type { Prisma } from '@prisma/client';

const Stats = z.object({
  nodes: z.record(z.string(), z.number()).describe('按 kind 分组的节点数'),
  nodeTotal: z.number(),
  cards: z.number(),
  contents: z.number(),
  users: z.number(),
  sessionsAlive: z.number(),
  roles: z.number(),
});

const UserRow = z.object({
  id: z.number(), username: z.string(), nickname: z.string(),
  grade: z.string().nullable(), role: z.string(), createdAt: z.string(),
  stage: z.string().nullable().describe('primary | junior | senior | olympiad；null = 还没分学段'),
  className: z.string().nullable().describe('所在班级；null = 没进班'),
  disabledAt: z.string().nullable().describe('停用时间；null = 正常'),
});
const UserList = z.object({
  total: z.number().describe('满足筛选条件的总数（不是这一页的条数）'),
  page: z.number(),
  pageSize: z.number(),
  items: z.array(UserRow),
});

const ErrOut = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** 这一行上能改的：角色、停用、昵称、年级。
    角色**不写死成 enum** —— 角色是库里的一张表；写死就等于"以后加个角色还得改代码，
    忘了改这里接口会静默拒掉"。改成任意 code，存不存在由库判定（NO_ROLE）。 */
const UserPatchIn = z.object({
  role: z.string().min(1).max(32).optional(),
  disabled: z.boolean().optional(),
  nickname: z.string().min(1).max(64).optional(),
  grade: z.string().max(64).nullable().optional(),
});

/** 密码规则与 /auth/register **同一套**（8 位起、字母数字都要有）——
    两处不一样的话，后台建出来的账号会绕过注册那一道。 */
const PasswordIn = z.string().min(8, '密码至少 8 位').max(72)
  .regex(/[A-Za-z]/, '密码要同时含字母和数字').regex(/[0-9]/, '密码要同时含字母和数字');

const UserCreateIn = z.object({
  username: z.string().min(3).max(32).regex(/^[A-Za-z0-9_.-]+$/, '账号只能用字母数字和 _ . -'),
  password: PasswordIn,
  nickname: z.string().min(1).max(32),
  grade: z.string().max(32).nullable().optional(),
  role: z.string().min(1).max(32).default('student'),
});

const PasswordResetIn = z.object({ password: PasswordIn });

/** 库里那行 → 给前端的形状。列表和"改完回一行"共用，免得两边字段慢慢长歪。 */
function toRow(u: {
  id: number; username: string; nickname: string; grade: string | null;
  stage?: string | null;
  role: { code: string }; createdAt: Date; disabledAt: Date | null;
  class?: { name: string } | null;
}) {
  return {
    id: u.id, username: u.username, nickname: u.nickname, grade: u.grade,
    stage: u.stage ?? null,
    className: u.class ? u.class.name : null,
    role: u.role.code, createdAt: u.createdAt.toISOString(),
    disabledAt: u.disabledAt ? u.disabledAt.toISOString() : null,
  };
}

registry.registerPath({
  method: 'get', path: '/api/admin/stats', summary: '后台概览（需 content.read）',
  responses: { 200: { description: '统计', content: { 'application/json': { schema: Stats } } }, 403: { description: '没权限' } },
});
registry.registerPath({
  method: 'get', path: '/api/admin/users', summary: '用户列表（搜索/筛选/分页，需 user.read）',
  responses: { 200: { description: '用户', content: { 'application/json': { schema: UserList } } }, 403: { description: '没权限' } },
});
registry.registerPath({
  method: 'get', path: '/api/admin/roles', summary: '角色字典（需 user.read）',
  responses: { 200: { description: '角色与各自人数' }, 403: { description: '没权限' } },
});
registry.registerPath({
  method: 'post', path: '/api/admin/users', summary: '新建账号（需 user.write）',
  responses: {
    201: { description: '建好了', content: { 'application/json': { schema: UserRow } } },
    400: { description: '入参不对 / 账号重复', content: { 'application/json': { schema: ErrOut } } },
    403: { description: '没权限', content: { 'application/json': { schema: ErrOut } } },
  },
});
registry.registerPath({
  method: 'post', path: '/api/admin/users/{id}/password', summary: '重置密码（需 user.write）',
  responses: {
    200: { description: '改好了，该用户全部会话已吊销' },
    400: { description: '密码不合规', content: { 'application/json': { schema: ErrOut } } },
    404: { description: '没有这个用户', content: { 'application/json': { schema: ErrOut } } },
  },
});
registry.registerPath({
  method: 'delete', path: '/api/admin/users/{id}', summary: '删账号（需 user.write）',
  responses: {
    200: { description: '删好了' },
    403: { description: '没权限', content: { 'application/json': { schema: ErrOut } } },
    404: { description: '没有这个用户', content: { 'application/json': { schema: ErrOut } } },
    409: { description: '不能删自己 / 名下有已付款订单', content: { 'application/json': { schema: ErrOut } } },
  },
});
registry.registerPath({
  method: 'patch', path: '/api/admin/users/{id}', summary: '改角色 / 停用账号（需 user.write）',
  request: { body: { content: { 'application/json': { schema: UserPatchIn } } } },
  responses: {
    200: { description: '改好了', content: { 'application/json': { schema: UserRow } } },
    400: { description: '入参不对', content: { 'application/json': { schema: ErrOut } } },
    403: { description: '没权限', content: { 'application/json': { schema: ErrOut } } },
    404: { description: '没有这个用户', content: { 'application/json': { schema: ErrOut } } },
    409: { description: '不能改自己（这条同时保证了永远剩得下一个管理员）', content: { 'application/json': { schema: ErrOut } } },
  },
});

const OrderAdminRow = z.object({
  orderNo: z.string(),
  username: z.string().describe('下单的人'),
  nickname: z.string(),
  planName: z.string(),
  amountCents: z.number(),
  status: z.string(),
  channel: z.string(),
  channelName: z.string(),
  isTest: z.boolean().describe('走测试通道的单 —— **不许算进"真实收款"**'),
  createdAt: z.string(),
  expiresAt: z.string(),
  paidAt: z.string().nullable(),
});

const OrderAdminList = z.object({
  total: z.number(),
  items: z.array(OrderAdminRow),
  summary: z.object({
    paidCount: z.number(),
    paidCents: z.number().describe('全部已支付（含测试通道）'),
    realPaidCount: z.number(),
    realPaidCents: z.number().describe('**不含测试通道** —— 对账看这个'),
    pendingCount: z.number(),
    expiredCount: z.number(),
  }),
});

registry.registerPath({
  method: 'get', path: '/api/admin/orders', summary: '订单列表与收款概览（需 order.read）',
  responses: {
    200: { description: '订单', content: { 'application/json': { schema: OrderAdminList } } },
    403: { description: '没权限', content: { 'application/json': { schema: ErrOut } } },
  },
});

registry.registerPath({
  method: 'get', path: '/api/admin/orders/export', summary: '导出订单明细 CSV（按当前筛选，需 order.read）',
  responses: { 200: { description: 'text/csv' }, 403: { description: '没权限' } },
});
registry.registerPath({
  method: 'get', path: '/api/admin/finance/summary', summary: '财务收款统计（需 order.read）',
  responses: {
    200: { description: '按日/月趋势 + 分套餐 + 分渠道' },
    400: { description: '日期跨度太长', content: { 'application/json': { schema: ErrOut } } },
    403: { description: '没权限' },
  },
});

export const adminRouter = Router();

adminRouter.get('/admin/stats', requireAuth, requirePerm('content.read'), async (_req, res) => {
  const byKind = await prisma.node.groupBy({ by: ['kind'], _count: { _all: true } });
  const nodes: Record<string, number> = {};
  byKind.forEach((k) => { nodes[k.kind] = k._count._all; });

  const [nodeTotal, cards, contents, users, sessionsAlive, roles] = await Promise.all([
    prisma.node.count(),
    prisma.card.count(),
    prisma.content.count(),
    prisma.user.count(),
    prisma.session.count({ where: { revokedAt: null } }),
    prisma.role.count(),
  ]);

  res.json({ nodes, nodeTotal, cards, contents, users, sessionsAlive, roles });
});

adminRouter.get('/admin/users', requireAuth, requirePerm('user.read'), async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const role = typeof req.query.role === 'string' ? req.query.role : '';
  const status = typeof req.query.status === 'string' ? req.query.status : '';

  /* 分页必须有上限：不给上限的话 pageSize=100000 就是把整张用户表拉给浏览器。 */
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));

  const where: Prisma.UserWhereInput = {};
  if (role) { where.role = { code: role }; }
  /* 状态**藏不住**：库里存的是 disabledAt，筛选条件得翻译过去，
     不能直接拿"status 字段"来查 —— 那个字段根本不存在。 */
  if (status === 'disabled') { where.disabledAt = { not: null }; }
  else if (status === 'normal') { where.disabledAt = null; }
  if (q) {
    where.OR = [{ username: { contains: q } }, { nickname: { contains: q } }];
  }

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      include: { role: true, class: { select: { name: true } } },
      orderBy: { id: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  res.json({ total, page, pageSize, items: rows.map(toRow) });
});

/* ---- 角色字典 ----
   角色是库里的一张表，不是写死的两项。后台的下拉从这儿取 ——
   以后加个"老师"角色，只需往 role 表插一行，前端一行都不用改。 */
adminRouter.get('/admin/roles', requireAuth, requirePerm('user.read'), async (_req, res) => {
  const rows = await prisma.role.findMany({
    orderBy: { id: 'asc' },
    include: { _count: { select: { users: true } } },
  });
  res.json({ items: rows.map((r) => ({ code: r.code, name: r.name, users: r._count.users })) });
});

/* 改角色 / 停用账号。
   只有一条护栏，但它足够：**谁都不能改自己**。
   为什么这一条就等于"永远剩得下一个管理员"：能改用户的人自己必须是管理员（user.write
   只在 admin 角色上），而他不改自己 —— 于是每动掉一个管理员，至少还有他自己在。
   所以不需要再写一条"最后一个管理员不许降级或停用"：那条**永远走不到**
   （改的人自己就是管理员，又不可能是被改的那个），写了只会让下一个人以为它在挡什么事。 */
adminRouter.patch('/admin/users/:id', requireAuth, requirePerm('user.write'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '用户 id 不对' } });
    return;
  }

  const parsed = UserPatchIn.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '入参不对' } });
    return;
  }
  if (parsed.data.role === undefined && parsed.data.disabled === undefined
    && parsed.data.nickname === undefined && parsed.data.grade === undefined) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '没说要改什么' } });
    return;
  }

  const target = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!target) {
    res.status(404).json({ error: { code: 'NO_USER', message: '没有这个用户' } });
    return;
  }

  /* 不能改自己的**角色或停用状态** —— 那一下就把自己关在门外了，没人能把你放回来。
     昵称 / 年级不涉及还能不能进来，自己改自己的没关系。 */
  if (id === req.user!.id && (parsed.data.role !== undefined || parsed.data.disabled !== undefined)) {
    res.status(409).json({ error: { code: 'SELF', message: '不能改自己的角色或停用自己' } });
    return;
  }

  /* 只写**真正变了**的字段 —— 和节点编辑器同一个道理：照单全写会把"本来没打算动的
     东西"一起改掉，而这里动的是账号。两样都没变就一次写都不发。 */
  const data: {
    roleId?: number; disabledAt?: Date | null;
    nickname?: string; grade?: string | null;
  } = {};

  if (parsed.data.role !== undefined && parsed.data.role !== target.role.code) {
    const role = await prisma.role.findUnique({ where: { code: parsed.data.role } });
    if (!role) {
      res.status(400).json({ error: { code: 'NO_ROLE', message: `没有 ${parsed.data.role} 这个角色` } });
      return;
    }
    data.roleId = role.id;
  }

  if (parsed.data.disabled !== undefined && parsed.data.disabled !== (target.disabledAt !== null)) {
    data.disabledAt = parsed.data.disabled ? new Date() : null;
  }

  if (parsed.data.nickname !== undefined && parsed.data.nickname !== target.nickname) {
    data.nickname = parsed.data.nickname;
  }
  if (parsed.data.grade !== undefined && parsed.data.grade !== target.grade) {
    data.grade = parsed.data.grade;
  }

  const updated = Object.keys(data).length
    ? await prisma.user.update({ where: { id }, data, include: { role: true } })
    : target;

  /* 停用之后顺手吊销他全部会话。requireAuth 那边也会拦住已停用的账号，两道都在：
     停用该有的意思是"当场踢出去"，而不是"他那个 cookie 还在、只是每次请求都吃 403"。 */
  if (data.disabledAt instanceof Date) {
    await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  res.json(toRow(updated));
});

/* ---- 新建账号 ----
   角色可以指定 —— 后台建管理员走的就是这里（学生自己注册只能建成学生）。 */
adminRouter.post('/admin/users', requireAuth, requirePerm('user.write'), async (req, res) => {
  const parsed = UserCreateIn.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '入参不对' } });
    return;
  }
  const d = parsed.data;

  const role = await prisma.role.findUnique({ where: { code: d.role } });
  if (!role) {
    res.status(400).json({ error: { code: 'NO_ROLE', message: `没有 ${d.role} 这个角色` } });
    return;
  }

  /* 账号唯一。重复也行会抛 P2002，但先查一次能回一句说得清的话。 */
  const dup = await prisma.user.findUnique({ where: { username: d.username } });
  if (dup) {
    res.status(400).json({ error: { code: 'DUP_USERNAME', message: `账号 ${d.username} 已经有人用了` } });
    return;
  }

  const created = await prisma.user.create({
    data: {
      username: d.username,
      passwordHash: hashPassword(d.password),
      nickname: d.nickname,
      grade: d.grade ?? null,
      roleId: role.id,
    },
    include: { role: true },
  });
  res.status(201).json(toRow(created));
});

/* ---- 重置密码 ----
   项目里没有邮件通道，发不了重置链接，所以是**管理员直接设一个新密码**。
   setPassword 会顺手吊销他全部会话 —— 改密往往正是为了处理"账号被人拿了"，
   不吊销的话对方手里那个令牌照样能用，等于白改。 */
adminRouter.post('/admin/users/:id/password', requireAuth, requirePerm('user.write'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '用户 id 不对' } });
    return;
  }
  const parsed = PasswordResetIn.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '密码不合规' } });
    return;
  }
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, username: true } });
  if (!target) {
    res.status(404).json({ error: { code: 'NO_USER', message: '没有这个用户' } });
    return;
  }
  await setPassword(id, parsed.data.password);
  res.json({ ok: true, id, username: target.username });
});

/* ---- 删账号 ----
   两道护栏：
     ① **不能删自己** —— 和改角色同一条道理，删了就没人能把你放回来。
     ② **名下有已付款订单的不让删。** 删用户会 cascade 掉他的订单（Order.user 是 Cascade），
        而订单是账。要停一个人就用上面的"停用" —— 那才是这件事的正解。
   库里没有"软删除"这一套：真正的删除就该是删除，含糊的删除比删除更危险。 */
adminRouter.delete('/admin/users/:id', requireAuth, requirePerm('user.write'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '用户 id 不对' } });
    return;
  }
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, username: true } });
  if (!target) {
    res.status(404).json({ error: { code: 'NO_USER', message: '没有这个用户' } });
    return;
  }
  if (id === req.user!.id) {
    res.status(409).json({ error: { code: 'SELF', message: '不能删自己' } });
    return;
  }
  const paid = await prisma.order.count({ where: { userId: id, paidAt: { not: null } } });
  if (paid > 0) {
    res.status(409).json({
      error: {
        code: 'HAS_PAID_ORDER',
        message: `这个账号名下有 ${paid} 笔已付款订单，删掉会连订单一起没了。要停一个人就用"停用"。`,
      },
    });
    return;
  }
  await prisma.user.delete({ where: { id } });
  res.json({ ok: true, id, username: target.username });
});

/* ==========================================================================
   订单明细 + 收款概览 + 导出
   --------------------------------------------------------------------------
   收了钱，后台得看得见 —— 这是 `order.read` 这个权限点存在的理由。

   2026-10-07 改造：原来是 `findMany({ take: 200 })` 然后把这一批丢进内存里筛。
   于是 `total` 只是"这 200 条里的条数"，summary 也只是这 200 条的合计 ——
   账期一长就**悄悄不对了**，而且错得看不出来。现在筛选下推到 SQL，并真正分页。

   两条口径必须分清，混在一起就是错账：
     · 这里的日期区间按 **createdAt（下单时间）** —— 待支付 / 超时的单没有 paidAt，
       按下单时间才筛得全；
     · summary 里 `paidCents` **含测试通道**，`realPaidCents` **不含** —— 对账只能看后者。
   ========================================================================== */

/** `YYYY-MM-DD` → 当天 00:00（本地）。判不出来就返回 null，**不猜**。 */
function dayStart(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) { return null; }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** from/to 两个日期串 → Prisma 区间。`to` 是**含这一天**，所以上界推到次日 0 点配 `lt`。 */
function dateRange(fromRaw: unknown, toRaw: unknown): { from?: Date; to?: Date } {
  const out: { from?: Date; to?: Date } = {};
  if (typeof fromRaw === 'string' && fromRaw) {
    const d = dayStart(fromRaw);
    if (d) { out.from = d; }
  }
  if (typeof toRaw === 'string' && toRaw) {
    const d = dayStart(toRaw);
    if (d) { out.to = new Date(d.getTime() + 24 * 60 * 60 * 1000); }
  }
  return out;
}

/** 测试通道的 code —— 对账口径要用它把测试单剔出去。 */
function testChannelCodes(): string[] {
  return Object.values(CHANNELS).filter((c) => c.isTest).map((c) => c.code);
}

/** `?status=` → Prisma 条件。
    **expired 不在库里**：它是"pending 且已过 expiresAt"现算出来的（见 statusOf），
    所以这里必须翻成 `status='pending' + expiresAt 比较`，不能去查一个不存在的状态值。 */
function statusWhere(want: string, now: Date): Prisma.OrderWhereInput | null {
  switch (want) {
    case 'paid': return { status: 'paid' };
    case 'canceled': return { status: 'canceled' };
    case 'pending': return { status: 'pending', expiresAt: { gt: now } };
    case 'expired': return { status: 'pending', expiresAt: { lte: now } };
    default: return null;
  }
}

/** 订单 → 后台那一行。列表与导出共用，免得两边字段慢慢长歪。 */
function orderAdminRow(o: {
  orderNo: string; amountCents: number; status: string; channel: string;
  createdAt: Date; expiresAt: Date; paidAt: Date | null; planName: string;
  user: { username: string; nickname: string } | null;
}) {
  const ch = channelOf(o.channel);
  return {
    orderNo: o.orderNo,
    username: o.user ? o.user.username : '(已删除)',
    nickname: o.user ? o.user.nickname : '',
    planName: o.planName,
    amountCents: o.amountCents,
    /* 状态**读的时候现算**（超时的算 expired）—— 和前台同一套，不靠定时任务 */
    status: statusOf(o),
    channel: o.channel,
    channelName: ch ? ch.name : o.channel,
    isTest: !!ch?.isTest,
    createdAt: o.createdAt.toISOString(),
    expiresAt: o.expiresAt.toISOString(),
    paidAt: o.paidAt ? o.paidAt.toISOString() : null,
  };
}

/** 把 `?from=&to=&channel=&status=` 解析成两套 where：
    `base` 只含"账期 + 通道"（summary 用），`list` 再叠上状态（列表用）。 */
function orderFilters(req: { query: Record<string, unknown> }) {
  const want = typeof req.query.status === 'string' ? req.query.status : '';
  const channel = typeof req.query.channel === 'string' ? req.query.channel : '';
  const range = dateRange(req.query.from, req.query.to);

  const base: Prisma.OrderWhereInput = {
    ...(channel ? { channel } : {}),
    ...(range.from || range.to
      ? {
          createdAt: {
            ...(range.from ? { gte: range.from } : {}),
            ...(range.to ? { lt: range.to } : {}),
          },
        }
      : {}),
  };
  const st = statusWhere(want, new Date());
  return { want, base, list: (st ? { AND: [base, st] } : base) as Prisma.OrderWhereInput };
}

/** `2026-10-07 14:05`（本地） —— 导出的 CSV 里要人看得懂 */
function stamp(d: Date | null): string {
  if (!d) { return ''; }
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

adminRouter.get('/admin/orders', requireAuth, requirePerm('order.read'), async (req, res) => {
  const { base, list } = orderFilters(req);

  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));

  const now = new Date();
  const testCodes = testChannelCodes();

  /* 概览**只认"账期 + 通道"这一层，不认状态** ——
     状态是"我要看哪一批"，账期是"这段账怎么算"，两件事不该互相干扰。 */
  const [total, rows, paidAgg, realAgg, pendingCount, expiredCount] = await Promise.all([
    prisma.order.count({ where: list }),
    prisma.order.findMany({
      where: list,
      orderBy: { id: 'desc' },
      include: { user: { select: { username: true, nickname: true } } },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.order.aggregate({
      where: { AND: [base, { status: 'paid' }] },
      _count: { _all: true }, _sum: { amountCents: true },
    }),
    prisma.order.aggregate({
      where: {
        AND: [
          base,
          { status: 'paid' },
          /* 测试通道的单**不算真钱**：对账的人会把它当成收入，这是最不该发生的事 */
          ...(testCodes.length ? [{ channel: { notIn: testCodes } }] : []),
        ],
      },
      _count: { _all: true }, _sum: { amountCents: true },
    }),
    prisma.order.count({ where: { AND: [base, { status: 'pending', expiresAt: { gt: now } }] } }),
    prisma.order.count({ where: { AND: [base, { status: 'pending', expiresAt: { lte: now } }] } }),
  ]);

  res.json({
    total,
    page,
    pageSize,
    items: rows.map(orderAdminRow),
    summary: {
      paidCount: paidAgg._count._all,
      paidCents: paidAgg._sum.amountCents ?? 0,
      realPaidCount: realAgg._count._all,
      realPaidCents: realAgg._sum.amountCents ?? 0,
      pendingCount,
      expiredCount,
    },
  });
});

/* ---- 导出 CSV ----
   **不分页**：导出要的就是"当前筛选条件下的全部"。
   但也不是无上限 —— 5 万行封顶，免得一次导出把内存吃光。 */
const EXPORT_MAX = 50_000;

adminRouter.get('/admin/orders/export', requireAuth, requirePerm('order.read'), async (req, res) => {
  const { list } = orderFilters(req);
  const rows = await prisma.order.findMany({
    where: list,
    orderBy: { id: 'desc' },
    take: EXPORT_MAX,
    include: { user: { select: { username: true, nickname: true } } },
  });

  const header = ['订单号', '下单人', '昵称', '方案', '金额(元)', '状态', '通道', '是否测试', '下单时间', '支付时间'];
  /* CSV 转义：字段里可能有逗号 / 引号（昵称、方案名都会），一律加引号并把引号双写 */
  const cell = (v: string): string => `"${String(v).replace(/"/g, '""')}"`;

  const lines = [header.map(cell).join(',')];
  rows.forEach((o) => {
    const r = orderAdminRow(o);
    lines.push([
      r.orderNo,
      r.username,
      r.nickname,
      r.planName,
      (r.amountCents / 100).toFixed(2),
      r.status,
      r.channelName,
      r.isTest ? '是' : '否',
      stamp(new Date(r.createdAt)),
      stamp(r.paidAt ? new Date(r.paidAt) : null),
    ].map(cell).join(','));
  });

  const today = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  const name = `orders-${today.getFullYear()}${p(today.getMonth() + 1)}${p(today.getDate())}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  /* 开头那个 BOM 不能省：不加的话 Excel 打开中文全是乱码，
     而"打开一看是乱码"的人通常不会想到是编码问题，只会觉得导出坏了。 */
  res.send('\uFEFF' + lines.join('\r\n') + '\r\n');
});

/* ==========================================================================
   财务：收款统计
   --------------------------------------------------------------------------
   口径：**按 paidAt 归日 / 月**，只算已支付的单 —— "这笔钱是哪天收到的"
   才是财务要的日期。（订单明细那页的日期筛选走 createdAt，两处口径不同，
   页面上都写明了，别让人拿两个数去对却对不上。）

   分桶本来该在 SQL 里做，但开发跑 SQLite、生产跑 MySQL，
   `strftime` 与 `DATE_FORMAT` 不是一回事，写 raw SQL 就得维护两套。
   订单量级不大，先在 JS 里聚合；真到几十万单再上只读汇总表。
   ========================================================================== */
const MAX_DAY_BUCKETS = 400;   /* 日粒度最多这个跨度，再长请改用按月 */

adminRouter.get('/admin/finance/summary', requireAuth, requirePerm('order.read'), async (req, res) => {
  const granularity = req.query.granularity === 'month' ? 'month' : 'day';
  const range = dateRange(req.query.from, req.query.to);

  /* 默认看近 30 天（含今天） */
  const to = range.to ?? new Date(Date.now() + 24 * 60 * 60 * 1000);
  const from = range.from ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  /* 先把空桶排出来：一段日子总有没收钱的那几天，**不能只有有单的日期** ——
     那样画出来的趋势图会把空白挤没，看着像天天都有收入。 */
  const buckets: string[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  if (granularity === 'month') { cursor.setDate(1); }
  while (cursor.getTime() < to.getTime()) {
    buckets.push(bucketKey(cursor, granularity));
    if (granularity === 'month') { cursor.setMonth(cursor.getMonth() + 1); }
    else { cursor.setDate(cursor.getDate() + 1); }
    if (buckets.length > MAX_DAY_BUCKETS) {
      res.status(400).json({
        error: {
          code: 'RANGE_TOO_LONG',
          message: `日期跨度太大了（超过 ${MAX_DAY_BUCKETS} 个${granularity === 'month' ? '月' : '日'}），改用"按月"看`,
        },
      });
      return;
    }
  }

  const rows = await prisma.order.findMany({
    where: { status: 'paid', paidAt: { gte: from, lt: to } },
    orderBy: { paidAt: 'asc' },
    select: { orderNo: true, paidAt: true, amountCents: true, channel: true, planCode: true, planName: true },
  });

  const testCodes = new Set(testChannelCodes());

  type Agg = { count: number; cents: number; testCount: number; testCents: number };
  const zero = (): Agg => ({ count: 0, cents: 0, testCount: 0, testCents: 0 });
  const add = (a: Agg, cents: number, isTest: boolean): void => {
    a.count += 1; a.cents += cents;
    if (isTest) { a.testCount += 1; a.testCents += cents; }
  };

  const byBucket = new Map<string, Agg>(buckets.map((b) => [b, zero()]));
  const byPlan = new Map<string, Agg & { planCode: string; planName: string }>();
  const byChannel = new Map<string, Agg & { channel: string; channelName: string; isTest: boolean }>();

  rows.forEach((o) => {
    const isTest = testCodes.has(o.channel);
    const when = o.paidAt as Date;
    const hit = byBucket.get(bucketKey(when, granularity));
    if (hit) { add(hit, o.amountCents, isTest); }

    const pkey = o.planCode || o.planName;
    let p = byPlan.get(pkey);
    if (!p) { p = { ...zero(), planCode: o.planCode, planName: o.planName }; byPlan.set(pkey, p); }
    add(p, o.amountCents, isTest);

    const ch = channelOf(o.channel);
    let c = byChannel.get(o.channel);
    if (!c) {
      c = { ...zero(), channel: o.channel, channelName: ch ? ch.name : o.channel, isTest };
      byChannel.set(o.channel, c);
    }
    add(c, o.amountCents, isTest);
  });

  const totals = zero();
  rows.forEach((o) => add(totals, o.amountCents, testCodes.has(o.channel)));

  const out = (a: Agg) => ({
    count: a.count,
    cents: a.cents,
    /* 真实收款 = 扣掉测试通道那一份；对账只看它 */
    realCount: a.count - a.testCount,
    realCents: a.cents - a.testCents,
  });

  res.json({
    range: { from: from.toISOString(), to: to.toISOString(), granularity },
    totals: out(totals),
    series: buckets.map((b) => ({ bucket: b, ...out(byBucket.get(b) as Agg) })),
    byPlan: [...byPlan.values()]
      .map((p) => ({ planCode: p.planCode, planName: p.planName, ...out(p) }))
      .sort((a, b) => b.cents - a.cents),
    byChannel: [...byChannel.values()]
      .map((c) => ({ channel: c.channel, channelName: c.channelName, isTest: c.isTest, ...out(c) }))
      .sort((a, b) => b.cents - a.cents),
  });
});

/** 一个时间点落在哪个桶里：`YYYY-MM-DD` 或 `YYYY-MM` */
function bucketKey(d: Date, granularity: 'day' | 'month'): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return granularity === 'month'
    ? `${d.getFullYear()}-${p(d.getMonth() + 1)}`
    : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ---- 一个学生的全部情况 ----
   用户 2026-10-07："管理后台在用户详情里得有这个学生的所有的情况和信息，
   考试成绩，报告，学习进度，报表等等。"

   **只读。** 这一页干的事是"把散在各处的数摆到同一屏里给老师看"；
   改数据仍然走各自那一处（角色 / 停用在本文件上面，切片在学生自己那儿）。
   在这个页面上顺手加一个"改分数"，就等于开了第二个入口 —— 两边迟早对不上。

   一次请求把六块一起取回来：拆成六个接口的话，老师会看到六个各自转圈的方块，
   而这六块本来就该一起看。
   ========================================================================== */
adminRouter.get('/admin/users/:id/overview', requireAuth, requirePerm('user.read'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '用户 id 不对' } });
    return;
  }
  const u = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!u) {
    res.status(404).json({ error: { code: 'NO_USER', message: '没有这个用户' } });
    return;
  }

  const [ent, orders, records, exams, slices, report, tally] = await Promise.all([
    currentEntitlement(id),
    prisma.order.findMany({ where: { userId: id }, orderBy: { id: 'desc' }, take: 50 }),
    prisma.learningRecord.findMany({
      where: { userId: id },
      include: { _count: { select: { events: true, marks: true } } },
    }),
    prisma.exam.findMany({
      where: { userId: id },
      orderBy: { at: 'asc' },
      include: { papers: { select: { score: true, full: true, causes: true } } },
    }),
    prisma.examSlice.findMany({
      where: { userId: id },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      include: {
        images: { select: { file: true } },
        boxes: { select: { nodeId: true } },
        nodes: { select: { nodeId: true } },
      },
    }),
    /* 报告用**学生看的那同一个函数**出，不另算一套 ——
       两套算法迟早给出两个"平均得分率"，老师照着哪个数说话都可能是错的。 */
    sliceReport(id),
    Promise.all([
      prisma.mistake.count({ where: { userId: id } }),
      prisma.mistake.count({ where: { userId: id, status: 'open' } }),
      prisma.favorite.count({ where: { userId: id } }),
      prisma.note.count({ where: { userId: id } }),
      prisma.post.count({ where: { authorId: id } }),
      prisma.reply.count({ where: { authorId: id } }),
    ]),
  ]);

  /* 学过 = 有 learnedAt 的那几格。掌握度平均**只按学过的算** ——
     没学过的不进平均，和切片报告同一个口径：不拿 0 顶替。 */
  const learned = records.filter((r) => r.learnedAt);
  const masterySum = learned.reduce((s, r) => s + r.mastery, 0);
  const [mistakes, mistakesOpen, favorites, notes, posts, replies] = tally;

  res.json({
    user: toRow(u),
    membership: {
      planCode: ent.plan ? ent.plan.code : null,
      planName: ent.plan ? ent.plan.name : null,
      isMember: ent.isMember,
      endAt: ent.endAt ? ent.endAt.toISOString() : null,
      daysLeft: ent.daysLeft,
    },
    orders: orders.map((o) => {
      const ch = channelOf(o.channel);
      return {
        orderNo: o.orderNo, planCode: o.planCode, planName: o.planName,
        amountCents: o.amountCents,
        /* 状态读的时候现算 —— 和后台订单页、和学生自己那一页共用 statusOf */
        status: statusOf(o),
        channel: o.channel, channelName: ch ? ch.name : o.channel, isTest: !!ch?.isTest,
        createdAt: o.createdAt.toISOString(),
        paidAt: o.paidAt ? o.paidAt.toISOString() : null,
      };
    }),
    exams: exams.map((e) => {
      const score = e.papers.reduce((s, p) => s + p.score, 0);
      const full = e.papers.reduce((s, p) => s + p.full, 0);
      return {
        code: e.code, name: e.name, date: e.date,
        score, full,
        rate: full > 0 ? Math.round((score / full) * 1000) / 1000 : null,
        /* "错题"的判据是**卷面这道题带错因**，不是"没拿满分" —— 见 schema 里 Mistake 那段 */
        wrong: e.papers.filter((p) => p.causes !== null).length,
      };
    }),
    slices: {
      total: slices.length,
      items: slices.map((s) => ({
        id: s.id, name: s.name, date: s.date, subject: s.subject, paperType: s.paperType,
        score: s.score, full: s.full,
        rate: s.score !== null && s.full !== null && s.full > 0
          ? Math.round((s.score / s.full) * 1000) / 1000
          : null,
        note: s.note,
        images: s.images.length,
        boxes: s.boxes.length,
        nodes: s.nodes.length,
      })),
      report,
    },
    learning: {
      records: records.length,
      learned: learned.length,
      mastered: learned.filter((r) => r.mastery >= 85).length,
      masteryAvg: learned.length ? Math.round(masterySum / learned.length) : null,
      events: records.reduce((s, r) => s + r._count.events, 0),
      marks: records.reduce((s, r) => s + r._count.marks, 0),
      blocked: records.filter((r) => r.blocked).length,
    },
    content: { mistakes, mistakesOpen, favorites, notes, posts, replies },
  });
});
