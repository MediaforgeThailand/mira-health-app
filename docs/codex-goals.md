# Current Codex Goals

Updated: 2026-06-23

The old MiraCare/showcase phase plan is superseded for new work. Current product validation is AI Sales and MarTech.

## Goal G1 - Real System Entry

- Root `/` is a system directory, not a showcase gallery.
- It lists the three real systems: AI Sales Chat, Admin Commerce, Referral Program.
- Rows link to real routes only.
- Mockup/concept labels do not appear on the primary entry.

## Goal G2 - AI Sales Chat

- `/chat` is the primary customer chat route.
- `/prototype` redirects to `/chat`.
- Referral landing and customer login continue into `/chat`.
- Payment return paths use `/chat`.
- Chat uses the existing `chat-orchestrator` and shared catalog/order backend.

## Goal G3 - Real Customer Orders

- `/orders` reads real `orders` through Supabase/RLS.
- No local fixture fallback on `/orders`; missing auth/config shows a clear setup/login state.
- Missing auth/config shows explicit setup/login state.

## Goal G4 - Admin Commerce

- Catalog, orders, branches, dashboard, and referrer admin remain the operational backoffice.
- Next schema work must add explicit service vs physical product handling.
- Fulfillment/shipping fields must be additive migrations.

## Goal G5 - Referral Program

- Referral webapp stays separate from AI Chat.
- Referral tools use the same catalog and order backend.
- `/r/[ref_code]` stores attribution and sends customers into `/chat`.
- Commission remains tied to confirmed orders and stored scheme snapshots.

## Goal G6 - Context Cleanup

- `AGENTS.md`, `README.md`, `DESIGN.md`, and `docs/ai-sales-martech-context.md` are the primary current-context files.
- Historical healthcare/showcase docs are evidence only, not the product direction.
- Primary navigation should not surface healthcare/showcase routes unless the owner asks.
