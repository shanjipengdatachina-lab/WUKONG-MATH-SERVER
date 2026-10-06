/* ==========================================================================
   /api/orders · /api/me/orders · /api/pay/*
   --------------------------------------------------------------------------
   下单**要**登录（得认人），回调**不能**要登录（是渠道在打我们，它没有 cookie）。
   这两件事挂在同一个前缀下最容易出事，所以路径上分得清清楚楚：
     /orders、/me/orders*  → 要登录
     /pay/channels        → 公开（收银台得先知道有哪几种付法）
     /pay/callback/:code  → **公开**，验签就是它的门锁
     /pay/dev/pay         → 仅开发
   ========================================================================== */
import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../../openapi.js';
import { prisma } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { CHANNELS, channelOf, devSign } from './channels.js';
import { createOrder, handleCallback, statusOf } from './pay.service.js';

const ErrOut = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

const OrderOut = z.object({
  orderNo: z.string(),
  planCode: z.string(),
  planName: z.string().describe('下单那一刻的名字快照 —— 后台后来改了名也不影响这笔历史订单'),
  amountCents: z.number(),
  days: z.number(),
  status: z.string().describe('pending | paid | canceled | expired（expired 是读的时候现算的）'),
  channel: z.string(),
  channelName: z.string(),
  isTest: z.boolean().describe('是不是开发用假通道 —— **前台必须把它标出来**'),
  createdAt: z.string(),
  expiresAt: z.string(),
  paidAt: z.string().nullable(),
});

const OrderList = z.object({ total: z.number(), items: z.array(OrderOut) });

const PrepayOut = z.object({
  orderNo: z.string(),
  planName: z.string(),
  amountCents: z.number(),
  days: z.number(),
  expiresAt: z.string(),
  channel: z.string(),
  channelName: z.string(),
  isTest: z.boolean(),
  prepay: z.object({
    kind: z.enum(['qrcode', 'redirect']),
    payload: z.string().optional().describe('qrcode 时给这个（微信是 code_url）'),
    url: z.string().optional().describe('redirect 时给这个'),
    hint: z.string().optional(),
  }),
});

const CreateIn = z.object({
  planCode: z.string().min(1).max(32),
  channel: z.string().min(1).max(16).describe('从 /api/pay/channels 拿，前端自己选'),
});

/* params 也要过一遍 zod —— 和 tree-admin 那边同一个规矩：
   Express 5 里 params 的类型是宽的（可能是 string[]），直接塞进查询会报一个看不懂的错 */
const OrderNoParam = z.object({ orderNo: z.string().min(4).max(32) });
const ChannelParam = z.object({ channel: z.string().min(1).max(16) });

registry.registerPath({
  method: 'get', path: '/api/pay/channels', summary: '有哪些付款方式（公开）',
  responses: { 200: { description: '通道列表' } },
});
registry.registerPath({
  method: 'post', path: '/api/orders', summary: '下单（要登录）',
  request: { body: { content: { 'application/json': { schema: CreateIn } } } },
  responses: {
    201: { description: '订单 + 怎么付', content: { 'application/json': { schema: PrepayOut } } },
    400: { description: '套餐不对 / 免费版不能下单', content: { 'application/json': { schema: ErrOut } } },
    401: { description: '未登录', content: { 'application/json': { schema: ErrOut } } },
  },
});
registry.registerPath({
  method: 'get', path: '/api/me/orders', summary: '我的订单',
  responses: { 200: { description: '订单列表', content: { 'application/json': { schema: OrderList } } }, 401: { description: '未登录' } },
});
registry.registerPath({
  method: 'get', path: '/api/me/orders/{orderNo}', summary: '查一笔（只能查自己的）',
  responses: { 200: { description: '订单', content: { 'application/json': { schema: OrderOut } } }, 404: { description: '没有这笔订单' } },
});
registry.registerPath({
  method: 'post', path: '/api/pay/callback/{channel}',
  summary: '支付渠道回调（**故意不挂登录** —— 是渠道在打我们；门锁是验签）',
  responses: { 200: { description: '收到' }, 400: { description: '验签没过 / 金额对不上' }, 404: { description: '没有这个通道 / 没有这笔订单' } },
});
registry.registerPath({
  method: 'post', path: '/api/pay/dev/pay', summary: '【仅开发】假通道：模拟"我付好了"',
  responses: { 200: { description: '已开通' }, 404: { description: '生产环境没有这个接口' } },
});

export const ordersRouter = Router();

type OrderRow = {
  orderNo: string; planCode: string; planName: string; amountCents: number; days: number;
  status: string; channel: string; createdAt: Date; expiresAt: Date; paidAt: Date | null;
};

function orderOut(o: OrderRow) {
  const ch = channelOf(o.channel);
  return {
    orderNo: o.orderNo, planCode: o.planCode, planName: o.planName,
    amountCents: o.amountCents, days: o.days,
    status: statusOf(o), channel: o.channel,
    channelName: ch ? ch.name : o.channel,
    /* 前台的"测试支付"字样全靠它。真通道到位之后这里天然就是 false */
    isTest: !!ch?.isTest,
    createdAt: o.createdAt.toISOString(),
    expiresAt: o.expiresAt.toISOString(),
    paidAt: o.paidAt ? o.paidAt.toISOString() : null,
  };
}

/* --------------------------------------------------------------------------
   有哪些付款方式。公开的 —— 收银台得先知道"能怎么付"，
   而这个信息里没有秘密（真正不能泄露的凭证只待在服务端）。
   -------------------------------------------------------------------------- */
ordersRouter.get('/pay/channels', (_req, res) => {
  res.json({
    channels: Object.values(CHANNELS).map((c) => ({ code: c.code, name: c.name, isTest: c.isTest })),
  });
});

/* ---- 下单 ---- */
ordersRouter.post('/orders', requireAuth, async (req, res) => {
  const parsed = CreateIn.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '入参不对' } });
    return;
  }

  const out = await createOrder(req.user!.id, parsed.data.planCode, parsed.data.channel);
  if (!out.ok) {
    res.status(out.status).json({ error: { code: out.code, message: out.message } });
    return;
  }

  res.status(201).json({
    orderNo: out.orderNo, planName: out.planName, amountCents: out.amountCents, days: out.days,
    expiresAt: out.expiresAt.toISOString(),
    channel: out.channel.code, channelName: out.channel.name, isTest: out.channel.isTest,
    prepay: out.prepay,
  });
});

/* ---- 我的订单 ---- */
ordersRouter.get('/me/orders', requireAuth, async (req, res) => {
  const rows = await prisma.order.findMany({ where: { userId: req.user!.id }, orderBy: { id: 'desc' } });
  res.json({ total: rows.length, items: rows.map(orderOut) });
});

ordersRouter.get('/me/orders/:orderNo', requireAuth, async (req, res) => {
  const parsed = OrderNoParam.safeParse(req.params);
  if (!parsed.success) {
    res.status(404).json({ error: { code: 'NO_ORDER', message: '没有这笔订单' } });
    return;
  }
  const order = await prisma.order.findUnique({ where: { orderNo: parsed.data.orderNo } });
  /* 不是自己的单，和"没有这张单"回**同一句话** ——
     否则这个接口就成了"某个单号是不是真的"的探测器 */
  if (!order || order.userId !== req.user!.id) {
    res.status(404).json({ error: { code: 'NO_ORDER', message: '没有这笔订单' } });
    return;
  }
  res.json(orderOut(order));
});

/* --------------------------------------------------------------------------
   渠道回调。**故意不挂 requireAuth** —— 打这个地址的是微信/支付宝的服务器，
   它没有我们的 cookie。这里的门锁是**验签**（在 handleCallback 第一步）。
   -------------------------------------------------------------------------- */
ordersRouter.post('/pay/callback/:channel', async (req, res) => {
  /* app.ts 只给这个前缀挂了 raw 解析器：验签要的就是**原始字节**，
     所以这里 body 是 Buffer，不是对象 */
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const parsed = ChannelParam.safeParse(req.params);
  if (!parsed.success) {
    res.status(404).json({ error: { code: 'NO_CHANNEL', message: '没有这个支付通道' } });
    return;
  }
  const out = await handleCallback(parsed.data.channel, raw, req.headers);
  res.status(out.status).json(out.body);
});

/* --------------------------------------------------------------------------
   假通道的"我付好了"。
   --------------------------------------------------------------------------
   注意它**不是**直接去开通权益，而是**伪造一次渠道回调**，走那条一模一样的处理链：
   直接调开通函数的话，验签、对金额、幂等这几个真正会出事的地方一步都没被走过 ——
   那样测出来的"通了"是假的，换成真通道还得再错一遍。
   -------------------------------------------------------------------------- */
ordersRouter.post('/pay/dev/pay', requireAuth, async (req, res) => {
  /* 生产环境里假通道压根没注册，这个接口也就等于不存在：不是"拒绝"，是根本没有 */
  const dev = channelOf('dev');
  if (!dev) {
    res.status(404).json({ error: { code: 'NO_CHANNEL', message: '没有这个支付通道' } });
    return;
  }

  const parsed = z.object({ orderNo: z.string().min(4).max(32) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '要给订单号' } });
    return;
  }

  const order = await prisma.order.findUnique({ where: { orderNo: parsed.data.orderNo } });
  /* 只能给自己付 —— 否则这就成了"帮别人开会员"的接口 */
  if (!order || order.userId !== req.user!.id) {
    res.status(404).json({ error: { code: 'NO_ORDER', message: '没有这笔订单' } });
    return;
  }
  if (order.channel !== dev.code) {
    res.status(409).json({ error: { code: 'NOT_DEV_ORDER', message: '这单不是走测试通道的' } });
    return;
  }

  const body = JSON.stringify({
    orderNo: order.orderNo,
    /* 流水号由订单号推出来 —— 重复点两次自然就是同一笔，"幂等"这一步顺便也验到了 */
    transactionId: `DEV${order.orderNo}`,
    amountCents: order.amountCents,
    paidAt: new Date().toISOString(),
  });

  const out = await handleCallback(dev.code, body, { 'x-wk-signature': devSign(body) });
  res.status(out.status).json(out.body);
});
