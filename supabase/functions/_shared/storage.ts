import { HttpError } from './http.ts';

type RuntimeDeno = {
  env: {
    get: (key: string) => string | undefined;
  };
};

function readEnv(key: string) {
  const runtime = globalThis as typeof globalThis & { Deno?: RuntimeDeno };

  return runtime.Deno?.env.get(key);
}

function serviceConfig() {
  const supabaseUrl = readEnv('SUPABASE_URL');
  const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    throw new HttpError('UPSTREAM', 'Missing Supabase service configuration.', 500);
  }

  return {
    serviceRoleKey,
    supabaseUrl: supabaseUrl.replace(/\/$/, ''),
  };
}

async function fetchStorageObject(bucket: string, path: string) {
  const { serviceRoleKey, supabaseUrl } = serviceConfig();
  const normalizedPath = path.replace(/^\/+/, '');
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${normalizedPath}`, {
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
    },
  });

  if (!response.ok) {
    throw new HttpError('UPSTREAM', `Unable to download ${bucket}/${normalizedPath}.`, response.status);
  }

  return response;
}

async function parseStorageJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    const payload = JSON.parse(text) as unknown;

    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function downloadStorageObject(bucket: string, path: string) {
  const response = await fetchStorageObject(bucket, path);

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
}

export async function streamStorageObject(bucket: string, path: string) {
  const response = await fetchStorageObject(bucket, path);

  if (!response.body) {
    throw new HttpError('UPSTREAM', `Unable to stream ${bucket}/${path.replace(/^\/+/, '')}.`, 502);
  }

  return {
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    stream: response.body,
  };
}

export async function uploadStorageObject(bucket: string, path: string, bytes: Uint8Array, contentType: string) {
  const { serviceRoleKey, supabaseUrl } = serviceConfig();
  const normalizedPath = path.replace(/^\/+/, '');
  const payload = new ArrayBuffer(bytes.byteLength);

  new Uint8Array(payload).set(bytes);

  const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${normalizedPath}`, {
    body: payload,
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': contentType,
      apikey: serviceRoleKey,
      'x-upsert': 'true',
    },
    method: 'POST',
  });

  if (!response.ok) {
    throw new HttpError('UPSTREAM', `Unable to upload ${bucket}/${normalizedPath}.`, response.status);
  }

  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${normalizedPath}`;
}

export async function createSignedUploadUrl(bucket: string, path: string, expiresIn: number) {
  const { serviceRoleKey, supabaseUrl } = serviceConfig();
  const normalizedPath = path.replace(/^\/+/, '');
  const response = await fetch(`${supabaseUrl}/storage/v1/object/upload/sign/${bucket}/${normalizedPath}`, {
    body: JSON.stringify({ expiresIn }),
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
    },
    method: 'POST',
  });
  const payload = await parseStorageJson(response);

  if (!response.ok) {
    throw new HttpError('UPSTREAM', `Unable to sign upload ${bucket}/${normalizedPath}.`, response.status);
  }

  const signedUrl = typeof payload.signedUrl === 'string'
    ? payload.signedUrl
    : typeof payload.url === 'string'
      ? payload.url.startsWith('http')
        ? payload.url
        : `${supabaseUrl}/storage/v1${payload.url}`
      : null;

  if (!signedUrl) {
    throw new HttpError('UPSTREAM', `Storage did not return a signed upload URL for ${bucket}/${normalizedPath}.`, 502);
  }

  return signedUrl;
}

export async function createSignedReadUrl(bucket: string, path: string, expiresIn: number) {
  const { serviceRoleKey, supabaseUrl } = serviceConfig();
  const normalizedPath = path.replace(/^\/+/, '');
  const response = await fetch(`${supabaseUrl}/storage/v1/object/sign/${bucket}/${normalizedPath}`, {
    body: JSON.stringify({ expiresIn }),
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
    },
    method: 'POST',
  });
  const payload = await parseStorageJson(response);

  if (!response.ok) {
    throw new HttpError('UPSTREAM', `Unable to sign read ${bucket}/${normalizedPath}.`, response.status);
  }

  const signedPath = typeof payload.signedURL === 'string' ? payload.signedURL : typeof payload.signedUrl === 'string' ? payload.signedUrl : null;

  if (!signedPath) {
    throw new HttpError('UPSTREAM', `Storage did not return a signed read URL for ${bucket}/${normalizedPath}.`, 502);
  }

  return signedPath.startsWith('http') ? signedPath : `${supabaseUrl}/storage/v1${signedPath}`;
}

export async function deleteStorageObjects(bucket: string, paths: string[]) {
  const normalizedPaths = [...new Set(paths.map((path) => path.replace(/^\/+/, '')).filter(Boolean))];

  if (normalizedPaths.length === 0) {
    return [];
  }

  const { serviceRoleKey, supabaseUrl } = serviceConfig();
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}`, {
    body: JSON.stringify({ prefixes: normalizedPaths }),
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
    },
    method: 'DELETE',
  });
  const payload = await parseStorageJson(response);

  if (!response.ok) {
    throw new HttpError('UPSTREAM', `Unable to delete objects from ${bucket}.`, response.status);
  }

  return Array.isArray(payload) ? payload : normalizedPaths.map((name) => ({ name }));
}
