# MiraCare v3 Follow-ups Plan — Referral repair, form facts, PDPA, prompt-flip support (NO LINE)

Audience: Codex (implementation agent) + product owner (audit).
Status: APPROVED by owner 2026-06-12 (this document IS the owner-approved plan required by `AGENTS.md` §2 for the specific protected-core touches listed in §1.2 below — nothing else in the core may be touched).

Companion documents:
- `AGENTS.md` — hard rules. Applies in full.
- `docs/miracare-codex-handoff.md` — model contract (PRIME DIRECTIVE). Nothing in this plan changes the conversation contract.
- `docs/miracare-v3-chat-commerce-plan.md` — v3 plan. V3-0..V3-2 are merged and audited; this plan closes what that audit left open.
- `docs/v3-audit-report-2026-06-12.md` — findings F1/F2/N1/N2/N3 referenced below.
- `docs/miracare-v2-product-plan.md` §10 — the v2 audit checklist items still marked ❌ that this plan closes.

Workflow: same as v2/v3 — Codex implements phase by phase (one PR per phase, branch `codex/<phase-id>-<slug>`), keeps the DoD checkboxes in THIS file updated (✅/❌ + date) in the same PR, owner audits against §8.

---

## 0. What the owner wants (read first)

The core product is three pillars sharing one catalog:

1. **AI Chat** — sells and closes payment in-chat. v3 chat commerce is DONE and live-verified.
2. **Referral** — referrers share links AND can book a product for a customer on the spot (assisted purchase) through the same Programs/catalog.
3. **Catalog** — single `products` + `branches` + `product_categories` source feeding both. DONE.

The 2026-06-12 owner-side audit found that pillar 2's assisted purchase is **broken in production schema** (R1 below) and several decided-but-unbuilt or audit-flagged items remain. This plan finishes everything that remains **except LINE** (V3-4, findings F2 + N1 stay parked until LINE credentials exist — do NOT build any LINE code in this run).

Priority order is the phase order. R1 is a production-path bug: do it first, alone, in the smallest possible PR.

### 0.1 Explicitly OUT of scope for this run

- **LINE anything**: no `lineCards.ts`, no postback changes, no LIFF, no fixes to `callOrderFieldExtractor` age extraction (that is V3-4 / F2 / N1). If a change you make would alter LINE behavior, stop and report.
- **Stripe tenant feature flag** (N2): stays hardcoded-off.
- **Prompt content / platform default version**: owner-only. R3 defines the exact split.
- Showcase plan phases (separate run, largely delivered).
- Customer self-service PDPA UI in the account screen (R4 ships edge functions + admin trigger; self-service button is a later, trivial add).

### 0.2 Protected-core touches authorized by this plan (and ONLY these)

| File / area (AGENTS.md §2 row) | Authorized change | Phase |
|---|---|---|
| `_shared/facts.ts` (Facts & PDPA) | Add optional `source` parameter to `insertFactsIdempotent` (default `'chat_extraction'`, additive) + new `recordFormAgeFact` helper. Append-only + supersede semantics unchanged. | R2 |
| `consents` usage (Facts & PDPA) | Read-only consent gate reuse in R2; new PDPA export/delete functions in R4 (deletes are customer-requested erasure, not a weakening of consent gating). | R2, R4 |
| `docs/miracare-codex-handoff.md` | Codex DRAFTS the v3 edits in the R3 PR; the owner merging that PR is the owner change. Codex never edits prompt content in the Platform. | R3 |

Everything else in §2 of AGENTS.md (openai.ts, marker.ts, orchestrate purchase guard, `transition_order`, promptpay/commissions, migrations-additive, conversation purity, medical safety) is NOT touched by this plan. In particular: **R1 deliberately does NOT modify `transition_order`** — see §1.2.

---

## 1. Current state (verified in repo 2026-06-12 — do not re-derive)

### 1.1 What is done (do not rebuild)

| Pillar | State |
|---|---|
| Chat commerce v3 (V3-0..V3-2) | Merged, audited APPROVED. ProductGrid / CategoryGrid / BranchPicker / BookingSheet / OrderStatusCard / `/orders` all live; e2e + 10/10 v3 regression green on staging pinned to prompt v3. |
| Catalog | `products` + `branches` + `product_branches` + `product_categories` with RLS; admin CRUD incl. branches screen and booking modal. |
| Referral (link path) | `referrers`, Crockford `ref_code`, `/r/[ref_code]` attribution (30-day last-touch), commission ledger from `orders.commission_scheme_snapshot`, admin referrer/commission screens. Attributed *chat* purchase passes e2e. |
| Deploy hardening | N3 closed: `scripts/deploy-v2-functions.ps1` forces UTF-8 console + verifies bundle encoding (commit `7b0166b`). |

### 1.2 THE BUG (R1) — assisted purchase broken since V3-1

- Migration `20260612050000_miracare_v3_phase1_data_admin.sql` (line ~258) redefined `transition_order` so `collecting_info → awaiting_payment` requires `buyer_name` AND `buyer_phone` AND **`buyer_age`**.
- `supabase/functions/referrer-order/index.ts` `create_order` collects only name + phone (zod schema lines 16–24, insert lines 101–116) and immediately calls `transition(order.id, 'awaiting_payment', ...)` (line 118).
- `orders.status` defaults to `'collecting_info'` (migration `20260611030000`, line 15).
- → every assisted purchase now throws `ILLEGAL_TRANSITION` at the DB. The referrer cannot book anything.
- `app/partner.tsx` has no age field (state lines 66–76) and no branch selection; `orders.branch_id` stays null on this path.
- `scripts/e2e-commerce.mjs` never calls the `referrer-order` function (it only tests the *attributed chat* purchase, which collects age in the BookingSheet) — that is why CI stayed green.

**DECIDED by owner 2026-06-12: fix approach = collect the age (option ก).** The referrer is standing next to the buyer; asking age is trivial, keeps buyer info complete for the admin call-back, and feeds R2. Option ข (waiving `buyer_age` for `channel='referrer'` inside `transition_order`) is REJECTED — do not touch the state machine. Do not re-ask.

### 1.3 Remaining open items this plan closes

| Item | Source | Phase |
|---|---|---|
| Assisted purchase broken (`buyer_age`) + no branch + no e2e coverage | this audit | R1 |
| F1: form age → `user_facts` (consent-gated) — decided §11.3 of v3 plan, unimplemented | v3 audit F1 | R2 |
| V3-3: prompt default flip + handoff doc + remove env pin | v3 plan §2.4 / §8 | R3 (owner-gated) |
| PDPA export & hard-delete functions | v2 plan §7.5; v2 audit C ❌ | R4 |
| Wearable facts have `source_ref: null` (no import entity) | v2 audit C ❌; `wearable-ingest/index.ts:58` | R5 |
| Known-user proof (facts from a previous session used, not re-asked) | v2 audit E ❌ | R6 |

---

## 2. Phase R1 — Repair assisted purchase (referral books through Programs)  **[DO FIRST, SMALLEST POSSIBLE PR]**

### 2.1 Backend — `supabase/functions/referrer-order/index.ts`

1. **Schema** (`create_order` variant) — add:
   - `buyer_age: z.number().int().min(1).max(120)` (REQUIRED — same bounds as the chat `order_form_submit` action and the DB check constraint).
   - `branch_id: z.string().uuid().optional()`.
2. **Branch resolution** (mirror the logic of `createOrderFromProduct` in `_shared/orchestrate.ts`, but synchronous within this request — no `selecting_branch` status on this path, the referrer picks before submit):
   - Load active branches for the product via `product_branches` joined to `branches` (`active=true`, tenant-scoped) — reuse/extract the existing helper used by the orchestrator (`activeBranchForProduct` family) into `_shared` if it is not already importable; do not duplicate the query logic.
   - 0 branches (legacy product) → `branch_id = null` (admin queue already renders "ไม่ระบุสาขา").
   - Exactly 1 → auto-assign it; ignore any client-sent `branch_id` that doesn't match (validation error if mismatched, silent assign if absent).
   - More than 1 → `branch_id` is REQUIRED and must be one of them; otherwise `HttpError('VALIDATION', 'branch_id is required for this product.', 400)`.
   - Cross-tenant / non-product branch ids must be rejected (same validation level as `select_branch` in the orchestrator — this is a §9-P0-equivalent check).
3. **Insert** — include `buyer_age` and resolved `branch_id` in the `insertRow('orders', ...)` payload. Status path unchanged: default `collecting_info` → `transition(..., 'awaiting_payment', 'referrer:<id>')` now passes legally because buyer info is complete. **No change to `transition_order`, no direct status writes.**
4. **Response** — `toOrderPanel` already carries branch data; expose the resolved branch in the create response so the partner screen can show it next to the QR.
5. New `branches` action? NO — instead add a lightweight read: the partner screen needs the branch list per product. Reuse the existing anon-readable `branches`/`product_branches` RLS (same pattern the customer BranchPicker uses via the orchestrator). If the partner screen cannot read them client-side under current RLS, add a `list_branches` action `{ catalog_key }` to `referrer-order` returning `{ id, name, address, district }[]` — pick whichever requires NO RLS change; if both would require an RLS change, stop and report.

### 2.2 Frontend — `app/partner.tsx`

1. Add field **อายุ** (numeric keyboard, validate 1–120 on blur, inline error) next to ชื่อ-นามสกุล / เบอร์โทร. Update `canCreateOrder` gate.
2. Add **เลือกสาขา** when the selected product has >1 active branch: plain radio list (reuse the visual rules of `components/chat/BranchPicker.tsx` — radio circle, name 14/800, address 12 `inkSoft`, row ≥56px; import shared styles or extract a tiny shared row component rather than copy-pasting). 0 or 1 branch → no picker rendered (1 branch: show the branch name as static text).
3. Show resolved branch name on the QR/confirmation state.
4. Thai-first copy, `MiraDesign` tokens only. Demo mode (`โหมดตัวอย่าง`) must keep working with the new fields.

### 2.3 Types & mirror

- `_shared/types.ts` `ReferrerOrderRequest`: add `buyer_age`, `branch_id?` (additive).
- Mirror in `lib/types/api.ts` (CI `type-mirror-audit` enforces).

### 2.4 Tests & gates (the regression net that was missing)

1. **Deterministic** (`_shared/__tests__/referrals_test.ts` + new cases): schema rejects missing/out-of-range age; branch resolution unit cases (0/1/many, wrong-tenant id rejected).
2. **E2E** — extend `scripts/e2e-commerce.mjs` with a real assisted-purchase leg:
   - Seed: referrer row **linked to a disposable auth user** (current `createReferrer` helper creates the row only — extend it to create the auth user and set `referrers.auth_user_id`, mirroring how `rls-check.mjs` provisions disposable users; clean up in the residual-cleanup section, lines ~756+).
   - Call `referrer-order` `create_order` for (a) the multi-branch product WITH `branch_id` + age → assert order lands `awaiting_payment`, `branch_id` set, `buyer_age` set, QR payload present; (b) assert the same call WITHOUT `branch_id` fails with VALIDATION; (c) the single-branch product without `branch_id` → auto-assigned.
   - `payment_done` → `submitted` → admin confirm via `admin-order-action` → assert exactly ONE `commission_entries` row computed from the snapshot (reuse the existing commission assertion helpers, line ~538).
3. `npm run typecheck`, `npm run v2:verify` green.

### 2.5 DoD — R1

- [x] ✅ 2026-06-12 — `referrer-order` accepts and stores `buyer_age` + resolved `branch_id`; illegal/missing branch rejected; no `transition_order` change in the diff.
- [x] ✅ 2026-06-12 — `partner.tsx` collects age (+ branch when needed) with validation; demo mode intact.
- [x] ✅ 2026-06-12 — live e2e assisted-purchase leg verified in GitHub Actions run 27414394405 (`live-regression` / `Commerce E2E suite`): direct purchase, admin confirm, referral attribution, assisted purchase, commission snapshot, and v3 commerce checks passed.
- [x] ✅ 2026-06-12 — Type mirror updated; `npm run v2:verify` green.

---

## 3. Phase R2 — F1: purchase-form age → `user_facts` (consent-gated)

Implements v3 plan §11.3 exactly: key `age`, source `user_form`, confidence `1.0`, ONLY when the customer has an active `health_data_collection` consent; skip silently otherwise.

### 3.1 Helper (in `_shared/facts.ts` — authorized by §0.2)

1. Extend `insertFactsIdempotent` with optional `source?: UserFactRow['source']` defaulting to `'chat_extraction'` (replaces the hardcoded value at line ~188). All existing callers unchanged.
2. New helper:

```ts
export async function recordFormAgeFact({ customerId, tenantId, orderId, age }: {
  customerId: string; tenantId: string; orderId: string; age: number;
}) {
  // 1) consent gate: latest consents row, kind='health_data_collection', granted=true
  //    (copy the exact query pattern from _shared/context.ts:94 — do not invent a new one)
  // 2) if not granted -> return null (silent skip, NO error, NO notice)
  // 3) insertFactsIdempotent with: key 'age', value_num=age, value_text=null,
  //    confidence 1.0, status 'active', source 'user_form', sourceRef=orderId
  //    (conflict key customer_id,key,source,source_ref => re-submitting the same
  //     order form is idempotent; supersede chain handles the old age fact)
}
```

3. `age` must already exist in the fact key registry (`fact_keys`) — it does (v2 §7.1 canonical keys). If `value_kind` doesn't accept numeric age, stop and report; do NOT add registry keys ad hoc.

### 3.2 Call sites

1. `_shared/orchestrate.ts` `order_form_submit` handler (after `updateOrderFields` succeeds, ~line 472): call `recordFormAgeFact`, wrapped in `try/catch` with `console.warn('form_age_fact_failed', ...)`. **A facts failure must never fail the order submit.**
2. `referrer-order` `create_order` (after order insert): same call, same try/catch. Referrer-created buyers normally have no consent row → this no-ops by design; do not create consent on this path.

### 3.3 Tests & gates

- Deno unit (`facts_test.ts`): `source` param respected + default unchanged; `recordFormAgeFact` consent-gated paths (granted / absent / revoked) with the existing PostgREST stubbing pattern.
- E2E: in the chat-purchase leg (which already grants consent via `consent_granted` and submits age 35), assert a `user_facts` row `key='age', source='user_form', value_num=35, status='active'` exists and that re-running the form submit does not duplicate it. In the assisted leg (no consent), assert NO such row.
- Grep gate: no fact write from assistant text introduced (facts still written only from user-originated data: form fields).

### 3.4 DoD — R2

- [x] ✅ 2026-06-12 — `recordFormAgeFact` helper + chat/referrer call sites landed; writes are consent-gated, skip silently without consent, and `form_age_fact_failed` is catch/log only.
- [x] ✅ 2026-06-12 — Unit coverage + live commerce e2e assertions green in GitHub Actions run 27427507379 (`live-regression` / `Commerce E2E suite`, job 81069178323), including user_form age fact, duplicate form-submit no-duplicate, and no assisted fact without consent.
- [x] ✅ 2026-06-12 — `npm run v2:verify` green locally and GitHub Actions `verify` job 81069014024 green; `facts.ts` existing default source behavior remains covered.

---

## 4. Phase R3 — V3-3: prompt default flip (OWNER-GATED — exact split)

This phase has a hard ordering dependency on the OWNER. Codex must NOT start step 2 before the owner confirms step 1 in writing (PR comment or goals file note).

1. **OWNER**: flips the Platform default of `pmpt_6a29c7e353b88196a6e648b24c54849e0f6204e24d65c021` to Version 3. (Codex never opens the Platform.)
2. **Codex** (single PR, after confirmation):
   - Remove the `MIRA_PROMPT_VERSION=3` reliance for staging verification: run `npm run chat:regression:v3` against the **default** (env var unset). Suite must pass 10/10. (The env-override code path in `_shared/openai.ts` STAYS — it is the contract's escape hatch; only the pinned secret usage is retired. Do not edit `openai.ts`.)
   - Re-run the live commerce e2e once (it exercises order-context lines under the new default).
   - **Draft** the `docs/miracare-codex-handoff.md` updates: §2 default version = 3, §4 catalog fields incl. `category`, §5 marker = three types/4 ids, §7 regression suite = the v3 10-case table (copy from v3 plan §2.3). Owner merging the PR constitutes the owner edit (§0.2).
   - Annotate `docs/miracare-v2-product-plan.md` §4 pointing to the v3 plan (v3 plan §8 V3-3 DoD item).
   - Tick the V3-3 DoD boxes in `docs/miracare-v3-chat-commerce-plan.md` §8.
3. **OWNER**: after merge, removes the `MIRA_PROMPT_VERSION` secret from the staging Supabase project (live env is owner territory, AGENTS.md §3.5). Codex notes this as a checklist line in the PR description.

### DoD — R3

- [x] ✅ 2026-06-13 — Owner confirmed default = v3 in Platform in the Codex thread.
- [ ] ❌ `chat:regression:v3` 10/10 against default (no env pin) + commerce e2e green, evidence in PR.
- [ ] ❌ Handoff doc v3 draft merged by owner; v2 plan §4 annotated; v3 plan V3-3 boxes ticked.
- [x] ✅ 2026-06-13 — Owner removed the staging env pin; `supabase secrets list --project-ref xwixdxmemwcuoamcloty` no longer lists `MIRA_PROMPT_VERSION`.

---

## 5. Phase R4 — PDPA export & hard-delete

Closes v2 plan §7.5 / v2 audit C ❌. Two new edge functions + one small table + admin trigger. **DECIDED defaults by owner 2026-06-12 (do not re-ask):**

1. **Erasure scope**: hard-delete personal data; **anonymize orders instead of deleting them** (financial records keep amounts/status/commission integrity): `buyer_name → 'ลบตามคำขอ (PDPA)'`, `buyer_phone → null`, `slip_url → null` (+ delete the slip object from storage). `order_events` and `commission_entries` rows stay (they reference the order, not the person).
2. **Trigger surfaces**: edge functions callable by (a) the authenticated customer for their own data, (b) `tenant_admin` for a customer of their tenant (offline identity verification is the tenant's responsibility). No self-service UI button this run (§0.1).
3. **Audit trail**: minimal `pdpa_requests` table — no personal data in it beyond the customer id reference, which for delete requests becomes a tombstone (customer row is gone; keep the uuid).

### 5.1 Migration (additive): `2026xxxx_pdpa_requests.sql`

```sql
create table if not exists public.pdpa_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  customer_id uuid not null,          -- NOT an FK: must survive customer deletion
  kind text not null check (kind in ('export', 'delete')),
  requested_by text not null,         -- 'customer' | 'admin:<member uuid>'
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);
-- RLS: tenant members read their tenant's rows; writes via service role (edge functions) only.
```

### 5.2 `pdpa-export` edge function

- Auth: customer JWT (`auth_user_id` → customers row) or tenant-admin JWT + `customer_id` param (validate membership + tenant match — same guard pattern as `admin-order-action`).
- Returns one JSON document: `customers` row, `consents`, `user_facts` (ALL statuses — the supersede chain is the person's history), `chat_sessions` + `chat_messages` (their sessions), `orders` (their rows incl. status history from `order_events`), `lab_results` (+ short-lived signed URLs for their lab images), `wearable_metrics`, and storage paths for slips with short-lived signed URLs.
- Insert `pdpa_requests` row (`kind='export'`, `completed_at=now()` on success).

### 5.3 `pdpa-delete` edge function

- Same auth model. Steps, in one logical sequence (service role):
  1. Insert `pdpa_requests` row (`kind='delete'`).
  2. Delete storage objects: customer's payment slips, lab images (private buckets) — derive paths from DB rows BEFORE deleting the rows.
  3. Delete rows: `user_facts`, `lab_results`, `wearable_metrics` (+ `wearable_imports` from R5), `chat_messages`, `chat_sessions`, `consents`, RAG/embedding rows keyed to the customer if any exist (verify with the schema audit — if none, note it in the PR).
  4. Anonymize `orders` per the DECIDED rule above (direct column update is fine — this touches buyer fields, NEVER `status`; the `transition_order`-only rule applies to status alone).
  5. Delete the `customers` row last; set `completed_at`.
- Idempotent: re-running for an already-deleted customer returns success-noop.

### 5.4 Coverage gate (prevents silent drift)

New `scripts/pdpa-coverage-audit.mjs` wired into `npm run v2:verify`: statically asserts that every table in `supabase/migrations` carrying a `customer_id` column is either (a) named in `pdpa-delete`'s deletion/anonymization list or (b) on an explicit allowlist with a comment why (e.g. `pdpa_requests` tombstone). A new customer-data table that nobody added to the delete path fails the build.

### 5.5 Admin trigger

`components/admin/*`: per-customer action (admin orders/customer detail surface) with buttons "ส่งออกข้อมูล (PDPA)" / "ลบข้อมูลถาวร (PDPA)"; delete requires typed confirmation (`ลบถาวร`) — `tenant_admin` role only (hide for `tenant_staff`).

### 5.6 Tests & DoD — R4

- Deterministic: zod/auth guards unit-tested; coverage audit red/green proven in PR description (add a fake table in a scratch test to show it fails — do not commit the fake).
- Live (credentialed): seed disposable customer with one row in each personal table + a slip object → export returns all of them → delete → assert tables empty for that customer, order anonymized, storage objects gone, `pdpa_requests` has 2 completed rows, second delete call no-ops.
- [x] ✅ 2026-06-12 — Migration + RLS; both functions deployed-ready/deployed to project `xwixdxmemwcuoamcloty`; admin trigger role-gated.
- [x] ✅ 2026-06-12 — Coverage audit wired into `v2:verify`; green locally and red proof verified with a scratch customer table (`pdpa_coverage_scratch_should_fail` failed as expected, then removed).
- [x] ✅ 2026-06-12 — Live export/delete proof green in GitHub Actions run 27429471136 (`live-regression` job 81075902490): export, cross-tenant denial, delete, order anonymization, storage removal, and idempotent retry passed.

---

## 6. Phase R5 — Wearable import entity (`source_ref` for wearable facts)

Closes v2 audit C ❌ ("wearable facts have no spec-defined import entity/source_ref"; `wearable-ingest/index.ts:58` writes `source_ref: null`).

1. Migration (additive): `wearable_imports` table — `id uuid pk`, `tenant_id` (FK + RLS like other customer tables), `customer_id` FK, `source text check in ('apple_export','healthkit','manual')`, `filename text`, `file_path text`, `metric_count int`, `imported_at timestamptz default now()`. Plus `wearable_metrics add column if not exists import_id uuid references wearable_imports(id)` (nullable — old rows stay null).
2. `wearable-ingest`: create the import row first; stamp every `wearable_metrics` row with `import_id` and every fact write with `source_ref = <import id>` (replacing the `null` at line 58).
3. RLS check extension in `scripts/rls-check.mjs` (customer isolation on `wearable_imports`), schema audit picks the table up, R4's coverage audit must list it (R5 may land before or after R4 — whichever lands second updates the audit list).
4. Tests: extend `_shared/__tests__/wearable_test.ts` — facts carry the import id; re-ingesting the same file stays idempotent for facts (existing conflict key now distinguishes per-import: confirm this matches the idempotency requirement of v2 §7.4; if re-import of the same file must NOT duplicate metrics, dedupe on `(customer_id, metric, day)` as today — metrics dedupe behavior unchanged).

### DoD — R5

- [x] ✅ 2026-06-12 — Migration + RLS + rls-check extension landed; production project `xwixdxmemwcuoamcloty` has migration `20260612180000_wearable_imports.sql`; `npm run v2:schema-audit`, `npm run v2:pdpa-coverage-audit`, and `npm run v2:verify` green locally.
- [x] ✅ 2026-06-12 — `wearable-ingest` stamps `wearable_metrics.import_id` + wearable fact `source_ref=<import id>`; `wearable-ingest` deployed to project `xwixdxmemwcuoamcloty`; wearable Deno tests green (`7 passed`, full `npm run v2:verify`: 108 Deno tests passed).
- [x] ✅ 2026-06-12 — v2 audit C source-ref item flipped with R5 evidence in `docs/miracare-v2-product-plan.md` §10.

---

## 7. Phase R6 — Known-user proof (live, credentialed)

Closes v2 audit E ❌ ("facts from a previous session used, not re-asked").

1. Extend `scripts/chat-regression-v3.mjs` (or a sibling `scripts/chat-known-user.mjs` wired into the same live-regression CI job — prefer extending, to reuse seeding/cleanup):
   - Seed a customer WITH consent + an active `user_facts` row `age=35` and `health_concerns='น้ำตาล'` attributed to a *previous* session id.
   - Open a **new** `chat_sessions` row, send `อยากตรวจสุขภาพครับ`.
   - PASS criteria: the reply does NOT ask for age (heuristic: no Thai age-question pattern `อายุ.*(เท่าไหร่|กี่ปี|เท่าไร)` — style-retry rules from `codex-goals.md` apply to style assertions only, this is a contract assertion: fail immediately); the model's follow-up question targets something NOT already known. Marker rules per global criteria.
   - DB-side assertion: the orchestrator context builder included the fact lines (assert indirectly — the only approved oracle is behavior + the `user_facts` rows; do NOT add debug endpoints that leak `personal_context`).
2. Serialize with the existing live-regression concurrency group (job-level concurrency already configured — reuse it).

### DoD — R6

- [x] ✅ 2026-06-12 — Known-user case green in credentialed GitHub Actions run 27431179529 (`live-regression` job 81081827964, "Known-user chat proof" step); PR evidence recorded and v2 plan §10-E flipped.

---

## 8. Audit additions (owner's audit loop for this plan)

- **P0**: R1 diff contains NO change to `transition_order`, no direct `orders.status` write, branch validation rejects cross-tenant/non-product branch ids (try it in the e2e negative case).
- **P0**: R4 delete cannot be invoked cross-tenant (admin of tenant A vs customer of tenant B → 403, covered by a live negative test).
- **P1**: R2 — order submit succeeds even when the facts insert is forced to fail (unit with stubbed failure); no consent → zero rows.
- **P1**: R3 — `_shared/openai.ts` untouched in the diff; handoff doc changes match the published v3 exactly (owner verifies against the Platform).
- **P2**: partner.tsx age/branch UI follows MiraDesign tokens; Thai copy; no map artifact (reuse list-row pattern).

## 9. Phase → PR map & universal gates

| PR | Phase | Depends on |
|---|---|---|
| 1 | R1 referral repair | — (do first) |
| 2 | R2 form facts | R1 (shares referrer-order call site) |
| 3 | R4 PDPA | — (parallel-safe with R2) |
| 4 | R5 wearable imports | — (coordinate coverage-audit list with R4) |
| 5 | R6 known-user proof | R3 step 1 NOT required (runs pinned or default) |
| 6 | R3 flip support | OWNER confirmation first |

Every PR: `npm run typecheck` + `npm run v2:verify` green, migrations additive only, DoD boxes in THIS file updated truthfully in the same PR, no LINE-path edits. When blocked or when two documents contradict: stop and report (AGENTS.md §3.8).

---

## Appendix A — kickoff prompt for the Codex run

> Read `AGENTS.md` first — it is binding. Then read `docs/miracare-v3-followups-plan.md` end-to-end; it is the plan for this run and the ONLY authorization for the protected-core touches it lists in §0.2. Work phases in the PR order of §9, one PR per phase, branch `codex/<phase-id>-<slug>`. R1 is a production bug — ship it first and keep that PR minimal. Do NOT build anything LINE-related, do NOT touch `transition_order`, do NOT edit prompt content or the platform default (R3 step 2 starts only after the owner confirms the flip). All open questions in this plan are DECIDED — do not re-ask them. Update the DoD checkboxes in `docs/miracare-v3-followups-plan.md` truthfully in each PR. Stop and report per AGENTS.md §3.8 if any gate cannot be made green without violating a rule.
