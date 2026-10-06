/* ==========================================================================
   导账号与权限（M2）
   --------------------------------------------------------------------------
   演示账号是**给人登录用的**，所以密码写成固定值、导完打印出来。
   上线第一件事就是改掉它们。

   ⚠️ 这一支是**清空重建**（用户表也会清）—— 只在开发/演示环境跑。

   `learning` 那一个字段是 M3 用来对数据集的：值 = seed/learning-students.json 里的
   学生名，或者 `default`（= seed/learning-default.json，线上演示学生那一份）。
   ========================================================================== */
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';

const ROUNDS = 10;

export type DemoAccount = {
  username: string;
  password: string;
  nickname: string;
  role: string;
  grade?: string;
  /** 这个账号拿哪一份学习数据：`default` 或 learning-students.json 里的学生名 */
  learning?: string;
};

/** 演示账号。密码是明文写死的**只为了让本地能登进去看**。 */
export const DEMO_ACCOUNTS: DemoAccount[] = [
  { username: 'admin', password: 'wk-admin-2026', nickname: '管理员', role: 'admin' },

  /* 这个就是线上那个演示学生：PROGRESS 43.7% / DEFAULT_SEED 20260929。
     他手上那份（含 15 场考试与 336 格轨迹）冻在 learning-default.json 里。 */
  { username: 'student', password: 'wk-demo-2026', nickname: '林一鸣', role: 'student', grade: '七年级（下）', learning: 'default' },

  /* 另外两位：各自那一份在 learning-students.json 里（有轨迹、没有考试）。 */
  { username: 'zhouyutong', password: 'wk-demo-2026', nickname: '周雨桐', role: 'student', grade: '五年级（上）', learning: '周雨桐' },
  { username: 'chenzihang', password: 'wk-demo-2026', nickname: '陈子航', role: 'student', grade: '高一 · 必修一', learning: '陈子航' },
];

/** 权限点是"事"：以后加角色不用改接口，只改这里。 */
export const PERMS: [string, string][] = [
  ['content.read', '看内容'],
  ['content.write', '改章节与正文'],
  ['tree.write', '改知识树'],
  ['exam.write', '录真题与扫描件'],
  ['user.read', '看用户'],
  ['user.write', '改用户与角色'],
  ['plan.write', '配套餐与服务项'],
  ['order.read', '看订单'],
];

/** 角色是"人"。admin 拿全部权限；student 只能看内容。 */
export const ROLES: [string, string, string[]][] = [
  ['admin', '管理员', PERMS.map((p) => p[0])],
  ['student', '学生', ['content.read']],
];

export async function seedAuth(prisma: PrismaClient): Promise<{ roles: number; perms: number; users: number }> {
  /* 依赖顺序倒着删 */
  await prisma.passwordReset.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.role.deleteMany();

  for (const [code, name] of PERMS) {
    await prisma.permission.create({ data: { code, name } });
  }

  for (const [code, name, permCodes] of ROLES) {
    const role = await prisma.role.create({ data: { code, name } });
    for (const permCode of permCodes) {
      const perm = await prisma.permission.findUnique({ where: { code: permCode } });
      if (!perm) { throw new Error(`角色 ${code} 要的权限点 ${permCode} 不在 PERMS 里`); }
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
    }
  }

  for (const acc of DEMO_ACCOUNTS) {
    const role = await prisma.role.findUnique({ where: { code: acc.role } });
    if (!role) { throw new Error(`演示账号 ${acc.username} 要的角色 ${acc.role} 不存在`); }
    await prisma.user.create({
      data: {
        username: acc.username,
        passwordHash: bcrypt.hashSync(acc.password, ROUNDS),
        nickname: acc.nickname,
        grade: acc.grade ?? null,
        roleId: role.id,
      },
    });
  }

  return { roles: ROLES.length, perms: PERMS.length, users: DEMO_ACCOUNTS.length };
}
