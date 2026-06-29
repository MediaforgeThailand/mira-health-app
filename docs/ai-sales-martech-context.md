# Mira AI Sales and MarTech Context

Updated: 2026-06-24

## Product Direction

Mira is being rebuilt as an AI Sales and MarTech system. The product is not being validated as a healthcare app anymore. Healthcare/MiraCare remains a legacy vertical and proof source, but the real product direction is a reusable sales engine that can sell products or services through AI chat and connect to referral-driven growth.

The legacy Health Dashboard UI is archived for later. Its customer-facing routes and showcase entries are removed from the active app so the product can stay focused on AI Sales, Referral, and Admin Commerce.

The system has three primary parts:

1. AI Commerce Chat Engine
2. Admin Commerce Backoffice
3. Referral Program Webapp

## Primary Flow

Referral creates demand, AI Chat closes the sale, and Admin Commerce fulfills or confirms the order.

1. A referrer uses the Referral Program webapp to pick products/services from the shared catalog and send a referral link or QR.
2. The customer lands in AI Chat through that link or another channel.
3. AI Chat recommends catalog items, creates an order, and collects the required next data:
   - Service: preferred date/time window, branch/location, buyer contact details.
   - Physical product: delivery address, buyer contact details.
4. Customer pays through the configured payment path.
5. Admin Commerce receives the order:
   - Service orders are confirmed by staff, with booking time updated in the backoffice.
   - Physical product orders are fulfilled/shipped, with shipping status updated in the backoffice.
6. AI Chat can answer customer status questions from real order data.
7. Referral commission is calculated from confirmed orders and stored snapshots.

## Current Primary Routes

| System | Route | Purpose |
|---|---|---|
| AI Sales Chat | `/chat` | Real customer AI commerce chat. Uses the shared chat engine and order backend. |
| AI Sales Chat | `/orders` | Real customer order status list. No mock fallback. |
| Admin Commerce | `/admin-panel` | Admin hub. |
| Admin Commerce | `/admin/catalog` | Manage products/services AI can sell. |
| Admin Commerce | `/admin/orders` | Manage purchases, service bookings, payment confirmation, and fulfillment actions. |
| Admin Commerce | `/admin/branches` | Manage branches/locations for service booking. |
| Admin Commerce | `/admin/dashboard` | Sales, order, catalog, branch, and referral overview. |
| Referral Program | `/partner` | Referrer workspace. |
| Referral Program | `/sales-portal` | Sales/referral working surface. |
| Referral Program | `/admin/referrers` | Admin referrer and commission management. |
| Referral Program | `/r/[ref_code]` | Public referral landing that stores attribution and continues into `/chat`. |

## Current Legacy or Non-Primary Routes

| Route | Status |
|---|---|
| `/prototype` | Legacy alias. Redirects to `/chat`. |
| `/tour/[module]` | Historical tour route. Not the primary product entry. |
| `/showcase/*` | Historical showcase/concept routes. Not primary. |
| Health Dashboard UI | Archived on 2026-06-24. Customer-facing health dashboard routes were removed from the active app; backend/schema history is left untouched for a future owner-approved restart. |

## Implementation Rules

- Primary routes must use real backend state or show an auth/setup/empty state. Do not use demo fixtures on primary routes.
- AI Chat, Admin Commerce, and Referral must share the same catalog/order/referral tables.
- Product/service type support must be added as shared backend fields, then reflected in admin, chat, referral, and fulfillment UI.
- Channel support must be adapter-based. LINE OA, website, Facebook, and Instagram should call the same chat/order engine.
- The current OpenAI prompt contract is still binding until the owner publishes a generic AI Sales prompt. Do not work around prompt limitations with scripted assistant replies.

## Next Build Priorities

1. Finish replacing primary mock surfaces with real auth/setup/empty states.
2. Add explicit product kind support: `service` vs `physical_product`.
3. Extend order details for physical delivery: shipping address, shipping status, tracking code.
4. Extend service booking details: preferred time window, staff-confirmed booking time, branch.
5. Make Admin Orders show service vs product handling clearly.
6. Make Referral Program send customers to `/chat` with attribution intact.
7. Rename or retire legacy audit names after the AI Sales/MarTech rebuild stabilizes.
