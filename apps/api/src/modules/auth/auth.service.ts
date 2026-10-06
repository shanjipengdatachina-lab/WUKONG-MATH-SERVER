/* ==========================================================================
   账号 · 业务动作
   --------------------------------------------------------------------------
   密码用 **bcryptjs**（纯 JS）。为什么不上原生 argon2：
   这台开发机的 CLT 是坏的、npm 11 又默认拦 postinstall —— 原生模块编译和预编译
   两条路都堵。bcryptjs 纯 JS、零编译，代价只是慢一点；以后上生产服务器再换 argon2id 也行，
   换的时候只需要动这一个文件（哈希格式自带前缀，新旧能共存）。
   ========================================================================== */
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { prisma } from '../../db.js';

const ROUNDS = 10;

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(plain, hash);
  } catch {
    return false;
  }
}

export type RegisterInput = {
  username: string;
  password: string;
  nickname: string;
  grade?: string | null;
};

export async function createUser(input: RegisterInput) {
  const role = await prisma.role.findUnique({ where: { code: 'student' } });
  if (!role) { throw new Error('没有 student 角色 —— 先跑 npm run db:seed'); }

  return prisma.user.create({
    data: {
      username: input.username,
      passwordHash: hashPassword(input.password),
      nickname: input.nickname,
      grade: input.grade ?? null,
      roleId: role.id,
    },
  });
}

export async function findByUsername(username: string) {
  return prisma.user.findUnique({ where: { username }, include: { role: true } });
}

/** 发一个一次性重置令牌。返回明文 token（生产里这一步是发邮件，这里由调用方决定怎么给）。 */
export async function issueResetToken(userId: number, ttlMinutes = 30) {
  const token = randomBytes(24).toString('hex');
  await prisma.passwordReset.create({
    data: { userId, token, expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000) },
  });
  return token;
}

export async function consumeResetToken(token: string): Promise<number | null> {
  const row = await prisma.passwordReset.findUnique({ where: { token } });
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) { return null; }
  await prisma.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return row.userId;
}

export async function setPassword(userId: number, plain: string) {
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: hashPassword(plain) } });
  /* 改密的同时**把该用户所有会话一起吊销**：改密往往正是为了处理"账号被人拿了"，
     不吊销的话攻击者手里那个令牌照样能用，等于白改。 */
  await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/* ---- 会话：让"登出"真的生效（见 schema 里 Session 那段注释） ---- */

export async function createSession(userId: number): Promise<number> {
  const row = await prisma.session.create({ data: { userId } });
  return row.id;
}

export async function revokeSession(sessionId: number): Promise<void> {
  await prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** 会话还有效吗（存在、且没被吊销） */
export async function sessionAlive(sessionId: number): Promise<boolean> {
  const row = await prisma.session.findUnique({ where: { id: sessionId } });
  return !!row && row.revokedAt === null;
}
