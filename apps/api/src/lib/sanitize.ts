/**
 * PostgreSQL rejects NUL characters (`text` and `jsonb`) and invalid UTF-16 (lone surrogates) with a
 * driver error, which surfaced as a 500 on any endpoint that stores client text (inquiries, login,
 * settings…). Every string coming from a client is normalised once, before validation.
 */

// Lone high surrogate (not followed by a low one) or lone low surrogate (not preceded by a high one).
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const NUL = /\u0000/g;
const SUSPICIOUS = /[\u0000\uD800-\uDFFF]/;
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);

/** Removes NUL characters and replaces lone surrogates with U+FFFD. */
export function cleanString(value: string): string {
  // Fast path: almost every string is already clean (valid emoji pairs fall through to a no-op replace).
  if (!SUSPICIOUS.test(value)) return value;
  return value.replace(NUL, '').replace(LONE_SURROGATE, REPLACEMENT_CHAR);
}

/**
 * Cleans every string inside a parsed JSON body / query object, in place (no recursion, so deeply
 * nested bodies can't overflow the stack; objects are mutated rather than rebuilt so keys such as
 * `__proto__` stay plain own properties). Returns the (possibly replaced) root value.
 */
export function cleanStringsDeep<T>(root: T): T {
  if (typeof root === 'string') return cleanString(root) as T;
  if (root === null || typeof root !== 'object' || Buffer.isBuffer(root)) return root;
  const stack: object[] = [root as object];
  while (stack.length > 0) {
    const node = stack.pop() as Record<string, unknown> | unknown[];
    const keys = Array.isArray(node) ? node.keys() : Object.keys(node);
    for (const key of keys) {
      const value = (node as Record<string | number, unknown>)[key];
      if (typeof value === 'string') {
        const cleaned = cleanString(value);
        if (cleaned !== value) (node as Record<string | number, unknown>)[key] = cleaned;
      } else if (value !== null && typeof value === 'object' && !Buffer.isBuffer(value)) {
        stack.push(value);
      }
    }
  }
  return root;
}

/** `value.slice(0, max)` that never cuts a surrogate pair in half. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
