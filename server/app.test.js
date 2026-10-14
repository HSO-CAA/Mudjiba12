import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';
import { openDb } from './db.js';

async function boot() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'pf-'));
  const { app } = createApp({ db: openDb(path.join(tmp, 'db')), uploadDir: path.join(tmp, 'up'), password: 'pw', adminPath: 'secret' });
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  return { base: `http://127.0.0.1:${srv.address().port}`, close: () => { srv.closeAllConnections(); srv.close(); } };
}

test('upload in dashboard shows on portfolio', async () => {
  const { base, close } = await boot();
  try {
    assert.equal((await fetch(`${base}/secret/api/clients`)).status, 401);
    assert.equal((await fetch(`${base}/secret/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"password":"x"}' })).status, 401);
    const login = await fetch(`${base}/secret/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"password":"pw"}' });
    const ck = login.headers.get('set-cookie').split(';')[0];
    const h = { cookie: ck, 'content-type': 'application/json' };

    const c = await (await fetch(`${base}/secret/api/clients`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'Cafe Nova' }) })).json();
    const fd = new FormData();
    fd.append('title', 'Promo');
    fd.append('video', new Blob([new Uint8Array(2048)], { type: 'video/mp4' }), 'a.mp4');
    assert.equal((await fetch(`${base}/secret/api/clients/${c.id}/videos`, { method: 'POST', headers: { cookie: ck }, body: fd })).status, 201);

    const bad = new FormData(); bad.append('video', new Blob(['x'], { type: 'text/html' }), 'x.html');
    assert.equal((await fetch(`${base}/secret/api/clients/${c.id}/videos`, { method: 'POST', headers: { cookie: ck }, body: bad })).status, 400);

    const pf = await (await fetch(`${base}/api/portfolio`)).json();
    assert.equal(pf.clients[0].name, 'Cafe Nova');
    assert.equal(pf.clients[0].videos[0].title, 'Promo');
    const media = await fetch(base + pf.clients[0].videos[0].url);
    assert.equal(media.status, 200);
    assert.equal((await media.arrayBuffer()).byteLength, 2048);

    assert.equal((await fetch(`${base}/admin/`)).status, 404);
    assert.equal((await fetch(`${base}/secret/`)).status, 200);
  } finally { close(); }
});
