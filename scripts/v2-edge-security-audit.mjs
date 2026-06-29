import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();

const files = {
  adminLineReply: 'supabase/functions/admin-line-reply/index.ts',
  adminOrderAction: 'supabase/functions/admin-order-action/index.ts',
  chatOrchestrator: 'supabase/functions/chat-orchestrator/index.ts',
  db: 'supabase/functions/_shared/db.ts',
  factExtractor: 'supabase/functions/fact-extractor/index.ts',
  facts: 'supabase/functions/_shared/facts.ts',
  internalAuth: 'supabase/functions/_shared/internalAuth.ts',
  line: 'supabase/functions/_shared/line.ts',
  lineWebhook: 'supabase/functions/line-webhook/index.ts',
  orchestrate: 'supabase/functions/_shared/orchestrate.ts',
  orders: 'supabase/functions/_shared/orders.ts',
  referralBind: 'supabase/functions/referral-bind/index.ts',
  referralBindShared: 'supabase/functions/_shared/referralBind.ts',
  referralSelfProvision: 'supabase/functions/referral-self-provision/index.ts',
  referralSelfProvisionShared: 'supabase/functions/_shared/referralSelfProvision.ts',
  referrerOrder: 'supabase/functions/referrer-order/index.ts',
  stripe: 'supabase/functions/_shared/stripe.ts',
  stripeCheckout: 'supabase/functions/stripe-checkout/index.ts',
  stripePromptpayQr: 'supabase/functions/stripe-promptpay-qr/index.ts',
  stripeWebhook: 'supabase/functions/stripe-webhook/index.ts',
  storage: 'supabase/functions/_shared/storage.ts',
  systemNoticeMigration: 'supabase/migrations/20260611061000_a2_system_notice_single_source.sql',
  templates: 'supabase/functions/_shared/templates.ts',
};

const v2EdgeFunctions = {
  adminLineReply: files.adminLineReply,
  adminOrderAction: files.adminOrderAction,
  chatOrchestrator: files.chatOrchestrator,
  factExtractor: files.factExtractor,
  lineWebhook: files.lineWebhook,
  referralBind: files.referralBind,
  referralSelfProvision: files.referralSelfProvision,
  referrerOrder: files.referrerOrder,
  stripeCheckout: files.stripeCheckout,
  stripePromptpayQr: files.stripePromptpayQr,
  stripeWebhook: files.stripeWebhook,
};

async function read(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), 'utf8');
}

const sourceEntries = await Promise.all(
  Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)]),
);
const sources = Object.fromEntries(sourceEntries);
const violations = [];

async function listTsFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return listTsFiles(fullPath);
    }

    return entry.isFile() && entry.name.endsWith('.ts') ? [fullPath] : [];
  }));

  return nested.flat();
}

function expect(name, condition, detail) {
  if (!condition) {
    violations.push(`${name}: ${detail}`);
  }
}

const functionsRoot = path.join(repoRoot, 'supabase/functions');
const importSpecifiers = [
  /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /import\(\s*['"]([^'"]+)['"]\s*\)/g,
];
const edgeFiles = await listTsFiles(functionsRoot);

for (const filePath of edgeFiles) {
  const source = await fs.readFile(filePath, 'utf8');
  const relativeFile = path.relative(repoRoot, filePath).replace(/\\/g, '/');

  for (const pattern of importSpecifiers) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];

      if (!specifier.startsWith('.')) {
        continue;
      }

      const resolved = path.resolve(path.dirname(filePath), specifier);
      const relativeTarget = path.relative(functionsRoot, resolved);

      if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
        violations.push(`${relativeFile}: edge import escapes supabase/functions (${specifier})`);
      }
    }
  }
}

expect(
  'internal fact extractor auth',
  sources.internalAuth.includes('constantTimeEqual') &&
    sources.internalAuth.includes('Internal service-role authorization required.') &&
    sources.factExtractor.includes("import { assertInternalServiceRoleAuthorization } from '../_shared/internalAuth.ts'") &&
    sources.factExtractor.includes("assertInternalServiceRoleAuthorization(req.headers.get('authorization'))"),
  'fact-extractor must require the shared constant-time service-role guard before internal work',
);

expect(
  'internal function invocation auth',
  sources.db.includes('invokeInternalFunction') && sources.db.includes('Authorization: `Bearer ${serviceRoleKey}`'),
  'internal edge function calls must carry the service-role bearer token',
);

expect(
  'active order tenant scope',
  sources.orders.includes('loadActiveOrder(sessionId: string, tenantId: string)') &&
    sources.orders.includes('tenant_id: `eq.${tenantId}`'),
  'loadActiveOrder must require tenantId and include tenant_id in the REST filter',
);

expect(
  'order field write scope',
  sources.orders.includes('tenantId: string') &&
    sources.orders.includes('tenant_id: `eq.${scope.tenantId}`') &&
    sources.orders.includes('customer_id: `eq.${scope.customerId}`') &&
    sources.orders.includes('session_id: `eq.${scope.sessionId}`'),
  'updateOrderFields must scope writes by tenant and, when provided, customer/session',
);

expect(
  'chat order ownership validation',
  sources.orders.includes('assertOrderBelongsToSession') &&
    sources.orders.includes('order.customer_id !== scope.customerId') &&
    sources.orders.includes('order.session_id !== scope.sessionId') &&
    sources.orchestrate.includes('assertOrderBelongsToSession(existingOrder') &&
    sources.orchestrate.includes('tenantId: tenant.id'),
  'chat order actions must verify current tenant/session/customer before updating or submitting orders',
);

expect(
  'payment slip signed upload contract',
  sources.orchestrate.includes("type: z.literal('request_slip_upload')") &&
    sources.orchestrate.includes("createSignedUploadUrl('payment-slips', storagePath, 10 * 60)") &&
    sources.orchestrate.includes('assertPaymentSlipPathForOrder') &&
    sources.orders.includes('paymentSlipStoragePath') &&
    sources.storage.includes('createSignedUploadUrl') &&
    sources.storage.includes('/storage/v1/object/upload/sign/'),
  'chat slip upload action must validate ownership/path prefix and return a service-role signed payment-slips upload URL',
);

expect(
  'chat active order refresh contract',
  sources.orchestrate.includes("type: z.literal('refresh_order')") &&
    sources.orchestrate.includes('async function refreshActiveOrder') &&
    sources.orchestrate.includes('loadActiveOrder(session.id, tenant.id)') &&
    sources.orchestrate.includes("text: ''") &&
    sources.orchestrate.includes("request.action?.type === 'refresh_order'"),
  'refresh_order must rebuild the deterministic order panel without persisting a message or calling the model',
);

expect(
  'chat action response persistence',
    sources.orchestrate.includes('async function completeActionResponseTurn') &&
    sources.orchestrate.includes('ORDER_INFO_COMPLETE_NOTICE_TH') &&
    sources.templates.includes('ORDER_INFO_COMPLETE_NOTICE_TH') &&
    sources.orchestrate.includes('if (message.trim())') &&
    sources.orchestrate.includes('await persistUserMessage(session.id, clientMsgId, message)') &&
    sources.orchestrate.includes('await persistSystemNotice(session.id, actionResult.response.text, actionResult.response.cards)') &&
    sources.orchestrate.includes('await updateSessionAfterAssistant(session.id, tenant.id, actionResult.response.text)') &&
    !sources.orchestrate.includes('systemNoticePersisted'),
  'chat action responses that skip the model must persist non-empty user turns and exactly one TypeScript system notice with cards',
);

expect(
  'system notice single writer',
  !sources.systemNoticeMigration.includes('insert into public.chat_messages') &&
    !sources.systemNoticeMigration.includes('system_notice') &&
    sources.adminOrderAction.includes('await persistSystemNotice(notificationOrder.session_id, noticeText)') &&
    sources.adminOrderAction.includes('await pushLineMessages(tenant.slug, customer.line_user_id, [textLineMessage(noticeText)])') &&
    !sources.adminOrderAction.includes("selectOne<LatestNoticeRow>('chat_messages'"),
  'transition_order must not insert notices; admin-order-action must persist one notice and push the same text to LINE',
);

expect(
  'admin order tenant allow-list',
  sources.adminOrderAction.includes("selectMany<{ role: string; tenant_id: string }>('tenant_members'") &&
    sources.adminOrderAction.includes('tenant_id: `in.(${tenantFilter})`') &&
    sources.adminOrderAction.includes('tenant_id: `eq.${order.tenant_id}`'),
  'admin order actions must load orders through the authenticated staff member tenant allow-list',
);

expect(
  'admin payment slip signed read contract',
  sources.adminOrderAction.includes("action: z.enum(['confirm', 'book', 'done', 'cancel', 'note', 'slip_url'])") &&
    sources.adminOrderAction.includes("createSignedReadUrl('payment-slips', storagePath, 60 * 60)") &&
    sources.adminOrderAction.includes('normalizePaymentSlipPath') &&
    sources.storage.includes('createSignedReadUrl') &&
    sources.storage.includes('/storage/v1/object/sign/'),
  'admin slip thumbnails must be read through a tenant-authorized service-role signed URL action',
);

expect(
  'fact follow-up tenant filters',
  sources.factExtractor.includes('tenant_id: `eq.${session.tenant_id}`') &&
    sources.facts.includes('tenant_id: `eq.${tenantId}`'),
  'fact extraction follow-up reads and writes must include tenant filters after session ownership is known',
);

expect(
  'line signature timing-safe verify',
  sources.line.includes("crypto.subtle.verify('HMAC'") &&
    sources.line.includes("['verify']") &&
    sources.line.includes('base64ToBytes(signature)') &&
    !sources.line.includes('expected !== signature'),
  'LINE signature verification must use WebCrypto HMAC verify with decoded signature bytes, not string comparison',
);

expect(
  'assisted referrer direct credit',
  sources.referrerOrder.includes("channel: 'referrer'") &&
    sources.referrerOrder.includes('referrer_id: referrer.id') &&
    sources.referrerOrder.includes('referrer_id: `eq.${referrer.id}`'),
  'referrer assisted orders must credit the authenticated referrer directly and scope payment_done to that referrer',
);

expect(
  'referral self-provision member gate',
  sources.referralSelfProvision.includes('resolveAuthUser(req.headers.get') &&
    sources.referralSelfProvision.includes('assertTenant(body.tenant_slug)') &&
    sources.referralSelfProvision.includes('handleReferralSelfProvision') &&
    sources.referralSelfProvisionShared.includes("selectOne<TenantMemberRecord>('tenant_members'") &&
    sources.referralSelfProvisionShared.includes("selectOne<ReferrerRow>('referrers'") &&
    sources.referralSelfProvisionShared.includes("insertRow<ReferrerRow>('referrers'") &&
    sources.referralSelfProvisionShared.includes('Only tenant members can create their own referral code.') &&
    sources.referralSelfProvisionShared.includes("type: 'staff'") &&
    !sources.referralSelfProvisionShared.includes('commission_scheme:'),
  'referral-self-provision must require a Supabase JWT, enforce tenant membership, reuse existing referrers, and insert active staff referrers with DB default commission/code',
);

expect(
  'LINE PromptPay QR image reply',
  sources.lineWebhook.includes('QRCode.toDataURL(order.qr_payload') &&
    sources.lineWebhook.includes("uploadStorageObject('line-assets', `promptpay/${order.id}.png`, qrBytes, 'image/png')") &&
    sources.lineWebhook.includes('orderQrLineImageMessage(qrUrl)') &&
    sources.lineWebhook.includes('orderPaymentLineFlexMessage(order)') &&
    sources.line.includes('export function orderQrLineImageMessage') &&
    sources.line.includes("type: 'image'") &&
    sources.line.includes('originalContentUrl: qrUrl') &&
    sources.line.includes('previewImageUrl: qrUrl'),
  'LINE QR replies must render/upload PNG and send a LINE image message while keeping a payment postback action',
);

expect(
  'Stripe checkout authenticated order scope',
  sources.stripeCheckout.includes('resolveAuthUserId(req.headers.get') &&
    sources.stripeCheckout.includes('resolveOrCreateCustomer(tenant.id, authUserId)') &&
    sources.stripeCheckout.includes('customer_id: `eq.${customerId}`') &&
    sources.stripeCheckout.includes('session_id: `eq.${sessionId}`') &&
    sources.stripeCheckout.includes("order.status !== 'awaiting_payment'") &&
    sources.stripeCheckout.includes('createStripeCheckoutSession') &&
    sources.stripe.includes("requiredEnv('STRIPE_SECRET_KEY')") &&
    sources.stripe.includes("'Stripe-Version'"),
  'stripe-checkout must require a Supabase user, scope the order by tenant/customer/session, and create Checkout through the server-side Stripe secret',
);

expect(
  'Stripe webhook signed state transition',
  sources.stripeWebhook.includes('verifyStripeWebhookEvent(rawBody, req.headers.get') &&
    sources.stripeWebhook.includes('stripe-signature') &&
    sources.stripe.includes("requiredEnv('STRIPE_WEBHOOK_SECRET')") &&
    sources.stripe.includes('crypto.subtle.importKey') &&
    sources.stripeWebhook.includes("session.payment_status !== 'paid'") &&
    sources.stripeWebhook.includes('stripeMinorUnitsForBaht(order.amount_baht)') &&
    sources.stripeWebhook.includes("transition(order.id, 'submitted', 'system'") &&
    sources.stripeWebhook.includes('ORDER_PAYMENT_SUBMITTED_NOTICE_TH'),
  'stripe-webhook must verify the Stripe signature, validate paid THB amount, and move awaiting_payment orders through the shared transition path',
);

for (const [name] of Object.entries(v2EdgeFunctions)) {
  const source = sources[name];

  expect(
    `${name} standard envelope helpers`,
    source.includes('handleOptions') &&
      source.includes('json') &&
      source.includes('toErrorResponse') &&
      !source.includes('new Response('),
    'v2 edge functions must use shared CORS/envelope helpers instead of raw Response objects',
  );
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(violation);
  }
  process.exit(1);
}

console.log(`v2-edge-security-audit: PASS (${Object.keys(files).length} files scanned)`);
