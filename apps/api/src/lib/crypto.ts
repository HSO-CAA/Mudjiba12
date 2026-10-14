import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Random lowercase alphanumeric id (unbiased). Used for storage keys and fake ids. */
export function randomId(length = 20): string {
  let out = '';
  while (out.length < length) {
    const bytes = randomBytes(length * 2);
    for (const b of bytes) {
      // 252 = 7 * 36 → rejection sampling keeps the distribution uniform.
      if (b < 252) out += ALPHABET[b % 36];
      if (out.length === length) break;
    }
  }
  return out;
}

/** cuid-like id (starts with "c", 25 chars) for responses that must look like real row ids. */
export const fakeRowId = (): string => `c${randomId(24)}`;

export const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');

/** 32 random bytes, base64url — the session token stored only in the cookie. */
export const newSessionToken = (): string => randomBytes(32).toString('base64url');

/* ───────────────────────────── Passwords (scrypt) ───────────────────────────── */

const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFKC'), salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

const scryptOptions = (N: number, r: number, p: number): ScryptOptions => ({
  N,
  r,
  p,
  // 128 * N * r bytes are needed; leave headroom over Node's 32 MiB default.
  maxmem: 128 * N * r * 2,
});

/** Hashes a password as `scrypt$N$r$p$<salt b64>$<hash b64>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scrypt(password, salt, KEY_LENGTH, scryptOptions(SCRYPT_N, SCRYPT_R, SCRYPT_P));
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64'), hash.toString('base64')].join('$');
}

/** Constant-time verification. Returns false for malformed hashes. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts as [string, string, string, string, string, string];
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0) || N > 2 ** 20 || r > 32 || p > 16) return false;
  const salt = Buffer.from(saltRaw, 'base64');
  const expected = Buffer.from(hashRaw, 'base64');
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = await scrypt(password, salt, expected.length, scryptOptions(N, r, p));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | null = null;

/** Burns the same CPU time as a real verification (used when the account does not exist). */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(password, await dummyHash);
}
