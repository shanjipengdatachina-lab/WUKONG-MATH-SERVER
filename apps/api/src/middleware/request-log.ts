/* ==========================================================================
   观测：请求单号 + 访问日志
   --------------------------------------------------------------------------
   为什么要有单号：线上出事时，家长/老师能给的只有"我点了一下就报错了"。
   有了 `X-Request-Id`，他截个图或者抄一个号，就能在日志里把**那一次**请求捞出来 ——
   没有它，只能按时间在几千行里猜。

   上游（Nginx）给了就沿用，没给就自己生成：这样"从 Nginx 到 API"的一整串是同一个号。
   生产环境 Nginx 那份配置里会给所有请求带上 `X-Request-Id`（见 deploy/nginx.conf）。
   ========================================================================== */
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** 这次请求的单号。日志、错误响应、上游都靠它串起来 */
      requestId?: string;
    }
  }
}

export const requestId: RequestHandler = (req, res, next) => {
  const fromHeader = req.headers['x-request-id'];
  const given = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
  const id = given && given.trim() ? given.trim() : randomUUID();
  req.requestId = id;
  /* 回给前端：出错时用户能把这个号报出来 */
  res.setHeader('X-Request-Id', id);
  next();
};

/**
 * 访问日志。一行一次请求，带上单号 —— 不引日志库：
 * 这点需求用 console 就够，多一个依赖就多一处要维护的东西。
 * 生产由 Docker 收 stdout（见 deploy/docker-compose.yml），落盘与轮转交给宿主。
 */
export const accessLog: RequestHandler = (req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    /* 探活是给别人每几秒敲一次的，别让它把日志刷满 */
    if (req.originalUrl.startsWith('/api/health')) { return; }
    console.log(
      `[api] ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms` +
        ` rid=${req.requestId ?? '-'}`,
    );
  });
  next();
};
