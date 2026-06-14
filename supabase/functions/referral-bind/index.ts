import { assertTenant, resolveAuthUserId, resolveOrCreateCustomer } from '../_shared/db.ts';
import { HttpError, handleOptions, json, toErrorResponse, validateJson } from '../_shared/http.ts';
import { referralBindRequestSchema } from '../_shared/referralBind.ts';
import { applyReferralCodeToCustomer } from '../_shared/referrals.ts';
import type { ReferralBindResponse } from '../_shared/types.ts';

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req);

  if (optionsResponse) {
    return optionsResponse;
  }

  if (req.method !== 'POST') {
    return toErrorResponse(new HttpError('VALIDATION', 'Method not allowed.', 405));
  }

  try {
    const body = await validateJson(req, referralBindRequestSchema);
    const tenant = await assertTenant(body.tenant_slug);
    const authUserId = await resolveAuthUserId(req.headers.get('authorization'));
    const customer = await resolveOrCreateCustomer(tenant.id, authUserId);
    const alreadyReferred = Boolean(customer.referred_by);
    const updatedCustomer = await applyReferralCodeToCustomer(customer, tenant, body.ref_code);
    const response: ReferralBindResponse = {
      already_referred: alreadyReferred,
      bound: !alreadyReferred && Boolean(updatedCustomer.referred_by) && updatedCustomer.referred_by !== customer.referred_by,
    };

    return json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
});
