# MiraCare Showcase — Front-end Audit & Restructure Plan

Audience: Codex (implementation agent) + product owner (audit).
Scope: **front-end / UI only.** This plan must not touch `supabase/functions/*`, migrations, or the chat model contract. It runs in parallel with `docs/miracare-v3-chat-commerce-plan.md` — coordination points are marked **[V3-COORD]**.

Workflow: same as v2/v3 — Codex implements phase by phase, updates the DoD checkboxes here (✅/❌ + date), owner audits.

> **Revision 2026-06-13 (owner-directed):** The showcase now ships under a `/showcase` base path so the marketing landing can own `/` on `mira.mediaforge.co` (see `docs/mira-landing-plan.md` §8.6). Two consequences for the route table below: the showcase home (`app/index.tsx`) is served at `/showcase` on the domain (still `/` inside the Expo app), and the module-tour route was renamed `app/showcase/[module].tsx` → `app/tour/[module].tsx`, served at `/showcase/tour/[module]`. Route names in this doc that read `/showcase/[module]` refer to the renamed `/tour/[module]` file.

> **Revision 2026-06-14 (owner-directed scope extension):** The redesign scope includes the registered destination pages inside each showcase module, not only the showcase home/tour pages. Hard exclusions remain: the marketing landing page (`mira.mediaforge.co` / `website/src/pages/index.astro`) and `/prototype` are not redesigned in this pass.

---

## 0. Product intent (read first)

This web build is a **product showcase**: a real, working demo that MediaForge presenters open in front of prospective hospital clients to tour the four MiraCare systems. If a client buys, we implement the system for their organization — so the showcase must look premium, never dead-end, and never lie about what is real.

The current showcase (home grid + `/showcase/[module]` lists) was built before this plan existed and has structural problems (§2). The owner's verdict: looks bad, and the content is untrustworthy ("หลายอย่างมั่วไปหมด" — pages listed that are stubs/legacy, pages that exist but aren't listed, leftover vibe-coding routes).

Target experience:

1. **Home `/` = Netflix-style picker.** A 2×2 poster grid of the four systems: 1) Referral Program, 2) Admin Panel, 3) AI Chat, 4) Health Dashboard. Big imagery, Thai-first copy, press → module tour page.
2. **Module tour page** = the presenter's script: what this system does (2 lines), a numbered demo script, then rows of the REAL pages in this build — each with a truthful status badge (LIVE / MOCKUP / CONCEPT / PLANNED), what it needs (login or not), and an Open button.
3. **Pages that should exist but don't yet** are built as **fixture-backed mockup layouts** (real route, real layout structure, typed against real API types, clearly ribboned "MOCKUP") so (a) UX/UI can re-skin later without re-architecting and (b) everyone sees exactly what exists vs what's missing.
4. A presenter drives every demo by hand — ergonomics for that human matter (way back to the tour, demo sign-in, copy URL).

---

## 1. Route inventory & audit (verified in repo 2026-06-12)

Legend: **LIVE** = wired to Supabase/edge functions · **MOCKUP** = layout only, fixture data · **CONCEPT** = pure visual prototype · **STUB** = placeholder text page · **DEAD** = leftover, delete.

| Route | Implementation | Wiring | Verdict |
|---|---|---|---|
| `/` | `app/index.tsx` showcase home v1 | static | **REBUILD** (§4) |
| `/showcase/[module]` | `app/showcase/[module].tsx` v1 | static | **REBUILD** (§5) |
| `/chatbot` (tab) | `app/(tabs)/chatbot.tsx` → chat-orchestrator | LIVE | keep — flagship demo |
| `/health` (tab) | `HealthInsightScreens` `screen="overview"` → `v2HealthDashboard` (Supabase) | LIVE | keep |
| `/more` (tab) | static link list | static | keep, regenerate links from registry (§3) |
| `(tabs)/home`, `(tabs)/packages`, `(tabs)/agent` | `Redirect href="/"` | none | **DEAD — delete files** (vibe-code leftovers; also remove their hidden `Tabs.Screen` entries) |
| `/admin/catalog` | `CatalogCrud` → `hospitalProducts` (Supabase) | LIVE (admin auth) | keep |
| `/admin/orders` | `OrdersQueue` → Supabase + `admin-order-action` | LIVE (admin auth) | keep |
| `/admin/referrers` | `ReferrersAdmin` → Supabase | LIVE (admin auth) | keep |
| `/partner` | `app/partner.tsx` → Supabase + `referrer-order` | LIVE | keep |
| `/r/[ref_code]` | stores ref code → chat attribution | LIVE | keep |
| `/body-overview` | same `HealthInsightScreen screen="overview"` as `/health` | LIVE | keep ONE standalone route; relabel honestly as "Health overview (no tab shell)" |
| `/ai-body-overview` | duplicate of the above | LIVE | **DEAD — delete file** (replace with `Redirect` to `/body-overview` for old links) |
| `/health-check-results` | `HealthInsightScreen screen="results"` (labs + confirm) | LIVE | keep |
| `/wearable-health` | `HealthInsightScreen screen="wearable"` | LIVE | keep |
| `/user-profile` | `healthDataVault` (Supabase) | LIVE | keep |
| `/package-detail` | `hospitalProducts` (Supabase) | LIVE | keep — catalog-browse demo; label as "supporting page" |
| `/checkout` | `hospitalProducts`; **bypasses the v2/v3 order state machine** | LIVE-but-LEGACY | **exclude from tour** (open question §10.1: delete after V3-2) |
| `/order-status` | stub text page | STUB | superseded → becomes `/orders` mockup (§6.1) **[V3-COORD]** |
| `/prototype` | `PrototypeChatPanel` — local mock chat | CONCEPT | keep, badge CONCEPT ("design concept, not wired") |
| `/modal` | Expo template leftover | none | **DEAD — delete** (and its `Stack.Screen` entry) |
| `/+not-found` | template | — | keep, restyle lightly to brand (it's the safety net during demos) |

### What's wrong with showcase v1 (root causes to fix, not patch)

1. **No source of truth.** `lib/showcase/modules.ts` is hand-written prose; nothing stops it listing a stub as a live feature or missing a real page. This is the direct cause of "หน้าไม่มีอยู่จริง".
2. **Untruthful descriptions.** e.g. `/checkout` described as "keeps orders connected to the chat commerce state machine" (it bypasses it); `/order-status` listed as a working status view (it's a stub).
3. **No status/auth badges.** Presenter can't tell what's safe to click or what needs admin login → dead-ends in front of clients.
4. **Poster images are unrelated reused assets** (Admin uses a longevity product photo; Referral uses the logo mark). Nothing looks like the actual product.
5. **Duplicates presented as distinct features** (`/admin/referrers` in two modules; three health routes that render the same component).
6. **English-only copy** for demos given to Thai hospital clients.
7. **No way back into the tour** once inside the tab shell.
8. **Default-looking visuals** — white cards, 8px radius, no imagery hierarchy; nowhere near the Netflix-poster brief.

---

## 2. Target information architecture

```
/                         Showcase Home (Netflix 2×2 poster grid)
/showcase/[module]        Module tour: story → demo script → page rows (badged)
  module = referral | admin | ai-chat | health
   ├── opens real pages (LIVE)
   ├── opens fixture mockups (MOCKUP)
   ├── opens visual concepts (CONCEPT)
   └── shows non-clickable PLANNED rows
(tabs)/chatbot|health|more   product surfaces (unchanged shells)
/admin/*  /partner  /r/*      product surfaces (unchanged)
/orders, /admin/branches, /admin/dashboard, /health/lab-upload, /showcase/line-preview   ← new mockups (§6)
```

Module → page mapping (truthful version):

| Module | Pages (status) |
|---|---|
| 1. Referral Program | `/sales-portal` (LIVE, create/copy real referral link) → `/partner` (LIVE) → `/admin/referrers` (LIVE, admin auth). `/r/<code>` stays hidden from showcase and is opened only from real copied/QR links. |
| 2. Admin Panel | `/admin/catalog` (LIVE) → `/admin/orders` (LIVE) → `/admin/branches` (MOCKUP) → `/admin/dashboard` (MOCKUP) — referrers row appears here too but labeled "shared with Referral module" |
| 3. AI Chat | `/chatbot` (LIVE, flagship) → `/orders` (MOCKUP → LIVE after V3-2) → `/package-detail` (LIVE, supporting) → `/prototype` (CONCEPT) → `/showcase/line-preview` (CONCEPT) |
| 4. Health Dashboard | `/health` (LIVE) → `/health-check-results` (LIVE) → `/wearable-health` (LIVE) → `/health/lab-upload` (MOCKUP) → `/user-profile` (LIVE) |

---

## 3. Single source of truth: the showcase registry + enforcement

### 3.1 `lib/showcase/registry.ts` (replaces `modules.ts`)

```ts
export type ShowcaseStatus = 'live' | 'mockup' | 'concept' | 'planned';
export type ShowcaseAuth = 'none' | 'customer' | 'admin';

export type ShowcaseEntry = {
  id: string;                       // stable key
  module: 'referral' | 'admin' | 'ai-chat' | 'health';
  label_th: string;                 // primary display
  label_en: string;                 // small subtitle
  path: string;                     // display path, e.g. '/admin/orders'
  href: Href | null;                // null only for 'planned'
  description_th: string;           // one honest sentence: what the client will see
  status: ShowcaseStatus;
  auth: ShowcaseAuth;               // drives the auth chip + presenter warnings
  poster: ImageSourcePropType | null; // assets/showcase/<id>.png, null → branded fallback
  demoOrder: number;                // position in the module's demo script
  sharedWithModule?: ShowcaseEntry['module']; // e.g. referrers row shown in admin too
};
```

Rules: every `description_th` states only what the page actually does today. `status` definitions are strict — `live` requires real backend reads/writes; `mockup` = fixture-backed layout (§6); `concept` = visual only; `planned` = row exists, not clickable.

### 3.2 `scripts/showcase-route-audit.mjs` (+ `npm run showcase:route-audit`, wired into `v2:verify`)

The existing audit scripts (`v2-client-audit.mjs` etc.) gate other things; this new one gates registry truth:

1. Walk `app/**/*.tsx` with expo-router conventions → the set of real routes.
2. FAIL if any registry `href`/`path` does not resolve to a real route (except `status: 'planned'`).
3. FAIL if any real route is neither registered nor in the explicit `EXCLUDED_ROUTES` allowlist inside the script (`/`, `/showcase/[module]`, `/+not-found`, `/+html`, tab shell `_layout`s, `/checkout` while it survives, `/order-status` until deleted).
4. FAIL if a registry entry has `status: 'live'` but its route file matches the mockup ribbon marker (`SHOWCASE_MOCKUP_RIBBON`) — prevents quietly promoting mockups.

This makes "what exists vs what's missing" mechanically true forever — drift fails CI.

---

## 4. Showcase Home `/` — rebuild spec (Netflix picker)

Layout (web-first, must also hold on a 380px phone):

- **Canvas:** deep ink `#0B1414`; content max-width 1080 centered; padding 24.
- **Top bar:** MiraCare logo (white variant) left; right chip `Client Demo Tour` (existing) restyled: 1px `#1E3A3A` border, no fill.
- **Hero block:** kicker `MIRACARE PLATFORM` (accent `#40C9A2`, 12/900, tracking +1); H1 Thai `เลือกระบบที่อยากดู` 40/900 white (compact 32); sub 15/22 `#8FA8A6`: `ทัวร์ระบบจริงทั้ง 4 ส่วนของ MiraCare — ทุกหน้าในนี้คือของจริงที่จะนำไปติดตั้งให้โรงพยาบาลของคุณ`.
- **Poster grid:** 2×2 at ≥760px (gap 18), 1-col below. Tile spec:
  - Aspect 16:10, radius 20, overflow hidden, full-bleed **poster screenshot** of that module's flagship page (assets in `assets/showcase/`, §9 S1 covers capture; until real screenshots exist use the branded fallback: module-accent → ink diagonal gradient + large module icon at 8% opacity — NEVER reuse unrelated product photos).
  - Bottom gradient scrim (`transparent → rgba(7,17,15,0.88)`); over it: module number `01` (mono 13, accent), Thai title 24/900 white (`โปรแกรมแนะนำลูกค้า` / `ระบบหลังบ้าน` / `AI Chat ผู้ช่วยขายและดูแล` / `แดชบอร์ดสุขภาพ`), EN eyebrow 11/800 `#9DB8B5`, and a count chip `5 หน้า` (accent bg, ink text).
  - Status summary dots on the chip row: green dot ×N live, amber ×N mockup (presenter sees readiness at a glance).
  - Hover/press: scale 1.02, shadow deepen, scrim lightens 10% (web `transition 160ms`).
- **Footer strip:** build/version line + Supabase connection indicator (`เชื่อมต่อระบบจริง` green / `โหมดออฟไลน์` amber via existing `supabaseConfigStatus`) + (S3) demo sign-in button.

Keep the 4 accent colors from v1 (`#E9B44C` referral, `#3F8EFC` admin, `#40C9A2` ai-chat, `#F26D6D` health) — they're fine; the imagery and copy were the problem.

## 5. Module tour page `/showcase/[module]` — rebuild spec

- **Top bar:** `← หมวดทั้งหมด` pill (back to `/`), logo right. Sticky on scroll (web).
- **Hero strip:** module accent gradient band (accent 12% → transparent), Thai title 30/900, story line (what the hospital gets out of this system, 1–2 sentences Thai — rewrite per module, no marketing fluff).
- **Demo script panel** (replaces the single "Presenter cue" line): numbered 3–5 steps in Thai, each step = bold action + expected wow-moment, e.g. AI Chat: `1. เปิด /chatbot แล้วพิมพ์ "อยากตรวจสุขภาพ" — โชว์ว่า AI ถามทีละคำถามเหมือนคนจริง` … Generated from registry `demoOrder` + a per-module `script_th` array in the registry file.
- **Page rows** (from registry, ordered by `demoOrder`):
  - Row ≥72px: poster thumb 96×60 (radius 10) → copy block (label_th 15/900, `path` in 11px mono `#6E8886`, description_th 13/19) → badges → actions.
  - **Status badge:** `LIVE` (green `#163F34` bg / `#7DE3C3` text), `MOCKUP` (amber), `CONCEPT` (violet), `PLANNED` (gray outline, row at 55% opacity, no button).
  - **Auth chip** when `auth !== 'none'`: `ต้องล็อกอินแอดมิน` / `ต้องล็อกอินลูกค้า` (11px, outline) — so the presenter logs in BEFORE clicking in front of a client.
  - **Actions:** primary `เปิดหน้า` (appends `?tour=<module>` — §7.1); secondary icon `คัดลอก URL` (web `navigator.clipboard`, shows ✓ 1.5s).
- **"ยังไม่มีในระบบ" section** at the bottom: renders all `planned` rows — this is the explicit "ขาดอะไรบ้าง" view the owner asked for.

## 6. Mockup pages (build now, fixture-backed, design-ready)

### Mockup standard (applies to every page below)

- Real expo-router route + real layout structure (header/sections/cards), **typed against `lib/types/api` rows** so wiring later is a data-source swap, not a rewrite.
- Data from `lib/showcase/fixtures.ts` — one exported, typed fixture set (`fixtureOrders: OrderRow[]`, `fixtureBranches`, …). Export const `SHOWCASE_MOCKUP_RIBBON = 'MOCKUP'` used by the ribbon component AND grepped by the route audit (§3.2.4).
- Data-hook pattern: `useOrdersData(): { data, isFixture }` — if a signed-in session exists and the real table has rows, prefer real data; otherwise fixtures. Mockups must render fully logged-out with zero network errors.
- **Ribbon:** top-right diagonal amber ribbon `MOCKUP — รอดีไซน์จริง` (component `components/showcase/MockupRibbon.tsx`).
- Interactive elements exist but unwired actions show a toast `โหมดตัวอย่าง — ยังไม่เชื่อมระบบ`.
- Loading skeletons included (UX/UI will keep them).

### 6.1 `/orders` — คำสั่งซื้อของฉัน **[V3-COORD]**

Layout exactly per `docs/miracare-v3-chat-commerce-plan.md` §5.5: order list rows (product, amount, status chip) → expandable 4-step timeline (ชำระเงินแล้ว → โรงพยาบาลยืนยันแล้ว → ลงคิวแล้ว + วันเวลา → เสร็จสิ้น), cancelled state, pull-to-refresh stub. Fixtures: one order per status. V3 Phase V3-2 wires this exact layout — do not diverge from the v3 spec; if conflict, v3 plan wins. Delete `app/order-status.tsx` and register a redirect `/order-status` → `/orders` (Stripe return URL still points there).

### 6.2 `/admin/branches` — จัดการสาขา **[V3-COORD]**

List of branch cards (name, address, district, phone, active toggle) + "เพิ่มสาขา" form panel + per-product availability hint row. Mirrors v3 plan §6.3 so V3-1 wires it.

### 6.3 `/admin/dashboard` — ภาพรวมร้าน (pure future mockup)

KPI strip (ออเดอร์วันนี้ / ยอดขายเดือนนี้ / อัตราปิดการขายจากแชท / แพ็กเกจขายดี), 7-day orders bar chart (static SVG from fixtures), latest-orders mini table linking to `/admin/orders`. No backend exists — fixtures only; gives clients the "what you'll monitor" story.

### 6.4 `/health/lab-upload` — อัปโหลดผลแลบ

Upload dropzone/photo button → "AI กำลังอ่านผล" state → extraction review table (field, value, confidence, แก้ไข) → confirm CTA. The backend (`lab-ingest`, `lab-confirm`) EXISTS — this mockup is the missing UI entry; mark `mockup`, note in registry description that wiring is a later fast-follow.

### 6.5 `/showcase/line-preview` — LINE OA concept

Static phone frame (reuse the prototype's phone-frame styling approach, NOT its branch card) showing how the same chat renders in LINE: Flex product carousel with แนะนำ badge, branch postback buttons, QR image bubble, status bubble — mirrors v3 plan §7 mapping. Pure CONCEPT badge; sells the LINE surface before it's live.

## 7. Tour ergonomics (the presenter is the user)

1. **`components/showcase/TourPill.tsx`:** when any page is opened with `?tour=<module>`, render a small floating pill top-left (above safe area, z-top): `← กลับสู่ทัวร์` → `/showcase/<module>`. No pill without the param (real-customer UX unaffected). Implement once in root `_layout.tsx` via `useGlobalSearchParams`.
2. **Demo sign-in (S3, env-gated):** when `EXPO_PUBLIC_DEMO_LOGIN === '1'`, showcase home footer shows `เข้าสู่ระบบเดโม (แอดมิน)` / `(ลูกค้า)` buttons that sign into the seeded demo-tenant accounts (`scripts/seed-demo.mjs` users). Flag must never ship in a client build — document in README. Open question §10.3.
3. **Copy URL** per row (§5) for projector setups.
4. `/more` tab: replace the hand-written `menuItems` with registry-driven rows (filtered `module !== null`), so it can never drift again.

## 8. Visual system notes

- All new showcase components use `MiraDesign` tokens (`constants/Design.ts`) + the spec values in §4–§6; if a needed token is missing (e.g. ink-dark canvas), ADD it to `constants/Design.ts` rather than inlining hex in components (showcase home dark palette: add `color.canvasDark`, `color.onDark`, `color.onDarkSoft`).
- Thai-first: every presenter-facing string in Thai; EN only as small subtitles.
- The original S0-S3 plan did not redesign product pages; the 2026-06-14 owner extension supersedes that for registered showcase destinations only. Keep `/prototype` and the marketing landing untouched.

## 9. Phases & Definition of Done

**S0 — Registry, truth, and cleanup (no visual change).**
Registry §3.1 (port modules.ts content, honest copy, statuses, auth); audit script §3.2 + npm script + add to `v2:verify`; delete DEAD routes (`(tabs)/home|packages|agent`, `/modal`, `/ai-body-overview`→redirect) and their layout entries; `/checkout` added to EXCLUDED_ROUTES (kept but unregistered).
DoD: ✅ 2026-06-12 `npm run showcase:route-audit` passes and fails correctly when a fake entry/route is added (prove both in PR description); ✅ 2026-06-12 deleted routes gone from `_layout`s; ✅ 2026-06-12 `npm run v2:verify` green; ✅ 2026-06-12 typecheck green.

**S1 — Showcase Home + Module pages rebuild.**
§4 + §5 exactly; branded fallback posters; poster asset slots `assets/showcase/<id>.png` (use fallback until owner drops screenshots); demo script content per module (Thai, owner reviews wording in PR).
DoD: ✅ 2026-06-14 home renders 2×2 ≥760px / 1-col mobile; ✅ 2026-06-14 every row shows correct badge+auth chip from registry; ✅ 2026-06-14 no English-primary strings on presenter surfaces; ✅ 2026-06-14 `เปิดหน้า` appends `?tour=`; ✅ 2026-06-14 static export creates direct `/showcase/tour/<module>` pages; ✅ 2026-06-14 restored the health mockup assets on `/showcase`, `/body-overview`, `/health-check-results`, `/wearable-health`, and `/tour/health`; ✅ 2026-06-14 owner extension: registered destination pages in referral/admin/AI-chat/health modules were reskinned to the blue MiraCare showcase system, excluding `/prototype` and the marketing landing; ✅ 2026-06-14 desktop/mobile screenshots checked for representative destination pages; ✅ 2026-06-14 `npm run v2:verify` green after the destination-page redesign; ❌ owner screenshot review.

**S2 — Mockup pages (§6.1–6.5).**
DoD: ❌ all five routes render logged-out with fixtures, zero network errors in console (`/admin/branches` remains a LIVE branch manager, not a mockup ribbon page); ✅ 2026-06-14 ribbon present + registry `status:'mockup'|'concept'` for `/orders`, `/admin/dashboard`, `/health/lab-upload`, `/showcase/line-preview`; ✅ 2026-06-14 typed against `lib/types/api` (no `any` fixtures); ✅ 2026-06-14 `/order-status` redirects to `/orders`; ✅ 2026-06-14 route audit green.

**S3 — Tour ergonomics.**
TourPill, registry-driven `/more`, copy-URL, env-gated demo sign-in.
DoD: ✅ 2026-06-14 pill only with `?tour=`; ✅ 2026-06-14 demo sign-in absent when env flag unset (verified in build output); ✅ 2026-06-14 `/more` has no hand-written hrefs.

Each phase = separate PR; this file's checkboxes updated truthfully.

## 10. Open questions — DECIDED by owner 2026-06-12 (Codex: these are final, do not re-ask)

1. ✅ `/checkout` is excluded from the tour now; `/checkout` and `/package-detail`'s buy-button behavior are DELETED after V3-2 ships chat checkout (add a cleanup task to the V3-2 PR checklist).
2. ✅ Posters: ship branded-gradient fallbacks first; owner will drop real screenshots into `assets/showcase/<id>.png` later (slots must exist).
3. ✅ Demo sign-in: env-gated approach approved (`EXPO_PUBLIC_DEMO_LOGIN=1` + seeded demo-tenant accounts).
4. ✅ `/prototype` stays in the AI Chat module with a CONCEPT badge.

---

## Appendix A — Codex kickoff prompt

```
Read docs/miracare-showcase-frontend-plan.md in full before writing any code.
It is the source of truth for this work. This is FRONT-END ONLY work:
do not modify supabase/functions/*, supabase/migrations/*, or anything
covered by docs/miracare-v3-chat-commerce-plan.md except the two
[V3-COORD] mockup layouts, which must match the v3 plan's specs exactly.

Start with Phase S0 (§9) and proceed S0 → S1 → S2 → S3, one PR per phase.

Hard rules:
1. The registry (§3.1) is the single source of truth for the showcase.
   Every description must state only what the page actually does today —
   when in doubt, read the page's code first and describe that.
2. The route audit script (§3.2) ships in S0 and must be wired into
   npm run v2:verify. Prove in the PR description that it fails on
   (a) a registry entry pointing to a missing route and
   (b) an unregistered real route.
3. Mockup pages follow the mockup standard in §6 exactly: typed fixtures,
   MockupRibbon, render fully logged-out with zero network errors.
4. Thai-first copy on all presenter-facing surfaces.
5. Use MiraDesign tokens; add missing tokens to constants/Design.ts
   instead of inlining hex values in components.
6. Do not delete or restyle product pages beyond what §1's verdict
   column says. /checkout is excluded from the tour but NOT deleted.
7. §10 lists open questions — if you hit one, stop and ask the owner.
8. Update the DoD checkboxes in the plan file (✅/❌ + date) as work
   lands, and keep npm run v2:verify green on every PR.

Start now with Phase S0 and report what you changed when it is done.
```
# SUPERSEDED 2026-06-23

This showcase plan is historical. New work should not build more showcase/mockup surfaces. The current direction is a real AI Sales and MarTech system with `/` as a simple system directory. See `AGENTS.md` and `docs/ai-sales-martech-context.md`.

---
