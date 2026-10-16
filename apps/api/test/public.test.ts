import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AdminInquiry,
  AdminPlan,
  AdminVideo,
  ApiErrorBody,
  HomeData,
  InquiryCreated,
  InquiryList,
  Overview,
  PlaceDetail,
  PlaceSummary,
  PublicPlan,
  PublicSite,
} from '@s5y/shared';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { type TestApp, admin, createPlace, createTestApp, login, randomIp, uploadVideo } from './helpers.js';

const fixtures = inject('fixturesDir');
let t: TestApp;
let cookie: string;

const ids = {
  visiblePlace: '',
  hiddenPlace: '',
  readyVideo: '',
  secondReady: '',
  hiddenVideo: '',
  inHiddenPlace: '',
  processingVideo: '',
};

const get = <T>(url: string) => t.app.inject({ method: 'GET', url }).then((r) => ({ res: r, body: r.json() as T }));

beforeAll(async () => {
  t = await createTestApp();
  cookie = await login(t.app);
  const mp4 = await fs.readFile(path.join(fixtures, 'tiny.mp4'));

  const visible = await createPlace(t.app, cookie, { name: 'مطعم زاد الرافدين', category: 'مطعم', location: 'بغداد', summary: 'أكلات عراقية' });
  const hidden = await createPlace(t.app, cookie, { name: 'Hidden Place', published: false });
  const third = await createPlace(t.app, cookie, { name: 'Third Place' });
  ids.visiblePlace = visible.id;
  ids.hiddenPlace = hidden.id;

  ids.readyVideo = (await uploadVideo(t.app, cookie, visible.id, mp4)).id;
  ids.secondReady = (await uploadVideo(t.app, cookie, visible.id, mp4)).id;
  ids.hiddenVideo = (await uploadVideo(t.app, cookie, visible.id, mp4)).id;
  ids.inHiddenPlace = (await uploadVideo(t.app, cookie, hidden.id, mp4)).id;
  await uploadVideo(t.app, cookie, third.id, mp4);
  await t.ctx.queue.onIdle();

  await t.app.inject({ method: 'PATCH', url: `/api/admin/videos/${ids.hiddenVideo}`, headers: admin(cookie), payload: { published: false } });
  await t.app.inject({ method: 'PATCH', url: `/api/admin/videos/${ids.secondReady}`, headers: admin(cookie), payload: { featured: true } });

  // A video still uploading must never leak.
  const init = await t.app.inject({
    method: 'POST',
    url: '/api/admin/videos/uploads',
    headers: admin(cookie),
    payload: { placeId: visible.id, fileName: 'later.mp4', size: 1000, mimeType: 'video/mp4' },
  });
  ids.processingVideo = (init.json() as { videoId: string }).videoId;
});

afterAll(async () => {
  await t.close();
});

describe('public portfolio data', () => {
  it('lists only published places with READY + published videos', async () => {
    const { res, body } = await get<PlaceSummary[]>('/api/public/places');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=30, stale-while-revalidate=300');
    expect(body.map((p) => p.id)).not.toContain(ids.hiddenPlace);
    const visible = body.find((p) => p.id === ids.visiblePlace)!;
    expect(visible.videoCount).toBe(2);
    expect(visible.previews.map((v) => v.id)).toEqual([ids.readyVideo, ids.secondReady]);
    const preview = visible.previews[0]!;
    expect(preview).toMatchObject({ width: 180, height: 320, aspect: 0.5625, featured: false, plays: 0 });
    expect(preview.url).toMatch(/\/video\.mp4\?v=[0-9a-z]+$/);
    expect(preview.previewUrl).toMatch(/\/preview\.mp4\?v=[0-9a-z]+$/);
    expect(preview.posterUrl).toMatch(/\/poster\.jpg\?v=[0-9a-z]+$/);
    expect(preview).not.toHaveProperty('status');
    expect(preview).not.toHaveProperty('sourceKey');
  });

  it('returns place detail with prev/next and 404 for hidden or unknown places', async () => {
    const places = (await get<PlaceSummary[]>('/api/public/places')).body;
    const { res, body } = await get<PlaceDetail>(`/api/public/places/${places[0]!.slug}`);
    expect(res.statusCode).toBe(200);
    expect(body.videos.map((v) => v.id)).toEqual([ids.readyVideo, ids.secondReady]);
    expect(body.prev).toBeNull();
    expect(body.next).toEqual({ slug: places[1]!.slug, name: places[1]!.name });
    expect(body.services).toEqual([]);

    const hiddenSlug = (await t.ctx.prisma.place.findUniqueOrThrow({ where: { id: ids.hiddenPlace } })).slug;
    for (const slug of [hiddenSlug, 'does-not-exist', 'BAD SLUG']) {
      const r = await t.app.inject({ method: 'GET', url: `/api/public/places/${encodeURIComponent(slug)}` });
      expect(r.statusCode).toBe(404);
      expect((r.json() as ApiErrorBody).error.code).toBe('NOT_FOUND');
      expect(r.headers['cache-control']).toBe('no-store');
    }
  });

  it('builds the home payload: hero → featured, showreel → featured, plans hidden by default', async () => {
    const { body } = await get<HomeData>('/api/public/home');
    expect(body.heroVideos.map((v) => v.id)).toEqual([ids.secondReady]);
    expect(body.showreel.map((v) => v.id)).toEqual([ids.secondReady]);
    expect(body.plans).toEqual([]);
    expect(body.places.map((p) => p.id)).not.toContain(ids.hiddenPlace);
    const all = [...body.heroVideos, ...body.showreel, ...body.places.flatMap((p) => p.previews)].map((v) => v.id);
    for (const hidden of [ids.hiddenVideo, ids.inHiddenPlace, ids.processingVideo]) expect(all).not.toContain(hidden);
    expect(body.site.counts).toEqual({ places: 2, videos: 3, plays: 0 });
    // Automatic stats when none are configured (zero values are skipped).
    expect(body.site.stats.map((s) => s.label)).toEqual(['أماكن اشتغلت وياها', 'فيديو منشور', 'سنوات خبرة']);
    expect(JSON.stringify(body)).not.toContain('/studio');
  });

  it('uses settings.hero.videoIds in order, skipping videos that are not public', async () => {
    const current = (await t.app.inject({ method: 'GET', url: '/api/admin/settings', headers: { cookie } })).json() as {
      settings: Record<string, unknown> & { hero: { videoIds: string[] } };
    };
    const settings = { ...current.settings, hero: { videoIds: [ids.hiddenVideo, ids.secondReady, ids.readyVideo] } };
    const put = await t.app.inject({ method: 'PUT', url: '/api/admin/settings', headers: admin(cookie), payload: settings });
    expect(put.statusCode).toBe(200);
    const { body } = await get<HomeData>('/api/public/home');
    expect(body.heroVideos.map((v) => v.id)).toEqual([ids.secondReady, ids.readyVideo]);
  });

  it('falls back to latest READY videos when nothing is featured', async () => {
    await t.app.inject({ method: 'PATCH', url: `/api/admin/videos/${ids.secondReady}`, headers: admin(cookie), payload: { featured: false } });
    const { body } = await get<HomeData>('/api/public/home');
    expect(body.showreel.length).toBe(3);
    expect(body.showreel.map((v) => v.id)).not.toContain(ids.hiddenVideo);
  });

  it('exposes the public site document without storage keys', async () => {
    const { body } = await get<PublicSite>('/api/public/site');
    expect(body.brand.name).toBe('S5Y');
    expect(body.about).toHaveProperty('avatarUrl', null);
    expect(body.about).not.toHaveProperty('avatarKey');
    expect(body.seo).toHaveProperty('ogImageUrl', null);
    expect(body.seo).not.toHaveProperty('ogImageKey');
  });
});

describe('plans', () => {
  let active: AdminPlan;
  let inactive: AdminPlan;

  it('CRUD with validation and ordering', async () => {
    const create = (payload: Record<string, unknown>) =>
      t.app.inject({ method: 'POST', url: '/api/admin/plans', headers: admin(cookie), payload });
    const a = await create({ name: 'باقة البداية', price: 350000, features: ['4 ريلز شهرياً'], highlighted: true });
    expect(a.statusCode).toBe(201);
    active = a.json() as AdminPlan;
    expect(active).toMatchObject({ currency: 'IQD', period: 'MONTHLY', active: true, inquiryCount: 0, sortOrder: 0 });
    inactive = (await create({ name: 'باقة مخفية', price: null, active: false, currency: 'usd', period: 'YEARLY' })).json() as AdminPlan;
    expect(inactive.currency).toBe('USD');
    expect((await create({ name: 'X', price: 12.5 })).statusCode).toBe(400);
    expect((await create({ name: 'X', period: 'WEEKLY' })).statusCode).toBe(400);

    const order = await t.app.inject({ method: 'PUT', url: '/api/admin/plans/order', headers: admin(cookie), payload: { ids: [inactive.id, active.id] } });
    expect(order.statusCode).toBe(204);
    const list = (await t.app.inject({ method: 'GET', url: '/api/admin/plans', headers: { cookie } })).json() as AdminPlan[];
    expect(list.map((p) => p.id)).toEqual([inactive.id, active.id]);

    const patch = await t.app.inject({ method: 'PATCH', url: `/api/admin/plans/${active.id}`, headers: admin(cookie), payload: { tagline: 'للمشاريع الجديدة' } });
    expect((patch.json() as AdminPlan).tagline).toBe('للمشاريع الجديدة');
  });

  it('are public only when sections.plans is on, and only active ones', async () => {
    expect((await get<PublicPlan[]>('/api/public/plans')).body).toEqual([]);
    const current = (await t.app.inject({ method: 'GET', url: '/api/admin/settings', headers: { cookie } })).json() as {
      settings: { sections: Record<string, boolean> };
    };
    const settings = { ...current.settings, sections: { ...current.settings.sections, plans: true } };
    await t.app.inject({ method: 'PUT', url: '/api/admin/settings', headers: admin(cookie), payload: settings });
    const plans = (await get<PublicPlan[]>('/api/public/plans')).body;
    expect(plans.map((p) => p.id)).toEqual([active.id]);
    expect(plans[0]).not.toHaveProperty('active');
    expect((await get<HomeData>('/api/public/home')).body.plans.map((p) => p.id)).toEqual([active.id]);
  });
});

describe('inquiries', () => {
  const post = (payload: Record<string, unknown>, ip = randomIp()) =>
    t.app.inject({ method: 'POST', url: '/api/public/inquiries', remoteAddress: ip, payload });

  it('validates name, message and contact details', async () => {
    const cases: Record<string, unknown>[] = [
      { name: 'A', phone: '07700000000', message: 'مرحبا اريد اسعار' },
      { name: 'علي', phone: '07700000000', message: 'هلا' },
      { name: 'علي', message: 'اريد تفاصيل الباقات' },
      { name: 'علي', email: 'not-an-email', message: 'اريد تفاصيل الباقات' },
      { name: 'علي', phone: 'abc-def-ghi', message: 'اريد تفاصيل الباقات' },
      { name: 'علي', phone: '123', message: 'اريد تفاصيل الباقات' },
    ];
    for (const payload of cases) {
      const res = await post(payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect((res.json() as ApiErrorBody).error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('stores a valid inquiry linked to an active plan', async () => {
    const plan = (await t.app.inject({ method: 'GET', url: '/api/admin/plans', headers: { cookie } })).json() as AdminPlan[];
    const activePlan = plan.find((p) => p.active)!;
    const inactivePlan = plan.find((p) => !p.active)!;
    const bad = await post({ name: 'سارة', phone: '+964 770 123 4567', message: 'اريد الباقة', planId: inactivePlan.id });
    expect(bad.statusCode).toBe(400);
    const res = await post({ name: '  سارة  ', phone: '+964 770 123 4567', message: 'اريد الباقة الشهرية لمطعمنا', planId: activePlan.id, source: 'plan' });
    expect(res.statusCode).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const created = res.json() as InquiryCreated;
    expect(created.ok).toBe(true);
    const list = (await t.app.inject({ method: 'GET', url: '/api/admin/inquiries', headers: { cookie } })).json() as InquiryList;
    expect(list.items[0]).toMatchObject({ id: created.id, name: 'سارة', planName: activePlan.name, status: 'NEW', source: 'plan' });
    const plans = (await t.app.inject({ method: 'GET', url: '/api/admin/plans', headers: { cookie } })).json() as AdminPlan[];
    expect(plans.find((p) => p.id === activePlan.id)?.inquiryCount).toBe(1);
  });

  it('accepts the long "place:<slug>" source sent from any place page', async () => {
    const source = `place:${'a'.repeat(80)}`; // slugs may be up to 80 characters
    const res = await post({ name: 'مكان طويل', phone: '07700000000', message: 'اريد نفس المحتوى لمكاني', source });
    expect(res.statusCode).toBe(201);
    const { id } = res.json() as InquiryCreated;
    expect((await t.ctx.prisma.inquiry.findUniqueOrThrow({ where: { id } })).source).toBe(source);
    await t.ctx.prisma.inquiry.delete({ where: { id } });
  });

  it('honeypot submissions get a fake 201 and nothing is stored', async () => {
    const before = await t.ctx.prisma.inquiry.count();
    const res = await post({ name: 'bot', message: 'buy now', website: 'http://spam.example' });
    expect(res.statusCode).toBe(201);
    expect((res.json() as InquiryCreated).id).toMatch(/^c[a-z0-9]{24}$/);
    expect(await t.ctx.prisma.inquiry.count()).toBe(before);
  });

  it('rate-limits submissions (5 per 10 minutes per IP)', async () => {
    const ip = randomIp();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await post({ name: 'x', message: 'y' }, ip)).statusCode);
    expect(codes.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
    expect(codes[5]).toBe(429);
  });

  it('admin can filter, search, paginate, update and delete', async () => {
    await post({ name: 'مصطفى', email: 'mustafa@example.com', message: 'تصوير افتتاح كافيه' });
    await post({ name: 'زينب', phone: '07801234567', message: 'إعلان لعطور جديدة' });
    const page = (await t.app.inject({ method: 'GET', url: '/api/admin/inquiries?page=1&pageSize=2', headers: { cookie } })).json() as InquiryList;
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);
    expect(page.counts).toEqual({ NEW: 3, CONTACTED: 0, WON: 0, ARCHIVED: 0 });

    const search = (await t.app.inject({ method: 'GET', url: `/api/admin/inquiries?q=${encodeURIComponent('عطور')}`, headers: { cookie } })).json() as InquiryList;
    expect(search.items.map((i) => i.name)).toEqual(['زينب']);

    const target = search.items[0]!;
    const patch = await t.app.inject({
      method: 'PATCH',
      url: `/api/admin/inquiries/${target.id}`,
      headers: admin(cookie),
      payload: { status: 'CONTACTED', notes: 'اتصلت بيها، تنتظر عرض سعر' },
    });
    expect((patch.json() as AdminInquiry).status).toBe('CONTACTED');
    const contacted = (await t.app.inject({ method: 'GET', url: '/api/admin/inquiries?status=CONTACTED', headers: { cookie } })).json() as InquiryList;
    expect(contacted.items.map((i) => i.id)).toEqual([target.id]);
    expect(contacted.counts.CONTACTED).toBe(1);

    expect((await t.app.inject({ method: 'GET', url: '/api/admin/inquiries?status=NOPE', headers: { cookie } })).statusCode).toBe(400);
    expect((await t.app.inject({ method: 'DELETE', url: `/api/admin/inquiries/${target.id}`, headers: admin(cookie) })).statusCode).toBe(204);
  });

  it('deleting a plan keeps its inquiries', async () => {
    const plans = (await t.app.inject({ method: 'GET', url: '/api/admin/plans', headers: { cookie } })).json() as AdminPlan[];
    const linked = plans.find((p) => p.inquiryCount > 0)!;
    const res = await t.app.inject({ method: 'DELETE', url: `/api/admin/plans/${linked.id}`, headers: admin(cookie) });
    expect(res.statusCode).toBe(204);
    const list = (await t.app.inject({ method: 'GET', url: '/api/admin/inquiries', headers: { cookie } })).json() as InquiryList;
    const orphan = list.items.find((i) => i.name === 'سارة')!;
    expect(orphan).toMatchObject({ planId: null, planName: null });
  });
});

describe('analytics', () => {
  const track = (payload: unknown, contentType = 'application/json') =>
    t.app.inject({
      method: 'POST',
      url: '/api/public/track',
      headers: { 'content-type': contentType },
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    });

  it('counts pageviews, place views and plays', async () => {
    const slug = (await t.ctx.prisma.place.findUniqueOrThrow({ where: { id: ids.visiblePlace } })).slug;
    expect((await track({ type: 'pageview', path: '/' })).statusCode).toBe(204);
    expect((await track({ type: 'pageview', path: `/work/${slug}?ref=ig` })).statusCode).toBe(204);
    // sendBeacon with a text/plain body is accepted too.
    expect((await track(JSON.stringify({ type: 'play', videoId: ids.readyVideo }), 'text/plain;charset=UTF-8')).statusCode).toBe(204);
    expect((await track({ type: 'play', videoId: ids.readyVideo })).statusCode).toBe(204);
    // Hidden / unknown videos are ignored silently.
    expect((await track({ type: 'play', videoId: ids.hiddenVideo })).statusCode).toBe(204);
    expect((await track({ type: 'play', videoId: 'cunknown' })).statusCode).toBe(204);
    expect((await track({ type: 'nope' })).statusCode).toBe(400);
    expect((await track({ type: 'pageview', path: 'no-slash' })).statusCode).toBe(400);

    const rows = await t.ctx.prisma.dailyStat.findMany();
    const sum = (metric: string, refId?: string) =>
      rows.filter((r) => r.metric === metric && (refId === undefined || r.refId === refId)).reduce((a, r) => a + r.count, 0);
    expect(sum('pageview', '')).toBe(2);
    expect(sum('place_view', ids.visiblePlace)).toBe(1);
    expect(sum('play', ids.readyVideo)).toBe(2);
    expect(sum('play', ids.hiddenVideo)).toBe(0);
    const video = await t.ctx.prisma.video.findUniqueOrThrow({ where: { id: ids.readyVideo } });
    expect(video.plays).toBe(2);
    expect((await get<PublicSite>('/api/public/site')).body.counts.plays).toBe(2);
  });

  it('overview: zero-filled daily series, counters, tops and storage', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/admin/overview?days=7', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const o = res.json() as Overview;
    expect(o.series).toHaveLength(7);
    const today = new Date().toISOString().slice(0, 10);
    expect(o.series.at(-1)).toEqual({ date: today, views: 2, plays: 2 });
    expect(o.series.slice(0, 6).every((p) => p.views === 0 && p.plays === 0)).toBe(true);
    expect(o.series[0]!.date < o.series[6]!.date).toBe(true);
    expect(o.counts).toMatchObject({ places: 3, plays: 2, views: 2, videosProcessing: 0, videosFailed: 0, inquiriesNew: 2 });
    expect(o.counts.videos).toBe(6);
    expect(o.counts.storageBytes).toBeGreaterThan(0);
    expect(o.topVideos[0]?.id).toBe(ids.readyVideo);
    expect(o.topVideos[0]?.placeName).toBe('مطعم زاد الرافدين');
    expect(o.topPlaces).toEqual([{ id: ids.visiblePlace, name: 'مطعم زاد الرافدين', slug: expect.any(String), views: 1 }]);
    expect(o.recentInquiries.length).toBeGreaterThan(0);
    expect(o.mediaProcessing).toBe(true);

    const thirty = (await t.app.inject({ method: 'GET', url: '/api/admin/overview', headers: { cookie } })).json() as Overview;
    expect(thirty.series).toHaveLength(30);
    for (const days of ['3', '400', 'abc']) {
      expect((await t.app.inject({ method: 'GET', url: `/api/admin/overview?days=${days}`, headers: { cookie } })).statusCode).toBe(400);
    }
  });

  it('removes deleted videos from the hero list', async () => {
    const del = await t.app.inject({ method: 'DELETE', url: `/api/admin/videos/${ids.readyVideo}`, headers: admin(cookie) });
    expect(del.statusCode).toBe(204);
    const settings = (await t.app.inject({ method: 'GET', url: '/api/admin/settings', headers: { cookie } })).json() as {
      settings: { hero: { videoIds: string[] } };
    };
    expect(settings.settings.hero.videoIds).toEqual([ids.hiddenVideo, ids.secondReady]);
    const video = (await t.app.inject({ method: 'GET', url: `/api/admin/videos/${ids.secondReady}`, headers: { cookie } })).json() as AdminVideo;
    expect(video.status).toBe('READY');
  });
});
