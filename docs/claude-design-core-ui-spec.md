# Claude Design UI Handoff - Mila AI Core System

เอกสารนี้เอาไว้ส่งให้คนทำ UI/UX หรือ Claude Design เท่านั้น เป้าหมายคือให้ออกแบบ UI ใหม่จากระบบหลักของ Mila AI โดยไม่เอา UI เก่าหรือ showcase/mockup กลับมาใช้

## ขอบเขตที่ต้องออกแบบ

ระบบหลักมี 3 ส่วน:

1. AI Chat Sales Agent
2. Referral Program
3. Admin Channel / Back Office

สิ่งที่ไม่ต้องออกแบบกลับมา:

- Tenant setup / tenant selector เพราะระบบนี้แสดงองค์กรเดียว
- PDPA export/delete UI
- Lab / Wearable / Health dashboard UI
- หน้า demo, showcase, หรือ mockup ที่ไม่ได้เป็นงานจริง

แนวทางภาพรวม:

- เป็น SaaS dashboard สำหรับใช้งานจริง ไม่ใช่ landing page
- หน้าจอต้องอ่านเร็ว ใช้พื้นที่คุ้ม มี table/filter/status ชัดเจน
- ทุกหน้าต้องมี empty state, loading state, error state
- ห้ามใส่ข้อมูลปลอมเพื่อให้หน้าสวย ถ้า backend ไม่มีข้อมูลให้แสดง empty state จริง
- ปุ่ม action ต้องบอกชัดว่าเมื่อกดแล้วเกิดอะไร

## Navigation หลัก

Top-level tabs:

- Referral
- Admin Panel
- AI Chat

Admin Panel sub-navigation:

- ภาพรวม
- ออเดอร์
- สินค้า
- สต็อก
- สาขา
- ผู้แนะนำ
- ค่าคอมมิชชั่น
- บทสนทนา
- การชำระเงิน
- LINE Channel

## 2. Login / Role

หน้าที่ของระบบ:

แยกผู้ใช้ตามบทบาท เพื่อให้แต่ละคนเห็นเฉพาะหน้าที่เกี่ยวข้อง เช่น ลูกค้า, ผู้แนะนำ, staff/admin

ข้อมูลที่ UI ต้องใช้:

- Email
- Password
- Role ที่ต้องการเข้าใช้งาน: Customer, Referrer, Staff/Admin
- สถานะ session ปัจจุบัน
- ข้อมูล profile หลัง login
- สิทธิ์ของผู้ใช้ เช่น customer, referrer, staff, tenant_admin

UI ที่ต้องมี:

- ปุ่ม Login บน header
- หน้า login แบบ compact
- ตัวเลือก role แบบ segmented control
- ช่อง email/password
- ปุ่มเข้าสู่ระบบ
- ข้อความ error เมื่อรหัสผิด หรือ role ไม่ตรงกับสิทธิ์
- สถานะ logged-in พร้อมชื่อผู้ใช้และปุ่ม logout

Flow การกด:

1. ผู้ใช้กด Login
2. เลือก role ที่ต้องการเข้า
3. กรอก email/password
4. กดเข้าสู่ระบบ
5. ถ้าเป็น Customer ให้ไป AI Chat หรือ Orders
6. ถ้าเป็น Referrer ให้ไป Referral dashboard
7. ถ้าเป็น Staff/Admin ให้ไป Admin Panel
8. ถ้าสิทธิ์ไม่ตรง role ให้แสดง error และไม่พาไปหน้าผิด

Backend ที่เกี่ยวข้อง:

- Supabase Auth
- ตาราง user/customer/referrer/staff profile
- tenant membership หรือ role membership เดิมของระบบ

## 3. Product CRUD

หน้าที่ของระบบ:

ให้ Admin จัดการ catalog จริงที่ AI Chat และ Referral ใช้ขายสินค้าเดียวกัน

ข้อมูลที่ UI ต้องใช้:

- Product ID
- ชื่อสินค้า
- รายละเอียดสินค้า
- ราคา
- รูปสินค้า
- Category
- สาขาที่ขาย
- สถานะ active/inactive
- Stock
- Commission rule
- Stripe product/price status ถ้ามี
- RAG/AI readiness หรือสถานะว่าสินค้าถูกใช้ใน AI ได้หรือยัง

UI ที่ต้องมี:

- Admin Panel > สินค้า
- Search bar
- Filter: active/inactive, category, branch, stock status
- ตารางสินค้า
- ปุ่มเพิ่มสินค้า
- Product detail drawer หรือ modal
- Form สร้าง/แก้ไขสินค้า
- ปุ่มบันทึก
- ปุ่มปิดขาย/เปิดขาย
- สถานะว่า save สำเร็จหรือ fail

Flow การกด:

1. Admin เข้า Admin Panel
2. กด สินค้า
3. กด เพิ่มสินค้า
4. กรอกชื่อ, รายละเอียด, ราคา, category, รูป, สาขา, stock, commission, active status
5. กดบันทึก
6. ระบบบันทึกเข้า product catalog backend
7. สินค้า active ต้องไปแสดงใน AI Chat recommendation และ Referral order flow
8. ถ้ากดสินค้าในตาราง ให้เปิด detail เพื่อแก้ไข
9. ถ้าปิด active สินค้าต้องหายจากหน้าขาย แต่ประวัติ order เดิมยังอยู่

Backend ที่เกี่ยวข้อง:

- Product catalog API/table
- Product branch mapping
- Stock table หรือ stock field
- Commission scheme
- Stripe product sync function ถ้าใช้ payment online

## 4. Stock

หน้าที่ของระบบ:

จัดการจำนวนสินค้าคงเหลือ เพื่อไม่ให้ AI Chat หรือ Referral ขายของที่หมด

ข้อมูลที่ UI ต้องใช้:

- Product
- Branch ถ้า stock แยกตามสาขา
- Current stock
- Reserved stock
- Available stock
- Stock movement history
- Reason การปรับ stock
- Admin ผู้ปรับ
- Timestamp

UI ที่ต้องมี:

- Admin Panel > สต็อก
- ตาราง stock แยกตาม product/branch
- Filter: low stock, out of stock, branch, category
- ปุ่มปรับ stock
- Form เพิ่ม/ลด stock
- ช่อง reason
- History log
- Badge sold out / low stock

Flow การกด:

1. Admin เข้า สต็อก
2. เลือก product หรือ branch
3. กด ปรับ stock
4. เลือก action: เติมสินค้า, ลดสินค้า, ปรับยอด, เสียหาย, reserve/release
5. ใส่จำนวนและ reason
6. กดยืนยัน
7. ระบบอัปเดต available stock
8. ถ้า stock เป็น 0 หน้า AI Chat/Referral ต้องไม่ให้ซื้อ หรือแสดง sold out

Backend ที่เกี่ยวข้อง:

- Product stock backend
- Order reserve logic
- Stock movement log
- Admin audit metadata

## 5. Branch Management

หน้าที่ของระบบ:

จัดการสาขา จุดให้บริการ หรือพื้นที่จัดส่ง ที่ใช้ร่วมกับสินค้าและ booking/order

ข้อมูลที่ UI ต้องใช้:

- Branch ID
- ชื่อสาขา
- ที่อยู่
- เบอร์โทร
- Map URL
- เวลาเปิดทำการ ถ้ามี
- สถานะ active/inactive
- สินค้าที่ผูกกับสาขา

UI ที่ต้องมี:

- Admin Panel > สาขา
- ตารางสาขา
- ปุ่มเพิ่มสาขา
- Branch detail drawer/modal
- Form แก้ไขสาขา
- ปุ่ม active/inactive
- Section แสดงสินค้าที่ขายในสาขานั้น

Flow การกด:

1. Admin เข้า สาขา
2. กด เพิ่มสาขา
3. กรอกชื่อ, ที่อยู่, เบอร์, map URL, เวลาเปิดทำการ, active
4. กดบันทึก
5. สาขานี้ต้องเลือกได้ใน product form
6. เมื่อลูกค้าสั่งสินค้าที่ต้องเลือกสาขา AI Chat/Referral ต้องใช้ข้อมูลสาขานี้
7. ถ้าปิดสาขา สาขานั้นห้ามถูกเลือกใน order ใหม่ แต่ order เก่ายังแสดงข้อมูลเดิมได้

Backend ที่เกี่ยวข้อง:

- Branch table/API
- Product branch mapping
- Order branch selection

## 6. Commission Approve / Pay

หน้าที่ของระบบ:

ให้ Admin ตรวจสอบ อนุมัติ และบันทึกการจ่ายค่าคอมมิชชั่นให้ referrer

ข้อมูลที่ UI ต้องใช้:

- Commission entry ID
- Referrer
- Order
- Product
- ยอดขาย
- อัตราคอมมิชชั่น
- จำนวนเงิน commission
- Status: pending, approved, paid, void
- วันที่สร้าง
- วันที่อนุมัติ
- วันที่จ่าย
- Payment note หรือ payout reference

UI ที่ต้องมี:

- Admin Panel > ค่าคอมมิชชั่น
- Summary cards: pending amount, approved amount, paid amount
- Filter ตาม status/date/referrer
- ตาราง commission
- Checkbox เลือกหลายรายการ
- ปุ่ม Approve
- ปุ่ม Mark as paid
- Detail drawer แสดง order และ commission snapshot

Flow การกด:

1. Admin เข้า ค่าคอมมิชชั่น
2. เลือก filter pending
3. กด row เพื่อดู detail
4. ตรวจ order, referrer, amount, rule snapshot
5. กด Approve
6. รายการเปลี่ยนเป็น approved
7. หลังจ่ายเงินจริง กด Mark as paid
8. ใส่ payout note/reference
9. รายการเปลี่ยนเป็น paid และควรแก้ยอดย้อนหลังไม่ได้

Backend ที่เกี่ยวข้อง:

- Commission entries
- Referral attribution
- Order confirmation state
- Commission calculation snapshot
- Admin action endpoint หรือ RPC เดิม

## 7. Referrer Management

หน้าที่ของระบบ:

จัดการผู้แนะนำ referral code, link, QR, commission rule และ performance

ข้อมูลที่ UI ต้องใช้:

- Referrer ID
- ชื่อ
- เบอร์/อีเมล
- Ref code
- Referral link
- Active status
- Commission scheme
- จำนวน order ที่แนะนำ
- ยอดขายรวม
- Commission pending/paid
- วันที่สร้าง

UI ที่ต้องมี:

- Admin Panel > ผู้แนะนำ
- ตาราง referrer
- ปุ่มสร้าง referrer
- ปุ่ม copy link
- ปุ่มดู QR
- Detail page/drawer ของ referrer
- Section performance
- Section commission
- Toggle active/inactive

Flow การกด:

1. Admin เข้า ผู้แนะนำ
2. กด เพิ่มผู้แนะนำ
3. กรอกชื่อ, เบอร์, email, type, commission scheme
4. กดบันทึก
5. ระบบสร้าง ref code
6. Admin copy link หรือเปิด QR ให้ referrer
7. กด referrer row เพื่อดูยอดขาย, order, commission
8. ถ้าปิด active link ใหม่ไม่ควรสร้าง attribution แต่ประวัติเดิมยังต้องอยู่

Backend ที่เกี่ยวข้อง:

- Referrers table
- Referral code generator
- Commission scheme
- Referral attribution/order relation

## 8. AI Chat Checkout

หน้าที่ของระบบ:

ให้ลูกค้าคุยกับ AI เพื่อถามสินค้า เลือกสินค้า สร้าง order จ่ายเงิน และติดตามสถานะ

ข้อมูลที่ UI ต้องใช้:

- Chat session
- Message list
- AI response จาก model จริง
- Product cards จาก catalog backend
- Selected product
- Customer info: ชื่อ, เบอร์, อายุหรือข้อมูลที่ backend ต้องใช้
- Branch/date/time ถ้าเป็น service/booking
- Active order panel
- Payment method/status
- Order timeline

UI ที่ต้องมี:

- AI Chat tab
- Message list
- Product carousel/grid
- Chat input
- ปุ่มส่ง
- Order side panel หรือ inline checkout panel
- Payment panel
- Order status/timeline
- Error state เมื่อ AI/backend ตอบไม่ได้

Flow การกด:

1. ลูกค้าเปิด AI Chat
2. พิมพ์คำถามหรือความต้องการ
3. AI ตอบด้วย model จริงและดึง catalog จริง
4. ถ้า AI แนะนำสินค้า ให้แสดง product cards
5. ลูกค้ากดเลือกสินค้า
6. UI เปิด checkout/order panel
7. ลูกค้ากรอกข้อมูลที่จำเป็น
8. กดสร้าง order
9. Backend สร้าง order และส่งสถานะ awaiting_payment
10. ลูกค้ากดจ่ายเงินผ่าน Stripe/PromptPay หรืออัปโหลด slip ตามระบบที่มี
11. หลังจ่ายแล้ว order เข้า Admin order queue
12. เมื่่อ Admin เปลี่ยนสถานะ ลูกค้าต้องเห็น update ใน chat/order tracking

Backend ที่เกี่ยวข้อง:

- chat-orchestrator
- OpenAI model/prompt ของระบบ
- Product catalog
- Order state machine
- Stripe/PromptPay payment functions
- Referral attribution ถ้าลูกค้าเข้าจาก referral link

## 9. Real QR Referral

หน้าที่ของระบบ:

ให้ referrer แชร์ QR/link จริงที่เปิดหน้า `/r/{ref_code}` และผูก attribution กับลูกค้า เพื่อให้ order หลังจากนั้นคิด commission ถูกคน

ข้อมูลที่ UI ต้องใช้:

- Ref code
- Referral public URL
- QR code ที่สร้างจาก URL จริง
- Referrer name
- Active status ของ referrer
- Attribution status หลังลูกค้าสแกน
- จำนวน click/order/conversion ถ้ามี backend รองรับ

UI ที่ต้องมี:

- Referral tab > Share หรือ Dashboard
- Card แสดง QR จริง
- Text field แสดง referral link
- ปุ่ม copy link
- ปุ่ม download/share QR ถ้าต้องการ
- Preview ว่าลิงก์จะพาลูกค้าไปหน้าไหน
- Empty state ถ้า user ยังไม่ใช่ referrer

Flow การกด:

1. Referrer login เข้า Referral
2. ระบบโหลด ref code ของ referrer
3. UI สร้าง QR จาก URL จริง เช่น `https://domain.com/r/ABC123`
4. Referrer กด copy link หรือให้ลูกค้าสแกน QR
5. ลูกค้าเปิด route `/r/{ref_code}`
6. Route ตรวจว่า ref code valid และ active
7. ถ้ายังไม่ login ให้เก็บ ref code ไว้ชั่วคราว แล้วพาไป login หรือ AI Chat
8. ถ้า login แล้ว ให้ bind referral attribution กับ customer
9. เมื่อลูกค้าสร้าง order backend ต้องผูก order กับ referrer ตาม attribution rule
10. Commission ต้องเกิดจาก backend rule ไม่ใช่ UI คำนวณเอง

Backend ที่เกี่ยวข้อง:

- `/r/[ref_code]` route
- referral-bind function
- referral attribution storage
- referrers table
- order/referral/commission backend

## 10. Customer Order Tracking

หน้าที่ของระบบ:

ให้ลูกค้าดูสถานะ order ของตัวเองได้โดยไม่ต้องถาม admin

ข้อมูลที่ UI ต้องใช้:

- Order ID
- Product/service
- Amount
- Payment status
- Fulfillment/booking status
- Branch/date/time ถ้ามี
- Timeline status
- System notices จาก backend

UI ที่ต้องมี:

- Customer Orders page หรือ panel ใน AI Chat
- Order list
- Order detail drawer/page
- Timeline: collecting info, awaiting payment, submitted, confirmed, booked, done, cancelled
- Payment action ถ้ายังไม่จ่าย
- Refresh status

Flow การกด:

1. ลูกค้ากด Orders หรือดู order ใน AI Chat
2. ระบบโหลด orders ของ account/session นั้น
3. ลูกค้ากด order card
4. UI แสดง detail และ timeline
5. ถ้ายังรอชำระเงิน ให้มีปุ่มชำระเงินต่อ
6. ถ้าจ่ายแล้ว ให้แสดงสถานะรอ Admin confirm
7. ถ้า Admin เปลี่ยนสถานะ ลูกค้ากด refresh แล้วเห็นสถานะล่าสุด

Backend ที่เกี่ยวข้อง:

- Orders table/API
- Order state machine
- Payment status
- Customer auth/session ownership check

## 11. Admin Conversations

หน้าที่ของระบบ:

ให้ทีมงานดูบทสนทนาระหว่างลูกค้ากับ AI, takeover เป็น human, และตอบกลับผ่าน channel ที่ลูกค้าเข้ามา

ข้อมูลที่ UI ต้องใช้:

- Conversation/session list
- Channel: web, LINE, Facebook, Instagram ในอนาคต
- Customer profile
- Transcript messages
- AI/Human mode
- Related order
- Last message time
- Assigned admin ถ้ามี

UI ที่ต้องมี:

- Admin Panel > บทสนทนา
- Inbox ด้านซ้าย
- Transcript ตรงกลาง
- Customer/order context ด้านขวา
- Toggle หรือปุ่ม Take over
- Reply box สำหรับ human
- Badge channel และ status
- Filter: open, needs human, has order, LINE

Flow การกด:

1. Admin เข้า บทสนทนา
2. เลือก conversation จาก inbox
3. อ่าน transcript และดู customer/order context
4. กด Take over เพื่อเปลี่ยนเป็น human mode
5. พิมพ์ข้อความตอบลูกค้า
6. ถ้าเป็น LINE ต้องส่งผ่าน LINE backend
7. กด Return to AI เพื่อให้ AI กลับมาตอบ
8. ถ้า conversation มี order กด order card แล้วไป Admin Orders พร้อม context

Backend ที่เกี่ยวข้อง:

- Chat sessions/messages
- Admin human takeover state
- Channel adapter เช่น LINE webhook/reply
- Orders/customer context

## 12. Stripe / Payment Admin

หน้าที่ของระบบ:

ให้ Admin ตรวจ payment, slip, Stripe session/status และจัดการ sync payment product/price

ข้อมูลที่ UI ต้องใช้:

- Order
- Amount
- Payment method
- Payment status
- Stripe checkout session/payment intent ถ้ามี
- PromptPay QR/slip ถ้ามี
- Slip preview URL แบบ signed URL
- Admin note
- Error/failure reason

UI ที่ต้องมี:

- Admin Panel > การชำระเงิน
- Payment queue
- Filter: awaiting payment, submitted, paid, failed, refund needed
- Detail drawer
- ปุ่ม Confirm payment
- ปุ่ม Reject payment
- ปุ่มเปิด Stripe session/dashboard ถ้ามี URL
- Section sync Stripe product/price ใน product detail หรือ payment settings

Flow การกด:

1. Admin เข้า การชำระเงิน
2. เลือกรายการ submitted หรือ awaiting review
3. เปิด detail ดู order, amount, provider, slip/Stripe status
4. ถ้าถูกต้อง กด Confirm payment
5. Backend ต้องเปลี่ยนสถานะผ่าน order action/transition path เท่านั้น
6. ถ้าไม่ถูกต้อง กด Reject payment พร้อม note
7. ถ้า product ยังไม่ sync Stripe ให้ Admin กด Sync Stripe product/price จากหน้าสินค้า

Backend ที่เกี่ยวข้อง:

- Stripe checkout function
- Stripe PromptPay QR function
- Stripe webhook
- Admin order action
- Payment slip storage/signed URL
- Product Stripe sync

## 13. LINE Channel UI

หน้าที่ของระบบ:

ให้ Admin เห็นสถานะการเชื่อม LINE, webhook setup, event log และพาไปดู conversation/order ที่มาจาก LINE

ข้อมูลที่ UI ต้องใช้:

- Webhook URL
- Credential status: channel secret/token configured หรือ missing
- Last webhook event
- Last reply status
- LINE user/channel metadata เท่าที่ backend มี
- Postback/action mapping
- Conversation ที่มาจาก LINE

UI ที่ต้องมี:

- Admin Panel > LINE Channel
- Connection checklist
- Webhook URL พร้อมปุ่ม copy
- Credential status cards
- Last event/activity log
- Manual test panel ถ้ามี backend รองรับ
- Link ไป Admin Conversations filter channel = LINE
- Link ไป Admin Orders filter channel = LINE/chat_line

Flow การกด:

1. Admin เข้า LINE Channel
2. ดู webhook URL
3. กด copy webhook URL ไปตั้งใน LINE console
4. ดู credential status ว่าครบหรือยัง
5. เมื่อมี event เข้า ให้แสดงใน activity log
6. กด conversation event เพื่อไป Admin Conversations พร้อม filter LINE
7. กด order event เพื่อไป Admin Orders พร้อม filter LINE
8. ถ้า credential missing ให้แสดง setup state ชัดเจน ไม่แสดงว่าระบบพร้อม

Backend ที่เกี่ยวข้อง:

- line-webhook function
- LINE signature verification
- LINE reply/push helpers
- Chat orchestration shared engine
- Admin conversations/orders filters

## สรุปสำหรับ Designer

UI ใหม่ต้องออกแบบจาก workflow จริง ไม่ใช่จาก UI เก่า:

- Customer ใช้ AI Chat เพื่อถาม-ซื้อ-จ่าย-ติดตาม order
- Referrer ใช้ Referral เพื่อแชร์ link/QR, ดูยอด, และติดตาม commission
- Admin ใช้ Back Office เพื่อจัดการสินค้า, stock, branch, order, payment, conversation, referrer, commission, LINE

ห้ามออกแบบ tenant selector, PDPA tools, lab/wearable/health dashboard, หรือ showcase/demo กลับเข้ามาในระบบหลัก
