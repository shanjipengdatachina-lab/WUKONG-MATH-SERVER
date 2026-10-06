/* ==========================================================================
   导库 · M6 会员与套餐
   --------------------------------------------------------------------------
   默认四个套餐（免费 + 半年 / 一年 / 三年）与一份服务项目清单。
   用户的口径："默认出免费版本，收费版本一个半年期，一年期，三年期。"

   ⚠️ **价格是演示值**，上线前在后台「套餐」页改。金额一律以**分**为单位入库，
      显示时再除以 100 —— 用浮点存钱早晚会差一分钱。
   ========================================================================== */
import type { PrismaClient } from '@prisma/client';

type SeedPlan = {
  code: string;
  name: string;
  priceCents: number;
  originalCents: number;
  days: number;
  tagline: string;
  featured: boolean;
};

/** 四档。days = 0 表示不过期（免费版没有"到期"这回事）。 */
export const DEFAULT_PLANS: SeedPlan[] = [
  { code: 'free', name: '免费版', priceCents: 0, originalCents: 0, days: 0, tagline: '先把课看明白再说 —— 结构与正文不受限', featured: false },
  { code: 'half-year', name: '半年会员', priceCents: 16800, originalCents: 17400, days: 182, tagline: '一学期用下来，正好覆盖一个总复习', featured: false },
  { code: 'one-year', name: '一年会员', priceCents: 28800, originalCents: 34800, days: 365, tagline: '按学年买最划算，错题与进度跨设备跟着走', featured: true },
  { code: 'three-year', name: '三年会员', priceCents: 69800, originalCents: 104400, days: 1095, tagline: '初中三年一次买齐，中途不用再续', featured: false },
];

/** 权益对比表的**行**。valueBy 里没写的就是"不含"，前台显示 —。 */
export const DEFAULT_SERVICES: {
  code: string;
  name: string;
  desc: string;
  valueBy: Record<string, { included: boolean; value?: string }>;
}[] = [
  {
    code: 'knowledge_tree', name: '知识结构与正文', desc: '章节 / 图谱 / 时间轴的全部内容',
    valueBy: {
      free: { included: true }, 'half-year': { included: true },
      'one-year': { included: true }, 'three-year': { included: true },
    },
  },
  {
    code: 'tutorial_3d', name: '三维交互图谱', desc: '可旋转的 3D 数轴与立体观察层',
    valueBy: {
      free: { included: false }, 'half-year': { included: true },
      'one-year': { included: true }, 'three-year': { included: true },
    },
  },
  {
    code: 'question_bank', name: '题库与做题', desc: '考点速练、自动判分',
    valueBy: {
      free: { included: true }, 'half-year': { included: true },
      'one-year': { included: true }, 'three-year': { included: true },
    },
  },
  {
    code: 'member_solution', name: '会员专属题解', desc: '每题的分步思路与易错点',
    valueBy: {
      free: { included: false }, 'half-year': { included: true },
      'one-year': { included: true }, 'three-year': { included: true },
    },
  },
  {
    code: 'mistake_capacity', name: '错题本容量', desc: '自动归档的错题条数上限',
    valueBy: {
      free: { included: true, value: '50 道' }, 'half-year': { included: true, value: '不限' },
      'one-year': { included: true, value: '不限' }, 'three-year': { included: true, value: '不限' },
    },
  },
  {
    code: 'study_report', name: '学习报告', desc: '掌握度趋势与薄弱章节',
    valueBy: {
      free: { included: true, value: '基础' }, 'half-year': { included: true, value: '进阶' },
      'one-year': { included: true, value: '进阶' }, 'three-year': { included: true, value: '完整' },
    },
  },
  {
    code: 'cloud_sync', name: '笔记与收藏云同步', desc: '换设备也在',
    valueBy: {
      free: { included: true }, 'half-year': { included: true },
      'one-year': { included: true }, 'three-year': { included: true },
    },
  },
  {
    code: 'priority_support', name: '答疑优先', desc: '论坛提问排在前面',
    valueBy: {
      free: { included: false }, 'half-year': { included: false },
      'one-year': { included: true }, 'three-year': { included: true },
    },
  },
  {
    code: 'offline_pack', name: '离线资料包', desc: '可打印的讲义与卷子',
    valueBy: {
      free: { included: false }, 'half-year': { included: false },
      'one-year': { included: false }, 'three-year': { included: true },
    },
  },
];

export type PlanCounts = { plans: number; services: number; links: number };

export async function clearPlans(prisma: PrismaClient): Promise<void> {
  /* 依赖顺序倒着删：订单挂在用户上（级联），会带走 payment，先清掉更清楚；
     订阅挂在套餐上（普通外键、没有级联），也要在套餐之前清 */
  await prisma.order.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.planService.deleteMany();
  await prisma.plan.deleteMany();
  await prisma.serviceItem.deleteMany();
}

export async function seedPlans(prisma: PrismaClient): Promise<PlanCounts> {
  const planIdOf = new Map<string, number>();
  for (let i = 0; i < DEFAULT_PLANS.length; i += 1) {
    const p = DEFAULT_PLANS[i]!;
    const created = await prisma.plan.create({
      data: {
        code: p.code, name: p.name, priceCents: p.priceCents, originalCents: p.originalCents,
        days: p.days, tagline: p.tagline, featured: p.featured, active: true, order: i,
      },
    });
    planIdOf.set(p.code, created.id);
  }

  let links = 0;
  for (let i = 0; i < DEFAULT_SERVICES.length; i += 1) {
    const svc = DEFAULT_SERVICES[i]!;
    const created = await prisma.serviceItem.create({
      data: { code: svc.code, name: svc.name, desc: svc.desc, order: i, active: true },
    });
    for (const [planCode, cell] of Object.entries(svc.valueBy)) {
      const planId = planIdOf.get(planCode);
      if (planId === undefined) {
        throw new Error(`服务项目 ${svc.code} 里提到了套餐 ${planCode}，但 DEFAULT_PLANS 里没有它`);
      }
      await prisma.planService.create({
        data: { planId, serviceId: created.id, included: cell.included, value: cell.value ?? null },
      });
      links += 1;
    }
  }

  return { plans: DEFAULT_PLANS.length, services: DEFAULT_SERVICES.length, links };
}
