/* ==========================================================================
   /admin/<实体>/:id —— 改学生数据的编辑接口（模块 E3）
   --------------------------------------------------------------------------
   用户 2026-10-07："学生端和教师端的所有的报告和数据要在管理后台里都可以查看和编辑。"
   范围已定：**修正型编辑** —— 改已存在的数据、能删；**不提供"凭空造一条"的入口**。
   （有造数入口的话，"这个学生到底学没学过"在库里就再也分不清了，
     而全站的数 —— 成长曲线、报告、花名册 —— 全都建立在这上面。）

   **每一个写接口都必须在 applyChange() 里做**（见 change-log.service）：
   它把"改库"和"写留痕"按一个事务提交，留痕写不进去改动就回滚。
   绕过它直接 prisma.update，就等于开了个没人记得的入口 —— 那正是当初拒绝这件事的理由。

   三道闸，每个接口都走：
     ① requirePerm('student.write')  —— 有没有这个权力
     ② 记录属于哪个学生 + 那个学生在不在"我能管的人"里（老师只有自己班）—— 越界一律 404
     ③ diffOf 只留真变了的字段 —— 没有变化就 400，不写空留痕
   ========================================================================== */
import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../../openapi.js';
import { prisma } from '../../db.js';
import { requireAuth, requirePerm } from '../../middleware/auth.js';
import type { Request, Response } from 'express';
import { visibleUserIds } from './classes.routes.js';
import type { Prisma } from '@prisma/client';
import { applyChange, diffOf, type FieldChange } from './change-log.service.js';

export const studentWriteRouter = Router();

const ErrOut = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const OkOut = z.object({
  ok: z.literal(true),
  changed: z.array(z.string()).describe('这次真正改动的字段'),
  batchId: z.string().describe('留痕批次号 —— 变更记录里按它归组'),
});

/** 一次编辑的通用收尾：没有变化就 400；有变化就 applyChange + 回执。 */
async function commit<T>(opts: {
  req: Request; res: Response;
  targetId: number; entity: string; entityId: number; label: string;
  before: Record<string, unknown>; next: Record<string, unknown>;
  write: (tx: Prisma.TransactionClient) => Promise<T>;
}): Promise<void> {
  const { req, res } = opts;
  const changes: FieldChange[] = diffOf(opts.before, opts.next);
  if (!changes.length) {
    res.status(400).json({ error: { code: 'NO_CHANGE', message: '这次没有任何字段发生变化' } });
    return;
  }
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;
  const { batchId } = await applyChange({
    actorId: req.user!.id,
    targetId: opts.targetId,
    entity: opts.entity,
    entityId: opts.entityId,
    label: opts.label,
    reason,
    changes,
    write: opts.write,
  });
  res.json({ ok: true, changed: changes.map((c) => c.field), batchId });
}

/** 这个学生的数据我能不能改？不能就 404（与"没这条"同一句，不给 id 当探测器）。 */
async function mayEdit(req: Request, res: Response, userId: number): Promise<boolean> {
  const visible = await visibleUserIds(req.user!);
  if (visible !== null && visible.indexOf(userId) < 0) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '没有这条记录' } });
    return false;
  }
  return true;
}

function badId(res: Response): void {
  res.status(400).json({ error: { code: 'BAD_INPUT', message: 'id 不对' } });
}

/* ==========================================================================
   学习记录
   ========================================================================== */
const LearningPatch = z.object({
  mastery: z.number().int().min(0).max(100).optional(),
  status: z.string().min(1).max(16).optional(),
  learnedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  reviewAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  plannedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  term: z.string().max(16).nullable().optional(),
  reason: z.string().max(191).nullable().optional(),
});

studentWriteRouter.patch('/admin/learning-records/:id', requireAuth, requirePerm('student.write'),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { badId(res); return; }
    const parsed = LearningPatch.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '入参不对' } });
      return;
    }
    const rec = await prisma.learningRecord.findUnique({
      where: { id },
      include: { node: { select: { name: true, no: true } } },
    });
    if (!rec || !(await mayEdit(req, res, rec.userId))) {
      if (!rec) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '没有这条记录' } }); }
      return;
    }
    const d = parsed.data;
    const next = {
      mastery: d.mastery, status: d.status,
      learnedAt: d.learnedAt, reviewAt: d.reviewAt, plannedAt: d.plannedAt, term: d.term,
    };
    await commit({
      req, res,
      targetId: rec.userId, entity: 'learning_record', entityId: id,
      label: `${rec.node.name}${rec.node.no ? ' · ' + rec.node.no : ''}`,
      before: rec as unknown as Record<string, unknown>,
      next,
      write: (tx) => tx.learningRecord.update({
        where: { id },
        data: {
          ...(d.mastery !== undefined ? { mastery: d.mastery } : {}),
          ...(d.status !== undefined ? { status: d.status } : {}),
          ...(d.learnedAt !== undefined ? { learnedAt: d.learnedAt } : {}),
          ...(d.reviewAt !== undefined ? { reviewAt: d.reviewAt } : {}),
          ...(d.plannedAt !== undefined ? { plannedAt: d.plannedAt } : {}),
          ...(d.term !== undefined ? { term: d.term } : {}),
        },
      }),
    });
  });

/* ==========================================================================
   错题本
   ========================================================================== */
const MistakePatch = z.object({
  status: z.enum(['open', 'fixed']).optional(),
  causes: z.array(z.object({
    card: z.number().optional(), key: z.string(), by: z.string().optional(),
    acc: z.number().optional(), k: z.string().optional(),
  })).nullable().optional(),
  nodeId: z.number().int().positive().nullable().optional(),
  nodeName: z.string().max(191).optional(),
  reason: z.string().max(191).nullable().optional(),
});

studentWriteRouter.patch('/admin/mistakes/:id', requireAuth, requirePerm('student.write'),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { badId(res); return; }
    const parsed = MistakePatch.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '入参不对' } });
      return;
    }
    const m = await prisma.mistake.findUnique({ where: { id } });
    if (!m) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '没有这条记录' } }); return; }
    if (!(await mayEdit(req, res, m.userId))) { return; }

    const d = parsed.data;
    await commit({
      req, res,
      targetId: m.userId, entity: 'mistake', entityId: id,
      label: m.nodeName || `错题 #${id}`,
      before: m as unknown as Record<string, unknown>,
      next: {
        status: d.status,
        causes: d.causes === undefined ? undefined : (d.causes === null ? null : JSON.stringify(d.causes)),
        nodeId: d.nodeId, nodeName: d.nodeName,
      },
      write: (tx) => tx.mistake.update({
        where: { id },
        data: {
          ...(d.status !== undefined ? { status: d.status } : {}),
          ...(d.causes !== undefined ? { causes: d.causes === null ? null : JSON.stringify(d.causes) } : {}),
          ...(d.nodeId !== undefined ? { nodeId: d.nodeId } : {}),
          ...(d.nodeName !== undefined ? { nodeName: d.nodeName } : {}),
        },
      }),
    });
  });

/* ==========================================================================
   卷面上的一道题
   ========================================================================== */
const PaperPatch = z.object({
  score: z.number().int().min(0).max(1000).optional(),
  full: z.number().int().min(0).max(1000).optional(),
  causes: z.array(z.object({
    card: z.number().optional(), key: z.string(), by: z.string().optional(),
    acc: z.number().optional(), k: z.string().optional(),
  })).nullable().optional(),
  reason: z.string().max(191).nullable().optional(),
});

studentWriteRouter.patch('/admin/exam-papers/:id', requireAuth, requirePerm('student.write'),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { badId(res); return; }
    const parsed = PaperPatch.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '入参不对' } });
      return;
    }
    const p = await prisma.examPaper.findUnique({ where: { id }, include: { exam: true } });
    if (!p) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '没有这道题' } }); return; }
    if (!(await mayEdit(req, res, p.exam.userId))) { return; }

    const d = parsed.data;
    if (d.score !== undefined && d.full === undefined && d.score > p.full) {
      res.status(400).json({ error: { code: 'BAD_SCORE', message: '得分比满分还高 —— 检查一下这两个数' } });
      return;
    }
    await commit({
      req, res,
      targetId: p.exam.userId, entity: 'exam_paper', entityId: id,
      label: `${p.exam.name} 第 ${p.index} 题`,
      before: p as unknown as Record<string, unknown>,
      next: {
        score: d.score, full: d.full,
        causes: d.causes === undefined ? undefined : (d.causes === null ? null : JSON.stringify(d.causes)),
      },
      write: (tx) => tx.examPaper.update({
        where: { id },
        data: {
          ...(d.score !== undefined ? { score: d.score } : {}),
          ...(d.full !== undefined ? { full: d.full } : {}),
          ...(d.causes !== undefined ? { causes: d.causes === null ? null : JSON.stringify(d.causes) } : {}),
        },
      }),
    });
  });

/* ==========================================================================
   一场考试
   ========================================================================== */
const ExamPatch = z.object({
  name: z.string().min(1).max(191).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  scope: z.string().min(1).max(16).optional(),
  reason: z.string().max(191).nullable().optional(),
});

studentWriteRouter.patch('/admin/exams/:id', requireAuth, requirePerm('student.write'),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { badId(res); return; }
    const parsed = ExamPatch.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '入参不对' } });
      return;
    }
    const e = await prisma.exam.findUnique({ where: { id } });
    if (!e) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '没有这场考试' } }); return; }
    if (!(await mayEdit(req, res, e.userId))) { return; }

    const d = parsed.data;
    /* 改了日期，`at`（时间戳）跟着走 —— 它是按 date 算出来的排序键，两处不一致的话
       时间轴上的位置会和列表里的日期对不上。 */
    const at = d.date ? BigInt(new Date(`${d.date}T00:00:00`).getTime()) : undefined;
    await commit({
      req, res,
      targetId: e.userId, entity: 'exam', entityId: id,
      label: d.name ?? e.name,
      before: e as unknown as Record<string, unknown>,
      next: { name: d.name, date: d.date, scope: d.scope },
      write: (tx) => tx.exam.update({
        where: { id },
        data: {
          ...(d.name !== undefined ? { name: d.name } : {}),
          ...(d.date !== undefined ? { date: d.date, at: at as bigint } : {}),
          ...(d.scope !== undefined ? { scope: d.scope } : {}),
        },
      }),
    });
  });

/* ==========================================================================
   上传的卷子（切片）
   ========================================================================== */
const SlicePatch = z.object({
  name: z.string().min(1).max(191).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  subject: z.string().min(1).max(64).optional(),
  paperType: z.string().min(1).max(32).optional(),
  score: z.number().int().min(0).max(100000).nullable().optional(),
  full: z.number().int().min(1).max(100000).nullable().optional(),
  note: z.string().max(4000).nullable().optional(),
  reason: z.string().max(191).nullable().optional(),
});

studentWriteRouter.patch('/admin/exam-slices/:id', requireAuth, requirePerm('student.write'),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { badId(res); return; }
    const parsed = SlicePatch.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '入参不对' } });
      return;
    }
    const s = await prisma.examSlice.findUnique({ where: { id } });
    if (!s) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '没有这张切片' } }); return; }
    if (!(await mayEdit(req, res, s.userId))) { return; }

    const d = parsed.data;
    const score = d.score === undefined ? s.score : d.score;
    const full = d.full === undefined ? s.full : d.full;
    if (score !== null && full !== null && score > full) {
      res.status(400).json({ error: { code: 'BAD_SCORE', message: '得分比满分还高 —— 检查一下这两个数' } });
      return;
    }
    await commit({
      req, res,
      targetId: s.userId, entity: 'exam_slice', entityId: id,
      label: d.name ?? s.name,
      before: s as unknown as Record<string, unknown>,
      next: { name: d.name, date: d.date, subject: d.subject, paperType: d.paperType, score: d.score, full: d.full, note: d.note },
      write: (tx) => tx.examSlice.update({
        where: { id },
        data: {
          ...(d.name !== undefined ? { name: d.name } : {}),
          ...(d.date !== undefined ? { date: d.date } : {}),
          ...(d.subject !== undefined ? { subject: d.subject } : {}),
          ...(d.paperType !== undefined ? { paperType: d.paperType } : {}),
          ...(d.score !== undefined ? { score: d.score } : {}),
          ...(d.full !== undefined ? { full: d.full } : {}),
          ...(d.note !== undefined ? { note: d.note } : {}),
        },
      }),
    });
  });

/* ==========================================================================
   笔记
   ========================================================================== */
const NotePatch = z.object({
  title: z.string().min(1).max(191).optional(),
  body: z.string().max(20000).optional(),
  reason: z.string().max(191).nullable().optional(),
});

studentWriteRouter.patch('/admin/notes/:id', requireAuth, requirePerm('student.write'),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { badId(res); return; }
    const parsed = NotePatch.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '入参不对' } });
      return;
    }
    const n = await prisma.note.findUnique({ where: { id } });
    if (!n) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '没有这条笔记' } }); return; }
    if (!(await mayEdit(req, res, n.userId))) { return; }
    const d = parsed.data;
    await commit({
      req, res,
      targetId: n.userId, entity: 'note', entityId: id,
      label: d.title ?? n.title,
      before: n as unknown as Record<string, unknown>,
      next: { title: d.title, body: d.body },
      write: (tx) => tx.note.update({
        where: { id },
        data: { ...(d.title !== undefined ? { title: d.title } : {}), ...(d.body !== undefined ? { body: d.body } : {}) },
      }),
    });
  });

/* ==========================================================================
   删除
   ========================================================================== */
/* 删比改危险：学习记录删掉会**连带删掉它的学习事件**（Cascade），
   而那正是成长曲线的原始数据。所以这里先数一遍要连带删什么，回给前端让人知道。 */
const DeleteIn = z.object({ reason: z.string().max(191).nullable().optional() });

/** 删除也要同事务：**把删除动作本身交给 applyChange 的 write**，
    而不是"先记一笔、再去删" —— 后者在两者之间断电，就会出现"留痕说删了、其实还在"。 */
async function applyDelete(
  req: Request, targetId: number, entity: string, entityId: number, label: string,
  del: (tx: Prisma.TransactionClient) => Promise<unknown>,
): Promise<void> {
  await applyChange({
    actorId: req.user!.id, targetId, entity, entityId, label,
    reason: typeof req.body?.reason === 'string' ? req.body.reason : null,
    changes: [{ field: 'delete', oldValue: label, newValue: null }],
    write: del,
  });
}

studentWriteRouter.delete('/admin/learning-records/:id', requireAuth, requirePerm('student.write'),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { badId(res); return; }
    const d = DeleteIn.safeParse(req.body ?? {});
    if (!d.success) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '入参不对' } }); return; }
    const rec = await prisma.learningRecord.findUnique({
      where: { id }, include: { node: { select: { name: true } }, _count: { select: { events: true, marks: true } } },
    });
    if (!rec) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '没有这条记录' } }); return; }
    if (!(await mayEdit(req, res, rec.userId))) { return; }

    await applyDelete(req, rec.userId, 'learning_record', id, rec.node.name,
      (tx) => tx.learningRecord.delete({ where: { id } }));
    res.json({ ok: true, deletedEvents: rec._count.events, deletedMarks: rec._count.marks });
  });

studentWriteRouter.delete('/admin/mistakes/:id', requireAuth, requirePerm('student.write'),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { badId(res); return; }
    const m = await prisma.mistake.findUnique({ where: { id } });
    if (!m) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '没有这条记录' } }); return; }
    if (!(await mayEdit(req, res, m.userId))) { return; }
    await applyDelete(req, m.userId, 'mistake', id, m.nodeName || `错题 #${id}`,
      (tx) => tx.mistake.delete({ where: { id } }));
    res.json({ ok: true });
  });

studentWriteRouter.delete('/admin/notes/:id', requireAuth, requirePerm('student.write'),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { badId(res); return; }
    const n = await prisma.note.findUnique({ where: { id } });
    if (!n) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '没有这条笔记' } }); return; }
    if (!(await mayEdit(req, res, n.userId))) { return; }
    await applyDelete(req, n.userId, 'note', id, n.title,
      (tx) => tx.note.delete({ where: { id } }));
    res.json({ ok: true });
  });

/* 练习记录**不能改**（那是"当时做了什么"的历史，改它就是伪造历史），只能整次删。
   删了学生可以重练 —— 那才是"这次不算"的正确做法。 */
studentWriteRouter.delete('/admin/practice-sessions/:id', requireAuth, requirePerm('student.write'),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { badId(res); return; }
    const s = await prisma.practiceSession.findUnique({ where: { id } });
    if (!s) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '没有这次练习' } }); return; }
    if (!(await mayEdit(req, res, s.userId))) { return; }
    await applyDelete(req, s.userId, 'practice_session', id, `练习 #${id}（${s.total} 题）`,
      (tx) => tx.practiceSession.delete({ where: { id } }));
    res.json({ ok: true });
  });

studentWriteRouter.delete('/admin/exam-slices/:id', requireAuth, requirePerm('student.write'),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { badId(res); return; }
    const s = await prisma.examSlice.findUnique({ where: { id }, include: { _count: { select: { images: true, boxes: true } } } });
    if (!s) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '没有这张切片' } }); return; }
    if (!(await mayEdit(req, res, s.userId))) { return; }
    await applyDelete(req, s.userId, 'exam_slice', id, s.name,
      (tx) => tx.examSlice.delete({ where: { id } }));
    res.json({ ok: true, deletedImages: s._count.images, deletedBoxes: s._count.boxes });
  });

/* OpenAPI：表格太长，这里只登记三条代表（其余接口形状一致） */
registry.registerPath({
  method: 'patch', path: '/api/admin/learning-records/{id}', summary: '改学习记录（需 student.write，带留痕）',
  responses: { 200: { description: '改好了', content: { 'application/json': { schema: OkOut } } }, 400: { description: '没有变化或入参不对', content: { 'application/json': { schema: ErrOut } } }, 404: { description: '没有这条记录（或不在你能管的范围内）' } },
});
registry.registerPath({
  method: 'delete', path: '/admin/learning-records/{id}', summary: '删学习记录（连带删事件，带留痕）',
  responses: { 200: { description: '删好了' }, 404: { description: '没有这条记录' } },
});
registry.registerPath({
  method: 'patch', path: '/api/admin/mistakes/{id}', summary: '改错题（订正状态/错因，带留痕）',
  responses: { 200: { description: '改好了', content: { 'application/json': { schema: OkOut } } }, 404: { description: '没有这条记录' } },
});
