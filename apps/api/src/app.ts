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
import { practiceRouter } from './modules/practice/practice.routes.js';
import { forumRouter } from './modules/forum/forum.routes.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  /* 登录态在 httpOnly Cookie 里，所以要能读 cookie */
  app.use(cookieParser());

  /* 开发期后台跑在另一个端口，要跨域；生产走 Nginx 同域反代，这段不起作用也不碍事 */
  app.use(cors({ origin: true, credentials: true }));

  app.use('/api', healthRouter);
  app.use('/api', treeRouter);
  app.use('/api', contentRouter);
  app.use('/api', authRouter);
  app.use('/api', adminRouter);
  app.use('/api', meRouter);
  app.use('/api', practiceRouter);
  app.use('/api', forumRouter);
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(buildOpenApiDocument()));

  /* 兜底 404：统一响应形状，别让前端收到一坨 HTML */
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '没有这个接口' } });
  });

  /* 兜底错误：统一形状 + 生产环境不把堆栈吐给前端 */
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api] 未捕获的错误：', err);
    res.status(500).json({
      error: { code: 'INTERNAL', message: process.env.NODE_ENV === 'production' ? '服务内部错误' : message },
    });
  };
  app.use(onError);

  return app;
}
