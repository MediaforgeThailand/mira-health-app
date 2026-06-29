# Mira AI Sales Chat - Codex Implementation Handoff

Updated: 2026-06-23

This file describes the current AI chat contract in this repository. The product direction has changed from healthcare-first MiraCare to a reusable AI Sales and MarTech system. The current published OpenAI prompt is still the live prompt contract until the owner publishes a generic AI Sales prompt.

## Prime Directive

The published OpenAI Platform prompt is still the source of truth for model behavior. Do not inline the prompt, add hidden system prompts, change variables, change marker syntax, change model/tools, or post-process assistant wording to work around prompt behavior.

If the current healthcare-oriented prompt blocks AI Sales/MarTech validation, report the gap. The fix is a new owner-approved prompt version plus regression tests, not local reply scripting.

## Current Product Intent

Mira is being validated as:

1. An AI Commerce Chat Engine that can be embedded into LINE OA, websites, Facebook, Instagram, or other channels.
2. An Admin Commerce backoffice where operators manage products/services and order handling.
3. A Referral Program webapp that sends customers into AI Chat and tracks commission.

The AI chat should sell only items from the tenant catalog and create orders through the shared backend.

## Current Prompt

- Prompt ID: `pmpt_6a29c7e353b88196a6e648b24c54849e0f6204e24d65c021`
- Current default version: 3, since 2026-06-13
- Override: `MIRA_PROMPT_VERSION` only
- Store: `false` for real customer traffic
- Variables:
  - `brand_name`
  - `user_nickname`
  - `personal_context`
  - `recent_chat`
  - `product_catalog`

Example call shape:

```ts
const response = await client.responses.create({
  prompt: {
    id: 'pmpt_6a29c7e353b88196a6e648b24c54849e0f6204e24d65c021',
    variables: {
      brand_name: tenant.displayName,
      user_nickname: user.nickname ?? 'ลูกค้า',
      personal_context: personalContext,
      recent_chat: recentChat,
      product_catalog: JSON.stringify(catalogRows),
    },
  },
  input: userMessage,
  store: false,
});
```

## Backend Responsibilities

The backend must:

- resolve tenant/customer/session
- load confirmed context and recent chat
- load the sellable product catalog
- call the prompt
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

The prompt receives a JSON array of sellable catalog rows. Keep the array small and relevant.

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

The inherited regression runner is:

```bash
npm run chat:regression:v3
```

It still reflects the healthcare prompt version. Keep it green while the current prompt is active. When the owner publishes the generic AI Sales prompt, create a new regression suite that covers:

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

- edit the OpenAI Platform prompt content
- flip the default prompt version
- change variable names
- change marker syntax
- add local assistant scripts
- fork channel-specific sales logic

If one of these is required, stop and ask for owner approval.
