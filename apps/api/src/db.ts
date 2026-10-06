/* ==========================================================================
   数据库连接
   --------------------------------------------------------------------------
   全项目共用这一个 PrismaClient。
   ========================================================================== */
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

/**
 * 探活：能跑通一句最简单的话就算 up。
 * **不抛错，只回真假** —— 探活接口不该因为库挂了就整个 500，那样反而看不出是哪儿的问题。
 */
export async function dbUp(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
