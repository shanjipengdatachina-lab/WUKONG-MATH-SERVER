/* ==========================================================================
   导入「演示练习记录」（seed/practice-sessions.json → PracticeSession/Answer）
   --------------------------------------------------------------------------
   为什么需要它：习题量 / 正确率这两个指标，**表结构完备但从来没有数据** ——
   全站只有 4 道可判分题（p1~p4），seed 里 0 次练习会话，指标恒为 0。
   恒为 0 的话，连"接口算得对不对"都验不了（0 对 0 永远相等）。

   **这是造的数据，不是真人做的题。** 所以：
     · 范围只到该文件里列出的那几个演示账号，别的一行都不碰
     · 只从 p1~p4 里抽题 —— 58 道白板题（kind=board）没有答案、判不了分，
       给它们编一个 correct 就是在编一件系统自己说做不到的事
     · 导入时先清掉这几个账号已有的练习会话，所以反复跑是幂等的

   文件里的 daysAgo 决定落在哪一天，导入时换成真实时间写进 createdAt / submittedAt，
   这样"近 90 天做了多少次练习"这种统计才有得算。
   ========================================================================== */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const here = dirname(fileURLToPath(import.meta.url));
const SEED_FILE = resolve(here, '../../../../seed/practice-sessions.json');

type Answer = { code: string; correct: boolean };
type Session = { daysAgo: number; answers: Answer[] };
export type PracticeSeed = {
  note: string;
  students: Record<string, { sessions: Session[] }>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function importPracticeSessions(prisma: PrismaClient, seedPath = SEED_FILE): Promise<void> {
  const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as PracticeSeed;

  const usernames = Object.keys(seed.students);
  const users = await prisma.user.findMany({
    where: { username: { in: usernames } },
    select: { id: true, username: true },
  });
  const idOf = new Map(users.map((u) => [u.username, u.id]));

  /* 题号 → id。题在库里是按 code 认的（p1…p4） */
  const questions = await prisma.question.findMany({ select: { id: true, code: true } });
  const qid = new Map(questions.map((q) => [q.code, q.id]));

  /* 幂等：先清掉这几个账号的既有练习会话（答案会跟着 cascade） */
  const userIds = users.map((u) => u.id);
  const cleared = userIds.length
    ? await prisma.practiceSession.deleteMany({ where: { userId: { in: userIds } } })
    : { count: 0 };
  if (cleared.count) { console.log(`[practice] 先清掉这几位演示学生已有的 ${cleared.count} 次练习`); }

  const now = Date.now();
  let sessions = 0;
  let answers = 0;

  for (const [username, data] of Object.entries(seed.students)) {
    const userId = idOf.get(username);
    if (userId === undefined) {
      console.warn(`[practice] 跳过 ${username}：库里没有这个账号`);
      continue;
    }
    for (const s of data.sessions) {
      const at = new Date(now - s.daysAgo * DAY_MS);
      const total = s.answers.length;
      const correct = s.answers.filter((a) => a.correct).length;

      const created = await prisma.practiceSession.create({
        data: {
          /* 演示数据只从 p1~p4（判得了分的题）里抽，所以 judged == total。
             白板题（kind=board）一条都不进来 —— 见文件顶部那三条 */
          userId, total, correct, judged: total, submittedAt: at, createdAt: at,
          answers: {
            create: s.answers
              .map((a, i) => {
                const questionId = qid.get(a.code);
                /* 题号对不上就跳过这一条 —— 宁可少一条，也不要挂到不存在的题上 */
                if (questionId === undefined) { return null; }
                return { questionId, given: a.correct ? '(演示答案)' : '(演示错答)', correct: a.correct, order: i };
              })
              .filter((x): x is { questionId: number; given: string; correct: boolean; order: number } => x !== null),
          },
        },
      });
      sessions += 1;
      answers += created.total;
    }
  }

  console.log(`[practice] 演示练习已入库：${sessions} 次会话 / ${answers} 道答案`);
  console.log('[practice] 注意：**这是演示数据**，用来让"习题量/正确率"有数可算，不是真人做的题。');
}

/* 直接跑：tsx src/seed/practice-sessions.ts */
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const prisma = new PrismaClient();
  importPracticeSessions(prisma)
    .catch((e) => { console.error('[practice] 失败：', e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
