import type { Prisma, PrismaClient } from '@prisma/client';
import { badRequest } from '../../lib/errors.js';

/**
 * Applies a drag-and-drop order in one transaction. `ids` may be a subset: listed items come first
 * (in the given order), the rest keep their relative order after them.
 */
export async function applyReorder(
  ids: string[],
  currentOrder: string[],
  update: (id: string, sortOrder: number) => Prisma.PrismaPromise<unknown>,
  prisma: PrismaClient,
): Promise<void> {
  const known = new Set(currentOrder);
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length > 0) throw badRequest('بعض العناصر غير موجودة، حدّث الصفحة وحاول مرة ثانية', { ids: missing });
  const listed = new Set(ids);
  const finalOrder = [...ids, ...currentOrder.filter((id) => !listed.has(id))];
  await prisma.$transaction(finalOrder.map((id, index) => update(id, index)));
}
