/* ==========================================================================
   /admin/students/:id/* —— 学生的明细数据（模块 E2）
   --------------------------------------------------------------------------
   在这之前，后台对一个学生只有"计数"（错题 158、事件 4153…）和一张考试表。
   明细全在库里，就是没有一个口子看得见。这一期补齐。

   两条贯穿全文件的规矩：

   ① **老师只能看自己班的学生。** 范围由 visibleUserIds() 出（admin 为 null = 不受限），
      越界与"没这个人"回**同一句 404** —— 不给学生 id 当探测器。理由与 S1/S2 一致。
   ② **"没有数据"与"数据是 0"分开**：一项都没有时回空数组，不回一个占位对象。
      前端据此显示"暂无"，而不是显示一排 0。
   ========================================================================== */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { registry } from '../../openapi.js';
import { prisma } from '../../db.js';
import { requireAuth, requirePerm } from '../../middleware/auth.js';
import { visibleUserIds } from './classes.routes.js';
import { listChanges } from './change-log.service.js';

export const studentDataRouter = Router();

const ErrOut = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** 分页参数。上限 100 与用户列表同一条规矩：不给上限就是把整张表拉给浏览器。 */
function paging(req: Request) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/**
 * 认人 + 卡范围。**所有明细接口的第一句都是它。**
 * 通过就返回学生 id；没通过时**已经把响应发出去了**，调用方直接 return。
 */
async function guard(req: Request, res: Response): Promise<number | null> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '学生 id 不对' } });
    return null;
  }
  const u = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!u || u.role.code !== 'student') {
    res.status(404).json({ error: { code: 'NO_STUDENT', message: '没有这个学生' } });
    return null;
  }
  const visible = await visibleUserIds(req.user!);
  if (visible !== null && visible.indexOf(id) < 0) {
    res.status(404).json({ error: { code: 'NO_STUDENT', message: '没有这个学生' } });
    return null;
  }
  return id;
}

/** 节点 id → "七年级（上） / 有理数 / 1.2 数轴" 这种可读路径。
    整张节点表读进内存算一次 —— 明细一页 100 条，逐条往上查库才是真的慢。 */
async function nodePathOf(): Promise<(id: number | null) => string> {
  const nodes = await prisma.node.findMany({
    select: { id: true, name: true, parentId: true },
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cache = new Map<number, string>();
  const pathOf = (id: number | null): string => {
    if (id === null) { return ''; }
    const hit = cache.get(id);
    if (hit !== undefined) { return hit; }
    const parts: string[] = [];
    let cur = byId.get(id);
    let guardN = 0;
    while (cur && guardN < 12) {
      parts.unshift(cur.name);
      cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
      guardN += 1;
    }
    /* 头一个是根节点（树名），每一行都一样 —— 去掉，表格里那一列会短一截 */
    if (parts.length > 1) { parts.shift(); }
    const out = parts.join(' / ');
    cache.set(id, out);
    return out;
  };
  return pathOf;
}

/* ==========================================================================
   ① 学习记录（掌握度 / 状态 / 日期 / 五因子 / 卡片 / 标记）
   ========================================================================== */
studentDataRouter.get('/admin/students/:id/learning', requireAuth, requirePerm('student.read'),
  async (req, res) => {
    const sid = await guard(req, res);
    if (sid === null) { return; }
    const { page, pageSize, skip, take } = paging(req);
    const only = typeof req.query.only === 'string' ? req.query.only : '';

    /* `only=learned` 只看学过的；`only=marked` 只看有标记的；默认全部 */
    const where = {
      userId: sid,
      ...(only === 'learned' ? { learnedAt: { not: null } } : {}),
      ...(only === 'marked' ? { marks: { some: {} } } : {}),
    };

    const [total, rows, pathOf] = await Promise.all([
      prisma.learningRecord.count({ where }),
      prisma.learningRecord.findMany({
        where, skip, take,
        orderBy: [{ learnedAt: 'desc' }, { id: 'desc' }],
        include: { marks: { select: { mark: true } }, _count: { select: { events: true } } },
      }),
      nodePathOf(),
    ]);

    res.json({
      total, page, pageSize,
      items: rows.map((r) => ({
        id: r.id,
        nodeId: r.nodeId,
        path: pathOf(r.nodeId),
        mastery: r.mastery,
        status: r.status,
        learnedAt: r.learnedAt,
        reviewAt: r.reviewAt,
        plannedAt: r.plannedAt,
        diff: r.diff,
        term: r.term,
        blocked: r.blocked,
        factors: r.factors ? JSON.parse(r.factors) : null,
        cards: r.cards ? JSON.parse(r.cards) : null,
        marks: r.marks.map((m) => m.mark),
        events: r._count.events,
      })),
    });
  });

/* ==========================================================================
   ② 学习事件（轨迹）—— 成长曲线的原始数据
   ========================================================================== */
studentDataRouter.get('/admin/students/:id/events', requireAuth, requirePerm('student.read'),
  async (req, res) => {
    const sid = await guard(req, res);
    if (sid === null) { return; }
    const { page, pageSize, skip, take } = paging(req);
    const kind = typeof req.query.kind === 'string' ? req.query.kind : '';

    const where = { record: { userId: sid }, ...(kind ? { kind } : {}) };
    const [total, rows] = await Promise.all([
      prisma.learningEvent.count({ where }),
      prisma.learningEvent.findMany({
        where, skip, take,
        orderBy: { at: 'desc' },
        include: { record: { select: { nodeId: true } } },
      }),
    ]);
    const pathOf = await nodePathOf();

    res.json({
      total, page, pageSize,
      items: rows.map((e) => ({
        id: e.id,
        recordId: e.recordId,
        nodeId: e.record.nodeId,
        path: pathOf(e.record.nodeId),
        at: new Date(Number(e.at)).toISOString(),
        kind: e.kind,
        mastery: e.mastery,
        examCode: e.examCode,
        score: e.score,
        full: e.full,
        fromVal: e.fromVal,
        toVal: e.toVal,
      })),
    });
  });

/* ==========================================================================
   ③ 错题本
   ========================================================================== */
studentDataRouter.get('/admin/students/:id/mistakes', requireAuth, requirePerm('student.read'),
  async (req, res) => {
    const sid = await guard(req, res);
    if (sid === null) { return; }
    const { page, pageSize, skip, take } = paging(req);
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const source = typeof req.query.source === 'string' ? req.query.source : '';

    const where = {
      userId: sid,
      ...(status ? { status } : {}),
      ...(source ? { source } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.mistake.count({ where }),
      prisma.mistake.findMany({ where, skip, take, orderBy: { id: 'desc' } }),
    ]);
    const pathOf = await nodePathOf();

    res.json({
      total, page, pageSize,
      items: rows.map((m) => ({
        id: m.id,
        source: m.source,
        nodeId: m.nodeId,
        nodeName: m.nodeName,
        path: pathOf(m.nodeId),
        examCode: m.examCode,
        cellIndex: m.cellIndex,
        cardNo: m.cardNo,
        causes: m.causes ? JSON.parse(m.causes) : null,
        questionId: m.questionId,
        given: m.given,
        score: m.score,
        full: m.full,
        at: new Date(Number(m.at)).toISOString(),
        status: m.status,
      })),
    });
  });

/* ==========================================================================
   ④ 考试 + 卷面逐题
   ========================================================================== */
studentDataRouter.get('/admin/students/:id/exams', requireAuth, requirePerm('student.read'),
  async (req, res) => {
    const sid = await guard(req, res);
    if (sid === null) { return; }
    const rows = await prisma.exam.findMany({
      where: { userId: sid },
      orderBy: { at: 'asc' },
      include: { papers: { orderBy: { index: 'asc' } } },
    });
    const pathOf = await nodePathOf();

    res.json({
      total: rows.length,
      items: rows.map((e) => {
        const score = e.papers.reduce((s, p) => s + p.score, 0);
        const full = e.papers.reduce((s, p) => s + p.full, 0);
        return {
          id: e.id, code: e.code, name: e.name, date: e.date,
          scope: e.scope, fromIdx: e.fromIdx, toIdx: e.toIdx,
          score, full,
          rate: full > 0 ? Math.round((score / full) * 1000) / 1000 : null,
          papers: e.papers.map((p) => ({
            id: p.id, index: p.index,
            nodeId: p.nodeId, path: pathOf(p.nodeId),
            score: p.score, full: p.full, card: p.card,
            causes: p.causes ? JSON.parse(p.causes) : null,
          })),
        };
      }),
    });
  });

/* ==========================================================================
   ⑤ 练习（会话 + 逐题）
   ========================================================================== */
studentDataRouter.get('/admin/students/:id/practice', requireAuth, requirePerm('student.read'),
  async (req, res) => {
    const sid = await guard(req, res);
    if (sid === null) { return; }
    const { page, pageSize, skip, take } = paging(req);

    const [total, rows] = await Promise.all([
      prisma.practiceSession.count({ where: { userId: sid } }),
      prisma.practiceSession.findMany({
        where: { userId: sid }, skip, take,
        orderBy: { id: 'desc' },
        include: {
          answers: {
            orderBy: { order: 'asc' },
            include: { question: { select: { code: true, stem: true, kind: true, answer: true } } },
          },
        },
      }),
    ]);

    res.json({
      total, page, pageSize,
      items: rows.map((s) => ({
        id: s.id,
        total: s.total,
        correct: s.correct,
        judged: s.judged,
        /* 分母是 judged（判得了分的题数）—— 白板题判不了分，不能当错的算 */
        score: s.judged ? Math.round(((s.correct ?? 0) / s.judged) * 100) : null,
        submittedAt: s.submittedAt ? s.submittedAt.toISOString() : null,
        createdAt: s.createdAt.toISOString(),
        answers: s.answers.map((a) => ({
          id: a.id, questionId: a.questionId,
          code: a.question.code, kind: a.question.kind,
          stem: a.question.stem,
          given: a.given, correct: a.correct,
          answer: a.question.answer,
        })),
      })),
    });
  });

/* ==========================================================================
   ⑥ 上传的卷子（切片）
   ========================================================================== */
studentDataRouter.get('/admin/students/:id/slices', requireAuth, requirePerm('student.read'),
  async (req, res) => {
    const sid = await guard(req, res);
    if (sid === null) { return; }
    const rows = await prisma.examSlice.findMany({
      where: { userId: sid },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      include: {
        images: { orderBy: { order: 'asc' } },
        boxes: { orderBy: [{ page: 'asc' }, { q: 'asc' }] },
        nodes: true,
      },
    });
    const pathOf = await nodePathOf();

    res.json({
      total: rows.length,
      items: rows.map((s) => ({
        id: s.id, name: s.name, date: s.date,
        subject: s.subject, paperType: s.paperType,
        score: s.score, full: s.full,
        rate: s.score !== null && s.full !== null && s.full > 0
          ? Math.round((s.score / s.full) * 1000) / 1000 : null,
        note: s.note,
        images: s.images.map((i) => ({ id: i.id, file: i.file, label: i.label, order: i.order })),
        nodes: s.nodes.map((n) => ({ nodeId: n.nodeId, path: pathOf(n.nodeId) })),
        boxes: s.boxes.map((b) => ({
          id: b.id, page: b.page, q: b.q,
          x: b.x, y: b.y, w: b.w, h: b.h,
          nodeId: b.nodeId, path: pathOf(b.nodeId), cause: b.cause,
        })),
        createdAt: s.createdAt.toISOString(),
      })),
    });
  });

/* ==========================================================================
   ⑦ 笔记与收藏
   ========================================================================== */
studentDataRouter.get('/admin/students/:id/notes', requireAuth, requirePerm('student.read'),
  async (req, res) => {
    const sid = await guard(req, res);
    if (sid === null) { return; }
    const rows = await prisma.note.findMany({ where: { userId: sid }, orderBy: { updatedAt: 'desc' } });
    const pathOf = await nodePathOf();
    res.json({
      total: rows.length,
      items: rows.map((n) => ({
        id: n.id, title: n.title, body: n.body,
        nodeId: n.nodeId, path: pathOf(n.nodeId),
        createdAt: n.createdAt.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
      })),
    });
  });

studentDataRouter.get('/admin/students/:id/favorites', requireAuth, requirePerm('student.read'),
  async (req, res) => {
    const sid = await guard(req, res);
    if (sid === null) { return; }
    const rows = await prisma.favorite.findMany({ where: { userId: sid }, orderBy: { id: 'desc' } });
    res.json({
      total: rows.length,
      items: rows.map((f) => ({
        id: f.id, kind: f.kind, refId: f.refId, title: f.title, sub: f.sub,
        createdAt: f.createdAt.toISOString(),
      })),
    });
  });

/* ==========================================================================
   ⑧ 变更留痕（谁在什么时候改了这个学生的什么）
   ========================================================================== */
studentDataRouter.get('/admin/students/:id/changes', requireAuth, requirePerm('student.read'),
  async (req, res) => {
    const sid = await guard(req, res);
    if (sid === null) { return; }
    const { page, pageSize } = paging(req);
    res.json(await listChanges(sid, { page, pageSize }));
  });
