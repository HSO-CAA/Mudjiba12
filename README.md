# S5Y — بورتفوليو ثلاثي الأبعاد + لوحة تحكم + باك اند

موقع شخصي احترافي لـ **S5Y** ([@s5y](https://instagram.com/s5y)) — صانع محتوى وتصوير ومونتاج.

- 🎬 **موقع 3D واقعي**: ستوديو سينمائي، وعدسة كاميرا واقعية، وشاشات تعرض فيديوهاتك الحقيقية وانعكاسها على أرضية لمّاعة.
- 🗂️ **صفحة خاصة لكل مكان اشتغلت وياه**، وبيها كل فيديوهاته.
- 🔒 **لوحة تحكم مخفية تماماً عن البورتفوليو**: مالها أي رابط بالموقع، وعلى عنوان سري إنت تختاره.
- ⬆️ **رفع فيديوهات كبيرة** (لحد 2GB) على قطع، وإذا انقطع النت يكمل من نفس المكان. والسيرفر يجهّز الفيديو تلقائياً للويب: ضغط، ومعاينة قصيرة، وصورة غلاف. فيديوهات الآيفون (HEVC / ‎.MOV) تتحول تلقائياً.
- 💳 **باقات اشتراك جاهزة**: تسويها من لوحة التحكم وتظهرها بالموقع بضغطة زر من تريد.
- 📩 **رسائل وطلبات الزبائن** توصلك على لوحة التحكم، وتگدر تتابع حالة كل طلب.
- 📊 **إحصائيات**: زيارات الموقع، ومشاهدات كل فيديو، وأكثر الأماكن مشاهدة.

---

## هيكل المشروع

```
apps/
  api/      الباك اند — Fastify + Prisma + PostgreSQL (رفع ومعالجة الفيديو، الحماية، تقديم الموقع)
  web/      البورتفوليو — React + Three.js (React Three Fiber) + Tailwind
  admin/    لوحة التحكم — React (تطبيق منفصل كلياً عن الموقع)
packages/
  shared/   أنواع TypeScript المشتركة (عقد الـ API)
docs/
  CONTRACT.md   توثيق كل الـ API
  DESIGN.md     اتجاه التصميم
deploy/      ملفات النشر: Caddy للـ HTTPS، وسكربت تشغيل الحاوية، وفحص سريع (smoke-test.mjs)
```

## التشغيل على جهازك (للتطوير)

تحتاج: **Node.js 22** و**PostgreSQL 16** و**ffmpeg** (اختياري، بس ضروري حتى تتجهز الفيديوهات تلقائياً).

```bash
npm install
cp apps/api/.env.example apps/api/.env      # عدّل DATABASE_URL وبيانات حساب المدير (ADMIN_EMAIL و ADMIN_PASSWORD)
npm run db:migrate                           # ينشئ جداول قاعدة البيانات
npm run db:seed -- --demo                    # (اختياري) محتوى تجريبي حتى تشوف الموقع شلون يطلع (ياخذ ~4 دقايق، يحتاج ffmpeg)
npm run dev
```

- الموقع: http://localhost:5173
- لوحة التحكم: http://localhost:5174
- الـ API: http://localhost:4000

تريد تستخدم **Supabase** (قاعدة البيانات والتخزين على الإنترنت)؟ شوف قسم [Supabase](#supabase) تحت — المفاتيح تنحط بملف `.env.local` (مخفي عن git).

تريد تجرب نسخة الإنتاج على جهازك؟ `npm run build` وبعدين `npm start` ← الموقع على http://localhost:4000 ولوحة التحكم على http://localhost:4000/studio

## النشر على سيرفر (الطريقة الموصى بيها)

أي سيرفر VPS بيه Docker و Docker Compose (مثل Hetzner أو DigitalOcean أو Contabo). يفضّل **2GB رام على الأقل** (4GB أحسن لمعالجة الفيديو).

```bash
git clone -b claude/hopeful-galileo-vb3plm https://github.com/HSO-CAA/Mudjiba12.git s5y
cd s5y
cp .env.example .env        # عبّي الإعدادات: كلمة سر قاعدة البيانات، الدومين، عنوان لوحة التحكم، حسابك
docker compose up -d --build
```

- أول مرة البناء ياخذ كم دقيقة. تتأكد إنه اشتغل: `docker compose ps` (لازم تشوف `healthy`).
- الموقع يشتغل على `http://IP-السيرفر:4000`.
  ملاحظة: على http عادي (بدون HTTPS) لازم `COOKIE_SECURE=false` بملف `.env` حتى تگدر تسجل دخول. لمن تشغّل HTTPS رجّعها `true`.
- **HTTPS تلقائي على دومينك**: وجّه الدومين (سجل A لـ `@` و `www`) على IP السيرفر، وافتح البورتات 80 و443، وبعدين شغّل:
  ```bash
  docker compose --profile https up -d
  ```
  بعدها تگدر تخلي `APP_BIND=127.0.0.1` بملف `.env` (وتعيد `docker compose --profile https up -d`) حتى يتسكر بورت 4000 عن الإنترنت.
- **لوحة التحكم** على العنوان السري اللي حددته بـ `ADMIN_PATH`، مثلاً `https://yourdomain.com/studio-k39x`.
- الفيديوهات وقاعدة البيانات محفوظة بـ Docker volumes (`s5y_media` و`s5y_pgdata`)، وما تنمسح لمن تحدّث الموقع أو تعيد تشغيله.
- **أي تعديل بملف `.env`** يحتاج `docker compose up -d` (أو `docker compose --profile https up -d` إذا مشغّل HTTPS) — أمر `restart` وحده ما يقرا التعديلات.

### أول تشغيل ✅

1. **عنوان لوحة التحكم السري**: غيّر `ADMIN_PATH` من `/studio` لشي محد يخمّنه، مثل `/studio-k39x` (حروف إنگليزية وأرقام و`-` بس). لا تنشره بأي مكان.
2. **كلمة سر قوية**: اكتب `ADMIN_PASSWORD` (10 أحرف على الأقل) و`ADMIN_EMAIL`. الحساب ينسوى **بأول تشغيل بس** — تغييرها بعدين بالملف ما يغيّر شي (شوف «نسيت كلمة السر» تحت). وبعد أول تشغيل ناجح تگدر تمسح `ADMIN_PASSWORD` من الملف للأمان. وكلمة سر قاعدة البيانات `POSTGRES_PASSWORD` حروف وأرقام بس.
3. **عنوان موقعك**: خلّي `PUBLIC_URL=https://yourdomain.com` و`DOMAIN=yourdomain.com` (يستخدم لروابط المشاركة والـ SEO).
4. شغّل `docker compose --profile https up -d --build`، وافتح `https://yourdomain.com/عنوانك-السري` وسجّل دخول.
5. من **الإعدادات**: اسمك، والنبذة، والصورة، والواتساب، والسوشيال.
6. **ارفع أول مكان**: الأماكن ← «مكان جديد» ← ارفع فيديوهاته ← علّم الحلوين «مميز» ← فعّل «منشور». وافتح موقعك تشوفه.
7. سوّ **نسخة احتياطية** (تحت) وخليها بمكان آمن.

### التحديث

```bash
git pull && docker compose up -d --build
docker image prune -f        # يمسح النسخ القديمة من الصورة حتى ما تتعبى مساحة السيرفر
```

(إذا مشغّل HTTPS: `docker compose --profile https up -d --build`.) قاعدة البيانات تتحدث تلقائياً عند التشغيل.

### نسخة احتياطية

```bash
# قاعدة البيانات
docker compose exec -T db pg_dump -U s5y --clean --if-exists s5y > backup.sql
# الفيديوهات والصور
docker run --rm -v s5y_media:/data -v "$PWD":/backup postgres:16-alpine tar czf /backup/media.tgz -C /data .
```

### الاسترجاع من نسخة احتياطية

```bash
docker compose up -d          # (على سيرفر جديد: يسوي قاعدة البيانات والـ volumes أول مرة)
docker compose stop app
docker compose exec -T db psql -q -U s5y -d s5y < backup.sql
docker run --rm -v s5y_media:/data -v "$PWD":/backup postgres:16-alpine tar xzf /backup/media.tgz -C /data
docker compose up -d
```

(على السيرفر الجديد خلّي نفس `POSTGRES_PASSWORD` أو أي كلمة جديدة — المهم تكون بملف `.env` قبل أول تشغيل.)

### تخزين الفيديوهات على Cloudflare R2 أو S3 (اختياري)

إذا عندك فيديوهات هواية، تگدر تحطها على R2 (أرخص وأسرع). خلّي `STORAGE_DRIVER=s3` وعبّي متغيرات `S3_*` بملف `.env`
(`S3_BUCKET` و`S3_PUBLIC_URL` ضروريات)، وبعدين `docker compose up -d`. الرفع يبقى يمر من السيرفر (هو يرفعها للـ bucket).

ولازم تفعّل **CORS** على الـ bucket للدومين مالتك، حتى الفيديوهات تشتغل داخل مشهد الـ 3D وتگدر تختار صورة الغلاف من الفيديو بلوحة التحكم.
بـ R2: الـ bucket ← Settings ← CORS Policy:

```json
[
  {
    "AllowedOrigins": ["https://yourdomain.com"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range"],
    "ExposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges", "ETag"],
    "MaxAgeSeconds": 86400
  }
]
```

## Supabase

[Supabase](https://supabase.com) يگدر يشيل عنك شغلتين: **قاعدة البيانات** (بدل PostgreSQL على جهازك أو السيرفر) و**تخزين الفيديوهات والصور** (بدل قرص السيرفر). تگدر تستخدم وحدة منهن أو الثنتين.

### تحتاج 3 أشياء من صفحة مشروعك بـ Supabase

| شنو | وين تلگاه | سري؟ |
|---|---|---|
| ① رابط المشروع `SUPABASE_URL` | Project Settings ← Data API ← Project URL. عندك: `https://dkfflmtmggjuttdrrgcs.supabase.co` ✓ | لا، عادي |
| ② المفتاح السري `SUPABASE_SERVICE_ROLE_KEY` | Project Settings ← **API Keys** ← تبويب «Legacy API Keys» ← `service_role` ← Reveal (يبدأ بـ `eyJ…`). أو تسوي **Secret key** جديد (يبدأ بـ `sb_secret_…`) | ⚠️ **سري جداً** |
| ③ رابط قاعدة البيانات `DATABASE_URL` | زر **Connect** (فوق بالصفحة) ← **Session pooler** ← انسخ الرابط، وبدّل `[YOUR-PASSWORD]` بكلمة سر قاعدة البيانات | ⚠️ **سري** (بيه كلمة السر) |

- مفتاح **anon** (المفتاح العام اللي عندك) **السيرفر ما يحتاجه** — ما يگدر يرفع ملفات. وإذا حطيته بمكان `SUPABASE_SERVICE_ROLE_KEY` السيرفر يوقف ويگلك بالضبط شنو تحط بداله.
- كلمة سر قاعدة البيانات هي اللي اخترتها لمن سويت المشروع. نسيتها؟ Project Settings ← Database ← Reset database password (خليها حروف وأرقام بس، بدون رموز مثل `@ # / ?`).
- استخدم **Session pooler** (بورت `5432`)، مو Transaction pooler (بورت `6543`، ما يمشي وياه تحديث الجداول) ولا Direct connection (يحتاج IPv6 وأغلب الشبكات ما عدها).
- الـ **bucket** (مكان الفيديوهات والصور) **ينسوى تلقائياً** باسم `media` وبوضع public أول ما يشتغل السيرفر — ما تحتاج تسوي شي بصفحة Storage، ولا تحتاج تضبط CORS.

### على جهازك (ملف `.env.local`)

```bash
cp -n .env.local.example .env.local  # بجذر المشروع (إذا الملف موجود عندك ما ينكتب فوقه) — افتحه وعبّي المفتاح السري، وشيل # من سطر DATABASE_URL وحط كلمة السر
npm run db:deploy                    # يسوي جداول قاعدة البيانات على Supabase (مرة وحدة، وبعد كل تحديث للمشروع)
npm run create-admin -- --email you@example.com --password "كلمة-سر-قوية"   # حساب المدير (أول مرة)
npm run dev                          # أو نسخة الإنتاج: npm run build && npm start
```

- ملف `.env.local` **مخفي عن git** (ما ينرفع على GitHub أبداً)، فهو المكان الصح للمفاتيح على جهازك. السيرفر يقرا الملفات بهالترتيب والأول يغلب: `apps/api/.env.local` ← `.env.local` (جذر المشروع) ← `apps/api/.env`.
- تتأكد إنه اشتغل: بسجل السيرفر تطلع `media storage: Supabase Storage` و`"storage":"supabase"`. وإذا بس الرابط موجود بدون المفتاح السري، يطلع تنبيه والفيديوهات تنحفظ على جهازك.

### على السيرفر (Docker)

بملف `.env` (جنب `docker-compose.yml`) ضيف — ونفس القواعد: هذا الملف ما ينرفع:

```
SUPABASE_URL=https://dkfflmtmggjuttdrrgcs.supabase.co
SUPABASE_SERVICE_ROLE_KEY=المفتاح-السري
SUPABASE_STORAGE_BUCKET=media
# اختياري: قاعدة بيانات Supabase بدل اللي على السيرفر
DATABASE_URL=رابط-Session-pooler-مع-كلمة-السر
```

وبعدين `docker compose up -d` (أو `docker compose --profile https up -d`). الجداول تتحدث تلقائياً عند التشغيل.
(إذا حطيت `DATABASE_URL`، حاوية قاعدة البيانات المحلية `db` تبقى شغّالة بس ما تنستخدم — خلّي `POSTGRES_PASSWORD` مثل ما هو.)

الفيديو الأصلي اللي ترفعه يبقى على السيرفر لحد ما يتجهز وبعدين ينمسح: السيرفر يرفع لـ Supabase بس النسخة الجاهزة للويب والمعاينة والغلاف. هيچ يوفر نت، وفيديوهات الموبايل الكبيرة تمر حتى لو أكبر من حد الخطة.

### حدود الخطة المجانية (Free)

- **50MB لكل ملف**: الفيديو *بعد* التجهيز لازم يكون أقل من 50MB (تقريباً دقيقة ونص لدقيقتين بدقة 1080p، حسب الفيديو). السيرفر يحاول يصغّره تلقائياً، وإذا بقى أكبر يطلع جنبه «فشل» ويگلك السبب — قصّره، أو رقّي الخطة وكبّر الحد من Storage ← Settings، وبعدين اضغط «إعادة المعالجة».
- **المشروع يتوقف (Paused)** إذا ما صار عليه نشاط حوالي أسبوع: الفيديوهات ما تطلع وقاعدة البيانات توقف. الحل: ادخل Supabase واضغط **Restore** على المشروع.
- المساحة وكمية النقل الشهرية محدودة — تابعها من صفحة **Usage** بـ Supabase.

### قواعد الأمان ⚠️

- `SUPABASE_SERVICE_ROLE_KEY` وكلمة سر قاعدة البيانات **أسرار**: لا ترفعهن على GitHub (المشروع **عام** والكل يگدر يشوفه)، لا تحطهن بكود الموقع أو لوحة التحكم، ولا ترسلهن لأحد أو تنشرهن بصورة شاشة.
- مكانهن بس: `.env.local` على جهازك و`.env` على السيرفر (الثنين مخفيين عن git).
- إذا انكشف المفتاح: غيّره فوراً من Project Settings ← API Keys، وغيّر كلمة سر قاعدة البيانات من Project Settings ← Database، وحدّث `.env`.
- الموقع نفسه ما يحچي ويا Supabase مباشرة — كلشي يمر من السيرفر، وجداول قاعدة البيانات مقفولة عن الـ API العام مال Supabase (Row Level Security).

## استخدام لوحة التحكم

1. **الأماكن** ← «مكان جديد»: الاسم، والتصنيف، والموقع، ولون المكان، وصورة الغلاف واللوگو.
2. داخل صفحة المكان: اسحب الفيديوهات أو اختارها من الگاليري (تگدر ترفع من الموبايل). تشوف التقدم وتگدر توقف وتكمل الرفع، والسيرفر يجهز الفيديو تلقائياً.
3. رتّب الأماكن والفيديوهات بالسحب. علّم فيديو كـ«مميز» حتى يطلع بشاشات الـ 3D وبالشوريل.
4. **الإعدادات**: اسمك، والنبذة، والصورة، والأرقام، والواتساب، والسوشيال، واختيار فيديوهات الواجهة، وإعدادات SEO.
5. **الباقات**: سوّي باقاتك وأسعارها، ولمن تكون جاهز فعّل «اعرض الباقات بالموقع».
6. **الرسائل**: كل طلب يوصلك من الموقع، وتگدر تحدّث حالته وتراسل الزبون واتساب مباشرة.
7. **الحساب**: تغيّر كلمة السر من داخل اللوحة.

## الحماية

- جلسات تسجيل دخول آمنة (كوكي httpOnly + SameSite=Strict)، وكلمات السر مشفّرة بـ scrypt.
- قفل الحساب بعد محاولات دخول فاشلة، وتحديد عدد الطلبات (Rate limiting).
- حماية CSRF، وCSP صارم، وHelmet.
- لوحة التحكم مخفية: ما موجودة بـ robots.txt ولا بالـ sitemap ولا بكود الموقع، ومعلّمة `noindex`.
- السيرفر يشتغل بمستخدم عادي (مو root) داخل الحاوية.
- الأسرار (كلمات السر ومفتاح Supabase السري) بس بملفات `.env` / `.env.local` المخفية عن git — أبداً مو بالكود ولا على GitHub.
- لإعادة تعيين كلمة السر من السيرفر (يفتح الحساب إذا انقفل، ويطلّع كل الجلسات):
  ```bash
  docker compose exec app node dist/scripts/create-admin.js --email you@example.com --password "NewStrongPass"
  ```
  (على جهازك بالتطوير: `npm run create-admin -- --email … --password …`)

## حل المشاكل

| المشكلة | الحل |
|---|---|
| الموقع ما يفتح | `docker compose ps` و`docker compose logs --tail 100 app`. إذا شفت `Invalid environment configuration` فالسطر اللي بعده يگلك شنو الناقص بملف `.env` (مثلاً `ADMIN_PASSWORD` أقصر من 10 أحرف). صلّحه وبعدين `docker compose up -d`. |
| فيديو عالق على «قيد المعالجة» (PROCESSING) | الفيديو الطويل أو 4K ياخذ دقايق. تابع: `docker compose logs -f app`. تأكد من ffmpeg: `docker compose exec app ffmpeg -version`، و`curl -s http://localhost:4000/api/health` لازم يطلع `"ffmpeg":true`. بعدها اضغط «إعادة المعالجة» على الفيديو. إذا صار «فشل» تطلع جنبه سبب المشكلة. |
| فيديوهات الآيفون (HEVC / ‎.MOV) | ما تحتاج تسوي شي: السيرفر يحولها تلقائياً لـ MP4 (H.264) حتى تشتغل على كل الأجهزة. التحويل ياخذ وقت أكثر شوية. |
| نسيت كلمة السر / انقفل الحساب | الأمر `create-admin` فوق (قسم الحماية). |
| ما يقبل تسجيل الدخول على `http://IP:4000` | خلّي `COOKIE_SECURE=false` بـ `.env` وبعدين `docker compose up -d`. ومع HTTPS رجّعها `true`. |
| عدّلت `.env` وما تغيّر شي | لازم `docker compose up -d` مو `restart`. |
| HTTPS ما يشتغل | تأكد الدومين موجّه على IP السيرفر والبورتات 80 و443 مفتوحة، وشوف `docker compose logs caddy`. |
| الفيديوهات ما تشتغل بمشهد الـ 3D (مع R2/S3) | فعّل CORS على الـ bucket (فوق). |
| يطلع `this is the public anon key` | حطيت مفتاح anon بمكان المفتاح السري. انسخ `service_role` (أو Secret key) من Project Settings ← API Keys. |
| يطلع `still contains a placeholder like [YOUR-PASSWORD]` | بدّل `[YOUR-PASSWORD]` (و`[REGION]` إذا موجود) برابط قاعدة البيانات بالقيمة الحقيقية. |
| `npm run db:deploy` يطلع `P1001` (Can't reach database) | استخدم رابط **Session pooler** (بورت 5432) وتأكد من كلمة السر، وإن المشروع مو موقوف. |
| يطلع `cannot reach Supabase Storage` أو الفيديوهات ما تطلع | يمكن مشروع Supabase موقوف (Paused): ادخل Supabase واضغط Restore. وتأكد من `SUPABASE_URL`. |
| فيديو «فشل» وجنبه «أكبر من الحد المسموح بخطة Supabase» | قصّر الفيديو أو رقّي الخطة، وبعدين «إعادة المعالجة». |
| مساحة السيرفر قربت تخلص | `docker system df` و`docker image prune -f`. (اللوگات تتدوّر تلقائياً وما تكبر.) |

فحص سريع لكل شي (للمطوّر): `SMOKE_EMAIL=you@example.com SMOKE_PASSWORD='…' SMOKE_ADMIN_PATH=/studio-k39x node deploy/smoke-test.mjs`
(يحتاج Node 22 و ffmpeg على الجهاز اللي تشغّله منه — يسوي مكان تجريبي، يرفع صورة وفيديو، يتأكد إنه جهز، وبعدين يمسحه).

## التقنيات

React 19 · Three.js · React Three Fiber · Drei · Postprocessing · Motion · Lenis · Tailwind CSS 4 · Vite ·
Fastify 5 · Prisma · PostgreSQL · ffmpeg · Docker · Caddy

راجع [`docs/CONTRACT.md`](docs/CONTRACT.md) لتوثيق الـ API الكامل.
