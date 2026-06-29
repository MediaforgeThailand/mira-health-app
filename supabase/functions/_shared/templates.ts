export const ORDER_PAYMENT_SUBMITTED_NOTICE_TH =
  'ส่งข้อมูลการชำระเงินแล้วค่ะ ทีมโรงพยาบาลจะตรวจสอบและยืนยันให้เร็วที่สุด';

export const ORDER_INFO_COMPLETE_NOTICE_TH =
  'ข้อมูลครบแล้วค่ะ กดชำระเงินในการ์ดคำสั่งซื้อได้เลย';

// Shown on web/app when a human agent has taken the conversation over: the AI stays
// silent and the customer's inbound message is recorded for the live console instead.
export const AGENT_HANDOVER_NOTICE_TH =
  'ขณะนี้มีเจ้าหน้าที่ดูแลการสนทนาให้คุณอยู่ค่ะ กรุณารอสักครู่นะคะ';

const DEFAULT_PRODUCT_NAME_TH = 'แพ็กเกจ';

export function formatBangkokDateTime(isoDateTime: string | null) {
  if (!isoDateTime) {
    return '';
  }

  const date = new Date(isoDateTime);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));

  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')} ${byType.get('hour')}:${byType.get('minute')}`;
}

export function orderConfirmedNoticeTh(productName: string | null | undefined) {
  return `โรงพยาบาลยืนยันคำสั่งซื้อ ${productName || DEFAULT_PRODUCT_NAME_TH} แล้วค่ะ`;
}

export function orderBookedNoticeTh(
  productName: string | null | undefined,
  bookingAt: string | null | undefined,
  branchName?: string | null | undefined,
) {
  const when = formatBangkokDateTime(bookingAt ?? null);
  const branch = branchName ? ` สาขา ${branchName}` : '';

  return `ยืนยันการจอง ${productName || DEFAULT_PRODUCT_NAME_TH}${branch}${when ? ` วันที่ ${when}` : ''} เรียบร้อยค่ะ`;
}

export function orderSystemNoticeForStatus(
  status: 'awaiting_payment' | 'booked' | 'cancelled' | 'collecting_info' | 'confirmed' | 'done' | 'selecting_branch' | 'submitted',
  productName: string | null | undefined,
  bookingAt: string | null | undefined,
  branchName?: string | null | undefined,
) {
  if (status === 'submitted') {
    return ORDER_PAYMENT_SUBMITTED_NOTICE_TH;
  }

  if (status === 'confirmed') {
    return orderConfirmedNoticeTh(productName);
  }

  if (status === 'booked') {
    return orderBookedNoticeTh(productName, bookingAt, branchName);
  }

  return null;
}
