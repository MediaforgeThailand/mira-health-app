# Mira AI Sales and MarTech System

Mira is a white-label AI Sales and MarTech system built with Expo, React Native, TypeScript, Expo Router, Supabase, and Edge Functions.

The product is being rebuilt around three real systems:

- AI Commerce Chat Engine
- Admin Commerce Backoffice
- Referral Program Webapp

Healthcare/MiraCare is now a legacy vertical and proof source. New product work should validate Mira as a reusable AI Sales and MarTech platform.

## Quick Start

```bash
npm install
copy .env.example .env
npm run start
```

Fill `.env` with the Supabase project URL and publishable key.

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key_here
```

## Primary Routes

| System | Route | Purpose |
|---|---|---|
| AI Sales Chat | `/chat` | Real AI commerce chat for customers. |
| AI Sales Chat | `/orders` | Real customer order status list. No mock fallback. |
| Admin Commerce | `/admin-panel` | Admin hub. |
| Admin Commerce | `/admin/catalog` | Manage products/services AI can sell. |
| Admin Commerce | `/admin/orders` | Manage orders, booking confirmation, payment review, and fulfillment. |
| Admin Commerce | `/admin/branches` | Manage service branches/locations. |
| Admin Commerce | `/admin/dashboard` | Sales, order, catalog, branch, and referral overview. |
| Referral Program | `/partner` | Referrer workspace. |
| Referral Program | `/sales-portal` | Sales/referral working surface. |
| Referral Program | `/admin/referrers` | Admin referrer and commission management. |
| Referral Program | `/r/[ref_code]` | Public referral landing into `/chat`. |

`/prototype` is now a legacy alias that redirects to `/chat`. `/showcase/*` and `/tour/*` are historical surfaces, not the product entry. The legacy Health Dashboard UI has been archived and removed from active app routes.

## Development

```bash
npm run android
npm run ios
npm run web
npm run typecheck
```

Use Expo Go for fast previews. Use EAS Build later for store-ready builds, native modules, push notifications, or team distribution.

## Verification

```bash
npm run typecheck
npm run v2:verify
npm run v2:external-preflight
npm run v2:e2e-commerce
```

`v2:verify` is still the broad local gate inherited from the MiraCare build. During the rebuild, expect some audit names to still mention v2/health/showcase until those audits are renamed or retired.

The full gate still includes `v2:open-questions-audit` and `v2:local-readiness-audit`; keep those names in docs until the audit suite is renamed for the AI Sales/MarTech rebuild.

## AI Chat Backend

The customer chat calls the `chat-orchestrator` Supabase Edge Function. The current Gemini chat contract lives in that Edge Function provider boundary. The backend supplies:

- `brand_name`
- `user_nickname`
- `personal_context`
- `recent_chat`
- `product_catalog`

Do not ship a Gemini/Google API key inside a mobile or web client. Keep it in Edge Function secrets or another backend secret store.

## Supabase Secrets

```bash
supabase secrets set GEMINI_API_KEY=your_google_gemini_api_key_here
supabase secrets set GEMINI_MODEL=gemini-3.5-flash
supabase secrets set GEMINI_EXTRACT_MODEL=gemini-3.5-flash
supabase secrets set APP_BASE_URL=https://your-app.example
supabase secrets set MIRA_PUBLIC_APP_URL=https://your-app.example
```

Payment integrations may also require Stripe secrets if enabled.

## Deploy Edge Functions

```bash
supabase functions deploy chat-orchestrator
supabase functions deploy fact-extractor
supabase functions deploy admin-order-action
supabase functions deploy admin-stripe-product-sync
supabase functions deploy referrer-order
supabase functions deploy referral-bind
supabase functions deploy referral-self-provision
supabase functions deploy line-webhook --no-verify-jwt
supabase functions deploy stripe-checkout
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy stripe-promptpay-qr
```

On Windows, use the helper only when deployment is explicitly approved:

```powershell
.\scripts\deploy-v2-functions.ps1
```

## Current Rebuild Priorities

1. Keep primary routes real-only: no demo fixtures on `/chat`, `/orders`, `/admin/*`, `/partner`, or `/sales-portal`.
2. Add product kind support for `service` and `physical_product`.
3. Add delivery fields and fulfillment status for physical products.
4. Keep service booking fields and admin confirmation for service orders.
5. Keep referral attribution tied to customer orders and commission snapshots.
6. Rename or retire legacy healthcare/showcase audit names after the AI Sales/MarTech rebuild stabilizes.
