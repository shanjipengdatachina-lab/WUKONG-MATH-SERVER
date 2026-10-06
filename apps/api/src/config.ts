/* ==========================================================================
   环境配置
   --------------------------------------------------------------------------
   全项目**只在这里读 process.env** —— 缺什么、默认什么，一眼看得全；别处不许直接摸。
   缺关键项直接抛：宁可起不来，也不要带着半截配置跑起来（半截配置的 bug 最难查）。
   ========================================================================== */

export type StorageDriver = 'local' | 'oss';

function req(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`缺环境变量 ${name} —— 复制 .env.example 成 .env 再改`);
  }
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`环境变量 ${name} 不是数字：${v}`);
  return n;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: num('PORT', 3000),
  version: process.env.APP_VERSION ?? '0.0.0',
  databaseUrl: req('DATABASE_URL'),
  auth: {
    /* 换成真密钥再上线；本地这份只是让开发能跑 */
    jwtSecret: req('JWT_SECRET'),
    cookieName: process.env.AUTH_COOKIE ?? 'wk_token',
    ttlDays: num('AUTH_TTL_DAYS', 7),
  },
  storage: {
    /* 开发期 local（写本地目录），生产换 oss —— 只改这一行配置，代码不动 */
    driver: (process.env.STORAGE_DRIVER ?? 'local') as StorageDriver,
    dir: process.env.STORAGE_DIR ?? './var/uploads',
  },
  pay: {
    /* 待支付超时（分钟）。过了这单就作废 —— 不留"永远可以支付"的单 */
    orderTtlMinutes: num('PAY_ORDER_TTL_MINUTES', 30),

    /* 开发用假通道的签名密钥。这个默认值是**故意不安全的**：
       假通道在生产环境里根本不会注册（见 modules/pay/channels.ts），
       所以漏配也带不上线；反过来，正是"它不安全"逼着人别把它带上线。 */
    devSecret: process.env.PAY_DEV_SECRET ?? 'wk-dev-not-a-real-secret',
  },
};
