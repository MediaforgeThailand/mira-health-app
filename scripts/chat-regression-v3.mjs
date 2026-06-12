import { createClient } from '@supabase/supabase-js';
import { createAuthUserSession, REGRESSION_TEST_EMAIL } from './create-test-jwt.mjs';
import { cleanupAuthUserCustomerData } from './regression-cleanup.mjs';

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let jwt = process.env.TEST_SUPABASE_JWT;
let regressionAuthUserId = null;
const tenantSlug = process.env.MIRA_DEMO_TENANT_SLUG ?? 'demo-hospital';

if (!jwt && hasInlineBootstrapEnv()) {
  const session = await createAuthUserSession({
    email: REGRESSION_TEST_EMAIL,
    purpose: 'miracare-v3-regression',
  });

  jwt = session.accessToken;
  regressionAuthUserId = session.user.id;
}

if (!supabaseUrl || !anonKey || !jwt) {
  throw new Error(
    'Set SUPABASE_URL and SUPABASE_ANON_KEY plus either TEST_SUPABASE_JWT or SUPABASE_SERVICE_ROLE_KEY before running v3 chat regression.',
  );
}

if (process.env.MIRA_PROMPT_VERSION) {
  console.warn('chat-regression-v3: local MIRA_PROMPT_VERSION is set. R3 default-flip proof should target a deployed Edge Function with no prompt-version secret.');
}

const endpoint = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/chat-orchestrator`;
await cleanupAuthUserCustomerData({
  authUserId: regressionAuthUserId,
  label: 'chat-regression-v3',
});
const service = serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
  : null;
const seededCatalogKeys = new Set([
  'chk-basic',
  'chk-basic-plus',
  'chk-executive',
  'chk-diabetes',
  'chk-heart',
  'vac-flu',
  'vac-hpv',
]);
let sessionId = null;

const cases = [
  {
    assert: ({ cards, products, text }) => {
      assert(products.length === 0, 'greeting should not return products');
      assert(cards.length === 0, 'greeting should not return cards');
      assert(!text.includes('[['), 'marker should be stripped');
    },
    message: 'สวัสดีครับ',
    name: 'short greeting',
  },
  {
    assert: ({ cards, products }) => {
      assert(products.length === 0, 'broad catalog ask should not return deprecated products');
      assert(cards.some((card) => card.type === 'category_grid' && card.categories.length > 0), 'broad catalog ask should return category_grid');
    },
    message: 'มีแพ็กเกจอะไรบ้าง',
    name: 'category marker',
  },
  {
    assert: ({ cards }) => {
      const grid = productGrid(cards);

      assert(grid, 'vaccine ask should return product_grid');
      assert(grid.products.length <= 4, 'vaccine marker should cap products at 4');
      assert(grid.products.every((product) => product.category === 'vaccine'), 'vaccine ask should return vaccine products only');
      assertSeededProducts(grid.products);
    },
    message: 'มีวัคซีนอะไรบ้าง',
    name: 'vaccine products',
  },
  {
    assert: ({ cards, text }) => {
      assert(cards.length === 0, 'first checkup intake should not return cards');
      assert(questionCount(text) === 1, 'first checkup intake should ask exactly one question');
    },
    message: 'อยากตรวจสุขภาพ',
    name: 'checkup asks age',
  },
  {
    assert: ({ cards, text }) => {
      assert(cards.length === 0, 'second checkup intake should not return cards');
      assert(questionCount(text) === 1, 'second checkup intake should ask exactly one question');
    },
    message: '35 ครับ ช่วงนี้กังวลเรื่องน้ำตาล',
    name: 'age concern asks next',
  },
  {
    assert: ({ cards, text }) => {
      const grid = productGrid(cards);

      assert(grid, 'recommendation should return product_grid');
      assert(grid.products.length >= 1 && grid.products.length <= 4, 'recommendation should return 1-4 products');
      assertSeededProducts(grid.products);
      assert(!text.includes('[['), 'marker should be stripped');
    },
    message: 'จำไม่ได้แล้ว',
    name: 'recommend package',
  },
  {
    assert: ({ cards }) => {
      const grid = productGrid(cards);

      assert(grid, 'price objection should return product_grid');
      assert(grid.products.length >= 1 && grid.products.length <= 4, 'price objection should return 1-4 products');
      assertSeededProducts(grid.products);
    },
    message: 'แพงไปหน่อย ขอคิดดูก่อน',
    name: 'price objection',
  },
  {
    assert: ({ cards, products, text }) => {
      assert(cards.length === 0, 'emergency should not return cards');
      assert(products.length === 0, 'emergency should not return deprecated products');
      assert(text.includes('1669'), 'emergency should mention 1669');
    },
    maxSentences: 5,
    message: 'เจ็บแน่นหน้าอก หายใจไม่ค่อยออก',
    name: 'emergency escalation',
  },
];

for (const testCase of cases) {
  const result = await postChat({
    action: null,
    message: testCase.message,
    sessionId,
  });
  sessionId = result.session_id;
  const maxSentences = testCase.maxSentences ?? 3;

  assert(sentenceCount(result.text) <= maxSentences, `${testCase.name} reply should be 1-${maxSentences} short sentences`);
  testCase.assert(result);
  console.log(`PASS ${testCase.name}`);
}

await runOrderInProgressCase();

if (service) {
  await runOrderStatusCase();
} else {
  console.warn('chat-regression-v3: SKIP order status fixture (SUPABASE_SERVICE_ROLE_KEY not set).');
}

async function runOrderInProgressCase() {
  const selected = await postChat({
    action: {
      catalog_key: 'chk-basic',
      type: 'select_product',
    },
    message: 'ต้องการจองตรวจสุขภาพพื้นฐาน',
    sessionId,
  });

  sessionId = selected.session_id;
  assert(selected.order?.id, 'order in progress setup should create an order');

  const result = await postChat({
    action: null,
    message: 'ต้องทำยังไงต่อ',
    sessionId,
  });

  assert(!/ขอ.*(ชื่อ|เบอร์|อายุ)|แจ้ง.*(ชื่อ|เบอร์|อายุ)/.test(result.text), 'order in progress should not ask for form fields in text');
  assert(result.cards.length === 0, 'order in progress help should not emit a marker card');
  console.log('PASS order in progress form guidance');
}

async function runOrderStatusCase() {
  const session = await loadRegressionSession(sessionId);
  const tenant = await loadTenant();
  const product = await loadProduct(tenant.id, 'chk-basic');
  const order = await seedBookedOrder({
    customerId: session.customer_id,
    product,
    sessionId,
    tenantId: tenant.id,
  });
  const result = await postChat({
    action: null,
    message: 'ถึงคิวหรือยังครับ',
    sessionId,
  });

  assert(result.text.includes('2026-06-20') || result.text.includes('20'), 'order status answer should include the booked date');
  assert(
    result.cards.some((card) => card.type === 'order_status' && card.orders.some((item) => item.id === order.id)),
    'order status answer should include order_status card for the booked order',
  );
  console.log('PASS order status marker');
}

async function seedBookedOrder({ customerId, product, sessionId, tenantId }) {
  const inserted = await mustSingle(
    service
      .from('orders')
      .insert({
        amount_baht: product.price_baht,
        buyer_age: 35,
        buyer_name: 'Regression V3',
        buyer_phone: '0844444444',
        channel: 'chat_pwa',
        customer_id: customerId,
        product_id: product.id,
        qty: 1,
        session_id: sessionId,
        tenant_id: tenantId,
      })
      .select('id')
      .single(),
    'Unable to seed v3 regression order.',
  );

  await transitionOrder(inserted.id, 'awaiting_payment', 'customer', { reason: 'v3_regression_setup' });
  await transitionOrder(inserted.id, 'submitted', 'customer', { reason: 'v3_regression_setup' });
  await transitionOrder(inserted.id, 'confirmed', 'admin:v3-regression', { reason: 'v3_regression_setup' });
  await checked(
    service.from('orders').update({ booking_at: '2026-06-20T02:30:00.000Z' }).eq('id', inserted.id),
    'set v3 regression booking_at',
  );
  await transitionOrder(inserted.id, 'booked', 'admin:v3-regression', { reason: 'v3_regression_setup' });

  return inserted;
}

async function transitionOrder(orderId, toStatus, actor, meta) {
  await checked(
    service.rpc('transition_order', {
      p_actor: actor,
      p_meta: meta,
      p_order_id: orderId,
      p_to_status: toStatus,
    }),
    `transition v3 regression order to ${toStatus}`,
  );
}

async function postChat({ action, message, sessionId }) {
  const response = await fetch(endpoint, {
    body: JSON.stringify({
      action,
      channel: 'pwa',
      client_msg_id: crypto.randomUUID(),
      message,
      session_id: sessionId,
      tenant_slug: tenantSlug,
    }),
    headers: {
      Authorization: `Bearer ${jwt}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const envelope = await response.json();

  if (!response.ok || !envelope.ok) {
    throw new Error(envelope?.error?.message ?? `Chat request failed with ${response.status}`);
  }

  return envelope.data;
}

async function loadTenant() {
  return mustSingle(service.from('tenants').select('id,slug').eq('slug', tenantSlug).single(), `Tenant ${tenantSlug} not found.`);
}

async function loadProduct(tenantId, catalogKey) {
  return mustSingle(
    service.from('products').select('id,catalog_key,price_baht').eq('tenant_id', tenantId).eq('catalog_key', catalogKey).single(),
    `Product ${catalogKey} not found.`,
  );
}

async function loadRegressionSession(id) {
  return mustSingle(
    service.from('chat_sessions').select('id,customer_id').eq('id', id).single(),
    `Regression chat session ${id} not found.`,
  );
}

function productGrid(cards) {
  return cards.find((card) => card.type === 'product_grid') ?? null;
}

function assertSeededProducts(products) {
  for (const product of products) {
    assert(seededCatalogKeys.has(product.catalog_key), `unexpected product id ${product.catalog_key}`);
  }
}

function hasInlineBootstrapEnv() {
  return Boolean(
    (process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL) &&
      (process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

function questionCount(text) {
  const directQuestionMarks = (text.match(/\?|？/g) ?? []).length;
  const thaiQuestionWords =
    /(\u0e44\u0e2b\u0e21|\u0e40\u0e17\u0e48\u0e32\u0e44\u0e2b\u0e23\u0e48|\u0e22\u0e31\u0e07\u0e44\u0e07|\u0e2d\u0e30\u0e44\u0e23|\u0e17\u0e35\u0e48\u0e44\u0e2b\u0e19|\u0e40\u0e21\u0e37\u0e48\u0e2d\u0e44\u0e2b\u0e23\u0e48|\u0e2b\u0e23\u0e37\u0e2d\u0e40\u0e1b\u0e25\u0e48\u0e32)/;
  const thaiQuestionEndings = text
    .split(/[\n.!?。]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment && thaiQuestionWords.test(segment) && /(\u0e04\u0e30|\u0e04\u0e23\u0e31\u0e1a)$/.test(segment))
    .length;

  return directQuestionMarks + thaiQuestionEndings;
}

function sentenceCount(text) {
  return text.split(/นะคะ|นะค่ะ|ค่ะ|คะ|\n/).map((item) => item.trim()).filter(Boolean).length;
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
