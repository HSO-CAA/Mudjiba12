import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { openDb } from './db.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB || 500) * 1024 * 1024;
const VIDEO_EXT = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov' };

const slugify = (s) =>
  String(s).trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || crypto.randomBytes(3).toString('hex');

export function createApp(opts = {}) {
  const db = opts.db || openDb();
  const uploadDir = opts.uploadDir || process.env.UPLOAD_DIR || path.join(ROOT, 'data', 'uploads');
  mkdirSync(uploadDir, { recursive: true });

  const password = opts.password ?? process.env.ADMIN_PASSWORD ?? 'change-me';
  const usingDefaultPassword = !(opts.password ?? process.env.ADMIN_PASSWORD);
  const secret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
  const adminPath = '/' + (opts.adminPath || process.env.ADMIN_PATH || 'studio-7f3k').replace(/^\/+|\/+$/g, '');

  // --- tiny signed-cookie session (no extra deps) ---
  const sign = (v) => crypto.createHmac('sha256', secret).update(v).digest('base64url');
  const issue = () => { const exp = String(Date.now() + 12 * 3600e3); return `${exp}.${sign(exp)}`; };
  const valid = (tok) => {
    if (!tok) return false;
    const [exp, sig] = tok.split('.');
    if (!exp || !sig || Number(exp) < Date.now()) return false;
    const a = Buffer.from(sig), b = Buffer.from(sign(exp));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  const cookie = (req, name) => (req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === name)?.[1];
  const requireAdmin = (req, res, next) => (valid(cookie(req, 'adm')) ? next() : res.status(401).json({ error: 'unauthorized' }));

  const attempts = new Map();
  const throttle = (req, res, next) => {
    const k = req.ip, now = Date.now();
    const rec = (attempts.get(k) || []).filter((t) => now - t < 15 * 60e3);
    if (rec.length >= 10) return res.status(429).json({ error: 'too many attempts' });
    rec.push(now); attempts.set(k, rec); next();
  };

  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (_req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + (VIDEO_EXT[file.mimetype] || '')),
    }),
    limits: { fileSize: MAX_UPLOAD },
    fileFilter: (_req, file, cb) => cb(VIDEO_EXT[file.mimetype] ? null : new Error('only mp4, webm or mov videos are allowed'), !!VIDEO_EXT[file.mimetype]),
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use((_req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' }); next(); });

  // ---------- public API ----------
  const videoRow = (v) => ({ id: v.id, title: v.title, url: `/media/${v.filename}`, mime: v.mime, size: v.size });
  app.get('/api/portfolio', (_req, res) => {
    const clients = db.prepare('SELECT * FROM clients WHERE published = 1 ORDER BY sort_order, id').all();
    const vids = db.prepare('SELECT * FROM videos ORDER BY sort_order, id DESC').all();
    res.json({
      handle: 's5y', instagram: 'https://instagram.com/s5y',
      clients: clients.map((c) => ({
        id: c.id, slug: c.slug, name: c.name, description: c.description, accent: c.accent,
        videos: vids.filter((v) => v.client_id === c.id).map(videoRow),
      })),
    });
  });
  app.use('/media', express.static(uploadDir, { fallthrough: false, immutable: true, maxAge: '30d', index: false, dotfiles: 'deny' }));

  // ---------- admin API ----------
  app.post(`${adminPath}/api/login`, throttle, (req, res) => {
    const a = crypto.createHash('sha256').update(String(req.body?.password ?? '')).digest();
    const b = crypto.createHash('sha256').update(password).digest();
    if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'wrong password' });
    res.set('Set-Cookie', `adm=${issue()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 3600}`);
    res.json({ ok: true });
  });
  app.post(`${adminPath}/api/logout`, (_req, res) => { res.set('Set-Cookie', 'adm=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); res.json({ ok: true }); });
  app.get(`${adminPath}/api/session`, (req, res) => res.json({ authed: valid(cookie(req, 'adm')) }));

  const api = express.Router();
  api.use(requireAdmin);

  api.get('/clients', (_req, res) => {
    const rows = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM videos v WHERE v.client_id = c.id) AS video_count FROM clients c ORDER BY sort_order, id`).all();
    res.json(rows);
  });
  api.post('/clients', (req, res) => {
    const { name, description = '', accent = '#c8a45c' } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    if (!/^#[0-9a-f]{6}$/i.test(accent)) return res.status(400).json({ error: 'accent must be #rrggbb' });
    let slug = slugify(req.body.slug || name);
    if (db.prepare('SELECT 1 FROM clients WHERE slug = ?').get(slug)) slug += '-' + crypto.randomBytes(2).toString('hex');
    const next = db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM clients').get().n;
    const r = db.prepare('INSERT INTO clients (slug, name, description, accent, sort_order) VALUES (?,?,?,?,?)').run(slug, name.trim(), description, accent, next);
    res.status(201).json(db.prepare('SELECT * FROM clients WHERE id = ?').get(r.lastInsertRowid));
  });
  api.get('/clients/:id', (req, res) => {
    const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    res.json({ ...c, videos: db.prepare('SELECT * FROM videos WHERE client_id = ? ORDER BY sort_order, id DESC').all(c.id).map((v) => ({ ...v, url: `/media/${v.filename}` })) });
  });
  api.patch('/clients/:id', (req, res) => {
    const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    const b = req.body || {};
    if (b.accent !== undefined && !/^#[0-9a-f]{6}$/i.test(b.accent)) return res.status(400).json({ error: 'accent must be #rrggbb' });
    db.prepare('UPDATE clients SET name=?, description=?, accent=?, published=? WHERE id=?')
      .run(b.name?.trim() || c.name, b.description ?? c.description, b.accent ?? c.accent, b.published === undefined ? c.published : b.published ? 1 : 0, c.id);
    res.json(db.prepare('SELECT * FROM clients WHERE id = ?').get(c.id));
  });
  api.delete('/clients/:id', (req, res) => {
    const files = db.prepare('SELECT filename FROM videos WHERE client_id = ?').all(req.params.id);
    const r = db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
    if (!r.changes) return res.status(404).json({ error: 'not found' });
    files.forEach((f) => rm(f.filename));
    res.json({ ok: true });
  });

  const rm = (name) => { const p = path.join(uploadDir, path.basename(name)); if (existsSync(p)) unlinkSync(p); };

  api.post('/clients/:id/videos', (req, res) => {
    const c = db.prepare('SELECT id FROM clients WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'client not found' });
    upload.single('video')(req, res, (err) => {
      if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'video file is required (field "video")' });
      const title = (req.body.title || path.parse(req.file.originalname).name).trim().slice(0, 140);
      const r = db.prepare('INSERT INTO videos (client_id, title, filename, mime, size) VALUES (?,?,?,?,?)').run(c.id, title, req.file.filename, req.file.mimetype, req.file.size);
      res.status(201).json(db.prepare('SELECT * FROM videos WHERE id = ?').get(r.lastInsertRowid));
    });
  });
  api.patch('/videos/:id', (req, res) => {
    const r = db.prepare('UPDATE videos SET title = COALESCE(?, title) WHERE id = ?').run(req.body?.title?.trim() || null, req.params.id);
    r.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'not found' });
  });
  api.delete('/videos/:id', (req, res) => {
    const v = db.prepare('SELECT filename FROM videos WHERE id = ?').get(req.params.id);
    if (!v) return res.status(404).json({ error: 'not found' });
    db.prepare('DELETE FROM videos WHERE id = ?').run(req.params.id);
    rm(v.filename);
    res.json({ ok: true });
  });
  app.use(`${adminPath}/api`, api);

  // ---------- static ----------
  app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three')));
  // Dashboard shell is served only at the secret path and is never linked from the public site.
  app.use(adminPath, express.static(path.join(ROOT, 'admin-ui'), { index: 'index.html' }));
  app.use(express.static(path.join(ROOT, 'public')));
  app.use((req, res) => (req.path.startsWith('/api') || req.path.startsWith('/media') ? res.status(404).json({ error: 'not found' }) : res.status(404).send('Not found')));
  app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'server error' }); });

  return { app, db, adminPath, usingDefaultPassword };
}
