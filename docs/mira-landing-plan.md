# Mira.com Landing Page — Design & Build Plan

Audience: Codex (implementation agent) + product owner (audit).
Designer of record: Claude (this document IS the design — Codex implements it, does not redesign it).
Scope: **a brand-new standalone marketing site in `website/` only.** This plan must not touch `supabase/*`, `app/*`, `lib/*`, `components/*`, `scripts/*`, root `vercel.json`, or root `package.json`. The ONLY permitted edit outside `website/` is the single root `tsconfig.json` exclusion described in §8.1.

Workflow: same as v2/v3/showcase — Codex implements phase by phase, updates the DoD checkboxes here (✅/❌ + date), owner audits. If anything in this plan conflicts with `AGENTS.md`, AGENTS.md wins — stop and report.

---

## 0. Product intent (read first)

This is the **vendor marketing site for mira.com**. MediaForge sells Mira as a platform; this page must convince a prospective organization (hospital, clinic, or other business) to book a demo.

The two things the page must burn into the visitor's memory:

1. **Mira's AI Chat sells.** It recommends, answers, and closes the sale inside one conversation — trained from *your organization's own data*, with a full back office (catalog CRUD anytime, order queue) included.
2. **The Referral Program and the AI Chat work as one engine.** A referrer shares a link → the customer lands in chat → Mira drives them to a closed sale automatically → the referrer earns a share that *your organization configures*. This combined engine is the heart of the pitch.

Secondary messages: works as PWA / App / LINE OA; we adapt Mira to *your* systems and brand (CI / white-label), not the other way around. After the core story, two vertical sections: **MiraCare** (hospitals; Health Dashboard as optional add-on; AI Chat + CI tuned for hospitals) and **MiraBeauty** (clinics; adds face-scan consult).

Design brief from owner: beautiful, premium, a **blend of visual motion graphics and text**. Motion graphics are authored with **HyperFrames** (`heygen-com/hyperframes` — HTML-authored compositions rendered deterministically to video).

Honesty rule (house culture): no fabricated client logos, testimonials, or performance metrics. Demo numbers in mockups are labeled `ตัวอย่าง`. Capability claims only (what the product does), not unverified outcome claims ("เพิ่มยอดขาย 300%").

---

## 1. Architecture & stack — DECIDED (by designer)

| Decision | Choice | Why |
|---|---|---|
| Location | New top-level folder `website/`, its own `package.json` | Marketing site ≠ product showcase. The Expo app keeps `/` as the Netflix-style showcase per `docs/miracare-showcase-frontend-plan.md`. Zero dependency coupling with the app; nothing in AGENTS.md §2 is touched. |
| Framework | **Astro 5**, static output (`output: 'static'`) | Zero-JS by default → fast LCP for a content page; component files keep sections reviewable; no React needed (avoids colliding with the app's React 19 / RN-web setup). |
| Animation runtime | **GSAP 3** (core + ScrollTrigger + SplitText) via npm, vanilla TS | GSAP incl. all plugins is free for commercial use since the Webflow acquisition. ScrollTrigger drives the pinned referral scene; SplitText drives headline reveals. |
| Motion graphics | **HyperFrames** compositions in `website/motion/compositions/*.html`, rendered locally to MP4/WebM, **rendered assets committed** to `website/public/motion/` | HyperFrames needs Node 22+ and FFmpeg — keep that out of CI and Vercel. Deterministic renders = reviewable, re-renderable assets. See §4. |
| Styling | Plain CSS with custom properties (`src/styles/tokens.css` + scoped Astro styles) | No Tailwind: the design is bespoke; tokens mirror `MiraDesign` so brand stays consistent. **No inline hex in components — tokens only** (AGENTS.md rule 6 spirit). |
| Fonts | `@fontsource/anuphan` (Thai + Latin) + `@fontsource/space-grotesk` (EN display accents), self-hosted woff2, subset thai+latin | Thai-first page; Anuphan is a modern loopless Thai face that pairs with a geometric EN grotesque. No external font CDN (privacy + LCP). |
| Deploy | Separate Vercel project with **Root Directory = `website/`** → domain mira.com | Owner creates the Vercel project + DNS (§7 Phase L8). The repo's existing root `vercel.json` (showcase app) is NOT touched. |
| Language | Thai-first copy (all copy is written out in §3 — use it verbatim), EN micro-labels as visual accents | Thai market; matches AGENTS.md rule 6. |

File tree Codex will create:

```
website/
  package.json            # own deps: astro, gsap, @fontsource/*
  astro.config.mjs
  tsconfig.json           # extends astro/tsconfigs/strict
  vercel.json             # for the website project only
  README.md               # how to run dev / render motion / deploy
  public/
    motion/               # rendered .mp4/.webm/.jpg posters (committed, §4)
    og.png                # 1200×630
    favicon.svg
  src/
    styles/tokens.css     # §2 tokens
    styles/base.css       # reset, typography scale, section shell, utilities
    scripts/motion.ts     # GSAP init: reveals, pinned scene, nav, counters
    scripts/chat-sim.ts   # the live chat simulation engine (§4.3)
    data/chat-script.ts   # the demo conversation (§3.2), typed
    data/referral-steps.ts
    components/
      Nav.astro  Footer.astro  Section.astro  Button.astro  Chip.astro
      Hero.astro  ChatSim.astro
      SectionAiChat.astro  SectionAdmin.astro  SectionReferral.astro
      SectionChannels.astro  VerticalCare.astro  VerticalBeauty.astro
      Cta.astro
    pages/index.astro       # redirects to /landingpage
    pages/landingpage.astro # marketing landing page
  motion/
    compositions/
      hero-aurora.html
      referral-flywheel.html
      miracare-pulse.html
      mirabeauty-scan.html
    README.md             # render commands + budgets (§4.2)
```

---

## 2. Design system — DECIDED

### 2.1 Color tokens (`src/styles/tokens.css`) — REVISED 2026-06-13 (owner decision)

**Identity = the CI blue from the Mira logos** (`assets/images/mira-orbit-logo.png`, `mira-care-logo.png` — royal blue → periwinkle gradient). The original teal identity was rejected by the owner ("ไม่ใช่สีฟ้าเดียวกับ CI"); teal is demoted to the MiraCare vertical accent only. The token source of truth is now `website/src/styles/tokens.css`:

```css
:root {
  /* Mira CI blue family (sampled from the orbit / mira care logos) */
  --brand-deep: #1D46E0;   --brand: #3F6DFB;       --brand-bright: #3F8EFC;
  --sky: #7FA4FE;          --ice: #C5D8FF;         --brand-soft: #E9F0FF;

  /* neutrals (blue-leaning ink) */
  --ink: #101A33;          --ink-soft: #4A5878;    --muted: #8B97B3;
  --canvas: #F6F8FD;       --surface: #FFFFFF;     --line: #DDE5F4;

  /* dark canvas (blue night) */
  --night: #050B1E;        --night-soft: #0A142E;  --muted-dark: #AFC0E4;

  /* support accents */
  --mint: #54CFA5;         /* money / success only */
  --teal: #0EA5A4;         /* MiraCare vertical accent only */
  --rose: #E58FA2;         /* MiraBeauty vertical accent */
  --grad-brand: linear-gradient(108deg, var(--brand-deep), var(--brand-bright) 55%, var(--sky));
}
```

Rules: dark sections use `--night` with near-white text; identity gradient = `--grad-brand` (logo-like blue). Commission/money moments use `--mint`. MiraCare panels teal, MiraBeauty panels rose. The DESIGN.md "no purple-blue gradient" rule is overridden for the marketing site by the owner's CI-blue directive (the product app keeps its own rules).

### 2.2 Typography

| Role | Face | Size (clamp mobile→desktop) | Weight |
|---|---|---|---|
| Display (H1) | Anuphan | `clamp(2.5rem, 6.5vw, 5.25rem)` | 600, line-height 1.08 |
| H2 section | Anuphan | `clamp(1.9rem, 4vw, 3.25rem)` | 600 |
| H3 | Anuphan | `clamp(1.35rem, 2.5vw, 1.9rem)` | 600 |
| Body | Anuphan | `1rem`–`1.125rem` | 400, line-height 1.7 |
| Eyebrow / EN accents / numerals | Space Grotesk | `0.8125rem`, letter-spacing `0.18em`, uppercase | 500 |

### 2.3 Shape, depth, texture

- Radius: cards `22px` (= `MiraDesign.radius.lg`), chips/buttons pill, small tiles `14px`.
- Borders: 1px `--line` on light, `--night-line` on dark. Glass panels on dark: `background: rgba(255,255,255,0.04); backdrop-filter: blur(14px)`.
- Shadows: soft, colored — `0 24px 60px -28px var(--glow-teal)` on dark CTAs; light sections use the app's soft-shadow feel (`0 10px 22px rgba(107,146,151,0.12)`).
- A faint film-grain overlay (CSS, 3% opacity, `mix-blend-mode: overlay`) on dark sections only.

### 2.4 Motion principles (apply everywhere)

1. Animate `transform`/`opacity` only; no layout-thrashing properties on scroll.
2. Default reveal: fade-up 24px, `0.7s`, ease `power3.out`, stagger `0.08s`.
3. Every scroll-triggered element animates **once** (`once: true`), except the pinned referral scene.
4. `prefers-reduced-motion: reduce` → kill all GSAP scroll animations (content fully visible statically), pause/remove all `<video>` (posters remain), chat sim renders its final state instantly.
5. Videos: `<video autoplay muted loop playsinline preload="metadata" poster=...>`, lazy-attached `src` via IntersectionObserver when within 1.5 viewports.

---

## 3. Page structure & copy (use this copy verbatim; owner may edit at audit)

One page, in this order. Each section names its background, motion, and full Thai copy.

### 3.0 Nav (sticky)

Glass bar (transparent over hero → `--night` glass after 80px scroll, GSAP). Left: wordmark **Mira** (Space Grotesk 600 + teal dot). Links: `แพลตฟอร์ม · Referral · MiraCare · MiraBeauty · ติดต่อเรา` (anchor links). Right CTA button (teal pill): `นัดดูเดโม`. Mobile: links collapse into a full-screen overlay menu.

### 3.1 Hero — dark, `--night`

- Background: `hero-aurora` HyperFrames loop (§4.1-A) full-bleed behind content, plus grain.
- Layout: two columns ≥1024px (text left 55%, ChatSim device right 45%); stacked on mobile (text → device).
- Eyebrow: `MIRA — AI COMMERCE CHAT PLATFORM`
- H1 (SplitText reveal, line by line):
  `AI Chat ที่ขายเป็น` (line 1, with `ขายเป็น` in gradient teal→mint)
  `แนะนำ · ตอบ · ปิดการขาย จบในแชทเดียว` (line 2, smaller display)
- Sub: `Mira เรียนรู้จากชุดข้อมูลขององค์กรคุณ แล้วเปลี่ยนทุกบทสนทนาให้เป็นยอดขาย — แนะนำสินค้าได้ตรงคน พาลูกค้าไปจนถึงชำระเงิน และส่งต่อให้ทีมของคุณแบบไร้รอยต่อ`
- CTAs: primary pill `นัดดูเดโม` (→ #contact), ghost `ดูวิธีทำงาน ↓` (→ #ai-chat).
- Channel chips under CTAs (Space Grotesk): `PWA` `APP` `LINE OA` + caption `ปรับให้เข้ากับระบบและแบรนด์ขององค์กรคุณ`
- Right: phone-frame mockup running the **live ChatSim** (§4.3) — this is the hero's proof, not decoration.

### 3.2 ChatSim demo conversation (`src/data/chat-script.ts`)

Typed, auto-playing, looping (~20s, 1.5s idle between beats, then fade-reset). Steps:

1. chip (system): `ลูกค้ามาจากลิงก์แนะนำของ คุณหมอนก · DRNOK2`
2. user: `สนใจโปรแกรมตรวจสุขภาพให้คุณแม่ค่ะ อายุ 58`
3. mira (typing indicator → text): `แนะนำ 2 โปรแกรมที่เหมาะกับคุณแม่อายุ 58 ปีค่ะ เลือกดูรายละเอียดได้เลย`
4. product cards ×2 (fixture): `ตรวจสุขภาพ Premium 50+` `฿4,900` / `ตรวจหัวใจครบวงจร` `฿6,500` — badge `ตัวอย่าง`
5. user: `เอา Premium 50+ ค่ะ สาขาไหนใกล้ลาดพร้าว`
6. mira: `สาขาลาดพร้าวมีคิวพรุ่งนี้ช่วงเช้าค่ะ สรุปรายการให้แล้ว ชำระผ่าน PromptPay ได้เลย` + order summary card + QR tile
7. status chip (mint): `ชำระเงินแล้ว · ยืนยันนัดหมาย ✓`
8. toast (amber→mint): `ส่วนแบ่งผู้แนะนำ +฿350 → คุณหมอนก (ตัวอย่าง)`

This single loop demonstrates: referral attribution → recommendation → close → pay → commission. It is the whole pitch in 20 seconds.

### 3.3 Section `#ai-chat` — light, `--canvas`

- Eyebrow `AI SALES CHAT` / H2: `ผู้ช่วยขายที่รู้จักสินค้าของคุณทุกชิ้น`
- Sub: `ฝึกจากข้อมูลขององค์กรคุณ — แคตตาล็อก สาขา โปรโมชัน นโยบาย — Mira จึงตอบได้เหมือนพนักงานที่เก่งที่สุดของคุณ และปิดการขายในแชทได้จริง`
- 3 feature tiles (icon + H3 + body, staggered reveal):
  1. `แนะนำตรงใจ` — `วิเคราะห์ความต้องการจากบทสนทนา แล้วเสนอสินค้าและบริการที่ใช่สำหรับลูกค้าคนนั้น`
  2. `ปิดการขายในแชท` — `สั่งซื้อ เลือกสาขา ชำระเงินผ่าน QR และยืนยันออเดอร์ โดยลูกค้าไม่ต้องหลุดออกจากบทสนทนาเลย`
  3. `ข้อมูลของคุณ ควบคุมได้` — `เพิ่ม ลบ แก้สินค้าและราคาได้ตลอดเวลา ระบบอัปเดตให้ AI รู้ทันที ไม่ต้องรอใคร`
- Capability strip (3 fact chips, count-up where numeric): `ตอบลูกค้า 24/7` · `1 แชท = แนะนำ → ชำระเงิน` · `ส่วนแบ่งคำนวณอัตโนมัติ`

### 3.4 Section `#admin` — light, `--surface` band

- Eyebrow `BACK OFFICE` / H2: `หลังบ้านครบ จัดการได้เองทุกขั้นตอน`
- Sub: `ทุกอย่างที่ทีมคุณต้องใช้มาพร้อมกันตั้งแต่วันแรก — ไม่ต้องประกอบเอง`
- 4 cards in a 2×2 (parallax-floating stylized UI mockups, CSS-built, not screenshots):
  `แคตตาล็อกสินค้า` — `เพิ่ม ลบ แก้ราคา จัดหมวดหมู่ ได้ตลอดเวลา`
  `คิวออเดอร์` — `เห็นทุกออเดอร์ ตรวจสลิป ยืนยันโดยทีมของคุณ`
  `ผู้แนะนำ & ส่วนแบ่ง` — `ตั้งกติกาส่วนแบ่งเอง ดูยอดของผู้แนะนำแต่ละคนได้ทันที`
  `แดชบอร์ดภาพรวม` — `ยอดขาย ออเดอร์ และแคมเปญ ในหน้าจอเดียว`

### 3.5 Section `#referral` — dark, `--night` (THE HEART — pinned scene)

- Eyebrow `REFERRAL ENGINE` / H2: `เปลี่ยนคนรู้จัก ให้กลายเป็นยอดขาย`
- Sub: `สร้างแคมเปญแนะนำได้ในไม่กี่นาที — ที่เหลือ Mira จัดการต่อจนจบ`
- **Pinned ScrollTrigger scene** (desktop; on mobile it degrades to a plain vertical 4-step list, no pin): viewport pins for ~3 viewport-heights; a progress line draws; 4 steps light up in order, each with a small illustrative panel sliding in:
  1. `แชร์ลิงก์` — `ผู้แนะนำได้ลิงก์และ QR ส่วนตัว แชร์ได้ทุกช่องทาง`
  2. `ลูกค้าเข้าแชท` — `ระบบจดจำอัตโนมัติว่าลูกค้ามาจากใคร`
  3. `Mira พาไปจนปิดการขาย` — `แนะนำ ตอบคำถาม รับออเดอร์ ชำระเงิน — อัตโนมัติทั้งเส้นทาง`
  4. `ส่วนแบ่งเข้าทันที` — `คำนวณตามกติกาที่องค์กรคุณตั้งเอง โปร่งใส ตรวจสอบย้อนหลังได้` (+ counter animating `฿0 → ฿350` labeled `ตัวอย่าง`)
- After the pin: the **flywheel** — `referral-flywheel` HyperFrames loop (§4.1-B) centered (rendered on `--night` so it blends), DOM labels positioned over it: `แนะนำ → ขาย → ส่วนแบ่ง → อยากแนะนำอีก`. Caption: `ยิ่งแนะนำ ยิ่งขาย · ยิ่งขายดี ยิ่งมีคนอยากแนะนำ`

### 3.6 Section `#channels` — light, `--canvas`

- H2: `ลูกค้าอยู่ตรงไหน ก็คุยกับ Mira ได้`
- Sub: `เราปรับ Mira ให้เข้ากับระบบและแบรนด์ขององค์กรคุณ — ไม่ใช่ให้คุณปรับเข้าหาเรา`
- 3 device cards (live DOM, readable UI text — not video): `PWA` (เปิดจากเบราว์เซอร์ ไม่ต้องติดตั้ง), `App` (iOS / Android ในแบรนด์ของคุณ), `LINE OA` (คุยใน LINE ที่ลูกค้าคุ้นเคย).
- Footnote row: `เชื่อมต่อกับระบบเดิมขององค์กร · CI / White-label เต็มรูปแบบ`

### 3.7 Verticals intro + `#miracare` + `#mirabeauty`

Intro (short, light): H2 `หนึ่งแพลตฟอร์ม หลายอุตสาหกรรม` / sub `แกนเดียวกัน — AI Chat + Referral + หลังบ้าน — ปรับโฉมและความสามารถให้เข้ากับธุรกิจของคุณ`

**MiraCare panel** — full-bleed, `--teal-soft` wash on `--canvas`, `miracare-pulse` loop (§4.1-C) as the panel's visual:
- Badge: `MiraCare · สำหรับโรงพยาบาล`
- H3: `แพลตฟอร์มขายแพ็กเกจสุขภาพ ที่พูดภาษาโรงพยาบาล`
- Body: `ครบทั้งแกนหลักของ Mira โดย AI Chat และ CI ถูกปรับให้เหมาะกับบริบทโรงพยาบาลโดยเฉพาะ — โทนการสื่อสาร ความปลอดภัยของข้อมูล และเส้นทางนัดหมาย`
- Bullets: `แพ็กเกจตรวจสุขภาพและวัคซีน พร้อมนัดหมาย-เลือกสาขาในแชท` · `Referral สำหรับเครือข่ายผู้แนะนำของโรงพยาบาล` · `Health Dashboard (ตัวเลือกเสริม) — ให้คนไข้เห็นผลตรวจและติดตามสุขภาพ แล้วกลับมาซื้อแพ็กเกจถัดไปเอง`
- `Health Dashboard` bullet gets an `ADD-ON` chip — it is optional, never imply it's core.

**MiraBeauty panel** — full-bleed, `--rose-soft` wash, `mirabeauty-scan` loop (§4.1-D):
- Badge: `MiraBeauty · สำหรับคลินิกความงาม`
- H3: `ที่ปรึกษาความงามที่ปิดการขายเก่งที่สุดของคลินิก`
- Body: `แกนเดียวกับ MiraCare เสริมด้วยระบบสแกนใบหน้าเพื่อให้คำปรึกษา — วิเคราะห์ผิวและโครงหน้า แล้วแนะนำว่าควรทำอะไรเพิ่ม พร้อมเสนอคอร์สที่เหมาะสมและปิดการขายต่อในแชททันที`
- Bullets: `สแกนใบหน้า → คำแนะนำเฉพาะบุคคล` · `เสนอคอร์สและโปรโมชันที่ใช่ ในจังหวะที่ลูกค้าสนใจที่สุด` · `Referral ให้ลูกค้าบอกต่อและรับส่วนแบ่ง`

### 3.8 Section `#contact` CTA — dark, `--night`, aurora reused subtly

- H2: `อยากเห็น Mira ขายให้องค์กรคุณ?`
- Sub: `นัดดูเดโมสด 30 นาที — เห็นทั้งฝั่งลูกค้าและหลังบ้าน ด้วยข้อมูลตัวอย่างของธุรกิจแบบคุณ`
- Form: `ชื่อ` `องค์กร` `อีเมลหรือเบอร์ติดต่อ` `ประเภทธุรกิจ (โรงพยาบาล / คลินิกความงาม / อื่น ๆ)` → submit. **Endpoint is an open question (§9.2)** — until decided, build as `mailto:` compose fallback with the fields prefilled, clearly functional.
- Footer: wordmark, `© MediaForge`, anchor links, minimal.

---

## 4. Motion system

### 4.1 HyperFrames compositions (rendered to video)

**Division of labor — DECIDED:** HyperFrames renders *cinematic/ambient graphics with no readable body text* (text in video blurs on scale and can't be edited per-locale). Anything the visitor reads, hovers, or scrolls lives in DOM (§4.3/4.4). Each composition is a standalone HTML file using CSS/GSAP animations with HyperFrames data attributes (`data-composition-id`, `data-width`, `data-height`, `data-start`, `data-duration`), seekable (no `Math.random()` per-frame, no wall-clock time — deterministic).

All compositions: 30fps, **seamless loop** (state at t=0 must equal state at t=duration — drive everything with looping eases/yoyo cycles that complete exactly at the duration).

| ID | File / output | Size / length | Visual spec |
|---|---|---|---|
| A | `hero-aurora` → `public/motion/hero-aurora.{mp4,webm,jpg}` | 1920×1080 · 12s · mp4 ≤2.5MB | Canvas `--night`. Three soft radial blobs (teal 18% / mint 14% / blue 10% opacity, heavily blurred) drifting on slow elliptical paths; faint 64px grid (4% white); ~50 drifting 1–2px particles. Calm, no flashes. |
| B | `referral-flywheel` → `public/motion/referral-flywheel.{mp4,webm,jpg}` | 1080×1080 · 10s · mp4 ≤1.8MB | Canvas exactly `--night` (must blend into §3.5). A thin orbit ring; 4 glyph nodes (link, chat bubble, QR, percent — icon-only, no text) at 90° spacing; a comet highlight travels the ring once per 10s, each node glow-pulses as it passes; center `M` monogram breathes. |
| C | `miracare-pulse` → `public/motion/miracare-pulse.{mp4,webm,jpg}` | 1600×900 · 8s · mp4 ≤1.5MB | Canvas `--canvas`. A teal ECG line draws left→right; at the beat it blooms into a chat-bubble outline and a health ring that sweeps to ~75%; soft `+` particles. Clinical-calm. |
| D | `mirabeauty-scan` → `public/motion/mirabeauty-scan.{mp4,webm,jpg}` | 1600×900 · 8s · mp4 ≤1.5MB | Canvas `--rose-soft`. Abstract line-art face profile (geometric SVG path — stylized, not a realistic face); a luminous scan band sweeps down; landmark dots light up in sequence; three icon-only chips pulse beside it. Rose + ink. |

### 4.2 Render pipeline (`website/motion/README.md` documents this)

- Requirements: **Node 22+, FFmpeg** — local/owner machine only; CI and Vercel never run HyperFrames.
- Author/preview: `npx hyperframes preview` inside `website/motion/`. Render: `npx hyperframes render` per composition → MP4.
- Post-process per asset (document exact commands in the README): WebM transcode `ffmpeg -i in.mp4 -c:v libvpx-vp9 -crf 36 -b:v 0 -an out.webm`; poster `ffmpeg -i in.mp4 -frames:v 1 -q:v 4 poster.jpg`; verify loop seam by eye in preview.
- **Rendered assets are committed.** Budgets above are hard DoD limits. Compositions must render reproducibly (deterministic) so the owner can re-render after copy/brand tweaks.
- Embed pattern (one `MotionLoop.astro` helper): `<video>` per §2.4 rule 5, `<source webm>` then `<source mp4>`, poster always set, `aria-hidden="true"` (decorative), reduced-motion → poster image only.

### 4.3 ChatSim (live DOM — the hero centerpiece)

`scripts/chat-sim.ts` + `data/chat-script.ts`. A small dependency-free engine: takes the typed script array (§3.2), renders message bubbles into a phone-frame; assistant messages show a 3-dot typing indicator (600ms) then type-on at ~28 chars/s with caret; product/QR/summary cards slide-fade in; container auto-scrolls; loops with a 2s hold + 400ms fade reset. Pauses via IntersectionObserver when off-screen. Reduced-motion: render all steps instantly, no loop. Bubbles/cards styled with tokens — visually consistent with the real product (teal assistant accents, white cards, 14px radius).

### 4.4 GSAP inventory (`scripts/motion.ts`, one module, initialized on `astro:page-load`)

| # | Target | Behavior |
|---|---|---|
| M1 | Nav | At scrollY > 80: compress height, add `--night` glass + border. Reverses. |
| M2 | Hero H1 | SplitText by lines → masked rise, 0.9s, stagger 0.12s, on load. Sub/CTAs follow +0.3s. |
| M3 | All `[data-reveal]` | Batch ScrollTrigger: fade-up 24px per §2.4, `once: true`. |
| M4 | `#referral` pinned scene | Desktop ≥1024px only: pin container 3×100vh; scrub progress line `scaleY 0→1`; 4 steps activate at 0/0.25/0.5/0.75 progress (class toggle: dim → lit + panel slide). Mobile/reduced-motion: no pin, plain stacked list. |
| M5 | Commission counter | On step-4 activation: count `฿0 → ฿350` over 1s, Space Grotesk numerals. |
| M6 | Capability chips (§3.3) | Count-up / pop-in on enter. |
| M7 | Admin cards | Subtle parallax float: `yPercent ±6` scrub on scroll. |
| M8 | Vertical panels | Background wash `scale 1.06→1` + content reveal on enter. |

Performance guard: all triggers use `transform/opacity`; total page JS (GSAP + plugins + chat-sim + init) ≤ **110KB gzip**.

---

## 5. SEO, a11y, performance — DoD budgets

- `<html lang="th">`; unique `<title>`: `Mira — AI Chat ที่ขายเป็น | แพลตฟอร์ม AI Sales Chat + Referral สำหรับองค์กร`; meta description (Thai, ≤155 chars); OG/Twitter card with `og.png` (1200×630, designed still from the aurora + wordmark + H1).
- JSON-LD: `Organization` (MediaForge) + `SoftwareApplication` (Mira). Sitemap + robots via Astro integration.
- Semantic landmarks (`header/main/section/footer`), one `h1`, ordered headings; all interactive elements keyboard-reachable with visible focus (`outline: 2px solid var(--teal)`); decorative videos `aria-hidden`; contrast AA on every text/background pair (check `--muted` on `--night` — if it fails, lighten to a `--muted-dark` token).
- Lighthouse (mobile emulation, `npm run build && npx astro preview`): **Performance ≥ 90, Accessibility ≥ 95, SEO = 100**. LCP element must be the H1 text (videos lazy + poster), CLS < 0.05 (reserve aspect-ratio boxes for all media).
- Fonts: woff2 only, `font-display: swap`, preload the two critical weights (Anuphan 400/600).

---

## 6. What Codex must NOT do (guardrails)

1. No edits outside `website/` except the root `tsconfig.json` exclusion (§8.1) and DoD checkboxes in this file. Nothing in AGENTS.md §2, no `app/*`, no `supabase/*`, no root `vercel.json`/`package.json`.
2. No new root npm dependencies. Everything lives in `website/package.json`.
3. No fabricated logos, testimonials, review counts, or outcome stats. Mock numbers carry `ตัวอย่าง`.
4. No external CDNs (fonts, scripts, analytics). No analytics at all in this phase (owner decides later, §9.4).
5. Do not commit motion source renders you cannot reproduce — every `public/motion/*` asset must come from a composition in `motion/compositions/`.
6. Copy is as written in §3. Codex fixes typos only; rewrites are owner territory.
7. Root gates must stay green: `npm run typecheck` and `npm run v2:verify` from the repo root after every phase.

---

## 7. Phases & DoD

### Phase L0 — Scaffold & isolation
- [x] ✅ 2026-06-12 `website/` Astro 5 project boots (`npm run dev` inside `website/`), own `package.json` + strict tsconfig
- [x] ✅ 2026-06-12 Root `tsconfig.json` excludes `website` (§8.1); root `npm run typecheck` green
- [x] ✅ 2026-06-12 Root `npm run v2:verify` green (no script picks up `website/`)
- [x] ✅ 2026-06-12 `website/README.md`: dev / build / motion-render / deploy instructions
- [x] ✅ 2026-06-12 `website/vercel.json` (framework astro, clean URLs)

### Phase L1 — Design system & shell
- [x] ✅ 2026-06-12 `tokens.css` exactly per §2.1; `base.css` type scale per §2.2; grain + glass utilities
- [x] ✅ 2026-06-12 Fonts self-hosted (Anuphan thai+latin 400/500/600, Space Grotesk 500/600), preloads in place
- [x] ✅ 2026-06-12 `Nav.astro` (sticky + M1 + mobile overlay) and `Footer.astro`
- [x] ✅ 2026-06-12 `Section.astro`, `Button.astro`, `Chip.astro`, `MotionLoop.astro` primitives
- [x] ✅ 2026-06-12 Reduced-motion global handling wired (§2.4 rule 4)

### Phase L2 — Hero + ChatSim
- [x] ✅ 2026-06-12 Hero layout + copy per §3.1; static aurora CSS-gradient fallback as background (video lands in L6)
- [x] ✅ 2026-06-12 M2 headline reveal
- [x] ✅ 2026-06-12 `chat-sim.ts` engine + full §3.2 script; loops, pauses off-screen, reduced-motion path works
- [x] ✅ 2026-06-12 Phone frame is pure CSS (no heavy images); hero LCP = H1 text (`PerformanceObserver` captured `AI Chat ที่ขายเป็น`)

### Phase L3 — Core sections
- [x] ✅ 2026-06-12 `#ai-chat` per §3.3 with M3 + M6
- [x] ✅ 2026-06-12 `#admin` per §3.4 with CSS-built mockup cards + M7
- [x] ✅ 2026-06-12 `#channels` per §3.6 (device cards live DOM)

### Phase L4 — Referral scene
- [x] ✅ 2026-06-12 Pinned scene per §3.5 + M4 + M5 on desktop
- [x] ✅ 2026-06-12 Mobile + reduced-motion degrade to stacked list (verified at 375px)
- [x] ✅ 2026-06-12 Flywheel area built with DOM labels positioned; static placeholder superseded by L6 video asset

### Phase L5 — Verticals + CTA
- [x] ✅ 2026-06-12 Intro + MiraCare + MiraBeauty panels per §3.7 (static washes; videos land in L6); `ADD-ON` chip on Health Dashboard
- [x] ✅ 2026-06-12 `#contact` form per §3.8 with mailto fallback; Footer finalized
- [x] ✅ 2026-06-12 M8 panel animations

### Phase L6 — HyperFrames motion pipeline
- [x] ✅ 2026-06-12 4 compositions authored per §4.1 table, deterministic/seekable, seamless loops
- [x] ✅ 2026-06-12 `motion/README.md` with exact preview/render/transcode/poster commands (§4.2)
- [x] ✅ 2026-06-12 Rendered mp4+webm+poster committed for all 4, **within size budgets** (mp4: 158KB / 69KB / 46KB / 92KB)
- [x] ✅ 2026-06-12 Wired via `MotionLoop.astro` into hero / referral / MiraCare / MiraBeauty; lazy-load + poster + reduced-motion verified
- [x] ✅ 2026-06-12 Node 24 + FFmpeg available; owner-local-render fallback not needed

### Phase L7 — SEO / a11y / performance pass
- [x] ✅ 2026-06-12 All §5 items: meta, OG image, JSON-LD, sitemap, robots, favicon
- [x] ✅ 2026-06-12 Lighthouse mobile: Perf 99 / A11y 96 / SEO 100 (JSON report written; Lighthouse CLI exits 1 afterward on Windows temp cleanup EPERM)
- [x] ✅ 2026-06-12 Keyboard pass + contrast pass done; CLS 0.002; JS budget 51.45KB gzip
- [x] ✅ 2026-06-12 375px / 768px / 1440px visual QA, no horizontal scroll

### Phase L8 — Deploy (owner territory)
- [ ] OWNER: create Vercel project, Root Directory `website/`, attach mira.com DNS
- [ ] OWNER: verify production Lighthouse + loop seams on real devices

---

## 8. Repo integration notes

### 8.1 Root tsconfig exclusion (the only edit outside `website/`)

Root `tsconfig.json` currently includes `**/*.ts` with no `exclude`, so the new folder would be swept into the Expo typecheck. Add exactly:

```json
"exclude": ["node_modules", "website", "dist"]
```

(`node_modules`/`dist` restated because adding `exclude` replaces the default.) Verify `npm run typecheck` before/after.

### 8.2 Coordination

- **[SHOWCASE-COORD]** The landing's `นัดดูเดโม` flow may later deep-link into the deployed showcase app for live demos. Not in scope now; leave CTA → `#contact`.
- This plan creates no Supabase/API surface. If a future contact-form endpoint is wanted, that's a new plan section (likely an edge function — owner approval required first).
- **[EXISTING-LANDING]** A landing prototype already exists inside the Expo app (`components/MiraLandingPage.tsx`, wired into `app/index.tsx`, assets in `assets/motion/`). This plan supersedes it for mira.com; do NOT delete or modify it (it's outside this plan's scope) — owner decides its fate separately.

---

## 8.5 Revision 2026-06-13 — owner feedback pass (implemented by Claude directly)

Owner verdict on the first build: colors not CI blue, key messages under-communicated (no clear arrival moment per section), animations too plain. Claude applied a redesign pass directly in `website/` (Codex's structure kept):

1. **CI blue re-theme** (§2.1 above). Favicon, nav orbit mark, ChatSim, all sections re-colored. `hero-aurora` HyperFrames composition re-rendered in blue (mp4+webm+poster re-committed); other 3 compositions re-palette'd in source. The flywheel / care / beauty *videos* were replaced by sharper **live SVG scenes** (flywheel orbit w/ GSAP timeline, ECG + health ring, face-scan w/ sweep beam) — compositions remain in `motion/` for future use; only `hero-aurora` video is embedded (hero + CTA backgrounds).
2. **Over-communication system**: every section now has a numbered chapter kicker (01–06), a giant outlined ghost word (AI CHAT / CONTROL / REFERRAL / CHANNELS / INDUSTRIES) with scroll parallax, a bold `key-claim` benefit statement, and a per-section `mini-cta` to `#contact`. Referral gets a full-width outlined **marquee billboard band** announcing arrival, and its heading stays pinned through the whole step sequence.
3. **Animation upgrade** (`motion.ts` rewritten): Thai-safe word-mask hero reveal (blur+rise, manual word spans — SplitText removed), scroll progress bar + nav scrollspy, scroll-velocity-skewed marquees, 3D tilt + sheen cards, magnetic CTAs, pointer-parallax hero device, rebuilt referral pin driving a 4-state story panel (link card → attributed chat → PromptPay close → commission counter ฿0→฿350), animated flywheel SVG, CTA pointer spotlight, count-up numbers, admin bar-chart grow-in.
4. **Robustness**: reveal targets are CSS-hidden only under `html.has-motion` (inline head script) with a watchdog that un-hides everything if rAF never ticks (occluded window/battery saver); reduced-motion path renders everything static; chat sim pauses off-screen.
5. Verified: `astro check` 0 errors, production build passes, no console errors, no horizontal overflow at 375px, full desktop walkthrough in Chrome.

DoD note: this pass supersedes the L1–L6 visual specs above where they conflict (copy in §3 was kept verbatim, with added claim lines); §7 checkbox state should be audited against the live build.

**Second owner pass (same day):** owner supplied the real logos (`mira AI` orbit + `mira care`) — palette shifted from indigo to true CI blue (`--brand-deep #1D56DB`, `--brand #2E6BF6`, `--brand-bright #3F8EFC`, night `#051226`); wordmark is now "mira AI". Copy was cut hard for noise reduction: every section now reads pain-line (✗ one sentence) → solution headline → minimal support → mini-CTA; hero punch line is "ไม่ขอเงินเดือน ไม่มีวันหยุด ปิดการขายให้คุณตลอด 24 ชม."; capability-chip strips, verticals-intro section, and long sub-paragraphs were removed. §3 copy blocks above are therefore historical — the live components are the copy source of truth now.

## 9. Open questions for owner (answer at audit; none block L0–L7)

1. **Domain**: mira.com is stated in the brief — confirm the actual domain to configure (mira.com is likely taken; e.g. `mira.co.th`, `usemira.ai`, …). Affects §5 metadata only.
2. **Contact endpoint**: mailto fallback ships first. Where should leads really go (email inbox? LINE OA? sheet)?
3. **Pricing section**: omitted by design (sell-by-demo motion). Add later?
4. **Analytics**: none shipped. PostHog later?
5. **Footer legal identity**: `© MediaForge` — confirm exact legal name/year format.
