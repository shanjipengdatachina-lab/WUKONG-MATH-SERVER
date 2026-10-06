/* ==========================================================================
   Express 应用装配
   --------------------------------------------------------------------------
   这里只做"装"：中间件 → 路由 → 文档 → 兜底。业务逻辑一律写在 src/modules/ 里。
   注意相对导入都带 .js —— 这是 Node ESM 的规矩，`npm run build` 出的产物才能直接跑。
   ========================================================================== */
import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { buildOpenApiDocument } from './openapi.js';
import { healthRouter } from './routes/health.js';
import { treeRouter } from './modules/tree/tree.routes.js';
import { contentRouter } from './modules/content/content.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { meRouter } from './modules/me/me.routes.js';
import { treeAdminRouter } from './modules/admin/tree-admin.routes.js';
import { plansAdminRouter } from './modules/admin/plans-admin.routes.js';
import { plansRouter } from './modules/plans/plans.routes.js';
import { practiceRouter } from './modules/practice/practice.routes.js';
import { forumRouter } from './modules/forum/forum.routes.js';
import { ordersRouter } from './modules/pay/orders.routes.js';
import { uploadsRouter } from './modules/uploads/uploads.routes.js';
import { slicesRouter } from './modules/slices/slices.routes.js';
import { uploadsRoot } from './modules/uploads/storage.service.js';
import { requestId, accessLog } from './middleware/request-log.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  /* 观测：先给每个请求一个单号，再挂访问日志 —— 这样日志里带得上那个号 */
  app.use(requestId);
  app.use(accessLog);
  /* 支付回调**必须拿到原始报文**：签名是对着原始 body 算的，
     解析成对象再拼回去，键的顺序一变就永远验不过 —— 而这种错只在真通道上才暴露。
     这一条要放在 json 之前，用 raw 把整个 body 原样收下
     （微信与支付宝的回调都不是纯 JSON）。 */
  app.use('/api/pay/callback', express.raw({ type: '*/*', limit: '1mb' }));
  app.use(express.json({ limit: '1mb' }));
  /* 登录态在 httpOnly Cookie 里，所以要能读 cookie */
  app.use(cookieParser());

  /* 开发期后台跑在另一个端口，要跨域；生产走 Nginx 同域反代，这段不起作用也不碍事 */
  app.use(cors({ origin: true, credentials: true }));

  app.use('/api', healthRouter);
  app.use('/api', treeRouter);
  app.use('/api', contentRouter);
  app.use('/api', authRouter);
  app.use('/api', treeAdminRouter);
  app.use('/api', plansAdminRouter);
  app.use('/api', plansRouter);
  app.use('/api', adminRouter);
  app.use('/api', meRouter);
  app.use('/api', practiceRouter);
  app.use('/api', forumRouter);
  app.use('/api', ordersRouter);
  app.use('/api', uploadsRouter);
  app.use('/api', slicesRouter);

  /* 学生上传的卷子照片。开发期由接口自己发；生产是 Nginx 直接发那个卷（见 deploy/nginx.conf）。
     文件名是服务端随机生成的、不含任何用户输入，所以可以放心长缓存。 */
  app.use('/uploads', express.static(uploadsRoot, {
    index: false, dotfiles: 'deny', maxAge: '30d', immutable: true,
  }));

  app.use('/docs', swaggerUi.serve, swaggerUi.setup(buildOpenApiDocument()));

  /* 兜底 404：统一响应形状，别让前端收到一坨 HTML */
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '没有这个接口' } });
  });

  /* 兜底错误：统一形状 + 生产环境不把堆栈吐给前端 */
  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    const message = err instanceof Error ? err.message : String(err);
    /* 4xx 是"这一次请求本身不对"（例如 body 超了 1mb 的限制），不能一律记成 500 ——
       500 是要叫人半夜爬起来查的，4xx 不该有那个待遇；日志在这件事上不能撒谎。 */
    const boxed = err as { status?: number; statusCode?: number };
    const raw = Number(boxed.status ?? boxed.statusCode);
    const bad = Number.isInteger(raw) && raw >= 400 && raw < 500;
    const status = bad ? raw : 500;

    if (bad) {
      console.warn(`[api] 请求被拒 rid=${req.requestId ?? '-'} ${status}：${message}`);
    } else {
      /* 日志里带单号：一串报错里要能认出"哪一次是用户报的那个" */
      console.error(`[api] 未捕获的错误 rid=${req.requestId ?? '-'}：`, err);
    }

    res.status(status).json({
      error: {
        code: bad ? 'BAD_REQUEST' : 'INTERNAL',
        /* 生产环境不把内部细节吐出去；4xx 的原话本来就是说给调用方听的，照实回 */
        message: !bad && process.env.NODE_ENV === 'production' ? '服务内部错误' : message,
        /* 把单号也回给前端：用户照抄一下就够了，不用再去猜是哪一次请求 */
        requestId: req.requestId ?? null,
      },
    });
  };
  app.use(onError);

  return app;
}
