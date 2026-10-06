/* ==========================================================================
   导库 · M5 论坛（板 / 帖 / 回复）
   --------------------------------------------------------------------------
   输入 seed/forum.json（原来存在 localStorage 里的那份，见 assets/js/forum.js）。
   这一支做的唯一一件"新事"：**把 localStorage 里的东西搬进库** ——
   搬进来之后，"换个浏览器登录，帖子还在"才成立。

   时间戳是冻过的（导出时 `Date` 被替换成了固定 now，见 tools/export-demo-data.mjs），
   所以每次导库结果一致。
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';

type SeedBoard = { id: string; name: string; desc?: string; note?: string };
type SeedFloor = { who: string; role?: string; at: number; text: string };
type SeedPost = {
  id: string;
  board: string;
  title: string;
  author: string;
  at: number;
  views?: number;
  body: string;
  floors?: SeedFloor[];
};

export type ForumCounts = { boards: number; posts: number; replies: number };

export function readForumSeed(seedDir: string): { me: string; boards: SeedBoard[]; posts: SeedPost[] } {
  const file = path.join(seedDir, 'forum.json');
  if (!fs.existsSync(file)) {
    throw new Error(`找不到 ${file} —— 先在 WKMATH 仓库跑 node tools/export-demo-data.mjs`);
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    me?: string; boards?: SeedBoard[]; db?: { posts?: SeedPost[] };
  };
  return { me: raw.me ?? '', boards: raw.boards ?? [], posts: (raw.db && raw.db.posts) ?? [] };
}

export async function clearForum(prisma: PrismaClient): Promise<void> {
  await prisma.reply.deleteMany();
  await prisma.post.deleteMany();
  await prisma.board.deleteMany();
}

export async function seedForum(
  prisma: PrismaClient,
  seed: { me: string; boards: SeedBoard[]; posts: SeedPost[] },
): Promise<ForumCounts> {
  const boardIdOf = new Map<string, number>();
  for (let i = 0; i < seed.boards.length; i += 1) {
    const b = seed.boards[i]!;
    const created = await prisma.board.create({
      data: { code: b.id, name: b.name, desc: b.desc ?? null, note: b.note ?? null, order: i },
    });
    boardIdOf.set(b.id, created.id);
  }

  let replies = 0;
  for (const p of seed.posts) {
    const boardId = boardIdOf.get(p.board);
    if (boardId === undefined) {
      throw new Error(`帖子「${p.title}」挂在板 ${p.board} 上，但 boards 里没有这块板`);
    }
    const created = await prisma.post.create({
      data: {
        boardId,
        title: p.title,
        body: p.body,
        authorName: p.author,
        views: p.views ?? 0,
        seedKey: p.id,
        createdAt: new Date(p.at),
      },
    });

    const floors = p.floors ?? [];
    if (floors.length) {
      await prisma.reply.createMany({
        data: floors.map((f, i) => ({
          postId: created.id,
          authorName: f.who,
          role: f.role ?? null,
          text: f.text,
          createdAt: new Date(f.at),
          seedKey: `${p.id}#${i + 1}`,
        })),
      });
      replies += floors.length;
    }
  }

  return { boards: seed.boards.length, posts: seed.posts.length, replies };
}
