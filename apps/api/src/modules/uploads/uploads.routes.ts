/* ==========================================================================
   POST /api/uploads —— 收图片（考试卷子的照片）
   --------------------------------------------------------------------------
   为什么用 **raw 二进制**而不是 multipart：这样不用引 multer，`express.raw` 就够了
   （支付回调那边已经在用同一套）。前端直接把 File 当 body 发，一行 fetch 的事。

   类型、文件名、大小三道关都在 storage.service.ts 里，这里只负责"要登录"和回话。
   ========================================================================== */
import express, { Router } from 'express';
import { z } from 'zod';
import { registry } from '../../openapi.js';
import { requireAuth } from '../../middleware/auth.js';
import { saveImage } from './storage.service.js';

const Out = z.object({
  file: z.string().describe('相对路径（库里存的就是它）'),
  url: z.string().describe('能直接给前端的地址 /uploads/…'),
  bytes: z.number(),
  kind: z.string().describe('jpg | png | webp（按字节认出来的，不是 Content-Type 说了算）'),
  sha256: z.string().describe('前 16 位，用来认出"同一张图传了两次"'),
});

registry.registerPath({
  method: 'post', path: '/api/uploads',
  summary: '上传图片（要登录；body 是原始二进制，Content-Type 用 image/jpeg 这类）',
  responses: {
    200: { description: '存好了', content: { 'application/json': { schema: Out } } },
    400: { description: '不是认识的图片', content: { 'application/json': { schema: z.object({ error: z.object({ code: z.string(), message: z.string() }) }) } } },
    401: { description: '未登录' },
    413: { description: '图太大' },
  },
});

export const uploadsRouter = Router();

/* 8MB：手机直出的照片常常 3~5MB，留够；再大就该在**前端先压一道**（页面里做了）。
   只在这里挂 raw 解析器 —— 别影响别的路由。 */
const rawImage = express.raw({
  type: ['image/jpeg', 'image/png', 'image/webp'],
  limit: '8mb',
});

uploadsRouter.post('/uploads', requireAuth, rawImage, async (req, res) => {
  /* 类型不匹配时 express.raw 不会解析，body 就是 undefined —— 这也是一种"拒收" */
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    res.status(400).json({
      error: {
        code: 'NOT_IMAGE',
        message: '请用 image/jpeg 或 image/png / image/webp 作为 Content-Type 发原始图片字节',
      },
    });
    return;
  }

  try {
    res.json(await saveImage(req.body));
  } catch (e) {
    res.status(400).json({ error: { code: 'BAD_IMAGE', message: (e as Error).message } });
  }
});
