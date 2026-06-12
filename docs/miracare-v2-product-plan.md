# MiraCare Platform v2 — Detailed Product & Implementation Plan

Audience: Codex (implementation agent) + product owner (audit).
Companion document: `docs/miracare-codex-handoff.md` (AI Chat model contract — its PRIME DIRECTIVE applies to all chat work in this plan).

Workflow for this document: Codex implements phase by phase → produces a first draft → the owner runs the AUDIT FRAMEWORK (§10) with another agent → issues are fixed one by one against the audit checklists. Codex must keep this file updated: mark every Definition-of-Done item with ✅/❌ and date as work lands.

---

## 0. Positioning & Business Model (context — do not skip)

- MediaForge is a **vendor**. MiraCare is a **core product we own and implement per client** (hospitals/clinics) — NOT self-serve SaaS. No public signup, no self-serve tenant onboarding UI is needed. We deploy and configure per client.
- White-label: each tenant gets their own brand name, logo, product catalog, referrers, and customers. The AI persona/engine is ours and identical across tenants.
- Delivery surfaces per tenant (selectable): standalone app (Expo), PWA, LINE OA.
- Purpose pyramid (priority order): **(1) increase tenant sales → (2) reduce staff chat workload/cost → (3) better customer UX.** Every design decision resolves conflicts in this order.

## 1. Current State (repo: MediaforgeThailand/mira-health-app)

What already exists and must be REUSED or MIGRATED (not rebuilt blindly):

| Area | Exists | Status / action |
|---|---|---|
| Expo app screens | `app/(tabs)/chatbot.tsx`, `agent.tsx`, `packages.tsx`, `package-detail.tsx`, `checkout.tsx`, `order-status.tsx`, `partner.tsx`, `app/admin/*`, `user-profile.tsx`, `health.tsx`, `wearable-health.tsx`, `body-overview.tsx`, `ai-body-overview.tsx`, `health-check-results.tsx` | Audit each against v2 specs below; refactor, don't duplicate |
| Chat backend | `supabase/functions/chat-orchestrator`, `_shared/orchestrate.ts`, `_shared/openai.ts`, `fact-extractor`; legacy `supabase/functions/mira-chat` customer path removed | Customer conversation layer now targets the OpenAI MiraCare prompt (§4). Gemini/prototype utilities may remain only outside the customer reply path |
| RAG / embeddings | `rag-embed`, chatbot_rag_schema, rag_vector_embeddings | Keep for medical knowledge grounding; chat model contract decides when it's injected (§4.4) |
| Memory | agent_memory_companion_chat, user_context_scores, health_fact_autosave_triggers | Foundation for the Silent Profile pipeline (§7) — extend, don't recreate |
| Catalog/admin | canonical `products` table and `app/admin/catalog.tsx` | This is the tenant catalog source for chat + refer (§5, §6) |
| Health data | patient_health_data_vault, blood_test RAG | Foundation for Health Dashboard (§8) |
| Voice | openai-transcribe | Optional input path; `/prototype` keeps it paused unless the function is intentionally deployed |

Codex must run a discovery pass first (read these files) and produce `docs/v2-gap-analysis.md` mapping each v2 requirement → exists / partial / missing, BEFORE writing feature code. This is Phase 0 (§9).

## 2. Goals & Objectives

### Product goals (v2)
- G1. A customer can go from question → recommendation → paid order **entirely inside chat** (PWA/app/LINE), with the AI collecting any missing buyer info conversationally.
- G2. Referrers (doctors/nurses/creators) can drive traceable sales and earn commission, including assisted purchase (referrer fills buyer info, shows QR).
- G3. Every sale (chat or refer) lands in one Admin Panel queue where tenant staff confirm bookings or call the customer.
- G4. The AI silently builds a per-user profile from conversation (age, weight, conditions, last checkup, ...) that improves both chat personalization and the Health Dashboard.
- G5. Health Dashboard renders (a) AI-analyzed lab results from photos and (b) wearable data (Apple Health first).

### Engineering objectives
- O1. Single multi-tenant Supabase backend; every business row is tenant-scoped with RLS. One catalog feeds chat + refer + admin.
- O2. Chat conversation quality is governed by the published OpenAI prompt + regression suite — backend orchestrates, it never scripts replies (handoff doc PRIME DIRECTIVE).
- O3. Memory/profile pipeline is deterministic and auditable: every stored fact has source, confidence, timestamp; no fact is invented by the model at read time (anti-hallucination: the chat only "knows" what the DB says).
- O4. Payment = PromptPay QR generation + staff confirmation in v2 (no PSP integration yet); architecture leaves a webhook seam for later.
- O5. PDPA-compliant handling of health data: consent capture, purpose limitation, export/delete path (§7.5).

### Success metrics (instrument from day 1)
- % conversations reaching a product recommendation; recommendation → order conversion; order → confirmed booking rate
- Referrer-attributed share of orders; assisted-purchase completion rate
- Repeat-user recognition rate (chat correctly uses stored profile without re-asking)
- Chat regression suite pass rate (must stay 100% on release)

## 3. Architecture Overview

```
                            ┌────────────────────────────┐
   Customer (PWA/App/LINE) ─┤  Chat Orchestrator (edge)  ├── OpenAI Responses API
                            │  - build variables          │   (MiraCare prompt v2+)
                            │  - parse [[products]]       │
                            │  - order state machine      │
                            └──────┬──────────┬──────────┘
                                   │          │ async
                            ┌──────▼───┐  ┌───▼──────────┐
   Referrer (partner UI) ───►  Supabase │  │ Fact Extractor│ (silent profile, §7)
   Admin (tenant staff) ────►  Postgres │  └──────────────┘
                            │  RLS multi-tenant           │
                            │  catalog/orders/facts/labs  │
                            └──────────┬──────────────────┘
   Lab photo / Apple Health ───────────► ingestion functions (§8)
```

- **One database** (existing Supabase project). All modules read/write the same `products`, `orders`, `user_facts`.
- **Tenancy:** `tenants` table (id, slug, display_name, logo, line_channel config, payment info/PromptPay id, feature flags). Every business table carries `tenant_id` + RLS policy. Admin users belong to a tenant; MediaForge superadmin role spans tenants.
- **Channels:** one `chat_sessions` abstraction with `channel: app|pwa|line`. LINE OA = webhook edge function mapping LINE userId → platform user; replies sent via LINE Messaging API; product cards = Flex Messages.

## 4. Module: AI Chat (the core)

### 4.1 Conversation engine — contract
Everything in `docs/miracare-codex-handoff.md` applies verbatim: prompt ID `pmpt_6a29c7e353b88196a6e648b24c54849e0f6204e24d65c021` (default version), variables `brand_name`, `user_nickname`, `personal_context`, `recent_chat`, `product_catalog`, marker protocol `[[products: id1, id2]]`, `store:false`, regression suite. **Adapt this codebase to the model; never adapt the model to this codebase.** The existing Gemini conversation path is replaced for customer-facing chat.

### 4.2 Orchestrator (rewrite of `supabase/functions/mira-chat`)
Per incoming message:
1. Resolve tenant + user + session; persist user message.
2. Build variables: `personal_context` from `user_facts` (confirmed facts, compact Thai lines), `recent_chat` last 4–8 turns, `product_catalog` from tenant catalog (pre-filter to ≤50 relevant items by category/intent if large).
3. Call Responses API with the published prompt. No additional system prompts layered on top.
4. Parse response: strip `[[products: ...]]`, resolve ids → product rows, return `{ text, products[] }` to client; persist assistant message + marker ids.
5. Enqueue async fact extraction (§7) — never blocks the reply.
6. If an order flow is active (§4.3), the orchestrator also evaluates order-state transitions.

### 4.3 In-chat purchase (Agent-assisted buying)
State machine per session (DB-backed, not in-prompt):
`browsing → intent (user taps card CTA or says "เอาอันนี้") → collecting_buyer_info → awaiting_payment (QR shown) → submitted → [admin] confirmed/booked | cancelled`

- Required buyer info: full name, phone, (optional per product: preferred branch/date). The AI asks for missing fields conversationally — implemented by injecting current order status into `personal_context` (e.g. `กำลังสั่งซื้อ: <product> ข้อมูลที่ยังขาด: เบอร์โทร`) so the model asks naturally. **Do NOT hardcode question scripts in backend.** A tappable form card is the fallback after 2 failed conversational attempts.
- Payment: generate Thai PromptPay QR (tenant's PromptPay id, amount). Customer pays and taps "จ่ายแล้ว" (or uploads slip → stored to order). Order enters Admin queue as `submitted`.
- Every order row: tenant_id, user_id, session_id, product_id, qty, amount, buyer info, channel, `referrer_id` if attributed (§5), slip url, status history.

### 4.4 Anti-hallucination rules (enforced by architecture, not hope)
- Prices/products only from `product_catalog` variable (model contract) — backend must never let the model see stale catalog (always query fresh).
- Medical facts beyond the prompt: RAG snippets may be appended INSIDE `personal_context`-adjacent context only via a new prompt variable IF later approved as a new prompt version; until then, web search (already enabled in the prompt) covers general medical questions. Do not bolt RAG text into `recent_chat`.
- User facts: the model is only told confirmed facts from DB. Extraction (write path) is a separate model call (§7); the chat reply path never writes facts itself.

### 4.5 Surfaces
- App/PWA: existing chatbot screen refactored to render `{text, products[]}` bubbles + card carousel + order form card + QR view.
- LINE OA: new edge function `line-webhook`; texts in/out, cards as Flex Message carousel, QR as image message. Session continuity by LINE userId.

## 5. Module: Refer Program

Actors: tenant marketing team creates **referrers** (doctor / nurse / creator). Referrer uses a lightweight web view (existing `partner.tsx` as base).

### 5.1 Features
- Referrer profile: name, type, phone, tenant, active flag, commission scheme (percent per product category or flat per product; configurable per tenant).
- **Share link/QR:** unique code `ref_code`; deep links into PWA chat / LINE OA with attribution. Attribution rule: last-touch, stored on platform user (`referred_by`, expires after N days — default 30, tenant-configurable). Any order by that user within window credits the referrer.
- **Assisted purchase:** referrer picks product → enters buyer name+phone → system creates order (status `submitted`, channel `referrer`) → shows PromptPay QR for the buyer to scan on the spot. No customer account needed; phone is the customer key (merge later if they sign up).
- **Commission ledger:** on order → `confirmed` by admin, a `commission_entries` row is computed (scheme snapshot, amount, status pending→approved→paid). Referrer view shows earnings; admin approves/marks paid (manual payout in v2).

### 5.2 Non-goals v2
No automated payouts, no multi-level referrals, no referrer self-signup (admin creates referrers).

## 6. Module: Admin Panel (tenant staff)

Base: the old `hospital-portal.tsx`, `hospital-products.tsx`, and `admin-booking.tsx` routes were consolidated into one authenticated admin area:
- **Orders queue (primary screen):** all orders (chat + referrer), filter by status/date/channel; detail view: buyer info, product, slip image, conversation link (read-only transcript), referrer. Actions: confirm payment, set booking datetime, mark booked/done/cancelled, add note. Status changes notify customer in-chat/LINE ("จองคิววันที่ ... เรียบร้อยค่ะ") via a templated system message (NOT model-generated).
- **Catalog CRUD:** name, preview image (storage upload), description, price, category, active, branch info. This is the single catalog feeding chat + refer.
- **Referrers & commissions:** CRUD referrers, scheme config, approve/pay commissions, performance table.
- **Conversation oversight:** list sessions, flagged ones first (emergency-escalated, complaint keywords); read-only.
- Roles: `tenant_admin`, `tenant_staff` (orders only), `superadmin` (MediaForge).

## 7. Silent Profile (memory) — the data spine

Goal: the user just chats; the system quietly accumulates personal data that powers personalization AND the Health Dashboard. Current logic is unstable — REPLACE with this deterministic pipeline (extending `agent_memory_companion_chat` + `health_fact_autosave_triggers` where compatible).

### 7.1 `user_facts` table (canonical)
`(id, tenant_id, user_id, key, value_text, value_num, unit, confidence 0-1, source enum[chat_extraction, lab_import, wearable, user_form, referrer_form], source_ref (message/lab id), extracted_at, superseded_by, status enum[active, superseded, retracted])`
- Append-only with supersede chain (never UPDATE values in place) → auditable history, e.g. weight over time.
- Canonical key registry (enforced enum/lookup): `age`, `birth_year`, `sex`, `weight_kg`, `height_cm`, `chronic_conditions`, `allergies`, `medications`, `smoking`, `alcohol`, `exercise_freq`, `last_checkup`, `health_concerns`, `family_history`, `location_area`, `nickname`. Adding keys = migration, not free text.

### 7.2 Extraction pipeline (async, after each user message)
1. Cheap/fast model call (separate from conversation; structured output JSON) with the last user message + small window: "extract any personal health facts; return key/value/confidence; return [] if none."
2. Validator: key in registry, value parseable, confidence ≥ 0.7 → insert as `active` (supersede same-key older fact if conflicting); 0.4–0.7 → insert as `candidate` for the chat to confirm naturally later (surfaced as `ข้อมูลที่ควรยืนยัน:` line in `personal_context`); < 0.4 discard.
3. Never extract from assistant messages. Log every insert with source message id.

### 7.3 Read path
`personal_context` builder renders active facts as compact Thai (`อายุ 35 / กังวลเรื่องน้ำตาล / ตรวจล่าสุด: ไม่แน่ใจ`), newest-wins. Same facts feed Health Dashboard profile (age/weight/height → BMI etc.).

### 7.4 Stability requirements
Idempotent (re-running extraction on the same message must not duplicate), unit-normalized (kg/cm), Buddhist↔Gregorian year handling for ages/dates, Thai numerals handled.

### 7.5 PDPA
First-chat lightweight consent ("เก็บข้อมูลสุขภาพที่คุณเล่าเพื่อแนะนำได้ตรงขึ้น ตกลงไหมคะ" + privacy link) stored with timestamp; per-tenant data controller config; `user_facts` export (JSON) and hard-delete (cascade to embeddings) functions; lab images & slips in private storage buckets with signed URLs.

## 8. Module: Health Dashboard

### 8.1 Lab results (photo → AI → visualize)
1. Upload/photo lab report → private storage.
2. Edge function: vision model (OpenAI) extracts structured panels `{test_code, name, value, unit, ref_low, ref_high, collected_date}` into `lab_results` (link `patient_health_data_vault`); confidence per field; below-threshold fields flagged for user confirmation UI ("อ่านได้ว่า FBS 105 ถูกไหม?").
3. Dashboard (`health-check-results.tsx`, `body-overview.tsx` as base): per-panel status vs reference range, trend charts across imports, plain-Thai AI summary generated ONCE at import (stored, not regenerated per view).
4. Cross-link: key results (FBS, lipids, BMI inputs) become `user_facts` (source=lab_import) → chat can personalize ("ผล FBS รอบที่แล้วสูงนิดนึง แพ็กเกจติดตามน้ำตาลตัวนี้เหมาะค่ะ"). **Medical-safety rule: dashboard summaries describe and suggest seeing doctors; they never diagnose.**

### 8.2 Wearables (Apple first)
- v2 scope: **Apple Health export ingestion** (user exports zip/XML → upload → parser edge function → `wearable_metrics` (steps, HR, resting HR, sleep, active energy; daily aggregates)). Native HealthKit sync = later phase (requires app entitlement work) — leave ingestion interface generic (`source: apple_export | healthkit | manual`).
- Dashboard (`wearable-health.tsx` base): trends + simple insights (rule-based first, not model-generated per view).

## 9. Phasing (Codex execution order)

**Phase 0 — Discovery & gap analysis (no feature code).** Read current repo; produce `docs/v2-gap-analysis.md` (requirement → exists/partial/missing → files); confirm tenancy gaps. DoD: gap doc complete, plan §1 table corrected if wrong.

Status 2026-06-11: `docs/v2-gap-analysis.md` exists and maps the current worktree to the v2 requirements. It intentionally marks unresolved items as Partial, Blocked, or Missing rather than treating this draft as complete.

**Phase 1 — Foundations.** Tenancy (`tenants`, tenant_id + RLS everywhere), roles, catalog consolidation (one `products` source w/ image upload), `user_facts` schema + registry. DoD: RLS tests pass; catalog CRUD works from admin; existing screens still run.

Status 2026-06-11: migrations, admin catalog CRUD, seed script, and live RLS script exist. The RLS script creates disposable auth users, checks customer-owned row isolation through PostgREST, denies cross-tenant product writes, and is wired into the optional `live-regression` CI job after seeding.

**Phase 2 — Chat migration (highest value).** Orchestrator on OpenAI prompt per §4.2; marker parsing + product cards in app/PWA; silent profile pipeline §7.2; regression suite automated (`scripts/` runner hitting the orchestrator with the 7-case suite from the handoff doc). DoD: suite 100%; repeat user not re-asked known facts; no Gemini call in customer reply path.

Status 2026-06-11: the production chat screen now uses React Query, hydrates the latest persisted `chat_messages` page, can load older pages, passes the active `chat_sessions.id` to `chat-orchestrator`, and sends consent through the explicit `consent_granted` action. The credentialed live 7-case regression passed after final redeploy.

**Phase 3 — Commerce.** Order state machine, conversational buyer-info collection, PromptPay QR, slip upload; Admin orders queue + booking statuses + customer notifications. DoD: end-to-end test purchase from chat reaches admin queue and books.

Status 2026-06-11: order tables, `transition_order`, PromptPay helpers, chat order panel, persisted order-panel refresh, slip upload, action-response `system_notice` persistence/rendering, admin order queue, and `scripts/e2e-commerce.mjs` exist; Deno state-machine/PromptPay/slip-path tests and `orders:status-audit` pass. The credentialed live commerce runner passed against the linked project.

**Phase 4 — Refer Program.** Referrer entity + attribution links, assisted purchase + QR, commission ledger, referrer view, admin commission screens. DoD: attributed order pays commission entry correctly; assisted purchase end-to-end.

Status 2026-06-11: referrer tables, server-generated six-character Crockford `ref_code`s, attribution route, assisted purchase function/screen, default 10% commission scheme, commission ledger, admin referrer screens, and attributed-purchase commission assertions in `scripts/e2e-commerce.mjs` exist.

**Phase 5 — Health Dashboard.** Lab photo pipeline + visualization + facts cross-link; Apple export ingestion + dashboard. DoD: sample lab photo renders correct visualized panel; facts appear in chat personalization.

Status 2026-06-11: lab/wearable schema, service-role internal ingest functions, dashboard refactors, lab safety sanitizer, lab normalization table, trusted lab confirmation writes, Apple Health zip `export.xml` streaming, fixture-backed lab/wearable parser tests, and the manual lab-ingest sample-image checklist exist. Legal disclaimer sign-off remains pending.

**Phase 6 — LINE OA surface.** Webhook, Flex cards, QR image, session mapping. DoD: regression suite passes over LINE channel too.

Status 2026-06-11: LINE webhook, signature verification helpers, postback action mapping, Flex product messages, QR image replies, admin push attempts, deterministic LINE helper tests, and `docs/line-setup.md` exist. LINE sandbox credentials and live regression remain pending.

Each phase = separate PR(s), migration files additive, `npm run v2:verify` green for deterministic local gates. Use `npm run v2:external-preflight` before live verification; live seeding, live RLS, chat regression, commerce E2E, and LINE sandbox checks still require owner-provided external state.

## 10. AUDIT FRAMEWORK (for the post-draft audit loop)

### Audit goal
Verify the draft implements THIS plan — catching silent scope drift, contract violations, and stability risks — module by module, producing a fix list ordered by severity (P0 contract/security → P1 functional → P2 quality).

### Audit objectives & checklists

**A. Contract compliance (P0)**
- [✅ 2026-06-11] Chat reply path uses the published OpenAI prompt ID + variables exactly (no renamed vars, no layered system prompts, no Gemini in reply path). Evidence: `_shared/openai.ts`, `chat-orchestrator`, `npm run chat:quality`.
- [✅ 2026-06-11] Marker protocol parsed & stripped on app/PWA and LINE response surfaces; unknown ids logged not crashed. Evidence: `_shared/marker.ts`, `_shared/__tests__/marker_test.ts`, `components/chat/ProductCarousel.tsx`, `_shared/line.ts`.
- [✅ 2026-06-11] `store:false` on production conversation calls. Evidence: `_shared/openai.ts`, `npm run chat:quality`.
- [❌ 2026-06-11] Prompt content unchanged in OpenAI Platform (or new version approved + suite re-run). Blocked by external OpenAI Platform verification and seeded regression credentials.

**B. Multi-tenancy & security (P0)**
- [✅ 2026-06-11] Every business table: tenant_id + RLS; cross-tenant read/write attempts fail in tests. Schema/RLS exists and `scripts/rls-check.mjs` verifies linked-project customer isolation and cross-tenant product write denial through PostgREST when Supabase secrets are present.
- [✅ 2026-06-11] Storage buckets private where required; slips/labs use signed URLs; service-role keys only in edge functions. Labs/slips are private, payment-slip upload/read signing runs through edge functions, and LINE QR images use the public `line-assets` bucket.
- [✅ 2026-06-11] Roles enforced (staff can't edit catalog/commissions). Evidence: `tenant_members` RLS helpers, admin client guards, referrer/commission admin policies.

**C. Data/profile integrity (P1)**
- [✅ 2026-06-11] `user_facts` append-only w/ supersede; extraction idempotent; keys registry-enforced. Evidence: Phase 1 migration, `_shared/facts.ts`, `_shared/__tests__/facts_test.ts`.
- [✅ 2026-06-12] No fact written from assistant text; every new fact write has source_ref. Evidence: chat/lab/form fact paths keep source refs, R5 adds `wearable_imports` + `wearable_metrics.import_id`, `wearable-ingest` writes wearable facts with `source_ref=<import id>`, and `supabase/functions/_shared/__tests__/wearable_test.ts` covers same-file idempotency.
- [❌ 2026-06-11] PDPA: consent stored; export & delete functions work end-to-end. Consent exists; export/delete endpoints are not defined in the technical spec.

**D. Commerce correctness (P1)**
- [✅ 2026-06-11] Order state transitions only via defined machine; illegal transitions rejected. Evidence: `transition_order`, `_shared/orders.ts`, `_shared/__tests__/orders_test.ts`, `npm run orders:status-audit`.
- [✅ 2026-06-11] QR amount/PromptPay id correct per tenant; commission computed from `orders.commission_scheme_snapshot` captured at order time, with current referrer scheme used only for legacy rows where the snapshot is null. Evidence: `_shared/promptpay.ts`, `_shared/__tests__/promptpay_test.ts`, `_shared/commissions.ts`, `_shared/__tests__/commissions_test.ts`, `_shared/__tests__/orders_test.ts`, A1 `transition_order` migration.
- [✅ 2026-06-11] Attribution window honored; assisted orders bypass attribution correctly (direct referrer credit). Deterministic attribution-window units, assisted-order static audit, and the credentialed attributed-purchase commission runner exist.

**E. Conversation quality (P1)**
- [✅ 2026-06-11] 7-case regression suite green on app/PWA, automated in `scripts/`. The credentialed live run passed all 7 handoff cases after the final v2 function redeploy; LINE sandbox credentials remain pending separately.
- [✅ 2026-06-11] Order-info collection feels conversational (no hardcoded scripted sequences in backend code — grep for canned Thai reply strings outside templates). Evidence: active order context + order field extractor; payment/admin notices are templated system notices.
- [❌ 2026-06-11] Known-user test: facts from a previous session used, not re-asked. Context builder tests exist, but seeded end-to-end known-user proof is pending.

**F. Dashboard correctness (P2)**
- [✅ 2026-06-11] Lab extraction confidence-gated with user confirmation UI; summaries stored once. Confidence gate, editable review panel, trusted confirmation write, and shared lab fact insertion now exist; live sample proof remains tracked separately.
- [✅ 2026-06-11] No diagnosis language (wording review against §8.1 safety rule). Evidence: `sanitizeLabSummary`, `_shared/__tests__/lab_test.ts`, `npm run v2:health-safety-audit`.
- [✅ 2026-06-11] Wearable aggregates match a hand-checked sample export. Evidence: `_shared/__tests__/wearable_test.ts`, `_shared/__tests__/fixtures/apple_health_export.ts`.

**G. Plan hygiene (P2)**
- [✅ 2026-06-11] `docs/v2-gap-analysis.md` exists and matches reality; this file's DoD checkboxes updated truthfully; migrations additive; typecheck, schema audit, and Deno edge entrypoint check are green. Evidence: `docs/v2-gap-analysis.md`, `docs/changes/*`, `npm run typecheck`, `npm run v2:schema-audit`, `npm run v2:deno-check`.

### Audit procedure
1. Run checklists top-down per module; record evidence (file/line, test output, screenshot) for each item.
2. Output `docs/v2-audit-report-<date>.md`: per-item PASS/FAIL + evidence + severity + suggested fix.
3. Fix loop: one severity tier at a time (all P0 → re-audit P0 → P1 ...). No new features during fix loop.

## 11. Risks & open questions (owner to resolve — Codex must NOT guess)

1. **Medical liability wording** for lab summaries — `LAB_SUMMARY_DISCLAIMER_TH` is the v2 default, but final tenant/legal sign-off is required before the first client launch.
2. **LINE OA**: tenant LINE sandbox channel credentials and test account are needed before the sandbox regression in `docs/line-setup.md` can run.

## 12. Out of scope for v2 (do not build)
Self-serve tenant signup/billing, PSP integration, automated commission payouts, multi-level referral, Android Health Connect, real-time wearable streaming, model fine-tuning, multi-language (Thai only).
