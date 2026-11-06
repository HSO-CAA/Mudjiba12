import fs from 'node:fs/promises';
import path from 'node:path';
import type { ApiErrorBody, SettingsResponse, SiteSettings, UploadedImage } from '@s5y/shared';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeStoredSettings } from '../src/services/settings.js';
import { type TestApp, admin, createTestApp, login, multipartBody } from './helpers.js';

const fixtures = inject('fixturesDir');
let t: TestApp;
let cookie: string;

beforeAll(async () => {
  t = await createTestApp();
  cookie = await login(t.app);
});
afterAll(async () => {
  await t.close();
});

const getSettings = async () =>
  (await t.app.inject({ method: 'GET', url: '/api/admin/settings', headers: { cookie } })).json() as SettingsResponse;
const putSettings = (payload: object) => t.app.inject({ method: 'PUT', url: '/api/admin/settings', headers: admin(cookie), payload: payload as Record<string, unknown> });

describe('site settings', () => {
  it('seeds the exact contract defaults on first boot', async () => {
    const res = await getSettings();
    expect(res.settings).toEqual(DEFAULT_SETTINGS);
    expect(res.urls).toEqual({ avatarUrl: null, ogImageUrl: null });
    expect(res.settings.sections.plans).toBe(false);
    expect(res.settings.brand.accent).toBe('#e9b35f');
  });

  it('fills defaults for missing keys and drops unknown ones', async () => {
    const res = await putSettings({ brand: { name: 'حسين S5Y' }, sections: { plans: true }, futureFeature: { x: 1 } });
    expect(res.statusCode).toBe(200);
    const saved = (res.json() as SettingsResponse).settings;
    expect(saved.brand).toEqual({ ...DEFAULT_SETTINGS.brand, name: 'حسين S5Y' });
    expect(saved.sections).toEqual({ ...DEFAULT_SETTINGS.sections, plans: true });
    expect(saved.seo).toEqual(DEFAULT_SETTINGS.seo);
    expect(saved).not.toHaveProperty('futureFeature');
  });

  it('normalizes values (accent case, handles, whatsapp digits, stats)', async () => {
    const current = (await getSettings()).settings;
    const next: SiteSettings = {
      ...current,
      brand: { ...current.brand, accent: '#FFAA00', handle: '@s5y' },
      contact: { ...current.contact, whatsapp: '+964 770 123 4567', instagram: '@s5y', email: 'hello@s5y.iq' },
      stats: [
        { label: 'مكان', value: 40, suffix: '+' },
        { label: 'مشاهدة', value: 2_500_000 },
      ],
      about: { ...current.about, since: 2018 },
    };
    const res = await putSettings(next);
    expect(res.statusCode).toBe(200);
    const saved = (res.json() as SettingsResponse).settings;
    expect(saved.brand.accent).toBe('#ffaa00');
    expect(saved.brand.handle).toBe('s5y');
    expect(saved.contact.whatsapp).toBe('9647701234567');
    expect(saved.contact.instagram).toBe('s5y');
    expect(saved.stats).toHaveLength(2);
    // The public site now shows the custom stats.
    const site = (await t.app.inject({ method: 'GET', url: '/api/public/site' })).json() as { stats: unknown[] };
    expect(site.stats).toEqual(saved.stats);
  });

  it('rejects invalid values with VALIDATION_ERROR details', async () => {
    const current = (await getSettings()).settings;
    const invalid: object[] = [
      { ...current, brand: { ...current.brand, accent: 'gold' } },
      { ...current, brand: { ...current.brand, name: '' } },
      { ...current, contact: { ...current.contact, email: 'nope' } },
      { ...current, contact: { ...current.contact, whatsapp: 'call me' } },
      { ...current, about: { ...current.about, since: 3000 } },
      { ...current, about: { ...current.about, avatarKey: '/etc/passwd' } },
      { ...current, hero: { videoIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] } },
      { ...current, stats: [{ label: '', value: 1 }] },
      { ...current, sections: { ...current.sections, plans: 'yes' } },
    ];
    for (const payload of invalid) {
      const res = await putSettings(payload);
      expect(res.statusCode).toBe(400);
      const body = res.json() as ApiErrorBody;
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect((body.error.details as unknown[]).length).toBeGreaterThan(0);
    }
  });

  it('reads stored documents forward-compatibly (bad/missing values → defaults)', () => {
    const normalized = normalizeStoredSettings({ brand: { name: 'X', accent: 'not-a-color' }, sections: null, stats: 'oops' });
    expect(normalized.brand.name).toBe('X');
    expect(normalized.brand.accent).toBe(DEFAULT_SETTINGS.brand.accent);
    expect(normalized.sections).toEqual(DEFAULT_SETTINGS.sections);
    expect(normalized.stats).toEqual([]);
    expect(normalizeStoredSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('refuses image keys that were never uploaded', async () => {
    const current = (await getSettings()).settings;
    const res = await putSettings({ ...current, about: { ...current.about, avatarKey: 'images/2026/01/abcdefghij0123456789.webp' } });
    expect(res.statusCode).toBe(400);
    const details = (res.json() as ApiErrorBody).error.details as { path: string[] }[];
    expect(details[0]?.path).toEqual(['about', 'avatarKey']);
  });

  it('resolves image URLs and deletes the replaced avatar file', async () => {
    const png = await fs.readFile(path.join(fixtures, 'image.png'));
    const upload = async () => {
      const { payload, headers } = multipartBody('file', 'a.png', 'image/png', png);
      return (await t.app.inject({ method: 'POST', url: '/api/admin/uploads/image', headers: { ...admin(cookie), ...headers }, payload })).json() as UploadedImage;
    };
    const first = await upload();
    const second = await upload();
    const current = (await getSettings()).settings;
    const one = await putSettings({ ...current, about: { ...current.about, avatarKey: first.key }, seo: { ...current.seo, ogImageKey: first.key } });
    expect((one.json() as SettingsResponse).urls).toEqual({ avatarUrl: first.url, ogImageUrl: first.url });
    // Still referenced by seo.ogImageKey → kept.
    await putSettings({ ...current, about: { ...current.about, avatarKey: second.key }, seo: { ...current.seo, ogImageKey: first.key } });
    await fs.access(path.join(t.storageDir, first.key));
    // No longer referenced anywhere → deleted.
    await putSettings({ ...current, about: { ...current.about, avatarKey: second.key }, seo: { ...current.seo, ogImageKey: null } });
    await expect(fs.access(path.join(t.storageDir, first.key))).rejects.toThrow();
    const site = (await t.app.inject({ method: 'GET', url: '/api/public/site' })).json() as { about: { avatarUrl: string } };
    expect(site.about.avatarUrl).toBe(second.url);
  });
});
