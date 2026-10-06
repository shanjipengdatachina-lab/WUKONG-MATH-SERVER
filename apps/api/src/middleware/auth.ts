/* ==========================================================================
   鉴权中间件
   --------------------------------------------------------------------------
   规矩（设计稿 §7.1）：**权限判定只在这里和路由声明上做**，不许在业务代码里手写
   `if (user.role === 'admin')` —— 那种写法散开之后没人说得清"这个接口到底谁能进"。

   token 走 **httpOnly Cookie**，不放 localStorage：后者一被 XSS 就没了。
   生产是 Nginx 同域反代，所以 SameSite=Lax 就够，不用处理跨站那套。
   ========================================================================== */
import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { sessionAlive } from '../modules/auth/auth.service.js';

export type AuthUser = {
  id: number;
  username: string;
  nickname: string;
  grade: string | null;
  roleCode: string;
  /** 这个角色带的权限点 —— 接口按它放行 */
  perms: string[];
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(userId: number, sessionId: number): string {
  /* 用秒数而不是 '7d' 这种字符串：@types/jsonwebtoken 对字符串形式卡得很死，
     而且秒数和 config 里的天数同源，不会两处对不上。 */
  return jwt.sign({ uid: userId, sid: sessionId }, config.auth.jwtSecret, {
    expiresIn: config.auth.ttlDays * 24 * 60 * 60,
  });
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.isProd,
    path: '/',
    maxAge: config.auth.ttlDays * 24 * 60 * 60 * 1000,
  };
}

/** 从 cookie 里认出"你是谁"。认不出就 401，不做任何静默放行。 */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const raw = req.cookies ? req.cookies[config.auth.cookieName] : undefined;
  if (!raw) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: '请先登录' } });
    return;
  }

  let uid: number;
  let sid: number;
  try {
    const payload = jwt.verify(raw, config.auth.jwtSecret) as { uid?: number; sid?: number };
    if (typeof payload.uid !== 'number' || typeof payload.sid !== 'number') {
      throw new Error('token 里缺 uid 或 sid');
    }
    uid = payload.uid;
    sid = payload.sid;
  } catch {
    res.status(401).json({ error: { code: 'BAD_TOKEN', message: '登录状态已失效，请重新登录' } });
    return;
  }

  /* 会话被吊销（登出 / 别处改了密码）就作废 —— 这一步是"登出真的登出"的关键 */
  if (!(await sessionAlive(sid))) {
    res.status(401).json({ error: { code: 'SESSION_REVOKED', message: '登录已失效，请重新登录' } });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: uid },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  if (!user) {
    res.status(401).json({ error: { code: 'NO_USER', message: '账号不存在' } });
    return;
  }

  /* 停用的账号**立刻**失效：不用等会话过期，也不用等定时任务扫 ——
     判定就是当下这一眼的 disabledAt。 */
  if (user.disabledAt) {
    res.status(403).json({ error: { code: 'ACCOUNT_DISABLED', message: '这个账号已被停用，请联系老师' } });
    return;
  }

  req.user = {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    grade: user.grade,
    roleCode: user.role.code,
    perms: user.role.permissions.map((rp) => rp.permission.code),
  };
  next();
};

/** 按角色放行。用法：`router.get('/x', requireAuth, requireRole('admin'), h)` */
export function requireRole(...codes: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: '请先登录' } });
      return;
    }
    if (codes.indexOf(req.user.roleCode) < 0) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '这个操作需要更高的权限' } });
      return;
    }
    next();
  };
}

/** 按权限点放行。角色是"人"，权限点是"事" —— 以后加角色不用改接口。 */
export function requirePerm(code: string): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: '请先登录' } });
      return;
    }
    if (req.user.perms.indexOf(code) < 0) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '这个操作需要更高的权限' } });
      return;
    }
    next();
  };
}
