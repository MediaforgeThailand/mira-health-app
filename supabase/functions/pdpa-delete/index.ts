import { handleOptions, HttpError, json, toErrorResponse, validateJson } from '../_shared/http.ts';
import { deletePdpaData, pdpaRequestSchema } from '../_shared/pdpa.ts';

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

export async function handlePdpaDelete(req: Request) {
  const optionsResponse = handleOptions(req);

  if (optionsResponse) {
    return optionsResponse;
  }

  if (req.method !== 'POST') {
    return toErrorResponse(new HttpError('VALIDATION', 'Method not allowed.', 405));
  }

  try {
    const body = await validateJson(req, pdpaRequestSchema);

    return json(await deletePdpaData(body, req.headers.get('authorization')));
  } catch (error) {
    return toErrorResponse(error);
  }
}

if (!(globalThis as typeof globalThis & { __MIRACARE_SUPPRESS_SERVE__?: boolean }).__MIRACARE_SUPPRESS_SERVE__) {
  Deno.serve(handlePdpaDelete);
}
