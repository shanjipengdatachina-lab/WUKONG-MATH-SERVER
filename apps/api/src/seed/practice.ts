/* ==========================================================================
   导库 · M4 题库（可判分的题 + 只有题面的题）
   --------------------------------------------------------------------------
   两份输入：
     · seed/practice-questions.json —— practice.html 里那几道，**带正确选项与解析**（可判分）
     · seed/wb-problems.json        —— 白板题库 58 条，只有题面（kind = board，判不了分）
   两份都读，但 kind 分得清清楚楚 —— 混在一起的话，"做题"这件事就没法设计了。
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';

type SeedQuestion = {
  no: number;
  kind: string;
  tag: string;
  stem: string;
  options: { key: string; text: string }[];
  blanks: { label: string; answer: string }[];
  answer: string;
  explanation: string;
  source: string;
};

type WbProblem = { id: string; book: string; chapter: string; text: string };

export type PracticeCounts = { choice: number; blank: number; board: number; total: number };

export function readPracticeSeed(seedDir: string): { questions: SeedQuestion[]; board: WbProblem[] } {
  const qFile = path.join(seedDir, 'practice-questions.json');
  const wbFile = path.join(seedDir, 'wb-problems.json');
  if (!fs.existsSync(qFile)) {
    throw new Error(`找不到 ${qFile} —— 先在 WKMATH 仓库跑 node tools/export-demo-data.mjs`);
  }
  const questions = (JSON.parse(fs.readFileSync(qFile, 'utf8')) as { questions: SeedQuestion[] }).questions ?? [];
  const board = fs.existsSync(wbFile) ? (JSON.parse(fs.readFileSync(wbFile, 'utf8')) as WbProblem[]) : [];
  return { questions, board };
}

export async function clearPractice(prisma: PrismaClient): Promise<void> {
  await prisma.practiceAnswer.deleteMany();
  await prisma.practiceSession.deleteMany();
  await prisma.question.deleteMany();
}

export async function seedPractice(
  prisma: PrismaClient,
  seed: { questions: SeedQuestion[]; board: WbProblem[] },
): Promise<PracticeCounts> {
  const rows = seed.questions.map((q, i) => {
    if (!q.answer) {
      /* 没答案的题不进来 —— 进来了就会在"做题"里被全判错，那是骗人 */
      throw new Error(`练习题 ${q.no} 没有答案，不能进题库`);
    }
    return {
      kind: q.kind === 'blank' ? 'blank' : 'choice',
      code: 'p' + (i + 1),
      tag: q.tag || null,
      stem: q.stem,
      options: q.options && q.options.length ? JSON.stringify(q.options) : null,
      blanks: q.blanks && q.blanks.length ? JSON.stringify(q.blanks) : null,
      answer: q.answer,
      explanation: q.explanation || null,
      source: q.source || 'practice.html',
      order: i,
    };
  });

  await prisma.question.createMany({ data: rows });

  const boardRows = seed.board.map((p, i) => ({
    kind: 'board',
    code: p.id,
    tag: [p.book, p.chapter].filter(Boolean).join(' · ') || null,
    stem: p.text,
    options: null,
    blanks: null,
    answer: null,
    explanation: null,
    source: 'whiteboard-problems.js',
    order: rows.length + i,
  }));
  if (boardRows.length) { await prisma.question.createMany({ data: boardRows }); }

  return {
    choice: rows.filter((r) => r.kind === 'choice').length,
    blank: rows.filter((r) => r.kind === 'blank').length,
    board: boardRows.length,
    total: rows.length + boardRows.length,
  };
}
