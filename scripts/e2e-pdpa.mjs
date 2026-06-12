import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createAuthUserSession } from './create-test-jwt.mjs';

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const tenantSlug = process.env.MIRA_DEMO_TENANT_SLUG ?? 'demo-hospital';

const ADMIN_EMAIL = 'e2e-pdpa-admin@miracare.dev';
const OTHER_ADMIN_EMAIL = 'e2e-pdpa-other-admin@miracare.dev';
const CUSTOMER_EMAIL = 'e2e-pdpa-customer@miracare.dev';
const ANONYMIZED_BUYER_NAME_TH = 'ลบตามคำขอ (PDPA)';

if (!supabaseUrl || !serviceRoleKey || !anonKey) {
  throw new Error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_ANON_KEY before running PDPA E2E.');
}

const endpointBase = supabaseUrl.replace(/\/$/, '');
const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
const created = {
  authUserIds: [],
  labPaths: [],
  orderEventIds: [],
  orderIds: [],
  pdpaRequestCustomerIds: [],
  slipPaths: [],
  tenantIds: [],
};
let tenant = null;
let customer = null;
let otherTenant = null;
let caughtError = null;

try {
  await run();
} catch (error) {
  caughtError = error;
  throw error;
} finally {
  try {
    await cleanup();
  } catch (cleanupError) {
    if (caughtError) {
      console.warn(`pdpa E2E cleanup failed after test error: ${cleanupError.message}`);
    } else {
      throw cleanupError;
    }
  }
}

async function run() {
  tenant = await loadTenant();
  const product = await loadProduct(tenant.id);
  const [admin, otherAdmin, customerUser] = await Promise.all([
    createAuthUserSession({
      email: ADMIN_EMAIL,
      purpose: 'miracare-r4-pdpa-e2e-admin',
    }),
    createAuthUserSession({
      email: OTHER_ADMIN_EMAIL,
      purpose: 'miracare-r4-pdpa-e2e-other-admin',
    }),
    createAuthUserSession({
      email: CUSTOMER_EMAIL,
      purpose: 'miracare-r4-pdpa-e2e-customer',
    }),
  ]);

  created.authUserIds.push(admin.user.id, otherAdmin.user.id, customerUser.user.id);
  await cleanupResidualPdpaTestData(tenant.id, created.authUserIds);
  otherTenant = await createOtherTenant();
  await seedAdminMembership(tenant.id, admin.user.id);
  await seedAdminMembership(otherTenant.id, otherAdmin.user.id);
  customer = await seedCustomer(tenant.id, customerUser.user.id);
  created.pdpaRequestCustomerIds.push(customer.id);

  const seeded = await seedPersonalData(tenant.id, customer, product);
  const exported = await postEdge('pdpa-export', customerUser.accessToken, {
    customer_id: customer.id,
  });

  assert(exported.customer?.id === customer.id, 'customer export should include customer row');
  assert(exported.consents?.length === 1, 'customer export should include consent rows');
  assert(exported.user_facts?.length === 1, 'customer export should include user facts');
  assert(exported.chat_sessions?.length === 1, 'customer export should include chat sessions');
  assert(exported.chat_messages?.length === 1, 'customer export should include chat messages');
  assert(exported.orders?.length === 1, 'customer export should include orders');
  assert(exported.orders[0]?.order_events?.length === 1, 'customer export should include order events');
  assert(exported.orders[0]?.slip?.signed_url, 'customer export should include signed slip URL');
  assert(exported.lab_reports?.length === 1, 'customer export should include lab reports');
  assert(exported.lab_reports[0]?.lab_results?.length === 1, 'customer export should include lab results');
  assert(exported.lab_reports[0]?.report_file?.signed_url, 'customer export should include signed lab URL');
  assert(exported.wearable_imports?.length === 1, 'customer export should include wearable imports');
  assert(exported.wearable_metrics?.length === 1, 'customer export should include wearable metrics');

  await expectEdgeError('pdpa-delete', otherAdmin.accessToken, {
    customer_id: customer.id,
  }, 'VALIDATION', 'cross-tenant admin should not delete another tenant customer');

  const deleted = await postEdge('pdpa-delete', admin.accessToken, {
    customer_id: customer.id,
    tenant_id: tenant.id,
  });

  assert(deleted.deleted === true, 'pdpa-delete should delete the seeded customer data');
  assert(deleted.idempotent === false, 'first pdpa-delete should not be idempotent noop');
  assert(deleted.anonymized_orders === 1, `pdpa-delete should anonymize one order, got ${deleted.anonymized_orders}`);
  await assertDeletedState(seeded);

  const secondDelete = await postEdge('pdpa-delete', admin.accessToken, {
    customer_id: customer.id,
    tenant_id: tenant.id,
  });

  assert(secondDelete.deleted === false, 'second pdpa-delete should not delete rows');
  assert(secondDelete.idempotent === true, 'second pdpa-delete should be idempotent noop');
  await assertPdpaRequestCount(customer.id, 2);

  console.log('e2e-pdpa: PASS (export, cross-tenant denial, delete, order anonymization, storage removal, and idempotent retry)');
}

async function loadTenant() {
  return mustSingle(
    service.from('tenants').select('id,slug').eq('slug', tenantSlug).single(),
    `Demo tenant "${tenantSlug}" not found. Run scripts/seed-demo.mjs first.`,
  );
}

async function loadProduct(tenantId) {
  return mustSingle(
    service
      .from('products')
      .select('id,tenant_id,catalog_key,price_baht,active')
      .eq('tenant_id', tenantId)
      .eq('catalog_key', 'chk-basic')
      .eq('active', true)
      .single(),
    `Active product "chk-basic" not found for tenant "${tenantSlug}". Run scripts/seed-demo.mjs first.`,
  );
}

async function createOtherTenant() {
  const suffix = randomUUID().slice(0, 8);
  const tenantRow = await mustSingle(
    service
      .from('tenants')
      .insert({
        display_name: `E2E PDPA Other ${suffix}`,
        slug: `e2e-pdpa-other-${suffix}`,
      })
      .select('id,slug')
      .single(),
    'Unable to create other tenant for PDPA E2E.',
  );

  created.tenantIds.push(tenantRow.id);

  return tenantRow;
}

async function seedAdminMembership(tenantId, authUserId) {
  const { error } = await service.from('tenant_members').upsert(
    {
      auth_user_id: authUserId,
      role: 'tenant_admin',
      tenant_id: tenantId,
    },
    {
      onConflict: 'tenant_id,auth_user_id',
    },
  );

  if (error) {
    throw new Error(`Unable to seed PDPA E2E tenant admin membership: ${error.message}`);
  }
}

async function seedCustomer(tenantId, authUserId) {
  return mustSingle(
    service
      .from('customers')
      .insert({
        auth_user_id: authUserId,
        nickname: 'E2E PDPA Customer',
        phone: '0899000001',
        tenant_id: tenantId,
      })
      .select('id,tenant_id,auth_user_id,nickname,phone,line_user_id,referred_by,referred_at,created_at')
      .single(),
    'Unable to create PDPA E2E customer.',
  );
}

async function seedPersonalData(tenantId, customerRow, product) {
  await checked(
    service.from('consents').insert({
      customer_id: customerRow.id,
      granted: true,
      kind: 'health_data_collection',
      tenant_id: tenantId,
    }),
    'seed consent',
  );
  await checked(
    service.from('user_facts').insert({
      confidence: 1,
      customer_id: customerRow.id,
      key: 'age',
      source: 'user_form',
      source_ref: randomUUID(),
      status: 'active',
      tenant_id: tenantId,
      value_num: 39,
      value_text: null,
    }),
    'seed user_fact',
  );
  const session = await mustSingle(
    service
      .from('chat_sessions')
      .insert({
        channel: 'pwa',
        customer_id: customerRow.id,
        tenant_id: tenantId,
      })
      .select('id')
      .single(),
    'seed chat_session',
  );

  await checked(
    service.from('chat_messages').insert({
      client_msg_id: randomUUID(),
      content: 'อยากตรวจสุขภาพครับ',
      role: 'user',
      session_id: session.id,
    }),
    'seed chat_message',
  );

  const order = await mustSingle(
    service
      .from('orders')
      .insert({
        amount_baht: product.price_baht,
        buyer_age: 39,
        buyer_name: 'E2E PDPA Buyer',
        buyer_phone: '0899000001',
        channel: 'chat_pwa',
        customer_id: customerRow.id,
        product_id: product.id,
        qty: 1,
        session_id: session.id,
        status: 'awaiting_payment',
        tenant_id: tenantId,
      })
      .select('id')
      .single(),
    'seed order',
  );
  const slipPath = `${tenantId}/${order.id}/pdpa-e2e.png`;

  await uploadStorageObject('payment-slips', slipPath, 'pdpa-slip', 'image/png');
  created.slipPaths.push(slipPath);
  await checked(
    service
      .from('orders')
      .update({ slip_url: slipPath })
      .eq('id', order.id),
    'attach slip path',
  );
  const event = await mustSingle(
    service
      .from('order_events')
      .insert({
        actor: 'e2e:pdpa',
        meta: { reason: 'pdpa_e2e' },
        order_id: order.id,
        to_status: 'awaiting_payment',
      })
      .select('id')
      .single(),
    'seed order_event',
  );
  const labPath = `${tenantId}/${customerRow.id}/pdpa-lab.txt`;

  await uploadStorageObject('lab-reports', labPath, 'pdpa-lab', 'text/plain');
  created.labPaths.push(labPath);
  const report = await mustSingle(
    service
      .from('lab_reports')
      .insert({
        ai_summary_th: 'สรุปผลทดสอบ PDPA',
        customer_id: customerRow.id,
        status: 'ready',
        storage_path: labPath,
        tenant_id: tenantId,
      })
      .select('id')
      .single(),
    'seed lab_report',
  );

  await checked(
    service.from('lab_results').insert({
      confidence: 1,
      confirmed: true,
      report_id: report.id,
      test_code: 'FBS',
      test_name_raw: 'FBS',
      unit: 'mg/dL',
      value: 92,
    }),
    'seed lab_result',
  );
  const wearableImport = await mustSingle(
    service
      .from('wearable_imports')
      .insert({
        customer_id: customerRow.id,
        file_path: `${tenantId}/${customerRow.id}/pdpa-wearable.xml`,
        filename: 'pdpa-wearable.xml',
        metric_count: 1,
        source: 'apple_export',
        tenant_id: tenantId,
      })
      .select('id')
      .single(),
    'seed wearable_import',
  );

  await checked(
    service.from('wearable_metrics').insert({
      customer_id: customerRow.id,
      day: '2026-06-12',
      import_id: wearableImport.id,
      metric: 'steps',
      source: 'apple_export',
      tenant_id: tenantId,
      value: 5600,
    }),
    'seed wearable_metric',
  );

  created.orderIds.push(order.id);
  created.orderEventIds.push(event.id);

  return {
    labPath,
    orderId: order.id,
    reportId: report.id,
    sessionId: session.id,
    slipPath,
  };
}

async function uploadStorageObject(bucket, path, body, contentType) {
  const { error } = await service.storage.from(bucket).upload(path, new Blob([body], { type: contentType }), {
    contentType,
    upsert: true,
  });

  if (error) {
    throw new Error(`Unable to upload ${bucket}/${path}: ${error.message}`);
  }
}

async function assertDeletedState(seeded) {
  await assertZero('user_facts', service.from('user_facts').select('id').eq('customer_id', customer.id));
  await assertZero('consents', service.from('consents').select('id').eq('customer_id', customer.id));
  await assertZero('chat_messages', service.from('chat_messages').select('id').eq('session_id', seeded.sessionId));
  await assertZero('chat_sessions', service.from('chat_sessions').select('id').eq('customer_id', customer.id));
  await assertZero('lab_results', service.from('lab_results').select('id').eq('report_id', seeded.reportId));
  await assertZero('lab_reports', service.from('lab_reports').select('id').eq('customer_id', customer.id));
  await assertZero('wearable_metrics', service.from('wearable_metrics').select('id').eq('customer_id', customer.id));
  await assertZero('wearable_imports', service.from('wearable_imports').select('id').eq('customer_id', customer.id));
  await assertZero('customers', service.from('customers').select('id').eq('id', customer.id));

  const order = await mustSingle(
    service
      .from('orders')
      .select('id,status,customer_id,session_id,buyer_name,buyer_phone,slip_url')
      .eq('id', seeded.orderId)
      .single(),
    'load anonymized order',
  );

  assert(order.status === 'awaiting_payment', 'pdpa-delete must not change order status');
  assert(order.customer_id === null, 'pdpa-delete should detach order customer_id');
  assert(order.session_id === null, 'pdpa-delete should detach order session_id');
  assert(order.buyer_name === ANONYMIZED_BUYER_NAME_TH, `order buyer_name should be anonymized, got ${order.buyer_name}`);
  assert(order.buyer_phone === null, 'order buyer_phone should be null');
  assert(order.slip_url === null, 'order slip_url should be null');
  await assertStorageMissing('payment-slips', seeded.slipPath);
  await assertStorageMissing('lab-reports', seeded.labPath);
  await assertPdpaRequestCount(customer.id, 2);
}

async function assertPdpaRequestCount(customerId, expectedCount) {
  const rows = await mustMany(
    service
      .from('pdpa_requests')
      .select('id,kind,completed_at')
      .eq('tenant_id', tenant.id)
      .eq('customer_id', customerId),
    'load pdpa_requests',
  );

  assert(rows.length === expectedCount, `expected ${expectedCount} completed pdpa_requests rows, got ${rows.length}`);
  assert(rows.every((row) => row.completed_at), 'all pdpa_requests rows should be completed');
}

async function assertStorageMissing(bucket, path) {
  const { data, error } = await service.storage.from(bucket).download(path);

  assert(!data && error, `${bucket}/${path} should have been deleted`);
}

async function postEdge(functionName, jwt, body) {
  const response = await fetch(`${endpointBase}/functions/v1/${functionName}`, {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${jwt}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const text = await response.text();
  const envelope = text ? JSON.parse(text) : null;

  if (!response.ok || !envelope?.ok) {
    const detail = (envelope?.error?.message ?? envelope?.message ?? text.slice(0, 500)) || 'no response body';

    throw new Error(`${functionName} failed with status ${response.status}: ${detail}`);
  }

  return envelope.data;
}

async function expectEdgeError(functionName, jwt, body, expectedCode, label) {
  const response = await fetch(`${endpointBase}/functions/v1/${functionName}`, {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${jwt}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const text = await response.text();
  const envelope = text ? JSON.parse(text) : null;

  assert(!response.ok || envelope?.ok === false, `${label}: expected ${functionName} to fail`);
  assert(envelope?.error?.code === expectedCode, `${label}: expected ${expectedCode}, got ${envelope?.error?.code ?? 'missing error code'}`);
}

async function cleanup() {
  await deleteByIds('order_events', created.orderEventIds);
  await deleteByIds('orders', created.orderIds);

  if (created.pdpaRequestCustomerIds.length > 0) {
    await checked(
      service.from('pdpa_requests').delete().in('customer_id', created.pdpaRequestCustomerIds),
      'cleanup pdpa_requests',
    );
  }

  if (tenant) {
    await cleanupResidualPdpaTestData(tenant.id, created.authUserIds);
  }

  if (tenant) {
    await checked(
      service.from('tenant_members').delete().eq('tenant_id', tenant.id).in('auth_user_id', created.authUserIds),
      'cleanup tenant member',
    );
  }

  for (const path of created.slipPaths) {
    await service.storage.from('payment-slips').remove([path]);
  }

  for (const path of created.labPaths) {
    await service.storage.from('lab-reports').remove([path]);
  }

  if (otherTenant) {
    await checked(service.from('tenant_members').delete().eq('tenant_id', otherTenant.id), 'cleanup other tenant members');
  }

  await deleteByIds('tenants', created.tenantIds);

  for (const userId of created.authUserIds) {
    const { error } = await service.auth.admin.deleteUser(userId);

    if (error && !/not found/i.test(error.message)) {
      throw new Error(`Unable to delete PDPA E2E auth user ${userId}: ${error.message}`);
    }
  }
}

async function cleanupResidualPdpaTestData(tenantId, authUserIds) {
  const uniqueAuthIds = [...new Set(authUserIds)].filter(Boolean);

  if (!tenantId || uniqueAuthIds.length === 0) {
    return;
  }

  const customerRows = await mustMany(
    service
      .from('customers')
      .select('id')
      .eq('tenant_id', tenantId)
      .in('auth_user_id', uniqueAuthIds),
    'load residual PDPA customers',
  );
  const customerIds = customerRows.map((row) => row.id);

  if (customerIds.length > 0) {
    await cleanupCustomerDataByIds(tenantId, customerIds);
  }

  await checked(
    service.from('tenant_members').delete().eq('tenant_id', tenantId).in('auth_user_id', uniqueAuthIds),
    'cleanup residual PDPA tenant members',
  );

  const staleTenants = await mustMany(
    service.from('tenants').select('id').like('slug', 'e2e-pdpa-other-%'),
    'load residual PDPA other tenants',
  );
  const staleTenantIds = staleTenants.map((row) => row.id);

  if (staleTenantIds.length > 0) {
    await deleteByFilter('tenant_members', (query) => query.in('tenant_id', staleTenantIds));
    await deleteByIds('tenants', staleTenantIds);
  }
}

async function cleanupCustomerDataByIds(tenantId, customerIds) {
  const uniqueCustomerIds = [...new Set(customerIds)].filter(Boolean);

  if (uniqueCustomerIds.length === 0) {
    return;
  }

  const [sessions, orders, reports] = await Promise.all([
    mustMany(
      service
        .from('chat_sessions')
        .select('id')
        .eq('tenant_id', tenantId)
        .in('customer_id', uniqueCustomerIds),
      'load residual PDPA sessions',
    ),
    mustMany(
      service
        .from('orders')
        .select('id,slip_url')
        .eq('tenant_id', tenantId)
        .in('customer_id', uniqueCustomerIds),
      'load residual PDPA orders',
    ),
    mustMany(
      service
        .from('lab_reports')
        .select('id,storage_path')
        .eq('tenant_id', tenantId)
        .in('customer_id', uniqueCustomerIds),
      'load residual PDPA lab reports',
    ),
  ]);
  const sessionIds = sessions.map((row) => row.id);
  const orderIds = orders.map((row) => row.id);
  const reportIds = reports.map((row) => row.id);

  for (const row of orders) {
    if (row.slip_url) {
      await service.storage.from('payment-slips').remove([row.slip_url]);
    }
  }

  for (const row of reports) {
    if (row.storage_path) {
      await service.storage.from('lab-reports').remove([row.storage_path]);
    }
  }

  await deleteByFilter('order_events', (query) => orderIds.length ? query.in('order_id', orderIds) : query.eq('id', '00000000-0000-0000-0000-000000000000'));
  await deleteByIds('orders', orderIds);
  await deleteByFilter('lab_results', (query) => reportIds.length ? query.in('report_id', reportIds) : query.eq('id', '00000000-0000-0000-0000-000000000000'));
  await deleteByFilter('chat_messages', (query) => sessionIds.length ? query.in('session_id', sessionIds) : query.eq('id', '00000000-0000-0000-0000-000000000000'));
  await deleteByIds('chat_sessions', sessionIds);
  await deleteByFilter('consents', (query) => query.in('customer_id', uniqueCustomerIds));
  await deleteByIds('lab_reports', reportIds);
  await deleteByFilter('wearable_metrics', (query) => query.in('customer_id', uniqueCustomerIds));
  await deleteByFilter('wearable_imports', (query) => query.in('customer_id', uniqueCustomerIds));
  await deleteByFilter('user_facts', (query) => query.in('customer_id', uniqueCustomerIds));
  await deleteByFilter('pdpa_requests', (query) => query.in('customer_id', uniqueCustomerIds));
  await deleteByIds('customers', uniqueCustomerIds);
}

async function deleteByIds(table, ids) {
  if (ids.length === 0) {
    return;
  }

  await checked(service.from(table).delete().in('id', [...new Set(ids)]), `cleanup ${table}`);
}

async function deleteByFilter(table, applyFilter) {
  await checked(applyFilter(service.from(table).delete()), `cleanup ${table}`);
}

async function assertZero(label, query) {
  const rows = await mustMany(query, `Unable to load ${label}`);

  assert(rows.length === 0, `${label}: expected zero rows, got ${rows.length}`);
}

async function checked(query, fallbackMessage) {
  const { error } = await query;

  if (error) {
    throw new Error(`${fallbackMessage}: ${error.message}`);
  }
}

async function mustSingle(query, fallbackMessage) {
  const { data, error } = await query;

  if (error || !data) {
    throw new Error(error?.message ?? fallbackMessage);
  }

  return data;
}

async function mustMany(query, fallbackMessage) {
  const { data, error } = await query;

  if (error) {
    throw new Error(`${fallbackMessage}: ${error.message}`);
  }

  return data ?? [];
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
