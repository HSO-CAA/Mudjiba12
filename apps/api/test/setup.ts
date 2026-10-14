import { PrismaClient } from '@prisma/client';
import { beforeAll } from 'vitest';
import { TEST_DATABASE_URL, assertSafeTestDatabase } from './env.js';

/** Every test file starts from empty tables. */
beforeAll(async () => {
  assertSafeTestDatabase();
  const prisma = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
  try {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Session", "User", "Video", "Place", "Inquiry", "Plan", "Setting", "DailyStat" RESTART IDENTITY CASCADE',
    );
  } finally {
    await prisma.$disconnect();
  }
});
