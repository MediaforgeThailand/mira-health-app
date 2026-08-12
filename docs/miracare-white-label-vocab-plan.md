# MiraCare white-label vocabulary & catalog de-verticalization plan

Status: Phases 0–3 IMPLEMENTED 2026-06-16 (awaiting owner review + live migration apply); Phases 4–5 deferred
Author: Claude (audit role) · 2026-06-16
Related rules: `AGENTS.md` §1 (this is a new task not covered by an existing plan), §2 (protected core), §3 (engineering rules)

## 0. Goal & context

MiraCare is currently presented as a **hospital/health** product end-to-end. We want to sell the same
platform to **beauty clinics, wellness brands, and other businesses**. Everything in the *product / catalog
management* surface must stop assuming "hospital / health-checkup / vaccine" and become either **generic**
("สินค้า / สาขา / ผู้ให้บริการ") **or per-tenant configurable**.

The catalog data model is already partly dynamic: categories live in the per-tenant `product_categories`
table and flow into both the admin UI and the chat `category_grid` card. The problem is **four hardcoded
layers** layered on top of that dynamic core (see §2 audit).

## 1. Owner decisions (DECIDED 2026-06-16)

1. **Vocabulary is per-tenant configurable** (not just a single neutral wordset). Each tenant can rename
   "สินค้า"→"คอร์ส", "โรงพยาบาล"→"คลินิก", etc. Code still ships **generic defaults** so an un-configured
   tenant immediately reads as generic ("สินค้า / สาขา / ผู้ให้บริการ").
2. **Scope = Admin + Catalog + Customer UI only.** The AI chat prompt, RAG knowledge, and conversation
   reply path are **out of scope** (protected core, owner territory). Items that touch them are listed in
   §5 as owner-gated proposals, not part of this workstream's PRs.

## 2. Audit — hardcoded surfaces

### A. Data layer (category vertical bias)
| Item | Location | Problem |
|---|---|---|
| `categoryLabels` fallback map | `lib/marketplace/hospitalProducts.ts:220` | Health-only labels (ตรวจสุขภาพ, วัคซีน, เอกซเรย์, ปรึกษาแพทย์, หัตถการ…) |
| `emptyDraft.category = 'checkup'` | `components/admin/CatalogCrud.tsx:42` | Default category is always `checkup` |
| `inferCategory()` heuristic | `lib/marketplace/hospitalProducts.ts:298` | Guesses category from `vaccine/blood/lab` keywords |
| Category seed | `supabase/migrations/20260612050000_miracare_v3_phase1_data_admin.sql:182` | Seeds `checkup/vaccine` into every tenant |
| Demo fixtures | `lib/showcase/demoFixtures.ts:58` | Demo categories are ตรวจสุขภาพ/ตรวจเชิงลึก/วัคซีน |
| `requires_appointment` / `buyer_age` | `CatalogCrud.tsx`, migration `…phase1_data_admin.sql:36` | "การจอง/ต้องนัดหมาย" + mandatory age = health assumption (age touches `transition_order` → see §5) |

### B. Admin copy (safe to genericize / configure)
- `app/admin/catalog.tsx:4` — `title="จัดการสินค้าโรงพยาบาล"`
- `components/admin/CatalogCrud.tsx:146,635,636,1237,1304,1579` — eyebrow/title/subtitle/placeholder/referral/empty-state
- `components/admin/OrdersQueue.tsx:1259,1262` — eyebrow + subtitle
- `app/admin-panel.tsx:182,184,204,229` — eyebrow/subtitle/labels
- `app/admin/branches.tsx:189` — eyebrow
- `components/admin/ReferrersAdmin.tsx:66` — role label "ทีมโรงพยาบาล"
- `app/login.tsx:35` — hint copy
- Brand logo hardcoded to `mira-care-logo.png` in `components/admin/AdminShell.tsx:10` (should fall back to `tenant.logo_url`)

### C. Customer-facing UI
- `app/package-detail.tsx:85,104` — shows `hospitalName` + "ยืนยันกับโรงพยาบาล", label "สาขา"
- `components/chat/OrderStatusCard.tsx:8,35`, `components/chat/BookingSheet.tsx:269` — client-rendered status labels mentioning "โรงพยาบาล"
- `app/sales-portal.tsx:732` — search placeholder

### D. ⚠️ Protected core / owner-only (NOT in scope — see §5)
- `lib/templates.ts:8` + `supabase/functions/_shared/templates.ts` — system notice "ทีมโรงพยาบาล" (templated notice; single-source + mirror + owner sign-off)
- OpenAI prompt `pmpt_…` + `lib/rag/healthKnowledge.ts` + `lib/rag/retriever.ts` — health consult behavior
- `transition_order` mandatory `buyer_age`

## 3. Architecture

### 3.1 `tenant_settings` table (Phase 1)
New table, **additive migration**, RLS mirroring `product_categories` (customer active read / staff read / admin write):

```
public.tenant_settings (
  tenant_id   uuid primary key references public.tenants(id),
  vertical    text not null default 'general',   -- 'general' | 'hospital' | 'beauty_clinic' | 'wellness' | ...
  vocabulary  jsonb not null default '{}'::jsonb, -- term overrides (see 3.2)
  branding    jsonb not null default '{}'::jsonb, -- brand_name / logo_url / colors (reuse tenants.display_name+logo_url as fallback)
  updated_at  timestamptz not null default now()
)
```
- Lightweight alternative considered: store in existing `tenants.features` jsonb (no migration). Rejected for clarity/extensibility; documented here so we don't re-litigate.
- Mirror the row type in `lib/types/api.ts` (`TenantSettingsRow`) — CI enforces the mirror.

### 3.2 Vocabulary keys + generic defaults
Resolution helper `lib/tenant/vocabulary.ts` returns a fully-populated object (override → default):

| key | default (generic) | example override (beauty clinic) |
|---|---|---|
| `product_term` | สินค้า | คอร์ส / บริการ |
| `category_term` | หมวดหมู่ | หมวดหมู่ |
| `branch_term` | สาขา | สาขา |
| `provider_term` | ผู้ให้บริการ | คลินิก |
| `customer_term` | ลูกค้า | สมาชิก |
| `order_term` | คำสั่งซื้อ | การจอง |
| `appointment_supported` | true | true |
| `appointment_term` | นัดหมาย | นัดหมาย |

Derived copy examples (no string says "โรงพยาบาล" unless a tenant opts in):
- catalog title → `จัดการ{product_term}` (default "จัดการสินค้า")
- search placeholder → `ค้นหาชื่อ{product_term} {provider_term} {category_term} {branch_term} หรือ tag`
- package-detail subtitle → `{providerName} · {address || ยืนยันกับ{provider_term}}`

### 3.3 Frontend wiring
- `lib/tenant/useTenantVocabulary()` — loads `tenant_settings` for the active tenant, falls back to generic defaults; demo mode uses the demo fixture's vocabulary.
- Admin/customer screens consume the hook instead of literal Thai strings.

## 4. Phased plan (1 PR per phase — AGENTS.md §3.1)

### Phase 0 — Plan doc + generic defaults (low-risk, immediate)
- This document.
- `lib/tenant/vocabulary.ts` (defaults + resolver, no DB yet).
- Replace hardcoded admin copy (audit §B) with default-resolved strings.
- **DoD:** `npm run typecheck` + `npm run v2:verify` green; no "โรงพยาบาล" literal remains in admin screens; screenshot of `/admin/catalog` shows generic "สินค้า" copy.

### Phase 1 — `tenant_settings` table + RLS + hook
- Additive migration (table + RLS + indexes), `TenantSettingsRow` mirrored in `lib/types/api.ts`.
- `loadTenantSettings()` in the marketplace lib + `useTenantVocabulary()` hook; wire admin/customer screens to live config.
- **DoD:** `scripts/rls-check.mjs` + `scripts/type-mirror-audit.mjs` green; verified read as customer + staff + admin.

### Phase 2 — Vertical-neutral categories
- `categoryLabels` fallback → tiny generic map (`general`→ทั่วไป, `other`→อื่นๆ); rely on DB labels otherwise.
- `emptyDraft.category` → first active category (fallback `general`); remove health heuristic from `inferCategory`.
- New additive migration: ensure every tenant has a `general` category; add a **per-vertical category template** seeding path used at onboarding (do NOT edit the old seed migration).
- **DoD:** schema audit green; new tenant with `vertical='beauty_clinic'` gets beauty categories, not checkup/vaccine.

### Phase 3 — Branding + demo vertical
- `AdminShell` uses `tenant.logo_url` (fallback to bundled logo); customer pages use `provider_term`/`branch_term`.
- Add a **"คลินิกเสริมสวย" demo fixture set** (`lib/showcase/demoFixtures.ts`) so sales can demo white-label live to beauty-clinic prospects.
- **DoD:** demo mode renders beauty-clinic vocabulary end-to-end; `npm run v2:verify` green.

### Phase 4 (OWNER-GATED — proposal only, not in this workstream)
- Parametrize system notice + order-status labels with `{brand}/{provider}` (requires templates single-source + mirror + chat regression 3–5×).
- Multi-vertical prompt/RAG strategy (per-tenant prompt vs neutral prompt) — owner re-tunes on OpenAI Platform.
- Configurable intake (`buyer_age`/appointment) per vertical — touches `transition_order` (protected order state machine).

### Phase 5 (optional, cosmetic)
- Rename `hospitalProducts.ts`→`catalog.ts`, `HospitalProduct`→`CatalogProduct`, `hospitalName`→`providerName`, slug `demo-hospital`→neutral. Mechanical repo-wide refactor; low value/high churn — do last.

## 5. Protected-core boundaries (must respect)
- Migrations additive only; new tables ship RLS in the same migration (AGENTS.md §2 Tenancy & Migrations).
- Type changes mirrored in `lib/types/api.ts` (CI enforced).
- Do NOT touch `_shared/openai.ts`, marker protocol, `transition_order`, money fields, or the reply path in this workstream.
- `templates.ts` system notice is owner-gated (Phase 4 proposal).

## 6b. Execution log (2026-06-16)

Phases 0–3 implemented in one pass. Files:
- New: `lib/tenant/vocabulary.ts` (types, generic defaults, vertical presets, resolver, `catalogScreenCopy`), `lib/tenant/useTenantConfig.ts` (`loadTenantSettings` + `useTenantConfig`/`useTenantVocabulary` hook).
- Types: `TenantSettingsRow` added + mirrored in `lib/types/api.ts` and `supabase/functions/_shared/types.ts`.
- Migrations: `20260616020000_white_label_tenant_settings.sql` (table + RLS + per-tenant seed), `20260616030000_vertical_category_templates.sql` (neutral `general` category + `seed_category_template(tenant, vertical)`).
- Data layer: `lib/marketplace/hospitalProducts.ts` — neutral `categoryLabels`, vertical-neutral `inferCategory`.
- Admin/customer copy wired to vocab: `app/admin/catalog.tsx`, `components/admin/CatalogCrud.tsx`, `app/admin-panel.tsx`, `app/package-detail.tsx`, `components/admin/AdminShell.tsx` (logo → `tenant.logo_url`). Static neutralization (no per-tenant vocab) where the string lives in a prop-only sub-component: `components/admin/OrdersQueue.tsx`, `components/admin/ReferrersAdmin.tsx` (staff label), `app/admin/branches.tsx`, `app/login.tsx`, `app/sales-portal.tsx`.
- Demo: `lib/showcase/demoFixtures.ts` beauty-clinic set + `demoCatalogForVertical()`; demo reachable via `/admin/catalog?tour=admin&vertical=beauty_clinic`.

Verification (local, all green): `typecheck`; audits `types:mirror-audit`, `v2:schema-audit`, `v2:client-audit`, `v2:docs-audit`, `v2:type-safety-audit`, `v2:health-safety-audit`, `v2:edge-security-audit`, `showcase:route-audit`, `referrals:link-audit`, `chat:quality`, `orders:status-audit`, `orders:rpc-grant-audit`, `v2:open-questions-audit`, `v2:local-readiness-audit`, `v2:pdpa-coverage-audit`, `templates:mirror-audit`, `v2:deploy-audit`; `v2:deno-check`; `v2:deno-test` (136 passed). Reply path untouched → chat regression not required.

Owner to-do before this is live: apply the two migrations to the linked project (agents don't touch live env — AGENTS.md §5). Until applied, `loadTenantSettings` simply returns generic defaults (graceful).

Known follow-ups (out of this scope): chat presentational cards (`OrderStatusCard`/`BookingSheet`), `templates.ts` system notice, RAG/prompt, referrer `type` labels (doctor/nurse), `user-profile` health-share consent label, marketing copy in `MiraLandingPage`/showcase `registry.ts` — all tracked under §5 (Phase 4) or are health-domain features.

## 6. Gates per PR
- `npm run typecheck` + `npm run v2:verify` green.
- If any reply-path/template change sneaks in → mirror edge↔client + run chat regression 3–5× (1 run can false-green).
- Update this doc's DoD checkboxes (✅/❌ + date) in the same PR that executes a phase.
