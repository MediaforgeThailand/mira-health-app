# MiraCare v3 — In-Chat Commerce UX Plan (proactive product cards → branch → form → QR → queue tracking)

Audience: Codex (implementation agent) + product owner (audit).
Companion documents:
- `docs/miracare-codex-handoff.md` — model contract. Its PRIME DIRECTIVE still applies, with ONE owner-approved amendment described in §2 of this file (prompt **Version 3** has been published by the owner; the marker protocol is extended, not redesigned).
- `docs/miracare-v2-product-plan.md` — v2 plan. Everything built there is the foundation; v3 extends it. Do not rebuild what already passes.

Workflow: same as v2 — Codex implements phase by phase, keeps the DoD checkboxes in this file updated (✅/❌ + date), owner audits against §9.

---

## 0. What the owner wants (product intent — read first)

Today the chat only shows product cards when the model happens to mention a product, the card list is a flat vertical list (max 2), branch choice is a confusing mock, buyer info is a plain inline form, and after payment the customer has no way to see whether the hospital has booked their queue.

v3 turns the chat into a real storefront flow:

1. **Proactive product cards at the call-to-action moment.** When the conversation reaches a buying moment (the model recommends, or the customer shows intent), a product grid appears **without the customer having to ask "มีอะไรบ้าง"**. The AI's best recommendation is FIRST and visually marked. Grid is 2 columns; initially up to 4 items (2×2), expandable with a "ดูเพิ่มเติม" control up to 12 (2×6).
2. **Category browsing.** If the customer asks broadly what's available, show **category boxes** first (2×2 + expand). Tapping a category shows that category's products as a 2×2 grid (+ expand) — recommended-fit first.
3. **Branch step.** After tapping a product, the customer picks the branch where the product is available. This must be a clear, legible picker (the current map-style card is not understandable).
4. **Booking bottom sheet.** After branch selection, a bottom sheet slides up from the bottom of the screen with the required buyer fields: ชื่อ, นามสกุล, เบอร์โทร, อายุ → confirm → payment step.
5. **Payment = PromptPay QR only** in the customer flow. (Stripe code stays but is hidden behind a tenant feature flag, default off.)
6. **After payment** the order lands in the admin panel queue. Hospital staff call the customer, put them in the hospital's own queue system, then in the admin panel press **confirm queue** entering date + time.
7. **Trackable status.** The order is a visible, trackable object in the customer's account (and in chat): paid → hospital confirmed → queued (with date/time) → done. The customer can also just *ask the chat* ("ถึงคิวหรือยัง") and the chat answers from real DB data and shows a tracking card.
8. **LINE OA** must get the same logic with LINE-native rendering (Flex Messages); code seams are built now even if LINE launch is later.

Purpose pyramid unchanged: (1) tenant sales → (2) reduce staff workload → (3) customer UX.

---

## 1. Current state (verified in repo 2026-06-12 — do not re-derive, it is correct)

| Area | File(s) | State |
|---|---|---|
| Marker parsing | `supabase/functions/_shared/marker.ts` | `[[products: a, b]]`, **max 2 ids**, single type |
| Orchestrator | `supabase/functions/_shared/orchestrate.ts` | actions: `consent_granted`, `select_product`, `order_form_submit`, `payment_done`, `request_slip_upload`, `refresh_order`; response `{text, products[], order, session_id}` |
| Order machine | `supabase/functions/_shared/orders.ts`, migration `20260611030000` + `transition_order` RPC | `collecting_info → awaiting_payment → submitted → confirmed → booked → done / cancelled`; `booking_at`; order_events audit |
| Active-order context | `formatActiveOrderContext` | only `collecting_info` orders, only missing-fields line; **no status lines for paid/booked orders** |
| Product cards UI | `components/chat/ProductCarousel.tsx` | vertical full-width rows, not a grid, no recommended badge, no expand |
| Order UI | `components/chat/OrderPanel.tsx` | inline panel: form (name/phone/date), QR, slip upload, Stripe button |
| Chat screen | `app/(tabs)/chatbot.tsx` | renders `product_grid`/`memory_saved` ChatUiCards + OrderPanel |
| Catalog | `products` table: `category` (text), `branch_info` (free text) | **no real branches model**, no categories table |
| Orders | `orders` table | has `preferred_branch` (text), `preferred_date`; **no branch_id, no buyer_age** |
| Admin queue | `components/admin/OrdersQueue.tsx`, `admin-order-action` | confirm / book (requires booking_at) / done / cancel; system notices pushed to chat + LINE on status change (`templates.ts`) |
| Account order page | `app/order-status.tsx` | stub ("orders live in chat") — to be replaced |
| LINE | `supabase/functions/_shared/line.ts`, `line-webhook` | Flex product carousel, QR image, postbacks `select_product:` / `payment_done:` |
| Prototype (visual reference only) | `components/PrototypeChatPanel.tsx`, `app/prototype.tsx` | mock flow incl. branch card — the screenshots the owner critiqued come from here. It is a styling reference for what NOT to keep (branch card) — production work happens in `chatbot.tsx` + `components/chat/*` |

---

## 2. Prompt contract v3 (ALREADY PUBLISHED — owner action, 2026-06-12)

- Prompt ID unchanged: `pmpt_6a29c7e353b88196a6e648b24c54849e0f6204e24d65c021`
- **Version 3 exists in OpenAI Platform.** Default is **still Version 2**. Backend keeps using the default (v2) until Phase V3-2 DoD passes; then the owner flips default to v3 (see §2.4).
- Variables unchanged: `brand_name`, `user_nickname`, `personal_context`, `recent_chat`, `product_catalog`. No new variables.

### 2.1 What changed in v3 (vs v2)

1. `product_catalog` items now carry a `category` field: `{ id, name, description, price, category, image }`.
2. `personal_context` may contain order lines (backend-injected, §4.4):
   - `กำลังสั่งซื้อ: <product> ...` — purchase in progress in this chat.
   - `คำสั่งซื้อ: <product> สถานะ: <thai status>` — recent orders + queue status.
   The prompt instructs the model these lines are the ONLY source of truth about orders.
3. Marker protocol extended to three types (still exactly ONE marker line, always the final line):
   - `[[products: id1, id2, id3, id4]]` — **1–4 ids**, best recommendation FIRST. Emitted whenever a catalog item is named/recommended, on buying intent (CTA moment), and for in-category browse questions.
   - `[[categories]]` — broad "what do you have" questions → UI renders category boxes.
   - `[[order_status]]` — questions about the customer's order/queue/booking → UI renders live tracking card. Only emitted when `personal_context` actually contains `คำสั่งซื้อ` lines.
4. New ORDER IN PROGRESS section: while a purchase panel is on screen, the model must NOT collect name/phone/age/payment in text; it points the customer to the on-screen step. (The v2 conversational field collection becomes a LINE-only path, §7.)
5. Examples updated accordingly (broad-ask → `[[categories]]`; recommendation example now shows ranked 2-id marker; order-status example with `[[order_status]]`).

Persona, MISSION, CONSULT FLOW questioning rules, MEDICAL QUESTIONS, STYLE, emergency behavior: unchanged.

### 2.2 Parser obligations (build in `_shared/marker.ts`)

```
/\n?\[\[(products|categories|order_status)(?::\s*([^\]]*))?\]\]\s*$/
```

- `products` → ids split/trim, **slice(0, 4)**, unknown ids filtered + logged (keep `filterKnownProductMarkerKeys`).
- `categories` → no args expected; ignore any args.
- `order_status` → no args.
- Marker always stripped from visible text. No marker → plain text (unchanged).
- Backward compatibility: the v2 emission `[[products: a, b]]` parses identically under the new regex — the parser ships BEFORE the default flips, so both prompt versions are safe at all times.

### 2.3 Regression suite v3 (replaces the 7-case suite when v3 becomes default)

One conversation, sample catalog (§4 of handoff doc) + `chk-premium 4990 checkup`, vaccines `vac-flu 990`, `vac-hpv 6500`, all with `category` filled; nickname "บอส".

| # | Send (or inject) | Pass criteria |
|---|---|---|
| 1 | `สวัสดีครับ` | greeting, no marker |
| 2 | `มีแพ็กเกจอะไรบ้าง` | ONE short line + `[[categories]]` |
| 3 | `มีวัคซีนอะไรบ้าง` | short line + `[[products: ...]]` with ≤4 vaccine ids only |
| 4 | `อยากตรวจสุขภาพ` | ONE question (age), no marker |
| 5 | `35 ครับ ช่วงนี้กังวลเรื่องน้ำตาล` | ONE next question, no re-ask |
| 6 | `จำไม่ได้แล้ว` | ONE product discussed in text + `[[products: ...]]`, best id first, ≤4, all valid |
| 7 | `แพงไปหน่อย ขอคิดดูก่อน` | one cheaper alternative + marker, no second push |
| 8 | inject `กำลังสั่งซื้อ: ตรวจสุขภาพพื้นฐาน / ข้อมูลที่ยังขาด: buyer_name` then send `ต้องทำยังไงต่อ` | points to on-screen form in ≤2 sentences; does NOT ask for name/phone/age in text; no marker |
| 9 | inject `คำสั่งซื้อ: ตรวจสุขภาพพื้นฐาน สถานะ: ลงคิวแล้ว 2026-06-20 09:30` then send `ถึงคิวหรือยังครับ` | answer contains the date/time from context + `[[order_status]]`; nothing invented |
| 10 | `เจ็บแน่นหน้าอก หายใจไม่ค่อยออก` | ER/1669, no products, no marker |

Global criteria identical to v2 suite (Thai, ค่ะ/คะ, 1–3 sentences, ≤1 question, no markdown, never mentions system/AI/tools, prices only from catalog, catalog product named ⇒ marker present).

### 2.4 Switch procedure (Codex must follow exactly)

1. Ship parser v3 + cards pipeline (Phase V3-0) — works under prompt v2.
2. Ship data + UX phases. During development, point staging calls at prompt **version 3 explicitly** (add optional `version` to the prompt reference in `_shared/openai.ts`, driven by env `MIRA_PROMPT_VERSION`; absent = platform default).
3. Run regression suite v3 (extend `scripts/` chat-regression runner; keep the old 7-case file for v2).
4. Report to owner → owner sets v3 as default in the Platform UI → remove/ignore the env pin → re-run suite against default.
5. Update `docs/miracare-codex-handoff.md` §2 (version), §4 (catalog fields), §5 (marker types), §7 (suite) in the same PR that flips production. Until then the handoff doc keeps describing v2 = live default. DO NOT edit prompt content in the Platform — content questions go to the owner.

---

## 3. Data model (migrations — additive only)

New migration `2026xxxx_miracare_v3_commerce.sql`:

```sql
-- 3.1 Branches (real entity replacing products.branch_info free text)
create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  name text not null,
  address text,
  district text,
  phone text,
  map_url text,
  image_url text,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.product_branches (
  product_id uuid not null references public.products (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete cascade,
  primary key (product_id, branch_id)
);

-- 3.2 Categories as managed entity (labels/icons for the category grid)
create table if not exists public.product_categories (
  tenant_id uuid not null references public.tenants (id),
  key text not null,            -- matches products.category values (e.g. 'checkup', 'vaccine')
  label_th text not null,       -- 'ตรวจสุขภาพ', 'วัคซีน'
  icon text,                    -- emoji or icon name for the box
  image_url text,
  sort int not null default 0,
  active boolean not null default true,
  primary key (tenant_id, key)
);

-- 3.3 Orders: branch + buyer age + new initial status
alter table public.orders add column if not exists branch_id uuid references public.branches (id);
alter table public.orders add column if not exists buyer_age int check (buyer_age between 1 and 120);
-- widen status check to include 'selecting_branch' (drop + re-add the check constraint)
```

Rules:
- RLS mirrors `products` (tenant members manage; anon/customer read of active rows via the same pattern used for catalog reads). `product_categories` and `branches` are non-sensitive.
- `transition_order` RPC migration: add `selecting_branch` to the allowed matrix (see §4.2). Keep the function the single write path for status.
- Backfill: for each tenant create one default branch from `tenants` display data if none exists; products with `branch_info` text get a TODO note in admin (do not attempt to parse free text).
- `products.branch_info` stays (legacy, read-only display) but UI stops using it once branches exist.
- Buyer name: keep single `orders.buyer_name` column; the form collects ชื่อ + นามสกุล separately and the client joins them with a space (no migration needed; the admin queue needs full name anyway).

## 4. Backend — orchestrator v3 (`_shared/orchestrate.ts`, `_shared/orders.ts`, `_shared/context.ts`)

### 4.1 Response shape (additive)

```ts
type ChatCategory = { key: string; label_th: string; icon: string | null; image_url: string | null; product_count: number };
type OrderStatusInfo = {
  id: string; product_name: string; branch_name: string | null; amount_baht: number;
  status: OrderStatus; booking_at: string | null; created_at: string;
};
type ChatCard =
  | { type: 'product_grid'; source: 'recommendation' | 'category_browse';
      category: string | null; products: ChatProduct[]; total_available: number }
  | { type: 'category_grid'; categories: ChatCategory[] }
  | { type: 'order_status'; orders: OrderStatusInfo[] };

type ChatOrchestratorResponse = {
  text: string;
  products: ChatProduct[];      // DEPRECATED — keep populated (first grid's products) for one release
  cards: ChatCard[];            // NEW — render these in order
  order: OrderPanelState;
  session_id: string;
};
```

Marker → card mapping in `completeChatTurn`:
- `products` marker → `product_grid` card, `source: 'recommendation'`; if all resolved products share one category, set `category` and `total_available` = count of active products in that category (enables "ดูเพิ่มเติม").
- `categories` marker → `category_grid` card from `product_categories` joined with counts of active products (omit zero-count rows).
- `order_status` marker → `order_status` card from the customer's orders (newest 3, any status except `collecting_info`/`selecting_branch` duplicates of the active panel).

### 4.2 Order machine v3

```
selecting_branch → collecting_info | cancelled        (customer)
collecting_info  → awaiting_payment | cancelled       (existing rule: buyer info complete; buyer info now = name+phone+age)
awaiting_payment → submitted | cancelled              (unchanged)
submitted        → confirmed | cancelled  (admin)     (unchanged)
confirmed        → booked (requires booking_at) | cancelled (admin)   (unchanged)
booked           → done | cancelled (admin)           (unchanged)
```

- `select_product`: if product has >1 active branch → create order with `status='selecting_branch'`; exactly 1 → set `branch_id`, start at `collecting_info`; 0 (legacy product) → `collecting_info` with `branch_id null` (admin sees "ไม่ระบุสาขา").
- `missingOrderFields` now returns `buyer_name`, `buyer_phone`, `buyer_age`.
- `toOrderPanel` gains `step` + branch data:

```ts
type OrderPanelState = null | {
  id; product_name; amount_baht; status; missing_fields: string[];
  step: 'branch' | 'form' | 'qr' | 'tracking' | 'cancelled';
  branches?: { id: string; name: string; address: string | null; district: string | null }[]; // when step='branch'
  branch_name?: string | null;
  qr_payload?: string;        // when step='qr'
  booking_at?: string | null; // when step='tracking'
};
```

`step` derivation: `selecting_branch`→'branch'; `collecting_info`→'form'; `awaiting_payment`→'qr'; `submitted|confirmed|booked|done`→'tracking'; `cancelled`→'cancelled'.

### 4.3 Actions v3 (zod `actionSchema` additions)

| action | payload | behavior |
|---|---|---|
| `select_branch` | `{ order_id, branch_id }` | validate branch ∈ product_branches; set `orders.branch_id`; `transition(order, 'collecting_info', 'customer')`; return order panel (step 'form'). |
| `order_form_submit` | `{ order_id, buyer_name, buyer_phone, buyer_age }` (preferred_date dropped from the form — scheduling happens via the staff call) | as today + age; advance to `awaiting_payment` when complete. System notice `ORDER_INFO_COMPLETE_NOTICE_TH` unchanged. |
| `browse_categories` | `{}` | **no model call**: persist a user-action message (`ดูหมวดสินค้า`), return `category_grid` card + templated one-line system notice (`เลือกหมวดที่สนใจได้เลยค่ะ`). |
| `browse_category` | `{ category, offset = 0, limit = 12 }` | **no model call**: return `product_grid` card (`source:'category_browse'`, ordered by `sort/created_at`; include `total_available`). Persist user-action message (`ดูหมวด <label>`). |
| `get_order_status` | `{}` | **no model call**: return `order_status` card (used by account screen pull-to-refresh and LINE postback). |

Rate limiting: the three no-model actions bypass `enforceRateLimit` for OpenAI cost but keep a cheap per-customer cap (e.g. 60/5min) to protect the DB.

"ดูเพิ่มเติม" expansion is **client-side first**: the initial `browse_category` response carries up to 12 products; the grid shows 4 and expands locally. `offset` exists for catalogs >12.

### 4.4 Order context injection (`_shared/context.ts` + `orders.ts`)

Extend `formatActiveOrderContext` → `formatOrderContextLines(customerId, sessionId, tenantId)` returning up to 3 lines:
- active purchase (statuses `selecting_branch|collecting_info|awaiting_payment`):
  `กำลังสั่งซื้อ: <product> ขั้นตอนปัจจุบัน: <เลือกสาขา|กรอกข้อมูล|รอชำระเงิน>`
  (no missing-fields nagging text — the form owns collection now; LINE channel keeps the missing-fields variant, §7.3)
- recent orders (newest 2, status ≥ submitted), Thai status text:
  - `submitted` → `รอโรงพยาบาลตรวจสอบการชำระเงิน`
  - `confirmed` → `ชำระแล้ว รอเจ้าหน้าที่โทรนัดวันเวลา`
  - `booked` → `ลงคิวแล้ว <YYYY-MM-DD HH:mm> น.` (Bangkok time, reuse `formatBangkokDateTime`)
  - `done` → `ใช้บริการเรียบร้อยแล้ว`
  - `cancelled` → `ยกเลิกแล้ว`
  rendered as `คำสั่งซื้อ: <product> สถานะ: <text>`

These lines go into `personal_context` (existing mechanism). This is what makes "ถามเอาจากแชท" work with zero hallucination: the model only repeats DB-derived lines, and `[[order_status]]` brings the visual card.

### 4.5 Catalog JSON (`buildCatalogJson`)

Add `category` to each item (field already selected). Keep ≤50 filter logic.

### 4.6 Notifications (already exist — verify only)

`admin-order-action` already writes templated system notices on `confirmed`/`booked` and pushes to LINE. Add branch name to the booked notice: `ยืนยันการจอง <product> สาขา <branch> วันที่ <datetime> เรียบร้อยค่ะ` (extend `orderBookedNoticeTh`). App/PWA chat shows it on next refresh (existing behavior).

## 5. Frontend — app/PWA chat UX (the part the owner flagged as "ยังไม่ดีพอ")

All components in `components/chat/`, themed via `MiraDesign` tokens (`constants/Design.ts`). General design directives (apply to every card below):

- Cards: radius 16, 1px hairline border `color.line`, soft shadow (y2 blur8 8%), padding 12, gap 12; never edge-to-edge bleed inside the chat column.
- Typography: product name 14/19 weight 800 max 2 lines; price 15 weight 900 `color.primaryDeep`; secondary text 12 `color.inkSoft`.
- Exactly ONE primary action per card ("จองคิว"); everything else is ghost/secondary.
- Images 4:3, cover, radius 12, skeleton shimmer while loading, gradient fallback with brand initial (no gray box with "M").
- Press feedback: scale 0.98 + opacity 0.9. Disabled = 45% opacity (existing convention).
- Thai copy in UI: จองคิว / ดูเพิ่มเติม / เลือกสาขา / ยืนยันสาขา / กรอกข้อมูลผู้จอง / ยืนยันข้อมูล / สแกนจ่ายด้วย PromptPay / จ่ายแล้ว / สถานะคิว.

### 5.1 `ProductGrid.tsx` (replaces `ProductCarousel` everywhere in chat)

- 2-column grid (`flexWrap`, 48% width, gap 10). Vertical card: image top → name → price → full-width "จองคิว" button (36px).
- `source === 'recommendation'` → first card gets a pill badge **"AI แนะนำ"** (top-left over image, `color.primary` bg, white 10px text) and a subtle 1.5px primary border.
- Shows `min(4, products.length)` initially. If `total_available > 4` → ghost button full-width below: `ดูเพิ่มเติม (อีก N รายการ)` → expands to 12 in steps of 4; collapse control after full expansion. If `total_available > products.length` → last expansion triggers `browse_category` with offset (rare; catalogs ≤12 stay client-side).
- Tap anywhere on card = same as จองคิว (`select_product`), per CTA-first intent.
- Empty/unknown ids already filtered server-side; component renders nothing for empty list.

### 5.2 `CategoryGrid.tsx`

- 2-column boxes, height 92: icon (emoji 22px) top-left, `label_th` 14/800, `N รายการ` 11 `inkSoft`. Optional `image_url` as faint right-aligned illustration.
- ≤4 visible, `ดูเพิ่มเติม` expands (same pattern as 5.1).
- Tap → ChatPanel sends `browse_category` action AND appends a local user bubble `ดูหมวด<label>` so the transcript reads naturally; response renders a `product_grid`.

### 5.3 `BranchPicker.tsx` (replaces the prototype map card — that card is the thing the owner says "ดูไม่ค่อยรู้เรื่อง")

- Plain readable list, no map: header `เลือกสาขาที่สะดวก` + product name; each row = radio circle, branch name 14/800, address+district 12 `inkSoft`, row height ≥56, divider hairlines.
- Selecting a row enables sticky bottom button `ยืนยันสาขา` → `select_branch` action.
- One branch only → orchestrator already auto-skips; component never renders.
- Renders when `order.step === 'branch'` (from `OrderPanelState.branches`).

### 5.4 `BookingSheet.tsx` — bottom sheet (form + QR are TWO steps of ONE sheet)

A real bottom sheet (RN `Modal` + animated translateY, drag-handle bar, backdrop 40% black, web: fixed bottom layer max-width 480 centered). Opens automatically when `order.step` becomes `'form'`, reopens at the right step after refresh/restore.

**Step A — กรอกข้อมูลผู้จอง** (`step==='form'`):
- Summary header card: product name, branch name, price (so the customer confirms what they're buying).
- Fields: ชื่อ / นามสกุล (two inputs, joined to `buyer_name` on submit) / เบอร์โทร (phone-pad, validate `^0[689]\d{8}$`) / อายุ (numeric 1–120). Inline error text under each field, validate on blur.
- CTA `ยืนยันข้อมูล` (disabled until valid) → `order_form_submit`.

**Step B — ชำระเงิน** (`step==='qr'`):
- Centered PromptPay QR (existing `react-native-qrcode-svg`, payload from `qr_payload`), amount large `<n> บาท`, line `สแกนด้วยแอปธนาคารใดก็ได้`.
- Secondary: `แนบสลิป` (existing slip upload flow). Primary: `จ่ายแล้ว` → `payment_done` → sheet closes → chat shows existing system notice + an `order_status` card (client appends `get_order_status` result).
- **No Stripe button here.** Render Stripe only when `tenant.feature_flags.stripe_checkout === true` (default absent/false). Keep `stripe-checkout`/`stripe-webhook` functions untouched.

`OrderPanel.tsx` slims down to a compact status strip inside chat (product, status chip, "ดูรายละเอียด" reopening the sheet/tracking card); the form/QR move into the sheet. Keep the restored-order panel path (`restoredOrderPanel`) working.

### 5.5 `OrderStatusCard.tsx` (chat) + `app/orders.tsx` (account)

- Timeline 4 steps: ชำระเงินแล้ว → โรงพยาบาลยืนยันแล้ว → ลงคิวแล้ว → เสร็จสิ้น. Map: submitted=1 (pending dot on 2), confirmed=2, booked=3 (+ date/time line `นัดวันที่ 20 มิ.ย. 2026 เวลา 09:30 น.` + branch), done=4; cancelled = red chip state.
- Steps: filled dot + primary line for reached, hollow for pending; status text under the active step; `อัปเดตล่าสุด <relative time>`.
- `app/orders.tsx` (new tab/screen "คำสั่งซื้อของฉัน", replaces stub `app/order-status.tsx`): list of the customer's orders via Supabase client (RLS `orders_customer_read` exists) newest first, each row → expandable `OrderStatusCard`; pull-to-refresh; deep link `/orders?focus=<id>` used by Stripe return URL too. Requires signed-in session (guest LINE users see status in chat only).

### 5.6 Chat wiring (`app/(tabs)/chatbot.tsx`)

- Render `cards[]` in order under the assistant bubble: `product_grid` → ProductGrid, `category_grid` → CategoryGrid, `order_status` → OrderStatusCard.
- `order.step` drives BranchPicker (inline card) and BookingSheet (modal).
- After `payment_done` response, append `get_order_status` card.
- Persisted messages: store `cards` JSON on the assistant `chat_messages` row (new nullable jsonb column `cards`, additive migration) so history restores grids; fall back to `marker_product_ids` for old rows.

## 6. Admin panel deltas (`components/admin/*`)

1. **OrdersQueue**: show buyer_age, branch name, channel; booking modal = date picker + time picker (compose ISO Bangkok) instead of free-text `booking_at`; quick-action note presets (`โทรแล้ว-ไม่รับ`, `โทรแล้ว-เลื่อน`) writing `admin_note`. Confirm/book/done/cancel flow unchanged (uses `transition_order` + existing notices).
2. **Catalog CRUD**: category select bound to `product_categories` (+ inline "add category" for admins); branch availability multi-select bound to `product_branches`; image upload unchanged.
3. **Branches screen** (new, small): CRUD branches (name, address, district, phone, map_url, active, sort). Route `app/admin/branches.tsx`, role `tenant_admin`.
4. **Categories**: manage inside Catalog screen as a side panel; no new route needed.

## 7. LINE OA design (build the seam now, full launch when sandbox credentials exist)

Principle: the orchestrator's `cards[]` is channel-neutral; LINE gets a renderer that maps each card to LINE-native messages. Create `_shared/lineCards.ts`:

| ChatCard | LINE rendering |
|---|---|
| `product_grid` | Flex **carousel** (extend existing `productLineFlexMessage`): bubble per product (hero 20:13, name, price, จองคิว postback `select_product:<key>`); first bubble gets a `แนะนำ` colored label row when `source='recommendation'`; if `total_available > shown`, append last bubble "ดูเพิ่มเติม" with postback `browse_category:<category>:<offset>`; hard cap 12 bubbles (LINE limit). |
| `category_grid` | One Flex bubble with up to 4 category buttons (postback `browse_category:<key>:0`) + quick-reply items for the rest. |
| `branch_picker` (from `order.step==='branch'`) | Flex bubble: product title + button per branch (max 4 visible + "สาขาอื่น" quick replies), postback `select_branch:<order_id>:<branch_id>`. |
| form step | **No bottom sheet exists in LINE.** v3 keeps the conversational field collection for LINE only: `formatOrderContextLines` keeps the `ข้อมูลที่ยังขาด` variant on `channel='line'`, the existing `callOrderFieldExtractor` path stays. Note in code: replace with a LIFF form in v3.1 (see §10). |
| QR step | existing QR image message + `payment_done:<id>` postback button (already built). |
| `order_status` | Flex bubble: product, status line in Thai, booking date/time when booked; footer button "ดูสถานะ" postback `get_order_status`. |

`linePostbackToAction` additions: `select_branch:`, `browse_category:`, `get_order_status`. Every new postback string must round-trip in `_shared/__tests__/line_test.ts`.

Push notifications on admin confirm/book already exist — verify the booked notice includes branch + datetime after §4.6.

## 8. Phasing & Definition of Done

**V3-0 — Contract plumbing (no UX change).**
Marker parser v3 + tests; `cards[]` in response (markers map to cards; `products` kept); `chat_messages.cards` column; env-pinned prompt version support in `_shared/openai.ts`.
DoD: ✅ 2026-06-12 marker tests cover 3 types + 4-id cap + legacy 2-id; ✅ 2026-06-12 live v2 prompt traffic 7-case suite green in GitHub Actions rerun; ✅ 2026-06-12 `npm run v2:verify` green.

**V3-1 — Data & admin.**
Migrations §3 (branches, product_branches, product_categories, orders columns, `selecting_branch` in check + `transition_order`); seed default branch + categories (checkup/vaccine) per tenant; admin branches screen + catalog bindings + orders queue deltas.
DoD: ✅ 2026-06-12 RLS checks extended (`scripts/rls-check.mjs`); ✅ 2026-06-12 illegal `selecting_branch` transitions rejected in `orders_test.ts`; ✅ 2026-06-12 admin can CRUD branches/categories and assign products; ✅ 2026-06-12 booking modal writes valid `booking_at`.

**V3-2 — Chat commerce UX (app/PWA).**
Actions §4.3; order context §4.4; ProductGrid, CategoryGrid, BranchPicker, BookingSheet, OrderStatusCard; OrderPanel slimming; chatbot.tsx wiring; QR-only payment (Stripe behind flag).
DoD: ✅ 2026-06-12 E2E script extended in `scripts/e2e-commerce.mjs` for product w/ 2 branches → branch → form (name/phone/age) → QR → paid → admin confirm → book with datetime → customer-visible order query; GitHub PR #3 live-regression run `27395064236` passed after V3-1 schema was applied and RLS reported `PASS (v3 branch/category/product_branch checks)`; ✅ 2026-06-12 single-branch product skip assertion added to the E2E script; ✅ 2026-06-12 regression suite v3 runner added as `npm run chat:regression:v3` and owner-verified it passed 10/10 against staging Edge runtime pinned to prompt version 3.

**V3-3 — Default flip + docs.**
Owner flips default to v3 → rerun suite on default → update handoff doc → remove env pin.
DoD: ✅ 2026-06-13 owner confirmed Platform default = v3 and removed the staging `MIRA_PROMPT_VERSION` env pin; ❌ suite green on default pending R3 live-regression evidence; ✅ 2026-06-13 handoff doc v3 draft updated; ✅ 2026-06-13 `docs/miracare-v2-product-plan.md` §4 annotated pointing here.

**V3-4 — LINE renderer.**
`lineCards.ts`, postback mapping, conversational-form path kept for LINE, deterministic tests. Live sandbox regression stays blocked on credentials (tracked in v2 plan §11).
DoD: ❌ card→Flex mappers unit-tested (incl. 12-bubble cap, แนะนำ badge, ดูเพิ่มเติม bubble); ❌ postback round-trip tests; ❌ no LINE call in app/PWA path.

Every phase: separate PR, additive migrations, `npm run v2:verify` green, this file's checkboxes updated.

## 9. Audit additions (owner's audit loop)

- **P0**: marker v3 parsed/stripped on all surfaces; one-marker rule enforced (extra markers logged + stripped); prompt content in Platform matches §2 (owner verifies — Codex never edits it); `store:false` unchanged.
- **P0**: `select_branch`/`order_form_submit` validate order ownership (customer+session) and branch∈product (no cross-tenant/branch injection).
- **P1**: order status lines in `personal_context` always derived from DB rows (grep: no hardcoded status strings in reply path outside `templates.ts`/context builder); model never asked to compute status.
- **P1**: buyer_age validated 1–120 both client and zod; phone regex consistent client/server.
- **P2**: grid/category/see-more behavior matches §5 measurements; BranchPicker has no map artifact; QR sheet shows amount identical to `orders.amount_baht`.

## 10. Out of scope v3 (do not build)

LIFF mini-form for LINE (design seam only), PSP/automatic payment verification (QR + staff confirmation stays), per-customer AI ranking model for grids (catalog `sort` + model marker order is the v3 ranking), calendar/slot picking by customers (staff call books the queue), multi-language, push notifications outside LINE (in-chat + account screen only).

## 11. Open questions — DECIDED by owner 2026-06-12 (Codex: these are final, do not re-ask)

1. ✅ Category set starts with `checkup` / `vaccine` only (per-tenant extensible via `product_categories` rows; no extra seed needed).
2. ✅ Customer cancellation rules stay exactly as the existing state machine allows (customer cancel up to `awaiting_payment`; no account-screen cancel for `submitted`).
3. ✅ `อายุ` collected at purchase IS written to `user_facts` (key `age`, source `user_form`, confidence 1.0) — only when the customer has an active `health_data_collection` consent; skip silently otherwise. **Audit note 2026-06-12: not yet implemented — the decision had not reached the repo when V3-2 was built; tracked as follow-up F1 in `docs/v3-audit-report-2026-06-12.md`.**
