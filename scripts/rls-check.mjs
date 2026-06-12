import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createAuthUserSession } from './create-test-jwt.mjs';

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const tenantSlug = process.env.MIRA_DEMO_TENANT_SLUG ?? 'demo-hospital';

if (!supabaseUrl || !serviceRoleKey || !anonKey) {
  throw new Error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_ANON_KEY before running live RLS checks.');
}

const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
const created = {
  authUserIds: [],
  branchIds: [],
  chatMessageIds: [],
  chatSessionIds: [],
  customerIds: [],
  labReportIds: [],
  orderIds: [],
  productBranchLinks: [],
  productCategoryFilters: [],
  productFilters: [],
  tenantIds: [],
  userFactIds: [],
  wearableImportIds: [],
};
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
      console.warn(`RLS cleanup failed after check error: ${cleanupError.message}`);
    } else {
      throw cleanupError;
    }
  }
}

async function run() {
  const tenant = await mustSingle(
    service.from('tenants').select('id,slug').eq('slug', tenantSlug).single(),
    `Demo tenant "${tenantSlug}" not found. Run scripts/seed-demo.mjs first.`,
  );
  const product = await mustSingle(
    service.from('products').select('id,tenant_id,catalog_key').eq('tenant_id', tenant.id).eq('active', true).limit(1).single(),
    `Demo tenant "${tenantSlug}" has no active products. Run scripts/seed-demo.mjs first.`,
  );
  const [authA, authB] = await Promise.all([
    createAuthUserSession({
      email: 'rls-customer-a@miracare.dev',
      purpose: 'miracare-v2-rls',
    }),
    createAuthUserSession({
      email: 'rls-customer-b@miracare.dev',
      purpose: 'miracare-v2-rls',
    }),
  ]);
  created.authUserIds.push(authA.user.id, authB.user.id);

  const [customerA, customerB] = await Promise.all([
    upsertCustomer(tenant.id, authA.user.id, 'RLS Customer A'),
    upsertCustomer(tenant.id, authB.user.id, 'RLS Customer B'),
  ]);
  created.customerIds.push(customerA.id, customerB.id);

  const fixtures = await seedPrivateRows({
    customerA,
    customerB,
    product,
    tenant,
  });
  const otherTenant = await mustSingle(
    service
      .from('tenants')
      .insert({
        display_name: 'RLS Cross Tenant',
        slug: `rls-cross-${randomUUID().slice(0, 8)}`,
      })
      .select('id,slug')
      .single(),
    'Unable to seed RLS cross-tenant row.',
  );
  created.tenantIds.push(otherTenant.id);

  const customerAClient = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${authA.accessToken}`,
      },
    },
  });

  await expectOne('customer A can read own customer row', customerAClient.from('customers').select('id').eq('id', customerA.id));
  await expectOne('customer A can read own user_facts row', customerAClient.from('user_facts').select('id').eq('id', fixtures.factA.id));
  await expectOne('customer A can read own order row', customerAClient.from('orders').select('id').eq('id', fixtures.orderA.id));
  await expectOne('customer A can read own chat message row', customerAClient.from('chat_messages').select('id').eq('id', fixtures.messageA.id));
  await expectOne('customer A can read own lab report row', customerAClient.from('lab_reports').select('id').eq('id', fixtures.labReportA.id));
  await expectOne('customer A can read own wearable import row', customerAClient.from('wearable_imports').select('id').eq('id', fixtures.wearableImportA.id));

  await expectZero('customer A cannot read customer B row', customerAClient.from('customers').select('id').eq('id', customerB.id));
  await expectZero('customer A cannot read customer B user_facts row', customerAClient.from('user_facts').select('id').eq('id', fixtures.factB.id));
  await expectZero('customer A cannot read customer B order row', customerAClient.from('orders').select('id').eq('id', fixtures.orderB.id));
  await expectZero('customer A cannot read customer B chat message row', customerAClient.from('chat_messages').select('id').eq('id', fixtures.messageB.id));
  await expectZero('customer A cannot read customer B lab report row', customerAClient.from('lab_reports').select('id').eq('id', fixtures.labReportB.id));
  await expectZero('customer A cannot read customer B wearable import row', customerAClient.from('wearable_imports').select('id').eq('id', fixtures.wearableImportB.id));

  await expectCrossTenantProductWriteDenied(customerAClient, otherTenant.id);
  await runV3CommerceChecks({
    customerAClient,
    otherTenant,
    product,
    tenant,
  });

  console.log('rls-check: PASS (customer isolation and cross-tenant product write denial checked)');
}

async function upsertCustomer(tenantId, authUserId, nickname) {
  return mustSingle(
    service
      .from('customers')
      .upsert(
        {
          auth_user_id: authUserId,
          nickname,
          tenant_id: tenantId,
        },
        {
          onConflict: 'tenant_id,auth_user_id',
        },
      )
      .select('id,tenant_id,auth_user_id')
      .single(),
    `Unable to seed ${nickname}.`,
  );
}

async function seedPrivateRows({ customerA, customerB, product, tenant }) {
  const [factA, factB] = await Promise.all([
    insertRow('user_facts', {
      confidence: 1,
      customer_id: customerA.id,
      key: 'nickname',
      source: 'user_form',
      source_ref: randomUUID(),
      status: 'active',
      tenant_id: tenant.id,
      value_text: 'RLS Customer A private fact',
    }),
    insertRow('user_facts', {
      confidence: 1,
      customer_id: customerB.id,
      key: 'nickname',
      source: 'user_form',
      source_ref: randomUUID(),
      status: 'active',
      tenant_id: tenant.id,
      value_text: 'RLS Customer B private fact',
    }),
  ]);
  created.userFactIds.push(factA.id, factB.id);

  const [sessionA, sessionB] = await Promise.all([
    insertRow('chat_sessions', {
      channel: 'app',
      customer_id: customerA.id,
      last_message_at: new Date().toISOString(),
      tenant_id: tenant.id,
    }),
    insertRow('chat_sessions', {
      channel: 'app',
      customer_id: customerB.id,
      last_message_at: new Date().toISOString(),
      tenant_id: tenant.id,
    }),
  ]);
  created.chatSessionIds.push(sessionA.id, sessionB.id);

  const [messageA, messageB] = await Promise.all([
    insertRow('chat_messages', {
      client_msg_id: randomUUID(),
      content: 'RLS Customer A private message',
      role: 'user',
      session_id: sessionA.id,
    }),
    insertRow('chat_messages', {
      client_msg_id: randomUUID(),
      content: 'RLS Customer B private message',
      role: 'user',
      session_id: sessionB.id,
    }),
  ]);
  created.chatMessageIds.push(messageA.id, messageB.id);

  const [orderA, orderB] = await Promise.all([
    insertRow('orders', {
      amount_baht: 1000,
      buyer_name: 'RLS Customer A',
      buyer_phone: '0811111111',
      channel: 'chat_app',
      customer_id: customerA.id,
      product_id: product.id,
      qty: 1,
      session_id: sessionA.id,
      status: 'submitted',
      tenant_id: tenant.id,
    }),
    insertRow('orders', {
      amount_baht: 1000,
      buyer_name: 'RLS Customer B',
      buyer_phone: '0822222222',
      channel: 'chat_app',
      customer_id: customerB.id,
      product_id: product.id,
      qty: 1,
      session_id: sessionB.id,
      status: 'submitted',
      tenant_id: tenant.id,
    }),
  ]);
  created.orderIds.push(orderA.id, orderB.id);

  const [labReportA, labReportB] = await Promise.all([
    insertRow('lab_reports', {
      collected_date: new Date().toISOString().slice(0, 10),
      customer_id: customerA.id,
      status: 'ready',
      storage_path: `rls/${customerA.id}/report.jpg`,
      tenant_id: tenant.id,
    }),
    insertRow('lab_reports', {
      collected_date: new Date().toISOString().slice(0, 10),
      customer_id: customerB.id,
      status: 'ready',
      storage_path: `rls/${customerB.id}/report.jpg`,
      tenant_id: tenant.id,
    }),
  ]);
  created.labReportIds.push(labReportA.id, labReportB.id);
  const [wearableImportA, wearableImportB] = await Promise.all([
    insertRow('wearable_imports', {
      customer_id: customerA.id,
      file_path: `rls/${customerA.id}/wearable.xml`,
      filename: 'wearable-a.xml',
      metric_count: 1,
      source: 'manual',
      tenant_id: tenant.id,
    }),
    insertRow('wearable_imports', {
      customer_id: customerB.id,
      file_path: `rls/${customerB.id}/wearable.xml`,
      filename: 'wearable-b.xml',
      metric_count: 1,
      source: 'manual',
      tenant_id: tenant.id,
    }),
  ]);
  created.wearableImportIds.push(wearableImportA.id, wearableImportB.id);

  return {
    factA,
    factB,
    labReportA,
    labReportB,
    messageA,
    messageB,
    orderA,
    orderB,
    wearableImportA,
    wearableImportB,
  };
}

async function insertRow(table, row) {
  return mustSingle(service.from(table).insert(row).select('id').single(), `Unable to seed ${table} row.`);
}

async function expectOne(label, query) {
  const { data, error } = await query;

  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }

  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error(`${label}: expected 1 visible row, got ${Array.isArray(data) ? data.length : 0}.`);
  }
}

async function expectZero(label, query) {
  const { data, error } = await query;

  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }

  if (Array.isArray(data) && data.length !== 0) {
    throw new Error(`${label}: expected 0 visible rows, got ${data.length}.`);
  }
}

async function expectCrossTenantProductWriteDenied(customerClient, tenantId) {
  const catalogKey = `rls-cross-${randomUUID().slice(0, 8)}`;
  created.productFilters.push({
    catalogKey,
    tenantId,
  });

  const { data, error } = await customerClient
    .from('products')
    .insert({
      active: true,
      catalog_key: catalogKey,
      category: 'checkup',
      description: 'Forbidden cross-tenant RLS write probe.',
      name: 'Forbidden RLS Product',
      price_baht: 1,
      tenant_id: tenantId,
    })
    .select('id');

  if (!error) {
    throw new Error(`customer A can insert cross-tenant products row (${data?.[0]?.id ?? 'unknown id'}).`);
  }
}

async function runV3CommerceChecks({ customerAClient, otherTenant, product, tenant }) {
  if (!(await hasV3CommerceTables())) {
    console.warn('rls-check: SKIP v3 branch/category/product_branch checks because the additive V3-1 migration is not applied yet.');
    return;
  }

  try {
    const suffix = randomUUID().slice(0, 8);
    const [branchA, inactiveBranchA, otherBranch] = await Promise.all([
    mustSingle(
      service
        .from('branches')
        .insert({
          active: true,
          address: 'RLS visible branch address',
          district: 'RLS',
          name: `RLS Branch ${suffix}`,
          sort: 900,
          tenant_id: tenant.id,
        })
        .select('id,tenant_id')
        .single(),
      'Unable to seed V3 active branch.',
    ),
    mustSingle(
      service
        .from('branches')
        .insert({
          active: false,
          name: `RLS Inactive Branch ${suffix}`,
          sort: 901,
          tenant_id: tenant.id,
        })
        .select('id,tenant_id')
        .single(),
      'Unable to seed V3 inactive branch.',
    ),
    mustSingle(
      service
        .from('branches')
        .insert({
          active: true,
          name: `RLS Other Tenant Branch ${suffix}`,
          sort: 902,
          tenant_id: otherTenant.id,
        })
        .select('id,tenant_id')
        .single(),
      'Unable to seed V3 other-tenant branch.',
    ),
  ]);
  created.branchIds.push(branchA.id, inactiveBranchA.id, otherBranch.id);

  const categoryKey = `rls-cat-${suffix}`;
  const inactiveCategoryKey = `rls-inactive-${suffix}`;
  const otherCategoryKey = `rls-other-${suffix}`;

  await Promise.all([
    mustSingle(
      service
        .from('product_categories')
        .insert({
          active: true,
          key: categoryKey,
          label_th: 'RLS Category',
          sort: 900,
          tenant_id: tenant.id,
        })
        .select('tenant_id,key')
        .single(),
      'Unable to seed V3 active category.',
    ),
    mustSingle(
      service
        .from('product_categories')
        .insert({
          active: false,
          key: inactiveCategoryKey,
          label_th: 'RLS Inactive Category',
          sort: 901,
          tenant_id: tenant.id,
        })
        .select('tenant_id,key')
        .single(),
      'Unable to seed V3 inactive category.',
    ),
    mustSingle(
      service
        .from('product_categories')
        .insert({
          active: true,
          key: otherCategoryKey,
          label_th: 'RLS Other Category',
          sort: 902,
          tenant_id: otherTenant.id,
        })
        .select('tenant_id,key')
        .single(),
      'Unable to seed V3 other-tenant category.',
    ),
  ]);
  created.productCategoryFilters.push(
    { key: categoryKey, tenantId: tenant.id },
    { key: inactiveCategoryKey, tenantId: tenant.id },
    { key: otherCategoryKey, tenantId: otherTenant.id },
  );

  await mustSingle(
    service.from('product_branches').insert({ branch_id: branchA.id, product_id: product.id }).select('branch_id,product_id').single(),
    'Unable to seed V3 product branch link.',
  );
  created.productBranchLinks.push({
    branchId: branchA.id,
    productId: product.id,
  });

  await expectOne('customer A can read active branch in own tenant', customerAClient.from('branches').select('id').eq('id', branchA.id));
  await expectZero('customer A cannot read inactive branch in own tenant', customerAClient.from('branches').select('id').eq('id', inactiveBranchA.id));
  await expectZero('customer A cannot read active branch in another tenant', customerAClient.from('branches').select('id').eq('id', otherBranch.id));
  await expectOne(
    'customer A can read active category in own tenant',
    customerAClient.from('product_categories').select('key').eq('tenant_id', tenant.id).eq('key', categoryKey),
  );
  await expectZero(
    'customer A cannot read inactive category in own tenant',
    customerAClient.from('product_categories').select('key').eq('tenant_id', tenant.id).eq('key', inactiveCategoryKey),
  );
  await expectZero(
    'customer A cannot read active category in another tenant',
    customerAClient.from('product_categories').select('key').eq('tenant_id', otherTenant.id).eq('key', otherCategoryKey),
  );
  await expectOne(
    'customer A can read active product branch link in own tenant',
    customerAClient.from('product_branches').select('product_id,branch_id').eq('product_id', product.id).eq('branch_id', branchA.id),
  );

  await expectWriteDenied(
    'customer A cannot insert branches',
    customerAClient
      .from('branches')
      .insert({
        active: true,
        name: `Forbidden Branch ${suffix}`,
        tenant_id: tenant.id,
      })
      .select('id'),
  );
  await expectWriteDenied(
    'customer A cannot insert product_categories',
    customerAClient
      .from('product_categories')
      .insert({
        active: true,
        key: `forbidden-${suffix}`,
        label_th: 'Forbidden',
        tenant_id: tenant.id,
      })
      .select('key'),
  );
  await expectWriteDenied(
    'customer A cannot insert product_branches',
    customerAClient.from('product_branches').insert({ branch_id: otherBranch.id, product_id: product.id }).select('branch_id,product_id'),
  );

    console.log('rls-check: PASS (v3 branch/category/product_branch checks)');
  } catch (error) {
    if (isMissingRelation(error)) {
      console.warn('rls-check: SKIP v3 branch/category/product_branch checks because the additive V3-1 migration is not visible in the REST schema cache yet.');
      return;
    }

    throw error;
  }
}

async function hasV3CommerceTables() {
  const probes = [
    ['branches', 'id'],
    ['product_categories', 'tenant_id'],
    ['product_branches', 'product_id'],
  ];

  for (const [table, column] of probes) {
    const { error } = await service.from(table).select(column, { count: 'exact', head: true }).limit(1);

    if (error) {
      if (isMissingRelation(error)) {
        return false;
      }

      throw new Error(`Unable to probe ${table}: ${error.message}`);
    }
  }

  return true;
}

function isMissingRelation(error) {
  return error.code === '42P01' || error.code === 'PGRST205' || /could not find|does not exist|schema cache/i.test(error.message ?? '');
}

async function expectWriteDenied(label, query) {
  const { data, error } = await query;

  if (!error) {
    throw new Error(`${label}: write unexpectedly succeeded (${JSON.stringify(data ?? [])}).`);
  }
}

async function cleanup() {
  for (const link of created.productBranchLinks) {
    await service.from('product_branches').delete().eq('product_id', link.productId).eq('branch_id', link.branchId);
  }

  for (const filter of created.productCategoryFilters) {
    await service.from('product_categories').delete().eq('tenant_id', filter.tenantId).eq('key', filter.key);
  }

  await deleteByIds('branches', created.branchIds);
  await deleteByIds('lab_reports', created.labReportIds);
  await deleteByIds('orders', created.orderIds);
  await deleteByIds('chat_messages', created.chatMessageIds);
  await deleteByIds('chat_sessions', created.chatSessionIds);
  await deleteByIds('user_facts', created.userFactIds);
  await deleteByIds('wearable_imports', created.wearableImportIds);

  for (const filter of created.productFilters) {
    await service.from('products').delete().eq('tenant_id', filter.tenantId).eq('catalog_key', filter.catalogKey);
  }

  await deleteByIds('customers', created.customerIds);
  await deleteByIds('tenants', created.tenantIds);

  for (const userId of created.authUserIds) {
    const { error } = await service.auth.admin.deleteUser(userId);

    if (error) {
      throw new Error(`Unable to delete RLS auth user ${userId}: ${error.message}`);
    }
  }
}

async function deleteByIds(table, ids) {
  if (ids.length === 0) {
    return;
  }

  const { error } = await service.from(table).delete().in('id', ids);

  if (error) {
    throw new Error(`Unable to clean up ${table}: ${error.message}`);
  }
}

async function mustSingle(query, fallbackMessage) {
  const { data, error } = await query;

  if (error || !data) {
    throw new Error(error?.message ?? fallbackMessage);
  }

  return data;
}
