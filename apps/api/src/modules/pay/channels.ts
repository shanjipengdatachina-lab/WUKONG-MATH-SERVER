/* ==========================================================================
   支付通道
   --------------------------------------------------------------------------
   一个通道只要会两件事：
     · create(order)        → 告诉前端"怎么付"（微信 Native 给二维码链接，支付宝给跳转地址）
     · verify(raw, headers) → 回调**验签**，解出"哪一单、多少钱、渠道流水号"
   抽成这两件事，接真通道时**只动这一个文件**：后面查单 → 对金额 → 幂等 → 开通权益
   那一段（modules/pay/pay.service.ts）一行都不用改。

   ⚠️ 现在只有 dev 这个假通道，而且它**在生产环境里根本不存在**。
   ========================================================================== */
import { createHmac } from 'node:crypto';
import { config } from '../../config.js';

/** 下单之后告诉前端"怎么付"。 */
export type Prepay =
  | { kind: 'qrcode'; payload: string; hint: string }
  | { kind: 'redirect'; url: string };

/** 验签通过之后解出来的东西。**只有这几样是从回调里取的**，其余一律不信。 */
export type CallbackResult = {
  orderNo: string;
  transactionId: string;
  amountCents: number;
  paidAt: Date;
};

export type PayChannel = {
  code: string;
  /** 前台照着它说话：「用微信扫」/「跳到支付宝」/「这是测试支付」 */
  name: string;
  /**
   * 是不是"假通道"。
   * **前台必须据此把它标成测试** —— 一个长得跟真收银台一样的假收银台，
   * 迟早会骗到有人真去付款，或者更糟：让人以为钱已经收了。
   */
  isTest: boolean;
  create(order: { orderNo: string; amountCents: number; planName: string }): Promise<Prepay>;
  /**
   * 回调验签。**验不过必须回 null** —— 宁可拒了真的，也不能放行假的。
   * 传进来的是**原始报文**（不是解析后的对象）：签名就是对着那串字节算的，
   * 解析成对象再拼回去，键的顺序一变就永远验不过。
   */
  verify(rawBody: string, headers: Record<string, string | string[] | undefined>): CallbackResult | null;
};

/* --------------------------------------------------------------------------
   开发用假通道
   --------------------------------------------------------------------------
   ⚠️ 只在**非生产**环境注册。生产环境里连"存在这个通道"都不该被外面知道，
      所以做法不是"注册了但拒绝"，而是**压根不注册** —— 回调打过来就是 404。

   它用 HMAC-SHA256 签名，跟真通道要做的验签是同一类事。这样"伪造的回调必须被拒"
   这条能在这里先被真真切切地测一遍，而不是等接了真通道才发现验签那段写错了 ——
   到时候错的可是真的钱。
   -------------------------------------------------------------------------- */

const DEV_SECRET = config.pay.devSecret;

type DevNotify = { orderNo: string; transactionId: string; amountCents: number; paidAt?: string };

/** 假通道的签名算法。只有这里和开发用的"我付好了"接口会调它。 */
export function devSign(rawBody: string): string {
  return createHmac('sha256', DEV_SECRET).update(rawBody).digest('hex');
}

const devChannel: PayChannel = {
  code: 'dev',
  name: '测试支付',
  isTest: true,
  async create(order) {
    return {
      kind: 'qrcode',
      /* 故意**不是**一个真二维码：给一串一眼看得出是测试的字符，
         免得被截图发出去之后没人认得出这是假的 */
      payload: `TEST-ONLY-NOT-A-REAL-QR:${order.orderNo}`,
      hint: '开发用测试通道，不产生任何真实收款。点「模拟支付成功」就能走完后面整条链。',
    };
  },
  verify(rawBody, headers) {
    const raw = headers['x-wk-signature'];
    const got = Array.isArray(raw) ? raw[0] : raw;
    if (!got || got !== devSign(rawBody)) { return null; }

    let body: DevNotify;
    try { body = JSON.parse(rawBody) as DevNotify; } catch { return null; }
    if (!body.orderNo || !body.transactionId || typeof body.amountCents !== 'number') { return null; }

    return {
      orderNo: body.orderNo,
      transactionId: body.transactionId,
      amountCents: body.amountCents,
      paidAt: body.paidAt ? new Date(body.paidAt) : new Date(),
    };
  },
};

/**
 * 当前注册了哪些通道（键 = 回调地址里那一段）。
 *
 * ---- 微信 Native 扫码要接在这里，需要的东西一次说清 ----
 * 注册条件：config 里配齐 WXPAY_MCHID、WXPAY_APIV3_KEY、商户私钥、微信平台证书。
 * create()：调 `/v3/pay/transactions/native` 拿到 code_url，
 *           回 `{ kind: 'qrcode', payload: code_url }`。
 * verify()：**必须用微信平台证书验 `Wechatpay-Signature`**（这一步不能省），
 *           再从密文里解出 out_trade_no / transaction_id / amount.total。
 *           微信的回调体是 JSON —— app.ts 已经把 `/api/pay/callback` 用 raw 收下了原始报文。
 * 注意微信要求回调应答 200 + `{code:'SUCCESS'}`，与这里的统一形状不同，
 * 那一段在 orders.routes.ts 里按通道分一下就行。
 *
 * 支付宝电脑网站支付同理，只是 create() 回 `{ kind: 'redirect', url }`。
 */
export const CHANNELS: Record<string, PayChannel> = (() => {
  const map: Record<string, PayChannel> = {};
  /* 假通道只在非生产注册 */
  if (!config.isProd) { map[devChannel.code] = devChannel; }
  /* 真通道：凭证齐了之后在这里注册，别的文件都不用动 */
  return map;
})();

export function channelOf(code: string): PayChannel | undefined {
  return CHANNELS[code];
}
