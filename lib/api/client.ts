import { QueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { ApiEnvelope } from '@/lib/types/api';

export const miraQueryClient = new QueryClient({
  defaultOptions: {
    mutations: {
      retry: 0,
    },
    queries: {
      gcTime: 5 * 60 * 1000,
      retry: 1,
      staleTime: 15 * 1000,
    },
  },
});

export async function invokeFunction<TRequest extends Record<string, unknown>, TResponse>(
  name: string,
  body: TRequest,
): Promise<TResponse> {
  const { data, error } = await supabase.functions.invoke(name, {
    body,
  });

  if (error) {
    throw new Error((await functionErrorMessage(error)) ?? error.message);
  }

  const envelope = data as ApiEnvelope<TResponse> | TResponse | null;

  if (!envelope) {
    throw new Error(`${name} returned an empty response.`);
  }

  if (typeof envelope === 'object' && 'ok' in envelope) {
    if (envelope.ok) {
      return envelope.data;
    }

    throw new Error(envelope.error.message);
  }

  return envelope as TResponse;
}

async function functionErrorMessage(error: unknown) {
  const response = functionErrorResponse(error);

  if (!response) {
    return null;
  }

  try {
    const payload = await response.clone().json() as Partial<ApiEnvelope<never>>;

    if (payload && typeof payload === 'object' && payload.ok === false && payload.error?.message) {
      return payload.error.message;
    }
  } catch {
    try {
      const text = await response.clone().text();

      return text.trim() || null;
    } catch {
      return null;
    }
  }

  return null;
}

function functionErrorResponse(error: unknown): Response | null {
  if (!error || typeof error !== 'object' || !('context' in error)) {
    return null;
  }

  const context = (error as { context?: unknown }).context;

  if (!context || typeof context !== 'object') {
    return null;
  }

  const maybeResponse = context as Partial<Response>;

  return typeof maybeResponse.clone === 'function' ? maybeResponse as Response : null;
}
