import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

/**
 * When Netlify hosts the site, its `_redirects` proxy `/api/*` (and robots/sitemap) here as
 * `/_nf/<NETLIFY_PROXY_SECRET>/…`. Only requests carrying the secret come from that proxy, so only they
 * may name the visitor's address in `x-nf-client-connection-ip`; everything else keeps the address the
 * socket / TRUST_PROXY gives. Without this, every visitor would share the proxy's few egress addresses
 * and with them every per-IP limit (logins, contact form, analytics).
 */
export const NETLIFY_PREFIX = '/_nf/';

export interface ProxiedRequest extends IncomingMessage {
  /** The visitor's address as reported by the verified Netlify proxy. */
  s5yClientIp?: string;
}

const clientIpOf = (raw: IncomingMessage): string | undefined => {
  const value = raw.headers['x-nf-client-connection-ip'];
  const ip = (Array.isArray(value) ? value[0] : value)?.trim();
  return ip && isIP(ip) ? ip : undefined;
};

/** Fastify `rewriteUrl`: strips a verified `/_nf/<secret>` prefix and records the visitor's address. */
export function netlifyRewriteUrl(secret: string | null): (raw: IncomingMessage) => string {
  const expected = secret ? Buffer.from(secret) : null;
  return (raw) => {
    const url = raw.url ?? '/';
    if (!expected || !url.startsWith(NETLIFY_PREFIX)) return url;
    const end = url.indexOf('/', NETLIFY_PREFIX.length);
    if (end === -1) return url;
    const given = Buffer.from(url.slice(NETLIFY_PREFIX.length, end));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return url;
    const ip = clientIpOf(raw);
    if (ip) (raw as ProxiedRequest).s5yClientIp = ip;
    return url.slice(end);
  };
}
