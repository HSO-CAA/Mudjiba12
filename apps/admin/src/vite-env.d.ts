/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public portfolio origin for "view on site" links (defaults: same origin in prod, :5173 in dev). */
  readonly VITE_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
