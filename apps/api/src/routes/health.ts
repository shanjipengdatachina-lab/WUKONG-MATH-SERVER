/* ==========================================================================
   /api/health —— 探活
   --------------------------------------------------------------------------
   进程活着、库连得上就算好。库连不上返回 503（让编排/负载均衡能据此摘流量），
   但**响应体照旧给全**，方便人直接看是哪一层坏了。
   ========================================================================== */
import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../openapi.js';
import { config } from '../config.js';
import { dbUp } from '../db.js';

export const HealthResponse = z.object({
  ok: z.boolean(),
  version: z.string(),
  db: z.enum(['up', 'down']),
  uptime: z.number(),
});

registry.register('HealthResponse', HealthResponse);

registry.registerPath({
  method: 'get',
  path: '/api/health',
  summary: '探活',
  description: '进程活着返回 ok:true；库连不上时 db=down 且 HTTP 503。',
  responses: {
    200: { description: '一切正常', content: { 'application/json': { schema: HealthResponse } } },
    503: { description: '库连不上', content: { 'application/json': { schema: HealthResponse } } },
  },
});

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  const up = await dbUp();
  res.status(up ? 200 : 503).json({
    ok: up,
    version: config.version,
    db: up ? 'up' : 'down',
    uptime: Math.round(process.uptime()),
  });
});
