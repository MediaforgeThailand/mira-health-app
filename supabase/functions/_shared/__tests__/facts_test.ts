import { insertFactsIdempotent, normalizeFactCandidates, recordFormAgeFact, renderFactsThai } from '../facts.ts';
import type { FactKeyRow, UserFactRow } from '../types.ts';

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

const registry: FactKeyRow[] = [
  { key: 'age', unit: 'year', value_kind: 'number' },
  { key: 'birth_year', unit: 'year', value_kind: 'number' },
  { key: 'nickname', unit: null, value_kind: 'text' },
  { key: 'weight_kg', unit: 'kg', value_kind: 'number' },
];

type FetchCall = {
  body: Record<string, unknown> | null;
  method: string;
  url: URL;
};

function userFact(overrides: Partial<UserFactRow> = {}): UserFactRow {
  return {
    confidence: 1,
    created_at: '2026-06-12T00:00:00Z',
    customer_id: 'customer-1',
    id: 'fact-1',
    key: 'age',
    source: 'chat_extraction',
    source_ref: '11111111-1111-4111-8111-111111111111',
    status: 'active',
    superseded_by: null,
    tenant_id: 'tenant-1',
    value_num: 35,
    value_text: null,
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

async function withPostgrestStub(
  handler: (call: FetchCall) => Response,
  run: (calls: FetchCall[]) => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];

  Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async (input, init) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const call = {
      body,
      method: init?.method ?? 'GET',
      url: new URL(url),
    };

    calls.push(call);

    return handler(call);
  };

  try {
    await run(calls);
  } finally {
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
    Deno.env.delete('SUPABASE_URL');
    Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
  }
}

function factRestHandler(consents: Array<{ granted: boolean }>) {
  return (call: FetchCall) => {
    if (call.url.pathname.endsWith('/consents')) {
      return jsonResponse(consents);
    }

    if (call.url.pathname.endsWith('/user_facts') && call.method === 'POST') {
      return jsonResponse([
        userFact({
          confidence: Number(call.body?.confidence),
          customer_id: String(call.body?.customer_id),
          key: String(call.body?.key),
          source: call.body?.source as UserFactRow['source'],
          source_ref: call.body?.source_ref === null ? null : String(call.body?.source_ref),
          status: call.body?.status as UserFactRow['status'],
          tenant_id: String(call.body?.tenant_id),
          value_num: call.body?.value_num === null ? null : Number(call.body?.value_num),
          value_text: call.body?.value_text === null ? null : String(call.body?.value_text),
        }),
      ]);
    }

    if (call.url.pathname.endsWith('/user_facts') && call.method === 'PATCH') {
      return jsonResponse([]);
    }

    if (call.url.pathname.endsWith('/customers') && call.method === 'PATCH') {
      return jsonResponse([]);
    }

    return jsonResponse({ message: `Unexpected ${call.method} ${call.url.pathname}` }, 500);
  };
}

Deno.test('normalizeFactCandidates converts Thai numerals', () => {
  assertEquals(normalizeFactCandidates([{ confidence: 0.8, key: 'weight_kg', value: '๗๐ กก.' }], registry), [
    { confidence: 0.8, key: 'weight_kg', status: 'active', value_num: 70, value_text: null },
  ]);
});

Deno.test('normalizeFactCandidates parses decimal kg values', () => {
  assertEquals(normalizeFactCandidates([{ confidence: 0.8, key: 'weight_kg', value: '70.5 kg' }], registry), [
    { confidence: 0.8, key: 'weight_kg', status: 'active', value_num: 70.5, value_text: null },
  ]);
});

Deno.test('normalizeFactCandidates converts Buddhist birth years', () => {
  assertEquals(normalizeFactCandidates([{ confidence: 0.8, key: 'birth_year', value: '2533' }], registry), [
    { confidence: 0.8, key: 'birth_year', status: 'active', value_num: 1990, value_text: null },
  ]);
});

Deno.test('normalizeFactCandidates stores medium confidence as candidate', () => {
  assertEquals(normalizeFactCandidates([{ confidence: 0.55, key: 'nickname', value: 'บอส' }], registry), [
    { confidence: 0.55, key: 'nickname', status: 'candidate', value_num: null, value_text: 'บอส' },
  ]);
});

Deno.test('renderFactsThai renders active and candidate lines', () => {
  const baseFact = {
    created_at: '2026-06-11T00:00:00Z',
    customer_id: 'customer',
    id: 'fact',
    source: 'chat_extraction',
    source_ref: 'message',
    superseded_by: null,
    tenant_id: 'tenant',
  } satisfies Omit<UserFactRow, 'confidence' | 'key' | 'status' | 'value_num' | 'value_text'>;
  const rendered = renderFactsThai(
    [
      {
        ...baseFact,
        confidence: 0.9,
        key: 'weight_kg',
        status: 'active',
        value_num: 70,
        value_text: null,
      },
    ],
    [
      {
        ...baseFact,
        confidence: 0.5,
        id: 'candidate',
        key: 'nickname',
        status: 'candidate',
        value_num: null,
        value_text: 'บอส',
      },
    ],
    registry,
  );

  assert(rendered.activeLine.includes('น้ำหนัก: 70 กก.'), 'expected active weight line');
  assert(rendered.candidateLine.includes('ชื่อเล่น ~บอส'), 'expected candidate nickname line');
});

Deno.test('insertFactsIdempotent defaults source to chat_extraction', async () => {
  await withPostgrestStub(factRestHandler([]), async (calls) => {
    await insertFactsIdempotent({
      customerId: 'customer-1',
      facts: [
        {
          confidence: 0.6,
          key: 'age',
          status: 'candidate',
          value_num: 35,
          value_text: null,
        },
      ],
      sourceRef: '11111111-1111-4111-8111-111111111111',
      tenantId: 'tenant-1',
    });
    const post = calls.find((call) => call.url.pathname.endsWith('/user_facts') && call.method === 'POST');

    assertEquals(post?.body?.source, 'chat_extraction');
  });
});

Deno.test('insertFactsIdempotent respects source override', async () => {
  await withPostgrestStub(factRestHandler([]), async (calls) => {
    await insertFactsIdempotent({
      customerId: 'customer-1',
      facts: [
        {
          confidence: 0.6,
          key: 'age',
          status: 'candidate',
          value_num: 35,
          value_text: null,
        },
      ],
      source: 'user_form',
      sourceRef: '11111111-1111-4111-8111-111111111111',
      tenantId: 'tenant-1',
    });
    const post = calls.find((call) => call.url.pathname.endsWith('/user_facts') && call.method === 'POST');

    assertEquals(post?.body?.source, 'user_form');
  });
});

Deno.test('recordFormAgeFact writes user_form age fact when consent is granted', async () => {
  await withPostgrestStub(factRestHandler([{ granted: true }]), async (calls) => {
    const row = await recordFormAgeFact({
      age: 35,
      customerId: 'customer-1',
      orderId: '11111111-1111-4111-8111-111111111111',
      tenantId: 'tenant-1',
    });
    const consent = calls.find((call) => call.url.pathname.endsWith('/consents'));
    const post = calls.find((call) => call.url.pathname.endsWith('/user_facts') && call.method === 'POST');

    assert(row?.id === 'fact-1', 'expected inserted fact row to be returned');
    assertEquals(consent?.url.searchParams.get('customer_id'), 'eq.customer-1');
    assertEquals(consent?.url.searchParams.get('kind'), 'eq.health_data_collection');
    assertEquals(consent?.url.searchParams.get('order'), 'created_at.desc');
    assertEquals(post?.body?.key, 'age');
    assertEquals(post?.body?.value_num, 35);
    assertEquals(post?.body?.value_text, null);
    assertEquals(post?.body?.confidence, 1);
    assertEquals(post?.body?.status, 'active');
    assertEquals(post?.body?.source, 'user_form');
    assertEquals(post?.body?.source_ref, '11111111-1111-4111-8111-111111111111');
  });
});

Deno.test('recordFormAgeFact skips silently without consent', async () => {
  await withPostgrestStub(factRestHandler([]), async (calls) => {
    const row = await recordFormAgeFact({
      age: 35,
      customerId: 'customer-1',
      orderId: '11111111-1111-4111-8111-111111111111',
      tenantId: 'tenant-1',
    });

    assertEquals(row, null);
    assert(!calls.some((call) => call.url.pathname.endsWith('/user_facts') && call.method === 'POST'), 'expected no fact insert');
  });
});

Deno.test('recordFormAgeFact skips silently when latest consent is revoked', async () => {
  await withPostgrestStub(factRestHandler([{ granted: false }]), async (calls) => {
    const row = await recordFormAgeFact({
      age: 35,
      customerId: 'customer-1',
      orderId: '11111111-1111-4111-8111-111111111111',
      tenantId: 'tenant-1',
    });

    assertEquals(row, null);
    assert(!calls.some((call) => call.url.pathname.endsWith('/user_facts') && call.method === 'POST'), 'expected no fact insert');
  });
});
