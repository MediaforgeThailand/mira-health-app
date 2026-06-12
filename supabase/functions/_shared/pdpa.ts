import { insertRow, resolveAuthUserId, rest, selectMany, selectOne, updateRows } from './db.ts';
import { HttpError, z } from './http.ts';
import { normalizePaymentSlipPath } from './orders.ts';
import { createSignedReadUrl, deleteStorageObjects } from './storage.ts';
import type {
  ChatMessageRow,
  ChatSessionRow,
  CustomerRow,
  LabReportRow,
  LabResultRow,
  OrderRow,
  PdpaDeleteResponse,
  PdpaExportResponse,
  PdpaLabReportExportRow,
  PdpaOrderEventRow,
  PdpaOrderExportRow,
  PdpaRequest,
  PdpaStorageReference,
  TenantRow,
  UserFactRow,
  WearableImportRow,
  WearableMetricRow,
} from './types.ts';

export const PDPA_CUSTOMER_DELETE_TABLES = [
  'user_facts',
  'consents',
  'chat_messages',
  'chat_sessions',
  'lab_results',
  'lab_reports',
  'wearable_metrics',
  'wearable_imports',
] as const;

export const PDPA_CUSTOMER_ANONYMIZE_TABLES = ['orders'] as const;
export const PDPA_CUSTOMER_TOMBSTONE_TABLES = ['pdpa_requests'] as const;

const ORDER_SELECT =
  'id,tenant_id,customer_id,session_id,product_id,qty,amount_baht,buyer_name,buyer_phone,preferred_branch,preferred_date,channel,referrer_id,commission_scheme_snapshot,status,slip_url,booking_at,branch_id,buyer_age,admin_note,created_at,updated_at,payment_provider,stripe_checkout_session_id,stripe_payment_intent_id,stripe_payment_status,paid_at';
const CUSTOMER_SELECT = 'id,tenant_id,auth_user_id,line_user_id,nickname,phone,referred_by,referred_at,created_at';
const SESSION_SELECT = 'id,tenant_id,customer_id,channel,flagged,last_message_at,created_at';
const MESSAGE_SELECT = 'id,session_id,role,content,marker_product_ids,cards,openai_response_id,client_msg_id,created_at';
const FACT_SELECT = 'id,tenant_id,customer_id,key,value_text,value_num,confidence,status,source,source_ref,superseded_by,created_at';
const LAB_REPORT_SELECT = 'id,tenant_id,customer_id,storage_path,status,ai_summary_th,collected_date,created_at';
const LAB_RESULT_SELECT = 'id,report_id,test_code,test_name_raw,value,unit,ref_low,ref_high,confidence,confirmed';
const WEARABLE_IMPORT_SELECT = 'id,tenant_id,customer_id,source,filename,file_path,metric_count,imported_at';
const WEARABLE_SELECT = 'id,tenant_id,customer_id,source,metric,day,value,import_id';
const ORDER_EVENT_SELECT = 'id,order_id,from_status,to_status,actor,meta,created_at';
const PDPA_REQUEST_SELECT = 'id,tenant_id,customer_id,kind,requested_by,requested_at,completed_at';
const ANONYMIZED_BUYER_NAME_TH = 'ลบตามคำขอ (PDPA)';

type PdpaKind = 'delete' | 'export';
type PdpaRequestRow = {
  completed_at: string | null;
  customer_id: string;
  id: string;
  kind: PdpaKind;
  requested_at: string;
  requested_by: string;
  tenant_id: string;
};

type PdpaTarget = {
  actor: 'admin' | 'customer';
  authUserId: string;
  customer: CustomerRow | null;
  customerId: string;
  requestedBy: string;
  tenantId: string;
};

export const pdpaRequestSchema = z.object({
  customer_id: z.string().uuid().optional(),
  tenant_id: z.string().uuid().optional(),
  tenant_slug: z.string().trim().min(1).optional(),
});

function queryString(params: Record<string, string | undefined>) {
  const entries = Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]));

  return entries.length ? `?${entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}` : '';
}

function inFilter(values: string[]) {
  return `in.(${values.join(',')})`;
}

function isAdminRole(role: string | null | undefined) {
  return role === 'superadmin' || role === 'tenant_admin';
}

function isMissingRelation(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return /does not exist|schema cache|Could not find|relation .* not found/i.test(message);
}

async function tenantIdFromSlug(slug?: string) {
  if (!slug) {
    return null;
  }

  const tenant = await selectOne<TenantRow>('tenants', {
    select: 'id,slug,display_name,logo_url,promptpay_id,attribution_window_days,features',
    slug: `eq.${slug}`,
  });

  if (!tenant) {
    throw new HttpError('VALIDATION', 'Tenant not found.', 404);
  }

  return tenant.id;
}

async function loadAdminRole(authUserId: string, tenantId: string) {
  const memberships = await selectMany<{ role: string; tenant_id: string }>('tenant_members', {
    auth_user_id: `eq.${authUserId}`,
    select: 'tenant_id,role',
    tenant_id: `eq.${tenantId}`,
  });

  return memberships[0]?.role ?? null;
}

async function assertAdminTarget(authUserId: string, tenantId: string) {
  const role = await loadAdminRole(authUserId, tenantId);

  if (!isAdminRole(role)) {
    throw new HttpError('VALIDATION', 'Not allowed for this tenant.', 403);
  }
}

async function loadCustomerByRequest(body: PdpaRequest, tenantIdHint: string | null, authUserId: string) {
  if (body.customer_id) {
    return selectOne<CustomerRow>('customers', {
      id: `eq.${body.customer_id}`,
      select: CUSTOMER_SELECT,
    });
  }

  if (!tenantIdHint) {
    const rows = await selectMany<CustomerRow>('customers', {
      auth_user_id: `eq.${authUserId}`,
      limit: '2',
      order: 'created_at.desc',
      select: CUSTOMER_SELECT,
    });

    if (rows.length > 1) {
      throw new HttpError('VALIDATION', 'tenant_slug or tenant_id is required when the account has multiple customer profiles.', 400);
    }

    return rows[0] ?? null;
  }

  return selectOne<CustomerRow>('customers', {
    auth_user_id: `eq.${authUserId}`,
    select: CUSTOMER_SELECT,
    tenant_id: `eq.${tenantIdHint}`,
  });
}

export async function resolvePdpaTarget(body: PdpaRequest, authorization: string | null, kind: PdpaKind): Promise<PdpaTarget> {
  const authUserId = await resolveAuthUserId(authorization);
  const slugTenantId = await tenantIdFromSlug(body.tenant_slug);
  const tenantIdHint = body.tenant_id ?? slugTenantId;
  let customer = await loadCustomerByRequest(body, tenantIdHint, authUserId);

  if (!customer && !body.customer_id && tenantIdHint) {
    customer = await selectOne<CustomerRow>('customers', {
      auth_user_id: `eq.${authUserId}`,
      select: CUSTOMER_SELECT,
      tenant_id: `eq.${tenantIdHint}`,
    });
  }

  if (!customer) {
    if (kind === 'delete' && body.customer_id && tenantIdHint) {
      await assertAdminTarget(authUserId, tenantIdHint);

      return {
        actor: 'admin',
        authUserId,
        customer: null,
        customerId: body.customer_id,
        requestedBy: `admin:${authUserId}`,
        tenantId: tenantIdHint,
      };
    }

    throw new HttpError('VALIDATION', 'Customer not found.', 404);
  }

  if (tenantIdHint && customer.tenant_id !== tenantIdHint) {
    throw new HttpError('VALIDATION', 'Not allowed for this tenant.', 403);
  }

  if (customer.auth_user_id === authUserId) {
    return {
      actor: 'customer',
      authUserId,
      customer,
      customerId: customer.id,
      requestedBy: 'customer',
      tenantId: customer.tenant_id,
    };
  }

  await assertAdminTarget(authUserId, customer.tenant_id);

  return {
    actor: 'admin',
    authUserId,
    customer,
    customerId: customer.id,
    requestedBy: `admin:${authUserId}`,
    tenantId: customer.tenant_id,
  };
}

async function insertPdpaRequest(kind: PdpaKind, target: Pick<PdpaTarget, 'customerId' | 'requestedBy' | 'tenantId'>, completedAt: string | null) {
  return insertRow<PdpaRequestRow>('pdpa_requests', {
    completed_at: completedAt,
    customer_id: target.customerId,
    kind,
    requested_by: target.requestedBy,
    tenant_id: target.tenantId,
  }, {
    select: PDPA_REQUEST_SELECT,
  });
}

async function completePdpaRequest(row: PdpaRequestRow, completedAt: string) {
  const rows = await updateRows<PdpaRequestRow>('pdpa_requests', {
    completed_at: completedAt,
  }, {
    id: `eq.${row.id}`,
    select: PDPA_REQUEST_SELECT,
    tenant_id: `eq.${row.tenant_id}`,
  });

  return rows[0] ?? { ...row, completed_at: completedAt };
}

async function deleteRows(table: string, params: Record<string, string | undefined>) {
  const rows = await rest<Record<string, unknown>[]>(`${table}${queryString(params)}`, {
    method: 'DELETE',
    prefer: 'return=representation',
  });

  return rows.length;
}

async function deleteOptionalRows(table: string, params: Record<string, string | undefined>) {
  try {
    return await deleteRows(table, params);
  } catch (error) {
    if (isMissingRelation(error)) {
      return 0;
    }

    throw error;
  }
}

function normalizeLabReportPath(path: string) {
  return path.replace(/^lab-reports\//, '').replace(/^\/+/, '');
}

async function signedStorageReference(bucket: string, path: string, expiresIn = 60 * 60): Promise<PdpaStorageReference> {
  const normalizedPath = bucket === 'payment-slips' ? normalizePaymentSlipPath(path) : normalizeLabReportPath(path);
  let signedUrl: string | null = null;

  try {
    signedUrl = await createSignedReadUrl(bucket, normalizedPath, expiresIn);
  } catch {
    signedUrl = null;
  }

  return {
    bucket,
    expires_in: expiresIn,
    path: normalizedPath,
    signed_url: signedUrl,
  };
}

async function deleteStorageReferences(references: PdpaStorageReference[]) {
  const deleted: PdpaStorageReference[] = [];

  for (const bucket of [...new Set(references.map((reference) => reference.bucket))]) {
    const paths = references.filter((reference) => reference.bucket === bucket).map((reference) => reference.path);

    if (paths.length === 0) {
      continue;
    }

    await deleteStorageObjects(bucket, paths);
    deleted.push(...paths.map((path) => ({
      bucket,
      expires_in: 0,
      path,
      signed_url: null,
    })));
  }

  return deleted;
}

async function loadCustomerExportBundle(target: PdpaTarget) {
  const customerId = target.customerId;
  const tenantId = target.tenantId;
  const [consents, userFacts, chatSessions, orders, labReports, wearableImports, wearableMetrics] = await Promise.all([
    selectMany<Record<string, unknown>>('consents', {
      customer_id: `eq.${customerId}`,
      order: 'created_at.asc',
      select: '*',
      tenant_id: `eq.${tenantId}`,
    }),
    selectMany<UserFactRow>('user_facts', {
      customer_id: `eq.${customerId}`,
      order: 'created_at.asc',
      select: FACT_SELECT,
      tenant_id: `eq.${tenantId}`,
    }),
    selectMany<ChatSessionRow>('chat_sessions', {
      customer_id: `eq.${customerId}`,
      order: 'created_at.asc',
      select: SESSION_SELECT,
      tenant_id: `eq.${tenantId}`,
    }),
    selectMany<OrderRow>('orders', {
      customer_id: `eq.${customerId}`,
      order: 'created_at.asc',
      select: ORDER_SELECT,
      tenant_id: `eq.${tenantId}`,
    }),
    selectMany<LabReportRow>('lab_reports', {
      customer_id: `eq.${customerId}`,
      order: 'created_at.asc',
      select: LAB_REPORT_SELECT,
      tenant_id: `eq.${tenantId}`,
    }),
    selectMany<WearableImportRow>('wearable_imports', {
      customer_id: `eq.${customerId}`,
      order: 'imported_at.asc',
      select: WEARABLE_IMPORT_SELECT,
      tenant_id: `eq.${tenantId}`,
    }),
    selectMany<WearableMetricRow>('wearable_metrics', {
      customer_id: `eq.${customerId}`,
      order: 'day.asc',
      select: WEARABLE_SELECT,
      tenant_id: `eq.${tenantId}`,
    }),
  ]);
  const sessionIds = chatSessions.map((session) => session.id);
  const orderIds = orders.map((order) => order.id);
  const reportIds = labReports.map((report) => report.id);
  const [chatMessages, orderEvents, labResults] = await Promise.all([
    sessionIds.length
      ? selectMany<ChatMessageRow>('chat_messages', {
        order: 'created_at.asc',
        select: MESSAGE_SELECT,
        session_id: inFilter(sessionIds),
      })
      : Promise.resolve([]),
    orderIds.length
      ? selectMany<PdpaOrderEventRow>('order_events', {
        order: 'created_at.asc',
        order_id: inFilter(orderIds),
        select: ORDER_EVENT_SELECT,
      })
      : Promise.resolve([]),
    reportIds.length
      ? selectMany<LabResultRow>('lab_results', {
        order: 'test_code.asc',
        report_id: inFilter(reportIds),
        select: LAB_RESULT_SELECT,
      })
      : Promise.resolve([]),
  ]);
  const orderEventsByOrder = new Map<string, PdpaOrderEventRow[]>();

  for (const event of orderEvents) {
    orderEventsByOrder.set(event.order_id, [...(orderEventsByOrder.get(event.order_id) ?? []), event]);
  }

  const labResultsByReport = new Map<string, LabResultRow[]>();

  for (const result of labResults) {
    labResultsByReport.set(result.report_id, [...(labResultsByReport.get(result.report_id) ?? []), result]);
  }

  const ordersWithEvents: PdpaOrderExportRow[] = await Promise.all(orders.map(async (order) => ({
    ...order,
    order_events: orderEventsByOrder.get(order.id) ?? [],
    slip: order.slip_url ? await signedStorageReference('payment-slips', order.slip_url) : null,
  })));
  const labReportsWithResults: PdpaLabReportExportRow[] = await Promise.all(labReports.map(async (report) => ({
    ...report,
    lab_results: labResultsByReport.get(report.id) ?? [],
    report_file: report.storage_path ? await signedStorageReference('lab-reports', report.storage_path) : null,
  })));

  return {
    chatMessages,
    chatSessions,
    consents,
    labReports: labReportsWithResults,
    orders: ordersWithEvents,
    userFacts,
    wearableImports,
    wearableMetrics,
  };
}

export async function exportPdpaData(body: PdpaRequest, authorization: string | null): Promise<PdpaExportResponse> {
  const target = await resolvePdpaTarget(body, authorization, 'export');

  if (!target.customer) {
    throw new HttpError('VALIDATION', 'Customer not found.', 404);
  }

  const bundle = await loadCustomerExportBundle(target);
  const completedAt = new Date().toISOString();
  const request = await insertPdpaRequest('export', target, completedAt);

  return {
    chat_messages: bundle.chatMessages,
    chat_sessions: bundle.chatSessions,
    completed_at: completedAt,
    consents: bundle.consents,
    customer: target.customer,
    lab_reports: bundle.labReports,
    orders: bundle.orders,
    pdpa_request_id: request.id,
    user_facts: bundle.userFacts,
    wearable_imports: bundle.wearableImports,
    wearable_metrics: bundle.wearableMetrics,
  };
}

async function deleteLegacyUserRows(authUserId: string | null) {
  if (!authUserId) {
    return {};
  }

  const deletedRows: Record<string, number> = {};

  deletedRows.health_fact_sources = await deleteOptionalRows('health_fact_sources', { user_id: `eq.${authUserId}` });
  deletedRows.health_facts = await deleteOptionalRows('health_facts', { user_id: `eq.${authUserId}` });
  deletedRows.retrieval_logs = await deleteOptionalRows('retrieval_logs', { user_id: `eq.${authUserId}` });
  deletedRows.ai_request_logs = await deleteOptionalRows('ai_request_logs', { user_id: `eq.${authUserId}` });
  deletedRows.rag_retrieval_logs = await deleteOptionalRows('rag_retrieval_logs', { user_id: `eq.${authUserId}` });
  deletedRows.api_process_logs = await deleteOptionalRows('api_process_logs', { user_id: `eq.${authUserId}` });
  deletedRows.health_memory_logs = await deleteOptionalRows('health_memory_logs', { user_id: `eq.${authUserId}` });
  deletedRows.ai_rate_limits = await deleteOptionalRows('ai_rate_limits', { user_id: `eq.${authUserId}` });
  deletedRows.user_context_scores = await deleteOptionalRows('user_context_scores', { user_id: `eq.${authUserId}` });
  deletedRows.agent_memory = await deleteOptionalRows('agent_memory', { user_id: `eq.${authUserId}` });
  deletedRows.hospital_access_grants = await deleteOptionalRows('hospital_access_grants', { user_id: `eq.${authUserId}` });
  deletedRows.data_access_logs = await deleteOptionalRows('data_access_logs', { user_id: `eq.${authUserId}` });
  deletedRows.health_logs = await deleteOptionalRows('health_logs', { user_id: `eq.${authUserId}` });
  deletedRows.profiles = await deleteOptionalRows('profiles', { id: `eq.${authUserId}` });
  deletedRows.legacy_chat_messages = await deleteOptionalRows('legacy_chat_messages', { user_id: `eq.${authUserId}` });
  deletedRows.legacy_chat_sessions = await deleteOptionalRows('legacy_chat_sessions', { user_id: `eq.${authUserId}` });
  deletedRows.legacy_consents = await deleteOptionalRows('legacy_consents', { user_id: `eq.${authUserId}` });

  return deletedRows;
}

export async function deletePdpaData(body: PdpaRequest, authorization: string | null): Promise<PdpaDeleteResponse> {
  const target = await resolvePdpaTarget(body, authorization, 'delete');

  if (!target.customer) {
    return {
      anonymized_orders: 0,
      completed_at: null,
      deleted: false,
      deleted_rows: {},
      deleted_storage: [],
      idempotent: true,
      pdpa_request_id: null,
    };
  }

  const request = await insertPdpaRequest('delete', target, null);
  const bundle = await loadCustomerExportBundle(target);
  const storageReferences = [
    ...bundle.orders.map((order) => order.slip).filter((reference): reference is PdpaStorageReference => Boolean(reference)),
    ...bundle.labReports.map((report) => report.report_file).filter((reference): reference is PdpaStorageReference => Boolean(reference)),
  ];
  const deletedStorage = await deleteStorageReferences(storageReferences);
  const sessionIds = bundle.chatSessions.map((session) => session.id);
  const reportIds = bundle.labReports.map((report) => report.id);
  const deletedRows: Record<string, number> = {};
  const updatedOrders = await updateRows<OrderRow>('orders', {
    buyer_name: ANONYMIZED_BUYER_NAME_TH,
    buyer_phone: null,
    customer_id: null,
    session_id: null,
    slip_url: null,
    updated_at: new Date().toISOString(),
  }, {
    customer_id: `eq.${target.customerId}`,
    select: ORDER_SELECT,
    tenant_id: `eq.${target.tenantId}`,
  });

  deletedRows.lab_results = reportIds.length ? await deleteRows('lab_results', { report_id: inFilter(reportIds) }) : 0;
  deletedRows.chat_messages = sessionIds.length ? await deleteRows('chat_messages', { session_id: inFilter(sessionIds) }) : 0;
  deletedRows.user_facts = await deleteRows('user_facts', {
    customer_id: `eq.${target.customerId}`,
    tenant_id: `eq.${target.tenantId}`,
  });
  deletedRows.consents = await deleteRows('consents', {
    customer_id: `eq.${target.customerId}`,
    tenant_id: `eq.${target.tenantId}`,
  });
  deletedRows.lab_reports = await deleteRows('lab_reports', {
    customer_id: `eq.${target.customerId}`,
    tenant_id: `eq.${target.tenantId}`,
  });
  deletedRows.wearable_metrics = await deleteRows('wearable_metrics', {
    customer_id: `eq.${target.customerId}`,
    tenant_id: `eq.${target.tenantId}`,
  });
  deletedRows.wearable_imports = await deleteRows('wearable_imports', {
    customer_id: `eq.${target.customerId}`,
    tenant_id: `eq.${target.tenantId}`,
  });
  deletedRows.chat_sessions = await deleteRows('chat_sessions', {
    customer_id: `eq.${target.customerId}`,
    tenant_id: `eq.${target.tenantId}`,
  });
  deletedRows.customers = await deleteRows('customers', {
    id: `eq.${target.customerId}`,
    tenant_id: `eq.${target.tenantId}`,
  });

  Object.assign(deletedRows, await deleteLegacyUserRows(target.customer.auth_user_id));

  const completedAt = new Date().toISOString();
  const completedRequest = await completePdpaRequest(request, completedAt);

  return {
    anonymized_orders: updatedOrders.length,
    completed_at: completedRequest.completed_at,
    deleted: true,
    deleted_rows: deletedRows,
    deleted_storage: deletedStorage,
    idempotent: false,
    pdpa_request_id: request.id,
  };
}
