# Mira Design Code Integration - 2026-06-25

## Source Used

The `/showcase/` route now loads the provided design code directly from:

- `C:\Users\taksi\Downloads\Website redesign request (3).zip`
- extracted design file: `Mira Core System.dc.html`
- extracted runtime: `support.js`
- extracted asset: `assets/logo.webp`

The app no longer recreates the admin UI with the previous React Native custom shell. `app/index.tsx` is now only a host that renders the supplied design HTML in a full-window iframe.

## Files Added Or Changed

- `app/index.tsx`
  - Hosts the supplied design HTML.
  - Passes Supabase public config, tenant slug, signed-in user email, and access token into the iframe.
- `public/mira-design/mira-core-system.dc.html`
  - Copied from the supplied zip.
  - Only changed to load `mira-design-adapter.js` after the design runtime.
- `public/mira-design/support.js`
  - Copied from the supplied zip.
  - Small bridge added to expose the running design component instance on `window.__dcInstances`.
- `public/mira-design/mira-design-adapter.js`
  - Backend adapter that maps existing Mila backend data into the supplied design state.
- `public/mira-design/assets/logo.webp`
  - Copied from the supplied zip.

## Backend Plugged Into The Supplied UI

The adapter attempts to load real backend data from the existing Supabase project:

- Tenant lookup from `tenants` by slug.
- Products from `products`.
- Orders from `orders`, with product, branch, and referrer joins when allowed by RLS.
- Referrers from `referrers`.
- Commission rows from `commission_entries`.
- Chat sessions from `chat_sessions`.
- Payment rows derived from order payment state.
- LINE webhook URL derived from Supabase functions URL and tenant slug.

The adapter patches these design actions:

- Order advance: calls `admin-order-action` with `confirm`, `book`, or `done`.
- Order cancel: calls `admin-order-action` with `cancel`.
- Payment confirm: calls `admin-order-action` with `confirm`.
- Payment reject: calls `admin-order-action` with `cancel`.

The adapter does not write `orders.status` directly. It keeps the existing order state-machine path.

## Current Backend Test Result

Headless browser test without a logged-in Supabase admin session:

- Design iframe renders: PASS
- Design component instance available: PASS
- Admin orders screen can be shown from supplied design state: PASS
- Backend config passed into iframe: PASS
- Backend sync result: BLOCKED by auth/RLS visibility
- Observed error: `Tenant not found: demo-hospital`

This means the adapter is wired, but the unauthenticated browser test cannot see the tenant row through Supabase REST. This should not be solved by exposing service-role secrets in the browser. The design needs either to receive a real admin session from the host app, or the supplied design must include a real Supabase login flow.

## Things Still Not Fully Connected

These are not rebuilt with fake UI. They are intentionally left as explicit gaps until a matching UI contract is provided or approved.

1. Real login inside the supplied design
   - The supplied design has account/login-looking UI, but it is not a real Supabase auth flow.
   - Current host can pass an existing app session into the iframe.
   - If the design must handle login itself, it needs real email/password or magic-link UI states and error/loading states.

2. Conversation reply and takeover
   - The design has conversation UI.
   - The adapter loads `chat_sessions`.
   - It does not yet call `admin-line-reply` for replies/takeover because the selected session, transcript, mode switch, and send-state contract must be mapped cleanly.

3. Product create/edit/status/Stripe sync
   - The adapter can load products into the design.
   - Product save, active/draft toggle, stock updates, branch assignment, and Stripe sync are not patched yet.
   - These should map to the existing catalog backend paths instead of direct table writes.

4. Referrer management actions
   - The adapter can load referrers and commissions.
   - Create/approve/deactivate/referral payout actions are not patched yet.
   - Need explicit UI action states for pending, paid, rejected, and payout audit trail.

5. Reopen or clone order
   - The supplied design has an order-management surface.
   - Existing protected order flow should not be bypassed.
   - If reopen/clone is required, it needs a backend action/RPC contract first.

6. AI Chat module as a full real chat app inside this design
   - The top-level AI Chat tab exists in the supplied design.
   - The existing AI sales engine remains available in the backend/app.
   - The supplied design still needs a complete chat-message streaming/input/product-card/order-panel contract before the backend can be plugged into that exact UI.

## Evidence

Screenshots generated from the supplied design code:

- `test-artifacts/ui-audit-20260625-design-code/01-showcase-design-code-admin.png`
- `test-artifacts/ui-audit-20260625-design-code/03-showcase-design-code-orders-state.png`
- `test-artifacts/ui-audit-20260625-design-code/04-showcase-design-code-orders-after-build.png`
- `test-artifacts/ui-audit-20260625-design-code/06-showcase-relative-design-code-orders.png`

Machine-readable checks:

- `test-artifacts/ui-audit-20260625-design-code/design-code-orders-state-check.json`
- `test-artifacts/ui-audit-20260625-design-code/design-code-after-build-check.json`
- `test-artifacts/ui-audit-20260625-design-code/showcase-relative-design-code-check.json`

Validation run:

- `npm run typecheck`
- `npm run build`
