import { activeBranchesForProduct, activeBranchForProduct } from './branches.ts';
import { buildCatalogJson, buildPersonalContext, buildRecentChat, inferIntentCategory } from './context.ts';
import {
  assertTenant,
  insertRow,
  invokeInternalFunction,
  resolveAuthUserId,
  resolveOrCreateCustomer,
  selectMany,
  selectOne,
  updateRows,
  upsertRow,
} from './db.ts';
import { recordFormAgeFact } from './facts.ts';
import { HttpError, z } from './http.ts';
import { fetchLineProfile } from './line.ts';
import { filterKnownProductMarkerKeys, parseChatMarker } from './marker.ts';
import {
  assertOrderBelongsToSession,
  assertPaymentSlipPathForOrder,
  formatOrderContextLines,
  loadActiveOrder,
  loadOrderForPanel,
  missingOrderFields,
  ORDER_WITH_PRODUCT_SELECT,
  PAYMENT_WINDOW_MS,
  paymentSlipStoragePath,
  toOrderPanel,
  transition,
  updateOrderFields,
} from './orders.ts';
import { callMiraPrompt, callOrderFieldExtractor } from './openai.ts';
import { applyReferralCodeToCustomer, resolveAttributedReferrerId } from './referrals.ts';
import { createSignedUploadUrl } from './storage.ts';
import { AGENT_HANDOVER_NOTICE_TH, ORDER_INFO_COMPLETE_NOTICE_TH, ORDER_PAYMENT_SUBMITTED_NOTICE_TH } from './templates.ts';
import type {
  ChatMessageRow,
  ChatCard,
  ChatCategory,
  ChatOrchestratorRequest,
  ChatOrchestratorResponse,
  ChatSlipUploadResponse,
  ChatProduct,
  ChatSessionRow,
  CustomerRow,
  OrderRow,
  OrderWithProductRow,
  ProductCategoryRow,
  ProductSummary,
  OrderStatusInfo,
  ReferrerRow,
  TenantRow,
} from './types.ts';

const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('consent_granted'),
  }),
  z.object({
    catalog_key: z.string().min(1),
    type: z.literal('select_product'),
  }),
  z.object({
    branch_id: z.string().uuid(),
    order_id: z.string().uuid(),
    type: z.literal('select_branch'),
  }),
  z.object({
    buyer_age: z.number().int().min(1).max(120),
    buyer_name: z.string().min(1),
    buyer_phone: z.string().regex(/^0[689]\d{8}$/),
    order_id: z.string().uuid(),
    preferred_date: z.string().optional(),
    preferred_date_end: z.string().optional(),
    preferred_time_window: z.string().min(1).max(120).optional(),
    type: z.literal('order_form_submit'),
  }),
  z.object({
    order_id: z.string().uuid(),
    preferred_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    preferred_date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    preferred_time_window: z.string().min(1).max(120).optional(),
    type: z.literal('set_booking_window'),
  }),
  z.object({
    order_id: z.string().uuid(),
    slip_path: z.string().optional(),
    type: z.literal('payment_done'),
  }),
  z.object({
    content_type: z.enum(['image/jpeg', 'image/png']),
    order_id: z.string().uuid(),
    type: z.literal('request_slip_upload'),
  }),
  z.object({
    type: z.literal('refresh_order'),
  }),
  z.object({
    type: z.literal('browse_categories'),
  }),
  z.object({
    category: z.string().min(1).max(80),
    limit: z.number().int().min(1).max(24).optional(),
    offset: z.number().int().min(0).max(500).optional(),
    type: z.literal('browse_category'),
  }),
  z.object({
    type: z.literal('get_order_status'),
  }),
]);

export const chatRequestSchema = z.object({
  action: actionSchema.nullable(),
  channel: z.enum(['app', 'pwa', 'line']),
  client_msg_id: z.string().uuid(),
  message: z.string().trim(),
  ref_code: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{6}$/).optional(),
  session_id: z.string().uuid().nullable(),
  tenant_slug: z.string().regex(/^[a-z0-9-]{2,32}$/),
});

const CHAT_MESSAGE_SELECT = 'id,session_id,role,content,marker_product_ids,cards,openai_response_id,client_msg_id,created_at';
const ORDER_PANEL_SELECT = ORDER_WITH_PRODUCT_SELECT;
const CATEGORY_FALLBACK_LABELS: Record<string, { icon: string | null; label_th: string; sort: number }> = {
  checkup: { icon: '🩺', label_th: 'ตรวจสุขภาพ', sort: 10 },
  vaccine: { icon: '💉', label_th: 'วัคซีน', sort: 20 },
  general: { icon: '✨', label_th: 'บริการทั่วไป', sort: 30 },
};

function nowIso() {
  return new Date().toISOString();
}

async function resolveOrCreateSession({
  channel,
  customer,
  sessionId,
  tenant,
}: {
  channel: 'app' | 'line' | 'pwa';
  customer: CustomerRow;
  sessionId: string | null;
  tenant: TenantRow;
}) {
  if (sessionId) {
    const session = await selectOne<ChatSessionRow>('chat_sessions', {
      customer_id: `eq.${customer.id}`,
      id: `eq.${sessionId}`,
      select: 'id,tenant_id,customer_id,channel,flagged,agent_mode,last_message_at,created_at',
      tenant_id: `eq.${tenant.id}`,
    });

    if (!session) {
      throw new HttpError('VALIDATION', 'Chat session not found for this customer.', 404);
    }

    return session;
  }

  return insertRow<ChatSessionRow>('chat_sessions', {
    channel,
    customer_id: customer.id,
    last_message_at: nowIso(),
    tenant_id: tenant.id,
  }, {
    select: 'id,tenant_id,customer_id,channel,flagged,agent_mode,last_message_at,created_at',
  });
}
type ActionResult = {
  order?: OrderWithProductRow | null;
  response?: ChatOrchestratorResponse;
};

async function productByCatalogKey(tenantId: string, catalogKey: string) {
  return selectOne<ProductSummary>('products', {
    active: 'eq.true',
    catalog_key: `eq.${catalogKey}`,
    select: 'id,tenant_id,catalog_key,name,description,price_baht,category,image_url,branch_info,requires_appointment,active',
    tenant_id: `eq.${tenantId}`,
  });
}

async function createOrderFromProduct({
  channel,
  customer,
  product,
  sessionId,
  tenant,
}: {
  channel: 'app' | 'line' | 'pwa';
  customer: CustomerRow;
  product: ProductSummary;
  sessionId: string;
  tenant: TenantRow;
}) {
  const referrerId = resolveAttributedReferrerId(customer, tenant);
  const referrer = referrerId
    ? await selectOne<Pick<ReferrerRow, 'commission_scheme'>>('referrers', {
      id: `eq.${referrerId}`,
      select: 'commission_scheme',
      tenant_id: `eq.${tenant.id}`,
    })
    : null;
  const branches = await activeBranchesForProduct(tenant.id, product.id);
  const singleBranch = branches.length === 1 ? branches[0] : null;
  const isLine = channel === 'line';
  // V3-7 (LINE): always force an explicit branch choice (even a single-branch
  // product) and never auto-fill the buyer phone from the account — the buyer may
  // be someone other than the LINE account holder. App/PWA behaviour is unchanged.
  const order = await insertRow<OrderRow>('orders', {
    amount_baht: product.price_baht,
    branch_id: isLine ? null : (singleBranch?.id ?? null),
    buyer_phone: isLine ? null : customer.phone,
    channel: channel === 'app' ? 'chat_app' : channel === 'line' ? 'chat_line' : 'chat_pwa',
    commission_scheme_snapshot: referrer?.commission_scheme ?? null,
    customer_id: customer.id,
    product_id: product.id,
    qty: 1,
    referrer_id: referrerId,
    session_id: sessionId,
    status: (isLine ? branches.length >= 1 : branches.length > 1) ? 'selecting_branch' : 'collecting_info',
    tenant_id: tenant.id,
  }, {
    select: ORDER_PANEL_SELECT,
  });

  return loadOrderForPanel(order.id, tenant.id);
}

async function maybeAdvanceCollectingOrder(order: OrderWithProductRow | null, actor: 'ai' | 'customer' = 'ai') {
  if (!order || order.status !== 'collecting_info' || missingOrderFields(order).length > 0) {
    return order;
  }

  await transition(order.id, 'awaiting_payment', actor, { reason: 'buyer_info_complete' });

  return loadOrderForPanel(order.id, order.tenant_id);
}

async function orderPanelFor(order: OrderWithProductRow | null, tenant: TenantRow) {
  const branches = order?.status === 'selecting_branch'
    ? await activeBranchesForProduct(tenant.id, order.product_id)
    : [];

  return toOrderPanel(order, tenant, branches);
}

async function createSlipUpload({
  action,
  customer,
  sessionId,
  tenant,
}: {
  action: Extract<ChatOrchestratorRequest['action'], { type: 'request_slip_upload' }>;
  customer: CustomerRow;
  sessionId: string;
  tenant: TenantRow;
}): Promise<ChatSlipUploadResponse> {
  const existingOrder = await loadOrderForPanel(action.order_id, tenant.id);
  assertOrderBelongsToSession(existingOrder, {
    customerId: customer.id,
    sessionId,
  });

  const storagePath = paymentSlipStoragePath({
    contentType: action.content_type,
    orderId: action.order_id,
    tenantId: tenant.id,
  });
  const uploadUrl = await createSignedUploadUrl('payment-slips', storagePath, 10 * 60);

  return {
    storage_path: storagePath,
    upload_url: uploadUrl,
  };
}

// Auto-expire an unpaid order once its 10-minute payment window lapses (measured from
// when it entered awaiting_payment = its updated_at). Cancels via the sanctioned
// transition path so the customer is unblocked to book again and the QR stops being
// re-shown. Best-effort: a failed cancel just leaves the order as-is for this turn.
async function expireOverduePayment(
  order: OrderWithProductRow | null,
  tenant: TenantRow,
): Promise<OrderWithProductRow | null> {
  if (!order || order.status !== 'awaiting_payment') {
    return order;
  }

  const issuedAt = new Date(order.updated_at).getTime();

  if (Number.isNaN(issuedAt) || Date.now() - issuedAt < PAYMENT_WINDOW_MS) {
    return order;
  }

  try {
    await transition(order.id, 'cancelled', 'customer');
    console.warn('payment_expired_cancelled', { orderId: order.id, tenantId: tenant.id });

    return null;
  } catch (error) {
    console.warn('payment_expiry_cancel_failed', error instanceof Error ? error.message : error);

    return order;
  }
}

async function refreshActiveOrder(session: ChatSessionRow, tenant: TenantRow): Promise<ChatOrchestratorResponse> {
  const order = await expireOverduePayment(await loadActiveOrder(session.id, tenant.id), tenant);

  return {
    cards: [],
    order: await orderPanelFor(order, tenant),
    products: [],
    session_id: session.id,
    text: '',
  };
}

async function enforceCheapActionRateLimit(customerId: string) {
  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const rows = await selectMany<{ id: string }>('chat_messages', {
    created_at: `gte.${since}`,
    limit: '61',
    role: 'eq.user',
    select: 'id,chat_sessions!inner(customer_id)',
    'chat_sessions.customer_id': `eq.${customerId}`,
  });

  if (rows.length >= 60) {
    throw new HttpError('RATE_LIMITED', 'Too many actions. Please wait a moment.', 429);
  }
}

async function handleAction({
  action,
  channel,
  customer,
  sessionId,
  tenant,
}: {
  action: ChatOrchestratorRequest['action'];
  channel: 'app' | 'line' | 'pwa';
  customer: CustomerRow;
  sessionId: string;
  tenant: TenantRow;
}): Promise<ActionResult> {
  if (!action) {
    return {};
  }

  if (action.type === 'consent_granted') {
    await insertRow('consents', {
      customer_id: customer.id,
      granted: true,
      kind: 'health_data_collection',
      tenant_id: tenant.id,
    });
    return {};
  }

  if (action.type === 'select_product') {
    const product = await productByCatalogKey(tenant.id, action.catalog_key);

    if (!product) {
      throw new HttpError('VALIDATION', 'Product not found.', 404);
    }

    // Dedup guard (V3-5): a LINE postback can be re-delivered or double-tapped.
    // If an active pre-payment order for the same product already exists in this
    // session, reuse it instead of inserting a duplicate. Never changes status.
    if (channel === 'line') {
      const existing = await loadActiveOrder(sessionId, tenant.id);

      if (
        existing &&
        existing.product_id === product.id &&
        ['selecting_branch', 'collecting_info', 'awaiting_payment'].includes(existing.status)
      ) {
        return { order: await loadOrderForPanel(existing.id, tenant.id) };
      }
    }

    return {
      order: await createOrderFromProduct({
        channel,
        customer,
        product,
        sessionId,
        tenant,
      }),
    };
  }

  if (action.type === 'select_branch') {
    const existingOrder = await loadOrderForPanel(action.order_id, tenant.id);

    assertOrderBelongsToSession(existingOrder, {
      customerId: customer.id,
      sessionId,
    });

    if (existingOrder?.status !== 'selecting_branch') {
      throw new HttpError('VALIDATION', 'This order is not waiting for branch selection.', 400);
    }

    const branch = await activeBranchForProduct(tenant.id, existingOrder.product_id, action.branch_id);

    if (!branch) {
      throw new HttpError('VALIDATION', 'Branch is not available for this product.', 400);
    }

    await updateRows<OrderRow>('orders', {
      branch_id: branch.id,
      updated_at: nowIso(),
    }, {
      customer_id: `eq.${customer.id}`,
      id: `eq.${action.order_id}`,
      select: ORDER_PANEL_SELECT,
      session_id: `eq.${sessionId}`,
      tenant_id: `eq.${tenant.id}`,
    });

    const order = await transition(action.order_id, 'collecting_info', 'customer', { branch_id: branch.id });
    const loaded = await loadOrderForPanel(order.id, tenant.id);

    // V3-7 (LINE): don't short-circuit with a canned line — return the order so the
    // turn runs through the model and Mira asks for the buyer info conversationally.
    if (channel === 'line') {
      return { order: loaded };
    }

    return {
      response: {
        order: await orderPanelFor(loaded, tenant),
        cards: [],
        products: [],
        session_id: sessionId,
        text: 'เลือกสาขาเรียบร้อยค่ะ',
      },
    };
  }

  if (action.type === 'order_form_submit') {
    const existingOrder = await loadOrderForPanel(action.order_id, tenant.id);

    assertOrderBelongsToSession(existingOrder, {
      customerId: customer.id,
      sessionId,
    });

    if (existingOrder?.status !== 'collecting_info') {
      throw new HttpError('VALIDATION', 'This order is not waiting for buyer information.', 400);
    }

    const order = await updateOrderFields(action.order_id, {
      customerId: customer.id,
      sessionId,
      tenantId: tenant.id,
    }, {
      buyer_age: action.buyer_age,
      buyer_name: action.buyer_name,
      buyer_phone: action.buyer_phone,
      preferred_date: action.preferred_date,
      preferred_date_end: action.preferred_date_end,
      preferred_time_window: action.preferred_time_window,
    });

    // F1 (v3 plan §11.3): persist the form-collected age as a consent-gated user_fact.
    // A facts failure must never fail the order submit.
    if (typeof action.buyer_age === 'number') {
      try {
        await recordFormAgeFact({
          age: action.buyer_age,
          customerId: customer.id,
          orderId: action.order_id,
          tenantId: tenant.id,
        });
      } catch (error) {
        console.warn('form_age_fact_failed', error);
      }
    }

    const loaded = await maybeAdvanceCollectingOrder(await loadOrderForPanel(order.id, tenant.id), 'customer');

    return {
      response: {
        order: await orderPanelFor(loaded ?? null, tenant),
        cards: [],
        products: [],
        session_id: sessionId,
        text: ORDER_INFO_COMPLETE_NOTICE_TH,
      },
    };
  }

  if (action.type === 'set_booking_window') {
    const existingOrder = await loadOrderForPanel(action.order_id, tenant.id);

    assertOrderBelongsToSession(existingOrder, {
      customerId: customer.id,
      sessionId,
    });

    if (existingOrder?.status !== 'collecting_info') {
      throw new HttpError('VALIDATION', 'This order is not waiting for buyer information.', 400);
    }

    await updateOrderFields(action.order_id, {
      customerId: customer.id,
      sessionId,
      tenantId: tenant.id,
    }, {
      preferred_date: action.preferred_date,
      preferred_date_end: action.preferred_date_end,
      preferred_time_window: action.preferred_time_window,
    });

    // Return the order (no canned line) so the turn runs through the model and
    // Mira acknowledges the chosen window and keeps collecting the rest. The QR is
    // still gated by the confirm step — the date window is additive, never a blocker.
    return { order: await loadOrderForPanel(action.order_id, tenant.id) };
  }

  if (action.type === 'payment_done') {
    const existingOrder = await loadOrderForPanel(action.order_id, tenant.id);

    assertOrderBelongsToSession(existingOrder, {
      customerId: customer.id,
      sessionId,
    });

    await updateRows<OrderRow>(
      'orders',
      {
        payment_provider: 'promptpay',
        ...(action.slip_path
          ? {
            slip_url: assertPaymentSlipPathForOrder({
              orderId: action.order_id,
              slipPath: action.slip_path,
              tenantId: tenant.id,
            }),
          }
          : {}),
        updated_at: nowIso(),
      },
      {
        customer_id: `eq.${customer.id}`,
        id: `eq.${action.order_id}`,
        select: ORDER_PANEL_SELECT,
        session_id: `eq.${sessionId}`,
        tenant_id: `eq.${tenant.id}`,
      },
    );

    const order = await transition(action.order_id, 'submitted', 'customer', { channel });
    const loaded = await loadOrderForPanel(order.id, tenant.id);

    return {
      response: {
        order: await orderPanelFor(loaded, tenant),
        cards: [],
        products: [],
        session_id: sessionId,
        text: ORDER_PAYMENT_SUBMITTED_NOTICE_TH,
      },
    };
  }

  if (action.type === 'browse_categories') {
    await enforceCheapActionRateLimit(customer.id);
    const card = await buildCategoryGridCard(tenant.id);

    return {
      response: {
        cards: [card],
        order: await orderPanelFor(await loadActiveOrder(sessionId, tenant.id), tenant),
        products: [],
        session_id: sessionId,
        text: 'เลือกหมวดที่สนใจได้เลยค่ะ',
      },
    };
  }

  if (action.type === 'browse_category') {
    await enforceCheapActionRateLimit(customer.id);
    const card = await buildProductGridCardForCategory({
      category: action.category,
      limit: action.limit ?? 12,
      offset: action.offset ?? 0,
      tenantId: tenant.id,
    });

    return {
      response: {
        cards: card ? [card] : [],
        order: await orderPanelFor(await loadActiveOrder(sessionId, tenant.id), tenant),
        products: card?.products ?? [],
        session_id: sessionId,
        text: card ? 'เลือกแพ็กเกจที่สนใจได้เลยค่ะ' : 'ยังไม่มีแพ็กเกจในหมวดนี้ค่ะ',
      },
    };
  }

  if (action.type === 'get_order_status') {
    await enforceCheapActionRateLimit(customer.id);
    const card = await buildOrderStatusCard(tenant.id, customer.id);

    return {
      response: {
        cards: [card],
        order: await orderPanelFor(await loadActiveOrder(sessionId, tenant.id), tenant),
        products: [],
        session_id: sessionId,
        text: 'สถานะคิวล่าสุดค่ะ',
      },
    };
  }

  return {};
}

async function ensureHealthDataCollectionConsent(customer: CustomerRow, tenant: TenantRow) {
  const latestConsent = await selectOne<{ granted: boolean }>('consents', {
    customer_id: `eq.${customer.id}`,
    kind: 'eq.health_data_collection',
    order: 'created_at.desc',
    select: 'granted',
    tenant_id: `eq.${tenant.id}`,
  });

  if (latestConsent?.granted) {
    return;
  }

  await insertRow('consents', {
    customer_id: customer.id,
    granted: true,
    kind: 'health_data_collection',
    tenant_id: tenant.id,
  });
}

async function persistUserMessage(sessionId: string, clientMsgId: string, content: string) {
  const existing = await selectOne<ChatMessageRow>('chat_messages', {
    client_msg_id: `eq.${clientMsgId}`,
    select: CHAT_MESSAGE_SELECT,
    session_id: `eq.${sessionId}`,
  });

  if (existing) {
    return {
      duplicate: true,
      row: existing,
    };
  }

  const row = await insertRow<ChatMessageRow>('chat_messages', {
    client_msg_id: clientMsgId,
    content,
    role: 'user',
    session_id: sessionId,
  }, {
    select: CHAT_MESSAGE_SELECT,
  });

  return {
    duplicate: false,
    row,
  };
}

async function cachedAssistantReply(sessionId: string, userMessageCreatedAt: string) {
  return selectOne<ChatMessageRow>('chat_messages', {
    created_at: `gte.${userMessageCreatedAt}`,
    order: 'created_at.asc',
    role: 'eq.assistant',
    select: CHAT_MESSAGE_SELECT,
    session_id: `eq.${sessionId}`,
  });
}

async function enforceRateLimit(customerId: string) {
  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const rows = await selectMany<{ id: string }>('chat_messages', {
    created_at: `gte.${since}`,
    limit: '21',
    role: 'eq.user',
    select: 'id,chat_sessions!inner(customer_id)',
    'chat_sessions.customer_id': `eq.${customerId}`,
  });

  if (rows.length >= 20) {
    throw new HttpError('RATE_LIMITED', 'Too many messages. Please wait a moment.', 429);
  }
}

async function lookupProductsByCatalogKeys(tenantId: string, catalogKeys: string[]) {
  if (catalogKeys.length === 0) {
    return [];
  }

  const rows = await selectMany<ProductSummary>('products', {
    active: 'eq.true',
    catalog_key: `in.(${catalogKeys.join(',')})`,
    select: 'id,tenant_id,catalog_key,name,description,price_baht,category,image_url,branch_info,requires_appointment,active',
    tenant_id: `eq.${tenantId}`,
  });
  const rowByKey = new Map(rows.map((row) => [row.catalog_key, row]));
  const resolvedKeys = filterKnownProductMarkerKeys(catalogKeys, rowByKey.keys(), (unknownKeys) => {
    console.warn('marker_unknown_key', { catalogKeys: unknownKeys, tenantId });
  });

  return resolvedKeys.map((key) => rowByKey.get(key)).filter((row): row is ProductSummary => Boolean(row));
}

function toChatProduct(row: ProductSummary): ChatProduct {
  return {
    catalog_key: row.catalog_key,
    category: row.category,
    description: row.description,
    image_url: row.image_url,
    name: row.name,
    price_baht: row.price_baht,
  };
}

async function countActiveProductsByCategory(tenantId: string, category: string) {
  const rows = await selectMany<{ id: string }>('products', {
    active: 'eq.true',
    category: `eq.${category}`,
    select: 'id',
    tenant_id: `eq.${tenantId}`,
  });

  return rows.length;
}

async function lookupProductsByCategory({
  category,
  limit,
  offset,
  tenantId,
}: {
  category: string;
  limit: number;
  offset: number;
  tenantId: string;
}) {
  return selectMany<ProductSummary>('products', {
    active: 'eq.true',
    category: `eq.${category}`,
    limit: String(limit),
    offset: String(offset),
    order: 'created_at.desc',
    select: 'id,tenant_id,catalog_key,name,description,price_baht,category,image_url,branch_info,requires_appointment,active',
    tenant_id: `eq.${tenantId}`,
  });
}

async function buildProductGridCard(
  tenantId: string,
  productRows: ProductSummary[],
  source: Extract<ChatCard, { type: 'product_grid' }>['source'] = 'recommendation',
): Promise<Extract<ChatCard, { type: 'product_grid' }> | null> {
  if (productRows.length === 0) {
    return null;
  }

  const categories = [...new Set(productRows.map((row) => row.category).filter(Boolean))];
  const category = categories.length === 1 ? categories[0] : null;
  const totalAvailable = category ? await countActiveProductsByCategory(tenantId, category) : productRows.length;

  return {
    category,
    products: productRows.map(toChatProduct),
    source,
    total_available: totalAvailable,
    type: 'product_grid',
  };
}

async function buildProductGridCardForCategory({
  category,
  limit,
  offset,
  tenantId,
}: {
  category: string;
  limit: number;
  offset: number;
  tenantId: string;
}): Promise<Extract<ChatCard, { type: 'product_grid' }> | null> {
  const products = await lookupProductsByCategory({
    category,
    limit,
    offset,
    tenantId,
  });
  const totalAvailable = await countActiveProductsByCategory(tenantId, category);

  if (products.length === 0) {
    return null;
  }

  return {
    category,
    products: products.map(toChatProduct),
    source: 'category_browse',
    total_available: totalAvailable,
    type: 'product_grid',
  };
}

async function buildCategoryGridCard(tenantId: string): Promise<Extract<ChatCard, { type: 'category_grid' }>> {
  const rows = await selectMany<Pick<ProductSummary, 'category' | 'catalog_key'>>('products', {
    active: 'eq.true',
    order: 'category.asc',
    select: 'category,catalog_key',
    tenant_id: `eq.${tenantId}`,
  });
  const counts = new Map<string, number>();

  for (const row of rows) {
    counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
  }

  const categoryRows = await selectMany<ProductCategoryRow>('product_categories', {
    active: 'eq.true',
    order: 'sort.asc,key.asc',
    select: 'tenant_id,key,label_th,icon,image_url,sort,active',
    tenant_id: `eq.${tenantId}`,
  });
  const categoryByKey = new Map(categoryRows.map((row) => [row.key, row]));
  const categories: ChatCategory[] = [...counts.entries()]
    .map(([key, product_count]) => {
      const category = categoryByKey.get(key);
      const fallback = CATEGORY_FALLBACK_LABELS[key] ?? { icon: null, label_th: key, sort: 1000 };

      return {
        icon: category?.icon ?? fallback.icon,
        image_url: category?.image_url ?? null,
        key,
        label_th: category?.label_th ?? fallback.label_th,
        product_count,
      };
    })
    .sort((a, b) => {
      const sortA = categoryByKey.get(a.key)?.sort ?? CATEGORY_FALLBACK_LABELS[a.key]?.sort ?? 1000;
      const sortB = categoryByKey.get(b.key)?.sort ?? CATEGORY_FALLBACK_LABELS[b.key]?.sort ?? 1000;

      return sortA - sortB || a.label_th.localeCompare(b.label_th, 'th');
    });

  return {
    categories,
    type: 'category_grid',
  };
}

function productFromOrderJoin(order: OrderWithProductRow) {
  if (Array.isArray(order.products)) {
    return order.products[0] ?? null;
  }

  return order.products ?? null;
}

function branchFromOrderJoin(order: OrderWithProductRow) {
  if (Array.isArray(order.branches)) {
    return order.branches[0] ?? null;
  }

  return order.branches ?? null;
}

function toOrderStatusInfo(order: OrderWithProductRow): OrderStatusInfo {
  const product = productFromOrderJoin(order);
  const branch = branchFromOrderJoin(order);

  return {
    amount_baht: order.amount_baht,
    booking_at: order.booking_at,
    branch_name: branch?.name ?? order.preferred_branch,
    created_at: order.created_at,
    id: order.id,
    product_name: product?.name ?? 'แพ็กเกจ',
    status: order.status,
  };
}

async function buildOrderStatusCard(tenantId: string, customerId: string): Promise<Extract<ChatCard, { type: 'order_status' }>> {
  const rows = await selectMany<OrderWithProductRow>('orders', {
    customer_id: `eq.${customerId}`,
    limit: '6',
    order: 'created_at.desc',
    select: ORDER_PANEL_SELECT,
    tenant_id: `eq.${tenantId}`,
  });
  const orders = rows
    .filter((row) => row.status !== 'collecting_info' && row.status !== 'selecting_branch')
    .slice(0, 3)
    .map(toOrderStatusInfo);

  return {
    orders,
    type: 'order_status',
  };
}

async function buildCardsFromMarker({
  customerId,
  marker,
  productRows,
  tenantId,
}: {
  customerId: string;
  marker: ReturnType<typeof parseChatMarker>;
  productRows: ProductSummary[];
  tenantId: string;
}): Promise<ChatCard[]> {
  if (marker.type === 'products') {
    const card = await buildProductGridCard(tenantId, productRows);

    return card ? [card] : [];
  }

  if (marker.type === 'categories') {
    return [await buildCategoryGridCard(tenantId)];
  }

  if (marker.type === 'order_status') {
    return [await buildOrderStatusCard(tenantId, customerId)];
  }

  return [];
}

function isChatCard(value: unknown): value is ChatCard {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const type = (value as { type?: unknown }).type;

  return type === 'product_grid' || type === 'category_grid' || type === 'order_status';
}

function productsFromCards(cards: ChatCard[]) {
  return cards.find((card): card is Extract<ChatCard, { type: 'product_grid' }> => card.type === 'product_grid')?.products ?? [];
}

async function persistAssistantMessage({
  catalogKeys,
  cards,
  responseId,
  sessionId,
  text,
}: {
  catalogKeys: string[];
  cards: ChatCard[];
  responseId: string | null;
  sessionId: string;
  text: string;
}) {
  return insertRow<ChatMessageRow>('chat_messages', {
    cards,
    content: text,
    marker_product_ids: catalogKeys,
    openai_response_id: responseId,
    role: 'assistant',
    session_id: sessionId,
  }, {
    select: CHAT_MESSAGE_SELECT,
  });
}

async function persistSystemNotice(sessionId: string, text: string, cards: ChatCard[] = []) {
  return insertRow<ChatMessageRow>('chat_messages', {
    cards,
    content: text,
    role: 'system_notice',
    session_id: sessionId,
  }, {
    select: CHAT_MESSAGE_SELECT,
  });
}

async function updateSessionAfterAssistant(sessionId: string, tenantId: string, text: string) {
  const emergency = text.includes('1669') || text.includes('ฉุกเฉิน') || text.includes('หายใจไม่ออก');

  // Never clear an existing flag: a session escalated earlier must stay visible
  // to admin oversight even after the conversation moves on.
  await updateRows<ChatSessionRow>(
    'chat_sessions',
    {
      last_message_at: nowIso(),
      ...(emergency ? { flagged: 'emergency' } : {}),
    },
    {
      id: `eq.${sessionId}`,
      select: 'id,tenant_id,customer_id,channel,flagged,agent_mode,last_message_at,created_at',
      tenant_id: `eq.${tenantId}`,
    },
  );
}

async function completeActionResponseTurn({
  actionResult,
  clientMsgId,
  message,
  session,
  tenant,
}: {
  actionResult: Required<Pick<ActionResult, 'response'>>;
  clientMsgId: string;
  message: string;
  session: ChatSessionRow;
  tenant: TenantRow;
}) {
  if (message.trim()) {
    await persistUserMessage(session.id, clientMsgId, message);
  }
  await persistSystemNotice(session.id, actionResult.response.text, actionResult.response.cards);
  await updateSessionAfterAssistant(session.id, tenant.id, actionResult.response.text);

  return actionResult.response;
}

async function buildResponseFromCachedMessage(sessionId: string, tenantId: string, message: ChatMessageRow): Promise<ChatOrchestratorResponse> {
  const cachedCards = Array.isArray(message.cards) ? message.cards.filter(isChatCard) : [];

  if (cachedCards.length > 0) {
    return {
      cards: cachedCards,
      order: null,
      products: productsFromCards(cachedCards),
      session_id: sessionId,
      text: message.content,
    };
  }

  const products = await lookupProductsByCatalogKeys(tenantId, message.marker_product_ids);
  const card = await buildProductGridCard(tenantId, products);
  const cards = card ? [card] : [];

  return {
    cards,
    order: null,
    products: products.map(toChatProduct),
    session_id: sessionId,
    text: message.content,
  };
}

async function updateCollectingOrderFromMessage(order: OrderWithProductRow | null, message: string) {
  if (!order || order.status !== 'collecting_info') {
    return order;
  }

  const wasComplete = missingOrderFields(order).length === 0;
  const extracted = await callOrderFieldExtractor(message);
  const hasNewFields =
    extracted.buyer_age !== undefined ||
    Boolean(extracted.buyer_name) ||
    Boolean(extracted.buyer_phone) ||
    Boolean(extracted.preferred_date) ||
    Boolean(extracted.preferred_date_end) ||
    Boolean(extracted.preferred_time_window);

  if (hasNewFields) {
    const updated = await updateOrderFields(order.id, {
      customerId: order.customer_id ?? undefined,
      sessionId: order.session_id ?? undefined,
      tenantId: order.tenant_id,
    }, extracted);

    // F1 (v3 plan §11.3): persist a conversationally-collected age as a consent-gated user_fact,
    // mirroring the order_form_submit call site. A facts failure must never fail the chat turn.
    if (typeof extracted.buyer_age === 'number' && order.customer_id) {
      try {
        await recordFormAgeFact({
          age: extracted.buyer_age,
          customerId: order.customer_id,
          orderId: order.id,
          tenantId: order.tenant_id,
        });
      } catch (error) {
        console.warn('form_age_fact_failed', error);
      }
    }

    // V3-7: do NOT auto-advance even once every field is present. The order stays
    // in collecting_info so the prompt can read the details back and ask the
    // customer to confirm before the PromptPay QR is released.
    return loadOrderForPanel(updated.id, order.tenant_id);
  }

  // No new field values in this message. Once everything is collected, an explicit
  // affirmation ("ใช่"/"ถูกต้อง") is what releases the QR — sales-style confirm step.
  if (wasComplete && extracted.confirmed) {
    return maybeAdvanceCollectingOrder(order);
  }

  return order;
}

const CUSTOMER_SELECT = 'id,tenant_id,auth_user_id,line_user_id,nickname,phone,referred_by,referred_at,created_at';

async function resolveOrCreateLineCustomer(tenantId: string, tenantSlug: string, lineUserId: string) {
  const customer = await upsertRow<CustomerRow>(
    'customers',
    {
      line_user_id: lineUserId,
      tenant_id: tenantId,
    },
    'tenant_id,line_user_id',
    {
      select: CUSTOMER_SELECT,
    },
  );

  // Backfill the LINE display name once so the agent console shows a real name
  // instead of "ลูกค้า LINE". Only when empty — never overwrite a name the customer
  // or staff already set. Best-effort: a failed lookup just leaves the placeholder.
  if (!customer.nickname || !customer.nickname.trim()) {
    const profile = await fetchLineProfile(tenantSlug, lineUserId);
    const displayName = profile?.displayName?.trim();

    if (displayName) {
      const updated = await updateRows<CustomerRow>('customers', { nickname: displayName }, {
        id: `eq.${customer.id}`,
        select: CUSTOMER_SELECT,
        tenant_id: `eq.${tenantId}`,
      });

      return updated[0] ?? { ...customer, nickname: displayName };
    }
  }

  return customer;
}

async function resolveOrCreateLatestSession({
  channel,
  customer,
  tenant,
}: {
  channel: 'line';
  customer: CustomerRow;
  tenant: TenantRow;
}) {
  const existing = await selectOne<ChatSessionRow>('chat_sessions', {
    channel: `eq.${channel}`,
    customer_id: `eq.${customer.id}`,
    order: 'last_message_at.desc',
    select: 'id,tenant_id,customer_id,channel,flagged,agent_mode,last_message_at,created_at',
    tenant_id: `eq.${tenant.id}`,
  });

  if (existing) {
    return existing;
  }

  return insertRow<ChatSessionRow>('chat_sessions', {
    channel,
    customer_id: customer.id,
    last_message_at: nowIso(),
    tenant_id: tenant.id,
  }, {
    select: 'id,tenant_id,customer_id,channel,flagged,agent_mode,last_message_at,created_at',
  });
}

// Shared turn pipeline for every channel: action handling has already run, the
// session/customer are resolved, and the only channel difference is how they were
// resolved upstream.
async function completeChatTurn({
  actionResult,
  channel,
  clientMsgId,
  customer,
  message,
  session,
  tenant,
}: {
  actionResult: ActionResult;
  channel: 'app' | 'line' | 'pwa';
  clientMsgId: string;
  customer: CustomerRow;
  message: string;
  session: ChatSessionRow;
  tenant: TenantRow;
}): Promise<ChatOrchestratorResponse> {
  const userPersist = await persistUserMessage(session.id, clientMsgId, message);

  if (userPersist.duplicate) {
    const cached = await cachedAssistantReply(session.id, userPersist.row.created_at);

    if (cached) {
      return buildResponseFromCachedMessage(session.id, tenant.id, cached);
    }
  }

  await enforceRateLimit(customer.id);

  if (channel !== 'line') {
    await ensureHealthDataCollectionConsent(customer, tenant);
  }

  let activeOrder = await expireOverduePayment(
    actionResult.order ?? await loadActiveOrder(session.id, tenant.id),
    tenant,
  );

  // V3-7 (LINE): record any typed buyer info / confirmation BEFORE building the
  // prompt context, so the order state the model sees is current — it can read the
  // details back and ask to confirm, or (on confirmation) see awaiting_payment.
  // Skip on postback-driven turns (actionResult.order is set): those carry a canned
  // label, not buyer info, so the extractor LLM call would be wasted latency.
  if (channel === 'line' && !actionResult.order) {
    activeOrder = await updateCollectingOrderFromMessage(activeOrder, message);
  }

  const intentCategory = inferIntentCategory(message);
  const orderContext = await formatOrderContextLines(customer.id, session.id, tenant.id, channel);
  const [personalContext, recentChat, productCatalog] = await Promise.all([
    buildPersonalContext(customer.id, orderContext, channel === 'line'),
    buildRecentChat(session.id),
    buildCatalogJson(tenant.id, intentCategory),
  ]);
  const promptResult = await callMiraPrompt(
    {
      brand_name: tenant.display_name,
      personal_context: personalContext,
      product_catalog: productCatalog,
      recent_chat: recentChat,
      user_nickname: customer.nickname ?? 'ลูกค้า',
    },
    message,
  );
  const parsed = parseChatMarker(promptResult.text);
  if (parsed.strippedExtraMarkerCount > 0) {
    console.warn('marker_extra_stripped', {
      count: parsed.strippedExtraMarkerCount,
      markerType: parsed.type,
      tenantId: tenant.id,
    });
  }
  // While a purchase panel is on screen (branch/form/QR steps), product and
  // category cards are redundant CTAs that compete with the panel, so they are
  // suppressed regardless of what the model emitted. order_status stays valid.
  const purchaseInProgress = Boolean(
    activeOrder && ['selecting_branch', 'collecting_info', 'awaiting_payment'].includes(activeOrder.status),
  );
  const suppressMarkerCards = purchaseInProgress && (parsed.type === 'products' || parsed.type === 'categories');
  if (suppressMarkerCards) {
    console.warn('marker_suppressed_active_order', {
      markerType: parsed.type,
      orderStatus: activeOrder?.status,
      tenantId: tenant.id,
    });
  }
  const effectiveMarker = suppressMarkerCards ? { ...parsed, catalogKeys: [], type: null } : parsed;
  const productRows = await lookupProductsByCatalogKeys(tenant.id, effectiveMarker.catalogKeys);
  const resolvedKeys = productRows.map((row) => row.catalog_key);
  const cards = await buildCardsFromMarker({
    customerId: customer.id,
    marker: effectiveMarker,
    productRows,
    tenantId: tenant.id,
  });
  // The model may emit only a marker line ("[[categories]]" with no lead-in);
  // after stripping, parsed.text is empty and clients would render an empty
  // assistant bubble. Substitute a short lead-in that matches the marker.
  const assistantText = parsed.text || (
    effectiveMarker.type === 'categories'
      ? 'เลือกหมวดที่สนใจได้เลยค่ะ'
      : effectiveMarker.type === 'products'
        ? 'แนะนำรายการนี้ได้เลยค่ะ'
        : effectiveMarker.type === 'order_status'
          ? 'สถานะคิวล่าสุดค่ะ'
          : 'ขออภัยค่ะ รบกวนพิมพ์อีกครั้งนะคะ');
  const assistantMessage = await persistAssistantMessage({
    catalogKeys: resolvedKeys,
    cards,
    responseId: promptResult.responseId,
    sessionId: session.id,
    text: assistantText,
  });

  await updateSessionAfterAssistant(session.id, tenant.id, assistantText);

  void invokeInternalFunction('fact-extractor', { message_id: userPersist.row.id }).catch((error) => {
    console.warn('fact_extractor_invoke_failed', error instanceof Error ? error.message : error);
  });

  return {
    cards,
    order: await orderPanelFor(activeOrder, tenant),
    products: productRows.map(toChatProduct),
    session_id: session.id,
    text: assistantMessage.content,
  };
}

// V3-9 (web/app handover): when a human agent owns the conversation, record the
// inbound message for the live console and answer with a fixed system notice instead
// of calling the model. Mirrors orchestrateLine's silence, but web/app callers expect
// a response object (they cannot interpret null), so we return a non-AI placeholder.
async function handoverHoldResponse({
  clientMsgId,
  message,
  session,
  tenant,
}: {
  clientMsgId: string;
  message: string;
  session: ChatSessionRow;
  tenant: TenantRow;
}): Promise<ChatOrchestratorResponse> {
  if (message.trim()) {
    await persistUserMessage(session.id, clientMsgId, message);
    await updateRows<ChatSessionRow>('chat_sessions', { last_message_at: nowIso() }, {
      id: `eq.${session.id}`,
      select: 'id',
      tenant_id: `eq.${tenant.id}`,
    });
  }

  const activeOrder = await loadActiveOrder(session.id, tenant.id);

  return {
    cards: [],
    order: await orderPanelFor(activeOrder, tenant),
    products: [],
    session_id: session.id,
    text: AGENT_HANDOVER_NOTICE_TH,
  };
}

export async function orchestrateChat(
  request: ChatOrchestratorRequest,
  authorization: string | null,
): Promise<ChatOrchestratorResponse | ChatSlipUploadResponse> {
  if (!['get_order_status', 'refresh_order', 'request_slip_upload'].includes(request.action?.type ?? '') && request.message.length === 0) {
    throw new HttpError('VALIDATION', 'Message is required.', 400);
  }

  const tenant = await assertTenant(request.tenant_slug);
  const authUserId = await resolveAuthUserId(authorization);
  let customer = await resolveOrCreateCustomer(tenant.id, authUserId);
  customer = await applyReferralCodeToCustomer(customer, tenant, request.ref_code);
  const session = await resolveOrCreateSession({
    channel: request.channel,
    customer,
    sessionId: request.session_id,
    tenant,
  });

  if (request.action?.type === 'request_slip_upload') {
    return createSlipUpload({
      action: request.action,
      customer,
      sessionId: session.id,
      tenant,
    });
  }

  if (request.action?.type === 'refresh_order') {
    return refreshActiveOrder(session, tenant);
  }

  // V3-9: a human agent has taken over (live console). Stay silent — record the turn
  // and reply with a fixed handover notice rather than running the AI. Utility reads
  // above (slip upload, order refresh) are intentionally left working.
  if (session.agent_mode === 'human') {
    return handoverHoldResponse({
      clientMsgId: request.client_msg_id,
      message: request.message,
      session,
      tenant,
    });
  }

  const actionResult = await handleAction({
    action: request.action,
    channel: request.channel,
    customer,
    sessionId: session.id,
    tenant,
  });

  if (actionResult.response) {
    return completeActionResponseTurn({
      actionResult: { response: actionResult.response },
      clientMsgId: request.client_msg_id,
      message: request.message,
      session,
      tenant,
    });
  }

  return completeChatTurn({
    actionResult,
    channel: request.channel,
    clientMsgId: request.client_msg_id,
    customer,
    message: request.message,
    session,
    tenant,
  });
}

export async function orchestrateLine(request: {
  action: ChatOrchestratorRequest['action'];
  client_msg_id: string;
  line_user_id: string;
  message: string;
  tenant_slug: string;
}): Promise<ChatOrchestratorResponse | null> {
  const tenant = await assertTenant(request.tenant_slug);
  const customer = await resolveOrCreateLineCustomer(tenant.id, tenant.slug, request.line_user_id);
  const session = await resolveOrCreateLatestSession({
    channel: 'line',
    customer,
    tenant,
  });

  // V3-8: if a human agent has taken over this conversation, record the inbound
  // message for the console and stay silent — the human replies via the console.
  if (session.agent_mode === 'human') {
    if (request.message.trim()) {
      await persistUserMessage(session.id, request.client_msg_id, request.message);
      await updateRows<ChatSessionRow>('chat_sessions', { last_message_at: nowIso() }, {
        id: `eq.${session.id}`,
        select: 'id',
        tenant_id: `eq.${tenant.id}`,
      });
    }

    return null;
  }

  const actionResult = await handleAction({
    action: request.action,
    channel: 'line',
    customer,
    sessionId: session.id,
    tenant,
  });

  if (actionResult.response) {
    return completeActionResponseTurn({
      actionResult: { response: actionResult.response },
      clientMsgId: request.client_msg_id,
      message: request.message,
      session,
      tenant,
    });
  }

  return completeChatTurn({
    actionResult,
    channel: 'line',
    clientMsgId: request.client_msg_id,
    customer,
    message: request.message,
    session,
    tenant,
  });
}
