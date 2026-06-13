import {
  REFERRAL_STORAGE_KEY,
  readStoredReferralCodeWithAdapter,
  storeReferralCodeWithAdapter,
  type ReferralStorageAdapter,
} from '../attributionCore.ts';

declare const Deno: {
  test: (name: string, fn: () => Promise<void> | void) => void;
};

function assertEquals<T>(actual: T, expected: T) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function memoryAdapter(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  const adapter: ReferralStorageAdapter = {
    getItem: (key) => store.get(key),
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
  };

  return { adapter, store };
}

Deno.test('referral attribution stores and reads a normalized 6-character code', async () => {
  const { adapter, store } = memoryAdapter();
  const stored = await storeReferralCodeWithAdapter(' dr-nk22 ', adapter, Date.parse('2026-06-13T00:00:00.000Z'));

  assertEquals(stored?.ref_code, 'DRNK22');
  assertEquals(await readStoredReferralCodeWithAdapter(adapter, Date.parse('2026-07-12T23:59:59.000Z')), 'DRNK22');
  assertEquals(typeof store.get(REFERRAL_STORAGE_KEY), 'string');
});

Deno.test('referral attribution removes expired envelopes', async () => {
  const { adapter, store } = memoryAdapter({
    [REFERRAL_STORAGE_KEY]: JSON.stringify({
      expires_at: '2026-06-12T00:00:00.000Z',
      ref_code: 'DRNK22',
    }),
  });

  assertEquals(await readStoredReferralCodeWithAdapter(adapter, Date.parse('2026-06-13T00:00:00.000Z')), null);
  assertEquals(store.has(REFERRAL_STORAGE_KEY), false);
});

Deno.test('referral attribution rejects malformed codes before writing', async () => {
  const { adapter, store } = memoryAdapter();

  assertEquals(await storeReferralCodeWithAdapter('I-L-O-U', adapter), null);
  assertEquals(store.has(REFERRAL_STORAGE_KEY), false);
});
