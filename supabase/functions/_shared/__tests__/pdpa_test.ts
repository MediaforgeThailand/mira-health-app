import { pdpaRequestSchema, resolvePdpaTarget } from '../pdpa.ts';
import type { CustomerRow } from '../types.ts';

declare const Deno: {
  env: {
    delete: (key: string) => void;
    set: (key: string, value: string) => void;
  };
  test: (name: string, fn: () => void | Promise<void>) => void;
};

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEquals<T>(actual: T, expected: T) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const customerId = '33333333-3333-4333-8333-333333333333';
const customerUserId = '44444444-4444-4444-8444-444444444444';
const adminUserId = '55555555-5555-4555-8555-555555555555';

function customer(overrides: Partial<CustomerRow> = {}): CustomerRow {
  return {
    auth_user_id: customerUserId,
    created_at: '2026-06-12T00:00:00Z',
    id: customerId,
    line_user_id: null,
    nickname: 'PDPA Customer',
    phone: '0812345678',
    referred_at: null,
    referred_by: null,
    tenant_id: tenantA,
    ...overrides,
  };
}

type FetchCall = {
  method: string;
  url: URL;
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

function eqParam(url: URL, key: string) {
  return url.searchParams.get(key)?.replace(/^eq\./, '') ?? null;
}

async function withPdpaStub({
  authUserId,
  customers = [customer()],
  memberships = [],
}: {
  authUserId: string;
  customers?: CustomerRow[];
  memberships?: Array<{ auth_user_id: string; role: string; tenant_id: string }>;
}, run: (calls: FetchCall[]) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];

  Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    const call = {
      method: init?.method ?? 'GET',
      url,
    };

    calls.push(call);

    if (url.pathname.endsWith('/auth/v1/user')) {
      return jsonResponse({ id: authUserId });
    }

    if (url.pathname.endsWith('/rest/v1/customers')) {
      const id = eqParam(url, 'id');
      const tenantId = eqParam(url, 'tenant_id');
      const authId = eqParam(url, 'auth_user_id');

      return jsonResponse(customers.filter((row) =>
        (!id || row.id === id) &&
        (!tenantId || row.tenant_id === tenantId) &&
        (!authId || row.auth_user_id === authId)
      ));
    }

    if (url.pathname.endsWith('/rest/v1/tenant_members')) {
      const tenantId = eqParam(url, 'tenant_id');
      const authId = eqParam(url, 'auth_user_id');

      return jsonResponse(memberships.filter((row) =>
        (!tenantId || row.tenant_id === tenantId) &&
        (!authId || row.auth_user_id === authId)
      ));
    }

    return jsonResponse({ message: `Unexpected ${call.method} ${url.pathname}` }, 500);
  };

  try {
    await run(calls);
  } finally {
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
    Deno.env.delete('SUPABASE_URL');
    Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
  }
}

Deno.test('pdpaRequestSchema allows customer or tenant scoped requests', () => {
  assert(pdpaRequestSchema.safeParse({ customer_id: customerId }).success, 'expected customer_id request to parse');
  assert(pdpaRequestSchema.safeParse({ tenant_slug: 'demo-hospital' }).success, 'expected tenant_slug request to parse');
});

Deno.test('resolvePdpaTarget allows a customer to access their own data', async () => {
  await withPdpaStub({ authUserId: customerUserId }, async () => {
    const target = await resolvePdpaTarget({ customer_id: customerId }, 'Bearer customer-token', 'export');

    assertEquals(target.actor, 'customer');
    assertEquals(target.customerId, customerId);
    assertEquals(target.requestedBy, 'customer');
    assertEquals(target.tenantId, tenantA);
  });
});

Deno.test('resolvePdpaTarget allows tenant_admin access for a tenant customer', async () => {
  await withPdpaStub({
    authUserId: adminUserId,
    memberships: [{ auth_user_id: adminUserId, role: 'tenant_admin', tenant_id: tenantA }],
  }, async () => {
    const target = await resolvePdpaTarget({ customer_id: customerId }, 'Bearer admin-token', 'export');

    assertEquals(target.actor, 'admin');
    assertEquals(target.customerId, customerId);
    assertEquals(target.requestedBy, `admin:${adminUserId}`);
  });
});

Deno.test('resolvePdpaTarget rejects tenant_staff admin access', async () => {
  await withPdpaStub({
    authUserId: adminUserId,
    memberships: [{ auth_user_id: adminUserId, role: 'tenant_staff', tenant_id: tenantA }],
  }, async () => {
    let rejected = false;

    try {
      await resolvePdpaTarget({ customer_id: customerId }, 'Bearer staff-token', 'delete');
    } catch (error) {
      rejected = error instanceof Error && error.message === 'Not allowed for this tenant.';
    }

    assert(rejected, 'expected tenant_staff to be rejected');
  });
});

Deno.test('resolvePdpaTarget rejects cross-tenant admin requests', async () => {
  await withPdpaStub({
    authUserId: adminUserId,
    memberships: [{ auth_user_id: adminUserId, role: 'tenant_admin', tenant_id: tenantB }],
  }, async () => {
    let rejected = false;

    try {
      await resolvePdpaTarget({ customer_id: customerId, tenant_id: tenantB }, 'Bearer admin-token', 'delete');
    } catch (error) {
      rejected = error instanceof Error && error.message === 'Not allowed for this tenant.';
    }

    assert(rejected, 'expected cross-tenant request to be rejected');
  });
});

Deno.test('resolvePdpaTarget allows tenant_admin idempotent delete when the customer row is already gone', async () => {
  await withPdpaStub({
    authUserId: adminUserId,
    customers: [],
    memberships: [{ auth_user_id: adminUserId, role: 'tenant_admin', tenant_id: tenantA }],
  }, async () => {
    const target = await resolvePdpaTarget({ customer_id: customerId, tenant_id: tenantA }, 'Bearer admin-token', 'delete');

    assertEquals(target.actor, 'admin');
    assertEquals(target.customer, null);
    assertEquals(target.customerId, customerId);
    assertEquals(target.tenantId, tenantA);
  });
});
