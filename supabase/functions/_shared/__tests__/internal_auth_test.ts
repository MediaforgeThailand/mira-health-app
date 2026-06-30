import { HttpError } from '../http.ts';
import { assertInternalServiceRoleAuthorization } from '../internalAuth.ts';

declare const Deno: {
  env: {
    delete: (key: string) => void;
    get: (key: string) => string | undefined;
    set: (key: string, value: string) => void;
  };
  test: (name: string, fn: () => Promise<void> | void) => void;
};

type TestGlobal = typeof globalThis & { __MIRACARE_SUPPRESS_SERVE__?: boolean };
type Handler = (req: Request) => Promise<Response> | Response;

const testUuid = '00000000-0000-4000-8000-000000000001';

async function withServiceConfig(fn: () => Promise<void> | void) {
  const previousUrl = Deno.env.get('SUPABASE_URL');
  const previousKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  Deno.env.set('SUPABASE_URL', 'http://127.0.0.1:54321');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-secret');

  try {
    await fn();
  } finally {
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

function internalRequest(body: Record<string, unknown>) {
  return new Request('http://127.0.0.1/functions/v1/internal', {
    body: JSON.stringify(body),
    headers: {
      authorization: 'Bearer anon-key',
      'content-type': 'application/json',
    },
    method: 'POST',
  });
}

async function expectAnonRejected(name: string, handler: Handler, body: Record<string, unknown>) {
  await withServiceConfig(async () => {
    const response = await handler(internalRequest(body));

    if (response.status !== 401) {
      throw new Error(`${name} should reject anon tokens with 401, received ${response.status}.`);
    }
  });
}

Deno.test('assertInternalServiceRoleAuthorization accepts service role and rejects anon tokens', async () => {
  await withServiceConfig(() => {
    assertInternalServiceRoleAuthorization('Bearer service-secret');

    try {
      assertInternalServiceRoleAuthorization('Bearer anon-key');
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) {
        return;
      }

      throw error;
    }

    throw new Error('Expected internal service-role guard to reject anon token.');
  });
});

Deno.test('fact-extractor rejects anon key calls before internal work', async () => {
  (globalThis as TestGlobal).__MIRACARE_SUPPRESS_SERVE__ = true;
  const { handleFactExtractor } = await import('../../fact-extractor/index.ts');

  await expectAnonRejected('fact-extractor', handleFactExtractor, {
    message_id: testUuid,
  });
});
