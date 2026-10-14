/**
 * Supabase configuration helpers (pure functions, no network). Error and warning texts never contain key
 * values or passwords — they end up in logs.
 */

export type SupabaseKeyKind =
  /** Legacy JWT with role "service_role" — bypasses RLS, what the server needs. */
  | 'service_role'
  /** New-style secret key `sb_secret_…`. */
  | 'secret'
  /** Legacy JWT with role "anon" — public, cannot write to Storage. */
  | 'anon'
  /** New-style publishable key `sb_publishable_…` — public. */
  | 'publishable'
  /** A JWT with some other role (e.g. "authenticated"). */
  | 'other_jwt'
  /** Not recognisable (truncated, a password, …). */
  | 'unknown';

export interface SupabaseKeyInfo {
  kind: SupabaseKeyKind;
  role: string | null;
  /** Project ref embedded in a legacy JWT (`ref` claim). */
  ref: string | null;
}

/** Classifies a Supabase API key without verifying its signature (the server does that). */
export function inspectSupabaseKey(key: string): SupabaseKeyInfo {
  const k = key.trim();
  if (k.startsWith('sb_publishable_')) return { kind: 'publishable', role: null, ref: null };
  if (k.startsWith('sb_secret_')) return { kind: 'secret', role: null, ref: null };
  const parts = k.split('.');
  if (parts.length === 3 && parts[1]) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { role?: unknown; ref?: unknown };
      const role = typeof payload.role === 'string' ? payload.role : null;
      const ref = typeof payload.ref === 'string' ? payload.ref : null;
      if (role === 'service_role') return { kind: 'service_role', role, ref };
      if (role === 'anon') return { kind: 'anon', role, ref };
      return { kind: 'other_jwt', role, ref };
    } catch {
      return { kind: 'unknown', role: null, ref: null };
    }
  }
  return { kind: 'unknown', role: null, ref: null };
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const API_PATH_RE = /^\/(?:rest|storage|auth|realtime|functions)\/v1(?:\/.*)?$/;
const SUPABASE_HOST_RE = /^([a-z0-9]+)\.supabase\.(?:co|in)$/;

export type ParsedSupabaseUrl = { ok: true; url: string; projectRef: string | null } | { ok: false; problem: string };

const URL_HELP = 'use the Project URL from Supabase → Project Settings → Data API, e.g. https://abcdefghijklmnopqrst.supabase.co';

/**
 * Validates/normalises `SUPABASE_URL` to an origin without a trailing slash. Accepts a pasted REST/Storage URL
 * (`…/rest/v1/`) and strips the API path. Plain http is only allowed for localhost (self-hosted / tests).
 */
export function parseSupabaseUrl(raw: string): ParsedSupabaseUrl {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, problem: `SUPABASE_URL is not a valid URL — ${URL_HELP}` };
  }
  const loopback = LOOPBACK_HOSTS.has(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) {
    return { ok: false, problem: `SUPABASE_URL must start with https:// — ${URL_HELP}` };
  }
  if (u.username || u.password || u.search || u.hash) {
    return { ok: false, problem: `SUPABASE_URL must not contain a user, password, query or #fragment — ${URL_HELP}` };
  }
  const pathname = u.pathname.replace(/\/+$/, '');
  if (pathname !== '' && !API_PATH_RE.test(pathname)) {
    if (u.hostname === 'supabase.com' || u.hostname.endsWith('.supabase.com')) {
      return { ok: false, problem: `SUPABASE_URL is the dashboard address, not the project URL — ${URL_HELP}` };
    }
    return { ok: false, problem: `SUPABASE_URL must be just the project address (no path) — ${URL_HELP}` };
  }
  const match = SUPABASE_HOST_RE.exec(u.hostname);
  return { ok: true, url: u.origin, projectRef: match?.[1] ?? null };
}

/** Supabase bucket names we accept: S3-safe lowercase names (the same rules work for the S3 protocol). */
export const BUCKET_NAME_RE = /^[a-z0-9](?:[a-z0-9._-]{0,61}[a-z0-9])?$/;

export function isValidBucketName(name: string): boolean {
  return BUCKET_NAME_RE.test(name) && !name.includes('..');
}

const KEY_HELP =
  'In Supabase open Project Settings → API Keys and copy the "service_role" key (tab "Legacy API Keys", it starts with eyJ…) ' +
  'or create a Secret key (sb_secret_…)';

export interface KeyCheck {
  problems: string[];
  warnings: string[];
}

/** Checks that the configured key is a server (service_role / secret) key of the same project as the URL. */
export function checkServiceKey(key: string, projectRef: string | null, anonKey?: string): KeyCheck {
  const problems: string[] = [];
  const warnings: string[] = [];
  const info = inspectSupabaseKey(key);
  if (anonKey && key.trim() === anonKey.trim()) {
    problems.push(`this is the same value as SUPABASE_ANON_KEY — the anon (public) key cannot upload files. ${KEY_HELP}.`);
    return { problems, warnings };
  }
  switch (info.kind) {
    case 'anon':
    case 'publishable':
      problems.push(
        `this is the public ${info.kind === 'anon' ? 'anon' : 'publishable'} key — the server needs the secret service_role key. ${KEY_HELP}.`,
      );
      break;
    case 'other_jwt':
      problems.push(`this is not a service_role key (its role is "${info.role ?? 'unknown'}"). ${KEY_HELP}.`);
      break;
    case 'unknown':
      warnings.push(
        `it does not look like a Supabase key (expected a long token starting with "eyJ" or "sb_secret_") — check that it was copied completely.`,
      );
      break;
    default:
      break;
  }
  if (info.kind === 'service_role' && info.ref && projectRef && info.ref !== projectRef) {
    problems.push(
      `this key belongs to another Supabase project (key is for "${info.ref}", SUPABASE_URL is "${projectRef}") — copy the key from the same project.`,
    );
  }
  return { problems, warnings };
}

export interface DatabaseUrlCheck {
  /** URL to give the runtime Prisma client (may gain `pgbouncer=true`). */
  url: string;
  problems: string[];
  warnings: string[];
}

const PLACEHOLDER_RE = /\[(?:YOUR[-_ ]?PASSWORD|PASSWORD|REGION|PROJECT[-_ ]?REF)\]/i;

/**
 * Supabase-specific DATABASE_URL hints: an unreplaced `[YOUR-PASSWORD]` placeholder is an error; the
 * transaction pooler (port 6543) gets `pgbouncer=true` (Prisma prepared statements) and a warning because
 * migrations need the Session pooler (port 5432); the IPv6-only direct host gets a warning.
 */
export function checkDatabaseUrl(raw: string, supabaseRef: string | null = null): DatabaseUrlCheck {
  const problems: string[] = [];
  const warnings: string[] = [];
  let url = raw;
  if (PLACEHOLDER_RE.test(raw)) {
    problems.push(
      'DATABASE_URL still contains a placeholder like [YOUR-PASSWORD] or [REGION] — replace it with your real database password / region ' +
        '(Supabase → Connect → Session pooler; the password is the one you chose when creating the project, reset it under Project Settings → Database).',
    );
    return { url, problems, warnings };
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { url, problems, warnings };
  }
  const host = u.hostname.toLowerCase();
  const port = u.port || '5432';
  let dbRef: string | null = null;
  if (host.endsWith('.pooler.supabase.com')) {
    dbRef = /^postgres\.([a-z0-9]+)$/.exec(decodeURIComponent(u.username))?.[1] ?? null;
    if (port === '6543') {
      warnings.push(
        'DATABASE_URL uses the Supabase Transaction pooler (port 6543). Prisma migrations (npm run db:deploy) do not work through it — ' +
          'use the Session pooler string instead (Supabase → Connect → Session pooler, port 5432). pgbouncer=true was added for the app.',
      );
      if (!u.searchParams.has('pgbouncer')) {
        u.searchParams.set('pgbouncer', 'true');
        url = u.toString();
      }
    }
  } else {
    const direct = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(host);
    if (direct) {
      dbRef = direct[1] ?? null;
      warnings.push(
        'DATABASE_URL uses the Supabase direct connection (db.<ref>.supabase.co), which is IPv6-only unless you bought the IPv4 add-on. ' +
          'If the database cannot be reached, use the Session pooler string (Supabase → Connect → Session pooler, port 5432).',
      );
    }
  }
  if (dbRef && supabaseRef && dbRef !== supabaseRef) {
    warnings.push(`DATABASE_URL points at Supabase project "${dbRef}" but SUPABASE_URL is project "${supabaseRef}" — check you copied both from the same project.`);
  }
  return { url, problems, warnings };
}
