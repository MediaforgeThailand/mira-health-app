# MiraCare v2 Audit Report - 2026-06-11

Scope: current worktree against `docs/miracare-codex-handoff.md`, `docs/miracare-v2-technical-spec.md`, and `docs/miracare-v2-product-plan.md` in the documented precedence order.

## Verification Run

- PASS: `npm run typecheck`
- PASS: `npm run v2:verify` (deterministic local verification bundle)
- PASS: `npm run v2:external-preflight` (script ran; five external gates report WAIT in this environment)
- PASS: `npm run v2:type-safety-audit` (109 TypeScript files scanned)
- PASS: `npm run chat:quality`
- PASS: `npm run orders:status-audit`
- PASS: `npm run v2:schema-audit` (16 tables, 32 policies, 31 indexes, 33 migrations checked)
- PASS: `npm run v2:open-questions-audit` (LINE sandbox credentials topic checked)
- PASS: `npm run v2:local-readiness-audit` (0 Missing rows, 0 decision blockers, 5 external gates checked)
- PASS: `npm run v2:docs-audit` (12 docs checked)
- PASS: `npm run v2:client-audit` (30 production files, 3 removed routes, 65 client files secret-scanned)
- PASS: `npm run v2:edge-security-audit` (active v2 edge surface)
- PASS: `npm run types:mirror-audit` (active exported types checked)
- PASS: `npm run v2:deno-check` (active v2 edge entrypoints)
- PASS: `npx.cmd -y deno@2.8.2 test --allow-env --allow-net --import-map=supabase/functions/import_map.json supabase/functions/_shared/__tests__/` (active shared Deno suite)
- PASS: `git diff --check` (Windows line-ending warnings only)

## Findings

| Area | Result | Severity | Evidence | Suggested fix |
|---|---|---:|---|---|
| Model integration contract | PASS | P0 | `chat:quality` verifies prompt ID variables, `store:false`, no local prompt layering, no legacy `mira-chat` call | Keep `chat:quality` required in CI. |
| Published OpenAI prompt content | PASS | P0 | Owner-side verification: the published prompt v2 default was authored and behavior-tested in OpenAI Platform on 2026-06-10/11, and the owner reports the live 7-case regression passes. Codex must not fetch prompt content from code. | Keep prompt changes owner-published as new Platform versions and regression-tested. |
| Type safety and shared API mirrors | PASS | P0 | `typecheck`, `v2:type-safety-audit`, `types:mirror-audit` | Keep audits required in CI. |
| Deterministic local verification bundle | PASS | P0 | `v2:verify` runs typecheck, static audits, Deno edge check, and shared Deno tests | Keep external-secret checks separate and documented. |
| External gate readiness preflight | PASS | P0 | `v2:external-preflight` reports missing prerequisites for live Supabase seeding, chat regression, live RLS, commerce E2E, and LINE sandbox without printing secrets | Use before attempting external verification runs; it does not prove those runs passed. |
| Open-question contract hygiene | PASS | P0 | `v2:open-questions-audit` checks the allowed remaining unresolved topics and blocked gap rows | Keep this gate in CI so implementation does not silently drift from the "log questions, do not guess" rule. |
| Local readiness hygiene | PASS | P0 | `v2:local-readiness-audit` checks there are no unblocked `Missing` rows and keeps owner/external blockers visible | Keep this gate in CI so local-doable work stays separate from contract/credential blockers. |
| Documentation evidence hygiene | PASS | P2 | `v2:docs-audit` checks v2 docs for stale verification counts and required command evidence | Keep this gate in CI so audit output stays tied to current verification. |
| Schema contract and migration numbering | PASS | P0 | `v2:schema-audit` | Keep schema audit required in CI. |
| Live RLS tenant isolation | PASS | P0 | `scripts/rls-check.mjs` creates disposable auth users, checks customer A cannot read customer B rows through PostgREST, denies cross-tenant product writes, runs in the optional `live-regression` job, and passed against the linked project after final redeploy | Preserve the local cleanup behavior. |
| Service-role tenant filtering | PASS | P0 | `v2:edge-security-audit` asserts `_shared/internalAuth.ts` is used by `fact-extractor`; Deno tests reject anon tokens with 401 before internal work | Keep internal functions service-role only and derive tenant from row chains, not request tenant fields. |
| Customer chat code path | PASS | P1 | React Query history, persisted messages, no-persist `refresh_order`, consent action, `chat-orchestrator`, marker parsing; `chat:quality` and client audit pass | Keep code-path audits in CI. |
| Seeded chat regression credentials | PASS | P1 | `scripts/create-test-jwt.mjs` creates/updates `regression-test@miracare.dev`, prints only the token when run directly, and `chat-regression` bootstraps it inline when service-role secrets exist; the live 7-case suite passed after final redeploy | Keep the optional live-regression job as the repeatable proof path. |
| Order state machine and admin queue | PASS | P1 | `transition_order`, PromptPay tests, action-response `system_notice` persistence/rendering, admin queue, slip signed-read action, status-write audit, `scripts/e2e-commerce.mjs` live runner passing against the linked project | Keep deterministic tests/audits required in CI. |
| Slip upload contract | PASS | P1 | `request_slip_upload` validates ownership and returns a service-role signed upload URL; `payment_done` validates/stores order-scoped `slip_path`; admin thumbnails use server-generated signed read URLs | Run seeded purchase E2E with a real uploaded slip before release. |
| Persisted order-panel reload | PASS | P1 | `refresh_order` rebuilds `toOrderPanel(loadActiveOrder(session, tenant))` with empty text and the client renders it outside `MessageBubble` after history hydration | Run seeded purchase E2E through admin booking. |
| Referral and commissions code path | PASS | P1 | attribution route, assisted purchase, commission unit tests, referrer admin audit | Keep deterministic tests/audits required in CI. |
| Referral production contracts and live E2E runner | PASS | P1 | B8 locks 6-character Crockford ref codes, server-generated immutable codes, default 10% commission, accepted `ref_code` transport, and `scripts/e2e-commerce.mjs` proved attributed purchase plus commission snapshot math against the linked project | Keep the runner in the optional live job. |
| Lab/wearable/health runtime | ARCHIVED | P1 | Historical migrations remain, but active UI, edge functions, helper tests, deploy entries, and health safety audit were removed from the current product scope | Reintroduce only through a new owner-approved product decision and fresh UI/backend contract. |
| LINE deterministic surface | PASS | P1 | signature/postback/Flex/QR helper tests, edge audit, `line-webhook` check | Keep deterministic LINE tests in CI. |
| LINE sandbox regression | FAIL | P1 | No tenant LINE sandbox channel credentials/test account were available; `docs/line-setup.md` documents the env names, webhook URL, and manual checklist | Provide LINE sandbox channel credentials; then run sandbox regression. |
| Client production surface | PASS | P2 | `v2:client-audit` blocks mock/prototype leakage and keeps archived health routes removed | Confirm whether `/prototype` and mockup-only demo screens stay available for v2 release. |

## Blockers

The authoritative blocker list is `docs/v2-open-questions.md`. The goal is not complete until external secrets/sandbox evidence exists and each contract question is resolved or explicitly accepted by the owner.
