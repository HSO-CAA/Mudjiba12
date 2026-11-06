import type { FastifyReply, FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import type { AppContext } from '../context.js';
import { unauthorized } from '../lib/errors.js';
import { SESSION_COOKIE, SESSION_TTL_MS } from '../services/auth.js';

export function setSessionCookie(ctx: AppContext, reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: ctx.config.cookieSecure,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(ctx: AppContext, reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'strict', secure: ctx.config.cookieSecure, path: '/' });
}

export const sessionToken = (request: FastifyRequest): string | undefined => request.cookies[SESSION_COOKIE] || undefined;

/** onRequest hook: resolves the session cookie (before any body is read) or answers 401. */
export function requireAdmin(ctx: AppContext): onRequestAsyncHookHandler {
  return async (request, reply) => {
    const token = sessionToken(request);
    if (!token) throw unauthorized();
    const state = await ctx.auth.validate(token);
    if (!state) {
      clearSessionCookie(ctx, reply);
      throw unauthorized('انتهت الجلسة، سجّل دخول مرة ثانية');
    }
    if (state.refreshed) setSessionCookie(ctx, reply, token);
    request.auth = { user: state.user, session: state.session };
  };
}
