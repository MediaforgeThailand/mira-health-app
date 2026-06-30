// Mirror of supabase/functions/_shared/templates.ts.
// The edge shared file is canonical; run npm run templates:mirror-audit after changing constants.

export const ORDER_PAYMENT_SUBMITTED_NOTICE_TH =
  'ส่งข้อมูลการชำระเงินแล้วค่ะ ทีมโรงพยาบาลจะตรวจสอบและยืนยันให้เร็วที่สุด';

export const ORDER_INFO_COMPLETE_NOTICE_TH =
  'ข้อมูลครบแล้วค่ะ กดชำระเงินในการ์ดคำสั่งซื้อได้เลย';

// Shown on web/app when a human agent has taken the conversation over: the AI stays
// silent and the customer's inbound message is recorded for the live console instead.
export const AGENT_HANDOVER_NOTICE_TH =
  'ขณะนี้มีเจ้าหน้าที่ดูแลการสนทนาให้คุณอยู่ค่ะ กรุณารอสักครู่นะคะ';
