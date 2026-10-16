import { randomId } from './crypto.js';

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MIN = 2;
export const SLUG_MAX = 80;

const CONSONANTS: Record<string, string> = {
  'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'th', 'ر': 'r', 'ز': 'z',
  'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'q',
  'ك': 'k', 'ک': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'ھ': 'h', 'پ': 'p', 'چ': 'ch', 'ژ': 'zh',
  'گ': 'g', 'ڤ': 'v', 'ڨ': 'g',
};

const VOWEL_LIKE: Record<string, string> = {
  'ا': 'a', 'أ': 'a', 'إ': 'i', 'آ': 'a', 'ٱ': 'a', 'ى': 'a', 'ة': 'a', 'ئ': 'e', 'ؤ': 'o', 'ء': '',
};

const ALEFS = new Set(['ا', 'أ', 'إ', 'آ', 'ٱ']);
const ARABIC_LETTER = /[ء-يٱ-ۓ]/;
const TASHKEEL = /[ً-ٰٟۖ-ۭـ]/g;

function digitValue(ch: string): string | null {
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
  if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
  return null;
}

/** Transliterates Arabic script to a readable Latin approximation ("ستوديو الريم" → "stodio alrim"). */
export function transliterateArabic(input: string): string {
  const chars = [...input.normalize('NFC').replace(TASHKEEL, '')];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] as string;
    const prev = chars[i - 1];
    const next = chars[i + 1];
    const atWordStart = prev === undefined || !ARABIC_LETTER.test(prev);

    const digit = digitValue(ch);
    if (digit !== null) {
      out += digit;
    } else if (ch === 'و' || ch === 'ي' || ch === 'ی') {
      const consonant = ch === 'و' ? 'w' : 'y';
      const vowel = ch === 'و' ? 'o' : 'i';
      // Consonantal at word start or before an alef ("الواحة" → alwaha), long vowel otherwise ("ريم" → rim).
      out += atWordStart || (next !== undefined && ALEFS.has(next)) ? consonant : vowel;
    } else if (ch in CONSONANTS) {
      out += CONSONANTS[ch];
    } else if (ch in VOWEL_LIKE) {
      out += VOWEL_LIKE[ch];
    } else {
      out += ch;
    }
  }
  return out;
}

/** Converts any text (Arabic or Latin) to a URL slug of `a-z0-9-`. May return an empty string. */
export function slugify(input: string): string {
  const latin = transliterateArabic(input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (latin.length <= SLUG_MAX) return latin;
  const cut = latin.slice(0, SLUG_MAX);
  const lastDash = cut.lastIndexOf('-');
  return (lastDash >= SLUG_MIN ? cut.slice(0, lastDash) : cut).replace(/-+$/, '');
}

/** Slug base for a place name: transliterated, or `place-xxxxxx` when nothing usable remains. */
export function slugBase(name: string): string {
  const slug = slugify(name);
  return slug.length >= SLUG_MIN ? slug : `place-${randomId(6)}`;
}

/** Picks the first free variant of `base` (`base`, `base-2`, `base-3`…) given the taken slugs. */
export function nextFreeSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}
