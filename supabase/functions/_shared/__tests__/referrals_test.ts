import { resolveProductBranchSelection } from '../branches.ts';
import { HttpError } from '../http.ts';
import { referrerOrderRequestSchema } from '../referrerOrder.ts';
import { applyReferralCodeToCustomer, resolveAttributedReferrerId } from '../referrals.ts';
import type { CustomerRow } from '../types.ts';

declare const Deno: {
  test: (name: string, fn: () => void | Promise<void>) => void;
};

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertValidationError(fn: () => unknown, expectedMessage: string) {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof HttpError)) {
      throw new Error('expected HttpError');
    }

    const httpError = error;

    assertEquals(httpError.code, 'VALIDATION');
    assertEquals(httpError.status, 400);
    assertEquals(httpError.message, expectedMessage);
    return;
  }

  throw new Error('Expected validation error');
}

const referrerId = 'referrer-1';
const baseTenant = {
  attribution_window_days: 30,
};
const bindTenant = {
  id: 'tenant-1',
};
const nowMs = Date.parse('2026-06-11T00:00:00.000Z');
const baseReferrerOrderPayload = {
  action: 'create_order',
  buyer_age: 35,
  buyer_name: 'Buyer Name',
  buyer_phone: '0812345678',
  catalog_key: 'chk-basic',
  tenant_slug: 'demo-hospital',
} as const;

function customer(overrides: Partial<CustomerRow> = {}): CustomerRow {
  return {
    auth_user_id: 'auth-user-1',
    created_at: '2026-06-01T00:00:00.000Z',
    id: 'customer-1',
    line_user_id: null,
    nickname: 'Customer',
    phone: null,
    referred_at: null,
    referred_by: null,
    tenant_id: bindTenant.id,
    ...overrides,
  };
}

Deno.test('resolveAttributedReferrerId returns active referral inside attribution window', () => {
  assertEquals(
    resolveAttributedReferrerId(
      {
        referred_at: '2026-06-01T00:00:00.000Z',
        referred_by: referrerId,
      },
      baseTenant,
      nowMs,
    ),
    referrerId,
  );
});

Deno.test('resolveAttributedReferrerId drops expired referral outside attribution window', () => {
  assertEquals(
    resolveAttributedReferrerId(
      {
        referred_at: '2026-05-01T00:00:00.000Z',
        referred_by: referrerId,
      },
      baseTenant,
      nowMs,
    ),
    null,
  );
});

Deno.test('resolveAttributedReferrerId keeps referral through the exact expiry boundary', () => {
  assertEquals(
    resolveAttributedReferrerId(
      {
        referred_at: '2026-05-12T00:00:00.000Z',
        referred_by: referrerId,
      },
      baseTenant,
      nowMs,
    ),
    referrerId,
  );
});

Deno.test('resolveAttributedReferrerId keeps same-instant referral for zero-day attribution window', () => {
  assertEquals(
    resolveAttributedReferrerId(
      {
        referred_at: '2026-06-11T00:00:00.000Z',
        referred_by: referrerId,
      },
      {
        attribution_window_days: 0,
      },
      nowMs,
    ),
    referrerId,
  );
});

Deno.test('resolveAttributedReferrerId treats negative attribution windows as zero days', () => {
  assertEquals(
    resolveAttributedReferrerId(
      {
        referred_at: '2026-06-10T23:59:59.000Z',
        referred_by: referrerId,
      },
      {
        attribution_window_days: -7,
      },
      nowMs,
    ),
    null,
  );
});

Deno.test('resolveAttributedReferrerId returns null for missing or invalid attribution data', () => {
  assertEquals(resolveAttributedReferrerId({ referred_at: null, referred_by: referrerId }, baseTenant, nowMs), null);
  assertEquals(resolveAttributedReferrerId({ referred_at: '2026-06-01T00:00:00.000Z', referred_by: null }, baseTenant, nowMs), null);
  assertEquals(resolveAttributedReferrerId({ referred_at: 'not-a-date', referred_by: referrerId }, baseTenant, nowMs), null);
});

Deno.test('applyReferralCodeToCustomer binds a fresh customer to an active code', async () => {
  let selectedRefCode = '';
  let updatedReferrerId = '';
  const originalCustomer = customer();
  const updatedCustomer = await applyReferralCodeToCustomer(originalCustomer, bindTenant, 'ABC123', {
    nowIso: () => '2026-06-15T00:00:00.000Z',
    selectReferrer: async (_tenantId, refCode) => {
      selectedRefCode = refCode;

      return { id: referrerId };
    },
    updateCustomerReferral: async (_customerId, _tenantId, nextReferrerId, referredAt) => {
      updatedReferrerId = nextReferrerId;

      return customer({
        referred_at: referredAt,
        referred_by: nextReferrerId,
      });
    },
  });

  assertEquals(selectedRefCode, 'ABC123');
  assertEquals(updatedReferrerId, referrerId);
  assertEquals(updatedCustomer.referred_by, referrerId);
  assertEquals(updatedCustomer.referred_at, '2026-06-15T00:00:00.000Z');
});

Deno.test('applyReferralCodeToCustomer keeps first-touch attribution and does not look up a new code', async () => {
  let didLookup = false;
  const originalCustomer = customer({
    referred_at: '2026-06-01T00:00:00.000Z',
    referred_by: 'existing-referrer',
  });
  const updatedCustomer = await applyReferralCodeToCustomer(originalCustomer, bindTenant, 'ABC123', {
    selectReferrer: async () => {
      didLookup = true;

      return { id: referrerId };
    },
  });

  assertEquals(updatedCustomer.referred_by, 'existing-referrer');
  assert(!didLookup, 'expected already referred customers to skip referrer lookup');
});

Deno.test('applyReferralCodeToCustomer treats inactive or unknown codes as a safe no-op', async () => {
  let didUpdate = false;
  const originalCustomer = customer();
  const updatedCustomer = await applyReferralCodeToCustomer(originalCustomer, bindTenant, 'ABC123', {
    selectReferrer: async () => null,
    updateCustomerReferral: async () => {
      didUpdate = true;

      return customer({ referred_by: referrerId });
    },
  });

  assertEquals(updatedCustomer.referred_by, null);
  assert(!didUpdate, 'expected unknown codes to skip customer updates');
});

Deno.test('applyReferralCodeToCustomer treats invalid codes as a safe no-op before lookup', async () => {
  let didLookup = false;
  const originalCustomer = customer();
  const updatedCustomer = await applyReferralCodeToCustomer(originalCustomer, bindTenant, 'oooooo', {
    selectReferrer: async () => {
      didLookup = true;

      return { id: referrerId };
    },
  });

  assertEquals(updatedCustomer.referred_by, null);
  assert(!didLookup, 'expected invalid codes to skip referrer lookup');
});

Deno.test('referrer order schema requires buyer age inside chat bounds', () => {
  assert(referrerOrderRequestSchema.safeParse(baseReferrerOrderPayload).success, 'expected valid referrer create payload');
  assert(!referrerOrderRequestSchema.safeParse({ ...baseReferrerOrderPayload, buyer_age: undefined }).success, 'expected missing age to fail');
  assert(!referrerOrderRequestSchema.safeParse({ ...baseReferrerOrderPayload, buyer_age: 0 }).success, 'expected age below one to fail');
  assert(!referrerOrderRequestSchema.safeParse({ ...baseReferrerOrderPayload, buyer_age: 121 }).success, 'expected age above 120 to fail');
});

Deno.test('resolveProductBranchSelection handles legacy, single, and multi-branch products', () => {
  const branchA = { address: 'A', district: 'วัฒนา', id: 'branch-a', name: 'สาขา A' };
  const branchB = { address: 'B', district: 'สาทร', id: 'branch-b', name: 'สาขา B' };

  assertEquals(resolveProductBranchSelection([], undefined), null);
  assertEquals(resolveProductBranchSelection([branchA], undefined)?.id, branchA.id);
  assertEquals(resolveProductBranchSelection([branchA], branchA.id)?.id, branchA.id);
  assertValidationError(
    () => resolveProductBranchSelection([branchA], branchB.id),
    'Branch is not available for this product.',
  );
  assertValidationError(
    () => resolveProductBranchSelection([branchA, branchB], undefined),
    'branch_id is required for this product.',
  );
  assertEquals(resolveProductBranchSelection([branchA, branchB], branchB.id)?.id, branchB.id);
  assertValidationError(
    () => resolveProductBranchSelection([branchA, branchB], 'branch-other'),
    'Branch is not available for this product.',
  );
});
