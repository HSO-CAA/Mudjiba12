import fs from 'node:fs/promises';

export const WEB_HEAD_PLACEHOLDER = '<!--s5y-head-->';
export const ADMIN_HEAD_PLACEHOLDER = '<!--s5y-admin-head-->';

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** JSON safe to embed inside a `<script type="application/ld+json">` block. */
export const jsonForHtml = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028|\u2029/g, '');

export interface PageMeta {
  title: string;
  description: string;
  keywords?: string;
  canonical: string;
  image: string | null;
  siteName: string;
  type: 'website' | 'profile' | 'article';
  noindex?: boolean;
  jsonLd?: unknown;
}

export function renderWebHead(meta: PageMeta): string {
  const tags: string[] = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}">`,
  ];
  if (meta.keywords) tags.push(`<meta name="keywords" content="${escapeHtml(meta.keywords)}">`);
  if (meta.noindex) tags.push('<meta name="robots" content="noindex">');
  tags.push(
    `<link rel="canonical" href="${escapeHtml(meta.canonical)}">`,
    `<meta property="og:type" content="${meta.type}">`,
    `<meta property="og:site_name" content="${escapeHtml(meta.siteName)}">`,
    '<meta property="og:locale" content="ar_IQ">',
    `<meta property="og:title" content="${escapeHtml(meta.title)}">`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}">`,
    `<meta property="og:url" content="${escapeHtml(meta.canonical)}">`,
    `<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}">`,
  );
  if (meta.image) {
    tags.push(
      `<meta property="og:image" content="${escapeHtml(meta.image)}">`,
      `<meta name="twitter:image" content="${escapeHtml(meta.image)}">`,
    );
  }
  if (meta.jsonLd) tags.push(`<script type="application/ld+json">${jsonForHtml(meta.jsonLd)}</script>`);
  return tags.join('\n    ');
}

/** Inserts `head` at the placeholder (or before `</head>`), replacing any static `<title>`. */
export function injectHead(template: string, placeholder: string, head: string, replaceTitle: boolean): string {
  let html = replaceTitle ? template.replace(/<title>[\s\S]*?<\/title>\s*/i, '') : template;
  if (html.includes(placeholder)) return html.replace(placeholder, () => head);
  html = html.replace(/<\/head>/i, () => `${head}\n  </head>`);
  return html;
}

/** Inserts the admin head right where Vite expects it, falling back to just after `<head>`. */
export function injectAdminHead(template: string, head: string): string {
  if (template.includes(ADMIN_HEAD_PLACEHOLDER)) return template.replace(ADMIN_HEAD_PLACEHOLDER, () => head);
  return template.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n    ${head}`);
}

/** index.html cache that re-reads the file when it changes on disk (rebuilds without restart). */
export class TemplateFile {
  private cached: { mtimeMs: number; html: string } | null = null;

  constructor(readonly file: string) {}

  async read(): Promise<string> {
    const stat = await fs.stat(this.file);
    if (this.cached && this.cached.mtimeMs === stat.mtimeMs) return this.cached.html;
    const html = await fs.readFile(this.file, 'utf8');
    this.cached = { mtimeMs: stat.mtimeMs, html };
    return html;
  }
}
