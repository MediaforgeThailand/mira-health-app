import { assertTenant, insertRow, resolveAuthUserId, selectOne, updateRows } from '../_shared/db.ts';
import { activeBranchesForProduct, resolveProductBranchSelection } from '../_shared/branches.ts';
import { recordFormAgeFact } from '../_shared/facts.ts';
import { HttpError, handleOptions, json, toErrorResponse, validateJson } from '../_shared/http.ts';
import { loadOrderForPanel, toOrderPanel, transition } from '../_shared/orders.ts';
import { referrerOrderRequestSchema } from '../_shared/referrerOrder.ts';
import type {
  CustomerRow,
  OrderRow,
  ProductSummary,
  ReferrerOrderRequest,
  ReferrerRow,
} from '../_shared/types.ts';

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

async function loadReferrer(tenantId: string, authUserId: string) {
  const referrer = await selectOne<ReferrerRow>('referrers', {
    active: 'eq.true',
    auth_user_id: `eq.${authUserId}`,
    select: 'id,tenant_id,ref_code,name,type,phone,auth_user_id,commission_scheme,active,created_at',
    tenant_id: `eq.${tenantId}`,
  });

  if (!referrer) {
    throw new HttpError('VALIDATION', 'No active referrer profile is linked to this account.', 403);
  }

  return referrer;
}

async function productByCatalogKey(tenantId: string, catalogKey: string) {
  return selectOne<ProductSummary>('products', {
    active: 'eq.true',
    catalog_key: `eq.${catalogKey}`,
    select: 'id,tenant_id,catalog_key,name,description,price_baht,category,image_url,branch_info,requires_appointment,active',
    tenant_id: `eq.${tenantId}`,
  });
}

async function resolveOrCreateBuyer(tenantId: string, buyerName: string, buyerPhone: string) {
  const existing = await selectOne<CustomerRow>('customers', {
    order: 'created_at.asc',
    phone: `eq.${buyerPhone}`,
    select: 'id,tenant_id,auth_user_id,line_user_id,nickname,phone,referred_by,referred_at,created_at',
    tenant_id: `eq.${tenantId}`,
  });

  if (existing) {
    if (!existing.nickname) {
      const rows = await updateRows<CustomerRow>(
        'customers',
        {
          nickname: buyerName,
        },
        {
          id: `eq.${existing.id}`,
          select: 'id,tenant_id,auth_user_id,line_user_id,nickname,phone,referred_by,referred_at,created_at',
          tenant_id: `eq.${tenantId}`,
        },
      );

      return rows[0] ?? existing;
    }

    return existing;
  }

  return insertRow<CustomerRow>('customers', {
    nickname: buyerName,
    phone: buyerPhone,
    tenant_id: tenantId,
  }, {
    select: 'id,tenant_id,auth_user_id,line_user_id,nickname,phone,referred_by,referred_at,created_at',
  });
}

async function createReferrerOrder(body: Extract<ReferrerOrderRequest, { action: 'create_order' }>, referrer: ReferrerRow) {
  const product = await productByCatalogKey(referrer.tenant_id, body.catalog_key);

  if (!product) {
    throw new HttpError('VALIDATION', 'Product not found.', 404);
  }

  const branches = await activeBranchesForProduct(referrer.tenant_id, product.id);
  const branch = resolveProductBranchSelection(branches, body.branch_id);
  const customer = await resolveOrCreateBuyer(referrer.tenant_id, body.buyer_name, body.buyer_phone);
  const order = await insertRow<OrderRow>('orders', {
    amount_baht: product.price_baht,
    branch_id: branch?.id ?? null,
    buyer_age: body.buyer_age,
    buyer_name: body.buyer_name,
    buyer_phone: body.buyer_phone,
    channel: 'referrer',
    commission_scheme_snapshot: referrer.commission_scheme,
    customer_id: customer.id,
    preferred_date: body.preferred_date ?? null,
    product_id: product.id,
    qty: 1,
    referrer_id: referrer.id,
    tenant_id: referrer.tenant_id,
  }, {
    select:
      'id,tenant_id,customer_id,session_id,product_id,qty,amount_baht,buyer_name,buyer_phone,preferred_branch,preferred_date,channel,referrer_id,commission_scheme_snapshot,status,slip_url,booking_at,branch_id,buyer_age,admin_note,created_at,updated_at',
  });

  try {
    await recordFormAgeFact({
      age: body.buyer_age,
      customerId: customer.id,
      orderId: order.id,
      tenantId: referrer.tenant_id,
    });
  } catch (error) {
    console.warn('form_age_fact_failed', error instanceof Error ? error.message : error);
  }

  await transition(order.id, 'awaiting_payment', `referrer:${referrer.id}`, { channel: 'referrer' });

  return loadOrderForPanel(order.id, referrer.tenant_id);
}

async function listProductBranches(body: Extract<ReferrerOrderRequest, { action: 'list_branches' }>, referrer: ReferrerRow) {
  const product = await productByCatalogKey(referrer.tenant_id, body.catalog_key);

  if (!product) {
    throw new HttpError('VALIDATION', 'Product not found.', 404);
  }

  return activeBranchesForProduct(referrer.tenant_id, product.id);
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
    const body = await validateJson(req, referrerOrderRequestSchema);
    const tenant = await assertTenant(body.tenant_slug);
    const authUserId = await resolveAuthUserId(req.headers.get('authorization'));
    const referrer = await loadReferrer(tenant.id, authUserId);

    if (body.action === 'create_order') {
      const order = await createReferrerOrder(body, referrer);

      return json({
        order: toOrderPanel(order, tenant),
        referrer: {
          id: referrer.id,
          name: referrer.name,
          ref_code: referrer.ref_code,
        },
      });
    }

    if (body.action === 'list_branches') {
      return json({
        branches: await listProductBranches(body, referrer),
      });
    }

    const order = await selectOne<OrderRow>('orders', {
      id: `eq.${body.order_id}`,
      referrer_id: `eq.${referrer.id}`,
      select:
        'id,tenant_id,customer_id,session_id,product_id,qty,amount_baht,buyer_name,buyer_phone,preferred_branch,preferred_date,channel,referrer_id,commission_scheme_snapshot,status,slip_url,booking_at,branch_id,buyer_age,admin_note,created_at,updated_at',
      tenant_id: `eq.${tenant.id}`,
    });

    if (!order) {
      throw new HttpError('VALIDATION', 'Order not found for this referrer.', 404);
    }

    await updateRows<OrderRow>(
      'orders',
      {
        payment_provider: 'promptpay',
        updated_at: new Date().toISOString(),
      },
      {
        id: `eq.${order.id}`,
        select:
          'id,tenant_id,customer_id,session_id,product_id,qty,amount_baht,buyer_name,buyer_phone,preferred_branch,preferred_date,channel,referrer_id,commission_scheme_snapshot,status,slip_url,booking_at,branch_id,buyer_age,admin_note,created_at,updated_at,payment_provider,stripe_checkout_session_id,stripe_payment_intent_id,stripe_payment_status,paid_at',
        tenant_id: `eq.${tenant.id}`,
      },
    );

    const updated = await transition(order.id, 'submitted', `referrer:${referrer.id}`, { channel: 'referrer' });

    return json({
      order: toOrderPanel(await loadOrderForPanel(updated.id, tenant.id), tenant),
      referrer: {
        id: referrer.id,
        name: referrer.name,
        ref_code: referrer.ref_code,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});
