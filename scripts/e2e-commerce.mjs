import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createAuthUserSession } from './create-test-jwt.mjs';

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const tenantSlug = process.env.MIRA_DEMO_TENANT_SLUG ?? 'demo-hospital';

const ADMIN_EMAIL = 'e2e-admin@miracare.dev';
const DIRECT_CUSTOMER_EMAIL = 'e2e-customer@miracare.dev';
const REFERRED_CUSTOMER_EMAIL = 'e2e-referred-customer@miracare.dev';
const REFERRER_EMAIL = 'e2e-referrer@miracare.dev';
const REFERRER_NAME = 'E2E Commerce Referrer';
const ASSISTED_BUYER_PHONES = ['0844444444', '0855555555', '0866666666', '0877777777'];

if (!supabaseUrl || !serviceRoleKey || !anonKey) {
  throw new Error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_ANON_KEY before running commerce E2E.');
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
  branchIds: [],
  orderIds: [],
  productIds: [],
  tenantIds: [],
};
let adminAccessToken = null;
let tenant = null;
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
      console.warn(`commerce E2E cleanup failed after test error: ${cleanupError.message}`);
    } else {
      throw cleanupError;
    }
  }
}

async function run() {
  tenant = await loadTenant();
  const product = await loadProduct(tenant.id);
  const [admin, directCustomer, referredCustomer, referrerUser] = await Promise.all([
    createAuthUserSession({
      email: ADMIN_EMAIL,
      purpose: 'miracare-v2-commerce-e2e-admin',
    }),
    createAuthUserSession({
      email: DIRECT_CUSTOMER_EMAIL,
      purpose: 'miracare-v2-commerce-e2e-customer',
    }),
    createAuthUserSession({
      email: REFERRED_CUSTOMER_EMAIL,
      purpose: 'miracare-v2-commerce-e2e-customer',
    }),
    createAuthUserSession({
      email: REFERRER_EMAIL,
      purpose: 'miracare-v3-assisted-purchase-e2e-referrer',
    }),
  ]);

  adminAccessToken = admin.accessToken;
  created.authUserIds.push(admin.user.id, directCustomer.user.id, referredCustomer.user.id, referrerUser.user.id);
  await cleanupResidualTestData(tenant.id, created.authUserIds);
  await seedAdminMembership(tenant.id, admin.user.id);

  const direct = await runPurchaseFlow({
    buyerName: 'E2E Direct Customer',
    buyerPhone: '0811111111',
    customerAccessToken: directCustomer.accessToken,
    expectAgeFact: true,
    grantConsent: true,
    label: 'direct customer purchase',
  });
  await confirmOrderAndAssertNotices({
    expectedCommission: false,
    label: 'direct customer purchase',
    orderId: direct.orderId,
    sessionId: direct.sessionId,
  });
  await assertCommissionEntries(direct.orderId, 0, 'direct purchase should not create commission entries');

  const referrer = await createReferrer(tenant.id, referrerUser.user.id);
  const referred = await runPurchaseFlow({
    buyerName: 'E2E Referred Customer',
    buyerPhone: '0822222222',
    customerAccessToken: referredCustomer.accessToken,
    label: 'referred customer purchase',
    refCode: referrer.ref_code,
  });
  const referredOrder = await loadOrderForCommission(referred.orderId);

  assert(
    referredOrder.referrer_id === referrer.id,
    `referred purchase should snapshot referrer ${referrer.id}, got ${referredOrder.referrer_id ?? 'none'}`,
  );
  assert(referredOrder.commission_scheme_snapshot, 'referred order should snapshot the referrer commission scheme');

  await confirmOrderAndAssertNotices({
    expectedCommission: true,
    label: 'referred customer purchase',
    orderId: referred.orderId,
    sessionId: referred.sessionId,
  });

  const commissionEntry = await assertSingleCommissionEntry(referred.orderId);
  const productCategory = embeddedOne(referredOrder.products)?.category ?? product.category;
  const expectedCommissionAmount = calculateCommissionAmount(
    referredOrder.amount_baht,
    productCategory,
    referredOrder.commission_scheme_snapshot,
  );

  assert(
    commissionEntry.amount_baht === expectedCommissionAmount,
    `commission amount should match snapshot scheme: expected ${expectedCommissionAmount}, got ${commissionEntry.amount_baht}`,
  );

  if (await hasV3CommerceSchema()) {
    await runV3ChatCommerceFlow({
      adminAccessToken,
      customerAccessToken: directCustomer.accessToken,
      referrer,
      referrerAccessToken: referrerUser.accessToken,
      tenantId: tenant.id,
    });
  } else {
    console.log('e2e-commerce: SKIP v3 branch UX checks (branches/product_branches schema not applied on this target)');
  }

  console.log('e2e-commerce: PASS (direct purchase, admin confirm, referral attribution, assisted purchase, commission snapshot, and v3 commerce checks when available)');
}

async function loadTenant() {
  const row = await mustSingle(
    service.from('tenants').select('id,slug,promptpay_id').eq('slug', tenantSlug).single(),
    `Demo tenant "${tenantSlug}" not found. Run scripts/seed-demo.mjs first.`,
  );

  if (!row.promptpay_id) {
    throw new Error(
      `Demo tenant "${tenantSlug}" must have promptpay_id before commerce E2E. ` +
        'Run scripts/seed-demo.mjs with MIRA_DEMO_PROMPTPAY_ID or configure the tenant before retrying.',
    );
  }

  return row;
}

async function loadProduct(tenantId) {
  const row = await mustSingle(
    service
      .from('products')
      .select('id,tenant_id,catalog_key,category,price_baht,active')
      .eq('tenant_id', tenantId)
      .eq('catalog_key', 'chk-basic')
      .eq('active', true)
      .single(),
    `Active product "chk-basic" not found for tenant "${tenantSlug}". Run scripts/seed-demo.mjs first.`,
  );

  assert(row.price_baht > 0, 'chk-basic must have a positive price to generate PromptPay payloads');

  return row;
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
    throw new Error(`Unable to seed commerce E2E tenant admin membership: ${error.message}`);
  }
}

async function createReferrer(tenantId, authUserId) {
  const row = await mustSingle(
    service
      .from('referrers')
      .insert({
        active: true,
        auth_user_id: authUserId,
        commission_scheme: {
          by_category: {},
          default: 10,
          mode: 'percent',
        },
        name: REFERRER_NAME,
        tenant_id: tenantId,
        type: 'staff',
      })
      .select('id,tenant_id,ref_code,commission_scheme,auth_user_id')
      .single(),
    'Unable to create commerce E2E referrer.',
  );

  assert(/^[0-9A-HJKMNP-TV-Z]{6}$/.test(row.ref_code), `generated ref_code has invalid shape: ${row.ref_code}`);
  assert(row.auth_user_id === authUserId, 'created referrer should be linked to the disposable auth user');

  return row;
}

async function runPurchaseFlow({ buyerName, buyerPhone, customerAccessToken, expectAgeFact = false, grantConsent = false, label, refCode }) {
  if (grantConsent) {
    await postChat(customerAccessToken, {
      action: {
        type: 'consent_granted',
      },
      message: `Grant health data consent for ${label}.`,
      ref_code: refCode,
      session_id: null,
    });
  }

  const selected = await postChat(customerAccessToken, {
    action: {
      catalog_key: 'chk-basic',
      type: 'select_product',
    },
    message: `Select chk-basic for ${label}.`,
    ref_code: refCode,
    session_id: null,
  });
  const selectedOrder = selected.order;

  assert(selected.session_id, `${label}: select_product should return a session_id`);
  assert(selectedOrder?.id, `${label}: select_product should create an order panel`);
  created.orderIds.push(selectedOrder.id);

  let activeOrder = selectedOrder;

  if (activeOrder.step === 'branch') {
    const branch = activeOrder.branches?.[0];

    assert(branch?.id, `${label}: branch step should include selectable branches`);
    const branchSelected = await postChat(customerAccessToken, {
      action: {
        branch_id: branch.id,
        order_id: activeOrder.id,
        type: 'select_branch',
      },
      message: `Select branch for ${label}.`,
      session_id: selected.session_id,
    });

    assert(branchSelected.order?.step === 'form', `${label}: select_branch should move to form step`);
    activeOrder = branchSelected.order;
  }

  const infoBefore = await countSystemNotices(selected.session_id);
  const formSubmitted = await postChat(customerAccessToken, {
    action: {
      buyer_age: 35,
      buyer_name: buyerName,
      buyer_phone: buyerPhone,
      order_id: activeOrder.id,
      preferred_date: '2026-07-01',
      type: 'order_form_submit',
    },
    message: `Submit buyer info for ${label}.`,
    session_id: selected.session_id,
  });

  assert(formSubmitted.order?.status === 'awaiting_payment', `${label}: form submit should advance to awaiting_payment`);
  assertPromptPayPayload(formSubmitted.order.qr_payload, `${label}: awaiting_payment should include a valid PromptPay payload`);
  await assertSystemNoticeDelta({
    afterLabel: `${label}: order_form_submit`,
    beforeCount: infoBefore,
    expectedDelta: 1,
    sessionId: selected.session_id,
  });

  if (expectAgeFact) {
    await assertUserFormAgeFact({
      expectedAge: 35,
      expectedCount: 1,
      label: `${label}: age fact after first form submit`,
      orderId: activeOrder.id,
    });
    await expectEdgeError('chat-orchestrator', customerAccessToken, {
      action: {
        buyer_age: 35,
        buyer_name: buyerName,
        buyer_phone: buyerPhone,
        order_id: activeOrder.id,
        preferred_date: '2026-07-01',
        type: 'order_form_submit',
      },
      channel: 'pwa',
      client_msg_id: randomUUID(),
      message: `Resubmit buyer info for ${label}.`,
      session_id: selected.session_id,
      tenant_slug: tenantSlug,
    }, 'VALIDATION', `${label}: duplicate form submit should be rejected`);
    await assertUserFormAgeFact({
      expectedAge: 35,
      expectedCount: 1,
      label: `${label}: age fact stays idempotent after duplicate submit`,
      orderId: activeOrder.id,
    });
  }

  const paymentBefore = await countSystemNotices(selected.session_id);
  const submitted = await postChat(customerAccessToken, {
    action: {
      order_id: activeOrder.id,
      type: 'payment_done',
    },
    message: `Payment done for ${label}.`,
    session_id: selected.session_id,
  });

  assert(submitted.order?.status === 'submitted', `${label}: payment_done should advance to submitted`);
  await assertSystemNoticeDelta({
    afterLabel: `${label}: payment_done`,
    beforeCount: paymentBefore,
    expectedDelta: 1,
    sessionId: selected.session_id,
  });

  return {
    orderId: activeOrder.id,
    sessionId: selected.session_id,
  };
}

async function runV3ChatCommerceFlow({ customerAccessToken, referrer, referrerAccessToken, tenantId }) {
  const suffix = randomUUID().slice(0, 8);
  const products = await seedV3ProductsAndBranches(tenantId, suffix);
  const multi = await postChat(customerAccessToken, {
    action: {
      catalog_key: products.multi.catalog_key,
      type: 'select_product',
    },
    message: `Select ${products.multi.catalog_key}.`,
    session_id: null,
  });

  assert(multi.order?.status === 'selecting_branch', 'v3 multi-branch product should start selecting_branch');
  assert(multi.order?.step === 'branch', 'v3 multi-branch product should render branch step');
  assert(multi.order?.branches?.length === 2, `v3 branch step should expose 2 branches, got ${multi.order?.branches?.length ?? 0}`);
  created.orderIds.push(multi.order.id);

  const chosenBranch = multi.order.branches[0];
  const branched = await postChat(customerAccessToken, {
    action: {
      branch_id: chosenBranch.id,
      order_id: multi.order.id,
      type: 'select_branch',
    },
    message: 'เลือกสาขาแล้ว',
    session_id: multi.session_id,
  });

  assert(branched.order?.status === 'collecting_info', 'v3 select_branch should move order to collecting_info');
  assert(branched.order?.step === 'form', 'v3 select_branch should return form step');
  assert(branched.order?.branch_name === chosenBranch.name, 'v3 branch_name should match selected branch');

  const formSubmitted = await postChat(customerAccessToken, {
    action: {
      buyer_age: 42,
      buyer_name: 'E2E V3 Customer',
      buyer_phone: '0833333333',
      order_id: multi.order.id,
      type: 'order_form_submit',
    },
    message: 'ส่งข้อมูลผู้ซื้อแล้ว',
    session_id: multi.session_id,
  });

  assert(formSubmitted.order?.status === 'awaiting_payment', 'v3 form should advance to awaiting_payment');
  assert(formSubmitted.order?.step === 'qr', 'v3 form should return QR step');
  assertPromptPayPayload(formSubmitted.order.qr_payload, 'v3 form QR payload should be valid PromptPay');

  const paid = await postChat(customerAccessToken, {
    action: {
      order_id: multi.order.id,
      type: 'payment_done',
    },
    message: 'จ่ายแล้ว',
    session_id: multi.session_id,
  });

  assert(paid.order?.status === 'submitted', 'v3 payment should move order to submitted');
  assert(paid.order?.step === 'tracking', 'v3 paid order should return tracking step');

  const confirmed = await postEdge('admin-order-action', adminAccessToken, {
    action: 'confirm',
    order_id: multi.order.id,
  });

  assert(confirmed.order?.status === 'confirmed', 'v3 admin confirm should move to confirmed');

  const bookingAt = '2026-07-20T02:30:00.000Z';
  const booked = await postEdge('admin-order-action', adminAccessToken, {
    action: 'book',
    booking_at: bookingAt,
    order_id: multi.order.id,
  });

  assert(booked.order?.status === 'booked', 'v3 admin book should move to booked');
  // booking_at round-trips through Postgres timestamptz, so the serialized
  // offset format differs from the input string; compare instants instead.
  assert(sameInstant(booked.order?.booking_at, bookingAt), 'v3 admin book should persist booking_at');

  const accountOrder = await loadCustomerVisibleOrder(customerAccessToken, multi.order.id);

  assert(accountOrder.status === 'booked', 'v3 account orders query should show booked status');
  assert(sameInstant(accountOrder.booking_at, bookingAt), 'v3 account orders query should show booking datetime');

  if (process.env.MIRA_E2E_EXPECT_PROMPT_V3 === '1') {
    const statusAnswer = await postChat(customerAccessToken, {
      action: null,
      message: 'ถึงคิวหรือยัง',
      session_id: multi.session_id,
    });

    assert(statusAnswer.text.includes('2026-07-20') || statusAnswer.text.includes('20'), 'v3 order-status answer should include booking date');
    assert(
      statusAnswer.cards?.some((card) => card.type === 'order_status' && card.orders.some((order) => order.id === multi.order.id)),
      'v3 order-status answer should include [[order_status]] card',
    );
  } else {
    console.log('e2e-commerce: SKIP v3 prompt order-status assertion (set MIRA_E2E_EXPECT_PROMPT_V3=1 after staging is env-pinned to prompt v3)');
  }

  const single = await postChat(customerAccessToken, {
    action: {
      catalog_key: products.single.catalog_key,
      type: 'select_product',
    },
    message: `Select ${products.single.catalog_key}.`,
    session_id: null,
  });

  assert(single.order?.status === 'collecting_info', 'v3 single-branch product should skip selecting_branch');
  assert(single.order?.step === 'form', 'v3 single-branch product should open form step');
  assert(!single.order?.branches?.length, 'v3 single-branch product should not include branch choices');
  created.orderIds.push(single.order.id);

  await runAssistedPurchaseFlow({
    products,
    referrer,
    referrerAccessToken,
  });
}

async function runAssistedPurchaseFlow({ products, referrer, referrerAccessToken }) {
  const multiBranches = await postEdge('referrer-order', referrerAccessToken, {
    action: 'list_branches',
    catalog_key: products.multi.catalog_key,
    tenant_slug: tenantSlug,
  });

  assert(multiBranches.branches?.length === 2, `assisted purchase should expose 2 multi-product branches, got ${multiBranches.branches?.length ?? 0}`);

  await expectEdgeError('referrer-order', referrerAccessToken, {
    action: 'create_order',
    buyer_age: 36,
    buyer_name: 'E2E Assisted Missing Branch',
    buyer_phone: '0844444444',
    catalog_key: products.multi.catalog_key,
    tenant_slug: tenantSlug,
  }, 'VALIDATION', 'assisted purchase without branch should fail for multi-branch product');

  await expectEdgeError('referrer-order', referrerAccessToken, {
    action: 'create_order',
    branch_id: products.single.branch_id,
    buyer_age: 36,
    buyer_name: 'E2E Assisted Wrong Branch',
    buyer_phone: '0855555555',
    catalog_key: products.multi.catalog_key,
    tenant_slug: tenantSlug,
  }, 'VALIDATION', 'assisted purchase should reject branch ids not attached to the product');

  await expectEdgeError('referrer-order', referrerAccessToken, {
    action: 'create_order',
    branch_id: products.cross_tenant_branch_id,
    buyer_age: 36,
    buyer_name: 'E2E Assisted Cross Tenant Branch',
    buyer_phone: '0844444444',
    catalog_key: products.multi.catalog_key,
    tenant_slug: tenantSlug,
  }, 'VALIDATION', 'assisted purchase should reject cross-tenant branch ids');

  const chosenBranch = multiBranches.branches[0];
  const multi = await postEdge('referrer-order', referrerAccessToken, {
    action: 'create_order',
    branch_id: chosenBranch.id,
    buyer_age: 36,
    buyer_name: 'E2E Assisted Multi',
    buyer_phone: '0866666666',
    catalog_key: products.multi.catalog_key,
    preferred_date: '2026-07-02',
    tenant_slug: tenantSlug,
  });

  assert(multi.order?.status === 'awaiting_payment', 'assisted multi-branch order should land awaiting_payment');
  assert(multi.order?.step === 'qr', 'assisted multi-branch order should return QR step');
  assert(multi.order?.branch_name === chosenBranch.name, 'assisted multi-branch order should expose resolved branch name');
  assertPromptPayPayload(multi.order?.qr_payload, 'assisted multi-branch order should include a valid PromptPay payload');
  created.orderIds.push(multi.order.id);

  const multiOrder = await loadAssistedOrder(multi.order.id);

  assert(multiOrder.status === 'awaiting_payment', 'assisted multi-branch DB order should be awaiting_payment');
  assert(multiOrder.branch_id === chosenBranch.id, 'assisted multi-branch DB order should store branch_id');
  assert(multiOrder.buyer_age === 36, 'assisted multi-branch DB order should store buyer_age');
  assert(multiOrder.referrer_id === referrer.id, 'assisted multi-branch DB order should store referrer_id');
  await assertNoUserFormAgeFact(multi.order.id, 'assisted multi-branch order should not write age fact without consent');

  const paid = await postEdge('referrer-order', referrerAccessToken, {
    action: 'payment_done',
    order_id: multi.order.id,
    tenant_slug: tenantSlug,
  });

  assert(paid.order?.status === 'submitted', 'assisted payment_done should move order to submitted');

  const confirmed = await postEdge('admin-order-action', adminAccessToken, {
    action: 'confirm',
    order_id: multi.order.id,
  });

  assert(confirmed.order?.status === 'confirmed', 'assisted referrer purchase: admin confirm should move to confirmed');
  await assertCommissionEntries(multi.order.id, 1, 'assisted referrer purchase should create one commission entry');

  const single = await postEdge('referrer-order', referrerAccessToken, {
    action: 'create_order',
    buyer_age: 44,
    buyer_name: 'E2E Assisted Single',
    buyer_phone: '0877777777',
    catalog_key: products.single.catalog_key,
    tenant_slug: tenantSlug,
  });

  assert(single.order?.status === 'awaiting_payment', 'assisted single-branch order should land awaiting_payment');
  assert(single.order?.branch_name, 'assisted single-branch order should expose auto-assigned branch name');
  assertPromptPayPayload(single.order?.qr_payload, 'assisted single-branch order should include a valid PromptPay payload');
  created.orderIds.push(single.order.id);

  const singleOrder = await loadAssistedOrder(single.order.id);

  assert(singleOrder.branch_id === products.single.branch_id, 'assisted single-branch DB order should auto-assign branch_id');
  assert(singleOrder.buyer_age === 44, 'assisted single-branch DB order should store buyer_age');
  await assertNoUserFormAgeFact(single.order.id, 'assisted single-branch order should not write age fact without consent');
}

async function seedV3ProductsAndBranches(tenantId, suffix) {
  const otherTenant = await mustSingle(
    service
      .from('tenants')
      .insert({
        display_name: `E2E Other Tenant ${suffix}`,
        slug: `e2e-other-${suffix}`,
      })
      .select('id')
      .single(),
    'Unable to seed v3 E2E cross-tenant tenant.',
  );
  const [branchA, branchB, branchSingle] = await mustMany(
    service
      .from('branches')
      .insert([
        {
          active: true,
          address: 'V3 E2E Address A',
          district: 'คลองเตย',
          name: `V3 E2E สาขา A ${suffix}`,
          sort: 10,
          tenant_id: tenantId,
        },
        {
          active: true,
          address: 'V3 E2E Address B',
          district: 'วัฒนา',
          name: `V3 E2E สาขา B ${suffix}`,
          sort: 20,
          tenant_id: tenantId,
        },
        {
          active: true,
          address: 'V3 E2E Single Address',
          district: 'สาทร',
          name: `V3 E2E สาขาเดี่ยว ${suffix}`,
          sort: 30,
          tenant_id: tenantId,
        },
      ])
      .select('id,name'),
    'Unable to seed v3 E2E branches.',
  );
  const crossTenantBranch = await mustSingle(
    service
      .from('branches')
      .insert({
        active: true,
        address: 'V3 E2E Other Tenant Address',
        district: 'บางรัก',
        name: `V3 E2E ต่าง tenant ${suffix}`,
        sort: 40,
        tenant_id: otherTenant.id,
      })
      .select('id')
      .single(),
    'Unable to seed v3 E2E cross-tenant branch.',
  );
  const [multi, single] = await mustMany(
    service
      .from('products')
      .insert([
        {
          active: true,
          catalog_key: `e2e-v3-multi-${suffix}`,
          category: 'checkup',
          description: 'E2E multi branch package',
          name: `E2E V3 Multi ${suffix}`,
          price_baht: 1290,
          tenant_id: tenantId,
        },
        {
          active: true,
          catalog_key: `e2e-v3-single-${suffix}`,
          category: 'checkup',
          description: 'E2E single branch package',
          name: `E2E V3 Single ${suffix}`,
          price_baht: 990,
          tenant_id: tenantId,
        },
      ])
      .select('id,catalog_key'),
    'Unable to seed v3 E2E products.',
  );

  created.branchIds.push(branchA.id, branchB.id, branchSingle.id, crossTenantBranch.id);
  created.productIds.push(multi.id, single.id);
  created.tenantIds.push(otherTenant.id);

  await checked(
    service.from('product_branches').insert([
      { branch_id: branchA.id, product_id: multi.id },
      { branch_id: branchB.id, product_id: multi.id },
      { branch_id: branchSingle.id, product_id: single.id },
    ]),
    'seed v3 E2E product branches',
  );

  return {
    multi: {
      ...multi,
      branch_ids: [branchA.id, branchB.id],
    },
    single: {
      ...single,
      branch_id: branchSingle.id,
    },
    cross_tenant_branch_id: crossTenantBranch.id,
  };
}

async function hasV3CommerceSchema() {
  const { error } = await service.from('branches').select('id').limit(1);

  return !isMissingRelationError(error);
}

function isMissingRelationError(error) {
  return Boolean(error && /does not exist|schema cache|Could not find/i.test(error.message ?? ''));
}

async function loadCustomerVisibleOrder(jwt, orderId) {
  const client = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    },
  });
  const row = await mustSingle(
    client.from('orders').select('id,status,booking_at').eq('id', orderId).single(),
    `Unable to load customer-visible order ${orderId}.`,
  );

  return row;
}

async function confirmOrderAndAssertNotices({ expectedCommission, label, orderId, sessionId }) {
  const beforeCount = await countSystemNotices(sessionId);
  const result = await postEdge('admin-order-action', adminAccessToken, {
    action: 'confirm',
    order_id: orderId,
  });

  assert(result.order?.status === 'confirmed', `${label}: admin confirm should move order to confirmed`);
  await assertSystemNoticeDelta({
    afterLabel: `${label}: admin confirm`,
    beforeCount,
    expectedDelta: 1,
    sessionId,
  });

  const commissionCount = await countCommissionEntries(orderId);

  if (expectedCommission) {
    assert(commissionCount === 1, `${label}: referrer-attributed confirm should create one commission entry`);
  } else {
    assert(commissionCount === 0, `${label}: unattributed confirm should not create commission entries`);
  }
}

async function postChat(jwt, { action, message, ref_code: refCode, session_id: sessionId }) {
  return postEdge('chat-orchestrator', jwt, {
    action,
    channel: 'pwa',
    client_msg_id: randomUUID(),
    message,
    ...(refCode ? { ref_code: refCode } : {}),
    session_id: sessionId,
    tenant_slug: tenantSlug,
  });
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
  let envelope = null;

  try {
    envelope = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${functionName} returned non-JSON response with status ${response.status}.`);
  }

  if (!response.ok || !envelope?.ok) {
    throw new Error(envelope?.error?.message ?? `${functionName} failed with status ${response.status}`);
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
  let envelope = null;

  try {
    envelope = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${label}: ${functionName} returned non-JSON response with status ${response.status}.`);
  }

  assert(!response.ok || envelope?.ok === false, `${label}: expected ${functionName} to fail`);
  assert(envelope?.error?.code === expectedCode, `${label}: expected ${expectedCode}, got ${envelope?.error?.code ?? 'missing error code'}`);
}

async function countSystemNotices(sessionId) {
  const { count, error } = await service
    .from('chat_messages')
    .select('id', {
      count: 'exact',
      head: true,
    })
    .eq('session_id', sessionId)
    .eq('role', 'system_notice');

  if (error) {
    throw new Error(`Unable to count system notices: ${error.message}`);
  }

  return count ?? 0;
}

async function assertSystemNoticeDelta({ afterLabel, beforeCount, expectedDelta, sessionId }) {
  const afterCount = await countSystemNotices(sessionId);
  const actualDelta = afterCount - beforeCount;

  assert(
    actualDelta === expectedDelta,
    `${afterLabel}: expected ${expectedDelta} new system_notice row, got ${actualDelta}`,
  );
}

async function loadOrderForCommission(orderId) {
  return mustSingle(
    service
      .from('orders')
      .select('id,amount_baht,commission_scheme_snapshot,referrer_id,products(category)')
      .eq('id', orderId)
      .single(),
    `Unable to load order ${orderId} for commission assertion.`,
  );
}

async function loadAssistedOrder(orderId) {
  return mustSingle(
    service
      .from('orders')
      .select('id,status,branch_id,buyer_age,referrer_id')
      .eq('id', orderId)
      .single(),
    `Unable to load assisted order ${orderId}.`,
  );
}

async function countCommissionEntries(orderId) {
  const { count, error } = await service
    .from('commission_entries')
    .select('id', {
      count: 'exact',
      head: true,
    })
    .eq('order_id', orderId);

  if (error) {
    throw new Error(`Unable to count commission entries for order ${orderId}: ${error.message}`);
  }

  return count ?? 0;
}

async function loadUserFormAgeFacts(orderId) {
  const { data, error } = await service
    .from('user_facts')
    .select('id,key,source,source_ref,value_num,status')
    .eq('key', 'age')
    .eq('source', 'user_form')
    .eq('source_ref', orderId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Unable to load user_form age facts for order ${orderId}: ${error.message}`);
  }

  return data ?? [];
}

async function assertUserFormAgeFact({ expectedAge, expectedCount, label, orderId }) {
  const rows = await loadUserFormAgeFacts(orderId);

  assert(rows.length === expectedCount, `${label}: expected ${expectedCount} age fact rows, got ${rows.length}`);

  for (const row of rows) {
    assert(row.key === 'age', `${label}: expected key age, got ${row.key}`);
    assert(row.source === 'user_form', `${label}: expected source user_form, got ${row.source}`);
    assert(row.source_ref === orderId, `${label}: expected source_ref ${orderId}, got ${row.source_ref}`);
    assert(Number(row.value_num) === expectedAge, `${label}: expected value_num ${expectedAge}, got ${row.value_num}`);
    assert(row.status === 'active', `${label}: expected active status, got ${row.status}`);
  }
}

async function assertNoUserFormAgeFact(orderId, label) {
  const rows = await loadUserFormAgeFacts(orderId);

  assert(rows.length === 0, `${label}: expected no user_form age fact rows, got ${rows.length}`);
}

async function assertCommissionEntries(orderId, expectedCount, label) {
  const count = await countCommissionEntries(orderId);

  assert(count === expectedCount, `${label}: expected ${expectedCount} commission entries, got ${count}`);
}

async function assertSingleCommissionEntry(orderId) {
  return mustSingle(
    service
      .from('commission_entries')
      .select('id,order_id,scheme_snapshot,amount_baht,status')
      .eq('order_id', orderId)
      .single(),
    `Expected one commission entry for order ${orderId}.`,
  );
}

function calculateCommissionAmount(amountBaht, category, scheme) {
  const categoryValue = finiteNumber(scheme?.by_category?.[category]);
  const defaultValue = finiteNumber(scheme?.default);
  const rateOrAmount = categoryValue ?? defaultValue ?? 0;

  if (scheme?.mode === 'flat_baht') {
    return Math.max(0, Math.round(rateOrAmount));
  }

  return Math.max(0, Math.round((amountBaht * rateOrAmount) / 100));
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function assertPromptPayPayload(payload, label) {
  assert(typeof payload === 'string' && payload.length > 8, label);

  const payloadWithoutCrc = payload.slice(0, -4);
  const expectedCrc = crc16Ccitt(payloadWithoutCrc);
  const actualCrc = payload.slice(-4).toUpperCase();

  assert(payloadWithoutCrc.endsWith('6304'), `${label}: missing CRC tag 6304`);
  assert(actualCrc === expectedCrc, `${label}: expected CRC ${expectedCrc}, got ${actualCrc}`);
}

function crc16Ccitt(payload) {
  let crc = 0xffff;

  for (let index = 0; index < payload.length; index += 1) {
    crc ^= payload.charCodeAt(index) << 8;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, '0');
}

async function cleanup() {
  if (!tenant) {
    return;
  }

  await cancelCreatedOrders();
  await cleanupResidualTestData(tenant.id, created.authUserIds);
  await cleanupCreatedV3Catalog();

  for (const userId of created.authUserIds) {
    const { error } = await service.auth.admin.deleteUser(userId);

    if (error && !/not found/i.test(error.message)) {
      throw new Error(`Unable to delete commerce E2E auth user ${userId}: ${error.message}`);
    }
  }
}

async function cleanupCreatedV3Catalog() {
  if (created.productIds.length > 0) {
    await checked(service.from('product_branches').delete().in('product_id', created.productIds), 'cleanup v3 e2e product branches');
    await deleteByIds('products', created.productIds);
  }

  if (created.branchIds.length > 0) {
    await deleteByIds('branches', created.branchIds);
  }

  if (created.tenantIds.length > 0) {
    await deleteByIds('tenants', created.tenantIds);
  }
}

async function cancelCreatedOrders() {
  if (!adminAccessToken) {
    return;
  }

  for (const orderId of [...new Set(created.orderIds)]) {
    try {
      await postEdge('admin-order-action', adminAccessToken, {
        action: 'cancel',
        order_id: orderId,
      });
    } catch (error) {
      console.warn(`commerce E2E could not cancel order ${orderId}: ${error.message}`);
    }
  }
}

async function cleanupResidualTestData(tenantId, authUserIds) {
  if (authUserIds.length > 0) {
    await checked(
      service.from('tenant_members').delete().eq('tenant_id', tenantId).in('auth_user_id', authUserIds),
      'cleanup tenant_members',
    );
  }

  const customers = authUserIds.length > 0
    ? await mustMany(
      service.from('customers').select('id').eq('tenant_id', tenantId).in('auth_user_id', authUserIds),
      'Unable to find residual commerce E2E customers.',
    )
    : [];
  const assistedCustomers = await mustMany(
    service.from('customers').select('id').eq('tenant_id', tenantId).in('phone', ASSISTED_BUYER_PHONES),
    'Unable to find residual assisted commerce E2E customers.',
  );
  const customerIds = [...new Set([...customers, ...assistedCustomers].map((row) => row.id))];
  const referrers = await mustMany(
    service.from('referrers').select('id').eq('tenant_id', tenantId).eq('name', REFERRER_NAME),
    'Unable to find residual commerce E2E referrers.',
  );
  const referrerIds = referrers.map((row) => row.id);
  const sessions = customerIds.length > 0
    ? await mustMany(
      service.from('chat_sessions').select('id').eq('tenant_id', tenantId).in('customer_id', customerIds),
      'Unable to find residual commerce E2E sessions.',
    )
    : [];
  const sessionIds = sessions.map((row) => row.id);
  const orderIds = new Set();

  if (customerIds.length > 0) {
    const rows = await mustMany(
      service.from('orders').select('id').eq('tenant_id', tenantId).in('customer_id', customerIds),
      'Unable to find residual commerce E2E customer orders.',
    );

    for (const row of rows) {
      orderIds.add(row.id);
    }
  }

  if (referrerIds.length > 0) {
    const rows = await mustMany(
      service.from('orders').select('id').eq('tenant_id', tenantId).in('referrer_id', referrerIds),
      'Unable to find residual commerce E2E referrer orders.',
    );

    for (const row of rows) {
      orderIds.add(row.id);
    }
  }

  const orderIdList = [...orderIds];

  if (orderIdList.length > 0) {
    await deleteByFilter('commission_entries', (query) => query.in('order_id', orderIdList));
    await deleteByFilter('order_events', (query) => query.in('order_id', orderIdList));
    await deleteByIds('orders', orderIdList);
  }

  if (sessionIds.length > 0) {
    await deleteByFilter('chat_messages', (query) => query.in('session_id', sessionIds));
    await deleteByIds('chat_sessions', sessionIds);
  }

  if (customerIds.length > 0) {
    await deleteByFilter('consents', (query) => query.in('customer_id', customerIds));
    await deleteByFilter('lab_reports', (query) => query.in('customer_id', customerIds));
    await deleteByFilter('user_facts', (query) => query.in('customer_id', customerIds));
    await deleteByIds('customers', customerIds);
  }

  if (referrerIds.length > 0) {
    await deleteByIds('referrers', referrerIds);
  }
}

async function deleteByIds(table, ids) {
  if (ids.length === 0) {
    return;
  }

  await deleteByFilter(table, (query) => query.in('id', ids));
}

async function deleteByFilter(table, applyFilter) {
  await checked(applyFilter(service.from(table).delete()), `cleanup ${table}`);
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
    throw new Error(error.message ?? fallbackMessage);
  }

  return data ?? [];
}

function embeddedOne(value) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sameInstant(actual, expected) {
  if (!actual) {
    return false;
  }

  const actualMs = new Date(actual).getTime();
  const expectedMs = new Date(expected).getTime();

  return Number.isFinite(actualMs) && actualMs === expectedMs;
}
