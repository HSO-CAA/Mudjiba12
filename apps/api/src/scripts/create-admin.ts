/**
 * Creates the owner account, or resets its password if the email already exists.
 *
 *   npm run create-admin -- --email owner@example.com --password '…' --name 'S5Y'
 *
 * Falls back to ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME from the environment (.env).
 * Resetting also unlocks the account and signs out every existing session.
 */
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { ConfigError, loadConfig, loadEnvFile } from '../config.js';
import { AuthService, MIN_PASSWORD_LENGTH } from '../services/auth.js';
import { z } from '../lib/validation.js';

loadEnvFile();

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      password: { type: 'string' },
      name: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });
  if (values.help) {
    console.log('Usage: npm run create-admin -- --email <email> --password <password> [--name <name>]');
    return 0;
  }

  const input = z
    .object({
      email: z.email('Provide a valid --email (or ADMIN_EMAIL)'),
      password: z.string().min(MIN_PASSWORD_LENGTH, `--password must be at least ${MIN_PASSWORD_LENGTH} characters`),
      name: z.string().trim().min(1).max(80),
    })
    .safeParse({
      email: values.email ?? process.env.ADMIN_EMAIL,
      password: values.password ?? process.env.ADMIN_PASSWORD,
      name: values.name ?? process.env.ADMIN_NAME ?? 'S5Y',
    });
  if (!input.success) {
    for (const issue of input.error.issues) console.error(`✖ ${issue.path.join('.')}: ${issue.message}`);
    return 1;
  }

  const config = loadConfig();
  const prisma = new PrismaClient({ datasourceUrl: config.databaseUrl });
  try {
    const { user, created } = await new AuthService(prisma).upsertOwner(input.data);
    console.log(
      created
        ? `✔ Created owner account ${user.email} (${user.name}).`
        : `✔ Reset password for ${user.email}; the account is unlocked and all sessions were signed out.`,
    );
    console.log(`  Sign in at ${config.publicUrl}${config.adminPath}`);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err instanceof ConfigError ? err.message : err);
    process.exit(1);
  });
