/* ==========================================================================
   下单与回调处理
   --------------------------------------------------------------------------
   回调那一段是**钱进来的地方**，顺序一步都不能换，而且这几步的顺序本身就在挡事：

     ① 验签       —— 伪造的回调连数据库都不该碰到
     ② 查单
     ③ 对金额     —— "把回调里的金额改成 1 分"的唯一防线
     ④ 幂等       —— 回调一定会重试；不幂等就会给同一笔钱开两次权益
     ⑤ 过期 / 状态
     ⑥ 落 payment → 开通权益

   真要接微信 Native 时，**这个文件不用动**：变的只是 channels.ts 里那个 verify()。
   ========================================================================== */
import { prisma } from '../../db.js';
import { config } from '../../config.js';
import { currentEntitlement } from '../plans/plans.routes.js';
import { channelOf, type PayChannel, type Prepay } from './channels.js';

/** 订单号：CN + 年月日 + 6 位随机。**不拿自增 id 当订单号** —— 那等于把单量写在脸上。 */
async function newOrderNo(): Promise<string> {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  for (let i = 0; i < 8; i += 1) {
    const rand = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    const orderNo = `CN${day}${rand}`;
    if (!(await prisma.order.findUnique({ where: { orderNo } }))) { return orderNo; }
  }
  /* 连撞 8 次几乎不可能；真发生说明随机源不对劲，宁可报错也不用一个可能重复的号 */
  throw new Error('订单号连撞 8 次 —— 随机源不对劲');
}

/**
 * 订单的"有效状态"。
 * **expired 不落库**：读的时候拿 expiresAt 跟当下比现算，和权益到期同一套办法。
 * 落了库就要有定时任务去翻它，而漏跑一次就会永远停在 pending。
 */
export function statusOf(o: { status: string; expiresAt: Date }): string {
  if (o.status === 'pending' && o.expiresAt.getTime() < Date.now()) { return 'expired'; }
  return o.status;
}

export type CreateOrderOk = {
  ok: true;
  orderNo: string;
  planName: string;
  amountCents: number;
  days: number;
  expiresAt: Date;
  channel: PayChannel;
  prepay: Prepay;
};
export type CreateOrderErr = { ok: false; status: number; code: string; message: string };

export async function createOrder(
  userId: number, planCode: string, channelCode: string,
): Promise<CreateOrderOk | CreateOrderErr> {
  const channel = channelOf(channelCode);
  if (!channel) {
    return { ok: false, status: 400, code: 'NO_CHANNEL', message: '没有这个支付通道' };
  }

  const plan = await prisma.plan.findUnique({ where: { code: planCode } });
  if (!plan || !plan.active) {
    return { ok: false, status: 400, code: 'NO_PLAN', message: '没有这一档套餐' };
  }
  /* 免费版是个"权益档位"，不是商品 */
  if (plan.priceCents <= 0) {
    return { ok: false, status: 400, code: 'FREE_PLAN', message: '免费版不用下单' };
  }

  const orderNo = await newOrderNo();
  const order = await prisma.order.create({
    data: {
      orderNo,
      userId,
      /* 快照：名字 / 时长 / 金额跟着订单走，后台改价改不动它 ——
         否则会出现"用户看着 268、付款时变成 288" */
      planCode: plan.code, planName: plan.name, days: plan.days, amountCents: plan.priceCents,
      status: 'pending', channel: channel.code,
      expiresAt: new Date(Date.now() + config.pay.orderTtlMinutes * 60_000),
    },
  });

  const prepay = await channel.create({
    orderNo: order.orderNo, amountCents: order.amountCents, planName: order.planName,
  });

  return {
    ok: true,
    orderNo: order.orderNo, planName: order.planName, amountCents: order.amountCents,
    days: order.days, expiresAt: order.expiresAt, channel, prepay,
  };
}

export type CallbackOut = { status: number; body: Record<string, unknown> };

export async function handleCallback(
  channelCode: string,
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
): Promise<CallbackOut> {
  /* ① 验签。不认识的通道直接 404 —— 生产环境里 dev 就是"不认识" */
  const channel = channelOf(channelCode);
  if (!channel) {
    return { status: 404, body: { error: { code: 'NO_CHANNEL', message: '没有这个支付通道' } } };
  }
  const notify = await channel.verify(rawBody, headers);
  if (!notify) {
    return { status: 400, body: { error: { code: 'BAD_SIGN', message: '回调验签没通过' } } };
  }

  /* ② 查单 */
  const order = await prisma.order.findUnique({ where: { orderNo: notify.orderNo } });
  if (!order) {
    return { status: 404, body: { error: { code: 'NO_ORDER', message: '没有这笔订单' } } };
  }

  /* ③ 对金额（在开通之前比） */
  if (order.amountCents !== notify.amountCents) {
    return { status: 400, body: { error: { code: 'AMOUNT_MISMATCH', message: '回调金额与订单金额对不上' } } };
  }

  /* ④ 幂等：渠道流水号唯一，重复回调在这里就分出来了，后面一步都不走 */
  const seen = await prisma.payment.findUnique({ where: { transactionId: notify.transactionId } });
  if (seen || order.status === 'paid') {
    return { status: 200, body: { ok: true, orderNo: order.orderNo, duplicated: true } };
  }

  /* ⑤ 过期 / 状态 */
  if (order.status !== 'pending') {
    return { status: 409, body: { error: { code: 'ORDER_NOT_PAYABLE', message: `这单现在是 ${order.status}，不能再支付` } } };
  }
  if (order.expiresAt.getTime() < Date.now()) {
    return { status: 409, body: { error: { code: 'ORDER_EXPIRED', message: '这单已超时作废' } } };
  }

  /* 开通权益要靠订阅，而订阅必须挂在一个**真的套餐行**上。
     订单本身只存了名字快照（所以删了套餐它照样读得出来），但开通这一步不行 ——
     这是"下单之后、付款之前，管理员把这一档删了"的唯一出口。 */
  const plan = await prisma.plan.findUnique({ where: { code: order.planCode } });
  if (!plan) {
    return { status: 409, body: { error: { code: 'PLAN_GONE', message: '这一档套餐已经不在了，请联系客服' } } };
  }

  const now = new Date();

  /* ⑥ 落 payment。金额记**订单自己的**那个数（上面已经比对过），不是回调里那个 */
  await prisma.payment.create({
    data: {
      orderId: order.id, channel: channel.code, transactionId: notify.transactionId,
      amountCents: order.amountCents, status: 'paid', raw: rawBody,
    },
  });

  await prisma.order.update({
    where: { id: order.id },
    /* 渠道给的时间比自己还晚就按自己算：一个将来时间的"已支付"会让对账怎么都对不上 */
    data: {
      status: 'paid',
      paidAt: notify.paidAt.getTime() > now.getTime() ? now : notify.paidAt,
    },
  });

  /* ⑦ 开通权益。**续费要接着算**：手上那份还没到期，就从到期那天往后加 ——
     从今天重算等于把剩下的日子白送掉 */
  const current = await currentEntitlement(order.userId);
  const startAt = current.endAt && current.endAt.getTime() > now.getTime() ? current.endAt : now;
  const endAt = order.days > 0 ? new Date(startAt.getTime() + order.days * 86_400_000) : null;

  await prisma.subscription.create({
    data: {
      userId: order.userId, planId: plan.id,
      startAt, endAt, status: 'active', orderNo: order.orderNo,
    },
  });

  return {
    status: 200,
    body: { ok: true, orderNo: order.orderNo, endAt: endAt ? endAt.toISOString() : null },
  };
}
