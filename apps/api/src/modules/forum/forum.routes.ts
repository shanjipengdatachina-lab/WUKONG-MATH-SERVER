/* ==========================================================================
   /api/forum/* —— 论坛
   --------------------------------------------------------------------------
   用户的规矩（2026-10-05 原话）："登录之后，这个论坛同步。"
   所以：**未登录只读**（帖子照看），**发帖/回复要登录**。
   原来这些帖子存在 localStorage 里 —— 换个浏览器就没了，现在进了库才谈得上"同步"。
   ========================================================================== */
import { Router } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { registry } from '../../openapi.js';
import { prisma } from '../../db.js';
import { config } from '../../config.js';
import { requireAuth } from '../../middleware/auth.js';

const BoardOut = z.object({
  id: z.number(), code: z.string(), name: z.string(),
  desc: z.string().nullable(), note: z.string().nullable(),
  posts: z.number().describe('这块板下有几帖'),
});

const PostBrief = z.object({
  id: z.number(), boardCode: z.string(), boardName: z.string(),
  title: z.string(), authorName: z.string(),
  views: z.number(), replies: z.number(),
  at: z.string().describe('ISO 时间'),
  mine: z.boolean().describe('是不是当前登录的人发的（未登录一律 false）'),
});

const ReplyOut = z.object({
  id: z.number(), authorName: z.string(), role: z.string().nullable(),
  text: z.string(), at: z.string(), mine: z.boolean(),
});

const PostDetail = z.object({
  id: z.number(), boardCode: z.string(), boardName: z.string(),
  title: z.string(), authorName: z.string(), body: z.string(),
  views: z.number(), at: z.string(), mine: z.boolean(),
  replies: z.array(ReplyOut),
});

registry.registerPath({
  method: 'get', path: '/api/forum/boards', summary: '论坛的板（公开）',
  responses: { 200: { description: '板', content: { 'application/json': { schema: z.object({ items: z.array(BoardOut) }) } } } },
});
registry.registerPath({
  method: 'get', path: '/api/forum/posts', summary: '帖子列表（公开，未登录也看得到）',
  responses: { 200: { description: '帖子' } },
});
registry.registerPath({
  method: 'get', path: '/api/forum/posts/{id}', summary: '帖子详情与回复（公开）',
  responses: { 200: { description: '详情', content: { 'application/json': { schema: PostDetail } } }, 404: { description: '没有这一帖' } },
});
registry.registerPath({
  method: 'post', path: '/api/forum/posts', summary: '发帖（需登录）',
  responses: { 201: { description: '发好了' }, 401: { description: '未登录' } },
});
registry.registerPath({
  method: 'post', path: '/api/forum/posts/{id}/replies', summary: '回帖（需登录）',
  responses: { 201: { description: '回好了' }, 401: { description: '未登录' } },
});
registry.registerPath({
  method: 'get', path: '/api/forum/mine', summary: '我发的帖（需登录）',
  responses: { 200: { description: '我的帖' }, 401: { description: '未登录' } },
});

export const forumRouter = Router();

const PostIn = z.object({
  board: z.string().min(1).max(32),
  title: z.string().min(2).max(120),
  body: z.string().min(2).max(20000),
});
const ReplyIn = z.object({ text: z.string().min(1).max(5000) });

function brief(p: {
  id: number; title: string; authorId: number | null; authorName: string;
  views: number; createdAt: Date;
  board: { code: string; name: string };
  _count: { replies: number };
}, meId: number | null) {
  return {
    id: p.id,
    boardCode: p.board.code,
    boardName: p.board.name,
    title: p.title,
    authorName: p.authorName,
    views: p.views,
    replies: p._count.replies,
    at: p.createdAt.toISOString(),
    mine: meId !== null && p.authorId === meId,
  };
}

/** 从 cookie 里认出"可能登录的人"，但**不强制** —— 公开接口也要能标出"这帖是我发的"。
    为什么不用 requireAuth：那样未登录就直接 401，而这几页**未登录是要能看的**。 */
function maybeMe(req: { cookies?: Record<string, string> }): number | null {
  const raw = req.cookies ? req.cookies[config.auth.cookieName] : undefined;
  if (!raw) { return null; }
  try {
    const payload = jwt.verify(raw, config.auth.jwtSecret) as { uid?: number };
    return typeof payload.uid === 'number' ? payload.uid : null;
  } catch {
    return null;
  }
}

forumRouter.get('/forum/boards', async (_req, res) => {
  const rows = await prisma.board.findMany({
    orderBy: { order: 'asc' },
    include: { _count: { select: { posts: true } } },
  });
  res.json({
    items: rows.map((b) => ({
      id: b.id, code: b.code, name: b.name, desc: b.desc, note: b.note, posts: b._count.posts,
    })),
  });
});

forumRouter.get('/forum/posts', async (req, res) => {
  const board = typeof req.query.board === 'string' ? req.query.board : '';
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const meId = maybeMe(req);

  const rows = await prisma.post.findMany({
    where: {
      ...(board ? { board: { code: board } } : {}),
      ...(q ? { OR: [{ title: { contains: q } }, { body: { contains: q } }] } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: { board: { select: { code: true, name: true } }, _count: { select: { replies: true } } },
  });

  res.json({ total: rows.length, items: rows.map((p) => brief(p, meId)) });
});

forumRouter.get('/forum/posts/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '帖子 id 不对' } });
    return;
  }
  const meId = maybeMe(req);
  const p = await prisma.post.findUnique({
    where: { id },
    include: {
      board: { select: { code: true, name: true } },
      replies: { orderBy: { id: 'asc' } },
    },
  });
  if (!p) {
    res.status(404).json({ error: { code: 'NO_POST', message: '没有这一帖' } });
    return;
  }

  /* 看一次算一次浏览。失败不影响读 —— 浏览量不值得让整页读不出来。 */
  prisma.post.update({ where: { id }, data: { views: { increment: 1 } } }).catch(() => undefined);

  res.json({
    id: p.id, boardCode: p.board.code, boardName: p.board.name,
    title: p.title, authorName: p.authorName, body: p.body,
    views: p.views, at: p.createdAt.toISOString(),
    mine: meId !== null && p.authorId === meId,
    replies: p.replies.map((r) => ({
      id: r.id, authorName: r.authorName, role: r.role, text: r.text,
      at: r.createdAt.toISOString(),
      mine: meId !== null && r.authorId === meId,
    })),
  });
});

forumRouter.post('/forum/posts', requireAuth, async (req, res) => {
  const parsed = PostIn.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '标题 2~120 字、正文至少 2 字' } });
    return;
  }
  const board = await prisma.board.findUnique({ where: { code: parsed.data.board } });
  if (!board) {
    res.status(400).json({ error: { code: 'NO_BOARD', message: '没有这块板' } });
    return;
  }
  const me = req.user!;
  const created = await prisma.post.create({
    data: {
      boardId: board.id,
      title: parsed.data.title,
      body: parsed.data.body,
      authorId: me.id,
      authorName: me.nickname,
    },
  });
  res.status(201).json({
    id: created.id, boardCode: board.code, boardName: board.name,
    title: created.title, authorName: created.authorName, body: created.body,
    views: 0, at: created.createdAt.toISOString(), mine: true, replies: [],
  });
});

forumRouter.post('/forum/posts/:id/replies', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '帖子 id 不对' } });
    return;
  }
  const parsed = ReplyIn.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '回复不能为空' } });
    return;
  }
  const post = await prisma.post.findUnique({ where: { id }, select: { id: true } });
  if (!post) {
    res.status(404).json({ error: { code: 'NO_POST', message: '没有这一帖' } });
    return;
  }
  const me = req.user!;
  const created = await prisma.reply.create({
    data: {
      postId: post.id,
      authorId: me.id,
      authorName: me.nickname,
      role: '学员',
      text: parsed.data.text,
    },
  });
  res.status(201).json({
    id: created.id, authorName: created.authorName, role: created.role,
    text: created.text, at: created.createdAt.toISOString(), mine: true,
  });
});

forumRouter.get('/forum/mine', requireAuth, async (req, res) => {
  const meId = req.user!.id;
  const rows = await prisma.post.findMany({
    where: { authorId: meId },
    orderBy: { createdAt: 'desc' },
    include: { board: { select: { code: true, name: true } }, _count: { select: { replies: true } } },
  });
  const replies = await prisma.reply.findMany({
    where: { authorId: meId },
    orderBy: { createdAt: 'desc' },
    include: { post: { select: { id: true, title: true, board: { select: { code: true } } } } },
  });

  res.json({
    posts: { total: rows.length, items: rows.map((p) => brief(p, meId)) },
    replies: {
      total: replies.length,
      items: replies.map((r) => ({
        id: r.id,
        postId: r.post.id,
        postTitle: r.post.title,
        boardCode: r.post.board.code,
        text: r.text,
        at: r.createdAt.toISOString(),
      })),
    },
  });
});
