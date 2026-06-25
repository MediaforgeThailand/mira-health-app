# Mira Design Code Integration - 2026-06-25

## Source Used

The `/showcase/` route loads the supplied design code directly from:

- `C:\Users\taksi\Downloads\Website redesign request (3).zip`
- extracted design file: `Mira Core System.dc.html`
- extracted runtime: `support.js`
- extracted asset: `assets/logo.webp`

`app/index.tsx` is only the host shell. It renders the supplied design HTML in a full-window iframe and passes Supabase public config/session into it.

## No-Mock Runtime Contract

The supplied design file no longer falls back to the design seed data at runtime:

- Initial state starts as `loading`, logged out, and `orders: []`.
- Generated seed orders/products/referrers/commissions/conversations/payments/LINE events were removed from runtime state.
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
- Referral share: uses the logged-in referrer's backend profile, code, commission rows, orders, copy-to-clipboard, and real QR link.

The adapter does not write `orders.status` directly. It keeps the protected order state-machine path.

## Still Blocked By Missing Backend Contract Or Schema

These UI controls are not faked. They intentionally do not mutate local mock state:

1. Stock controls inside the product form
   - The supplied UI has stock/reserved controls.
   - The production `products` table currently has no stock or reserved quantity columns.
   - Clicking apply records a missing-backend note instead of creating fake inventory.

2. LINE test send button
   - The supplied UI includes a manual test-send input.
   - Existing production flow is webhook/inbox based through `line-webhook` and `admin-line-reply`.
   - There is no approved backend contract for arbitrary UI test sends yet.

3. Chat payment upload/checkout from the supplied AI chat screen
   - The AI Chat tab can talk to `chat-orchestrator`.
   - The supplied screen does not provide a complete order/payment panel contract yet.
   - Checkout/payment should be added against the existing order/payment backend, not faked in UI.

4. Referral direct purchase from the referral webapp
   - Backend support exists through `referrer-order`.
   - The supplied referral UI only has dashboard/share/earnings surfaces.
   - It needs a real product/order form UI before this can be connected cleanly.

## Validation

Validation passed after this integration:

- `node --check public/mira-design/mira-design-adapter.js`
- `npm run typecheck`
- `npm run build`
- `npm run v2:verify`
- Browser check on `/showcase/` for auth-required no-mock state and supplied design rendering.

Evidence files:

- `test-artifacts/ui-audit-20260625-design-code/08-no-mock-auth-required.png`
- `test-artifacts/ui-audit-20260625-design-code/08-no-mock-auth-required-check.json`
