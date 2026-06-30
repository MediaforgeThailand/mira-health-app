# MiraCare — Referral Code Cross-Platform Completion Plan (Codex Handoff)

Status: READY FOR IMPLEMENTATION — 2026-06-13
Owner: taksin / MediaForge
Executor: Codex (this document is the work order)
Precedence: extends `docs/miracare-v2-product-plan.md` §5 (Refer Program). Does **not** re-open any DECIDED item there.

> Codex: read `AGENTS.md` first — it is binding. Everything backend in this plan is
> **additive only** (new migration files / new columns / new functions). Keep
> `ChatOrchestratorRequest`, the order shape, and the action schema backward-compatible
> (AGENTS.md §7) and mirror any type change in `lib/types/api.ts`. Do not touch the
> protected core in §2 of AGENTS.md (prompt, marker protocol, card-suppression,
> order state machine, `transition_order`). One PR per Task below.

---

## 0. Problem in one paragraph

The referral **backend is already built and correct**. Attribution works end-to-end on
**PWA/Web only**. On **mobile (native)** the attribution store is a silent no-op, and on
**LINE OA** there is no referral capture at all. This plan makes one shareable referral link
work across all three platforms via a **smart landing page (Model A)**, and retires the mock
sales-portal that emits non-conformant codes.

---

## 1. Current state — DO NOT REBUILD (verified in code)

| Layer | Artifact | Evidence |
|---|---|---|
| DB schema | `referrers`, `commission_entries`, `customers.referred_by/referred_at`, `orders.referrer_id`, `orders.commission_scheme_snapshot`, `tenants.attribution_window_days` + RLS | `supabase/migrations/20260611040000_...phase4_referrals.sql`, `20260611010000_...foundations.sql`, `20260611060000_a1_commission_scheme_snapshot.sql` |
| `ref_code` | 6-char Crockford base32, server-generated, immutable, unique per tenant | `20260611062000_b8_referrer_contract.sql` |
| Commission compute | on `submitted → confirmed`, snapshot-based, status `pending` | `transition_order` in `20260612050000_...phase1_data_admin.sql`; `_shared/commissions.ts` |
| Chat attribution | `maybeApplyReferralCode` + `resolveAttributedReferrerId`; request schema accepts `ref_code` on `app`/`pwa`/`line` | `supabase/functions/_shared/orchestrate.ts`, `_shared/referrals.ts` |
| Assisted purchase | `create_order` / `list_branches` / `payment_done` | `supabase/functions/referrer-order/index.ts`, `_shared/referrerOrder.ts` |
| PWA capture | `/r/[ref_code]` → localStorage + cookie; carried in every chat call | `app/r/[ref_code].tsx`, `lib/referrals/attribution.ts`, `lib/ai/miraChat.ts` |
| Referrer workspace (real) | reads referrer/commissions from DB, calls `referrer-order` | `app/partner.tsx` (use as the reference implementation) |

**The `ref_code` is universal** — one code maps to one referrer regardless of platform.
What differs per platform is only **how the customer lands** and **how the code is captured**.
Capture is per-platform: a code stored on web does NOT carry into the app or LINE — the code
is the bridge, not the storage.

---

## 2. Decisions baked into this plan

- **D1 — LINE binding = LIFF + LINE login.** LINE `follow` events carry no custom params, so
  binding happens through a LIFF page that logs the user in and binds `ref_code` ↔
  `line_user_id` server-side.
- **D2 — sales-portal wired to real backend.** `app/sales-portal.tsx` uses a real referrer
  from the DB and calls `referrer-order` like `app/partner.tsx`. The metadata mock in
  `lib/marketplace/referralMock.ts` (10-char codes, hardcoded rates) is retired.
- **D3 — plan-first.** (Done: this document.)
- **D4 — Model A: one smart link for all platforms.** The single canonical share URL is
  `https://<web-host>/r/<CODE>`. The `/r/[ref_code]` landing captures the code, then
  auto-routes / offers: open app (Universal/App Link), continue on LINE (LIFF link), or
  continue on web. Referrers copy ONE link.
- **D5 — `readStoredReferralCode` becomes async.** Native store (`expo-secure-store`) is
  async; expose async read and update the (few) callers to await. Web path keeps working.
- **D6 — LIFF endpoint = dedicated route** `app/line-referral.tsx` (registered as the LIFF
  endpoint URL). `/r/[code]`'s "continue on LINE" button deep-links to the LIFF URL with the
  code. Keeps LINE-SDK code out of the generic landing.

---

## 3. Owner / console prerequisites (blockers Codex CANNOT do — needed for live verification)

1. **Canonical web host decided.** `referralMock.ts` currently mixes `mira.health` and
   `portal.mira.health`. Pick ONE host for `/r/<code>` and the LIFF endpoint. (Codex: use a
   single `EXPO_PUBLIC_WEB_ORIGIN` env, do not hardcode.)
2. **LIFF app registered** in LINE Developers → store `LINE_LIFF_ID__<tenant_slug>` as a
   Supabase function secret (same convention as `LINE_CHANNEL_TOKEN__<slug>` in
   `docs/line-setup.md`). LIFF endpoint URL = `https://<web-host>/line-referral`.
3. **Universal / App Links hosting**: serve `/.well-known/apple-app-site-association` and
   `/.well-known/assetlinks.json` on the web host; add `associatedDomains` (iOS) and intent
   filters (Android) — requires the Apple Team ID / Android signing fingerprint from owner.

Codex writes all the code regardless; mark DoD items needing the above as ❌ "pending live
config" rather than faking them (AGENTS.md §3).

---

## 4. Model A architecture

### 4.1 The single link
- Canonical: `https://<web-host>/r/<CODE>` (plus a QR of the same URL).
- Sales-portal and partner workspace show exactly this one link/QR. No per-channel links.

### 4.2 Landing `app/r/[ref_code].tsx` (the router)
On open it must:
1. `storeReferralCode(code)` via the cross-platform store (Task 1).
2. Detect environment and act:
   - **Inside LINE in-app browser** (`liff.isInClient()` or UA contains `Line/`) → redirect
     straight to the LIFF bind route `/line-referral?ref=<CODE>`.
   - **Native app already open** (this route hit via deep link) → store + route to chat/checkout.
   - **Mobile web** → attempt to open the app via Universal/App Link; always render fallback
     CTAs.
   - **Desktop web** → store + CTA to start chat on web.
3. Always render 3 explicit CTAs as fallback: **เปิดในแอป** (Universal/App Link),
   **คุยต่อทาง LINE** (→ `https://liff.line.me/<LIFF_ID>?ref=<CODE>`), **เล่นต่อบนเว็บ**
   (→ chat/checkout).

### 4.3 LIFF route `app/line-referral.tsx` (new)
1. Load LIFF SDK, `liff.init({ liffId })` (liffId from public config per tenant).
2. `liff.login()` if not logged in.
3. Read `ref` from query; get the LIFF **ID token** (`liff.getIDToken()`).
4. POST `{ tenant_slug, ref_code, id_token }` → `line-referral-bind`.
5. On success → `liff.openWindow` to the OA chat (or `liff.closeWindow()` with a success note).

### 4.4 Backend `supabase/functions/line-referral-bind/index.ts` (new, additive)
1. Validate body (zod) in a new `_shared/lineReferralBind.ts` schema.
2. **Verify the LIFF ID token server-side** against
   `https://api.line.me/oauth2/v2.1/verify` (never trust a client-sent userId). Extract `sub`
   = the trusted `line_user_id`.
3. Resolve tenant; upsert `customers` by `(tenant_id, line_user_id)`.
4. Apply the SAME guard as `maybeApplyReferralCode`: only set `referred_by`/`referred_at` if
   the code is active/valid AND the customer is not already referred; respect
   `attribution_window_days`. Reuse helpers from `_shared/orchestrate.ts` / `_shared/referrals.ts`
   — do not duplicate the rule.
5. Deploy note: `--no-verify-jwt` (LIFF calls it without a Supabase JWT), same as `line-webhook`.

### 4.5 `orchestrateLine` ref_code threading (additive)
Extend `orchestrateLine` to accept optional `ref_code` and pass it through from
`line-webhook` (covers in-session codes). Additive param; schema already allows
`channel:'line'` + the `ref_code` pattern. Do not script any Thai reply text in this path.

### 4.6 What stays untouched (reused as-is)
`referred_by` attribution, `resolveAttributedReferrerId` crediting at order creation,
commission creation on admin confirm, `referrer-order`. LINE simply feeds the existing pipe.

---

## 5. Task breakdown for Codex (one PR each, in order)

### Task 1 — Cross-platform attribution store  ·  (foundation)
- Files: `lib/referrals/attribution.ts` (+ callers `app/r/[ref_code].tsx`, `lib/ai/miraChat.ts`).
- Keep the exported interface names. Web: localStorage + cookie unchanged. Native: persist via
  `expo-secure-store` (already in `app.json` plugins), key `mira_ref`, same 30-day envelope.
- Make `readStoredReferralCode` async (D5); update callers to await.
- DoD: native unit test stores+reads a code; web behavior unchanged.

### Task 2 — Unify deep links + Model A smart landing
- Files: `app/r/[ref_code].tsx`, `app.json`, `lib/marketplace/referralMock.ts` (kill `mira://`),
  new public config for `EXPO_PUBLIC_WEB_ORIGIN`.
- Unify scheme to `mirahealth://` everywhere; configure Universal Links (`associatedDomains`)
  + Android App Links so `https://<web-host>/r/<code>` opens the app when installed.
- Implement §4.2 routing + 3 CTAs; handle Expo Linking cold-start initial URL.
- DoD: installed app opens from the https link and stores the code; desktop/mobile web render
  the correct CTAs. (App-link OS routing = ❌ pending live config from §3.3.)

### Task 3 — LINE LIFF binding (D1/D6)
- Files: `app/line-referral.tsx` (new), `supabase/functions/line-referral-bind/index.ts` (new),
  `supabase/functions/_shared/lineReferralBind.ts` (new schema),
  `supabase/functions/_shared/orchestrate.ts` (additive `ref_code` param),
  `supabase/functions/line-webhook/index.ts` (thread `ref_code`), docs/line-setup.md.
- Implement §4.3 / §4.4 / §4.5. Verify ID token server-side. Reuse attribution guard.
- DoD: with a valid LIFF ID token, the bind sets `customers.referred_by`; a subsequent LINE
  purchase is attributed and a `commission_entries` row appears on admin confirm.
  (Live LIFF run = ❌ pending §3.2.)

### Task 4 — sales-portal real wiring + mock retirement (D2)
- Files: `app/sales-portal.tsx`, `lib/marketplace/referralMock.ts`, `app/staff-referral.tsx`.
- Load the signed-in referrer from `referrers` (by `tenant_id` + `auth_user_id`); call
  `referrer-order` (`create_order` → `payment_done`) exactly like `app/partner.tsx` (reuse its
  helpers, don't duplicate). Replace fixture commission dashboard with real
  `commission_entries` reads. Do not add a not-signed-in fixture fallback; show login/setup state instead.
- Show ONE share link/QR = `https://<web-host>/r/<realRefCode>` (real 6-char DB code).
- Retire `referralMock.ts` code generation (reduce to pure formatting helpers or delete).
  Decide `staff-referral.tsx`: keep redirect to `/sales-portal`.
- DoD: a code shown in sales-portal passes `REF_CODE_PATTERN` and resolves to a real referrer;
  an assisted order creates a real DB order in the admin queue.

### Task 5 — Verification & bookkeeping
- `npm run typecheck` + `npm run v2:verify` green.
- Tests: native attribution store; `line-referral-bind` (token verify + attribution guard, in
  `_shared/__tests__`); `orchestrateLine` ref_code threading.
- Update `docs/line-setup.md` (add a LIFF referral step + `LINE_LIFF_ID__<slug>`), and the DoD
  checkboxes in `docs/miracare-v2-product-plan.md` §10 truthfully.

---

## 6. Protected-core guardrails (AGENTS.md §2)

- No new order statuses; status changes only via `transition_order`.
- New schema (if any) ships in a NEW migration file with RLS in the same file; never edit
  existing migrations.
- `ChatOrchestratorRequest` / order / action schema changes are additive and mirrored in
  `lib/types/api.ts` (CI enforces the mirror).
- No Thai sales/conversation lines in the reply path; any LINE referral copy is a templated
  system notice only.
- Agent does not deploy functions, set Supabase secrets, or configure LINE/LIFF/Apple/Android
  consoles — those are owner steps documented in §3.

---

## 7. Open items still needing an owner answer (non-blocking for coding, blocking for live)

1. Canonical web host for `/r/<code>` + LIFF endpoint (§3.1).
2. LIFF app + `LINE_LIFF_ID__<slug>` provisioning (§3.2).
3. Apple Team ID / Android signing fingerprint for Universal/App Links (§3.3).
4. `sales-portal` fallback when not signed in: do not show fixture data. Show login/setup state only.

---

## 8. DoD checklist (fill ✅/❌ + date in each Task PR)

- [x] ✅ 2026-06-16 — T1. Native attribution store persists + reads `ref_code`; read is async; web cookie/localStorage path remains covered.
- [ ] ❌ 2026-06-16 — T2. `mirahealth://` and app-link config/link audit are in place, but the LINE/3-CTA smart landing and live OS app-link routing remain pending owner config.
- [ ] ❌ 2026-06-16 — T3. LIFF route + `line-referral-bind` remain pending; this PR does not implement the LINE owner-console work.
- [ ] ❌ 2026-06-16 — T4. sales-portal is wired to real referrer data, self-provision, `referrer-order`, single `EXPO_PUBLIC_WEB_ORIGIN` share link/QR, and real `commission_entries`; live assisted-order/admin-queue E2E still needs to be rerun after deployment.
- [ ] ❌ 2026-06-16 — T5. `typecheck` + `v2:verify` are green and referral tests/audits were added; LINE setup docs/v2 §10 bookkeeping are still pending with the LIFF task.
