import type { Prisma } from '@prisma/client';
import type { AdminInquiry, InquiryList, InquiryStatus } from '@s5y/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';
import { idParams, nullableText, parse, z } from '../../lib/validation.js';
import { inquiryInclude } from '../../services/serializers.js';

const STATUSES = ['NEW', 'CONTACTED', 'WON', 'ARCHIVED'] as const satisfies readonly InquiryStatus[];

const emptyToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

const listQuery = z.object({
  status: z.preprocess(emptyToUndefined, z.enum(STATUSES).optional()),
  q: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(100_000).default(1)),
  pageSize: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(100).default(20)),
});

const updateSchema = z
  .object({
    status: z.enum(STATUSES, { error: 'حالة الرسالة غير صالحة' }),
    notes: nullableText(5000),
  })
  .partial();

export async function inquiryRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { prisma, serialize } = ctx;

  app.get('/inquiries', async (request): Promise<InquiryList> => {
    const query = parse(listQuery, request.query ?? {});
    const search: Prisma.InquiryWhereInput = query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' } },
            { phone: { contains: query.q } },
            { email: { contains: query.q, mode: 'insensitive' } },
            { message: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {};
    const where: Prisma.InquiryWhereInput = { ...search, ...(query.status ? { status: query.status } : {}) };

    const [items, total, grouped] = await Promise.all([
      prisma.inquiry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: inquiryInclude,
      }),
      prisma.inquiry.count({ where }),
      // Tab counters follow the search but not the status filter.
      prisma.inquiry.groupBy({ by: ['status'], where: search, _count: { _all: true } }),
    ]);
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<InquiryStatus, number>;
    for (const g of grouped) counts[g.status] = g._count._all;

    return { items: items.map((i) => serialize.inquiry(i)), total, page: query.page, pageSize: query.pageSize, counts };
  });

  app.patch('/inquiries/:id', async (request): Promise<AdminInquiry> => {
    const { id } = parse(idParams, request.params);
    const input = parse(updateSchema, request.body ?? {});
    const updated = await prisma.inquiry.update({
      where: { id },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
      include: inquiryInclude,
    });
    return serialize.inquiry(updated);
  });

  app.delete('/inquiries/:id', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    await prisma.inquiry.delete({ where: { id } });
    return reply.code(204).send();
  });
}
