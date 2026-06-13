# MiraCare — Referral Web + App Completion Plan (Codex Handoff)

Status: READY FOR IMPLEMENTATION — 2026-06-13
Owner: taksin / MediaForge
Executor: Codex (this document is the work order)
Scope: **PWA/Web + Mobile app only. LINE OA referral is OUT OF SCOPE for this plan.**
Precedence: extends `docs/miracare-v2-product-plan.md` §5 (Refer Program). Does **not**
re-open any DECIDED item there.

> Codex: read `AGENTS.md` first — it is binding. Everything backend in this plan is
> **additive only**. Keep `ChatOrchestratorRequest`, the order shape, and the action schema
> backward-compatible (AGENTS.md §7) and mirror any type change in `lib/types/api.ts`. Do not
> touch the protected core in AGENTS.md §2 (prompt, marker protocol, card-suppression, order
> state machine, `transition_order`). Do NOT modify the LINE path
> (`supabase/functions/line-webhook/*`, `_shared/line.ts`). One PR per Task below.

---

## 0. Problem in one paragraph

The referral **backend is already built and correct**. Attribution works end-to-end on
**PWA/Web only**. On **mobile (native)** the attribution store is a silent no-op, so referral
on the app does not work at all. This plan makes one shareable referral link work across
**web and app** via a **smart landing page (Model A)**, and retires the mock sales-portal that
emits non-conformant codes. LINE OA is intentionally excluded.

---

## 1. Current state — DO NOT REBUILD (verified in code)

| Layer | Artifact | Evidence |
|---|---|---|
| DB schema | `referrers`, `commission_entries`, `customers.referred_by/referred_at`, `orders.referrer_id`, `orders.commission_scheme_snapshot`, `tenants.attribution_window_days` + RLS | `supabase/migrations/20260611040000_...phase4_referrals.sql`, `20260611010000_...foundations.sql`, `20260611060000_a1_commission_scheme_snapshot.sql` |
| `ref_code` | 6-char Crockford base32, server-generated, immutable, unique per tenant | `20260611062000_b8_referrer_contract.sql` |
| Commission compute | on `submitted → confirmed`, snapshot-based, status `pending` | `transition_order` in `20260612050000_...phase1_data_admin.sql`; `_shared/commissions.ts` |
| Chat attribution | `maybeApplyReferralCode` + `resolveAttributedReferrerId`; request schema accepts `ref_code` on `app`/`pwa` | `supabase/functions/_shared/orchestrate.ts`, `_shared/referrals.ts` |
| Assisted purchase | `create_order` / `list_branches` / `payment_done` | `supabase/functions/referrer-order/index.ts`, `_shared/referrerOrder.ts` |
| PWA capture | `/r/[ref_code]` → localStorage + cookie; carried in every chat call | `app/r/[ref_code].tsx`, `lib/referrals/attribution.ts`, `lib/ai/miraChat.ts` |
| Referrer workspace (real) | reads referrer/commissions from DB, calls `referrer-order` | `app/partner.tsx` (use as the reference implementation) |

**The `ref_code` is universal** — one code maps to one referrer regardless of platform. What
differs is only **how the customer lands** and **how the code is captured**. Capture is
per-platform: a code stored on web does NOT carry into the app — the code is the bridge, not
the storage.

---

## 2. Decisions baked into this plan

- **D1 — Scope = web + app only.** LINE OA referral is out of scope; do not touch the LINE
  webhook or `_shared/line.ts`. The existing backend `ref_code` plumbing already supports
  `app`/`pwa` channels.
- **D2 — sales-portal wired to real backend.** `app/sales-portal.tsx` uses a real referrer
  from the DB and calls `referrer-order` like `app/partner.tsx`. The metadata mock in
  `lib/marketplace/referralMock.ts` (10-char codes, hardcoded rates) is retired.
- **D3 — Model A: one smart link.** The single canonical share URL is
  `https://<web-host>/r/<CODE>`. The `/r/[ref_code]` landing captures the code, then opens the
  app if installed (Universal/App Link) or continues on web. Referrers copy ONE link.
- **D4 — `readStoredReferralCode` becomes async.** Native store (`expo-secure-store`) is
  async; expose async read and update the (few) callers to await. Web path keeps working.

---

## 3. Owner / console prerequisites (Codex CANNOT do these — needed for live verification)

1. **Canonical web host decided.** `referralMock.ts` currently mixes `mira.health` and
   `portal.mira.health`. Pick ONE host for `/r/<code>`. Codex uses a single
   `EXPO_PUBLIC_WEB_ORIGIN` env, no hardcoding.
2. **Universal / App Links hosting**: serve `/.well-known/apple-app-site-association` and
   `/.well-known/assetlinks.json` on the web host; needs the Apple Team ID and Android signing
   fingerprint from owner to add `associatedDomains` (iOS) + intent filters (Android).

Codex writes all the code regardless; mark DoD items needing the above as ❌ "pending live
config" rather than faking them (AGENTS.md §3).

---

## 4. Model A architecture (web + app)

### 4.1 The single link
- Canonical: `https://<web-host>/r/<CODE>` (plus a QR of the same URL).
- sales-portal and partner workspace show exactly this one link/QR. No per-channel links.

### 4.2 Landing `app/r/[ref_code].tsx` (the router)
On open it must:
1. `storeReferralCode(code)` via the cross-platform store (Task 1).
2. Detect environment and act:
   - **Native app already open** (route hit via deep link) → store + route to chat/checkout.
   - **Mobile web** → attempt to open the app via Universal/App Link; always render a fallback.
   - **Desktop web** → store + CTA to start chat on web.
3. Always render fallback CTAs: **เปิดในแอป** (Universal/App Link) and **เล่นต่อบนเว็บ**
   (→ chat/checkout).

### 4.3 What stays untouched (reused as-is)
`referred_by` attribution, `resolveAttributedReferrerId` crediting at order creation,
commission creation on admin confirm, `referrer-order`, and `lib/ai/miraChat.ts` already
sending `ref_code`. The app path simply needs the code to actually persist (Task 1) and a
working deep link (Task 2).

---

## 5. Task breakdown for Codex (one PR each, in order)

### Task 1 — Cross-platform attribution store  ·  (foundation)
- Files: `lib/referrals/attribution.ts` (+ callers `app/r/[ref_code].tsx`, `lib/ai/miraChat.ts`).
- Keep the exported interface names. Web: localStorage + cookie unchanged. Native: persist via
  `expo-secure-store` (already in `app.json` plugins), key `mira_ref`, same 30-day envelope.
- Make `readStoredReferralCode` async (D4); update callers to await.
- DoD: native unit test stores+reads a code; web behavior unchanged.

### Task 2 — Unify deep links + Model A smart landing (web + app)
- Files: `app/r/[ref_code].tsx`, `app.json`, `lib/marketplace/referralMock.ts` (kill `mira://`),
  public config for `EXPO_PUBLIC_WEB_ORIGIN`.
- Unify scheme to `mirahealth://` everywhere; configure Universal Links (`associatedDomains`)
  + Android App Links so `https://<web-host>/r/<code>` opens the app when installed.
- Implement §4.2 routing + the 2 CTAs; handle Expo Linking cold-start initial URL.
- DoD: installed app opens from the https link and stores the code; desktop/mobile web render
  the correct CTAs. (App-link OS routing = ❌ pending live config from §3.2.)

### Task 3 — sales-portal real wiring + mock retirement (D2)
- Files: `app/sales-portal.tsx`, `lib/marketplace/referralMock.ts`, `app/staff-referral.tsx`.
- Load the signed-in referrer from `referrers` (by `tenant_id` + `auth_user_id`); call
  `referrer-order` (`create_order` → `payment_done`) exactly like `app/partner.tsx` (reuse its
  helpers, don't duplicate). Replace fixture commission dashboard with real
  `commission_entries` reads (keep a not-signed-in demo fallback like `partner.tsx`).
- Show ONE share link/QR = `https://<web-host>/r/<realRefCode>` (real 6-char DB code).
- Retire `referralMock.ts` code generation (reduce to pure formatting helpers or delete).
  Decide `staff-referral.tsx`: keep redirect to `/sales-portal`.
- DoD: a code shown in sales-portal passes `REF_CODE_PATTERN` and resolves to a real referrer;
  an assisted order creates a real DB order in the admin queue.

### Task 4 — Verification & bookkeeping
- `npm run typecheck` + `npm run v2:verify` green.
- Tests: native attribution store unit test; confirm `miraChat.ts` awaits + sends `ref_code`.
- Update the DoD checkboxes in `docs/miracare-v2-product-plan.md` §10 truthfully.

---

## 6. Protected-core guardrails (AGENTS.md §2)

- No new order statuses; status changes only via `transition_order`.
- Do not touch the LINE webhook / `_shared/line.ts` / `orchestrateLine` (out of scope, D1).
- New schema (if any) ships in a NEW migration file with RLS in the same file; never edit
  existing migrations. (This plan likely needs no schema change.)
- `ChatOrchestratorRequest` / order / action schema changes are additive and mirrored in
  `lib/types/api.ts` (CI enforces the mirror).
- Agent does not deploy functions, set secrets, or configure Apple/Android consoles — owner
  steps documented in §3.

---

## 7. Open items still needing an owner answer (non-blocking for coding, blocking for live)

1. Canonical web host for `/r/<code>` (§3.1).
2. Apple Team ID / Android signing fingerprint for Universal/App Links (§3.2).
3. `sales-portal` demo fallback when not signed in: keep (like `partner.tsx`) — assumed YES
   unless owner says otherwise.

---

## 8. DoD checklist (fill ✅/❌ + date in each Task PR)

- [ ] T1. Native attribution store persists + reads `ref_code`; read is async; web unchanged.
- [ ] T2. `mirahealth://` unified; smart landing routes web/app + renders 2 CTAs; cold-start handled.
- [ ] T3. sales-portal uses real referrer + `referrer-order` + single share link; mock generator retired.
- [ ] T4. typecheck + v2:verify green; tests added; v2 plan §10 updated.
