import { assertTenant, resolveAuthUser } from '../_shared/db.ts';
import { HttpError, handleOptions, json, toErrorResponse, validateJson } from '../_shared/http.ts';
import {
  handleReferralSelfProvision,
  referralSelfProvisionDeps,
  referralSelfProvisionRequestSchema,
} from '../_shared/referralSelfProvision.ts';

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
    const body = await validateJson(req, referralSelfProvisionRequestSchema);
    const authUser = await resolveAuthUser(req.headers.get('authorization'));
    const tenant = await assertTenant(body.tenant_slug);
    const response = await handleReferralSelfProvision(body, {
      authEmail: authUser.email,
      authUserId: authUser.id,
      tenant,
    }, referralSelfProvisionDeps);

    return json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
});
