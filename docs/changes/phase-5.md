# Phase 5 Health Dashboard

Status 2026-06-25: archived. The historical migration remains, but the active
lab/wearable/health UI, edge functions, helper tests, fixtures, deploy entries,
and health-safety audit were removed from the current AI Sales / Referral /
Admin product scope.

## What Changed

- Added `lab_reports`, `lab_results`, and `wearable_metrics` with tenant/customer RLS, indexes including wearable tenant/day lookup, storage buckets, and Phase 5 lab fact keys.
- Added `lab-ingest` for authenticated lab import: creates a processing report, downloads from `lab-reports`, calls OpenAI vision structured extraction, stores result rows, sets `ready` or `needs_confirmation`, generates a one-time Thai summary for ready reports, and inserts ready lab facts.
- Added `wearable-ingest` for authenticated Apple Health zip or extracted `export.xml` import: streams storage objects, reads `export.xml` from zip chunks, aggregates supported daily metrics, upserts idempotent `wearable_metrics`, and stores latest weight/height as active `user_facts`.
- Added shared storage download/stream helpers, OpenAI lab extraction/summary helpers, lab row normalization, and chunk-based Apple Health XML/zip parsing helpers.
- Replaced the image-only `HealthInsightScreens` implementation with live data from `lab_reports`, `lab_results`, `wearable_metrics`, and `user_facts`.
- Added a `Needs Confirmation` panel that lists low-confidence or unconfirmed lab rows from `lab_results`, lets the customer edit value/unit fields, and submits them through the trusted `lab-confirm` write path.
- Added `lib/health/v2HealthDashboard.ts` as the typed client loader for the health dashboard routes.
- Added sample fixture files for lab vision extraction and Apple Health XML parsing under `supabase/functions/_shared/__tests__/fixtures/`.
- Added deterministic lab-summary sanitization so ready lab summaries always append the fixed disclaimer from `supabase/functions/_shared/templates.ts` and remove diagnosis wording before storage.
- Added a shared 15-code lab normalization table from the spec and embedded it in the OpenAI vision system text; unsupported mapped codes now normalize to `UNMAPPED_*` instead of being trusted.
- Hardened lab and wearable follow-up writes with tenant filters where tenant context is available.
- Replaced the main `/(tabs)/health` screen with the same live `HealthInsightScreen` overview used by the Phase 5 routes.

## Verification

- `npm run typecheck` passed after Phase 5 implementation.
- `npm run chat:quality` passed after Phase 5 implementation.
- `npm run v2:client-audit` passed after replacing production mock routes and now asserts the Phase 5 routes render `HealthInsightScreen` while `lib/health/v2HealthDashboard.ts` reads `lab_reports`, `wearable_metrics`, and `user_facts`.
- `npm run v2:edge-security-audit` passed and now covers lab/wearable tenant-filter invariants where tenant context is available.
- `npm run v2:schema-audit` passed and now covers the Phase 5 table contracts, RLS policies, and health-dashboard indexes.
- `npm run v2:health-safety-audit` passed and now asserts the lab summary disclaimer/template path, the lab vision normalization table, the Phase 5 sample fixtures, Apple Health zip `export.xml` streaming, live dashboard table reads, no dashboard mock/model-call paths, and rule-based wearable trend windows.
- `git diff --check` passed after Phase 5 implementation.
- Shared Phase 5 tests were added in `supabase/functions/_shared/__tests__/lab_test.ts`, `wearable_test.ts`, and `supabase/functions/_shared/__tests__/fixtures/`; `npx.cmd -y deno@2.8.2 test --allow-env --allow-net --import-map=supabase/functions/import_map.json supabase/functions/_shared/__tests__/` currently passes locally with 83 tests and CI runs the same Deno workflow.
- The dashboard route audit now covers `HealthInsightScreens.tsx`, `lib/health/v2HealthDashboard.ts`, `health-check-results.tsx`, `body-overview.tsx`, and `wearable-health.tsx` for live table reads and no mock/model-call leakage.
- Browser smoke checks on `localhost:8081` render `/health-check-results`, `/body-overview`, `/wearable-health`, and `/ai-body-overview`. A web-only Expo Router `Link asChild` style-array crash was fixed by flattening the tab link style.

## Boundaries

- `lab-ingest` and `wearable-ingest` now use the B6 service-role internal contract and derive tenant context from customer rows instead of request tenant fields.
- Customer dashboard tenant resolution needs an owner decision because `lib/health/v2HealthDashboard.ts` currently resolves `tenants.slug` from the customer client, while Phase 1 tenant RLS is tenant-member-only. `docs/v2-open-questions.md` records whether to allow non-sensitive tenant reads, add a tenant-scoped customer RPC, or derive customer context without slug lookup.
- The spec does not provide a production synonym/alias matrix for raw Thai/English lab names, so the embedded normalization table currently contains the exact 15 supported codes from the spec and broader aliases are logged as an open question.
- Wearable ingestion keeps the accepted `wearable-imports` storage path and nullable wearable fact `source_ref`; live export-upload proof remains pending.
- Low-confidence lab confirmation writes use the authenticated `lab-confirm` edge function. It validates customer-owned `needs_confirmation` reports, updates only report-owned rows, marks confirmed rows, moves the report to `ready` when no low-confidence row remains unconfirmed, and inserts supported lab facts through the shared helper also used by `lab-ingest`.
- B8 accepts the lab fact-key and wearable bucket decisions made for this implementation.
