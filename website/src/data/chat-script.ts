export type ChatProduct = {
  name: string;
  price: string;
  badge: string;
};

export type ChatStep =
  | { type: 'chip'; tone: 'system' | 'status'; text: string }
  | { type: 'user'; text: string }
  | { type: 'mira'; text: string }
  | { type: 'products'; items: ChatProduct[] }
  | { type: 'order'; title: string; lines: string[]; qrLabel: string }
  | { type: 'toast'; text: string };

export const chatScript: ChatStep[] = [
  {
    type: 'chip',
    tone: 'system',
    text: 'ลูกค้ามาจากลิงก์แนะนำของ คุณหมอนก · DRNOK2',
  },
  {
    type: 'user',
    text: 'สนใจโปรแกรมตรวจสุขภาพให้คุณแม่ค่ะ อายุ 58',
  },
  {
    type: 'mira',
    text: 'แนะนำ 2 โปรแกรมที่เหมาะกับคุณแม่อายุ 58 ปีค่ะ เลือกดูรายละเอียดได้เลย',
  },
  {
    type: 'products',
    items: [
      { name: 'ตรวจสุขภาพ Premium 50+', price: '฿4,900', badge: 'ตัวอย่าง' },
      { name: 'ตรวจหัวใจครบวงจร', price: '฿6,500', badge: 'ตัวอย่าง' },
    ],
  },
  {
    type: 'user',
    text: 'เอา Premium 50+ ค่ะ สาขาไหนใกล้ลาดพร้าว',
  },
  {
    type: 'mira',
    text: 'สาขาลาดพร้าวมีคิวพรุ่งนี้ช่วงเช้าค่ะ สรุปรายการให้แล้ว ชำระผ่าน PromptPay ได้เลย',
  },
  {
    type: 'order',
    title: 'ตรวจสุขภาพ Premium 50+',
    lines: ['สาขาลาดพร้าว · พรุ่งนี้ 09:30', 'ยอดชำระ ฿4,900 · PromptPay'],
    qrLabel: 'QR',
  },
  {
    type: 'chip',
    tone: 'status',
    text: 'ชำระเงินแล้ว · ยืนยันนัดหมาย ✓',
  },
  {
    type: 'toast',
    text: 'ส่วนแบ่งผู้แนะนำ +฿350 → คุณหมอนก (ตัวอย่าง)',
  },
];
