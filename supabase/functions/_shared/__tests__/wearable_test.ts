import { strToU8, zipSync } from 'fflate';

import { AppleHealthParseError, parseAppleHealthExportStream, parseAppleHealthXml } from '../wearable.ts';
import { sampleAppleHealthXml } from './fixtures/apple_health_export.ts';

declare const Deno: {
  env: {
    delete: (key: string) => void;
    get: (key: string) => string | undefined;
    set: (key: string, value: string) => void;
  };
  test: (name: string, fn: () => void) => void;
};

type FetchCall = {
  body: unknown;
  method: string;
  url: string;
};

type TestGlobal = typeof globalThis & {
  __MIRACARE_SUPPRESS_SERVE__?: boolean;
  fetch: typeof fetch;
};

const customerId = '11111111-1111-4111-8111-111111111111';
const importId = '22222222-2222-4222-8222-222222222222';
const metricId = '33333333-3333-4333-8333-333333333333';
const factId = '44444444-4444-4444-8444-444444444444';
const tenantId = '55555555-5555-4555-8555-555555555555';
const storagePath = 'imports/apple-health.xml';

function assertEquals<T>(actual: T, expected: T) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function* chunkBytes(bytes: Uint8Array, size: number) {
  for (let offset = 0; offset < bytes.length; offset += size) {
    yield bytes.slice(offset, offset + size);
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
    },
    status,
  });
}

function serviceRequest(body: Record<string, unknown>) {
  return new Request('http://127.0.0.1/functions/v1/wearable-ingest', {
    body: JSON.stringify(body),
    headers: {
      authorization: 'Bearer service-secret',
      'content-type': 'application/json',
    },
    method: 'POST',
  });
}

async function withWearableIngestFetch(
  options: {
    existingFactForImport?: boolean;
    existingImport?: boolean;
  },
  fn: (calls: FetchCall[]) => Promise<void>,
) {
  const runtime = globalThis as TestGlobal;
  const previousFetch = runtime.fetch;
  const previousServeFlag = runtime.__MIRACARE_SUPPRESS_SERVE__;
  const previousUrl = Deno.env.get('SUPABASE_URL');
  const previousKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const calls: FetchCall[] = [];

  Deno.env.set('SUPABASE_URL', 'http://127.0.0.1:54321');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-secret');
  runtime.__MIRACARE_SUPPRESS_SERVE__ = true;
  runtime.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : init?.body ?? null;

    calls.push({
      body,
      method,
      url,
    });

    if (url.includes('/rest/v1/customers')) {
      return jsonResponse([{
        auth_user_id: 'auth-user',
        created_at: '2026-06-12T00:00:00.000Z',
        id: customerId,
        line_user_id: null,
        nickname: 'Wearable Customer',
        phone: null,
        referred_at: null,
        referred_by: null,
        tenant_id: tenantId,
      }]);
    }

    if (url.includes('/rest/v1/wearable_imports') && method === 'GET') {
      return jsonResponse(options.existingImport ? [wearableImportRow(2)] : []);
    }

    if (url.includes('/rest/v1/wearable_imports') && method === 'POST') {
      return jsonResponse([wearableImportRow(0)]);
    }

    if (url.includes('/storage/v1/object/wearable-imports/')) {
      const xml = [
        '<HealthData>',
        '<Record type="HKQuantityTypeIdentifierStepCount" unit="count" value="1000" startDate="2026-06-03 09:00:00 +0700" endDate="2026-06-03 10:00:00 +0700"/>',
        '<Record type="HKQuantityTypeIdentifierHeight" unit="cm" value="172" startDate="2026-06-03 08:00:00 +0700" endDate="2026-06-03 08:00:00 +0700"/>',
        '</HealthData>',
      ].join('');

      return new Response(new TextEncoder().encode(xml), {
        headers: {
          'content-type': 'application/xml',
        },
      });
    }

    if (url.includes('/rest/v1/wearable_metrics') && method === 'POST') {
      return jsonResponse([{
        customer_id: customerId,
        day: '2026-06-03',
        id: metricId,
        import_id: importId,
        metric: 'steps',
        source: 'apple_export',
        tenant_id: tenantId,
        value: 1000,
      }]);
    }

    if (url.includes('/rest/v1/wearable_imports') && method === 'PATCH') {
      return jsonResponse([wearableImportRow(1)]);
    }

    if (url.includes('/rest/v1/user_facts') && method === 'GET') {
      return jsonResponse(options.existingFactForImport ? [wearableFactRow('active')] : []);
    }

    if (url.includes('/rest/v1/user_facts') && method === 'POST') {
      return jsonResponse([wearableFactRow('active')]);
    }

    if (url.includes('/rest/v1/user_facts') && method === 'PATCH') {
      return jsonResponse([wearableFactRow('superseded')]);
    }

    return jsonResponse({ message: `Unexpected test fetch ${method} ${url}` }, 500);
  };

  try {
    await fn(calls);
  } finally {
    runtime.fetch = previousFetch;
    runtime.__MIRACARE_SUPPRESS_SERVE__ = previousServeFlag;

    if (previousUrl === undefined) {
      Deno.env.delete('SUPABASE_URL');
    } else {
      Deno.env.set('SUPABASE_URL', previousUrl);
    }

    if (previousKey === undefined) {
      Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
    } else {
      Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', previousKey);
    }
  }
}

function wearableImportRow(metricCount: number) {
  return {
    customer_id: customerId,
    file_path: storagePath,
    filename: 'apple-health.xml',
    id: importId,
    imported_at: '2026-06-12T00:00:00.000Z',
    metric_count: metricCount,
    source: 'apple_export',
    tenant_id: tenantId,
  };
}

function wearableFactRow(status: 'active' | 'superseded') {
  return {
    confidence: 0.95,
    created_at: '2026-06-12T00:00:00.000Z',
    customer_id: customerId,
    id: factId,
    key: 'height_cm',
    source: 'wearable',
    source_ref: importId,
    status,
    superseded_by: null,
    tenant_id: tenantId,
    value_num: 172,
    value_text: null,
  };
}

Deno.test('parseAppleHealthXml aggregates daily wearable metrics from sample export', () => {
  const parsed = parseAppleHealthXml(sampleAppleHealthXml);
  const metrics = [...parsed.metrics].sort((a, b) => `${a.metric}:${a.day}`.localeCompare(`${b.metric}:${b.day}`));

  assertEquals(metrics, [
    {
      day: '2026-06-01',
      metric: 'active_energy_kcal',
      value: 120.5,
    },
    {
      day: '2026-06-01',
      metric: 'avg_hr',
      value: 85,
    },
    {
      day: '2026-06-01',
      metric: 'resting_hr',
      value: 62,
    },
    {
      day: '2026-06-01',
      metric: 'sleep_minutes',
      value: 150,
    },
    {
      day: '2026-06-01',
      metric: 'steps',
      value: 3200,
    },
  ]);
});

Deno.test('parseAppleHealthXml keeps latest body samples with normalized units', () => {
  const parsed = parseAppleHealthXml(sampleAppleHealthXml);
  const samples = [...parsed.latestSamples]
    .map((sample) => ({
      ...sample,
      value: Math.round(sample.value * 10) / 10,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  assertEquals(samples, [
    {
      day: '2026-06-02',
      key: 'height_cm',
      value: 172,
    },
    {
      day: '2026-06-01',
      key: 'weight_kg',
      value: 70,
    },
  ]);
});

Deno.test('parseAppleHealthExportStream streams XML chunks and normalizes imperial body units', async () => {
  const xml = [
    '<HealthData>',
    '<Record type="HKQuantityTypeIdentifierBodyMass" unit="lb" value="154.3234" startDate="2026-06-03 08:00:00 +0700" endDate="2026-06-03 08:00:00 +0700"/>',
    '<Record type="HKQuantityTypeIdentifierHeight" unit="in" value="68" startDate="2026-06-03 08:00:00 +0700" endDate="2026-06-03 08:00:00 +0700"/>',
    '<Record type="HKQuantityTypeIdentifierStepCount" unit="count" value="1000" startDate="2026-06-03 09:00:00 +0700" endDate="2026-06-03 10:00:00 +0700"/>',
    '</HealthData>',
  ].join('');
  const parsed = await parseAppleHealthExportStream(chunkBytes(new TextEncoder().encode(xml), 11), {
    contentType: 'application/xml',
    storagePath: 'imports/export.xml',
  });
  const samples = [...parsed.latestSamples]
    .map((sample) => ({
      ...sample,
      value: Math.round(sample.value * 10) / 10,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  assertEquals(samples, [
    {
      day: '2026-06-03',
      key: 'height_cm',
      value: 172.7,
    },
    {
      day: '2026-06-03',
      key: 'weight_kg',
      value: 70,
    },
  ]);
  assertEquals(parsed.metrics, [
    {
      day: '2026-06-03',
      metric: 'steps',
      value: 1000,
    },
  ]);
});

Deno.test('parseAppleHealthExportStream reads export.xml from Apple Health zip chunks', async () => {
  const archive = zipSync({
    'apple_health_export/export.xml': strToU8(sampleAppleHealthXml),
  });
  const parsed = await parseAppleHealthExportStream(chunkBytes(archive, 23), {
    storagePath: 'imports/apple_health_export.zip',
  });
  const steps = parsed.metrics.find((metric) => metric.metric === 'steps' && metric.day === '2026-06-01');

  assertEquals(steps?.value, 3200);
});

Deno.test('parseAppleHealthExportStream rejects zip archives without export.xml', async () => {
  const archive = zipSync({
    'apple_health_export/README.txt': strToU8('No health export here.'),
  });

  try {
    await parseAppleHealthExportStream(chunkBytes(archive, 17), {
      storagePath: 'imports/apple_health_export.zip',
    });
  } catch (error) {
    assertEquals(error instanceof AppleHealthParseError, true);
    assertEquals(error instanceof Error ? error.message : '', 'Apple Health export zip does not contain export.xml.');
    return;
  }

  throw new Error('Expected missing export.xml to be rejected.');
});

Deno.test('wearable-ingest stamps import_id on metrics and source_ref on facts', async () => {
  await withWearableIngestFetch({ existingImport: false }, async (calls) => {
    const { handleWearableIngest } = await import('../../wearable-ingest/index.ts');
    const response = await handleWearableIngest(serviceRequest({
      customer_id: customerId,
      storage_path: storagePath,
    }));
    const envelope = await response.json();

    assertEquals(response.status, 200);
    assertEquals(envelope.data.import.id, importId);
    assertEquals(envelope.data.metrics[0].import_id, importId);

    const metricPost = calls.find((call) => call.method === 'POST' && call.url.includes('/rest/v1/wearable_metrics'));
    const factPost = calls.find((call) => call.method === 'POST' && call.url.includes('/rest/v1/user_facts'));

    assertEquals((metricPost?.body as { import_id?: string } | undefined)?.import_id, importId);
    assertEquals((factPost?.body as { source_ref?: string } | undefined)?.source_ref, importId);
  });
});

Deno.test('wearable-ingest reuses an existing import row and does not duplicate its fact', async () => {
  await withWearableIngestFetch({ existingFactForImport: true, existingImport: true }, async (calls) => {
    const { handleWearableIngest } = await import('../../wearable-ingest/index.ts');
    const response = await handleWearableIngest(serviceRequest({
      customer_id: customerId,
      storage_path: storagePath,
    }));
    const envelope = await response.json();

    assertEquals(response.status, 200);
    assertEquals(envelope.data.import.id, importId);
    assertEquals(calls.some((call) => call.method === 'POST' && call.url.includes('/rest/v1/wearable_imports')), false);
    assertEquals(calls.some((call) => call.method === 'POST' && call.url.includes('/rest/v1/user_facts')), false);
  });
});
