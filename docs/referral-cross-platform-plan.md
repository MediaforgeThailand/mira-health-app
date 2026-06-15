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
| Chat attribution | `applyReferralCodeToCustomer` + `resolveAttributedReferrerId`; request schema accepts `ref_code` on `app`/`pwa` | `supabase/functions/_shared/orchestrate.ts`, `_shared/referrals.ts` |
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

- [✅ 2026-06-13] T1. Native attribution store persists + reads `ref_code`; read is async; web unchanged. Evidence: `lib/referrals/attributionCore.ts`, `lib/referrals/attribution.ts`, `npm run referrals:store-test`, `npm run v2:verify`.
- [❌ 2026-06-13] T2. `mirahealth://` unified; smart landing routes web/app + renders 2 CTAs; cold-start handled. Code/config is in place (`app/r/[ref_code].tsx`, `app.config.js`, `EXPO_PUBLIC_WEB_ORIGIN`), and `npm run referrals:link-audit` confirms `mirahealth://r/<code>`, `mirahealth:///r/<code>`, and `https://<host>/r/<code>` resolve to the same Expo Router path. Installed-app https handoff remains pending owner live config for canonical host, AASA, Android asset links, Apple Team ID, and Android signing fingerprint.
- [❌ 2026-06-13] T3. sales-portal uses real referrer + `referrer-order` + single share link; mock generator retired. Code path is complete and mock generator exports are retired, but the live DB proof that an assisted order appears in the admin queue is pending a signed-in referrer account/linked environment.
- [✅ 2026-06-13] T4. typecheck + v2:verify green; tests added; v2 plan §10 updated. Evidence includes `npm run referrals:store-test`, `npm run referrals:link-audit`, and `npm run v2:verify`.
- [✅ 2026-06-15] T5. Anonymous-click auth-time bind complete: shared first-touch bind helper, auth-gated `referral-bind`, client best-effort login/signup hook, mirrored types, and full `npm run v2:verify` green.

---

## 9. Finalization work order — CONTINUE HERE (2026-06-13)

Tasks 1–4 are implemented in the working tree of `codex/referral-cross-platform` and
`npm run typecheck` passes. Review confirms faithful execution (async SecureStore store,
`mirahealth://` + `EXPO_PUBLIC_WEB_ORIGIN` smart link, sales-portal wired to `referrer-order`,
mock generators retired, DoD marked truthfully). The items below close the job.
**F1–F6 need no owner input — do them today.** The "Blocked on owner" list cannot be closed
without config; leave those DoD items ❌.

### F1 — Repo hygiene (artifacts must not be committed)
- `.gitignore` covers `.codex-*.log` / `.codex-logs/` but NOT the new dirs. Add
  `.codex-figma-captures/`, `.codex-test-artifacts/`, `.codex-web-dist/`.
- Remove those dirs from the working tree. `.codex-web-dist` holds a stale web bundle that
  still references the deleted mock symbols — do not let it ship.

### F2 — Confirm deep-link scheme + cold start (verification)
- `app.json` already declares `scheme: "mirahealth"` ✓ — confirm `mirahealth://r/<code>` AND
  `https://<host>/r/<code>` both resolve to `app/r/[ref_code].tsx`.
- Verify Expo Router handles the **cold-start initial URL** (app launched from a killed state
  via the link still stores the code). Document the manual steps (or add a test) in the PR.

Codex evidence 2026-06-13: `npm run referrals:link-audit` asserts Expo Router's native
link extractor maps `mirahealth://r/DRNK22`, `mirahealth:///r/DRNK22`, and
`https://care.example.test/r/DRNK22` to `r/DRNK22`, and that `app.config.js` derives iOS
associated domains + Android App Links from `EXPO_PUBLIC_WEB_ORIGIN`. Manual device
cold-start check for owner after config: install a build, kill the app, open
`mirahealth://r/<valid_ref_code>`, confirm `/r/[ref_code]` stores the code, then send a chat
message and verify the request includes `ref_code`.

### F3 — Scaffold App/Universal Link association files (unblocks owner step)
- Create `public/.well-known/apple-app-site-association` and `public/.well-known/assetlinks.json`
  as templates with documented placeholders: `<APPLE_TEAM_ID>`, `<IOS_BUNDLE_ID>`,
  `<ANDROID_PACKAGE>`, `<ANDROID_SHA256_FINGERPRINT>`. Add a one-line note that they must be
  hosted at the `EXPO_PUBLIC_WEB_ORIGIN` host root. Do not invent secret values.

### F4 — Full gate run
- Run `npm run v2:verify` end-to-end and fix any red. If an audit needs adjustment, fix the
  cause — never weaken an audit to go green (AGENTS.md §3). Refresh §8/§10 DoD evidence.

### F5 — Scope-drift check on extra files
- Justify or trim changes beyond the 4 named task files: `lib/showcase/registry.ts`,
  `lib/showcase/demoFixtures.ts`, `scripts/v2-client-audit.mjs`, `docs/mira-landing-plan.md`,
  `docs/miracare-showcase-frontend-plan.md`. They look necessary (register sales-portal as
  LIVE + demo referrer fixtures) — confirm minimal and list them in the PR description.

Codex review 2026-06-13: kept the extra-file changes because they are minimal referral-only
alignment: showcase fixtures/docs moved from legacy invalid `DRNOK2` to Crockford-valid
`DRNK22`, showcase registry points the demo referral entry at the valid code, and
`v2-client-audit` now asserts the async attribution API instead of the old sync snippets.

### F6 — Commit + PR
- Commit the working tree on `codex/referral-cross-platform`, ideally split into commits
  matching T1–T4 (+ one for F1–F5), each message referencing the plan task. Open the PR with a
  summary + the DoD checklist state.

### Blocked on owner (leave DoD ❌, document in PR — NOT closeable today)
1. Canonical web host → set real `EXPO_PUBLIC_WEB_ORIGIN`.
2. Apple Team ID + Android SHA-256 signing fingerprint → fill F3 templates + app config.
3. Host `.well-known/*` on the web host; verify Universal/App Link OS routing on a device.
4. Live assisted-order proof: signed-in referrer → `create_order` → admin confirm →
   `commission_entries` row in the admin queue (closes T3).

### Finalization DoD
- [✅ 2026-06-13] F1. Artifact dirs gitignored + removed from tree.
- [✅ 2026-06-13] F2. `mirahealth://` + `https` both route to `/r/[code]`; cold-start routing path verified by `npm run referrals:link-audit`.
- [✅ 2026-06-13] F3. `.well-known` association templates added with placeholders.
- [✅ 2026-06-13] F4. `npm run v2:verify` green.
- [✅ 2026-06-13] F5. Extra-file changes justified/trimmed and documented.
- [✅ 2026-06-13] F6. Committed (split by task) + PR opened: https://github.com/MediaforgeThailand/mira-health-app/pull/13.

---

## 10. Backend work order — bind referral on auth (anonymous-click flow) (2026-06-15)

### Goal
A customer clicks a referral link **while logged out (anonymous)**, then signs up / logs in.
The referral must be bound to that customer **the instant auth completes** — NOT deferred to
their first chat message. Backend-only; no mobile/Universal-Link dependency.

### Why this is needed (current gap)
- `/r/<code>` already stores the code client-side (cross-platform store). ✅
- Before this work, `customers.referred_by` was only written inside `maybeApplyReferralCode`, which ran
  during the **first chat message** (`supabase/functions/_shared/orchestrate.ts:1183`). So a
  user who logs in but does not immediately chat stays unbound.
- There is no bind trigger on login/signup. **That trigger is the work here.**

### Owner decisions (locked)
- **D7 — Anonymous-first.** Most clicks are logged-out. Earliest possible bind = the moment
  login/signup succeeds. Click-time binding is impossible (no `auth_user_id` yet) — do not try.
- **D8 — Keep existing attribution rules.** First-touch: if `customers.referred_by` is already
  set, never overwrite. Only active codes bind. The 30-day window stays enforced at ORDER time
  via `resolveAttributedReferrerId` (do NOT add a window check at bind time — match current
  behavior exactly).

### Guardrails (AGENTS.md)
- **No schema/migration change** — `referred_by` / `referred_at` already exist.
- Do not touch the protected core (prompt, markers, order state machine, `transition_order`)
  or the LINE path.
- New cross-platform request/response types must be mirrored in BOTH
  `supabase/functions/_shared/types.ts` and `lib/types/api.ts` (CI `types:mirror-audit`).
- Reuse the existing binding rules — do not fork the logic (see R1).

### Tasks (one PR, in order)

**R1 — Extract the bind rule into one shared function**
- Move the body of `maybeApplyReferralCode` (active-code lookup + `!customer.referred_by`
  first-touch guard + write `referred_by`/`referred_at`) into a shared helper in
  `supabase/functions/_shared/referrals.ts`, e.g.
  `applyReferralCodeToCustomer(customer, tenant, refCode): Promise<CustomerRow>`.
- `orchestrate.ts` calls the shared helper instead — **chat behavior must be unchanged.**
- DoD: existing chat/attribution tests still pass; rule lives in exactly one place.

**R2 — New edge function `referral-bind`**
- `supabase/functions/_shared/referralBind.ts`: zod schema `{ tenant_slug, ref_code }`
  (`ref_code` uses the existing `^[0-9A-HJKMNP-TV-Z]{6}$` pattern).
- `supabase/functions/referral-bind/index.ts`: POST only; **JWT verification ON** (needs the
  caller's auth). Flow: `resolveAuthUserId(authorization)` → `resolveOrCreateCustomer` →
  `applyReferralCodeToCustomer` → return `{ bound: boolean, already_referred: boolean }`.
- Invalid/inactive code → return `{ bound: false }` (200), do not 500. Idempotent: a customer
  already referred returns `already_referred: true` and is left untouched.
- DoD: calling with a valid code sets `referred_by`; second call is a no-op; inactive code is
  a safe no-op.

**R3 — Client: bind on login/signup**
- In `lib/auth/useAuthSession.ts`, after `signInWithEmailPassword` / `signUpWithEmailPassword`
  succeed and `ensureProfile` runs, read `await readStoredReferralCode()`; if present, call
  `invokeFunction('referral-bind', { tenant_slug, ref_code })` **best-effort** (failure must
  NOT block login; swallow + optionally log).
- Also attempt the bind once when an already-authenticated session is detected with a stored
  code (covers "logged in earlier, clicked link later"). Guard against duplicate calls.
- DoD: log in with a stored code and no chat → `customers.referred_by` is set immediately.

**R4 — Mirror types**
- Add the `referral-bind` request/response types to `_shared/types.ts` and `lib/types/api.ts`;
  `npm run types:mirror-audit` green.

**R5 — Tests + verify + bookkeeping**
- Unit-test the shared helper: first-touch no-overwrite, inactive/unknown code = no-op,
  fresh customer binds. Add a `referral-bind` deno test if it fits existing patterns.
- `npm run typecheck` + `npm run v2:verify` green.
- Add a §8 DoD line for this work; update `docs/miracare-v2-product-plan.md` §10 if relevant.

### What stays as-is
Chat-path binding remains as a **safety net** (now via the R1 shared helper, behavior
unchanged). `/r/<code>` keeps storing the code. No change to commission creation or the
attribution window.

### DoD checklist (fill ✅/❌ + date in the PR)
- [✅ 2026-06-15] R1. Bind rule extracted to `_shared/referrals.ts`; chat behavior unchanged via `applyReferralCodeToCustomer`.
- [✅ 2026-06-15] R2. `referral-bind` edge function (auth-gated, idempotent, safe on bad codes) added and included in Deno/deploy/edge audits.
- [✅ 2026-06-15] R3. `useAuthSession` binds stored code on login/signup and existing-session detection (best-effort, non-blocking).
- [✅ 2026-06-15] R4. Types mirrored; `npm run types:mirror-audit` green.
- [✅ 2026-06-15] R5. Tests added; `npm run typecheck` + `npm run v2:verify` green; DoD updated.

---

## 11. Backend work order — referrer self-service (zero-input code) (2026-06-15)

### Goal
A logged-in **tenant member** (doctor/staff = `tenant_staff` or `tenant_admin`) can generate
their own referral code with **zero data entry** — one tap, no form. The code is then shared
with customers; the existing bind-on-auth + attribution + commission pipeline (§10, v2 §5)
takes it from there.

### Owner decision — reverses a prior DECIDED non-goal
`docs/miracare-v2-product-plan.md` §5.2 previously said "no referrer self-signup (admin
creates referrers)." **Owner (taksin/MediaForge) reverses this on 2026-06-15** for tenant
members only. Update that line in §5.2 in the same PR (owner-approved). Locked sub-decisions:
- **D9 — Eligibility = tenant membership.** Only users present in `tenant_members`
  (`tenant_staff` / `tenant_admin` / `superadmin`) for the tenant may self-provision. No new
  "doctor" role; if a doctor needs a code, an admin adds them as `tenant_staff` first.
- **D10 — Rate = tenant default.** Self-provisioned referrers get the existing
  `referrers.commission_scheme` DB default (`{"mode":"percent","default":10,"by_category":{}}`).
  Do not collect a rate. Admin can edit later via the existing admin referrer screen.
- **D11 — Active immediately.** New self-provisioned referrer rows are `active = true` at once.

### Why this is small
`referrers` already has everything needed — `commission_scheme` defaults to 10% in the DB,
`ref_code` auto-generates via the `referrers_ref_code_guard` trigger, and `referrers_own_read`
RLS already lets a user read their own row. **No migration / no schema change.** The only
blocker is `referrers_admin_insert` RLS (admin-only insert) → bypass it through a service-role
edge function that enforces eligibility itself (sanctioned pattern, AGENTS.md §2).

### Tasks (one PR, in order)

**S1 — Edge function `referral-self-provision`**
- `supabase/functions/_shared/referralSelfProvision.ts`: zod schema `{ tenant_slug }`.
- `supabase/functions/referral-self-provision/index.ts`: POST only; **JWT verification ON**.
  Flow:
  1. `resolveAuthUserId(authorization)` → `assertTenant(tenant_slug)`.
  2. **Eligibility check (explicit — service role bypasses RLS):** select
     `tenant_members` where `(tenant_id, auth_user_id)`; if none → `403`.
  3. **Idempotent:** select existing `referrers` by `(tenant_id, auth_user_id)`; if found,
     return it (do not create a second).
  4. Else `insertRow('referrers', { tenant_id, auth_user_id, name, type: 'staff', active: true })`
     — omit `commission_scheme` (DB default 10%) and `ref_code` (trigger generates).
     - `name`: derive with zero input — read `profiles` (`display_name` / `full_name`) for the
       auth user; fall back to the auth email handle; final fallback `'Staff referrer'`.
     - `type`: `'staff'` (the `referrers.type` check allows doctor/nurse/creator/staff; rate is
       uniform per D10 so the distinction is cosmetic — keep `'staff'`).
  5. Return `{ ref_code, referrer_id, created: boolean }`.
- DoD: a tenant member with no referrer gets a code; second call returns the same code
  (`created:false`); a non-member gets 403.

**S2 — Mirror types**
- Add `ReferralSelfProvisionRequest` / `ReferralSelfProvisionResponse` to
  `supabase/functions/_shared/types.ts` and `lib/types/api.ts`; `types:mirror-audit` green.

**S3 — Wire into deploy + audits**
- Add `referral-self-provision` to `scripts/deploy-v2-functions.ps1` **without**
  `--no-verify-jwt`, to the `v2:deploy-script-audit.mjs` allowlist, the
  `v2-edge-security-audit.mjs` map, and the `v2:deno-check` function list.

**S4 — Frontend: one-tap create**
- In `app/sales-portal.tsx` (and `app/partner.tsx` if it shares the path): when the referrer
  lookup by `auth_user_id` returns none AND the signed-in user is a tenant member, render a
  **"สร้าง referral code ของฉัน"** button → calls `referral-self-provision` → reloads the
  referrer → shows the existing single share link/QR (`createReferralShareLink(ref_code)`).
  No form fields. If a referrer already exists, skip the button (current behavior).
- Keep the not-signed-in demo fallback as-is.
- **Mobile-first requirement:** referral self-service must be designed from the mobile viewport
  up. The one-tap create button, share link, QR/code display, and signed-in/error states must
  be usable on phone widths without relying on a desktop two-column layout.

**S5 — Tests + verify + bookkeeping**
- Extract the provision core (eligibility + idempotent insert) so it is unit-testable with DI,
  mirroring `applyReferralCodeToCustomer`. Test: non-member denied, fresh member creates with
  default 10% scheme + generated code, second call idempotent.
- `npm run typecheck` + `npm run v2:verify` green.
- Update `docs/miracare-v2-product-plan.md` §5.2 non-goal line (owner-approved reversal) and
  add a §8/§10-style DoD line here.

### Guardrails (AGENTS.md)
- **No migration / schema change** — reuse `referrers` (default scheme + ref_code trigger).
- Service-role usage stays inside the edge function; eligibility enforced in code, not RLS.
- JWT verification ON for the new function.
- Cross-platform types mirrored (`types:mirror-audit`).
- Do not touch the protected core, order state machine, or the LINE path.

### DoD checklist (fill ✅/❌ + date in the PR)
- [x] ✅ 2026-06-15 S1. `referral-self-provision` edge function (auth-gated, eligibility-checked, idempotent).
- [x] ✅ 2026-06-15 S2. Types mirrored; `types:mirror-audit` green.
- [x] ✅ 2026-06-15 S3. Deploy script (JWT on) + deploy/edge/deno audits updated.
- [x] ✅ 2026-06-15 S4. sales-portal one-tap "create my code" wired; zero input; shows single share link; mobile-first states added.
- [x] ✅ 2026-06-15 S5. Tests added; `typecheck` + `v2:verify` green; v2 §5.2 non-goal updated (owner-approved).

---

## 12. Admin work order — tenant member management UI (2026-06-15)

### Goal
Give tenant admins a screen to see and manage who belongs to the tenant and their role
(`tenant_staff` / `tenant_admin`). Today `tenant_members` can only be edited via SQL / the
Supabase console — there is **no admin UI** (verified: `app/admin/*` has orders, catalog,
branches, referrers only).

### Why it pairs with §11 (build this first)
§11 self-service eligibility = tenant membership (D9). Without a member-management UI an admin
cannot add a doctor/staff as `tenant_staff`, so they can never self-provision a code. §12 closes
the loop: **admin adds member (§12) → member self-provisions code (§11).** Recommended order:
ship §12 then §11 (they are independent but §12 is the practical prerequisite).

### Decisions (defaults — change only if owner objects)
- **D12 — Access:** `tenant_admin` / `superadmin` only.
- **D13 — Add existing signed-up users by email (MVP).** Inviting brand-new users (auth account
  creation + invite email) is a follow-up, NOT in this PR. If the email has no auth account,
  return a clear "ask them to sign up first" message.
- **D14 — Assignable roles:** `tenant_staff`, `tenant_admin` only. `superadmin` is not
  assignable from this UI.
- **D15 — Lockout guard:** cannot remove or demote the last `tenant_admin`; confirm prompt on
  self-demote / self-remove.

### Why no schema change
`tenant_members` already exists with RLS (`tenant_members_admin_all` lets admins write,
`tenant_members_self_read`). No migration. An edge function is still needed because (a) mapping
an email → `auth_user_id` requires the Supabase **auth admin API** (auth.users is not
client-readable) and (b) the list must show email/name and the last-admin guard must be
enforced server-side.

### Tasks (one PR, in order)

**M1 — Edge function `admin-members`**
- `supabase/functions/_shared/adminMembers.ts`: zod discriminated union on `action` —
  `list` | `add {email, role}` | `set_role {auth_user_id, role}` | `remove {auth_user_id}`,
  each with `tenant_slug`.
- `supabase/functions/admin-members/index.ts`: POST only, **JWT verification ON**. Every action:
  1. `resolveAuthUserId(authorization)` → `assertTenant(tenant_slug)`.
  2. **Admin gate (explicit — service role bypasses RLS):** caller must be `tenant_admin` /
     `superadmin` in this tenant → else `403`.
  3. Dispatch:
     - `list`: select `tenant_members` for the tenant; enrich each with email (auth admin
       lookup) + `profiles.display_name`. Return `[{ auth_user_id, email, name, role }]`.
     - `add`: resolve auth user by email; none → `404` "user must sign up first"; else upsert
       `tenant_members (tenant_id, auth_user_id, role)` (idempotent).
     - `set_role`: validate role ∈ {`tenant_staff`,`tenant_admin`}; update.
     - `remove`: delete; **block if it removes the last `tenant_admin`** (count check) → `409`.
- DoD: non-admin → 403; add existing user works + idempotent; last-admin removal blocked.

**M2 — Mirror types**
- `AdminMembersRequest` / `AdminMembersResponse` (member row shape) in
  `_shared/types.ts` + `lib/types/api.ts`; `types:mirror-audit` green.

**M3 — Deploy + audits**
- Add `admin-members` to `scripts/deploy-v2-functions.ps1` **without** `--no-verify-jwt`, plus
  the `v2:deploy-script-audit`, `v2-edge-security-audit`, and `v2:deno-check` lists.

**M4 — Frontend `app/admin/members.tsx` + `components/admin/AdminMembers.tsx`**
- Admin-only gate (reuse the `tenant_members` role check pattern from
  `components/admin/ReferrersAdmin.tsx`).
- List members (name, email, role); add-by-email form with a role select; change-role control;
  remove with confirm + lockout message. Thai UI, `MiraDesign` tokens, calls `admin-members`.
- Add a tile/link in `app/admin-panel.tsx`.

**M5 — Tests + verify + bookkeeping**
- Unit-test the core with DI: admin gate, add idempotency, last-admin guard.
- `npm run typecheck` + `npm run v2:verify` green; register the route if `showcase:route-audit`
  requires it; update `docs/miracare-v2-product-plan.md` §6 (Admin Panel) to list the new
  member-management screen.

### Guardrails (AGENTS.md)
- Admin-gated; tenant-scoped; service role only inside the function.
- No schema change (reuse `tenant_members` + RLS). JWT on. Types mirrored.
- Lockout guard mandatory (no tenant can be left without an admin).
- Do not touch the protected core, order state machine, or the LINE path.

### DoD checklist (fill ✅/❌ + date in the PR)
- [x] ✅ 2026-06-15 M1. `admin-members` edge function (admin-gated; list/add/set_role/remove; last-admin guard).
- [x] ✅ 2026-06-15 M2. Types mirrored; `types:mirror-audit` green.
- [x] ✅ 2026-06-15 M3. Deploy script (JWT on) + deploy/edge/deno audits updated; live deploy not run by agent.
- [x] ✅ 2026-06-15 M4. `admin/members` screen + admin-panel link; admin-only; add-by-email + role + remove.
- [x] ✅ 2026-06-15 M5. Tests added; `typecheck` + `v2:verify` green; v2 §6 updated.

---

## Build order for §11 + §12 (handoff summary)
1. **§12 (M1–M5)** — admin member-management UI → admins can onboard doctors/staff as
   `tenant_staff`.
2. **§11 (S1–S5)** — referrer self-service → onboarded members tap once to get their code.
Independent PRs; §12 first makes §11 usable end-to-end. Both reuse existing tables (no
migration), keep service-role inside edge functions, JWT on, types mirrored.
