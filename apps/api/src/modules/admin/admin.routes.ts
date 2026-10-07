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
import { channelOf } from '../pay/channels.js';
import { statusOf } from '../pay/pay.service.js';
/* 学生详情页要用的两块，都**复用学生端那一处**，不在这里另写一套：
   · currentEntitlement —— 套餐判定的唯一出处（会员到期也是它算的）
   · sliceReport       —— 考情切片报告的同一个函数（老师看到的数与学生看到的一致） */
import { currentEntitlement } from '../plans/plans.routes.js';
import { sliceReport } from '../slices/slice-report.service.js';

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
  disabledAt: z.string().nullable().describe('停用时间；null = 正常'),
});
const UserList = z.object({ total: z.number(), items: z.array(UserRow) });

const ErrOut = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** 能改的就两件事：角色、停用。改昵称/年级是另一件事，不顺手塞进来。 */
const UserPatchIn = z.object({
  role: z.enum(['admin', 'student']).optional(),
  disabled: z.boolean().optional(),
});

/** 库里那行 → 给前端的形状。列表和"改完回一行"共用，免得两边字段慢慢长歪。 */
function toRow(u: {
  id: number; username: string; nickname: string; grade: string | null;
  role: { code: string }; createdAt: Date; disabledAt: Date | null;
}) {
  return {
    id: u.id, username: u.username, nickname: u.nickname, grade: u.grade,
    role: u.role.code, createdAt: u.createdAt.toISOString(),
    disabledAt: u.disabledAt ? u.disabledAt.toISOString() : null,
  };
}

registry.registerPath({
  method: 'get', path: '/api/admin/stats', summary: '后台概览（需 content.read）',
  responses: { 200: { description: '统计', content: { 'application/json': { schema: Stats } } }, 403: { description: '没权限' } },
});
registry.registerPath({
  method: 'get', path: '/api/admin/users', summary: '用户列表（需 user.read）',
  responses: { 200: { description: '用户', content: { 'application/json': { schema: UserList } } }, 403: { description: '没权限' } },
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

adminRouter.get('/admin/users', requireAuth, requirePerm('user.read'), async (_req, res) => {
  const rows = await prisma.user.findMany({ include: { role: true }, orderBy: { id: 'asc' } });
  res.json({ total: rows.length, items: rows.map(toRow) });
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
  if (parsed.data.role === undefined && parsed.data.disabled === undefined) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '没说要改什么' } });
    return;
  }

  const target = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!target) {
    res.status(404).json({ error: { code: 'NO_USER', message: '没有这个用户' } });
    return;
  }

  if (id === req.user!.id) {
    res.status(409).json({ error: { code: 'SELF', message: '不能改自己的角色或停用自己' } });
    return;
  }

  /* 只写**真正变了**的字段 —— 和节点编辑器同一个道理：照单全写会把"本来没打算动的
     东西"一起改掉，而这里动的是账号。两样都没变就一次写都不发。 */
  const data: { roleId?: number; disabledAt?: Date | null } = {};

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

/* ---- 订单 ---- */
/* 收了钱，后台得看得见 —— 这是 `order.read` 这个权限点存在的理由。
   现在只出最近 200 笔：再多就该分页了（加游标），而不是把整张表拉给浏览器。 */
adminRouter.get('/admin/orders', requireAuth, requirePerm('order.read'), async (req, res) => {
  const want = typeof req.query.status === 'string' ? req.query.status : '';

  const rows = await prisma.order.findMany({
    orderBy: { id: 'desc' },
    take: 200,
    include: { user: { select: { username: true, nickname: true } } },
  });

  const items = rows.map((o) => {
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
  });

  /* 概览里**必须把测试通道的单单独拎出来**。
     把它们混进"收款"那一栏，对账的人会当成真钱 —— 而这正是最不该发生的事。
     所以两个数都给：`paidCents` 是全部的，`realPaidCents` 才是能拿去对账的。 */
  const paid = items.filter((i) => i.status === 'paid');
  const realPaid = paid.filter((i) => !i.isTest);
  const sum = (list: typeof items): number => list.reduce((s, i) => s + i.amountCents, 0);

  res.json({
    total: items.filter((i) => !want || i.status === want).length,
    items: want ? items.filter((i) => i.status === want) : items,
    summary: {
      paidCount: paid.length,
      paidCents: sum(paid),
      realPaidCount: realPaid.length,
      realPaidCents: sum(realPaid),
      pendingCount: items.filter((i) => i.status === 'pending').length,
      expiredCount: items.filter((i) => i.status === 'expired').length,
    },
  });
});

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
