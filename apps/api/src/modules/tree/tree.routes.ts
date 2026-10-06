/* ==========================================================================
   GET /api/tree —— 一次拉全树（公开，免登录）
   --------------------------------------------------------------------------
   章节 / 图谱 / 时间轴 三处都读它。ETag 用**内容哈希**：树没变就 304，
   学生端那层只读缓存（Task 1.4）靠它判断"要不要重下"。
   ========================================================================== */
import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../../openapi.js';
import { loadTree } from './tree.service.js';

/* 文档里只展开一层：这棵树有 1391 个节点、10 种 kind，Swagger 里铺开是噪声。
   真正的形状说明写在 description 里。 */
const TreeNodeDoc = z.object({
  id: z.number(),
  kind: z.string().describe('root | book | chapter | section | point | group | method | error | exam | track'),
  name: z.string(),
  no: z.string().optional().describe('节 / 知识点 / 卡片的序号'),
  stage: z.string().optional().describe('primary | junior | senior | olympiad'),
  source: z.string().optional().describe('出处链接（册 / 竞赛轨道）'),
  field: z.string().optional().describe('领域（章）'),
  cn: z.string().optional().describe('中文序号（章）'),
  unit: z.boolean().optional().describe('单元标记（章）'),
  pending: z.string().optional().describe('待核对说明（章）'),
  tone: z.string().optional().describe('分组色调：method | error | exam'),
  children: z
    .array(z.unknown())
    .optional()
    .describe('递归：每个元素与父节点同结构（这里为文档可读只展开一层）'),
});

const TreeResponse = z.object({
  version: z.string().describe('整棵树的内容哈希（sha1 前 12 位）；同时用作 ETag'),
  tree: TreeNodeDoc,
});

registry.registerPath({
  method: 'get',
  path: '/api/tree',
  summary: '知识树（全量）',
  description:
    '章节 / 图谱 / 时间轴共用的唯一一份。树的形状与前端原来的 window.MATH_TREE 一致，' +
    '只多了一个 id（取正文要用）。带 ETag：内容没变时回 304。',
  responses: {
    200: { description: '整棵树', content: { 'application/json': { schema: TreeResponse } } },
    304: { description: '内容没变（If-None-Match 命中）' },
  },
});

export const treeRouter = Router();

treeRouter.get('/tree', async (req, res) => {
  const { version, tree } = await loadTree();
  const etag = `"${version}"`;

  res.setHeader('ETag', etag);
  /* 不许"存 5 分钟再问"：后台一改树就要立刻看得见（改完学生端刷新也是新的）。
     用 no-cache 而不是 no-store —— 缓存可以留，但每次都得拿 ETag 回来问一句；
     内容没变照样回 304，所以带宽并没有多花。 */
  res.setHeader('Cache-Control', 'no-cache');

  /* 版本对得上就回 304。两条路都认：
       · `If-None-Match` —— HTTP 标准做法，给工具 / CDN / 浏览器自己的 HTTP 缓存用；
       · `?version=`  —— 学生端走这条。为什么不用标准那条：`If-None-Match` **不在 CORS 安全名单**里，
         浏览器每次都得先发一个 OPTIONS 预检 —— 实测那一路在 Chrome 里以 net::ERR_ABORTED 收场
         （服务端其实回了 304），于是每个页面白跑一趟预检、还退回缓存。查询参数不触发预检，
         一次往返就够。 */
  const inm = req.headers['if-none-match'];
  const q = typeof req.query.version === 'string' ? req.query.version : '';
  if (inm === etag || (q !== '' && q === version)) {
    res.status(304).end();
    return;
  }
  res.json({ version, tree });
});
