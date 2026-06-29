# Mira AI Sales Chat - Codex Implementation Handoff

Updated: 2026-06-29

This file describes the current AI chat contract in this repository. The product direction has changed from healthcare-first MiraCare to a reusable AI Sales and MarTech system. As of 2026-06-29, the live model provider is Google Gemini through the shared `chat-orchestrator` provider boundary.

## Prime Directive

The live Gemini provider must preserve the existing backend contract: same variables, same marker syntax, same catalog/order source of truth, same channel-independent orchestrator, and no local sales-reply scripting outside the provider boundary.

If the current provider instruction blocks AI Sales/MarTech validation, report the gap. The fix is an owner-approved prompt/instruction update plus regression tests, not ad hoc UI or channel-specific reply scripting.

## Current Product Intent

Mira is being validated as:

1. An AI Commerce Chat Engine that can be embedded into LINE OA, websites, Facebook, Instagram, or other channels.
2. An Admin Commerce backoffice where operators manage products/services and order handling.
3. A Referral Program webapp that sends customers into AI Chat and tracks commission.

The AI chat should sell only items from the tenant catalog and create orders through the shared backend.

## Current Model Provider

- Provider: Google Gemini GenerateContent API
- Runtime file: `supabase/functions/_shared/openai.ts` (legacy filename kept to avoid broad import churn)
- Chat model secret: `GEMINI_MODEL`
- Extraction model secret: `GEMINI_EXTRACT_MODEL` (falls back to `GEMINI_MODEL`)
- API key secret: `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- Variables:
  - `brand_name`
  - `user_nickname`
  - `personal_context`
  - `recent_chat`
  - `product_catalog`

Example call shape:

```ts
const response = await fetch(`${geminiBaseUrl}/models/${model}:generateContent?key=${apiKey}`, {
  method: 'POST',
  body: JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    systemInstruction: {
      parts: [{ text: buildProviderInstruction({
        brand_name: tenant.displayName,
        user_nickname: user.nickname ?? 'customer',
        personal_context: personalContext,
        recent_chat: recentChat,
        product_catalog: JSON.stringify(catalogRows),
      }) }],
    },
  }),
});
```

Legacy reference:

```text
OpenAI Platform prompt ID: pmpt_6a29c7e353b88196a6e648b24c54849e0f6204e24d65c021
Last known default: version 3, since 2026-06-13
Status: replaced on the live chat path by the Gemini provider boundary on 2026-06-29
```

## Backend Responsibilities

The backend must:

- resolve tenant/customer/session
- load confirmed context and recent chat
- load the sellable product catalog
- call Gemini through the shared provider boundary
- parse the final marker
- persist chat messages/cards/order state
- return UI cards and order panels

The backend must not:

- invent products
- compute prices from model output
- script conversational sales replies
- add extra assistant wording after the model
- expose raw markers to customers

## Product Catalog Contract

The provider receives a JSON array of sellable catalog rows. Keep the array small and relevant.

Required fields:

```json
[
  {
    "id": "sku-basic",
    "name": "Starter Package",
    "description": "Short sales description",
    "price": 1590,
    "category": "service",
    "image": "https://cdn.example.com/sku-basic.jpg"
  }
]
```

Rules:

- `id` is the stable key the model echoes in markers.
- `price` is THB and must come from `products.price_baht`.
- `category` is required.
- The model should never sell anything outside this array.
- For the rebuild, catalog needs to evolve toward explicit `service` vs `physical_product` support. Add that as schema/UI work, not as free-form prompt assumptions.

## Marker Protocol

The model appends at most one final marker line:

```text
[[products: sku-basic, sku-plus]]
[[categories]]
[[order_status]]
```

Rules:

- Parse only the final marker line.
- Strip the marker from visible text.
- `products` allows 1-4 IDs, best first.
- Unknown IDs are filtered/logged, not shown.
- `categories` renders category browse UI.
- `order_status` renders live order status only when backend context contains order lines.

## Order and Sales Flow

Primary target flow:

1. Customer enters `/chat` directly or through `/r/[ref_code]`.
2. AI recommends catalog items and renders product cards.
3. Customer selects item and the backend creates an order.
4. Service orders collect contact, branch, and preferred time window.
5. Physical product orders should collect contact and delivery address once schema/UI support is added.
6. Payment/confirmation moves the order into Admin Commerce.
7. Admin confirms booking or fulfillment.
8. AI can answer order-status questions from real backend state.

## Current Regression

Run:

```bash
npm run chat:quality
npm run v2:verify
```

When the owner publishes a new generic AI Sales prompt/instruction, create or update a regression suite that covers:

- general product browse
- service booking flow
- physical product shipping flow
- referral attribution
- order status
- price/catalog correctness
- no invented products
- no raw markers

## Out of Scope for Agents

Agents do not:

- change variable names
- change marker syntax
- add local assistant scripts
- fork channel-specific sales logic
- reintroduce a second catalog/order source

If one of these is required, stop and ask for owner approval.
