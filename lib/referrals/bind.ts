import { invokeFunction } from '@/lib/api/client';
import { clearStoredReferralCode, readStoredReferralCode } from '@/lib/referrals/attribution';
import { defaultTenantSlug, resolvePrimaryTenantSlug } from '@/lib/marketplace/hospitalProducts';
import type { ReferralBindRequest, ReferralBindResponse } from '@/lib/types/api';

export type StoredReferralBindResult = (ReferralBindResponse & { ref_code: string }) | null;

export async function bindStoredReferralToCustomer(tenantSlug = defaultTenantSlug): Promise<StoredReferralBindResult> {
  const refCode = await readStoredReferralCode();

  if (!refCode) {
    return null;
  }

  const resolvedTenantSlug = await resolvePrimaryTenantSlug(tenantSlug);
  const response = await invokeFunction<ReferralBindRequest, ReferralBindResponse>('referral-bind', {
    ref_code: refCode,
    tenant_slug: resolvedTenantSlug,
  });

  if (response.bound || response.already_referred) {
    await clearStoredReferralCode();
    return { ...response, ref_code: refCode };
  }

  throw new Error('à¹„à¸¡à¹ˆà¸ªà¸²à¸¡à¸²à¸£à¸–à¸œà¸¹à¸ referral code à¸à¸±à¸šà¸šà¸±à¸à¸Šà¸µà¸™à¸µà¹‰à¹„à¸”à¹‰ à¸à¸£à¸¸à¸“à¸²à¸‚à¸­ link à¹ƒà¸«à¸¡à¹ˆà¸ˆà¸²à¸à¸œà¸¹à¹‰à¹à¸™à¸°à¸™à¸³');
}

