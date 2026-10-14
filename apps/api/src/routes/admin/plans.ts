import type { Prisma } from '@prisma/client';
import type { AdminPlan, PlanPeriod } from '@s5y/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';
import { notFound } from '../../lib/errors.js';
import { idParams, nullableText, parse, reorderSchema, z } from '../../lib/validation.js';
import { planInclude } from '../../services/serializers.js';
import { applyReorder } from './reorder.js';

const PERIODS = ['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME'] as const satisfies readonly PlanPeriod[];

const planFields = {
  name: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string({ error: 'اكتب اسم الباقة' }).min(1, 'اكتب اسم الباقة').max(80, 'الاسم طويل، الحد الأقصى 80 حرف'),
  ),
  tagline: nullableText(160),
  price: z
    .number({ error: 'السعر لازم يكون رقم' })
    .int('السعر لازم يكون رقم صحيح بدون كسور')
    .min(0, 'السعر ما يكون سالب')
    .max(2_000_000_000, 'السعر كبير جداً')
    .nullable(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'رمز العملة لازم يكون 3 أحرف مثل IQD أو USD'),
  period: z.enum(PERIODS, { error: 'مدة الباقة غير صالحة' }),
  features: z
    .array(z.string().trim().min(1).max(120, 'الميزة طويلة، الحد الأقصى 120 حرف'))
    .max(30, 'الحد الأقصى 30 ميزة'),
  highlighted: z.boolean(),
  ctaLabel: nullableText(40),
  active: z.boolean(),
};

const createSchema = z.object(planFields).partial().required({ name: true });
const updateSchema = z.object(planFields).partial();

export async function planRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { prisma, serialize } = ctx;

  const load = async (id: string): Promise<AdminPlan> => {
    const plan = await prisma.plan.findUnique({ where: { id }, include: planInclude });
    if (!plan) throw notFound('الباقة غير موجودة');
    return serialize.adminPlan(plan);
  };

  app.get('/plans', async (): Promise<AdminPlan[]> => {
    const rows = await prisma.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], include: planInclude });
    return rows.map((p) => serialize.adminPlan(p));
  });

  app.post('/plans', async (request, reply) => {
    const input = parse(createSchema, request.body ?? {});
    const last = await prisma.plan.aggregate({ _max: { sortOrder: true } });
    const created = await prisma.plan.create({
      data: {
        name: input.name,
        tagline: input.tagline ?? null,
        price: input.price ?? null,
        currency: input.currency ?? 'IQD',
        period: input.period ?? 'MONTHLY',
        features: input.features ?? [],
        highlighted: input.highlighted ?? false,
        ctaLabel: input.ctaLabel ?? null,
        active: input.active ?? true,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
      include: planInclude,
    });
    return reply.code(201).send(serialize.adminPlan(created));
  });

  app.put('/plans/order', async (request, reply) => {
    const { ids } = parse(reorderSchema, request.body ?? {});
    const all = await prisma.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true } });
    await applyReorder(
      ids,
      all.map((p) => p.id),
      (id, sortOrder) => prisma.plan.update({ where: { id }, data: { sortOrder }, select: { id: true } }),
      prisma,
    );
    return reply.code(204).send();
  });

  app.patch('/plans/:id', async (request) => {
    const { id } = parse(idParams, request.params);
    const input = parse(updateSchema, request.body ?? {});
    const data: Prisma.PlanUpdateInput = {};
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) (data as Record<string, unknown>)[key] = value;
    }
    await prisma.plan.update({ where: { id }, data });
    return load(id);
  });

  app.delete('/plans/:id', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    await prisma.plan.delete({ where: { id } }); // inquiries keep, planId → null (onDelete: SetNull)
    return reply.code(204).send();
  });
}
