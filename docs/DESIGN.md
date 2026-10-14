# S5Y — Design direction

Owner: **S5Y** (Instagram `@s5y`) — an Iraqi content creator / videographer who shoots and edits
reels for places (restaurants, cafés, gyms, shops, brands). Audience: business owners in Iraq
deciding whether to hire him. Language: **Arabic first, RTL** (`<html lang="ar" dir="rtl">`).
Everything textual on the site is editable from the dashboard — never hard-code personal content
outside the default settings.

## Concept — "Through the lens"
The whole portfolio feels like looking through a cinema camera: a **realistic 3D studio** behind a
thin **viewfinder HUD**. Physical, premium, cinematic — not a generic "dark SaaS" template.

### Visual language
- **Palette** (CSS custom properties; accent comes from `site.brand.accent`):
  - `--bg #060607` (near-black, slightly warm), `--surface #0e0e11`, `--surface-2 #16161a`
  - `--line rgba(255,255,255,.08)`, `--text #f3f0ea` (warm off-white), `--muted #8f8b84`
  - `--accent #e9b35f` (warm tungsten amber, overridable), `--rec #ff3b30` (REC dot only)
- **Type**: display = **Alexandria Variable** (heavy weights 700–900 for big Arabic headlines,
  tight leading ~1.05); text = **IBM Plex Sans Arabic** (400/500/600); HUD labels / numbers /
  timecodes = **JetBrains Mono Variable** (small, uppercase Latin, letter-spaced, `dir="ltr"`).
  Fonts are self-hosted via `@fontsource*` packages (already installed). Arabic text must never
  be letter-spaced.
- **HUD motif** (use with restraint): viewfinder corner brackets around key frames, a blinking
  REC dot + running timecode `00:00:12:08` in the hero corner, tiny camera readouts
  (`4K · 24FPS · ISO 800 · ƒ/1.8`), frame counters on section labels (`01 / 05`), safe-area guides
  that fade in on hover. Thin 1px lines, never heavy chrome.
- **Motion**: cinematic easing (`cubic-bezier(.16,1,.3,1)`), staggered line reveals for headlines,
  smooth scroll (Lenis), magnetic primary buttons, cursor-follow light. Everything honours
  `prefers-reduced-motion` (no smooth scroll, no parallax, static 3D frame).
- Film grain overlay (very subtle animated noise) + vignette on the 3D layer.

## Public site (apps/web)

### Home `/`
1. **Hero — the 3D studio** (React Three Fiber, full viewport, the showpiece; must look *real*):
   - Dark studio space with a **glossy reflective floor** (`MeshReflectorMaterial`, blurred,
     subtle roughness variation), fog fading to `--bg`.
   - Centre: a **photoreal cinema lens** built procedurally (lathe/cylinder geometry): anodised
     black metal barrel with knurled focus/zoom rings (real geometric ridges), engraved white
     distance scale & `S5Y 35mm ƒ/1.4` text (CanvasTexture), an accent-coloured ring, and a deep
     multi-element front glass with coating reflections (`MeshPhysicalMaterial` with
     `iridescence`, clearcoat, transmission on capable GPUs). It slowly turns to follow the
     pointer.
   - Behind it, a gentle arc of **vertical 9:16 "phone" screens** (rounded aluminium/titanium
     frames, glass) **playing the owner's real videos** as `VideoTexture`s (`previewUrl` first,
     muted, loop, `playsInline`, `crossOrigin="anonymous"`). Screens emit light: their colours
     bleed into the floor reflection. With no videos yet, screens show an elegant animated
     shader placeholder (no broken state).
   - Studio lighting via drei `Environment` built from `Lightformer`s (softboxes, rim strips) —
     **no external HDRI downloads**. ACES/AgX tone mapping, sRGB.
   - Post-processing: subtle Bloom, Vignette, film Noise, optional DepthOfField on high tier.
   - Intro: camera dolly-in from darkness as the site loads (with a minimal loader showing a
     focus-pull / percentage). Scroll: the camera pushes **into the lens** while HTML content
     takes over (the "through the lens" transition).
   - Overlay HTML: big Arabic headline `site.brand.name` + `title` + `tagline`, primary CTA
     "شوف الشغل" (scroll to work) and secondary "تواصل" (WhatsApp/contact), HUD corners.
   - Performance tiers: detect GPU/mobile (`PerformanceMonitor`, `AdaptiveDpr`, dpr ≤ 1.75).
     Low tier: no transmission, low-res reflector, ≤ 3 video textures (rest posters), no DOF.
     Pause the render loop when the hero is off-screen (`frameloop="demand"` / visibility).
     WebGL unavailable → a static, still-beautiful fallback (poster collage + gradient).
2. **Marquee** — infinite strip of place names/logos ("اشتغلت ويا").
3. **Work / الأماكن** — the places grid. Large cinematic cards (cover image, logo, name,
   category, location, video count, accent glow). Hover/tap: card tilts in 3D (pointer-driven
   perspective), the first preview video fades in and plays muted. Click → `/work/:slug` with a
   smooth page transition.
4. **Showreel** — horizontally scrolling row of featured vertical videos (scroll-snap, drag),
   each autoplaying muted when in view; click opens the player.
5. **About** — avatar inside viewfinder brackets, heading, body, location, years since,
   animated stat counters (`site.stats`).
6. **Plans** (only when `site.sections.plans` is true and plans exist) — premium pricing cards,
   highlighted plan glows in accent; price formatted per currency (IQD with Arabic thousands
   separators, "حسب الطلب" when null); period labels (شهري / كل 3 أشهر / سنوي / مرة وحدة);
   CTA opens the contact form pre-selected with that plan.
7. **Contact** — form (`InquiryInput` incl. hidden honeypot `website`), WhatsApp button
   (`https://wa.me/<number>`), Instagram link, success state. Then footer: handle, socials,
   © year. **No admin link anywhere.**

### Place page `/work/:slug`
- Hero: cover image with accent tint, logo, name, category, location, year, services chips,
  summary/description, Instagram/website links.
- **3D reel carousel**: the place's videos as vertical screens on a slowly rotating cylinder
  (drag / wheel / arrows to rotate, click to open). Same realism (reflective floor, lightformers).
  On low tier → a 2D swipe carousel.
- Below: a responsive grid of all videos (posters, duration badge, hover preview).
- Prev / next place navigation; back to all work.
- 404 page for unknown slugs (on-brand, "المشهد مو موجود").

### Video player (modal)
Custom, vertical-aware (fits 9:16 and 16:9), poster first, play/pause, scrub bar with buffered
range, time, mute, fullscreen, keyboard (Space, ←/→ seek, ↑/↓ next/prev, Esc close), swipe on
mobile, next/prev within the current list, sends a `play` track event once per video per session.
Uses `url` (full quality) — never the preview file.

### Technical requirements
- React 19, react-router 7 (library mode, `BrowserRouter`), @tanstack/react-query, Tailwind v4
  (`@tailwindcss/vite`), motion (`motion/react`), lenis, three / @react-three/fiber /
  @react-three/drei / @react-three/postprocessing — all already installed. Do not add deps.
- Route-level code splitting; the R3F scenes are lazy chunks so text content paints first.
- SEO: semantic HTML, `document.title` per route, keep `<!--s5y-head-->` placeholder in
  `index.html` `<head>` (server injects meta tags there).
- Accessibility: focus styles, aria labels on icon buttons, alt text, sufficient contrast,
  keyboard-operable carousel/player, `prefers-reduced-motion`.
- Analytics: `POST /api/public/track` pageview per route change and play per video (dedupe
  with sessionStorage, ignore failures, use `navigator.sendBeacon` when available — send JSON as
  a `Blob` with type `application/json`).
- Mobile first: must look great at 360–430 px wide (most visitors are on phones from Instagram).

## Admin dashboard (apps/admin)
Owner uploads from his **phone** a lot → fully responsive, touch-friendly.
- Look: calm, professional dark UI (Linear/Vercel-grade), same palette and accent, IBM Plex
  Sans Arabic, RTL, mono for numbers/sizes. Collapsible sidebar on desktop, bottom/drawer nav on
  mobile. Skeleton loaders, empty states with clear CTAs, toasts (sonner), confirm dialogs for
  destructive actions.
- `<meta name="robots" content="noindex,nofollow">`, keep `<!--s5y-admin-head-->` placeholder in
  `index.html` `<head>`.
- Pages:
  - **تسجيل الدخول** — email + password, errors (wrong creds / locked / rate limited).
  - **نظرة عامة** — KPI tiles (places, videos, plays, views, new inquiries, storage used),
    30-day views/plays chart (hand-built SVG, no chart lib), top videos, top places, latest
    inquiries, processing queue status, warning banner if `mediaProcessing` is false.
  - **الأماكن** — sortable list/grid (drag to reorder with @dnd-kit), search, publish toggle,
    featured toggle, create button. Each place opens **its own page** (`/places/:id`) with:
    details form (name, slug, category, location, year, summary, description, services chips,
    accent colour picker, Instagram, website, published, featured), cover + logo uploaders with
    preview, and the **videos manager**: drag-and-drop / pick multiple files → per-file queue
    with progress bar, speed, ETA, pause/resume/cancel (chunked resumable upload per contract),
    automatic poster capture (canvas frame at ~1 s) + metadata read from a `<video>` element,
    processing status badges with polling until READY/FAILED, reorder by drag, inline title edit,
    featured / published toggles, **poster frame picker** (scrub the video, "use this frame" →
    uploads the captured frame as poster), reprocess, delete. Link "عرض بالموقع" opens the public
    page in a new tab.
  - **الفيديوهات** — all videos across places with filters (status, place), quick toggles.
  - **الرسائل** — inquiries inbox with status tabs (جديد / تم التواصل / تم الاتفاق / مؤرشف) +
    counts, search, detail panel with notes, quick WhatsApp/call/email actions, delete.
  - **الباقات** — plans CRUD (name, tagline, price or "on request", currency IQD/USD, period,
    features list editor, highlighted, CTA label, active), drag reorder, live preview card, and
    the **"اعرض الباقات بالموقع"** switch (settings.sections.plans) with explanation.
  - **الإعدادات** — tabs: الهوية (brand name, handle, title, tagline, hero mark, accent),
    نبذة (heading, body, avatar upload, location, since), الأرقام (custom stats editor),
    التواصل (WhatsApp, phone, email, socials, address), الواجهة (hero videos picker — choose up to
    7 READY videos — and section toggles), SEO (title, description, keywords, OG image).
    Save bar appears when dirty.
  - **الحساب** — change password, logout.
- Data layer: typed API client with the `X-S5Y-Admin: 1` header on every non-GET, credentials
  `same-origin`, 401 → redirect to login, error toasts from `error.message`. React Query for
  caching + optimistic toggles/reorders.
