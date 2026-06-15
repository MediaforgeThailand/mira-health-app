import { resolveAuthUserId } from '../_shared/db.ts';
import { adminMembersDeps, adminMembersRequestSchema, handleAdminMembersRequest, loadAdminMembersContext } from '../_shared/adminMembers.ts';
import { HttpError, handleOptions, json, toErrorResponse, validateJson } from '../_shared/http.ts';

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
    const body = await validateJson(req, adminMembersRequestSchema);
    const authUserId = await resolveAuthUserId(req.headers.get('authorization'));
    const context = await loadAdminMembersContext(body.tenant_slug, authUserId);
    const response = await handleAdminMembersRequest(body, context, adminMembersDeps);

    return json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
});
