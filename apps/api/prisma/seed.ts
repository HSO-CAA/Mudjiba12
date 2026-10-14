/**
 * Database seed.
 *
 *   npm run db:seed                       → ensures default settings + the owner account (ADMIN_EMAIL/ADMIN_PASSWORD)
 *   npm run db:seed -- --demo             → also creates demo places, ffmpeg-generated vertical videos (run through
 *                                           the real processing pipeline), covers/logos, plans, inquiries and 30 days of stats
 *   npm run db:seed -- --reset-demo       → removes everything the demo created (add --demo to recreate it)
 *
 * Idempotent: demo content is tracked in the `demo` setting and is never created twice.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';
import type { InquiryStatus, PlanPeriod, Prisma } from '@prisma/client';
import { ConfigError, loadConfig, loadEnvFile } from '../src/config.js';
import { type AppContext, createContext } from '../src/context.js';
import { randomId } from '../src/lib/crypto.js';
import { storeImage } from '../src/media/images.js';
import type { Log } from '../src/media/queue.js';
import { processVideo, videoKeys } from '../src/media/video.js';
import { utcDay } from '../src/services/stats.js';

const execFileAsync = promisify(execFile);

const DEMO_KEY = 'demo';

interface DemoRecord {
  version: 1;
  createdAt: string;
  placeIds: string[];
  videoIds: string[];
  planIds: string[];
  inquiryIds: string[];
  /** Pageviews added per day (subtracted again on reset). */
  pageviews: Record<string, number>;
}

type Look = 'gradient' | 'fractal' | 'particles' | 'spiral';

interface DemoPlace {
  name: string;
  latin: string;
  slug: string;
  category: string;
  location: string;
  city: string;
  accent: string;
  year: number;
  featured: boolean;
  instagram: string;
  summary: string;
  description: string;
  services: string[];
  videos: { title: string; caption: string; look: Look; seconds: number; featured?: boolean }[];
}

const PLACES: DemoPlace[] = [
  {
    name: 'كافيه نخلة',
    latin: 'NAKHLA CAFE',
    slug: 'nakhla-cafe',
    category: 'كافيه',
    location: 'بغداد · الكرادة',
    city: 'BAGHDAD',
    accent: '#c8925a',
    year: 2025,
    featured: true,
    instagram: 'nakhla.cafe',
    summary: 'كافيه قهوة مختصة بقلب الكرادة — صوّرنا افتتاح الفرع وسلسلة ريلز للمنيو الشتوي.',
    description:
      'اشتغلنا ويا كافيه نخلة على هوية بصرية دافية تشبه المكان: إضاءة ذهبية، لقطات قريبة للقهوة، وحركة كاميرا هادية. المحتوى رفع التفاعل على الحساب وصار الناس يجون يصورون نفس الزوايا.',
    services: ['ريلز إنستغرام', 'تصوير منتجات', 'تغطية افتتاح'],
    videos: [
      { title: 'افتتاح الفرع الجديد', caption: 'GRAND OPENING', look: 'gradient', seconds: 8, featured: true },
      { title: 'قهوة الصبح', caption: 'MORNING BREW', look: 'particles', seconds: 7 },
      { title: 'منيو الشتاء', caption: 'WINTER MENU', look: 'fractal', seconds: 9 },
    ],
  },
  {
    name: 'مطعم زاد الرافدين',
    latin: 'ZAD AL RAFIDAIN',
    slug: 'zad-alrafidain',
    category: 'مطعم',
    location: 'بغداد · المنصور',
    city: 'BAGHDAD',
    accent: '#d4573b',
    year: 2024,
    featured: true,
    instagram: 'zad.alrafidain',
    summary: 'مطعم أكلات عراقية أصيلة — ريلز أسبوعية للأطباق وتغطية رمضانية كاملة.',
    description:
      'من المسكوف للدولمة، كل طبق إله قصة. صوّرنا سلسلة ريلز تبيّن تحضير الأكلات من البداية للنهاية، وغطّينا موسم رمضان بإعلانات للفطور والسحور.',
    services: ['ريلز أكلات', 'إعلانات رمضان', 'تصوير قائمة الطعام'],
    videos: [
      { title: 'مسكوف على الحطب', caption: 'MASGOUF NIGHT', look: 'fractal', seconds: 9, featured: true },
      { title: 'دولمة البيت', caption: 'HOMEMADE DOLMA', look: 'gradient', seconds: 7 },
      { title: 'سفرة رمضان', caption: 'RAMADAN TABLE', look: 'spiral', seconds: 8 },
      { title: 'وراء الكواليس بالمطبخ', caption: 'BEHIND THE KITCHEN', look: 'particles', seconds: 6 },
    ],
  },
  {
    name: 'آيرن زون جيم',
    latin: 'IRON ZONE GYM',
    slug: 'iron-zone-gym',
    category: 'نادي رياضي',
    location: 'أربيل · شارع 100',
    city: 'ERBIL',
    accent: '#3fa7d6',
    year: 2025,
    featured: false,
    instagram: 'ironzone.erbil',
    summary: 'نادي رياضي بأربيل — فيديو ترويجي للاشتراكات وريلز تمارين بإيقاع سريع.',
    description:
      'طاقة عالية، مونتاج سريع على الإيقاع، ولقطات سلو موشن للتمارين. الحملة كانت لإطلاق اشتراكات الصيف وجابت تسجيلات أكثر من المتوقع.',
    services: ['فيديو ترويجي', 'ريلز تمارين', 'تغطية بطولة'],
    videos: [
      { title: 'حملة الصيف', caption: 'SUMMER SHRED', look: 'particles', seconds: 8 },
      { title: 'يوم الأرجل', caption: 'LEG DAY', look: 'spiral', seconds: 6 },
      { title: 'بطولة الرفعات', caption: 'POWER MEET', look: 'gradient', seconds: 7 },
    ],
  },
  {
    name: 'عطور الماسة',
    latin: 'ALMASA PERFUMES',
    slug: 'almasa-perfumes',
    category: 'براند عطور',
    location: 'بغداد · زيونة',
    city: 'BAGHDAD',
    accent: '#b8a07e',
    year: 2024,
    featured: true,
    instagram: 'almasa.perfumes',
    summary: 'براند عطور فاخرة — إعلانات سينمائية لإطلاق مجموعة العيد.',
    description:
      'لقطات ماكرو للزجاج والضوء، دخان خفيف وحركة بطيئة تعطي إحساس الفخامة. صممنا الإعلانات بنسخ للريلز والستوري والإعلانات الممولة.',
    services: ['إعلان منتج', 'تصوير سينمائي', 'محتوى ستوري'],
    videos: [
      { title: 'مجموعة العيد', caption: 'EID COLLECTION', look: 'spiral', seconds: 9, featured: true },
      { title: 'عود ملكي', caption: 'ROYAL OUD', look: 'gradient', seconds: 8 },
    ],
  },
  {
    name: 'حلويات شط العرب',
    latin: 'SHATT AL ARAB SWEETS',
    slug: 'shatt-alarab-sweets',
    category: 'حلويات',
    location: 'البصرة · العشار',
    city: 'BASRA',
    accent: '#e58f4d',
    year: 2023,
    featured: false,
    instagram: 'shatt.sweets',
    summary: 'محل حلويات بصراوي عريق — ريلز للحلويات الشرقية وطلبات المناسبات.',
    description:
      'صوّرنا الكليجة والزلابية والبقلاوة بأجواء دافية، وسوينا سلسلة "من الفرن للعلبة" اللي صارت أكثر محتوى منتشر على الحساب.',
    services: ['ريلز', 'تصوير منتجات', 'إعلانات مناسبات'],
    videos: [
      { title: 'كليجة العيد', caption: 'KLEICHA SEASON', look: 'gradient', seconds: 7 },
      { title: 'من الفرن للعلبة', caption: 'OVEN TO BOX', look: 'fractal', seconds: 8 },
      { title: 'صواني المناسبات', caption: 'PARTY TRAYS', look: 'particles', seconds: 6 },
    ],
  },
  {
    name: 'صالون لمسة',
    latin: 'LAMSA LOUNGE',
    slug: 'lamsa-lounge',
    category: 'صالون تجميل',
    location: 'أربيل · عينكاوة',
    city: 'ERBIL',
    accent: '#e86f9a',
    year: 2025,
    featured: false,
    instagram: 'lamsa.lounge',
    summary: 'صالون تجميل — ريلز قبل وبعد وتصوير جلسات العرائس.',
    description:
      'محتوى ناعم وأنيق: إضاءة طبيعية، انتقالات قبل/بعد، وتركيز على التفاصيل. الحساب صار مرجع للعرائس بالمنطقة.',
    services: ['ريلز قبل وبعد', 'تصوير جلسات', 'إدارة حساب'],
    videos: [
      { title: 'إطلالة العروس', caption: 'BRIDAL LOOK', look: 'spiral', seconds: 7 },
      { title: 'قبل وبعد', caption: 'BEFORE AFTER', look: 'gradient', seconds: 6 },
    ],
  },
];

const PLANS: { name: string; tagline: string; price: number | null; period: PlanPeriod; features: string[]; highlighted: boolean; ctaLabel: string }[] = [
  {
    name: 'باقة البداية',
    tagline: 'للمشاريع الجديدة اللي تريد تبدي صح',
    price: 350_000,
    period: 'MONTHLY',
    features: ['4 ريلز احترافية بالشهر', 'يوم تصوير واحد', 'مونتاج مع موسيقى وتلوين', 'تعديلين لكل فيديو'],
    highlighted: false,
    ctaLabel: 'ابدأ هسه',
  },
  {
    name: 'باقة النمو',
    tagline: 'الأكثر طلباً للمطاعم والكافيهات',
    price: 650_000,
    period: 'MONTHLY',
    features: ['8 ريلز بالشهر', 'ستوريات أسبوعية', 'خطة محتوى شهرية', 'يومين تصوير', 'تقرير أداء شهري'],
    highlighted: true,
    ctaLabel: 'اطلب الباقة',
  },
  {
    name: 'باقة البراند',
    tagline: 'حملة إعلانية متكاملة حسب احتياجك',
    price: null,
    period: 'ONE_TIME',
    features: ['فيلم إعلاني سينمائي', 'فريق تصوير وإضاءة كامل', 'نسخ لكل المنصات', 'إدارة الحملة الممولة'],
    highlighted: false,
    ctaLabel: 'احجز استشارة',
  },
];

const INQUIRIES: { name: string; phone?: string; email?: string; message: string; status: InquiryStatus; notes?: string; plan?: number; source: string; daysAgo: number }[] = [
  {
    name: 'علي حسن',
    phone: '+964 770 412 3388',
    message: 'هلا، عندنا افتتاح فرع جديد للمطعم بالمنصور الشهر الجاي ونريد تغطية كاملة مع ريلز للافتتاح.',
    status: 'NEW',
    source: 'home',
    daysAgo: 0,
  },
  {
    name: 'نور الهدى',
    email: 'noor.lounge@example.com',
    message: 'أريد أعرف تفاصيل باقة النمو لصالون تجميل بأربيل، وهل التصوير يشمل جلسات العرائس؟',
    status: 'NEW',
    plan: 1,
    source: 'plan',
    daysAgo: 1,
  },
  {
    name: 'مصطفى كريم',
    phone: '07801234567',
    message: 'نحتاج فيديو إعلاني لعطر جديد قبل العيد، شكد تحتاج وقت للتصوير والمونتاج؟',
    status: 'CONTACTED',
    notes: 'اتصلت بيه — ينتظر عرض سعر لثلاث نسخ (ريلز + ستوري + ممول).',
    source: 'place:almasa-perfumes',
    daysAgo: 3,
  },
  {
    name: 'سجاد الموسوي',
    phone: '+964 750 998 1122',
    message: 'شكراً على الشغل الرائع بالجم، نريد نجدد العقد لثلاث أشهر جاية.',
    status: 'WON',
    notes: 'تم الاتفاق — عقد 3 أشهر يبدأ من أول الشهر.',
    plan: 0,
    source: 'home',
    daysAgo: 9,
  },
];

/* ───────────────────────────── helpers ───────────────────────────── */

const consoleLog: Log = {
  debug: () => undefined,
  info: (obj, msg) => console.log(`  · ${msg ?? ''}`, Object.keys(obj).length ? JSON.stringify(obj) : ''),
  warn: (obj, msg) => console.warn(`  ! ${msg ?? ''}`, JSON.stringify(obj, (_k, v: unknown) => (v instanceof Error ? v.message : v))),
  error: (obj, msg) => console.error(`  ✖ ${msg ?? ''}`, JSON.stringify(obj, (_k, v: unknown) => (v instanceof Error ? v.message : v))),
};

/** Deterministic PRNG so the demo looks the same on every machine. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (color: string) => `0x${color.replace('#', '')}`;
const rgb = (color: string): [number, number, number] => {
  const n = Number.parseInt(color.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const shade = (color: string, factor: number): string => {
  const [r, g, b] = rgb(color).map((c) => Math.max(0, Math.min(255, Math.round(c * factor)))) as [number, number, number];
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
};

const FONT_CANDIDATES = {
  bold: [
    '/usr/share/fonts/opentype/inter/Inter-Bold.otf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/Library/Fonts/Arial Bold.ttf',
  ],
  regular: [
    '/usr/share/fonts/opentype/inter/Inter-Regular.otf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/Library/Fonts/Arial.ttf',
  ],
};
const findFont = (list: string[]) => list.find((f) => existsSync(f)) ?? null;
const FONTS = { bold: findFont(FONT_CANDIDATES.bold), regular: findFont(FONT_CANDIDATES.regular) };

/** Escapes text for a drawtext `text='…'` value. */
const drawtextEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/%/g, '\\%');

async function ffmpeg(ctx: AppContext, args: string[]): Promise<void> {
  await execFileAsync(ctx.tools.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args], { maxBuffer: 16 * 1024 * 1024 });
}

function sourceFor(look: Look, accent: string, seed: number, seconds: number, size: { w: number; h: number }): { input: string; filters: string[] } {
  const { w, h } = size;
  const [r, g, b] = rgb(accent).map((c) => (c / 255).toFixed(3)) as [string, string, string];
  switch (look) {
    case 'gradient':
      return {
        input: `gradients=s=${w}x${h}:r=30:c0=${hex(accent)}:c1=0x0b0b0e:c2=${hex(shade(accent, 0.45))}:c3=${hex(shade(accent, 1.25))}:n=4:speed=0.025:seed=${seed}:d=${seconds}`,
        filters: ['noise=alls=9:allf=t', 'vignette=PI/4'],
      };
    case 'spiral':
      return {
        input: `gradients=s=${w}x${h}:r=30:c0=${hex(shade(accent, 1.2))}:c1=0x09090b:c2=${hex(accent)}:c3=0x141418:n=4:type=spiral:speed=0.012:seed=${seed}:d=${seconds}`,
        filters: ['gblur=sigma=6', 'noise=alls=8:allf=t', 'vignette=PI/4'],
      };
    case 'fractal':
      return {
        input: `mandelbrot=s=${w / 2}x${h / 2}:r=30:maxiter=250:start_scale=2.5:end_scale=0.4:end_pts=${seconds + 2}:start_x=-0.7436438870371587:start_y=-0.1318259042053120`,
        filters: [
          `scale=${w}:${h}:flags=bicubic`,
          'format=gray',
          'format=rgb24',
          `colorchannelmixer=rr=${r}:rg=${r}:rb=${r}:gr=${g}:gg=${g}:gb=${g}:br=${b}:bg=${b}:bb=${b}`,
          'eq=contrast=1.15:brightness=0.02',
          'noise=alls=7:allf=t',
          'vignette=PI/4',
        ],
      };
    case 'particles':
      return {
        input: `life=s=${w / 4}x${h / 4}:r=30:mold=24:ratio=0.1:seed=${seed}:life_color=${hex(shade(accent, 1.2))}:death_color=0x08080a:mold_color=${hex(shade(accent, 0.35))}`,
        filters: [`scale=${w}:${h}:flags=neighbor`, 'gblur=sigma=4', 'eq=contrast=1.25:saturation=1.2', 'noise=alls=6:allf=t', 'vignette=PI/4'],
      };
  }
}

function overlay(title: string, subtitle: string, accent: string, withTimecode: boolean): string[] {
  if (!FONTS.bold || !FONTS.regular) return [];
  const bold = FONTS.bold;
  const regular = FONTS.regular;
  const filters = [
    'drawbox=x=0:y=ih-300:w=iw:h=300:color=black@0.38:t=fill',
    `drawtext=fontfile=${bold}:text='${drawtextEscape(title)}':fontcolor=white:fontsize=58:x=56:y=h-228`,
    `drawtext=fontfile=${regular}:text='${drawtextEscape(subtitle)}':fontcolor=${hex(accent)}:fontsize=28:x=58:y=h-140`,
    `drawtext=fontfile=${bold}:text='S5Y':fontcolor=white@0.85:fontsize=30:x=56:y=64`,
  ];
  if (withTimecode) {
    filters.push(
      "drawbox=x=iw-300:y=72:w=16:h=16:color=0xff3b30:t=fill:enable='lt(mod(t,1),0.5)'",
      `drawtext=fontfile=${regular}:text='REC %{pts\\:hms}':fontcolor=white@0.8:fontsize=24:x=w-272:y=68`,
    );
  }
  return filters;
}

async function renderVideo(ctx: AppContext, out: string, place: DemoPlace, video: DemoPlace['videos'][number], seed: number): Promise<void> {
  const src = sourceFor(video.look, place.accent, seed, video.seconds, { w: 720, h: 1280 });
  const chord = '0.045*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*0.25*t))+0.035*sin(2*PI*277.18*t)+0.03*sin(2*PI*329.63*t)';
  const build = (withText: boolean) => [
    '-f', 'lavfi', '-i', src.input,
    '-f', 'lavfi', '-i', `aevalsrc=${chord}:s=44100:d=${video.seconds}`,
    '-vf', [...src.filters, ...(withText ? overlay(place.latin, `${video.caption} · ${place.city}`, place.accent, true) : []), 'format=yuv420p'].join(','),
    '-t', String(video.seconds),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-r', '30',
    '-c:a', 'aac', '-b:a', '96k', '-shortest',
    '-movflags', '+faststart',
    out,
  ];
  try {
    await ffmpeg(ctx, build(true));
  } catch {
    await ffmpeg(ctx, build(false)); // ffmpeg without drawtext/freetype
  }
}

async function renderStill(ctx: AppContext, out: string, place: DemoPlace, kind: 'cover' | 'logo'): Promise<void> {
  const initials = place.latin
    .split(/\s+/)
    .filter((w) => !['AL', 'THE'].includes(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('');
  const build = (withText: boolean): string[] => {
    if (kind === 'logo') {
      const text = withText && FONTS.bold
        ? [`drawtext=fontfile=${FONTS.bold}:text='${drawtextEscape(initials)}':fontcolor=${hex(place.accent)}:fontsize=230:x=(w-tw)/2:y=(h-th)/2`]
        : [];
      return ['-f', 'lavfi', '-i', 'color=c=0x0e0e11:s=512x512', '-vf', ['drawbox=x=18:y=18:w=476:h=476:color=' + hex(place.accent) + '@0.9:t=6', ...text].join(','), '-frames:v', '1', out];
    }
    const src = sourceFor('gradient', place.accent, place.year, 3, { w: 1600, h: 1000 });
    const text = withText && FONTS.bold && FONTS.regular
      ? [
          `drawtext=fontfile=${FONTS.bold}:text='${drawtextEscape(place.latin)}':fontcolor=white:fontsize=96:x=90:y=h-250`,
          `drawtext=fontfile=${FONTS.regular}:text='${drawtextEscape(`${place.city} · S5Y`)}':fontcolor=${hex(place.accent)}:fontsize=40:x=94:y=h-130`,
        ]
      : [];
    return ['-f', 'lavfi', '-i', src.input, '-vf', [...src.filters, "select='eq(n,45)'", ...text].join(','), '-frames:v', '1', '-q:v', '2', out];
  };
  try {
    await ffmpeg(ctx, build(true));
  } catch {
    await ffmpeg(ctx, build(false));
  }
}

/* ───────────────────────────── demo create / reset ───────────────────────────── */

async function readDemo(ctx: AppContext): Promise<DemoRecord | null> {
  const row = await ctx.prisma.setting.findUnique({ where: { key: DEMO_KEY } });
  return row ? (row.value as unknown as DemoRecord) : null;
}

async function createDemo(ctx: AppContext): Promise<void> {
  const existing = await readDemo(ctx);
  if (existing) {
    const alive = await ctx.prisma.place.count({ where: { id: { in: existing.placeIds } } });
    if (alive > 0) {
      console.log(`✔ Demo content already exists (${alive} places) — skipping. Use --reset-demo --demo to recreate it.`);
      return;
    }
    await ctx.prisma.setting.delete({ where: { key: DEMO_KEY } });
  }
  if (!ctx.tools.available) {
    throw new Error('ffmpeg/ffprobe with libx264 are required to generate demo videos (set FFMPEG_PATH/FFPROBE_PATH).');
  }
  const taken = await ctx.prisma.place.findMany({ where: { slug: { in: PLACES.map((p) => p.slug) } }, select: { slug: true } });
  if (taken.length > 0) throw new Error(`Demo slugs already used by real places: ${taken.map((p) => p.slug).join(', ')}`);

  const record: DemoRecord = { version: 1, createdAt: new Date().toISOString(), placeIds: [], videoIds: [], planIds: [], inquiryIds: [], pageviews: {} };
  const scratch = path.join(ctx.paths.work, `seed-${randomId(8)}`);
  await fs.mkdir(scratch, { recursive: true });
  const imageDeps = { storage: ctx.storage, tools: ctx.tools, tmpDir: ctx.paths.work };
  const startOrder = ((await ctx.prisma.place.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? -1) + 1;

  try {
    for (const [index, demo] of PLACES.entries()) {
      console.log(`→ ${demo.name} (${demo.slug})`);
      const coverFile = path.join(scratch, `${demo.slug}-cover.jpg`);
      const logoFile = path.join(scratch, `${demo.slug}-logo.png`);
      await renderStill(ctx, coverFile, demo, 'cover');
      await renderStill(ctx, logoFile, demo, 'logo');
      const cover = await storeImage(imageDeps, await fs.readFile(coverFile));
      const logo = await storeImage(imageDeps, await fs.readFile(logoFile));

      const place = await ctx.prisma.place.create({
        data: {
          name: demo.name,
          slug: demo.slug,
          category: demo.category,
          location: demo.location,
          summary: demo.summary,
          description: demo.description,
          coverKey: cover.key,
          logoKey: logo.key,
          accentColor: demo.accent,
          instagram: demo.instagram,
          website: null,
          year: demo.year,
          services: demo.services,
          featured: demo.featured,
          published: true,
          sortOrder: startOrder + index,
        },
      });
      record.placeIds.push(place.id);
      // Persist progress so an interrupted seed can still be reset.
      await saveDemo(ctx, record);

      for (const [vIndex, v] of demo.videos.entries()) {
        const file = path.join(scratch, `${demo.slug}-${vIndex}.mp4`);
        await renderVideo(ctx, file, demo, v, index * 10 + vIndex + 1);
        const size = (await fs.stat(file)).size;
        const row = await ctx.prisma.video.create({
          data: {
            placeId: place.id,
            title: v.title,
            status: 'PROCESSING',
            originalName: `${demo.slug}-${vIndex + 1}.mp4`,
            mimeType: 'video/mp4',
            sizeBytes: size,
            uploadedBytes: size,
            featured: v.featured ?? false,
            published: true,
            sortOrder: vIndex,
          },
        });
        record.videoIds.push(row.id);
        const sourceKey = videoKeys(row.id).source('mp4');
        await ctx.storage.putFile(sourceKey, file, { contentType: 'video/mp4', move: true });
        await ctx.prisma.video.update({ where: { id: row.id }, data: { sourceKey } });
        await processVideo(
          { prisma: ctx.prisma, storage: ctx.storage, tools: ctx.tools, workDir: ctx.paths.work, log: consoleLog },
          row.id,
          new AbortController().signal,
        );
        const done = await ctx.prisma.video.findUniqueOrThrow({ where: { id: row.id } });
        console.log(`   ${done.status === 'READY' ? '✔' : '✖'} ${v.title} — ${done.width}x${done.height}, ${done.durationSec?.toFixed(1)}s${done.processingError ? ` (${done.processingError})` : ''}`);
      }
      await saveDemo(ctx, record);
    }

    const planOrder = ((await ctx.prisma.plan.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? -1) + 1;
    for (const [i, p] of PLANS.entries()) {
      const plan = await ctx.prisma.plan.create({ data: { ...p, currency: 'IQD', active: true, sortOrder: planOrder + i } });
      record.planIds.push(plan.id);
    }

    for (const q of INQUIRIES) {
      const createdAt = new Date(Date.now() - q.daysAgo * 24 * 3600_000 - 2 * 3600_000);
      const inquiry = await ctx.prisma.inquiry.create({
        data: {
          name: q.name,
          phone: q.phone ?? null,
          email: q.email ?? null,
          message: q.message,
          status: q.status,
          notes: q.notes ?? null,
          planId: q.plan !== undefined ? (record.planIds[q.plan] ?? null) : null,
          source: q.source,
          createdAt,
        },
      });
      record.inquiryIds.push(inquiry.id);
    }

    await seedStats(ctx, record);
    await saveDemo(ctx, record);
    console.log(
      `✔ Demo ready: ${record.placeIds.length} places, ${record.videoIds.length} videos, ${record.planIds.length} plans (plans section stays off), ${record.inquiryIds.length} inquiries.`,
    );
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

async function saveDemo(ctx: AppContext, record: DemoRecord): Promise<void> {
  const value = record as unknown as Prisma.InputJsonValue;
  await ctx.prisma.setting.upsert({ where: { key: DEMO_KEY }, create: { key: DEMO_KEY, value }, update: { value } });
}

/** 30 days of believable traffic so the dashboard charts aren't empty. */
async function seedStats(ctx: AppContext, record: DemoRecord): Promise<void> {
  const random = mulberry32(2026);
  const playsByVideo = new Map<string, number>();
  for (let d = 29; d >= 0; d--) {
    const day = utcDay(new Date(Date.now() - d * 24 * 3600_000));
    const trend = 1 + (29 - d) / 40;
    const weekend = [4, 5].includes(new Date(`${day}T00:00:00Z`).getUTCDay()) ? 1.3 : 1;
    const pageviews = Math.round((70 + random() * 90) * trend * weekend);
    record.pageviews[day] = pageviews;
    await ctx.stats.increment('pageview', '', pageviews, day);
    for (const placeId of record.placeIds) {
      const views = Math.round(random() * pageviews * 0.18);
      if (views > 0) await ctx.stats.increment('place_view', placeId, views, day);
    }
    for (const videoId of record.videoIds) {
      const plays = Math.round(random() * random() * 22 * trend);
      if (plays > 0) {
        await ctx.stats.increment('play', videoId, plays, day);
        playsByVideo.set(videoId, (playsByVideo.get(videoId) ?? 0) + plays);
      }
    }
  }
  for (const [id, plays] of playsByVideo) await ctx.prisma.video.update({ where: { id }, data: { plays: { increment: plays } } });
}

async function resetDemo(ctx: AppContext): Promise<void> {
  const record = await readDemo(ctx);
  if (!record) {
    console.log('✔ No demo content to remove.');
    return;
  }
  const places = await ctx.prisma.place.findMany({
    where: { id: { in: record.placeIds } },
    include: { videos: { select: { id: true, posterKey: true } } },
  });
  const videoIds = new Set([...record.videoIds, ...places.flatMap((p) => p.videos.map((v) => v.id))]);
  await ctx.prisma.place.deleteMany({ where: { id: { in: record.placeIds } } });
  for (const place of places) {
    for (const v of place.videos) await ctx.files.deleteVideoFiles(v);
    await ctx.files.releaseImages([place.coverKey, place.logoKey]);
  }
  await ctx.prisma.inquiry.deleteMany({ where: { id: { in: record.inquiryIds } } });
  await ctx.prisma.plan.deleteMany({ where: { id: { in: record.planIds } } });
  await ctx.prisma.dailyStat.deleteMany({ where: { refId: { in: [...record.placeIds, ...videoIds] } } });
  for (const [day, count] of Object.entries(record.pageviews)) {
    await ctx.prisma.dailyStat.updateMany({
      where: { date: new Date(`${day}T00:00:00Z`), metric: 'pageview', refId: '' },
      data: { count: { decrement: count } },
    });
  }
  await ctx.prisma.dailyStat.deleteMany({ where: { count: { lte: 0 } } });
  await ctx.settings.update((s) => {
    const kept = s.hero.videoIds.filter((id) => !videoIds.has(id));
    return kept.length === s.hero.videoIds.length ? null : { ...s, hero: { videoIds: kept } };
  });
  await ctx.prisma.setting.delete({ where: { key: DEMO_KEY } });
  console.log(`✔ Removed demo content (${places.length} places, ${videoIds.size} videos, ${record.planIds.length} plans, ${record.inquiryIds.length} inquiries).`);
}

/* ───────────────────────────── main ───────────────────────────── */

async function main(): Promise<void> {
  loadEnvFile();
  const { values } = parseArgs({
    options: { demo: { type: 'boolean', default: false }, 'reset-demo': { type: 'boolean', default: false } },
    strict: true,
  });
  const config = loadConfig();
  for (const warning of config.warnings) console.warn(`! ${warning}`);
  const ctx = await createContext({ config, log: consoleLog });
  try {
    await ctx.storage.init?.(consoleLog);
    await ctx.settings.ensure();
    console.log('✔ Site settings ensured.');
    const owner = await ctx.auth.ensureInitialOwner(config.admin);
    if (owner) console.log(`✔ Created owner account ${owner.email}.`);
    else if (!config.admin.email) console.log('ℹ ADMIN_EMAIL/ADMIN_PASSWORD not set — run `npm run create-admin` to create the owner.');
    else console.log('✔ Owner account already exists.');

    if (values['reset-demo']) await resetDemo(ctx);
    if (values.demo) {
      if (config.isProduction) console.warn('! Creating demo content in a production environment.');
      await createDemo(ctx);
    }
  } finally {
    await ctx.dispose();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
});
