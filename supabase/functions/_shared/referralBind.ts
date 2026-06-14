import { z } from './http.ts';
import { normalizeReferralCode } from './referrals.ts';

export const referralBindRequestSchema = z.object({
  ref_code: z.string().trim().max(128).transform(normalizeReferralCode),
  tenant_slug: z.string().regex(/^[a-z0-9-]{2,32}$/),
});
