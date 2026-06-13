# MiraCare V3-6 Plan — LINE booking redesign (always pick branch + LIFF buyer form)

Audience: Codex / product owner (audit). Status: **APPROVED by owner 2026-06-13** (owner directed this after live testing; chose the LIFF form approach). Implemented by **Claude** on branch `claude/v3-6-line-liff-form`. Independent review recommended (touches `orchestrate.ts` purchase path).

Companion: `AGENTS.md`; predecessors `docs/miracare-v3-4-line-commerce-plan.md`, `docs/miracare-v3-5-line-hardening-plan.md`; `docs/line-setup.md`.

## 0. Why (owner feedback from live testing)
1. **Always make the customer pick a branch on LINE** — even a single-branch product. Auto-assigning + skipping `selecting_branch` confused users.
2. **Buyer info must be entered explicitly every time, never auto-filled** — the buyer may be someone other than the LINE account holder. The previous conversational extraction (guess fields from chat text) + auto-filling `buyer_phone` from the account is wrong for "buying for someone else".

## 0.1 Out of scope / unchanged
- `transition_order` / order statuses / marker / `callMiraPrompt`: untouched.
- App + PWA purchase behaviour: unchanged (all new branch/phone rules are LINE-scoped).

## 0.2 Protected-core touch authorized by this plan
| File | Change |
|---|---|
| `_shared/orchestrate.ts` `createOrderFromProduct` | LINE-only: `branch_id=null` + `status='selecting_branch'` whenever the product has ≥1 branch (force explicit pick); never auto-fill `buyer_phone` from the account. |
| `_shared/orchestrate.ts` chat turn | Stop calling `updateCollectingOrderFromMessage` on LINE (no more conversational auto-fill). The function is retained but unused. |

## 1. Changes

### A. Always pick branch on LINE (testable now)
`createOrderFromProduct`: on `channel==='line'`, an order with ≥1 active branch starts in `selecting_branch` with `branch_id=null`, so the V3-4 branch picker always renders (even for 1 branch). App/PWA keep the old `>1` rule.

### B. No auto buyer info on LINE (testable now)
- `buyer_phone` is no longer seeded from `customer.phone` on LINE.
- The conversational extractor call is removed from the LINE chat turn — buyer info comes only from the form.

### C. LIFF buyer-info form (new `line-form` edge function)
- **GET** `…/functions/v1/line-form?tenant=<slug>&order=<id>` → serves a LIFF HTML form (name, phone, age, optional date). `liff.init` uses `LINE_LIFF_ID__<tenant>`.
- **POST** (same URL) → verifies the LINE **ID token** against `LINE_LIFF_CHANNEL_ID__<tenant>`, resolves the LINE customer, validates the order is theirs + `collecting_info`, writes the buyer fields, records the consent-gated age fact, transitions to `awaiting_payment`, and **pushes the PromptPay QR + payment button** back to the chat.
- On LINE, when an order is in `collecting_info` (`step==='form'`), the webhook renders an **"กรอกข้อมูลผู้รับบริการ"** button (`uri` action) that opens the LIFF (`lineFormUrl` → `https://liff.line.me/<id>?order=<id>`). If no LIFF is configured, the button is simply omitted.

## 2. Owner setup (required before the LIFF form works — LINE console territory)
1. In LINE Developers, add a **LIFF app** to the channel:
   - Endpoint URL: `https://xwixdxmemwcuoamcloty.supabase.co/functions/v1/line-form?tenant=demo-hospital`
   - Size: Tall (or Full). Scopes: `openid` + `profile`.
2. Copy the **LIFF ID** → Supabase secret `LINE_LIFF_ID__demo_hospital`.
3. Copy the **LINE Login channel ID** that the LIFF belongs to (the ID token audience) → secret `LINE_LIFF_CHANNEL_ID__demo_hospital`.
4. Redeploy `line-form` + `line-webhook` (the deploy helper now includes `line-form`).

## 3. Tests & gates
- `npm run v2:verify` green — **116 Deno tests** + all gates (incl. `line-form` in `deno-check` and the deploy allow-list).
- `line-form` is intentionally **not** in the edge-security-audit JSON-envelope list because its GET returns HTML; its POST uses the shared `json`/`toErrorResponse` envelope and verifies the LINE ID token.
- Live LIFF verification is **pending owner setup** (§2) — the form cannot run end-to-end until the LIFF app + secrets exist.

## 4. DoD
- [x] ✅ 2026-06-13 — A (always branch on LINE) + B (no auto buyer info on LINE) implemented; app/PWA unchanged.
- [x] ✅ 2026-06-13 — C `line-form` edge function (GET form, POST verify-token→fill→advance→push QR) + LINE "fill form" button; `v2:verify` green; deployed to staging.
- [ ] ❌ Owner LIFF app + `LINE_LIFF_ID__*` / `LINE_LIFF_CHANNEL_ID__*` secrets set (§2).
- [ ] ❌ Live sandbox: pick branch → open form → submit → QR pushed → pay → confirm.
