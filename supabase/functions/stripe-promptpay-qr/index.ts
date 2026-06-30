import { assertTenant, insertRow, resolveAuthUser, resolveOrCreateCustomer, selectOne, updateRows } from '../_shared/db.ts';
import { handleOptions, HttpError, json, toErrorResponse, validateJson, z } from '../_shared/http.ts';
import { missingOrderFields, toOrderPanel, transition } from '../_shared/orders.ts';
import { createStripePromptPayPaymentIntent, retrieveStripePaymentIntent, stripeCheckoutBaseUrl, stripeMinorUnitsForBaht } from '../_shared/stripe.ts';
import { ORDER_PAYMENT_SUBMITTED_NOTICE_TH } from '../_shared/templates.ts';
import type { ChatMessageRow, OrderPanelState, OrderRow } from '../_shared/types.ts';

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

type Embedded<T> = T | T[] | null;

type PromptPayProduct = {
  active: boolean;
  catalog_key: string;
  category: string;
  description: string;
  image_url: string | null;
  name: string;
  price_baht: number;
  stripe_price_id: string | null;
};

type PromptPayOrderRow = OrderRow & {
  products?: Embedded<PromptPayProduct>;
};

type StripePromptPayQr = {
  data: string;
  hosted_instructions_url: string;
  image_url_png: string;
  image_url_svg: string;
};

type StripePromptPayQrResponse = {
  order: OrderPanelState;
  qr: StripePromptPayQr | null;
  status_checked_at: string;
  stripe_payment_intent_id: string;
  stripe_payment_status: string;
  submitted: boolean;
};

const stripePromptPayMinimumBaht = 10;

const requestSchema = z.object({
  action: z.enum(['create', 'status']).default('create'),
  order_id: z.string().uuid(),
  return_url_base: z.string().url().optional(),
  session_id: z.string().uuid().nullable().optional(),
  tenant_slug: z.string().regex(/^[a-z0-9-]{2,32}$/),
});

function embeddedOne<T>(value: Embedded<T>) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

function isLoopbackHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function paymentReturnBaseUrl(requestedBaseUrl?: string) {
  const fallbackBaseUrl = stripeCheckoutBaseUrl();

  if (!requestedBaseUrl) {
    return fallbackBaseUrl;
  }

  try {
    const requested = new URL(requestedBaseUrl);
    const fallback = new URL(fallbackBaseUrl);

    if (requested.origin === fallback.origin || isLoopbackHost(requested.hostname)) {
      return requested.origin;
    }
  } catch {
    throw new HttpError('VALIDATION', 'Invalid payment return URL.', 400);
  }

  throw new HttpError('VALIDATION', 'Payment return URL is not allowed.', 400);
}

async function persistSystemNotice(sessionId: string, text: string) {
  return insertRow<ChatMessageRow>(
    'chat_messages',
    {
      content: text,
      role: 'system_notice',
      session_id: sessionId,
    },
    {
      select: 'id,session_id,role,content,marker_product_ids,openai_response_id,client_msg_id,created_at',
    },
  );
}

async function updateSessionTimestamp(sessionId: string, tenantId: string) {
  await updateRows(
    'chat_sessions',
    {
      last_message_at: new Date().toISOString(),
    },
    {
      id: `eq.${sessionId}`,
      select: 'id',
      tenant_id: `eq.${tenantId}`,
    },
  );
}

async function loadOrder({
  customerId,
  orderId,
  sessionId,
  tenantId,
}: {
  customerId: string;
  orderId: string;
  sessionId?: string | null;
  tenantId: string;
}) {
  return selectOne<PromptPayOrderRow>('orders', {
    customer_id: `eq.${customerId}`,
    id: `eq.${orderId}`,
    select:
      'id,tenant_id,customer_id,session_id,product_id,qty,amount_baht,buyer_name,buyer_phone,preferred_branch,preferred_date,preferred_date_end,preferred_time_window,channel,referrer_id,commission_scheme_snapshot,status,slip_url,booking_at,branch_id,buyer_age,admin_note,created_at,updated_at,payment_provider,stripe_checkout_session_id,stripe_payment_intent_id,stripe_payment_status,paid_at,products(name,catalog_key,category,description,price_baht,image_url,active,stripe_price_id)',
    ...(sessionId ? { session_id: `eq.${sessionId}` } : {}),
    tenant_id: `eq.${tenantId}`,
  });
}

function assertOrderCanUseStripeQr(order: PromptPayOrderRow) {
  if (order.status !== 'awaiting_payment') {
    throw new HttpError('VALIDATION', 'Stripe PromptPay QR is available only after buyer details are complete.', 400);
  }

  if (order.amount_baht < stripePromptPayMinimumBaht) {
    throw new HttpError('VALIDATION', 'Stripe PromptPay QR ต้องมีขั้นต่ำ 10 บาท กรุณาใช้สินค้า test ราคา 10 บาทขึ้นไป', 400);
  }

  const missingFields = missingOrderFields(order);

  if (missingFields.length > 0) {
    throw new HttpError('VALIDATION', `Missing buyer fields: ${missingFields.join(', ')}.`, 400);
  }

  const product = embeddedOne(order.products ?? null);

  if (!product?.active) {
    throw new HttpError('VALIDATION', 'Product is not active for payment.', 400);
  }

  return product;
}

async function reloadOrderPanel(order: PromptPayOrderRow) {
  const rows = await updateRows<PromptPayOrderRow>(
    'orders',
    {
      updated_at: new Date().toISOString(),
    },
    {
      id: `eq.${order.id}`,
      select:
        'id,tenant_id,customer_id,session_id,product_id,qty,amount_baht,buyer_name,buyer_phone,preferred_branch,preferred_date,preferred_date_end,preferred_time_window,channel,referrer_id,commission_scheme_snapshot,status,slip_url,booking_at,branch_id,buyer_age,admin_note,created_at,updated_at,payment_provider,stripe_checkout_session_id,stripe_payment_intent_id,stripe_payment_status,paid_at,products(name,catalog_key,category,price_baht)',
      tenant_id: `eq.${order.tenant_id}`,
    },
  );

  return rows[0] ?? order;
}

async function updatePaymentFields(order: PromptPayOrderRow, stripePaymentIntentId: string, stripePaymentStatus: string, paid = false) {
  const rows = await updateRows<PromptPayOrderRow>(
    'orders',
    {
      ...(paid ? { paid_at: new Date().toISOString() } : {}),
      payment_provider: 'stripe',
      stripe_payment_intent_id: stripePaymentIntentId,
      stripe_payment_status: stripePaymentStatus,
      updated_at: new Date().toISOString(),
    },
    {
      id: `eq.${order.id}`,
      select:
        'id,tenant_id,customer_id,session_id,product_id,qty,amount_baht,buyer_name,buyer_phone,preferred_branch,preferred_date,preferred_date_end,preferred_time_window,channel,referrer_id,commission_scheme_snapshot,status,slip_url,booking_at,branch_id,buyer_age,admin_note,created_at,updated_at,payment_provider,stripe_checkout_session_id,stripe_payment_intent_id,stripe_payment_status,paid_at,products(name,catalog_key,category,price_baht)',
      tenant_id: `eq.${order.tenant_id}`,
    },
  );

  return rows[0] ?? order;
}

async function finalizeIfPaid(order: PromptPayOrderRow, stripePaymentIntentId: string, status: string) {
  let updatedOrder = await updatePaymentFields(order, stripePaymentIntentId, status, status === 'succeeded');

  if (status !== 'succeeded' || order.status !== 'awaiting_payment') {
    return {
      order: updatedOrder,
      submitted: false,
    };
  }

  const submittedOrder = await transition(order.id, 'submitted', 'system', {
    provider: 'stripe',
    stripe_payment_intent_id: stripePaymentIntentId,
    stripe_source: 'promptpay_qr_status_check',
  });

  updatedOrder = {
    ...updatedOrder,
    ...submittedOrder,
  };

  if (order.session_id && order.status !== submittedOrder.status) {
    await persistSystemNotice(order.session_id, ORDER_PAYMENT_SUBMITTED_NOTICE_TH);
    await updateSessionTimestamp(order.session_id, order.tenant_id);
  }

  return {
    order: updatedOrder,
    submitted: true,
  };
}

function assertStripePaymentIntentMatchesOrder(order: PromptPayOrderRow, amount: number, currency: string | null) {
  if ((currency ?? '').toLowerCase() !== 'thb') {
    throw new HttpError('VALIDATION', 'Stripe PromptPay currency does not match THB orders.', 400);
  }

  if (amount !== stripeMinorUnitsForBaht(order.amount_baht)) {
    throw new HttpError('VALIDATION', 'Stripe PromptPay amount does not match the order amount.', 400);
  }
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req);

  if (optionsResponse) {
    return optionsResponse;
  }

  if (req.method !== 'POST') {
    return toErrorResponse(new HttpError('VALIDATION', 'Method not allowed.', 405));
  }

  try {
    const body = await validateJson(req, requestSchema);
    const tenant = await assertTenant(body.tenant_slug);
    const authUser = await resolveAuthUser(req.headers.get('authorization'));
    const customer = await resolveOrCreateCustomer(tenant.id, authUser.id);
    const order = await loadOrder({
      customerId: customer.id,
      orderId: body.order_id,
      sessionId: body.session_id,
      tenantId: tenant.id,
    });

    if (!order) {
      throw new HttpError('VALIDATION', 'Order not found for this customer.', 404);
    }

    if (body.action === 'status') {
      if (!order.stripe_payment_intent_id) {
        throw new HttpError('VALIDATION', 'Order has no Stripe PromptPay payment intent yet.', 400);
      }

      const { paymentIntent, qr } = await retrieveStripePaymentIntent(order.stripe_payment_intent_id);
      assertStripePaymentIntentMatchesOrder(order, paymentIntent.amount, paymentIntent.currency);
      const finalized = await finalizeIfPaid(order, paymentIntent.id, paymentIntent.status);

      return json<StripePromptPayQrResponse>({
        order: toOrderPanel(finalized.order, tenant),
        qr,
        status_checked_at: new Date().toISOString(),
        stripe_payment_intent_id: paymentIntent.id,
        stripe_payment_status: paymentIntent.status,
        submitted: finalized.submitted,
      });
    }

    const product = assertOrderCanUseStripeQr(order);
    const baseUrl = paymentReturnBaseUrl(body.return_url_base);
    const returnUrl = `${baseUrl}/chat?payment=stripe_success&orderId=${encodeURIComponent(order.id)}`;
    const existingPaymentIntentId = order.stripe_payment_intent_id;
    const intentResult = existingPaymentIntentId
      ? await retrieveStripePaymentIntent(existingPaymentIntentId)
      : await createStripePromptPayPaymentIntent({
          amountBaht: order.amount_baht,
          buyerEmail: authUser.email ?? `payments+${order.id}@mira.care`,
          buyerName: order.buyer_name,
          buyerPhone: order.buyer_phone,
          metadata: {
            customer_id: customer.id,
            order_id: order.id,
            product_id: order.product_id,
            tenant_id: tenant.id,
            tenant_slug: tenant.slug,
          },
          orderId: order.id,
          productName: product.name,
          returnUrl,
        });

    assertStripePaymentIntentMatchesOrder(order, intentResult.paymentIntent.amount, intentResult.paymentIntent.currency);

    if (!intentResult.qr && intentResult.paymentIntent.status !== 'succeeded') {
      throw new HttpError('UPSTREAM', 'Stripe did not return a PromptPay QR code for this payment.', 502);
    }

    const updatedOrder = await updatePaymentFields(order, intentResult.paymentIntent.id, intentResult.paymentIntent.status);
    const finalized = await finalizeIfPaid(updatedOrder, intentResult.paymentIntent.id, intentResult.paymentIntent.status);
    const latestOrder = finalized.submitted ? finalized.order : await reloadOrderPanel(updatedOrder);

    return json<StripePromptPayQrResponse>({
      order: toOrderPanel(latestOrder, tenant),
      qr: intentResult.qr,
      status_checked_at: new Date().toISOString(),
      stripe_payment_intent_id: intentResult.paymentIntent.id,
      stripe_payment_status: intentResult.paymentIntent.status,
      submitted: finalized.submitted,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});
