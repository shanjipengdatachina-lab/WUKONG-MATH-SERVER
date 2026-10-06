/* ==========================================================================
   /api/me/exam-slices —— 考试切片（学生自己上传的考试）
   --------------------------------------------------------------------------
   用户 2026-10-07 的口径：学生拍照上传 → 标年月日与考试情况 → 后台汇总成考情报告 →
   录进 3D 时间轴 → 学生端有个专门管这些切片的地方。

   与 `/me/exams`（演示数据里那 15 场）**是两回事**，这里只管学生自己传的。

   两条边界：
     · 图片路径**只认上传接口发出去的那种形状**（storage.service 的 absOf 校验），
       前端不能自己编一个路径塞进来。
     · 删切片时把图也删掉 —— 但**只删没有任何切片再引用的那几张**。
   ========================================================================== */
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../../openapi.js';
import { prisma } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { absOf, publicUrl } from '../uploads/storage.service.js';
import { sliceReport } from './slice-report.service.js';

const ErrOut = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

const ImageIn = z.object({
  file: z.string().max(191).describe('上传接口返回的 file，不要自己编'),
  label: z.string().max(32).optional(),
  bytes: z.number().int().min(0).optional(),
});

const BoxIn = z.object({
  page: z.number().int().min(0).max(20),
  q: z.number().int().min(0).max(999),
  /** 百分比（相对那张图），与演示阶段那份 exam-scan.js 同一套口径 */
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  w: z.number().min(0).max(100),
  h: z.number().min(0).max(100),
  nodeId: z.number().int().positive().nullable().optional().describe('这道题考哪个知识点；不填就不进薄弱点统计'),
  cause: z.string().max(191).nullable().optional(),
});

const SliceIn = z.object({
  name: z.string().min(1).max(191),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期要 YYYY-MM-DD'),
  subject: z.string().min(1).max(64).describe('数学 / 语文…'),
  paperType: z.string().min(1).max(32).describe('单元卷 / 期中 / 期末 / 模拟'),
  score: z.number().int().min(0).max(100000).nullable().optional(),
  full: z.number().int().min(1).max(100000).nullable().optional(),
  note: z.string().max(4000).nullable().optional(),
  images: z.array(ImageIn).min(1).max(10),
  boxes: z.array(BoxIn).max(200).optional(),
  nodeIds: z.array(z.number().int().positive()).max(120).optional().describe('这次考到哪几章'),
});

const SliceImageOut = z.object({
  file: z.string(), url: z.string(), label: z.string(), order: z.number(), bytes: z.number(),
});

const SliceOut = z.object({
  id: z.number(),
  name: z.string(), date: z.string(), subject: z.string(), paperType: z.string(),
  score: z.number().nullable(), full: z.number().nullable(),
  rate: z.number().nullable().describe('得分率；没填分数时是 null'),
  note: z.string().nullable(),
  images: z.array(SliceImageOut),
  boxes: z.array(z.object({
    page: z.number(), q: z.number(), x: z.number(), y: z.number(), w: z.number(), h: z.number(),
    nodeId: z.number().nullable(), nodeName: z.string(), cause: z.string().nullable(),
  })),
  nodes: z.array(z.object({ id: z.number(), name: z.string() })),
  createdAt: z.string(), updatedAt: z.string(),
});

registry.registerPath({
  method: 'get', path: '/api/me/exam-slices', summary: '我的考试切片',
  responses: { 200: { description: '列表', content: { 'application/json': { schema: z.object({ total: z.number(), items: z.array(SliceOut) }) } } }, 401: { description: '未登录' } },
});
registry.registerPath({
  method: 'post', path: '/api/me/exam-slices', summary: '新建一张切片（上传完图之后调它）',
  request: { body: { content: { 'application/json': { schema: SliceIn } } } },
  responses: { 201: { description: '建好了', content: { 'application/json': { schema: SliceOut } } }, 400: { description: '入参不对', content: { 'application/json': { schema: ErrOut } } } },
});
registry.registerPath({
  method: 'get', path: '/api/me/exam-slice-report', summary: '考情切片报告（纯统计汇总）',
  responses: { 200: { description: '报告' }, 401: { description: '未登录' } },
});

export const slicesRouter = Router();

async function nameMap(ids: number[]): Promise<Map<number, string>> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) { return new Map(); }
  const rows = await prisma.node.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } });
  return new Map(rows.map((n) => [n.id, n.name]));
}

type SliceRow = Awaited<ReturnType<typeof loadSlice>>;

function loadSlice(id: number) {
  return prisma.examSlice.findUnique({
    where: { id },
    include: {
      images: { orderBy: { order: 'asc' } },
      boxes: { orderBy: [{ page: 'asc' }, { q: 'asc' }] },
      nodes: true,
    },
  });
}

async function sliceOut(s: NonNullable<SliceRow>) {
  const ids = [
    ...s.nodes.map((n) => n.nodeId),
    ...s.boxes.map((b) => b.nodeId).filter((x): x is number => x !== null),
  ];
  const names = await nameMap(ids);
  const scored = s.score !== null && s.full !== null && s.full > 0;

  return {
    id: s.id,
    name: s.name, date: s.date, subject: s.subject, paperType: s.paperType,
    score: s.score, full: s.full,
    /* 得分率只在两个都有值时给；没有就是 null（**不拿 0 顶替**） */
    rate: scored ? Math.round((s.score! / s.full!) * 1000) / 1000 : null,
    note: s.note,
    images: s.images.map((i) => ({
      file: i.file, url: publicUrl(i.file), label: i.label, order: i.order, bytes: i.bytes,
    })),
    boxes: s.boxes.map((b) => ({
      page: b.page, q: b.q, x: b.x, y: b.y, w: b.w, h: b.h,
      nodeId: b.nodeId,
      nodeName: b.nodeId === null ? '' : (names.get(b.nodeId) ?? ''),
      cause: b.cause,
    })),
    nodes: s.nodes.map((n) => ({ id: n.nodeId, name: names.get(n.nodeId) ?? '' })),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/** 图片路径必须是**我们发出去的那种形状**，而且真的在盘上。 */
function checkImages(images: { file: string }[]): string | null {
  for (const img of images) {
    const abs = absOf(img.file);
    if (!abs) { return `图片路径不对（要用上传接口返回的 file）：${img.file}`; }
    if (!existsSync(abs)) { return `图片不在盘上了，请重新上传：${img.file}`; }
  }
  return null;
}

/* ---- 列表 ---- */
slicesRouter.get('/me/exam-slices', requireAuth, async (req, res) => {
  const rows = await prisma.examSlice.findMany({
    where: { userId: req.user!.id },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    include: {
      images: { orderBy: { order: 'asc' } },
      boxes: { orderBy: [{ page: 'asc' }, { q: 'asc' }] },
      nodes: true,
    },
  });
  const items = await Promise.all(rows.map((r) => sliceOut(r)));
  res.json({ total: items.length, items });
});

/* ---- 报告（**放在 :id 之前注册，免得 "report" 被当成 id**）---- */
slicesRouter.get('/me/exam-slice-report', requireAuth, async (req, res) => {
  res.json(await sliceReport(req.user!.id));
});

/* ---- 单条 ---- */
slicesRouter.get('/me/exam-slices/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'id 不对' } });
    return;
  }
  const s = await loadSlice(id);
  /* 别人的切片和"没有这条"回同一句话 —— 不给"这个 id 存不存在"当探测器 */
  if (!s || s.userId !== req.user!.id) {
    res.status(404).json({ error: { code: 'NO_SLICE', message: '没有这张切片' } });
    return;
  }
  res.json(await sliceOut(s));
});

/* ---- 新建 ---- */
slicesRouter.post('/me/exam-slices', requireAuth, async (req, res) => {
  const parsed = SliceIn.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '入参不对' } });
    return;
  }
  const d = parsed.data;

  if (d.score !== null && d.score !== undefined && d.full !== null && d.full !== undefined && d.score > d.full) {
    res.status(400).json({ error: { code: 'BAD_SCORE', message: '得分比满分还高 —— 检查一下这两个数' } });
    return;
  }
  const bad = checkImages(d.images);
  if (bad) {
    res.status(400).json({ error: { code: 'BAD_IMAGE', message: bad } });
    return;
  }

  const created = await prisma.examSlice.create({
    data: {
      userId: req.user!.id,
      name: d.name, date: d.date, subject: d.subject, paperType: d.paperType,
      score: d.score ?? null, full: d.full ?? null, note: d.note ?? null,
      images: {
        create: d.images.map((img, i) => ({
          file: img.file, label: img.label ?? (i === 0 ? '正面' : `第 ${i + 1} 页`),
          order: i, bytes: img.bytes ?? 0,
        })),
      },
      boxes: {
        create: (d.boxes ?? []).map((b) => ({
          page: b.page, q: b.q, x: b.x, y: b.y, w: b.w, h: b.h,
          nodeId: b.nodeId ?? null, cause: b.cause ?? null,
        })),
      },
      nodes: { create: [...new Set(d.nodeIds ?? [])].map((nodeId) => ({ nodeId })) },
    },
  });

  const full = await loadSlice(created.id);
  res.status(201).json(await sliceOut(full!));
});

/* ---- 改（按需替换：传了哪一组就整组换掉）---- */
slicesRouter.patch('/me/exam-slices/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'id 不对' } });
    return;
  }
  const mine = await prisma.examSlice.findUnique({ where: { id }, select: { userId: true } });
  if (!mine || mine.userId !== req.user!.id) {
    res.status(404).json({ error: { code: 'NO_SLICE', message: '没有这张切片' } });
    return;
  }

  const parsed = SliceIn.partial().safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '入参不对' } });
    return;
  }
  const d = parsed.data;
  if (d.images) {
    const bad = checkImages(d.images);
    if (bad) {
      res.status(400).json({ error: { code: 'BAD_IMAGE', message: bad } });
      return;
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.examSlice.update({
      where: { id },
      data: {
        ...(d.name === undefined ? {} : { name: d.name }),
        ...(d.date === undefined ? {} : { date: d.date }),
        ...(d.subject === undefined ? {} : { subject: d.subject }),
        ...(d.paperType === undefined ? {} : { paperType: d.paperType }),
        ...(d.score === undefined ? {} : { score: d.score }),
        ...(d.full === undefined ? {} : { full: d.full }),
        ...(d.note === undefined ? {} : { note: d.note }),
      },
    });
    if (d.images) {
      await tx.examSliceImage.deleteMany({ where: { sliceId: id } });
      await tx.examSliceImage.createMany({
        data: d.images.map((img, i) => ({
          sliceId: id, file: img.file,
          label: img.label ?? (i === 0 ? '正面' : `第 ${i + 1} 页`),
          order: i, bytes: img.bytes ?? 0,
        })),
      });
    }
    if (d.boxes) {
      await tx.examSliceBox.deleteMany({ where: { sliceId: id } });
      if (d.boxes.length) {
        await tx.examSliceBox.createMany({
          data: d.boxes.map((b) => ({
            sliceId: id, page: b.page, q: b.q, x: b.x, y: b.y, w: b.w, h: b.h,
            nodeId: b.nodeId ?? null, cause: b.cause ?? null,
          })),
        });
      }
    }
    if (d.nodeIds) {
      await tx.examSliceNode.deleteMany({ where: { sliceId: id } });
      await tx.examSliceNode.createMany({
        data: [...new Set(d.nodeIds)].map((nodeId) => ({ sliceId: id, nodeId })),
      });
    }
  });

  const full = await loadSlice(id);
  res.json(await sliceOut(full!));
});

/* ---- 删 ---- */
slicesRouter.delete('/me/exam-slices/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'id 不对' } });
    return;
  }
  const s = await prisma.examSlice.findUnique({
    where: { id },
    include: { images: { select: { file: true } } },
  });
  if (!s || s.userId !== req.user!.id) {
    res.status(404).json({ error: { code: 'NO_SLICE', message: '没有这张切片' } });
    return;
  }

  await prisma.examSlice.delete({ where: { id } });

  /* 图要不要一起删：**只删没有任何切片再引用的那几张**。
     直接删会把"同一张图挂在两处"的情形删坏（虽然正常流程不会有），
     而留着一堆孤儿文件也不对 —— 所以按引用数决定。 */
  for (const img of s.images) {
    const still = await prisma.examSliceImage.count({ where: { file: img.file } });
    if (still > 0) { continue; }
    const abs = absOf(img.file);
    if (abs && existsSync(abs)) {
      /* 删文件失败不该让整个请求失败 —— 库里已经删了，留个孤儿文件比报错好 */
      await unlink(abs).catch(() => undefined);
    }
  }

  res.status(204).end();
});
