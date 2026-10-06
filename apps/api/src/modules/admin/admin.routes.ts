/* ==========================================================================
   管理后台专用接口
   --------------------------------------------------------------------------
   **每一个都挂 requirePerm** —— 后台接口是权限最该收紧的地方：
   它比学生端能看到更多东西（用户表、统计、将来的订单）。
   权限点写在路由声明上，不在处理函数里手写角色判断（§7.1）。
   ========================================================================== */
import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../../openapi.js';
import { prisma } from '../../db.js';
import { requireAuth, requirePerm } from '../../middleware/auth.js';

const Stats = z.object({
  nodes: z.record(z.string(), z.number()).describe('按 kind 分组的节点数'),
  nodeTotal: z.number(),
  cards: z.number(),
  contents: z.number(),
  users: z.number(),
  sessionsAlive: z.number(),
  roles: z.number(),
});

const UserRow = z.object({
  id: z.number(), username: z.string(), nickname: z.string(),
  grade: z.string().nullable(), role: z.string(), createdAt: z.string(),
});
const UserList = z.object({ total: z.number(), items: z.array(UserRow) });

registry.registerPath({
  method: 'get', path: '/api/admin/stats', summary: '后台概览（需 content.read）',
  responses: { 200: { description: '统计', content: { 'application/json': { schema: Stats } } }, 403: { description: '没权限' } },
});
registry.registerPath({
  method: 'get', path: '/api/admin/users', summary: '用户列表（需 user.read）',
  responses: { 200: { description: '用户', content: { 'application/json': { schema: UserList } } }, 403: { description: '没权限' } },
});

export const adminRouter = Router();

adminRouter.get('/admin/stats', requireAuth, requirePerm('content.read'), async (_req, res) => {
  const byKind = await prisma.node.groupBy({ by: ['kind'], _count: { _all: true } });
  const nodes: Record<string, number> = {};
  byKind.forEach((k) => { nodes[k.kind] = k._count._all; });

  const [nodeTotal, cards, contents, users, sessionsAlive, roles] = await Promise.all([
    prisma.node.count(),
    prisma.card.count(),
    prisma.content.count(),
    prisma.user.count(),
    prisma.session.count({ where: { revokedAt: null } }),
    prisma.role.count(),
  ]);

  res.json({ nodes, nodeTotal, cards, contents, users, sessionsAlive, roles });
});

adminRouter.get('/admin/users', requireAuth, requirePerm('user.read'), async (_req, res) => {
  const rows = await prisma.user.findMany({ include: { role: true }, orderBy: { id: 'asc' } });
  res.json({
    total: rows.length,
    items: rows.map((u) => ({
      id: u.id, username: u.username, nickname: u.nickname,
      grade: u.grade, role: u.role.code, createdAt: u.createdAt.toISOString(),
    })),
  });
});
