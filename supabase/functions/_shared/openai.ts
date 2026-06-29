import { HttpError } from './http.ts';
import type { FactKeyRow } from './types.ts';

type RuntimeDeno = {
  env: {
    get: (key: string) => string | undefined;
  };
};

type OpenAIOutputContent = {
  text?: string;
  type?: string;
};

type OpenAIOutputItem = {
  content?: OpenAIOutputContent[];
  id?: string;
  type?: string;
};

type OpenAIResponse = {
  error?: {
    message?: string;
  };
  id?: string;
  output?: OpenAIOutputItem[];
  output_text?: string;
};

function readEnv(key: string) {
  const runtime = globalThis as typeof globalThis & { Deno?: RuntimeDeno };

  return runtime.Deno?.env.get(key);
}

function envOrDefault(key: string, fallback: string) {
  return readEnv(key)?.trim() || fallback;
}

function requireOpenAIKey() {
  const apiKey = readEnv('OPENAI_API_KEY')?.trim();

  if (!apiKey) {
    throw new HttpError('UPSTREAM', 'Missing OPENAI_API_KEY.', 500);
  }

  return apiKey;
}

function extractText(data: OpenAIResponse) {
  if (data.output_text?.trim()) {
    return data.output_text.trim();
  }

  const contentText = data.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text)
    .find((text) => text?.trim());

  return contentText?.trim() ?? '';
}

async function postResponses(body: Record<string, unknown>, timeoutMs: number) {
  const apiKey = requireOpenAIKey();
  const apiBaseUrl = envOrDefault('OPENAI_API_BASE_URL', 'https://api.openai.com/v1').replace(/\/$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${apiBaseUrl}/responses`, {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: controller.signal,
    });
    const payload = (await response.json()) as OpenAIResponse;

    if (!response.ok || payload.error) {
      // Preserve 4xx vs 5xx so callers can decide whether a retry makes sense.
      const status = response.ok || response.status >= 500 ? 502 : response.status;

      throw new HttpError('UPSTREAM', payload.error?.message ?? `OpenAI request failed with ${response.status}.`, status);
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export async function callMiraPrompt(
  vars: {
    brand_name: string;
    personal_context: string;
    product_catalog: string;
    recent_chat: string;
    user_nickname: string;
  },
  input: string,
) {
  const promptId = envOrDefault('MIRACARE_PROMPT_ID', 'pmpt_6a29c7e353b88196a6e648b24c54849e0f6204e24d65c021');
  const promptVersion = readEnv('MIRA_PROMPT_VERSION')?.trim();
  const timeoutMs = Number(envOrDefault('OPENAI_REQUEST_TIMEOUT_MS', '30000'));
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const payload = await postResponses(
        {
          input,
          prompt: {
            id: promptId,
            ...(promptVersion ? { version: promptVersion } : {}),
            variables: vars,
          },
          store: false,
        },
        timeoutMs,
      );
      const text = extractText(payload);

      if (!text) {
        throw new HttpError('UPSTREAM', 'OpenAI returned an empty response.', 502);
      }

      return {
        responseId: payload.id ?? null,
        text,
      };
    } catch (error) {
      lastError = error;

      // 4xx responses (bad request, invalid prompt id, quota) will not succeed on
      // retry — surface them immediately instead of doubling the failed call.
      if (error instanceof HttpError && error.status < 500 && error.status !== 429) {
        throw error;
      }

      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new HttpError('UPSTREAM', 'OpenAI request failed.', 502);
}

export async function callFactExtractor(message: string, registry: FactKeyRow[]) {
  const model = envOrDefault('FACT_MODEL', 'gpt-5-mini');
  const schema = {
    additionalProperties: false,
    properties: {
      facts: {
        items: {
          additionalProperties: false,
          properties: {
            confidence: {
              maximum: 1,
              minimum: 0,
              type: 'number',
            },
            key: {
              enum: registry.map((row) => row.key),
              type: 'string',
            },
            value: {
              type: 'string',
            },
          },
          required: ['key', 'value', 'confidence'],
          type: 'object',
        },
        type: 'array',
      },
    },
    required: ['facts'],
    type: 'object',
  };
  const payload = await postResponses(
    {
      input: [
        {
          content:
            'Extract personal health facts explicitly stated by the USER message (Thai). Output [] if none. Never infer beyond the text. Buddhist years -> subtract 543.',
          role: 'system',
        },
        {
          content: message,
          role: 'user',
        },
      ],
      model,
      store: false,
      text: {
        format: {
          name: 'mira_fact_extraction',
          schema,
          strict: true,
          type: 'json_schema',
        },
      },
    },
    30000,
  );
  const text = extractText(payload);

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError('UPSTREAM', 'Fact extractor returned invalid JSON.', 502);
  }
}

export async function callOrderFieldExtractor(message: string) {
  const model = envOrDefault('FACT_MODEL', 'gpt-5-mini');
  const schema = {
    additionalProperties: false,
    properties: {
      buyer_age: {
        type: ['number', 'null'],
      },
      buyer_name: {
        type: ['string', 'null'],
      },
      buyer_phone: {
        type: ['string', 'null'],
      },
      confirmed: {
        type: 'boolean',
      },
      preferred_date: {
        type: ['string', 'null'],
      },
      preferred_date_end: {
        type: ['string', 'null'],
      },
      preferred_time_window: {
        type: ['string', 'null'],
      },
    },
    required: ['buyer_age', 'buyer_name', 'buyer_phone', 'confirmed', 'preferred_date', 'preferred_date_end', 'preferred_time_window'],
    type: 'object',
  };
  const payload = await postResponses(
    {
      input: [
        {
          content:
            'Extract only explicitly stated order form fields from the Thai user message. Do not infer. buyer_age must be a numeric age in years when explicit, otherwise null. preferred_date is the earliest convenient booking date as ISO YYYY-MM-DD when explicit enough, otherwise null. preferred_date_end is the latest date of a stated range (e.g. "20-25 มิ.ย.") as ISO YYYY-MM-DD, otherwise null. preferred_time_window is a short Thai phrase for the time of day when stated (e.g. "ช่วงเช้า", "บ่าย", "หลังเลิกงาน"), otherwise null. Set confirmed to true ONLY when the message simply approves or agrees that previously provided booking details are correct (e.g. "ใช่", "ถูกต้อง", "ยืนยัน", "โอเค") and provides no new details; otherwise false.',
          role: 'system',
        },
        {
          content: message,
          role: 'user',
        },
      ],
      model,
      store: false,
      text: {
        format: {
          name: 'mira_order_field_extraction',
          schema,
          strict: true,
          type: 'json_schema',
        },
      },
    },
    30000,
  );
  const text = extractText(payload);

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const buyerAge = typeof parsed.buyer_age === 'number' && Number.isInteger(parsed.buyer_age) && parsed.buyer_age >= 1 && parsed.buyer_age <= 120
      ? parsed.buyer_age
      : undefined;
    // M2 (deep-risk-audit-2026-06-14): mirror the order_form_submit phone
    // contract (^0[689]\d{8}$). Strip common separators then validate; a
    // conversationally-extracted phone that does not match is dropped so the
    // flow keeps asking instead of saving a malformed number that staff cannot call.
    const normalizedPhone = typeof parsed.buyer_phone === 'string' ? parsed.buyer_phone.replace(/[\s-]/g, '') : '';

    return {
      buyer_age: buyerAge,
      buyer_name: typeof parsed.buyer_name === 'string' && parsed.buyer_name.trim() ? parsed.buyer_name.trim() : undefined,
      buyer_phone: /^0[689]\d{8}$/.test(normalizedPhone) ? normalizedPhone : undefined,
      confirmed: parsed.confirmed === true,
      preferred_date:
        typeof parsed.preferred_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.preferred_date)
          ? parsed.preferred_date
          : undefined,
      preferred_date_end:
        typeof parsed.preferred_date_end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.preferred_date_end)
          ? parsed.preferred_date_end
          : undefined,
      preferred_time_window:
        typeof parsed.preferred_time_window === 'string' && parsed.preferred_time_window.trim()
          ? parsed.preferred_time_window.trim().slice(0, 120)
          : undefined,
    };
  } catch {
    return {};
  }
}

