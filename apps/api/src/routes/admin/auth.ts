import type { AdminUser } from '@s5y/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../../context.js';
import { fieldError, unauthorized } from '../../lib/errors.js';
import { parse, z } from '../../lib/validation.js';
import { clearSessionCookie, sessionToken, setSessionCookie } from '../../plugins/auth.js';
import { RATE_LIMITS } from '../../plugins/security.js';
import { MIN_PASSWORD_LENGTH } from '../../services/auth.js';

const loginSchema = z.object({
  email: z.string({ error: 'اكتب البريد الإلكتروني' }).trim().min(3, 'اكتب البريد الإلكتروني').max(200),
  password: z.string({ error: 'اكتب كلمة المرور' }).min(1, 'اكتب كلمة المرور').max(200),
});

const changePasswordSchema = z
  .object({
    currentPassword: z.string({ error: 'اكتب كلمة المرور الحالية' }).min(1, 'اكتب كلمة المرور الحالية').max(200),
    newPassword: z
      .string({ error: 'اكتب كلمة المرور الجديدة' })
      .min(MIN_PASSWORD_LENGTH, `كلمة المرور الجديدة لازم تكون ${MIN_PASSWORD_LENGTH} أحرف على الأقل`)
      .max(200, 'كلمة المرور طويلة جداً'),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'كلمة المرور الجديدة لازم تختلف عن الحالية',
  });

const sessionMeta = (request: FastifyRequest) => ({
  ip: request.ip ?? null,
  userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
});

/** Routes that work without a session. */
export async function authRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post('/auth/login', { config: { rateLimit: RATE_LIMITS.login } }, async (request, reply) => {
    const { email, password } = parse(loginSchema, request.body ?? {});
    const { user, token } = await ctx.auth.login(email, password, sessionMeta(request));
    // Signing in again from the same browser replaces its old session instead of leaving it valid.
    const previous = sessionToken(request);
    if (previous) await ctx.auth.revoke(previous);
    setSessionCookie(ctx, reply, token);
    request.log.info({ userId: user.id }, 'admin signed in');
    const body: { user: AdminUser } = { user: ctx.serialize.user(user) };
    return body;
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = sessionToken(request);
    if (token) await ctx.auth.revoke(token);
    clearSessionCookie(ctx, reply);
    return reply.code(204).send();
  });
}

/** Routes that need a valid session (registered inside the protected scope). */
export async function sessionRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/auth/me', async (request) => {
    if (!request.auth) throw unauthorized();
    const body: { user: AdminUser } = { user: ctx.serialize.user(request.auth.user) };
    return body;
  });

  app.post('/auth/password', async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const input = parse(changePasswordSchema, request.body ?? {});
    const fresh = await ctx.auth.changePassword(request.auth.user, input.currentPassword, input.newPassword, sessionMeta(request));
    if (!fresh) throw fieldError('currentPassword', 'كلمة المرور الحالية غير صحيحة');
    // Every session (this one included) was revoked; this browser continues on a brand-new token.
    setSessionCookie(ctx, reply, fresh.token);
    request.log.info({ userId: request.auth.user.id }, 'admin password changed');
    return reply.code(204).send();
  });
}
