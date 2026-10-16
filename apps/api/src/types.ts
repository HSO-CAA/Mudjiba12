import type { AppContext } from './context.js';
import type { AuthState } from './services/auth.js';

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    /** Set by the admin auth hook; null on public routes. */
    auth: AuthState | null;
  }
}

export {};
