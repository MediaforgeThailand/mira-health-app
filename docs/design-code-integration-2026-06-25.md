# Mira Design Code Integration - 2026-06-25

## Source Used

The `/showcase/` route loads the supplied design code directly from the latest supplied design package:

- `C:\Users\taksi\Downloads\Website redesign request (5).zip`
- extracted design file: `Mira Core System.dc.html`
- extracted asset: `assets/logo.webp`

`app/index.tsx` is only the host shell. It renders the supplied design HTML in a full-window iframe and passes Supabase public config/session into it.

`support.js` is intentionally kept from the previous integration because it includes the local DC instance bridge used by `mira-design-adapter.js`. The incoming `support.js` does not expose that bridge, so replacing it would disconnect the backend adapter.

## No-Mock Runtime Contract

The supplied design file no longer falls back to the design seed data at runtime:

- Initial state starts as `loading`, logged out, and `orders: []`.
- Generated seed orders/products/referrers/commissions/conversations/payments/LINE events were removed from runtime state.
- Request (5) in-memory order creation, commission creation, chat replay timers, referral history seeds, and LINE status demo switching are disabled in the design logic itself.
- Without a real Supabase session the UI shows the real login/auth-required state instead of fake admin data.
- With a real session the adapter replaces the design state from Supabase/backend only.
- Fake register/demo-error actions were removed from the login footer.
- Referral QR now renders from the real referral link when a backend referrer profile exists.

## Production Backend Connected

The adapter now loads real data from Supabase:

- `tenants`
- `tenant_members`
- `products`
- `orders` with product, branch, customer, and referrer joins when RLS allows
- `referrers`
- `commission_entries`
- `chat_sessions`
- `chat_messages`
- `branches`
- `product_branches`

The adapter now wires these UI actions to production paths:

- Login: Supabase email/password auth.
- Orders: `admin-order-action` for confirm, book, done, cancel, payment confirm, and payment reject.
- Products: create/update through `products` REST rows; Stripe sync through `admin-stripe-product-sync`.
- Commissions: approve/pay/void through `commission_entries` updates.
- Conversations: reply/takeover/return-to-AI through `admin-line-reply`.
- AI Chat tab: sends messages to `chat-orchestrator` and renders real text/product cards from the response.
- AI Chat input in the supplied phone UI is now a real input bound to `chat-orchestrator`; it is no longer a decorative div.
- Referral share: uses the logged-in referrer's backend profile, code, commission rows, orders, copy-to-clipboard, and real QR link.
- Referral direct purchase for service/catalog rows: creates real orders through `referrer-order` when the logged-in user has an active backend referrer profile and the product has a backend `catalog_key`.
- Admin order fulfillment for service bookings: uses `admin-order-action` with `action: "book"` and `booking_at`.
- Admin referrer create/edit/status/scheme drawer: writes to the production `referrers` table and preserves immutable backend `ref_code` rules.

The adapter does not write `orders.status` directly. It keeps the protected order state-machine path.

## Still Blocked By Missing Backend Contract Or Schema

These UI controls are not faked. They intentionally do not mutate local mock state:

1. Stock and inventory movement
   - The supplied UI has stock/reserved controls and a stock movement subpage.
   - The production `products` table currently has no stock or reserved quantity columns.
   - There is no production stock ledger/movement table yet.
   - Clicking stock actions records a missing-backend note instead of creating fake inventory.

2. LINE verify/test controls
   - The supplied UI includes verify/test controls.
   - Existing production flow is webhook/inbox based through `line-webhook` and `admin-line-reply`.
   - There is no approved backend health-check contract for credential/webhook verification or arbitrary UI test sends yet.
   - Demo status buttons from the supplied design are hidden and do not mutate production status.

3. AI Chat checkout bottom sheet
   - The AI Chat tab can talk to `chat-orchestrator`.
   - Request (5) added a checkout/payment bottom sheet, but the handoff states it was implemented as in-memory mock.
   - There is no production API to create an AI checkout order from this direct form yet.
   - The UI now shows a clear backend-required error instead of creating an in-memory order.

4. Referral direct purchase for shippable products
   - `referrer-order` supports catalog/service order creation, buyer info, age, branch, and preferred date.
   - The current backend contract has no shipping-address/courier/tracking fields.
   - Product shipment orders are blocked with a clear message instead of hiding the address in another field.

5. Product shipment fulfillment
   - The supplied admin modal has courier/tracking inputs.
   - The production order backend currently has no courier/tracking columns or action.
   - Service booking is connected; product shipment persistence is blocked until schema/contract exists.

6. Referrer email
   - The supplied drawer has an email input.
   - The production `referrers` table has no email column.
   - Email is not saved; the adapter records a missing-backend note if a value is entered.

## Validation

Validation passed after the request (5) integration:

- `node --check public/mira-design/mira-design-adapter.js`
- `npm run typecheck`
- `npm run build`
- `npm run v2:verify`
- Static smoke check on `http://127.0.0.1:4321/showcase/`
- UTF-8 HTTP check on `/showcase/mira-design/mira-core-system.dc.html`

Evidence files:

- `test-artifacts/ui-audit-20260625-design-code/08-no-mock-auth-required.png`
- `test-artifacts/ui-audit-20260625-design-code/08-no-mock-auth-required-check.json`

Request (5) no-mock scan results:

- adapter script present: yes
- Thai text remains valid UTF-8: yes
- live AI chat input present: yes
- `MIRA-NAPA`: 0
- `#MA-105x`: 0
- `api.mira.health`: false
