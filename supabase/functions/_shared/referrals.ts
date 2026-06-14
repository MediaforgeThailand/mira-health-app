import { selectOne, updateRows } from './db.ts';
import type { CustomerRow, ReferrerRow, TenantRow } from './types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
export const REF_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{6}$/;

type AttributionCustomer = Pick<CustomerRow, 'referred_at' | 'referred_by'>;
type AttributionTenant = Pick<TenantRow, 'attribution_window_days'>;
type ReferralBindTenant = Pick<TenantRow, 'id'>;
type ReferralBindReferrer = Pick<ReferrerRow, 'id'>;
type ReferralBindDeps = {
  nowIso?: () => string;
  selectReferrer?: (tenantId: string, refCode: string) => Promise<ReferralBindReferrer | null>;
  updateCustomerReferral?: (
    customerId: string,
    tenantId: string,
    referrerId: string,
    referredAt: string,
  ) => Promise<CustomerRow | null>;
};

const REFERRER_SELECT = 'id,tenant_id,ref_code,name,type,phone,auth_user_id,commission_scheme,active,created_at';
const CUSTOMER_SELECT = 'id,tenant_id,auth_user_id,line_user_id,nickname,phone,referred_by,referred_at,created_at';

function nowIso() {
  return new Date().toISOString();
}

export function normalizeReferralCode(value: string) {
  return value.trim().toUpperCase().replace(/[^0-9A-HJKMNP-TV-Z]/g, '').slice(0, 6);
}

export function resolveAttributedReferrerId(
  customer: AttributionCustomer,
  tenant: AttributionTenant,
  nowMs = Date.now(),
) {
  if (!customer.referred_by || !customer.referred_at) {
    return null;
  }

  const referredAtMs = Date.parse(customer.referred_at);

  if (!Number.isFinite(referredAtMs)) {
    return null;
  }

  const windowDays = Math.max(0, tenant.attribution_window_days);
  const expiresAtMs = referredAtMs + windowDays * DAY_MS;

  return expiresAtMs >= nowMs ? customer.referred_by : null;
}

async function defaultSelectReferrer(tenantId: string, refCode: string) {
  return selectOne<ReferralBindReferrer>('referrers', {
    active: 'eq.true',
    ref_code: `eq.${refCode}`,
    select: REFERRER_SELECT,
    tenant_id: `eq.${tenantId}`,
  });
}

async function defaultUpdateCustomerReferral(customerId: string, tenantId: string, referrerId: string, referredAt: string) {
  const rows = await updateRows<CustomerRow>(
    'customers',
    {
      referred_at: referredAt,
      referred_by: referrerId,
    },
    {
      id: `eq.${customerId}`,
      select: CUSTOMER_SELECT,
      tenant_id: `eq.${tenantId}`,
    },
  );

  return rows[0] ?? null;
}

export async function applyReferralCodeToCustomer(
  customer: CustomerRow,
  tenant: ReferralBindTenant,
  refCode?: string | null,
  deps: ReferralBindDeps = {},
) {
  if (!refCode || customer.referred_by) {
    return customer;
  }

  const normalizedRefCode = normalizeReferralCode(refCode);

  if (!REF_CODE_PATTERN.test(normalizedRefCode)) {
    return customer;
  }

  const referrer = await (deps.selectReferrer ?? defaultSelectReferrer)(tenant.id, normalizedRefCode);

  if (!referrer) {
    return customer;
  }

  const updatedCustomer = await (deps.updateCustomerReferral ?? defaultUpdateCustomerReferral)(
    customer.id,
    tenant.id,
    referrer.id,
    (deps.nowIso ?? nowIso)(),
  );

  return updatedCustomer ?? customer;
}
