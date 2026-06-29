import { assertTenant, resolveAuthUserId, resolveOrCreateCustomer, selectOne, updateRows } from '../_shared/db.ts';
import { handleOptions, HttpError, json, toErrorResponse, validateJson, z } from '../_shared/http.ts';
import { missingOrderFields, toOrderPanel } from '../_shared/orders.ts';
import { createStripeCheckoutSession, stripeCheckoutBaseUrl } from '../_shared/stripe.ts';
import type { OrderPanelState, OrderRow } from '../_shared/types.ts';

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

type Embedded<T> = T | T[] | null;

type CheckoutProduct = {
  active: boolean;
  catalog_key: string;
  category: string;
  description: string;
  image_url: string | null;
  name: string;
  price_baht: number;
  stripe_price_id: string | null;
};

type CheckoutOrderRow = OrderRow & {
  products?: Embedded<CheckoutProduct>;
};

type StripeCheckoutResponse = {
  checkout_url: string;
  order: OrderPanelState;
  stripe_checkout_session_id: string;
};

const requestSchema = z.object({
  order_id: z.string().uuid(),
  return_path: z.string().optional(),
  return_url_base: z.string().url().optional(),
  session_id: z.string().uuid().nullable().optional(),
  tenant_slug: z.string().regex(/^[a-z0-9-]{2,32}$/),
});

const allowedReturnPaths = new Set(['/chat', '/chatbot', '/prototype', '/orders', '/order-status']);

function embeddedOne<T>(value: Embedded<T>) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

function isLoopbackHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function checkoutReturnBaseUrl(requestedBaseUrl?: string) {
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
    throw new HttpError('VALIDATION', 'Invalid checkout return URL.', 400);
  }

  throw new HttpError('VALIDATION', 'Checkout return URL is not allowed.', 400);
}

function checkoutReturnPath(requestedPath?: string) {
  if (!requestedPath) {
    return '/chat';
  }

  if (!/^\/[A-Za-z0-9/_-]+$/.test(requestedPath) || !allowedReturnPaths.has(requestedPath)) {
    throw new HttpError('VALIDATION', 'Checkout return path is not allowed.', 400);
  }

  return requestedPath;
}

async function loadOrderForCheckout({
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
  return selectOne<CheckoutOrderRow>('orders', {
    customer_id: `eq.${customerId}`,
    id: `eq.${orderId}`,
    select:
      'id,tenant_id,customer_id,session_id,product_id,qty,amount_baht,buyer_name,buyer_phone,preferred_branch,preferred_date,preferred_date_end,preferred_time_window,channel,referrer_id,commission_scheme_snapshot,status,slip_url,booking_at,branch_id,buyer_age,admin_note,created_at,updated_at,payment_provider,stripe_checkout_session_id,stripe_payment_intent_id,stripe_payment_status,paid_at,products(name,catalog_key,category,description,price_baht,image_url,active,stripe_price_id)',
    ...(sessionId ? { session_id: `eq.${sessionId}` } : {}),
    tenant_id: `eq.${tenantId}`,
  });
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
    const authUserId = await resolveAuthUserId(req.headers.get('authorization'));
    const customer = await resolveOrCreateCustomer(tenant.id, authUserId);
    const order = await loadOrderForCheckout({
      customerId: customer.id,
      orderId: body.order_id,
      sessionId: body.session_id,
      tenantId: tenant.id,
    });

    if (!order) {
      throw new HttpError('VALIDATION', 'Order not found for this customer.', 404);
    }

    if (order.status !== 'awaiting_payment') {
      throw new HttpError('VALIDATION', 'Stripe checkout is available only after buyer details are complete.', 400);
    }

    const missingFields = missingOrderFields(order);

    if (missingFields.length > 0) {
      throw new HttpError('VALIDATION', `Missing buyer fields: ${missingFields.join(', ')}.`, 400);
    }

    const product = embeddedOne(order.products ?? null);

    if (!product?.active) {
      throw new HttpError('VALIDATION', 'Product is not active for checkout.', 400);
    }

    const baseUrl = checkoutReturnBaseUrl(body.return_url_base);
    const returnPath = checkoutReturnPath(body.return_path);
    const successUrl = `${baseUrl}${returnPath}?payment=stripe_success&orderId=${encodeURIComponent(order.id)}&stripeSessionId={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}${returnPath}?payment=stripe_cancelled&orderId=${encodeURIComponent(order.id)}`;
    const session = await createStripeCheckoutSession({
      amountBaht: order.amount_baht,
      cancelUrl,
      imageUrl: product.image_url,
      metadata: {
        customer_id: customer.id,
        order_id: order.id,
        product_id: order.product_id,
        tenant_id: tenant.id,
        tenant_slug: tenant.slug,
      },
      orderId: order.id,
      productDescription: product.description,
      productName: product.name,
      stripePriceId: product.stripe_price_id,
      successUrl,
    });

    if (!session.url) {
      throw new HttpError('UPSTREAM', 'Stripe did not return a checkout URL.', 502);
    }

    const updatedRows = await updateRows<CheckoutOrderRow>(
      'orders',
      {
        payment_provider: 'stripe',
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: session.payment_intent,
        stripe_payment_status: session.payment_status,
        updated_at: new Date().toISOString(),
      },
      {
        customer_id: `eq.${customer.id}`,
        id: `eq.${order.id}`,
        select:
          'id,tenant_id,customer_id,session_id,product_id,qty,amount_baht,buyer_name,buyer_phone,preferred_branch,preferred_date,preferred_date_end,preferred_time_window,channel,referrer_id,commission_scheme_snapshot,status,slip_url,booking_at,branch_id,buyer_age,admin_note,created_at,updated_at,payment_provider,stripe_checkout_session_id,stripe_payment_intent_id,stripe_payment_status,paid_at,products(name,catalog_key,category,price_baht)',
        tenant_id: `eq.${tenant.id}`,
      },
    );
    const updatedOrder = updatedRows[0] ?? order;

    return json<StripeCheckoutResponse>({
      checkout_url: session.url,
      order: toOrderPanel(updatedOrder, tenant),
      stripe_checkout_session_id: session.id,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});
