# Phase 6 LINE Webhook

## What Changed

- Added `line-webhook` with `x-line-signature` HMAC verification, per-tenant `?tenant=<slug>` routing, LINE message/postback/follow event handling, and LINE reply API calls.
- Added an internal `orchestrateLine(...)` path that resolves customers by `line_user_id` and reuses the shared chat/order/product orchestration.
- Added LINE Flex product carousel replies with `select_product:<catalog_key>` postbacks.
- Added server-side PromptPay QR rendering via `qrcode`, upload to the public `line-assets` bucket, LINE image QR replies, and a separate payment Flex with `payment_done:<order_id>` postbacks.
- Added `_shared/line.ts` for timing-safe LINE signature verification, reply, push, postback action parsing, Flex product/payment builders, QR image message builders, and per-tenant channel-token lookup shared by the webhook and admin booking notifications.
- Added LINE push delivery attempts for admin confirmed/booked notices on `chat_line` orders.
- Added public `line-assets` bucket creation and a shared storage upload helper.
- Added `line-webhook` to the deployment helper.

## Verification

- `npm run typecheck` passed after Phase 6 implementation and after the final LINE token env correction.
- `npm run chat:quality` passed after Phase 6 implementation.
- `git diff --check` passed after Phase 6 implementation.
- `npx.cmd -y deno@2.8.2 test --allow-env --import-map=supabase/functions/import_map.json supabase/functions/_shared/__tests__/line_test.ts` passed with 14 LINE helper tests covering tenant token lookup, underscore-normalized tenant env fallback, signature verification, text truncation, empty-product handling, Flex product postbacks, LINE QR image payloads, payment postbacks, and LINE postback-to-action mapping.
- `npx.cmd -y deno@2.8.2 test --allow-env --allow-net --import-map=supabase/functions/import_map.json supabase/functions/_shared/__tests__/` passed for the active shared Deno tests.
- `npm run v2:edge-security-audit` passed and now asserts LINE PromptPay QR replies render/upload PNGs and send LINE `image` messages while keeping payment postbacks available.
- `npm run v2:deno-check` passed for the active v2 edge entrypoints, including `line-webhook`.
- The final LINE env audit confirms `LINE_CHANNEL_TOKEN__<tenant_slug>` is the primary channel token name, matching the technical spec.

## Boundaries

- LINE config is environment-based: `LINE_CHANNEL_SECRET__<tenant_slug>`, `LINE_CHANNEL_TOKEN__<tenant_slug>`, and optional `MIRA_DEFAULT_TENANT_SLUG`; underscore-normalized tenant variants are also accepted. `LINE_CHANNEL_ACCESS_TOKEN__<tenant_slug>` and generic `LINE_CHANNEL_ACCESS_TOKEN` remain supported as compatibility fallbacks.
- `docs/line-setup.md` records the LINE sandbox setup steps, webhook URL shape, env names, and manual test checklist for the owner-run credentialed regression.
- LINE push delivery is attempted after the order transition commits; failures are logged and returned as `line_push` metadata so the admin status change is not hidden by an external LINE outage.
