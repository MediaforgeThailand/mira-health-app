# Mira UI Backend Audit - 2026-06-25

## Scope

อ้างอิงไฟล์ `C:\Users\taksi\Downloads\Website redesign request (3).zip` และ `BUILD_PROMPT.md` ภายใน zip โดยนำ UI ใหม่มาเป็นฐานหลักของหน้ารวม `/showcase/` สำหรับ 3 ระบบหลัก:

1. AI Sales Chat
2. Referral Program
3. Admin Channel / Back Office

## UI ที่ปรับแล้ว

- ใช้ branding ใหม่ `Mira AI` และ logo ใหม่จาก `assets/images/mira-ai-logo.webp`
- ตัด UI showcase/health/old browser-frame ออกจากหน้าหลักนี้
- หน้าหลักมี top module tabs: `Referral`, `Admin Panel`, `AI Chat`
- Admin desktop เปลี่ยนเป็น back-office shell แบบ UI ใหม่: sidebar ซ้าย, header, cards, panel layout
- Admin sidebar มีเมนูครบตาม mockup: ภาพรวม, ออเดอร์, สินค้าและบริการ, ผู้แนะนำ, บทสนทนา, การชำระเงิน, LINE Channel
- Admin mobile มี phone-frame preview และ bottom nav ครบตามเมนูใหม่
- Referral mobile ใช้ข้อมูล referral/order/commission backend เดิม ไม่ใช้รายได้ปลอม
- AI Chat mobile ใช้ chat engine เดิมและ product catalog จริงผ่าน client เดิม

## Backend Mapping By UI

### Admin - ภาพรวม

- แหล่งข้อมูล: `orders`, `products`, `referrers`, `commission_entries`
- KPI ยอดขายรวม นับจาก order ที่มีสถานะชำระ/ยืนยันแล้ว
- กราฟรายได้ 7 วันคำนวณจาก `orders.created_at`/`paid_at` จริง
- ถ้าไม่มี order จริง แสดง empty/zero state ไม่ใช้ chart mock สูงปลอม

### Admin - ออเดอร์

- แหล่งข้อมูล: `orders` + joins `products`, `customers`, `branches`, `referrers`
- filter/sort/search ทำบนข้อมูล order จริงที่โหลดจาก Supabase
- ปุ่มดำเนินการเปิด detail sidebar ตาม requirement
- action ยืนยัน/จองคิว/เสร็จสิ้น/ยกเลิกเรียก `admin-order-action`
- ยังคงใช้ state machine เดิม ไม่เขียน `orders.status` ตรง

### Admin - สินค้าและบริการ

- แหล่งข้อมูล: product catalog backend เดิมผ่าน `loadManagedHospitalProducts`
- ใน shell ใหม่นี้มี KPI, search, status filter, product cards และ empty/permission state
- เพิ่ม/แก้ไขสินค้าใช้ editor panel ใน UI ใหม่ และบันทึกผ่าน `saveCatalogProduct`
- เปิดขาย/ปิดขายใช้ `updateHospitalProductStatus`
- ซิงก์ Stripe mapping ใช้ `syncHospitalProductToStripe`
- สาขาที่ผูกสินค้าโหลดจาก `loadBranches` และส่ง `branchIds` กลับ backend เดิม

### Admin - ผู้แนะนำ

- แหล่งข้อมูล: `referrers`, `commission_entries`
- แสดง active referrers, total/pending commission, ref code, commission status จาก backend จริง
- ไม่สร้าง referrer mock

### Admin - บทสนทนา

- แหล่งข้อมูล: `chat_sessions`, `chat_messages`, `customers`
- filter channel: ทั้งหมด, LINE, เว็บ, แอป
- เลือกห้องเพื่อดู transcript จริง
- ปุ่ม takeover/return AI เรียก `admin-line-reply` action `set_mode`
- ส่งข้อความ human reply เรียก `admin-line-reply` action `reply`

### Admin - การชำระเงิน

- แหล่งข้อมูล: `orders`
- filter สถานะ: รอตรวจสลิป, รอชำระ, ชำระแล้ว, ล้มเหลว, ต้องคืนเงิน
- slip preview ขอ signed URL ผ่าน `requestSlipUrl`
- confirm/cancel ใช้ action path เดิม ไม่แก้ status ตรง

### Admin - LINE Channel

- แสดง webhook URL จาก `EXPO_PUBLIC_SUPABASE_URL` + tenant slug
- แสดง status/readiness ของ backend function และ shortcut ไปบทสนทนา/ออเดอร์ LINE
- ข้อมูล conversation/order นับจาก backend จริง
- Live LINE sandbox ยังต้องมี env secret จริงของ LINE ก่อนทดสอบกับ LINE OA ได้

### Referral Program

- แหล่งข้อมูล: current referrer, commission entries, products, referrer-order backend
- share link/QR ใช้ ref code จริง
- direct purchase เรียก `referrer-order`
- ไม่มีรายได้หรือ commission mock

### AI Sales Chat

- ใช้ `askAiWithRag` / chat engine เดิม
- โหลด history ผ่าน Supabase chat backend เดิม
- product cards/order panel อ้างอิง catalog/order backend เดิม
- live answer ต้องพึ่ง OpenAI quota ของโปรเจกต์

## Validation Commands

ผ่าน:

- `npm run typecheck`
- `npm run build`
- `npm run v2:verify`
- `npm run v2:rls-check`

ผลสำคัญจาก `npm run v2:verify`:

- referral attribution tests: 3 passed
- Deno shared backend tests: 117 passed, 0 failed
- order state audit: PASS
- RPC grant audit: PASS
- schema/RLS/security/client/docs/deploy audits: PASS
- edge functions Deno check: PASS

## Screenshot/E2E UI Evidence

ไฟล์อยู่ที่:

- `test-artifacts/ui-audit-20260625/screenshot-checks-final.json`
- `test-artifacts/ui-audit-20260625/01-admin-dashboard-desktop.png`
- `test-artifacts/ui-audit-20260625/02-admin-orders.png`
- `test-artifacts/ui-audit-20260625/03-admin-catalog.png`
- `test-artifacts/ui-audit-20260625/04-admin-referrers.png`
- `test-artifacts/ui-audit-20260625/05-admin-conversations.png`
- `test-artifacts/ui-audit-20260625/06-admin-payments.png`
- `test-artifacts/ui-audit-20260625/07-admin-line-channel.png`
- `test-artifacts/ui-audit-20260625/08-mobile-admin-dashboard.png`
- `test-artifacts/ui-audit-20260625/09-mobile-referral.png`
- `test-artifacts/ui-audit-20260625/10-mobile-ai-chat.png`

ผล screenshot test ล่าสุด:

- 10 screenshots generated
- failed checks: 0
- console warnings/errors: 0
- page errors: 0
- old browser-frame text check: PASS
- เพิ่ม screenshot เฉพาะ Product CRUD shell: `test-artifacts/ui-audit-20260625/03-admin-catalog-crud.png`
- เพิ่ม authenticated visual E2E ของ Product CRUD create: `test-artifacts/ui-audit-20260625/11-auth-catalog-create.png`
- เพิ่ม authenticated visual E2E ของ Product CRUD edit: `test-artifacts/ui-audit-20260625/12-auth-catalog-edit.png`
- ผล authenticated Product CRUD create check: `test-artifacts/ui-audit-20260625/auth-catalog-crud-check.json`
- ผล authenticated Product CRUD create->edit check: `test-artifacts/ui-audit-20260625/auth-catalog-crud-edit-check.json`
  - created product rendered/persisted in UI + Supabase `products`: PASS
  - edited product rendered/persisted in UI + Supabase `products`: PASS
  - browser console warnings/errors: 0
  - page errors: 0
  - cleanup residual test product/user: PASS

## Live E2E Status

`npm run v2:e2e-commerce` ถูกลองรันด้วย env จาก `.env.local` แล้ว แต่ยังไม่ผ่าน live เพราะ `chat-orchestrator` เรียก OpenAI แล้วได้ quota error:

`You exceeded your current quota, please check your plan and billing details.`

หลัง fail ได้ตรวจ residual cleanup แล้ว:

- auth users ทดสอบ: 0
- referrers ทดสอบ: 0
- assisted customers ทดสอบ: 0
- v3 products ทดสอบ: 0
- temporary tenants ทดสอบ: 0

สรุป: live commerce E2E ไม่ได้ fail จาก UI หรือ state machine แต่ fail จาก OpenAI quota ภายนอก ทำให้ยังยืนยัน "AI ตอบจริงบน live backend" ไม่ได้จนกว่าจะเติม quota/billing หรือเปลี่ยน key ที่ใช้งานได้

## Authenticated UI CRUD E2E

หลังเพิ่ม Product CRUD เข้า shell ใหม่ ได้ทดสอบผ่าน browser จริงโดยสร้าง disposable tenant admin, inject Supabase session จริง, เปิด `Admin Panel > สินค้าและบริการ`, กด `+ เพิ่มสินค้า`, กรอกชื่อ/ราคา/รายละเอียด, บันทึกผ่าน UI, เลือกสินค้าที่สร้างกลับมาแก้ไขชื่อ/ราคา/รายละเอียด และบันทึกผ่าน UI อีกรอบ:

- UI render สินค้าที่สร้าง: PASS
- DB `products` มี row ที่สร้างพร้อมราคา/รายละเอียดถูกต้อง: PASS
- UI render สินค้าที่แก้ไข: PASS
- DB `products` ถูก update พร้อมชื่อ/ราคา/รายละเอียดใหม่: PASS
- browser console/page error: 0
- cleanup หลังทดสอบ:
  - `E2E UI Catalog %` products: 0
  - `e2e-ui-admin-%` auth users: 0

หลักฐาน:

- `test-artifacts/ui-audit-20260625/11-auth-catalog-create.png`
- `test-artifacts/ui-audit-20260625/12-auth-catalog-edit.png`
- `test-artifacts/ui-audit-20260625/auth-catalog-crud-check.json`
- `test-artifacts/ui-audit-20260625/auth-catalog-crud-edit-check.json`

## External Preflight

`npm run v2:external-preflight`:

- PASS seed-demo service role setup
- PASS seeded chat regression setup
- PASS live RLS project setup
- PASS live commerce E2E setup
- WAIT LINE sandbox setup เพราะไม่มี local env secret ของ LINE
- WAIT Stripe checkout setup เพราะไม่มี local env secret ของ Stripe และ public app URL

## Remaining Gaps

1. Live AI Chat response ยังติด OpenAI quota จึงยังไม่สามารถยืนยันด้วย live E2E ได้ว่าบอทตอบจริงในสภาพ production-like ตอนนี้
2. LINE sandbox/live OA test ยังต้องใส่ `LINE_CHANNEL_SECRET__demo-hospital` และ token env ที่ตรง tenant
3. Stripe checkout/webhook live test ยังต้องใส่ `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, และ public app URL
4. Full live commerce E2E ยังผ่านไม่ได้จนกว่า OpenAI quota จะใช้งานได้ เพราะ flow ซื้อสินค้าผ่าน AI ต้องให้ `chat-orchestrator` ตอบจริงก่อนสร้าง order ต่อ
