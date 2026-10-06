/* ==========================================================================
   GET /api/nodes/:id/content —— 某个节点的正文（公开，免登录）
   --------------------------------------------------------------------------
   全库现在只有**一条**正文（1.2 有理数 · 数轴 · 知识点 2），其余章节还没写。

   路径为什么是 /nodes/:id 而不是施工单里写的 /sections/:id：正文挂在**任意节点**上
   （现在这条就挂在 point 上，不在 section 上），叫 sections 会名不副实。

   没有正文时返回 404 + 统一错误形状，前端据此显示"这节还没上内容"而不是白屏 ——
   reader-live.js 现在就是这么处理的。
   ========================================================================== */
import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../../openapi.js';
import { prisma } from '../../db.js';

const Param = z.object({ id: z.coerce.number().int().positive() });

const ContentResponse = z.object({
  nodeId: z.number(),
  version: z.number().describe('一节点多版本，改一次存一版；这里给最新那版'),
  html: z.string().describe('正文 HTML（原样，未加工）'),
  publishedAt: z.string().nullable(),
});

registry.registerPath({
  method: 'get',
  path: '/api/nodes/{id}/content',
  summary: '节点正文',
  request: { params: Param },
  responses: {
    200: { description: '正文', content: { 'application/json': { schema: ContentResponse } } },
    400: { description: 'id 不是正整数' },
    404: { description: '这个节点还没有正文' },
  },
});

export const contentRouter = Router();

contentRouter.get('/nodes/:id/content', async (req, res) => {
  const parsed = Param.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_PARAM', message: '节点 id 得是正整数' } });
    return;
  }

  const row = await prisma.content.findFirst({
    where: { nodeId: parsed.data.id },
    orderBy: { version: 'desc' },
  });
  if (!row) {
    res.status(404).json({ error: { code: 'NO_CONTENT', message: '这个节点还没有正文' } });
    return;
  }

  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({
    nodeId: row.nodeId,
    version: row.version,
    html: row.html,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
  });
});
