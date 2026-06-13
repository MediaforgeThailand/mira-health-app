import QRCode from 'qrcode';

import { assertTenant, selectOne } from '../_shared/db.ts';
import { recordFormAgeFact } from '../_shared/facts.ts';
import { HttpError, handleOptions, json, toErrorResponse } from '../_shared/http.ts';
import {
  orderPaymentLineFlexMessage,
  orderQrLineImageMessage,
  pushLineMessages,
  requireTenantEnv,
  textLineMessage,
  type LineMessage,
} from '../_shared/line.ts';
import {
  loadOrderForPanel,
  missingOrderFields,
  toOrderPanel,
  transition,
  updateOrderFields,
} from '../_shared/orders.ts';
import { uploadStorageObject } from '../_shared/storage.ts';
import type { CustomerRow } from '../_shared/types.ts';

declare const Deno: {
  env: { get: (key: string) => string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

const ORDER_INFO_DONE_NOTICE = 'กรอกข้อมูลเรียบร้อยค่ะ สแกน QR ด้านล่างเพื่อชำระเงินได้เลยนะคะ';

function defaultTenantSlug() {
  return Deno.env.get('MIRA_DEFAULT_TENANT_SLUG')?.trim() || 'demo-hospital';
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

// LIFF page (served to LINE's in-app browser). Reads ?order=<id> from the URL,
// initialises LIFF, collects buyer info fresh, and POSTs it back with the ID token.
function formHtml(tenantSlug: string, liffId: string) {
  const safeLiffId = liffId.replace(/[^A-Za-z0-9-]/g, '');
  const safeTenant = tenantSlug.replace(/[^a-z0-9-]/g, '');

  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<title>กรอกข้อมูลผู้รับบริการ</title>
<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", sans-serif; margin: 0; background: #F3F6F4; color: #163F34; }
  .wrap { max-width: 480px; margin: 0 auto; padding: 20px 16px 40px; }
  h1 { font-size: 18px; margin: 8px 0 4px; }
  p.sub { font-size: 13px; color: #4E5F59; margin: 0 0 16px; }
  label { display: block; font-size: 13px; font-weight: 700; margin: 14px 0 6px; }
  input { width: 100%; padding: 12px; font-size: 16px; border: 1px solid #C9D6D0; border-radius: 10px; background: #fff; }
  .err { color: #B42318; font-size: 12px; min-height: 16px; margin-top: 4px; }
  button { width: 100%; margin-top: 22px; padding: 14px; font-size: 16px; font-weight: 700; color: #fff; background: #163F34; border: 0; border-radius: 12px; }
  button:disabled { opacity: .5; }
  .ok { text-align: center; padding: 40px 0; font-size: 16px; }
</style>
</head>
<body>
<div class="wrap" id="app">
  <h1>กรอกข้อมูลผู้รับบริการ</h1>
  <p class="sub">กรอกข้อมูลของผู้ที่จะเข้ารับบริการ (กรอกใหม่ได้ทุกครั้ง หากซื้อให้ผู้อื่น)</p>
  <form id="f">
    <label>ชื่อ-นามสกุล</label>
    <input id="buyer_name" autocomplete="off" />
    <label>เบอร์โทร</label>
    <input id="buyer_phone" inputmode="numeric" placeholder="08XXXXXXXX" autocomplete="off" />
    <label>อายุ</label>
    <input id="buyer_age" inputmode="numeric" autocomplete="off" />
    <label>วันที่สะดวก (ไม่บังคับ)</label>
    <input id="preferred_date" type="date" />
    <div class="err" id="err"></div>
    <button type="submit" id="submit">ยืนยันและไปชำระเงิน</button>
  </form>
</div>
<script>
  var TENANT = ${JSON.stringify(safeTenant)};
  var LIFF_ID = ${JSON.stringify(safeLiffId)};
  var params = new URLSearchParams(location.search);
  var ORDER_ID = params.get('order') || '';
  var err = document.getElementById('err');
  function fail(m){ err.textContent = m; }
  async function main(){
    try {
      await liff.init({ liffId: LIFF_ID });
      if (!liff.isLoggedIn()) { liff.login(); return; }
    } catch (e) { fail('เปิดฟอร์มไม่สำเร็จ กรุณาลองใหม่'); return; }
    document.getElementById('f').addEventListener('submit', onSubmit);
  }
  async function onSubmit(ev){
    ev.preventDefault();
    fail('');
    var name = document.getElementById('buyer_name').value.trim();
    var phone = document.getElementById('buyer_phone').value.trim();
    var age = parseInt(document.getElementById('buyer_age').value.trim(), 10);
    var date = document.getElementById('preferred_date').value || null;
    if (!name) return fail('กรุณากรอกชื่อ-นามสกุล');
    if (!/^0[689]\\d{8}$/.test(phone)) return fail('เบอร์โทรไม่ถูกต้อง (ตัวอย่าง 0812345678)');
    if (!(age >= 1 && age <= 120)) return fail('กรุณากรอกอายุ 1-120');
    var btn = document.getElementById('submit'); btn.disabled = true;
    try {
      var idToken = liff.getIDToken();
      var res = await fetch(location.pathname + '?tenant=' + encodeURIComponent(TENANT), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: idToken, order_id: ORDER_ID, buyer_name: name, buyer_phone: phone, buyer_age: age, preferred_date: date })
      });
      if (!res.ok) { btn.disabled = false; return fail('ส่งข้อมูลไม่สำเร็จ กรุณาลองใหม่'); }
      document.getElementById('app').innerHTML = '<div class="ok">ส่งข้อมูลเรียบร้อย ✓<br/>กลับไปที่แชตเพื่อชำระเงินได้เลยค่ะ</div>';
      setTimeout(function(){ try { liff.closeWindow(); } catch (e) {} }, 1200);
    } catch (e) { btn.disabled = false; fail('ส่งข้อมูลไม่สำเร็จ กรุณาลองใหม่'); }
  }
  main();
</script>
</body>
</html>`;
}

// Verify the LIFF ID token with LINE and return the authenticated LINE user id.
async function verifyLineIdToken(idToken: string, tenantSlug: string): Promise<string> {
  const channelId = requireTenantEnv('LINE_LIFF_CHANNEL_ID', tenantSlug);
  const response = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    body: new URLSearchParams({ client_id: channelId, id_token: idToken }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });

  if (!response.ok) {
    throw new HttpError('VALIDATION', 'Invalid LINE identity token.', 401);
  }

  const payload = (await response.json()) as { aud?: string; sub?: string };

  if (payload.aud !== channelId || !payload.sub) {
    throw new HttpError('VALIDATION', 'LINE identity token did not match this channel.', 401);
  }

  return payload.sub;
}

type SubmitBody = {
  buyer_age?: unknown;
  buyer_name?: unknown;
  buyer_phone?: unknown;
  id_token?: unknown;
  order_id?: unknown;
  preferred_date?: unknown;
};

async function handleSubmit(req: Request, tenantSlug: string) {
  const body = (await req.json()) as SubmitBody;
  const idToken = typeof body.id_token === 'string' ? body.id_token : '';
  const orderId = typeof body.order_id === 'string' ? body.order_id : '';
  const buyerName = typeof body.buyer_name === 'string' ? body.buyer_name.trim() : '';
  const buyerPhone = typeof body.buyer_phone === 'string' ? body.buyer_phone.trim() : '';
  const buyerAge = typeof body.buyer_age === 'number' ? body.buyer_age : Number(body.buyer_age);
  const preferredDate =
    typeof body.preferred_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.preferred_date)
      ? body.preferred_date
      : undefined;

  if (!idToken || !orderId) {
    throw new HttpError('VALIDATION', 'Missing identity token or order.', 400);
  }

  if (!buyerName || !/^0[689]\d{8}$/.test(buyerPhone) || !Number.isInteger(buyerAge) || buyerAge < 1 || buyerAge > 120) {
    throw new HttpError('VALIDATION', 'Buyer information is invalid.', 400);
  }

  const tenant = await assertTenant(tenantSlug);
  const lineUserId = await verifyLineIdToken(idToken, tenantSlug);
  const customer = await selectOne<CustomerRow>('customers', {
    line_user_id: `eq.${lineUserId}`,
    select: 'id,tenant_id,auth_user_id,line_user_id,nickname,phone,referred_by,referred_at,created_at',
    tenant_id: `eq.${tenant.id}`,
  });

  if (!customer) {
    throw new HttpError('VALIDATION', 'Customer not found for this LINE account.', 404);
  }

  const existing = await loadOrderForPanel(orderId, tenant.id);

  if (!existing || existing.customer_id !== customer.id) {
    throw new HttpError('VALIDATION', 'Order not found for this customer.', 404);
  }

  if (existing.status !== 'collecting_info') {
    throw new HttpError('VALIDATION', 'This order is not waiting for buyer information.', 400);
  }

  await updateOrderFields(orderId, { customerId: customer.id, tenantId: tenant.id }, {
    buyer_age: buyerAge,
    buyer_name: buyerName,
    buyer_phone: buyerPhone,
    preferred_date: preferredDate,
  });

  try {
    await recordFormAgeFact({ age: buyerAge, customerId: customer.id, orderId, tenantId: tenant.id });
  } catch (error) {
    console.warn('form_age_fact_failed', error);
  }

  const filled = await loadOrderForPanel(orderId, tenant.id);

  if (filled && missingOrderFields(filled).length === 0) {
    await transition(orderId, 'awaiting_payment', 'customer', { reason: 'buyer_info_complete' });
  }

  const finalOrder = await loadOrderForPanel(orderId, tenant.id);
  const panel = toOrderPanel(finalOrder, tenant);

  if (panel?.qr_payload) {
    await pushOrderQr(panel, tenant.slug, lineUserId);
  }

  return json({ ok: true });
}

async function pushOrderQr(panel: NonNullable<ReturnType<typeof toOrderPanel>>, tenantSlug: string, lineUserId: string) {
  if (!panel.qr_payload) {
    return;
  }

  const dataUrl = await QRCode.toDataURL(panel.qr_payload, { margin: 1, scale: 8, type: 'image/png' });
  const qrBytes = base64ToBytes(dataUrl.split(',')[1] ?? '');
  const qrUrl = await uploadStorageObject('line-assets', `promptpay/${panel.id}.png`, qrBytes, 'image/png');
  const messages: LineMessage[] = [
    textLineMessage(ORDER_INFO_DONE_NOTICE),
    orderQrLineImageMessage(qrUrl),
    orderPaymentLineFlexMessage(panel),
  ];

  await pushLineMessages(tenantSlug, lineUserId, messages);
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req);

  if (optionsResponse) {
    return optionsResponse;
  }

  const tenantSlug = new URL(req.url).searchParams.get('tenant') ?? defaultTenantSlug();

  try {
    if (req.method === 'GET') {
      const liffId = requireTenantEnv('LINE_LIFF_ID', tenantSlug);

      return new Response(formHtml(tenantSlug, liffId), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (req.method === 'POST') {
      return await handleSubmit(req, tenantSlug);
    }

    return toErrorResponse(new HttpError('VALIDATION', 'Method not allowed.', 405));
  } catch (error) {
    return toErrorResponse(error);
  }
});
