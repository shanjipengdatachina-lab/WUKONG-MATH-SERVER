/* ==========================================================================
   /api/auth/* 与 /api/me —— 账号
   --------------------------------------------------------------------------
   出入参一律用 zod 描述（一份 schema 同时管校验和 Swagger，§7.1）。

   **措辞故意模糊**：登录失败只说「账号或密码不对」，不说「这个账号不存在」——
   后者等于免费送人一个账号枚举接口。
   ========================================================================== */
import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../../openapi.js';
import { prisma } from '../../db.js';
import { config } from '../../config.js';
import jwt from 'jsonwebtoken';
import { requireAuth, signToken, cookieOptions } from '../../middleware/auth.js';
import {
  createUser, findByUsername, verifyPassword,
  issueResetToken, consumeResetToken, setPassword,
  createSession, revokeSession,
} from './auth.service.js';

const UserOut = z.object({
  id: z.number(),
  username: z.string(),
  nickname: z.string(),
  grade: z.string().nullable(),
  role: z.string().describe('admin | student'),
  perms: z.array(z.string()).describe('这个角色带的权限点，前端按它显隐菜单；真正的判定在服务端'),
});

const Err = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/* 密码规则与前端 assets/js/auth-pages.js 里的 passwordProblem() **保持一致**：
   至少 8 位、且字母与数字都要有。前端那份只是为了少跑一趟网络，判定以这里为准。 */
const PasswordIn = z.string().min(8, "密码至少 8 位").max(72)
  .regex(/[A-Za-z]/, "密码要同时含字母和数字").regex(/[0-9]/, "密码要同时含字母和数字");
const RegisterIn = z.object({
  username: z.string().min(3).max(32).regex(/^[A-Za-z0-9_.-]+$/).describe('登录名：字母数字和 _ . -'),
  password: PasswordIn,
  nickname: z.string().min(1).max(32),
  grade: z.string().max(32).optional(),
});

const LoginIn = z.object({ username: z.string().min(1), password: z.string().min(1) });

registry.registerPath({
  method: 'post', path: '/api/auth/register', summary: '注册（学生）',
  request: { body: { content: { 'application/json': { schema: RegisterIn } } } },
  responses: {
    201: { description: '注册成功，已登录', content: { 'application/json': { schema: UserOut } } },
    409: { description: '登录名已被占用', content: { 'application/json': { schema: Err } } },
  },
});

registry.registerPath({
  method: 'post', path: '/api/auth/login', summary: '登录（写 httpOnly Cookie）',
  request: { body: { content: { 'application/json': { schema: LoginIn } } } },
  responses: {
    200: { description: '登录成功', content: { 'application/json': { schema: UserOut } } },
    401: { description: '账号或密码不对', content: { 'application/json': { schema: Err } } },
  },
});

registry.registerPath({ method: 'post', path: '/api/auth/logout', summary: '登出', responses: { 204: { description: '已清 Cookie' } } });

registry.registerPath({
  method: 'get', path: '/api/me', summary: '当前登录的人',
  responses: {
    200: { description: '已登录', content: { 'application/json': { schema: UserOut } } },
    401: { description: '未登录', content: { 'application/json': { schema: Err } } },
  },
});

export const authRouter = Router();

function toOut(u: {
  id: number; username: string; nickname: string; grade: string | null;
  role: { code: string; permissions: { permission: { code: string } }[] };
}) {
  return {
    id: u.id, username: u.username, nickname: u.nickname, grade: u.grade,
    role: u.role.code, perms: u.role.permissions.map((rp) => rp.permission.code),
  };
}

const withRole = { role: { include: { permissions: { include: { permission: true } } } } } as const;

authRouter.post('/auth/register', async (req, res) => {
  const parsed = RegisterIn.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '入参不对' } });
    return;
  }
  if (await findByUsername(parsed.data.username)) {
    res.status(409).json({ error: { code: 'TAKEN', message: '这个登录名已被占用' } });
    return;
  }
  const created = await createUser(parsed.data);
  const full = await prisma.user.findUnique({ where: { id: created.id }, include: withRole });
  const sid = await createSession(created.id);
  res.cookie(config.auth.cookieName, signToken(created.id, sid), cookieOptions());
  res.status(201).json(toOut(full!));
});

authRouter.post('/auth/login', async (req, res) => {
  const parsed = LoginIn.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '账号和密码都要填' } });
    return;
  }
  const user = await prisma.user.findUnique({ where: { username: parsed.data.username }, include: withRole });
  /* 账号不存在和密码不对，回的是**同一句话** —— 别给人当枚举器用 */
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    res.status(401).json({ error: { code: 'BAD_CREDENTIALS', message: '账号或密码不对' } });
    return;
  }
  /* 停用判定放在**密码验过之后**：先验密码，别人就不能拿"这个账号是不是被停用"
     当账号探测器。措辞也必须跟"密码不对"分开 —— 否则本人会一直以为自己记错了密码。 */
  if (user.disabledAt) {
    res.status(403).json({ error: { code: 'ACCOUNT_DISABLED', message: '这个账号已被停用，请联系老师' } });
    return;
  }
  const sid = await createSession(user.id);
  res.cookie(config.auth.cookieName, signToken(user.id, sid), cookieOptions());
  res.json(toOut(user));
});

authRouter.post('/auth/logout', async (req, res) => {
  /* 只清 cookie 是不够的：令牌本身还有效，谁手里有它谁就还是登录态。
     所以这里把会话也吊销 —— 这才是"登出"该有的意思。 */
  const raw = req.cookies ? req.cookies[config.auth.cookieName] : undefined;
  if (raw) {
    try {
      const payload = jwt.verify(raw, config.auth.jwtSecret) as { sid?: number };
      if (typeof payload.sid === 'number') { await revokeSession(payload.sid); }
    } catch { /* 令牌本来就坏了，那也没什么可吊销的 */ }
  }
  res.clearCookie(config.auth.cookieName, { path: '/' });
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, include: withRole });
  if (!user) { res.status(401).json({ error: { code: 'NO_USER', message: '账号不存在' } }); return; }
  res.json(toOut(user));
});

/* ---- 重置密码两步走 ----
   第一步只回「已发送」，**不管账号存不存在**（同样是防枚举）。
   第二步拿令牌换新密码。本地开发没有邮件通道，所以非生产环境把令牌直接回给前端 ——
   生产环境这一段必须换成发邮件，否则等于任何人改任何人。 */
const ResetAsk = z.object({ username: z.string().min(1) });
const ResetDo = z.object({ token: z.string().min(10), password: PasswordIn });

registry.registerPath({
  method: 'post', path: '/api/auth/reset-password', summary: '申请重置密码',
  request: { body: { content: { 'application/json': { schema: ResetAsk } } } },
  responses: { 200: { description: '一律回 200（不透露账号是否存在）' } },
});
registry.registerPath({
  method: 'post', path: '/api/auth/reset-password/confirm', summary: '用令牌改密码',
  request: { body: { content: { 'application/json': { schema: ResetDo } } } },
  responses: { 204: { description: '已改' }, 400: { description: '令牌无效或过期', content: { 'application/json': { schema: Err } } } },
});

authRouter.post('/auth/reset-password', async (req, res) => {
  const parsed = ResetAsk.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '请填登录名' } });
    return;
  }
  const user = await findByUsername(parsed.data.username);
  let token: string | null = null;
  if (user) { token = await issueResetToken(user.id); }
  /* 生产：这里发邮件，然后一律回 200。本地：把令牌回给前端好继续走流程。 */
  if (!config.isProd && token) {
    res.json({ ok: true, devToken: token, note: '本地开发才回令牌；生产改成发邮件，并且这一句要删掉' });
    return;
  }
  res.json({ ok: true });
});

authRouter.post('/auth/reset-password/confirm', async (req, res) => {
  const parsed = ResetDo.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? '令牌和密码都要填' } });
    return;
  }
  const userId = await consumeResetToken(parsed.data.token);
  if (!userId) {
    res.status(400).json({ error: { code: 'BAD_TOKEN', message: '这个重置链接无效或已过期' } });
    return;
  }
  await setPassword(userId, parsed.data.password);
  res.status(204).end();
});
