import type { AdminPlace, AdminPlaceDetail, ApiErrorBody } from '@s5y/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nextFreeSlug, slugify, transliterateArabic } from '../src/lib/slug.js';
import { type TestApp, admin, createPlace, createTestApp, login } from './helpers.js';

let t: TestApp;
let cookie: string;

beforeAll(async () => {
  t = await createTestApp();
  cookie = await login(t.app);
});
afterAll(async () => {
  await t.close();
});

describe('slug helpers', () => {
  it('transliterates Arabic names to readable Latin slugs', () => {
    expect(transliterateArabic('ريم')).toBe('rim');
    expect(slugify('ستوديو الواحة')).toBe('stodio-alwaha');
    expect(slugify('كافيه نخلة ٢٠٢٤')).toBe('kafih-nkhla-2024');
    expect(slugify('Café  Nakhla & Co.')).toBe('cafe-nakhla-and-co');
    expect(slugify('!!!')).toBe('');
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(80);
  });

  it('picks the next free numbered variant', () => {
    expect(nextFreeSlug('nakhla', [])).toBe('nakhla');
    expect(nextFreeSlug('nakhla', ['nakhla'])).toBe('nakhla-2');
    expect(nextFreeSlug('nakhla', ['nakhla', 'nakhla-2', 'nakhla-3'])).toBe('nakhla-4');
  });
});

describe('places CRUD', () => {
  let first: AdminPlace;

  it('creates a place with an auto slug, defaults and sortOrder at the end', async () => {
    first = await createPlace(t.app, cookie, {
      name: 'كافيه نخلة',
      category: 'كافيه',
      location: 'بغداد · الكرادة',
      services: ['ريلز', 'تصوير منتجات', 'ريلز'],
      instagram: '@nakhla.cafe',
      website: 'nakhla.iq',
    });
    expect(first.slug).toBe('kafih-nkhla');
    expect(first.accentColor).toBe('#e9b35f');
    expect(first.published).toBe(true);
    expect(first.featured).toBe(false);
    expect(first.services).toEqual(['ريلز', 'تصوير منتجات']);
    expect(first.instagram).toBe('nakhla.cafe');
    expect(first.website).toBe('https://nakhla.iq');
    expect(first.videoCount).toBe(0);
    expect(first.readyCount).toBe(0);
    expect(first.thumbUrl).toBeNull();
    expect(first.sortOrder).toBe(0);
  });

  it('suffixes duplicate auto slugs (-2, -3) and falls back to place-xxxxxx', async () => {
    const second = await createPlace(t.app, cookie, { name: 'كافيه نخلة' });
    const third = await createPlace(t.app, cookie, { name: 'كافيه   نخلة!' });
    expect(second.slug).toBe('kafih-nkhla-2');
    expect(third.slug).toBe('kafih-nkhla-3');
    expect(third.sortOrder).toBe(2);
    const emoji = await createPlace(t.app, cookie, { name: '☕️☕️' });
    expect(emoji.slug).toMatch(/^place-[a-z0-9]{6}$/);
  });

  it('accepts an explicit slug but answers 409 when it is taken', async () => {
    const custom = await createPlace(t.app, cookie, { name: 'Iron Zone Gym', slug: 'Iron-Zone' });
    expect(custom.slug).toBe('iron-zone');
    const taken = await t.app.inject({
      method: 'POST',
      url: '/api/admin/places',
      headers: admin(cookie),
      payload: { name: 'Another', slug: 'iron-zone' },
    });
    expect(taken.statusCode).toBe(409);
    expect((taken.json() as ApiErrorBody).error.code).toBe('CONFLICT');
  });

  it('validates slugs, colors, keys and required fields', async () => {
    const bad = [
      { name: 'X', slug: 'no spaces' },
      { name: 'X', slug: 'a' },
      { name: 'X', slug: '-dash-' },
      { name: 'X', accentColor: 'red' },
      { name: 'X', coverKey: '../../etc/passwd' },
      { name: 'X', year: 1800 },
      { name: '' },
      {},
    ];
    for (const payload of bad) {
      const res = await t.app.inject({ method: 'POST', url: '/api/admin/places', headers: admin(cookie), payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      const body = res.json() as ApiErrorBody;
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(body.error.details)).toBe(true);
    }
  });

  it('updates fields, keeps the slug stable and regenerates it on request', async () => {
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/admin/places/${first.id}`,
      headers: admin(cookie),
      payload: { name: 'Nakhla Specialty Coffee', accentColor: '#C8925A', featured: true, summary: '  ' },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json() as AdminPlace;
    expect(updated.name).toBe('Nakhla Specialty Coffee');
    expect(updated.slug).toBe('kafih-nkhla');
    expect(updated.accentColor).toBe('#c8925a');
    expect(updated.featured).toBe(true);
    expect(updated.summary).toBeNull();

    const regen = await t.app.inject({ method: 'PATCH', url: `/api/admin/places/${first.id}`, headers: admin(cookie), payload: { slug: '' } });
    expect((regen.json() as AdminPlace).slug).toBe('nakhla-specialty-coffee');

    const conflict = await t.app.inject({
      method: 'PATCH',
      url: `/api/admin/places/${first.id}`,
      headers: admin(cookie),
      payload: { slug: 'iron-zone' },
    });
    expect(conflict.statusCode).toBe(409);
  });

  it('returns 404 for unknown ids', async () => {
    for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
      const res = await t.app.inject({ method, url: '/api/admin/places/cunknown000000000000000000', headers: admin(cookie), payload: method === 'PATCH' ? {} : undefined });
      expect(res.statusCode).toBe(404);
      expect((res.json() as ApiErrorBody).error.code).toBe('NOT_FOUND');
    }
  });

  it('lists in sortOrder and reorders in one transaction', async () => {
    const list = (await t.app.inject({ method: 'GET', url: '/api/admin/places', headers: { cookie } })).json() as AdminPlace[];
    expect(list.map((p) => p.sortOrder)).toEqual([...list.keys()]);
    const reversed = [...list].reverse().map((p) => p.id);
    const res = await t.app.inject({ method: 'PUT', url: '/api/admin/places/order', headers: admin(cookie), payload: { ids: reversed } });
    expect(res.statusCode).toBe(204);
    const after = (await t.app.inject({ method: 'GET', url: '/api/admin/places', headers: { cookie } })).json() as AdminPlace[];
    expect(after.map((p) => p.id)).toEqual(reversed);

    // Partial lists put the given ids first.
    const lastId = reversed.at(-1)!;
    await t.app.inject({ method: 'PUT', url: '/api/admin/places/order', headers: admin(cookie), payload: { ids: [lastId] } });
    const partial = (await t.app.inject({ method: 'GET', url: '/api/admin/places', headers: { cookie } })).json() as AdminPlace[];
    expect(partial[0]?.id).toBe(lastId);
    expect(partial).toHaveLength(list.length);

    const unknown = await t.app.inject({ method: 'PUT', url: '/api/admin/places/order', headers: admin(cookie), payload: { ids: ['nope123'] } });
    expect(unknown.statusCode).toBe(400);
    const dupes = await t.app.inject({ method: 'PUT', url: '/api/admin/places/order', headers: admin(cookie), payload: { ids: [lastId, lastId] } });
    expect(dupes.statusCode).toBe(400);
  });

  it('returns the detail with videos and deletes a place', async () => {
    const detail = await t.app.inject({ method: 'GET', url: `/api/admin/places/${first.id}`, headers: { cookie } });
    expect(detail.statusCode).toBe(200);
    expect((detail.json() as AdminPlaceDetail).videos).toEqual([]);
    const del = await t.app.inject({ method: 'DELETE', url: `/api/admin/places/${first.id}`, headers: admin(cookie) });
    expect(del.statusCode).toBe(204);
    expect((await t.app.inject({ method: 'GET', url: `/api/admin/places/${first.id}`, headers: { cookie } })).statusCode).toBe(404);
  });
});
