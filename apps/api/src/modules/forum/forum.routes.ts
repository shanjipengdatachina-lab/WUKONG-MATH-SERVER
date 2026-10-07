/* ==========================================================================
   /api/forum/* —— 论坛
   --------------------------------------------------------------------------
   用户的规矩（2026-10-05 原话）："登录之后，这个论坛同步。"
   所以：**未登录只读**（帖子照看），**发帖/回复要登录**。
   原来这些帖子存在 localStorage 里 —— 换个浏览器就没了，现在进了库才谈得上"同步"。

   M5 这一档又加了两件事：
     · 作者能改/删自己的帖子（PATCH/DELETE /forum/posts/:id）——
       没账号的演示帖（authorId 为空）谁都不能改，只能管理员从后台删。
     · 管理员能置顶/加精（PATCH /admin/forum/posts/:id，单独的路由器）。
   ========================================================================== */
import { Router } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { registry } from '../../openapi.js';
import { prisma } from '../../db.js';
import { config } from '../../config.js';
import { requireAuth, requirePerm } from '../../middleware/auth.js';

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
  pinned: z.boolean().describe('置顶'),
  good: z.boolean().describe('加精'),
});

const ReplyOut = z.object({
  id: z.number(), authorName: z.string(), role: z.string().nullable(),
  text: z.string(), at: z.string(), mine: z.boolean(),
});

const PostDetail = z.object({
  id: z.number(), boardCode: z.string(), boardName: z.string(),
  title: z.string(), authorName: z.string(), body: z.string(),
  views: z.number(), at: z.string(), mine: z.boolean(),
  pinned: z.boolean(), good: z.boolean(),
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
  method: 'patch', path: '/api/forum/posts/{id}', summary: '改自己的帖子（作者本人）',
  responses: { 200: { description: '改好了' }, 401: { description: '未登录' }, 403: { description: '不是作者' }, 404: { description: '没有这一帖' } },
});
registry.registerPath({
  method: 'delete', path: '/api/forum/posts/{id}', summary: '删自己的帖子（作者本人）',
  responses: { 200: { description: '删好了' }, 401: { description: '未登录' }, 403: { description: '不是作者' }, 404: { description: '没有这一帖' } },
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
const PostPatchIn = z.object({
  title: z.string().min(2).max(120).optional(),
  body: z.string().min(2).max(20000).optional(),
});

function brief(p: {
  id: number; title: string; authorId: number | null; authorName: string;
  views: number; createdAt: Date; pinnedAt: Date | null; goodAt: Date | null;
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
    pinned: p.pinnedAt !== null,
    good: p.goodAt !== null,
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

/**
 * 哪些作者现在享有"答疑优先"。
 *
 * 一次查完，**不要一帖一查** —— 那是 N×2 次查询，而这个问题只要一次。
 * 取"当前那一份订阅"的规则和 currentEntitlement 完全一样
 * （orderBy endAt desc, id desc，第一条就是它）：两处判定必须同一套，
 * 否则套餐页写"你有"、这里说"你没有"，谁也说不清哪个对。
 */
async function priorityAuthors(userIds: number[]): Promise<Set<number>> {
  const uniq = [...new Set(userIds)];
  if (!uniq.length) { return new Set(); }

  const now = new Date();
  const subs = await prisma.subscription.findMany({
    where: { userId: { in: uniq }, status: 'active', OR: [{ endAt: null }, { endAt: { gt: now } }] },
    orderBy: [{ endAt: 'desc' }, { id: 'desc' }],
    include: {
      plan: {
        include: {
          services: { where: { included: true }, include: { service: true } },
        },
      },
    },
  });

  /* 每人只留第一条（排序已经保证它就是"当前那一份"） */
  const picked = new Map<number, (typeof subs)[number]>();
  subs.forEach((s) => { if (!picked.has(s.userId)) { picked.set(s.userId, s); } });

  const out = new Set<number>();
  picked.forEach((s, uid) => {
    const has = s.plan.services.some((l) => l.service.active && l.service.code === 'priority_support');
    if (has) { out.add(uid); }
  });
  return out;
}

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

  /* "答疑优先"（后台能配）在这里落地：享这一项的人提问排在前面。
     注意它的语义是**排前面，不是藏掉别人的** —— 所以只调顺序，一条都不少。
     排序是稳定的，所以同一档里仍然保持"新的在前"。

     发帖人字段是 `authorId` 而且**可以是 null**（早年的匿名帖），
     所以先滤掉 null 再交给判定 —— 不然一个 null 会在 Set 里变成一个永远不命中的键。 */
  const priority = await priorityAuthors(
    rows.map((p) => p.authorId).filter((x): x is number => x !== null),
  );
  const hasPriority = (p: { authorId: number | null }): boolean =>
    p.authorId !== null && priority.has(p.authorId);

  /* 排序：置顶 > 答疑优先 > 新到旧。三档依次比较，同一档稳定。 */
  const ordered = [...rows].sort((a, b) => {
    const pa = a.pinnedAt ? 1 : 0;
    const pb = b.pinnedAt ? 1 : 0;
    if (pa !== pb) { return pb - pa; }
    const ya = hasPriority(a) ? 1 : 0;
    const yb = hasPriority(b) ? 1 : 0;
    if (ya !== yb) { return yb - ya; }
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  res.json({
    total: ordered.length,
    items: ordered.map((p) => ({ ...brief(p, meId), priority: hasPriority(p) })),
  });
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
    pinned: p.pinnedAt !== null,
    good: p.goodAt !== null,
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
    views: 0, at: created.createdAt.toISOString(),
    mine: true, pinned: false, good: false, replies: [],
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

/* ---- 改自己的帖（作者本人；管理员从 /admin/forum 走，不在这条上）---- */
forumRouter.patch('/forum/posts/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '帖子 id 不对' } });
    return;
  }
  const parsed = PostPatchIn.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '入参不对' } });
    return;
  }
  const d = parsed.data;
  if (d.title === undefined && d.body === undefined) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '没给要改的字段' } });
    return;
  }
  const post = await prisma.post.findUnique({
    where: { id },
    select: { id: true, authorId: true, boardId: true },
  });
  if (!post) {
    res.status(404).json({ error: { code: 'NO_POST', message: '没有这一帖' } });
    return;
  }
  /* 演示帖 authorId 是 null，谁都不能从这里改 —— 只能管理员从后台改/删 */
  if (post.authorId === null || post.authorId !== req.user!.id) {
    res.status(403).json({ error: { code: 'NOT_AUTHOR', message: '只能改自己发的帖' } });
    return;
  }
  const updated = await prisma.post.update({
    where: { id },
    data: {
      ...(d.title !== undefined ? { title: d.title } : {}),
      ...(d.body !== undefined ? { body: d.body } : {}),
    },
    include: { board: { select: { code: true, name: true } }, replies: { orderBy: { id: 'asc' } } },
  });
  const meId = req.user!.id;
  res.json({
    id: updated.id, boardCode: updated.board.code, boardName: updated.board.name,
    title: updated.title, authorName: updated.authorName, body: updated.body,
    views: updated.views, at: updated.createdAt.toISOString(),
    mine: true, pinned: updated.pinnedAt !== null, good: updated.goodAt !== null,
    replies: updated.replies.map((r) => ({
      id: r.id, authorName: r.authorName, role: r.role, text: r.text,
      at: r.createdAt.toISOString(),
      mine: r.authorId === meId,
    })),
  });
});

/* ---- 删自己的帖（作者本人）---- */
forumRouter.delete('/forum/posts/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '帖子 id 不对' } });
    return;
  }
  const post = await prisma.post.findUnique({
    where: { id },
    select: { id: true, authorId: true },
  });
  if (!post) {
    res.status(404).json({ error: { code: 'NO_POST', message: '没有这一帖' } });
    return;
  }
  if (post.authorId === null || post.authorId !== req.user!.id) {
    res.status(403).json({ error: { code: 'NOT_AUTHOR', message: '只能删自己发的帖' } });
    return;
  }
  /* Post → Reply 是 onDelete: Cascade，删帖自动把回复一起删掉 */
  await prisma.post.delete({ where: { id } });
  res.json({ ok: true, id });
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
    posts: {
      total: rows.length,
      items: rows.map((p) => ({
        ...brief(p, meId),
        priority: false,
      })),
    },
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


/* ==========================================================================
   /api/admin/forum/* —— 论坛管理（管理员用）
   --------------------------------------------------------------------------
   学生端那一档管的是"自己发的帖"，这里管的是"任何人的帖"：
     · 列表全看，按板/关键字筛；
     · 置顶 / 加精 / 取消置顶 / 取消加精；
     · 删除（包括演示帖，演示帖 authorId 是 null，学生端那条拦着不让删，这里能删）。
   板块（Board）的增删改也在这里。
   ========================================================================== */
export const forumAdminRouter = Router();

const AdminPostOut = z.object({
  id: z.number(), boardCode: z.string(), boardName: z.string(),
  title: z.string(), authorName: z.string(), authorId: z.number().nullable(),
  views: z.number(), replies: z.number(),
  pinned: z.boolean(), good: z.boolean(),
  at: z.string(),
});

const AdminBoardIn = z.object({
  code: z.string().min(1).max(32).regex(/^[a-z0-9_-]+$/i, 'code 只能是字母数字下划线短横'),
  name: z.string().min(1).max(64),
  desc: z.string().max(191).nullable().optional(),
  note: z.string().max(5000).nullable().optional(),
  order: z.number().int().min(0).max(9999).optional(),
});

const AdminBoardPatchIn = z.object({
  code: z.string().min(1).max(32).regex(/^[a-z0-9_-]+$/i).optional(),
  name: z.string().min(1).max(64).optional(),
  desc: z.string().max(191).nullable().optional(),
  note: z.string().max(5000).nullable().optional(),
  order: z.number().int().min(0).max(9999).optional(),
});

const AdminPostPatchIn = z.object({
  title: z.string().min(2).max(120).optional(),
  body: z.string().min(2).max(20000).optional(),
  pinned: z.boolean().optional().describe('传 true 置顶 / false 取消置顶'),
  good: z.boolean().optional().describe('传 true 加精 / false 取消加精'),
}).refine((d) => d.title !== undefined || d.body !== undefined || d.pinned !== undefined || d.good !== undefined, {
  message: '没给要改的字段',
});

registry.registerPath({
  method: 'get', path: '/api/admin/forum/posts', summary: '管理端：帖子列表（需 forum.read）',
  responses: { 200: { description: '帖子', content: { 'application/json': { schema: z.object({ total: z.number(), items: z.array(AdminPostOut) }) } } }, 401: { description: '未登录' }, 403: { description: '无权限' } },
});
registry.registerPath({
  method: 'patch', path: '/api/admin/forum/posts/{id}', summary: '管理端：改帖（置顶/加精/改标题正文，需 forum.write）',
  responses: { 200: { description: '改好了' }, 403: { description: '无权限' }, 404: { description: '没有这一帖' } },
});
registry.registerPath({
  method: 'delete', path: '/api/admin/forum/posts/{id}', summary: '管理端：删帖（需 forum.write）',
  responses: { 200: { description: '删好了' }, 403: { description: '无权限' }, 404: { description: '没有这一帖' } },
});
registry.registerPath({
  method: 'get', path: '/api/admin/forum/boards', summary: '管理端：板块列表（需 forum.read）',
  responses: { 200: { description: '板块' } },
});
registry.registerPath({
  method: 'post', path: '/api/admin/forum/boards', summary: '管理端：新建板块（需 forum.write）',
  responses: { 201: { description: '建好了' }, 400: { description: '入参不对或 code 重复' } },
});
registry.registerPath({
  method: 'patch', path: '/api/admin/forum/boards/{id}', summary: '管理端：改板块（需 forum.write）',
  responses: { 200: { description: '改好了' }, 404: { description: '没有这一块' } },
});
registry.registerPath({
  method: 'delete', path: '/api/admin/forum/boards/{id}', summary: '管理端：删板块（需 forum.write）',
  responses: { 200: { description: '删好了' }, 400: { description: '板块下还有帖子，不让删' }, 404: { description: '没有这一块' } },
});

/* ---- 帖子列表（管理端） ---- */
forumAdminRouter.get('/admin/forum/posts', requireAuth, requirePerm('forum.read'), async (req, res) => {
  const board = typeof req.query.board === 'string' ? req.query.board : '';
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const rows = await prisma.post.findMany({
    where: {
      ...(board ? { board: { code: board } } : {}),
      ...(q ? { OR: [{ title: { contains: q } }, { body: { contains: q } }] } : {}),
    },
    orderBy: [{ pinnedAt: 'desc' }, { createdAt: 'desc' }],
    include: {
      board: { select: { code: true, name: true } },
      _count: { select: { replies: true } },
    },
  });
  res.json({
    total: rows.length,
    items: rows.map((p) => ({
      id: p.id, boardCode: p.board.code, boardName: p.board.name,
      title: p.title, authorName: p.authorName, authorId: p.authorId,
      views: p.views, replies: p._count.replies,
      pinned: p.pinnedAt !== null, good: p.goodAt !== null,
      at: p.createdAt.toISOString(),
    })),
  });
});

/* ---- 改帖（置顶/加精/改标题正文） ---- */
forumAdminRouter.patch('/admin/forum/posts/:id', requireAuth, requirePerm('forum.write'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '帖子 id 不对' } });
    return;
  }
  const parsed = AdminPostPatchIn.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '入参不对' } });
    return;
  }
  const d = parsed.data;
  const post = await prisma.post.findUnique({ where: { id }, select: { id: true } });
  if (!post) {
    res.status(404).json({ error: { code: 'NO_POST', message: '没有这一帖' } });
    return;
  }
  const now = new Date();
  const updated = await prisma.post.update({
    where: { id },
    data: {
      ...(d.title !== undefined ? { title: d.title } : {}),
      ...(d.body !== undefined ? { body: d.body } : {}),
      ...(d.pinned !== undefined ? { pinnedAt: d.pinned ? now : null } : {}),
      ...(d.good !== undefined ? { goodAt: d.good ? now : null } : {}),
    },
    include: {
      board: { select: { code: true, name: true } },
      _count: { select: { replies: true } },
    },
  });
  res.json({
    id: updated.id, boardCode: updated.board.code, boardName: updated.board.name,
    title: updated.title, authorName: updated.authorName, authorId: updated.authorId,
    views: updated.views, replies: updated._count.replies,
    pinned: updated.pinnedAt !== null, good: updated.goodAt !== null,
    at: updated.createdAt.toISOString(),
  });
});

/* ---- 删帖（管理端能删任何人的帖，包括演示帖） ---- */
forumAdminRouter.delete('/admin/forum/posts/:id', requireAuth, requirePerm('forum.write'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '帖子 id 不对' } });
    return;
  }
  const post = await prisma.post.findUnique({ where: { id }, select: { id: true } });
  if (!post) {
    res.status(404).json({ error: { code: 'NO_POST', message: '没有这一帖' } });
    return;
  }
  await prisma.post.delete({ where: { id } });
  res.json({ ok: true, id });
});

/* ---- 板块列表（管理端，多返回一个 order 字段，便于后台排序） ---- */
forumAdminRouter.get('/admin/forum/boards', requireAuth, requirePerm('forum.read'), async (_req, res) => {
  const rows = await prisma.board.findMany({
    orderBy: { order: 'asc' },
    include: { _count: { select: { posts: true } } },
  });
  res.json({
    items: rows.map((b) => ({
      id: b.id, code: b.code, name: b.name,
      desc: b.desc, note: b.note, order: b.order, posts: b._count.posts,
    })),
  });
});

/* ---- 新建板块 ---- */
forumAdminRouter.post('/admin/forum/boards', requireAuth, requirePerm('forum.write'), async (req, res) => {
  const parsed = AdminBoardIn.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '入参不对' } });
    return;
  }
  const d = parsed.data;
  /* code 唯一 —— 重复会抛 P2002，自己先查一次给个友好的报错 */
  const exists = await prisma.board.findUnique({ where: { code: d.code } });
  if (exists) {
    res.status(400).json({ error: { code: 'DUP_CODE', message: `板块代码 ${d.code} 已存在` } });
    return;
  }
  const created = await prisma.board.create({
    data: {
      code: d.code, name: d.name,
      desc: d.desc ?? null, note: d.note ?? null,
      order: d.order ?? 0,
    },
  });
  res.status(201).json({
    id: created.id, code: created.code, name: created.name,
    desc: created.desc, note: created.note, order: created.order, posts: 0,
  });
});

/* ---- 改板块 ---- */
forumAdminRouter.patch('/admin/forum/boards/:id', requireAuth, requirePerm('forum.write'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '板块 id 不对' } });
    return;
  }
  const parsed = AdminBoardPatchIn.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '入参不对' } });
    return;
  }
  const d = parsed.data;
  const board = await prisma.board.findUnique({ where: { id } });
  if (!board) {
    res.status(404).json({ error: { code: 'NO_BOARD', message: '没有这一块' } });
    return;
  }
  /* 改 code 的话先看新 code 有没有被别人占 */
  if (d.code !== undefined && d.code !== board.code) {
    const other = await prisma.board.findUnique({ where: { code: d.code } });
    if (other && other.id !== id) {
      res.status(400).json({ error: { code: 'DUP_CODE', message: `板块代码 ${d.code} 已存在` } });
      return;
    }
  }
  const updated = await prisma.board.update({
    where: { id },
    data: {
      ...(d.code !== undefined ? { code: d.code } : {}),
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.desc !== undefined ? { desc: d.desc } : {}),
      ...(d.note !== undefined ? { note: d.note } : {}),
      ...(d.order !== undefined ? { order: d.order } : {}),
    },
  });
  res.json({
    id: updated.id, code: updated.code, name: updated.name,
    desc: updated.desc, note: updated.note, order: updated.order,
  });
});

/* ---- 删板块（板块下还有帖子就不让删，免得误操作把别人的帖都带走） ---- */
forumAdminRouter.delete('/admin/forum/boards/:id', requireAuth, requirePerm('forum.write'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '板块 id 不对' } });
    return;
  }
  const board = await prisma.board.findUnique({
    where: { id },
    include: { _count: { select: { posts: true } } },
  });
  if (!board) {
    res.status(404).json({ error: { code: 'NO_BOARD', message: '没有这一块' } });
    return;
  }
  if (board._count.posts > 0) {
    res.status(400).json({
      error: {
        code: 'BOARD_NOT_EMPTY',
        message: `这块板下还有 ${board._count.posts} 帖，先把它们挪走或删掉再来删板块`,
      },
    });
    return;
  }
  await prisma.board.delete({ where: { id } });
  res.json({ ok: true, id });
});
