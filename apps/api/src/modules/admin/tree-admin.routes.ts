/* ==========================================================================
   /api/admin/nodes* —— 后台录数据：知识树的增删改 + 正文
   --------------------------------------------------------------------------
   这是 M6 之前最要紧的一件事：**「章节 / 图谱 / 时间轴的数据都是从后台录入的」**
   （用户 2026-10-05 的原话）。在这之前树的接口是只读的，一章一节都改不了。

   三条设计上的取舍，都写在这里免得以后被"优化"掉：

   1. **改完树不需要清任何缓存。** `/api/tree` 的 version 是整棵树现算的哈希；
      `/api/me/learning` 的轴顺序是读的时候现算的（见 tree/axis.service.ts）。
      所以"改一次、三处一起变"是这套结构的**自然结果**，不靠谁记得去清缓存。
      这也是当初不肯把 axisIndex 存进学习记录的原因。

   2. **字段按 kind 白名单收。** 真实数据里每种节点的补充字段是固定的
      （册：stage + source；章：no + field + cn + unit + pending；节/知识点/方法/易错/真题：no；
       组：tone）。不在白名单里的字段一律置空 —— 比"拒绝保存"友好，
      但库里不会积下"节上挂了 stage"这种没人看得懂的数据。

   3. **删除要显式确认子节点。** 删一个册等于删掉它底下 185 个章 ——
      不带 `?withChildren=1` 时若还有子节点就直接拒绝，并且把数量告诉调用方。
   ========================================================================== */
import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../../openapi.js';
import { prisma } from '../../db.js';
import { requireAuth, requirePerm } from '../../middleware/auth.js';

/* 11 种节点（与 tree.service.ts 里那份说明一致）。
   formula 是 2026-10-07 加的第四种"卡片桶"：方法速学 / 易错速析 / 真题速练 / 公式速查。 */
const KINDS = ['root', 'book', 'chapter', 'section', 'point', 'group', 'method', 'error', 'exam', 'formula', 'track'] as const;

/** 每种节点允许带哪些补充字段（照 seed/math-tree.json 的实际情况定的，不是猜的） */
const KIND_FIELDS: Record<string, string[]> = {
  root: [],
  book: ['stage', 'source'],
  track: ['stage', 'source'],
  chapter: ['no', 'field', 'cn', 'unit', 'pending'],
  section: ['no'],
  point: ['no'],
  group: ['tone'],
  method: ['no'],
  error: ['no'],
  exam: ['no'],
  formula: ['no'],
};

const NodeFields = {
  name: z.string().min(1).max(191),
  no: z.string().max(32).nullable().optional(),
  stage: z.string().max(16).nullable().optional().describe('primary | junior | senior | olympiad'),
  source: z.string().max(512).nullable().optional(),
  field: z.string().max(64).nullable().optional(),
  cn: z.string().max(16).nullable().optional(),
  unit: z.boolean().nullable().optional(),
  pending: z.string().nullable().optional(),
  tone: z.string().max(16).nullable().optional().describe('method | error | exam'),
};

const NodeCreateIn = z.object({
  parentId: z.number().int().positive().nullable().describe('根节点传 null；正常新增都挂在某个节点下'),
  kind: z.enum(KINDS),
  ...NodeFields,
  /** 插到兄弟里的第几位；不传就放最后 */
  index: z.number().int().min(0).optional(),
});

const NodePatchIn = z.object({
  name: z.string().min(1).max(191).optional(),
  no: z.string().max(32).nullable().optional(),
  stage: z.string().max(16).nullable().optional(),
  source: z.string().max(512).nullable().optional(),
  field: z.string().max(64).nullable().optional(),
  cn: z.string().max(16).nullable().optional(),
  unit: z.boolean().nullable().optional(),
  pending: z.string().nullable().optional(),
  tone: z.string().max(16).nullable().optional(),
});

const NodeMoveIn = z.object({
  parentId: z.number().int().positive().nullable(),
  index: z.number().int().min(0).optional(),
});

const ContentIn = z.object({
  html: z.string().min(1).max(400_000),
  note: z.string().max(200).optional().describe('这一版改了什么（只记在返回里，不入库）'),
});

const Err = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const IdParam = z.object({ id: z.coerce.number().int().positive() });

registry.registerPath({
  method: 'get', path: '/api/admin/nodes/{id}', summary: '节点详情（含子节点数、正文版本数）',
  request: { params: IdParam },
  responses: { 200: { description: '详情' }, 404: { description: '没有这个节点', content: { 'application/json': { schema: Err } } } },
});
registry.registerPath({
  method: 'post', path: '/api/admin/nodes', summary: '新增节点（需 tree.write）',
  request: { body: { content: { 'application/json': { schema: NodeCreateIn } } } },
  responses: { 201: { description: '建好了' }, 400: { description: '入参不对' }, 403: { description: '没权限' } },
});
registry.registerPath({
  method: 'patch', path: '/api/admin/nodes/{id}', summary: '改节点字段（需 tree.write）',
  request: { params: IdParam, body: { content: { 'application/json': { schema: NodePatchIn } } } },
  responses: { 200: { description: '改好了' }, 400: { description: '入参不对' }, 404: { description: '没有这个节点' } },
});
registry.registerPath({
  method: 'delete', path: '/api/admin/nodes/{id}', summary: '删节点（需 tree.write，有子节点要 ?withChildren=1）',
  request: { params: IdParam },
  responses: {
    200: { description: '删掉了' },
    400: { description: '还有子节点，或想删根' },
    404: { description: '没有这个节点' },
  },
});
registry.registerPath({
  method: 'post', path: '/api/admin/nodes/{id}/move', summary: '移动 / 排序节点（需 tree.write）',
  request: { params: IdParam, body: { content: { 'application/json': { schema: NodeMoveIn } } } },
  responses: { 200: { description: '挪好了' }, 400: { description: '不能挪到自己的后代底下' } },
});
registry.registerPath({
  method: 'get', path: '/api/admin/nodes/{id}/content/versions', summary: '正文的版本列表（需 content.read）',
  request: { params: IdParam },
  responses: { 200: { description: '版本列表' } },
});
registry.registerPath({
  method: 'put', path: '/api/admin/nodes/{id}/content', summary: '写正文，存成新的一版（需 content.write）',
  request: { params: IdParam, body: { content: { 'application/json': { schema: ContentIn } } } },
  responses: { 200: { description: '存好了' }, 400: { description: '正文为空' }, 403: { description: '没权限' } },
});

export const treeAdminRouter = Router();

type NodeRow = {
  id: number; kind: string; name: string; no: string | null; stage: string | null;
  source: string | null; field: string | null; cn: string | null; unit: boolean | null;
  pending: string | null; tone: string | null; order: number; parentId: number | null;
};

function toOut(n: NodeRow) {
  return {
    id: n.id, kind: n.kind, name: n.name, no: n.no, stage: n.stage, source: n.source,
    field: n.field, cn: n.cn, unit: n.unit, pending: n.pending, tone: n.tone,
    order: n.order, parentId: n.parentId,
  };
}

/** 把不在这个 kind 白名单里的字段清成 null —— 库里不留"节上带 stage"这种数据。 */
function cleanByKind(kind: string, input: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set(KIND_FIELDS[kind] ?? []);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === 'name') { out[k] = v; continue; }
    out[k] = allowed.has(k) ? v : null;
  }
  return out;
}

/** 兄弟节点重新编号 0..n-1。**必须是稠密的** —— 轴是按 order 排的，留空洞早晚出事。 */
async function renumber(parentId: number | null): Promise<void> {
  const siblings = await prisma.node.findMany({
    where: { parentId },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
    select: { id: true, order: true },
  });
  for (let i = 0; i < siblings.length; i += 1) {
    const s = siblings[i]!;
    if (s.order !== i) {
      await prisma.node.update({ where: { id: s.id }, data: { order: i } });
    }
  }
}

/** 收集一个节点的全部后代 id（含自己）。用来看"删掉会带走多少"。 */
async function subtreeIds(rootId: number): Promise<number[]> {
  const all = await prisma.node.findMany({ select: { id: true, parentId: true } });
  const kids = new Map<number | null, number[]>();
  all.forEach((n) => {
    const list = kids.get(n.parentId);
    if (list) { list.push(n.id); } else { kids.set(n.parentId, [n.id]); }
  });
  const out: number[] = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    (kids.get(id) ?? []).forEach((k) => stack.push(k));
  }
  return out;
}

async function nodeOr404(id: number): Promise<NodeRow | null> {
  return (await prisma.node.findUnique({ where: { id } })) as NodeRow | null;
}

/* ---------------- 详情 ---------------- */

treeAdminRouter.get(
  '/admin/nodes/:id',
  requireAuth, requirePerm('content.read'),
  async (req, res) => {
    const parsed = IdParam.safeParse(req.params);
    if (!parsed.success) { res.status(400).json({ error: { code: 'BAD_PARAM', message: '节点 id 得是正整数' } }); return; }

    const node = await nodeOr404(parsed.data.id);
    if (!node) { res.status(404).json({ error: { code: 'NO_NODE', message: '没有这个节点' } }); return; }

    const [children, subtree, contentCount, latest] = await Promise.all([
      prisma.node.count({ where: { parentId: node.id } }),
      subtreeIds(node.id),
      prisma.content.count({ where: { nodeId: node.id } }),
      prisma.content.findFirst({ where: { nodeId: node.id }, orderBy: { version: 'desc' }, select: { version: true } }),
    ]);

    res.json({
      node: toOut(node),
      kindFields: KIND_FIELDS[node.kind] ?? [],
      children,
      descendants: subtree.length - 1,
      contentVersions: contentCount,
      latestContentVersion: latest ? latest.version : null,
    });
  },
);

/* ---------------- 新增 ---------------- */

treeAdminRouter.post(
  '/admin/nodes',
  requireAuth, requirePerm('tree.write'),
  async (req, res) => {
    const parsed = NodeCreateIn.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '入参不对' } });
      return;
    }
    const d = parsed.data;

    if (d.parentId === null) {
      /* 只允许一个根。真要多根，轴那套"唯一根"的假设就塌了。 */
      const roots = await prisma.node.count({ where: { parentId: null } });
      if (roots > 0) {
        res.status(400).json({ error: { code: 'ROOT_EXISTS', message: '已经有根节点了，新节点要挂在某个父节点下' } });
        return;
      }
      if (d.kind !== 'root') {
        res.status(400).json({ error: { code: 'BAD_INPUT', message: '只有 kind=root 才能挂在 null 下' } });
        return;
      }
    } else {
      const parent = await nodeOr404(d.parentId);
      if (!parent) {
        res.status(400).json({ error: { code: 'NO_PARENT', message: `父节点 ${d.parentId} 不存在` } });
        return;
      }
      if (d.kind === 'root') {
        res.status(400).json({ error: { code: 'BAD_INPUT', message: '根节点不能挂在别的节点下' } });
        return;
      }
    }

    const siblings = await prisma.node.count({ where: { parentId: d.parentId } });
    const index = d.index === undefined ? siblings : Math.min(d.index, siblings);

    const cleaned = cleanByKind(d.kind, {
      name: d.name, no: d.no, stage: d.stage, source: d.source,
      field: d.field, cn: d.cn, unit: d.unit, pending: d.pending, tone: d.tone,
    });

    const created = await prisma.node.create({
      data: {
        parentId: d.parentId,
        kind: d.kind,
        ...(cleaned as { name: string }),
        /* 先占一个"后面一点"的位，再统一重排 —— 这样插入到中间时不用手工腾位置 */
        order: index + 1000,
      },
    });

    /* 先占一个"靠后"的位（+1000），再把整组兄弟重排成 0..n-1 并把新节点挪到 index ——
       这样"插到中间"不用手工给后面的兄弟腾位置。 */
    const sibs = await prisma.node.findMany({
      where: { parentId: d.parentId },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    const ids = sibs.map((s) => s.id).filter((id) => id !== created.id);
    ids.splice(index, 0, created.id);
    for (let i = 0; i < ids.length; i += 1) {
      await prisma.node.update({ where: { id: ids[i]! }, data: { order: i } });
    }

    const fresh = await nodeOr404(created.id);
    res.status(201).json({ node: toOut(fresh!) });
  },
);

/* ---------------- 改字段 ---------------- */

treeAdminRouter.patch(
  '/admin/nodes/:id',
  requireAuth, requirePerm('tree.write'),
  async (req, res) => {
    const parsed = IdParam.safeParse(req.params);
    const body = NodePatchIn.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: { code: 'BAD_PARAM', message: '节点 id 得是正整数' } }); return; }
    if (!body.success) {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: body.error.issues[0]?.message ?? '入参不对' } });
      return;
    }

    const node = await nodeOr404(parsed.data.id);
    if (!node) { res.status(404).json({ error: { code: 'NO_NODE', message: '没有这个节点' } }); return; }

    if (node.kind === 'root' && body.data.name === undefined) {
      const bad = Object.keys(body.data).filter((k) => k !== 'name');
      if (bad.length) {
        res.status(400).json({ error: { code: 'BAD_INPUT', message: '根节点没有补充字段可改' } });
        return;
      }
    }

    const cleaned = cleanByKind(node.kind, body.data as Record<string, unknown>);
    const updated = await prisma.node.update({ where: { id: node.id }, data: cleaned as { name?: string } });
    res.json({ node: toOut(updated as NodeRow) });
  },
);

/* ---------------- 移动 / 排序 ---------------- */

treeAdminRouter.post(
  '/admin/nodes/:id/move',
  requireAuth, requirePerm('tree.write'),
  async (req, res) => {
    const parsed = IdParam.safeParse(req.params);
    const body = NodeMoveIn.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: { code: 'BAD_PARAM', message: '节点 id 得是正整数' } }); return; }
    if (!body.success) { res.status(400).json({ error: { code: 'BAD_INPUT', message: 'parentId 必填' } }); return; }

    const id = parsed.data.id;
    const target = body.data.parentId;
    const node = await nodeOr404(id);
    if (!node) { res.status(404).json({ error: { code: 'NO_NODE', message: '没有这个节点' } }); return; }
    if (node.kind === 'root') { res.status(400).json({ error: { code: 'BAD_INPUT', message: '根节点不能移动' } }); return; }

    if (target !== null) {
      const parent = await nodeOr404(target);
      if (!parent) { res.status(400).json({ error: { code: 'NO_PARENT', message: `父节点 ${target} 不存在` } }); return; }
      /* **不能挪到自己的后代底下** —— 那会把这一支从树上摘掉，还绕成一个环。 */
      const sub = await subtreeIds(id);
      if (sub.indexOf(target) >= 0) {
        res.status(400).json({ error: { code: 'CYCLE', message: '不能把节点挪到它自己或它的后代下面' } });
        return;
      }
    }

    const oldParent = node.parentId;
    const siblings = await prisma.node.count({ where: { parentId: target, NOT: { id } } });
    const index = body.data.index === undefined ? siblings : Math.min(body.data.index, siblings);

    await prisma.node.update({ where: { id }, data: { parentId: target, order: index + 1000 } });
    await renumber(oldParent);
    await renumber(target);

    const sibs = await prisma.node.findMany({
      where: { parentId: target },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    const ids = sibs.map((s) => s.id).filter((x) => x !== id);
    ids.splice(index, 0, id);
    for (let i = 0; i < ids.length; i += 1) {
      await prisma.node.update({ where: { id: ids[i]! }, data: { order: i } });
    }

    const fresh = await nodeOr404(id);
    res.json({ node: toOut(fresh!) });
  },
);

/* ---------------- 删除 ---------------- */

treeAdminRouter.delete(
  '/admin/nodes/:id',
  requireAuth, requirePerm('tree.write'),
  async (req, res) => {
    const parsed = IdParam.safeParse(req.params);
    if (!parsed.success) { res.status(400).json({ error: { code: 'BAD_PARAM', message: '节点 id 得是正整数' } }); return; }

    const node = await nodeOr404(parsed.data.id);
    if (!node) { res.status(404).json({ error: { code: 'NO_NODE', message: '没有这个节点' } }); return; }
    if (node.kind === 'root') {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: '根节点不能删 —— 整棵树要有一个根' } });
      return;
    }

    const ids = await subtreeIds(node.id);
    const withChildren = req.query.withChildren === '1' || req.query.withChildren === 'true';
    if (ids.length > 1 && !withChildren) {
      res.status(400).json({
        error: {
          code: 'HAS_CHILDREN',
          message: `这个节点底下还有 ${ids.length - 1} 个节点。确认要一起删就带 ?withChildren=1`,
        },
        descendants: ids.length - 1,
      });
      return;
    }

    /* 连带删掉这一支的正文与卡片（Content / Card 都是 onDelete: Cascade）。
       学习记录与标记也挂在这些节点上，同样级联 —— 那一格不存在了，记录也就没有意义了。
       错题不级联：它是历史记录，名字快照留在 Mistake.nodeName 上。 */
    await prisma.node.deleteMany({ where: { id: { in: ids } } });
    await renumber(node.parentId);

    res.json({ deleted: ids.length });
  },
);

/* ---------------- 正文 ---------------- */

treeAdminRouter.get(
  '/admin/nodes/:id/content/versions',
  requireAuth, requirePerm('content.read'),
  async (req, res) => {
    const parsed = IdParam.safeParse(req.params);
    if (!parsed.success) { res.status(400).json({ error: { code: 'BAD_PARAM', message: '节点 id 得是正整数' } }); return; }

    const rows = await prisma.content.findMany({
      where: { nodeId: parsed.data.id },
      orderBy: { version: 'desc' },
      select: { version: true, publishedAt: true, createdAt: true, html: true },
    });
    res.json({
      total: rows.length,
      items: rows.map((r) => ({
        version: r.version,
        publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        chars: r.html.length,
      })),
    });
  },
);

treeAdminRouter.get(
  '/admin/nodes/:id/content/versions/:version',
  requireAuth, requirePerm('content.read'),
  async (req, res) => {
    const id = Number(req.params.id);
    const version = Number(req.params.version);
    if (!Number.isInteger(id) || !Number.isInteger(version)) {
      res.status(400).json({ error: { code: 'BAD_PARAM', message: 'id 与 version 都得是正整数' } });
      return;
    }
    const row = await prisma.content.findFirst({ where: { nodeId: id, version } });
    if (!row) { res.status(404).json({ error: { code: 'NO_CONTENT', message: '没有这一版正文' } }); return; }
    res.json({
      nodeId: row.nodeId, version: row.version, html: row.html,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    });
  },
);

treeAdminRouter.put(
  '/admin/nodes/:id/content',
  requireAuth, requirePerm('content.write'),
  async (req, res) => {
    const parsed = IdParam.safeParse(req.params);
    const body = ContentIn.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: { code: 'BAD_PARAM', message: '节点 id 得是正整数' } }); return; }
    if (!body.success) {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: body.error.issues[0]?.message ?? '正文不能为空' } });
      return;
    }

    const node = await nodeOr404(parsed.data.id);
    if (!node) { res.status(404).json({ error: { code: 'NO_NODE', message: '没有这个节点' } }); return; }

    /* **改一次存一版，不覆盖历史** —— 正文是这站最贵的资产（唯一一篇 4218 字是人写的），
       覆盖式保存等于把上一版直接丢了，改坏了没法回退。 */
    const last = await prisma.content.findFirst({
      where: { nodeId: node.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (last ? last.version : 0) + 1;

    const created = await prisma.content.create({
      data: { nodeId: node.id, html: body.data.html, version, publishedAt: new Date() },
    });

    res.json({
      nodeId: created.nodeId,
      version: created.version,
      chars: created.html.length,
      publishedAt: created.publishedAt ? created.publishedAt.toISOString() : null,
      note: body.data.note ?? null,
    });
  },
);
