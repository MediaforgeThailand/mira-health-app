# MiraCare v2 — Technical Specification (Coding-Level)

Companion to `docs/miracare-v2-product-plan.md` (WHAT/WHY) and `docs/miracare-codex-handoff.md` (AI model contract).
This document is the HOW. It is written so an implementation agent can code directly from it without inventing architecture.

**Document precedence when anything conflicts:**
1. `miracare-codex-handoff.md` (model contract — absolute)
2. This technical spec
3. `miracare-v2-product-plan.md`
4. Existing code in the repo (LOWEST priority — see §0.2)

---

## 0. Engineering ground rules

### 0.1 Quality bar (MVP that becomes the core product — no shortcuts)
- TypeScript strict everywhere. `any` is forbidden; use `unknown` + narrowing. All API payloads have explicit types in `lib/types/` shared between client and edge functions (copy types into `supabase/functions/_shared/types.ts`; keep them in sync — a comment header in both files must reference the other).
- Every edge function returns the standard envelope (§3.1). Never return raw errors/stack traces to clients.
- Every DB write that can be retried carries an idempotency guard (unique constraint or explicit idempotency key) — specified per table below.
- All money is `integer` satang? **NO — THB integer baht** (`amount_baht integer`). Health products do not need satang. Never float.
- All timestamps `timestamptz`. All IDs `uuid default gen_random_uuid()` unless stated.
- Migrations are additive and numbered `2026MMDDHHMMSS_*.sql`. Never edit an applied migration.
- Each phase lands with: migration(s) + code + tests + a short `docs/changes/<phase>.md` (what/where/how verified).

### 0.2 Policy on existing code ("spec wins")
The repo contains prototype-era code. Rule for the implementing agent:
- If existing code matches this spec → reuse it.
- If existing code conflicts with this spec, or is weaker (untyped, hardcoded, single-tenant, scripted replies) → **replace it following this spec.** Do not bend the spec to preserve legacy code. Do not keep two parallel implementations.
- Replacement procedure: (1) write the new module per spec, (2) migrate any real data with a SQL migration, (3) point callers to the new module, (4) DELETE the old module in the same PR (no dead code left), (5) note the removal in `docs/changes/`.
- Specifically known-legacy to replace in Phase 2: the Gemini conversation path (`lib/ai/gemini.ts` usage in customer chat, `supabase/functions/gemini-chat`, prompt_versions-driven reply generation). Keep `prompt_versions` tables (history) but the reply path must not read them.

### 0.3 Environment & secrets
Edge function env (Supabase secrets): `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), `GEMINI_MODEL` (default `gemini-3.5-flash`), `GEMINI_EXTRACT_MODEL` (default follows `GEMINI_MODEL`), `LINE_CHANNEL_SECRET__<tenant_slug>`, `LINE_CHANNEL_TOKEN__<tenant_slug>`, `APP_BASE_URL`. Client uses only the anon key. Service-role key never leaves edge functions.

---

## 1. Database schema (Phase 1 migration set)

Conventions: every business table has `tenant_id uuid not null references tenants(id)`, `created_at timestamptz not null default now()`. Index every FK. RLS pattern in §1.9.

### 1.1 Tenancy & identity
```sql
create table tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,32}$'),
  display_name text not null,
  logo_url text,
  promptpay_id text,                  -- phone (0812345678) or national id; validated in app code
  attribution_window_days int not null default 30,
  features jsonb not null default '{}'::jsonb,   -- {"line": true, "dashboard": false}
  created_at timestamptz not null default now()
);

-- platform end-customers. auth.users for logged-in app/PWA users; LINE users may exist without auth.
create table customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  auth_user_id uuid references auth.users(id),
  line_user_id text,
  nickname text,
  phone text,
  referred_by uuid,                    -- referrers.id, nullable (FK added after referrers table)
  referred_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, auth_user_id),
  unique (tenant_id, line_user_id)
);

create table tenant_members (          -- admin/staff accounts
  tenant_id uuid not null references tenants(id),
  auth_user_id uuid not null references auth.users(id),
  role text not null check (role in ('superadmin','tenant_admin','tenant_staff')),
  primary key (tenant_id, auth_user_id)
);
```

### 1.2 Catalog (consolidate existing hospital_product tables INTO this shape; write a data migration from the old tables, then drop old ones)
```sql
create table products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  catalog_key text not null,           -- short stable id used in chat markers, e.g. 'chk-basic'
  name text not null,
  description text not null default '',
  price_baht integer not null check (price_baht >= 0),
  category text not null default 'general',  -- 'checkup'|'vaccine'|'general'...
  image_url text,
  branch_info text,
  requires_appointment boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, catalog_key)
);
create index on products (tenant_id, active, category);
```
`catalog_key` is what the model sees and echoes in `[[products: ...]]`. Generated on create: slugified name + 4 random chars if collision. Immutable after creation (admin UI must not allow editing it).

### 1.3 Chat
```sql
create table chat_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  customer_id uuid not null references customers(id),
  channel text not null check (channel in ('app','pwa','line')),
  flagged text,                        -- null | 'emergency' | 'complaint'
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);
create index on chat_sessions (tenant_id, last_message_at desc);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions(id),
  role text not null check (role in ('user','assistant','system_notice')),
  content text not null,               -- assistant content stored WITH marker stripped
  marker_product_ids text[] not null default '{}',  -- catalog_keys parsed from marker
  openai_response_id text,
  client_msg_id text,                  -- idempotency: client-generated uuid
  created_at timestamptz not null default now(),
  unique (session_id, client_msg_id)
);
create index on chat_messages (session_id, created_at);
```
`system_notice` = templated booking/status notifications (§6.4), never model-generated.

### 1.4 Facts (silent profile)
```sql
create table fact_keys (               -- registry; seed in migration
  key text primary key,                -- 'age','sex','weight_kg','height_cm','chronic_conditions',
                                       -- 'allergies','medications','smoking','alcohol','exercise_freq',
                                       -- 'last_checkup','health_concerns','family_history','location_area','nickname','birth_year'
  value_kind text not null check (value_kind in ('number','text','text_list','date_fuzzy')),
  unit text                            -- 'kg','cm','year' or null
);

create table user_facts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  customer_id uuid not null references customers(id),
  key text not null references fact_keys(key),
  value_text text,
  value_num numeric,
  confidence numeric not null check (confidence between 0 and 1),
  status text not null default 'active' check (status in ('active','candidate','superseded','retracted')),
  source text not null check (source in ('chat_extraction','lab_import','wearable','user_form','referrer_form','user_confirmation')),
  source_ref uuid,                     -- chat_messages.id or lab_reports.id
  superseded_by uuid references user_facts(id),
  created_at timestamptz not null default now()
);
create index on user_facts (customer_id, key) where status = 'active';
create unique index user_facts_dedupe on user_facts (customer_id, key, source, source_ref);  -- idempotent extraction
```
Append-only: supersede = insert new row, set old row `status='superseded', superseded_by=<new id>` in one transaction. NO `update ... set value`.

### 1.5 Orders & commerce
```sql
create table orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  customer_id uuid references customers(id),     -- nullable for referrer-assisted walk-ins
  session_id uuid references chat_sessions(id),
  product_id uuid not null references products(id),
  qty int not null default 1 check (qty > 0),
  amount_baht integer not null,
  buyer_name text,
  buyer_phone text,
  preferred_branch text,
  preferred_date date,
  channel text not null check (channel in ('chat_app','chat_pwa','chat_line','referrer')),
  referrer_id uuid,                               -- FK after referrers
  status text not null default 'collecting_info'
    check (status in ('collecting_info','awaiting_payment','submitted','confirmed','booked','done','cancelled')),
  slip_url text,
  booking_at timestamptz,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on orders (tenant_id, status, created_at desc);

create table order_events (             -- full audit trail; written by the state machine ONLY
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  from_status text,
  to_status text not null,
  actor text not null,                  -- 'customer'|'ai'|'referrer:<id>'|'admin:<auth_user_id>'|'system'
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
```

### 1.6 Refer program
```sql
create table referrers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  ref_code text not null unique,        -- 6-char base32, generated, immutable
  name text not null,
  type text not null check (type in ('doctor','nurse','creator','staff')),
  phone text,
  auth_user_id uuid references auth.users(id),   -- optional login for referrer view
  commission_scheme jsonb not null,     -- {"mode":"percent","default":10,"by_category":{"vaccine":5}} or {"mode":"flat_baht","default":100}
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table commission_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  referrer_id uuid not null references referrers(id),
  order_id uuid not null references orders(id) unique,   -- one entry per order (idempotent)
  scheme_snapshot jsonb not null,
  amount_baht integer not null,
  status text not null default 'pending' check (status in ('pending','approved','paid','void')),
  created_at timestamptz not null default now()
);
alter table customers add constraint customers_referred_by_fkey foreign key (referred_by) references referrers(id);
alter table orders add constraint orders_referrer_fkey foreign key (referrer_id) references referrers(id);
```

### 1.7 Health dashboard
```sql
create table lab_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  customer_id uuid not null references customers(id),
  storage_path text not null,           -- private bucket 'lab-reports'
  status text not null default 'processing' check (status in ('processing','needs_confirmation','ready','failed')),
  ai_summary_th text,                   -- generated once at import
  collected_date date,
  created_at timestamptz not null default now()
);

create table lab_results (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references lab_reports(id),
  test_code text not null,              -- normalized: 'FBS','HBA1C','CHOL','TG','HDL','LDL','CR','ALT','AST',...
  test_name_raw text not null,
  value numeric,
  unit text,
  ref_low numeric,
  ref_high numeric,
  confidence numeric not null,
  confirmed boolean not null default false,   -- user confirmed low-confidence reads
  unique (report_id, test_code)
);

create table wearable_metrics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  customer_id uuid not null references customers(id),
  source text not null check (source in ('apple_export','healthkit','manual')),
  metric text not null check (metric in ('steps','resting_hr','avg_hr','sleep_minutes','active_energy_kcal')),
  day date not null,
  value numeric not null,
  unique (customer_id, metric, day, source)   -- idempotent re-import
);
```

### 1.8 Consent (PDPA)
```sql
create table consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  customer_id uuid not null references customers(id),
  kind text not null check (kind in ('health_data_collection')),
  granted boolean not null,
  created_at timestamptz not null default now()
);
```
Fact extraction (§4) must check the latest consent row; if absent, the orchestrator injects `ยังไม่ได้ขอความยินยอมเก็บข้อมูล` into context once so the model asks naturally; "ตกลง/ได้เลย" → client sends explicit consent action (button), not parsed from free text.

### 1.9 RLS pattern (apply to every table above)
```sql
alter table <t> enable row level security;
-- customers (app/PWA logged-in) read own rows:
create policy <t>_customer_read on <t> for select using (
  customer_id in (select id from customers where auth_user_id = auth.uid())
);
-- tenant staff full read, scoped writes:
create policy <t>_staff_all on <t> for all using (
  tenant_id in (select tenant_id from tenant_members where auth_user_id = auth.uid())
);
```
Edge functions use service role and MUST filter by tenant explicitly in every query (code review/audit point). Tables with no customer-facing reads (commission_entries, order_events) get staff-only policies. Storage: buckets `lab-reports`, `payment-slips`, `product-images` (public read for product-images only); access via signed URLs (60 min).

---

## 2. Shared server library (`supabase/functions/_shared/`)

All edge functions are Deno. Shared modules (each with unit tests in `_shared/__tests__/`):

```
_shared/
  types.ts            // all payload + row types (mirror of lib/types/api.ts)
  http.ts             // json(), error(), envelope helpers, zod request validation
  db.ts               // createServiceClient(), tenantBySlug(), assertTenant()
  openai.ts           // callMiraPrompt(vars, input): {text, responseId}; callFactExtractor(...)
  marker.ts           // parseProductMarker(text)
  context.ts          // buildPersonalContext(), buildRecentChat(), buildCatalogJson()
  orders.ts           // order state machine (transition())
  promptpay.ts        // buildPromptPayPayload(idOrPhone, amountBaht): string (EMVCo)
  line.ts             // verifySignature(), replyText(), replyFlexProducts(), replyImage()
  facts.ts            // insertFactsIdempotent(), supersedeConflicts(), renderFactsThai()
```

### 2.1 `marker.ts` (exact implementation)
```ts
const MARKER_RE = /\n?\[\[products:\s*([^\]]+)\]\]\s*$/;

export function parseProductMarker(raw: string): { text: string; catalogKeys: string[] } {
  const m = raw.match(MARKER_RE);
  if (!m) return { text: raw.trim(), catalogKeys: [] };
  const catalogKeys = m[1].split(',').map(s => s.trim()).filter(Boolean).slice(0, 2);
  return { text: raw.replace(MARKER_RE, '').trim(), catalogKeys };
}
```
Required tests: no marker; one id; two ids; whitespace variants; marker mid-text (must NOT match — only end); >2 ids truncated to 2; unknown ids handled by caller (lookup miss → log `marker_unknown_key`, drop silently).

### 2.2 `context.ts` rules
- `buildRecentChat(sessionId)`: last 8 messages (user/assistant only), oldest→newest, rendered `User: ...\nAssistant: ...`; total budget 1,500 chars — if over, drop oldest pairs. Returns `"ไม่มีแชทล่าสุด"` when empty.
- `buildPersonalContext(customerId, activeOrder?)`: lines, in this exact order:
  1. active facts: `อายุ 35 / น้ำหนัก 70 กก. / โรคประจำตัว: ไม่มี / ตรวจล่าสุด: ไม่แน่ใจ`
  2. candidate facts (≤2): `ข้อมูลที่ควรยืนยันแบบเนียนๆ: น้ำหนัก ~70`
  3. active order context (§3.3): `กำลังสั่งซื้อ: วัคซีนงูสวัด จำนวน 1 / ข้อมูลที่ยังขาด: ชื่อ-นามสกุล, เบอร์โทร`
  4. consent line if missing (§1.8)
  Returns `"ยังไม่มีข้อมูลส่วนตัวที่ยืนยัน"` when all empty.
- `buildCatalogJson(tenantId, intentCategory?)`: active products → `[{id: catalog_key, name, description, price: price_baht, image: image_url}]`. If >50 rows: filter by `intentCategory` when the latest user message matches keyword map `{ตรวจ→checkup, วัคซีน/ฉีด→vaccine}`, else top 50 newest. `JSON.stringify`, no pretty-print.

### 2.3 `promptpay.ts`
Implement EMVCo "Thai QR" payload (do not hand-roll CRC wrong — port the well-known algorithm):
- TLV fields: `00=01`, `01=11` (dynamic), `29` (AID `A000000677010111` + proxy: phone→`01` value `0066`+9 digits, national id→`02`), `53=764`, `54=<amount with 2 decimals>`, `58=TH`, `63=CRC16-CCITT(0xFFFF)` over payload incl. `6304`.
- `buildPromptPayPayload('0812345678', 2990)` → deterministic string; render QR client-side with `react-native-qrcode-svg` (app) / `qrcode` (web). Unit tests: known-good payload fixtures (generate three fixtures with an online-verified reference once, embed expected strings in test).

### 2.4 `orders.ts` state machine (single source of truth)
```ts
type OrderStatus = 'collecting_info'|'awaiting_payment'|'submitted'|'confirmed'|'booked'|'done'|'cancelled';

const TRANSITIONS: Record<OrderStatus, Partial<Record<OrderStatus, Guard>>> = {
  collecting_info: { awaiting_payment: hasBuyerInfo, cancelled: always },
  awaiting_payment:{ submitted: always /* customer tapped จ่ายแล้ว or slip uploaded */, cancelled: always },
  submitted:       { confirmed: adminOnly, cancelled: adminOnly },
  confirmed:       { booked: adminAndHasBookingAt, cancelled: adminOnly },
  booked:          { done: adminOnly, cancelled: adminOnly },
  done: {}, cancelled: {},
};
```
`transition(orderId, to, actor, meta)`:
1. `select ... for update` the order; 2. validate via table above (throw `IllegalTransition` otherwise); 3. update `status`, `updated_at`; 4. insert `order_events`; 5. side effects map: `confirmed→` create commission entry if `referrer_id` (§5.3) + notify customer; `booked→` notify customer with datetime. All in one transaction (use Postgres function `rpc` if needed for atomicity from edge).
Every status write in the entire codebase goes through this function. Direct `update orders set status` anywhere else = audit FAIL.

---

## 3. Edge function: `chat-orchestrator` (replaces customer path of `mira-chat`)

### 3.1 API
`POST /functions/v1/chat-orchestrator`
```jsonc
// request (zod-validated)
{ "tenant_slug": "demo-hospital", "session_id": "uuid|null", "client_msg_id": "uuid",
  "channel": "app|pwa", "message": "อยากตรวจสุขภาพ",
  "action": null | {"type":"consent_granted"} | {"type":"select_product","catalog_key":"chk-basic"}
          | {"type":"order_form_submit","order_id":"uuid","buyer_name":"...","buyer_phone":"..."}
          | {"type":"payment_done","order_id":"uuid"} }
// response 200
{ "ok": true, "data": { "session_id":"uuid", "text":"...", 
  "products":[{"catalog_key":"chk-basic","name":"...","price_baht":1590,"image_url":"...","description":"..."}],
  "order": null | {"id":"uuid","status":"awaiting_payment","missing_fields":[],"qr_payload":"000201...","amount_baht":2990,"product_name":"..."} } }
// errors: { "ok": false, "error": { "code":"TENANT_NOT_FOUND|RATE_LIMITED|UPSTREAM|VALIDATION", "message":"..." } }
```
Auth: Supabase JWT (customer). LINE traffic comes via `line-webhook` which calls the same internal handler function (extract core logic into `_shared/orchestrate.ts` so both functions share it).

### 3.2 Handler sequence (pseudocode — implement exactly)
```
validate request (zod) ; resolve tenant ; resolve/create customer ; resolve/create session
if action != null: handleAction(action)        // §3.3 — may transition order, may not call the model
persist user message (idempotent on client_msg_id; on conflict return cached assistant reply for that msg)
rateLimit: max 20 user msgs / 5 min / customer → RATE_LIMITED
vars = { brand_name, user_nickname (customer.nickname ?? 'ลูกค้า'),
         personal_context: buildPersonalContext(customer, activeOrder),
         recent_chat: buildRecentChat(session), product_catalog: buildCatalogJson(tenant, intent) }
{ text, responseId } = callMiraPrompt(vars, message)     // store:false, prompt id from env, 2 retries w/ backoff, 30s timeout
{ text, catalogKeys } = parseProductMarker(text)
products = lookupByCatalogKeys(tenant, catalogKeys)      // unknown keys logged + dropped
persist assistant message {content: text, marker_product_ids: catalogKeys, openai_response_id}
update session.last_message_at ; flag session if emergency keywords in text ('1669', 'ห้องฉุกเฉิน')
fire-and-forget: invoke fact-extractor (supabase.functions.invoke, no await on result)
return envelope
```

### 3.3 Order flow logic (DB-driven, NOT prompt-scripted)
- `select_product` action (user tapped a card CTA): create order `collecting_info` (amount = price×qty, channel from request), attach to session. Compute `missing_fields` = required minus known (`buyer_name` ← fact `nickname`? NO — full name must be explicit; `buyer_phone` ← customers.phone if present).
- While an order is `collecting_info`, the orchestrator after EVERY model reply runs `extractOrderFields(userMessage)` — a small structured-output extraction (same call as fact extractor, separate schema: `{buyer_name?, buyer_phone?, preferred_date?}`) — and writes found fields to the order. When complete → `transition(awaiting_payment, actor:'ai')` → response includes `order.qr_payload` (client renders QR + "จ่ายแล้ว" button + slip upload).
- The MODEL is informed of order state ONLY via the `personal_context` order line (§2.2 #3). It will ask for missing info naturally per its prompt. Backend never injects scripted questions. Fallback: if after 2 model turns a required field is still missing, response sets `order.show_form = true` → client renders the form card (`order_form_submit` action fills the rest).
- `payment_done` / slip upload → `transition(submitted)`; respond with templated `system_notice` message (Thai, from `supabase/functions/_shared/templates.ts`) — not a model call.

---

## 4. Edge function: `fact-extractor`

`POST` (internal; called by orchestrator) `{ message_id }`.
1. Load message (role must be `user` — else 400) + customer + tenant; load consent; if no consent → exit 0 (extract nothing).
2. Gemini structured output (model `GEMINI_EXTRACT_MODEL`, falling back to `GEMINI_MODEL`), JSON schema:
```jsonc
{ "facts": [ { "key": "<one of fact_keys registry>", "value": "string", "confidence": 0.0 } ] }
```
   System text (fixed constant in code): "Extract personal health facts explicitly stated by the USER message (Thai). Output [] if none. Never infer beyond the text. Buddhist years → subtract 543."
3. Normalize: numbers parsed (`weight_kg`, `height_cm`, `age` etc. via fact_keys.value_kind), Thai numerals → arabic, units stripped. Invalid key/value → drop + log.
4. Insert via `insertFactsIdempotent` (unique index §1.4 makes re-runs no-ops): confidence ≥0.7 → `active` + supersede same-key conflicts; 0.4–0.69 → `candidate`; else drop.
5. `nickname` fact additionally updates `customers.nickname` (the one denormalized copy).
Failure policy: log + give up (never retried into duplicate, never blocks chat).

---

## 5. Refer program (Phase 4)

### 5.1 Attribution
- Share URL: `{APP_BASE_URL}/r/{ref_code}` → route stores `ref_code` (cookie/localStorage `mira_ref`, 30 days) → on customer creation or first message: if customer.referred_by is null and code valid+active+same tenant → set `referred_by`, `referred_at`.
- LINE: ref links use LIFF query `?ref=CODE`, same rule.
- Order creation: `referrer_id` = (channel='referrer') ? acting referrer : (customer.referred_by where `now() - referred_at <= tenant.attribution_window_days`).

### 5.2 Assisted purchase (referrer UI, base `partner.tsx` → rebuild per §0.2 if weaker)
Screens: login (referrer auth) → product grid (same catalog query) → buyer form (name+phone required, validated Thai phone `^0[689]\d{8}$`) → POST `/functions/v1/referrer-order` → order created (`channel:'referrer'`, `status:'awaiting_payment'`, customer matched-or-created by phone) → QR screen (payload from response) → "ลูกค้าจ่ายแล้ว" → `submitted`. Referrer earnings tab: list commission_entries w/ status.

### 5.3 Commission computation (in `transition()` side effect, status → `confirmed`)
```
scheme = referrers.commission_scheme (snapshot into entry)
amount = mode=='percent' ? round(order.amount_baht * (by_category[product.category] ?? default) / 100)
                         : (by_category[product.category] ?? default)
insert commission_entries (unique order_id → idempotent)
```

---

## 6. Admin panel (Phase 3–4, base screens exist — consolidate)

- Single route group `app/admin/` (replace scattered `hospital-*`, `admin-booking` per §0.2), guarded by `tenant_members` role.
- **Orders queue:** realtime (Supabase channel on `orders` filtered by tenant), columns: created, product, buyer, phone, channel badge, referrer, status chip, slip thumbnail (signed URL). Detail drawer: full info + transcript viewer (read-only `chat_messages` of session) + actions calling `POST /functions/v1/admin-order-action {order_id, action: confirm|book|done|cancel, booking_at?, note?}` → `transition()` with `actor:'admin:<uid>'`.
- **Booking notification:** `transition` side effects insert a `system_notice` chat message (template: `ยืนยันการจอง {product} วันที่ {date} เวลา {time} เรียบร้อยค่ะ ...`) and, for LINE channel, push via LINE API.
- **Catalog CRUD:** form per §1.2; image upload → `product-images` bucket; `catalog_key` shown read-only.
- **Referrers:** CRUD + scheme editor (validated against schema) + commissions table with approve/paid bulk actions.

---

## 7. Health dashboard (Phase 5)

### 7.1 `lab-ingest` function
`POST {storage_path, customer_id}` → insert `lab_reports(processing)` → vision call (OpenAI, image input, structured output array of `{test_name_raw, mapped_code|null, value, unit, ref_low, ref_high, confidence}` with the normalization table for the 15 supported `test_code`s embedded in the system text) → insert `lab_results` → report status: any field confidence <0.8 → `needs_confirmation` else `ready` → generate `ai_summary_th` ONCE (plain-Thai, 3-5 sentences, fixed disclaimer appended from `supabase/functions/_shared/templates.ts`, never the word "วินิจฉัย") → for `ready` rows with code in {FBS, HBA1C, CHOL, weight-related}: insert `user_facts(source:'lab_import', source_ref: report_id)`.
Client confirmation UI: list low-confidence fields → user edits/confirms → `confirmed=true` → status `ready` → facts inserted then.

### 7.2 `wearable-ingest` function
`POST {storage_path}` (uploaded Apple Health export zip): stream-parse `export.xml` (SAX-style — file can be >100MB; never load whole file), aggregate per day per metric (map: `HKQuantityTypeIdentifierStepCount→steps`, `HeartRate→avg_hr`, `RestingHeartRate→resting_hr`, `ActiveEnergyBurned→active_energy_kcal`, sleep from `HKCategoryTypeIdentifierSleepAnalysis` minutes), upsert `wearable_metrics` (unique index = idempotent re-import). Insert latest weight/height samples as `user_facts(source:'wearable')`.

### 7.3 Dashboard screens
Refactor `health-check-results.tsx` / `body-overview.tsx` / `wearable-health.tsx` to read ONLY from `lab_results`/`wearable_metrics`/`user_facts` (no mock data left — audit greps for hardcoded arrays). Charts: `victory-native` or existing chart lib in repo (check first); trend = same `test_code` across reports by `collected_date`. Insights are rule-based (e.g. steps 7-day avg vs prior week) — no model calls at view time.

---

## 8. LINE webhook (Phase 6)

`POST /functions/v1/line-webhook` (per-tenant path `?tenant=<slug>`): verify `x-line-signature` (HMAC-SHA256, channel secret) → map events: `message.text` → shared `orchestrate()` with `channel:'line'`, customer by `line_user_id` → reply: text message + (if products) Flex carousel (bubble: image, name, price, CTA button postback `select_product:<catalog_key>`) + (if order.qr_payload) QR rendered server-side (`qrcode` lib → PNG → upload to storage → image message). Postback events map to orchestrator `action`s. Follow event → greeting via one orchestrator call with message `"สวัสดี"`.

---

## 9. Client refactor (app/PWA)

- `lib/api/client.ts`: typed fetch wrapper for all function endpoints (single place; React Query for caching/retries).
- Chat screen state: messages list from DB (paged) + optimistic append; renders by message shape: text bubble / product card carousel (when `products.length`) / order panel (status-driven: missing-fields form, QR view + paid button + slip picker, status chips) / system_notice styled distinctly.
- Components: `components/chat/MessageBubble.tsx`, `ProductCarousel.tsx`, `OrderPanel.tsx`, `ConsentSheet.tsx` — props typed from `lib/types/api.ts`, no component fetches directly (container passes data).
- Delete `PrototypeChatPanel.tsx` usage from production routes once parity reached (§0.2 procedure).

---

## 10. Testing & verification (every phase)

- Unit (deno test): marker (8 cases §2.1), promptpay fixtures (3), state machine (every legal + 6 illegal transitions), context builders (empty/full/overflow), fact normalizer (Thai numerals, Buddhist year, kg parsing).
- Integration: `scripts/chat-regression.mjs` — runs the 7-case suite from the handoff doc against a seeded test tenant; assertions per case are mechanical: q2/q3 reply contains exactly one `?`-equivalent question (regex `คะ$|ไหมคะ$` count), q4/q5/q6 `marker_product_ids.length >= 1` and ids ∈ seeded catalog, q7 contains `1669` and `marker_product_ids.length == 0`, all replies ≤ 3 sentences (split on Thai sentence boundaries approximated by `ค่ะ|คะ|นะคะ` + newline). Suite must run in CI (GitHub Action) on every PR touching chat code.
- RLS tests: `scripts/rls-check.mjs` — as customer A try to read customer B rows and write cross-tenant catalog rows through PostgREST → expect 0 rows / denied write; run in optional live CI against the linked project.
- Seed script `scripts/seed-demo.mjs`: demo tenant + 7-product catalog (the one in the handoff §4) + test customer + referrer — required for all the above.

## 11. Phase → file map (build order for the implementing agent)

| Phase | Migrations | Functions | Client | Tests |
|---|---|---|---|---|
| 1 | tenants, customers, tenant_members, products(+data migration from hospital_product_*), fact_keys+user_facts, consents, RLS | — | admin catalog CRUD | RLS tests, seed |
| 2 | chat_sessions, chat_messages | `_shared/*`, chat-orchestrator, fact-extractor | chat screen refactor, ConsentSheet | marker/context/facts units, regression suite |
| 3 | orders, order_events | orders.ts machine, admin-order-action, promptpay | OrderPanel, admin orders queue | state machine units, promptpay fixtures, e2e purchase |
| 4 | referrers, commission_entries, customers.referred_by | referrer-order | referrer screens, admin referrer screens | commission calc units, attribution e2e |
| 5 | lab_reports, lab_results, wearable_metrics | lab-ingest, wearable-ingest | dashboard refactors, confirmation UI | normalizer units, sample-file fixtures |
| 6 | — | line-webhook | — | regression suite over LINE sandbox |

Anything ambiguous beyond this spec → STOP and write the question into `docs/v2-open-questions.md` instead of guessing. Do not invent endpoints, tables, or models not listed here.
