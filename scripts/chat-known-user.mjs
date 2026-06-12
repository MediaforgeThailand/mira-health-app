import { createClient } from '@supabase/supabase-js';
import { createAuthUserSession, REGRESSION_TEST_EMAIL } from './create-test-jwt.mjs';
import { cleanupAuthUserCustomerData } from './regression-cleanup.mjs';

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const tenantSlug = process.env.MIRA_DEMO_TENANT_SLUG ?? 'demo-hospital';

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error('Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY before running known-user chat proof.');
}

const CHECKUP_MESSAGE = '\u0e2d\u0e22\u0e32\u0e01\u0e15\u0e23\u0e27\u0e08\u0e2a\u0e38\u0e02\u0e20\u0e32\u0e1e\u0e04\u0e23\u0e31\u0e1a';
const KNOWN_CONCERN = '\u0e19\u0e49\u0e33\u0e15\u0e32\u0e25';
const AGE_QUESTION_PATTERN = /\u0e2d\u0e32\u0e22\u0e38.*(\u0e40\u0e17\u0e48\u0e32\u0e44\u0e2b\u0e23\u0e48|\u0e01\u0e35\u0e48\u0e1b\u0e35|\u0e40\u0e17\u0e48\u0e32\u0e44\u0e23)/u;
const KNOWN_CONCERN_COLLECTION_PATTERN =
  /(\u0e01\u0e31\u0e07\u0e27\u0e25|\u0e2b\u0e48\u0e27\u0e07|\u0e2a\u0e19\u0e43\u0e08).*(\u0e2d\u0e30\u0e44\u0e23|\u0e40\u0e23\u0e37\u0e48\u0e2d\u0e07\u0e2d\u0e30\u0e44\u0e23|\u0e40\u0e23\u0e37\u0e48\u0e2d\u0e07\u0e44\u0e2b\u0e19|\u0e14\u0e49\u0e32\u0e19\u0e44\u0e2b\u0e19)/u;

const session = await createAuthUserSession({
  email: REGRESSION_TEST_EMAIL,
  purpose: 'miracare-known-user',
});
const jwt = session.accessToken;
const authUserId = session.user.id;

await cleanupAuthUserCustomerData({
  authUserId,
  label: 'chat-known-user',
});

const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
const endpoint = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/chat-orchestrator`;
const tenant = await mustSingle(
  service.from('tenants').select('id,slug').eq('slug', tenantSlug).single(),
  `Tenant ${tenantSlug} not found.`,
);
const customer = await seedCustomer({ authUserId, tenantId: tenant.id });
const previousSession = await seedPreviousSession({ customerId: customer.id, tenantId: tenant.id });

await seedConsent({ customerId: customer.id, tenantId: tenant.id });
await seedKnownFacts({
  customerId: customer.id,
  previousSessionId: previousSession.id,
  tenantId: tenant.id,
});

const result = await postChat({
  message: CHECKUP_MESSAGE,
  sessionId: null,
});
const questionSegments = extractQuestionSegments(result.text);

assert(result.session_id && result.session_id !== previousSession.id, 'known-user proof should open a new chat session.');
assert(!result.text.includes('[['), 'known-user reply should strip markers.');
assert(!AGE_QUESTION_PATTERN.test(result.text), 'known-user reply should not ask for age when age is already known.');
assert(
  !questionSegments.some((segment) => KNOWN_CONCERN_COLLECTION_PATTERN.test(segment) && !segment.includes(KNOWN_CONCERN)),
  'known-user reply should not re-ask the already known health concern.',
);
assert(questionSegments.length >= 1, 'known-user reply should ask one follow-up question about an unknown detail.');

console.log('PASS known-user previous facts used without re-asking age or known concern');

async function seedCustomer({ authUserId, tenantId }) {
  return mustSingle(
    service
      .from('customers')
      .insert({
        auth_user_id: authUserId,
        nickname: 'Known User',
        phone: '0800003535',
        tenant_id: tenantId,
      })
      .select('id,tenant_id,auth_user_id,nickname,phone')
      .single(),
    'Unable to seed known-user customer.',
  );
}

async function seedPreviousSession({ customerId, tenantId }) {
  return mustSingle(
    service
      .from('chat_sessions')
      .insert({
        channel: 'pwa',
        customer_id: customerId,
        last_message_at: '2026-01-01T00:00:00.000Z',
        tenant_id: tenantId,
      })
      .select('id')
      .single(),
    'Unable to seed previous chat session.',
  );
}

async function seedConsent({ customerId, tenantId }) {
  await checked(
    service.from('consents').insert({
      customer_id: customerId,
      granted: true,
      kind: 'health_data_collection',
      tenant_id: tenantId,
    }),
    'seed known-user consent',
  );
}

async function seedKnownFacts({ customerId, previousSessionId, tenantId }) {
  await checked(
    service.from('user_facts').insert([
      {
        confidence: 1,
        customer_id: customerId,
        key: 'age',
        source: 'chat_extraction',
        source_ref: previousSessionId,
        status: 'active',
        tenant_id: tenantId,
        value_num: 35,
        value_text: null,
      },
      {
        confidence: 1,
        customer_id: customerId,
        key: 'health_concerns',
        source: 'chat_extraction',
        source_ref: previousSessionId,
        status: 'active',
        tenant_id: tenantId,
        value_num: null,
        value_text: KNOWN_CONCERN,
      },
    ]),
    'seed known-user facts',
  );
}

async function postChat({ message, sessionId }) {
  const response = await fetch(endpoint, {
    body: JSON.stringify({
      action: null,
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

function extractQuestionSegments(text) {
  const thaiQuestionWords =
    /(\u0e44\u0e2b\u0e21|\u0e40\u0e17\u0e48\u0e32\u0e44\u0e2b\u0e23\u0e48|\u0e40\u0e17\u0e48\u0e32\u0e44\u0e23|\u0e01\u0e35\u0e48\u0e1b\u0e35|\u0e22\u0e31\u0e07\u0e44\u0e07|\u0e2d\u0e30\u0e44\u0e23|\u0e17\u0e35\u0e48\u0e44\u0e2b\u0e19|\u0e40\u0e21\u0e37\u0e48\u0e2d\u0e44\u0e2b\u0e23\u0e48|\u0e2b\u0e23\u0e37\u0e2d\u0e40\u0e1b\u0e25\u0e48\u0e32|\u0e14\u0e49\u0e32\u0e19\u0e44\u0e2b\u0e19|\u0e40\u0e23\u0e37\u0e48\u0e2d\u0e07\u0e44\u0e2b\u0e19)/u;

  return text
    .split(/[\n.!?\u3002]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment && (segment.includes('?') || thaiQuestionWords.test(segment)));
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
