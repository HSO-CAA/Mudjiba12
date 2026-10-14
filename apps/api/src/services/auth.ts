import type { PrismaClient, Session, User } from '@prisma/client';
import { hashPassword, newSessionToken, sha256Hex, verifyAgainstDummy, verifyPassword } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';

export const SESSION_COOKIE = 's5y_sid';
export const SESSION_TTL_MS = 30 * 24 * 3600_000;
/** Sliding expiry is refreshed at most this often (avoids a DB write per request). */
export const SESSION_REFRESH_MS = 10 * 60_000;
export const MAX_FAILED_LOGINS = 8;
export const LOCK_MS = 15 * 60_000;
export const MIN_PASSWORD_LENGTH = 10;

export interface AuthState {
  user: User;
  session: Session;
}

export interface SessionMeta {
  ip: string | null;
  userAgent: string | null;
}

const lockedError = (until: Date): AppError =>
  new AppError(423, 'ACCOUNT_LOCKED', 'الحساب مقفول مؤقتاً بسبب محاولات دخول خاطئة كثيرة، حاول بعد 15 دقيقة', {
    retryAfterSec: Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000)),
  });

const invalidCredentials = (): AppError => new AppError(401, 'UNAUTHORIZED', 'البريد الإلكتروني أو كلمة المرور غير صحيحة');

export class AuthService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Verifies credentials with lockout + timing-safe behaviour and opens a new session. */
  async login(email: string, password: string, meta: SessionMeta): Promise<{ user: User; token: string; expiresAt: Date }> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      await verifyAgainstDummy(password);
      throw invalidCredentials();
    }
    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      await verifyAgainstDummy(password);
      throw lockedError(user.lockedUntil);
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      const failures = user.failedLogins + 1;
      if (failures >= MAX_FAILED_LOGINS) {
        const lockedUntil = new Date(now.getTime() + LOCK_MS);
        await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil } });
        throw lockedError(lockedUntil);
      }
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: failures } });
      throw invalidCredentials();
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: now },
    });
    const { token, expiresAt } = await this.createSession(user.id, meta);
    return { user: updated, token, expiresAt };
  }

  async createSession(userId: string, meta: SessionMeta): Promise<{ token: string; expiresAt: Date }> {
    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.session.create({
      data: {
        tokenHash: sha256Hex(token),
        userId,
        expiresAt,
        ip: meta.ip?.slice(0, 64) ?? null,
        userAgent: meta.userAgent?.slice(0, 512) ?? null,
      },
    });
    return { token, expiresAt };
  }

  /**
   * Resolves a session token. Expired sessions are deleted. When the last refresh is older than
   * SESSION_REFRESH_MS the expiry slides forward (`refreshed: true` → re-issue the cookie).
   */
  async validate(token: string): Promise<(AuthState & { refreshed: boolean }) | null> {
    if (!token || token.length > 200) return null;
    const found = await this.prisma.session.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { user: true } });
    if (!found) return null;
    const now = Date.now();
    if (found.expiresAt.getTime() <= now) {
      await this.prisma.session.deleteMany({ where: { id: found.id } });
      return null;
    }
    const { user, ...session } = found;
    if (now - found.lastSeenAt.getTime() < SESSION_REFRESH_MS) return { user, session, refreshed: false };
    const refreshedSession = await this.prisma.session.update({
      where: { id: found.id },
      data: { lastSeenAt: new Date(now), expiresAt: new Date(now + SESSION_TTL_MS) },
    });
    return { user, session: refreshedSession, refreshed: true };
  }

  async revoke(token: string): Promise<void> {
    if (!token) return;
    await this.prisma.session.deleteMany({ where: { tokenHash: sha256Hex(token) } });
  }

  /** Changes the password and revokes every other session of the user. Returns false when `current` is wrong. */
  async changePassword(user: User, keepSessionId: string, current: string, next: string): Promise<boolean> {
    if (!(await verifyPassword(current, user.passwordHash))) return false;
    const passwordHash = await hashPassword(next);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash, failedLogins: 0, lockedUntil: null } }),
      this.prisma.session.deleteMany({ where: { userId: user.id, id: { not: keepSessionId } } }),
    ]);
    return true;
  }

  async purgeExpired(): Promise<number> {
    const { count } = await this.prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    return count;
  }

  /**
   * Creates the owner account, or resets its password when the email already exists
   * (unlocks it and signs out every session). Used by first boot and `create-admin`.
   */
  async upsertOwner(input: { email: string; password: string; name: string }): Promise<{ user: User; created: boolean }> {
    const email = input.email.trim().toLowerCase();
    const passwordHash = await hashPassword(input.password);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      const [user] = await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: existing.id },
          data: { passwordHash, name: input.name, role: 'OWNER', failedLogins: 0, lockedUntil: null },
        }),
        this.prisma.session.deleteMany({ where: { userId: existing.id } }),
      ]);
      return { user, created: false };
    }
    const user = await this.prisma.user.create({ data: { email, name: input.name, passwordHash, role: 'OWNER' } });
    return { user, created: true };
  }

  /** First boot: creates the OWNER from ADMIN_EMAIL/ADMIN_PASSWORD only when no user exists at all. */
  async ensureInitialOwner(admin: { email: string | undefined; password: string | undefined; name: string }): Promise<User | null> {
    if (!admin.email || !admin.password) return null;
    if ((await this.prisma.user.count()) > 0) return null;
    try {
      return (await this.upsertOwner({ email: admin.email, password: admin.password, name: admin.name })).user;
    } catch (err) {
      // Two instances booting at once: the other one won the race.
      if ((err as { code?: string }).code === 'P2002') return null;
      throw err;
    }
  }
}
