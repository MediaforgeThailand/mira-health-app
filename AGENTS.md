# Mila AI Project Instructions

This file gives permanent project instructions for Codex and every AI agent working in this repository. Read it before writing code. If a task conflicts with this file, stop and ask the owner.

Mila AI has only 3 core product modules:

1. AI Chat Sales Agent
2. Referral Program
3. Admin Channel / Back Office

## Core Product Scope

### AI Chat Sales Agent

The AI Chat Sales Agent handles customer conversations, product recommendations, product Q&A, checkout/payment, order creation, and service booking or lead handoff.

The chat system should be channel-independent. LINE OA, website chat, Facebook, Instagram, or other channels should plug into the same AI sales/chat engine instead of forking separate business logic.

### Referral Program

The Referral Program handles referral links, QR codes, attribution tracking, commission calculation, referral dashboards, and direct purchase flows where a referrer can order on behalf of another person.

Referral is a separate webapp from the chat UI, but it must use the same product catalog, order backend, referral attribution, and commission rules.

### Admin Channel / Back Office

The Admin Channel handles product management, stock, orders, payments, fulfillment, leads, bookings, sales/admin assignment, and data used by AI Chat and Referral Program.

Admin is the source of truth for sellable products, services, stock, booking/lead handling, and operational order state.

## Strict Rules

- Do not rebuild the system from scratch.
- Do not rewrite major architecture unless explicitly requested.
- Do not delete files without checking usage.
- Do not remove business logic just because UI looks messy.
- Prefer incremental changes.
- Preserve existing bug fixes and working logic.
- If uncertain, classify the file or feature as REVIEW instead of deleting it.
- Do not touch auth, payment, orders, products, stock, booking, leads, referral attribution, commission, database migrations, webhooks, middleware, environment config, or shared utilities unless the task explicitly requires it.
- Always inspect existing patterns before adding new code.
- Always use the package manager and scripts already present in the repository.
- Run build/lint/test/typecheck when available.
- Report exact files changed and exact validation commands run.

## Cleanup Policy

When cleaning the codebase:

- Audit first.
- Classify items as KEEP, REVIEW, REMOVE CANDIDATE, or DO NOT TOUCH.
- Remove only low-risk REMOVE CANDIDATE items after import/reference checks.
- Never remove REVIEW or DO NOT TOUCH items without explicit approval.
- Keep the 3 core modules working after every cleanup step.

## Manual Test Flows That Must Not Break

1. AI Chat product purchase flow
2. AI Chat service booking or lead handoff flow
3. Referral link/QR attribution flow
4. Referral direct purchase flow
5. Commission calculation flow
6. Admin product management flow
7. Admin stock management flow
8. Admin order management flow
9. Admin lead/booking management flow

## Repository-Specific Protected Areas

These existing implementation areas are protected because they support the 3 core modules. Touch them only when the user's task explicitly requires it, and keep changes small and verified.

| Area | Files / Concepts | Rule |
|---|---|---|
| AI model contract | `supabase/functions/_shared/openai.ts`, prompt variables, prompt version env | Do not inline prompt text, add hidden system prompts, change model/tool behavior, or flip prompt versions without explicit approval. |
| Chat marker protocol | `supabase/functions/_shared/marker.ts` | Preserve product/category/order-status marker parsing unless a task explicitly asks for a new protocol and tests. |
| Chat orchestration | `chat-orchestrator`, shared chat types, channel adapters | Keep backend chat behavior shared across channels. Do not script sales replies in code when the AI model should answer. |
| Product catalog | product tables, admin catalog routes, catalog APIs | The catalog is the source of truth for what AI and Referral can sell. Do not create a second catalog source. |
| Order state machine | order helpers, `transition_order`, admin order actions | Do not update `orders.status` directly. Use the existing state transition path. |
| Payment and money | PromptPay, Stripe, order amount fields, commission snapshots | Do not calculate price or commission from AI text or UI-only values. Use backend/catalog/order data. |
| Referral attribution | referral bind/order functions, referrer records, commission entries | Preserve first-touch attribution and commission calculation behavior unless explicitly changing referral policy. |
| Database and tenancy | migrations, RLS, tenant-aware business tables | New database changes must be additive and include security/RLS considerations in the same change. |
| Shared infrastructure | API clients, middleware, environment config, shared utilities | Treat these as shared by all 3 modules. Do not clean them up as "unused" without a full reference check. |

## Validation Guidance

Use only scripts already present in `package.json` or project config. If a command is missing, report that it is not available instead of inventing a substitute.

Typical validation commands in this repository include:

- `npm run typecheck`
- `npm run v2:verify`
- `npm run build`

Run narrower tests/audits when the task scope is small, and run the broader verification gate when touching shared behavior or any protected area.

## Documentation And Product Positioning

Mila AI should be described as an AI Sales and MarTech system centered on the 3 core modules above. Legacy healthcare or showcase surfaces may exist as historical proof, but they must not drive new product decisions unless the owner explicitly asks for that vertical.

Primary product work should prefer real operational screens over showcase/mockup pages. If a route cannot connect to real data yet, show a clear setup/auth/empty state instead of inventing fake operational data.
