export const REFERRAL_STORAGE_KEY = 'mira_ref';
export const REFERRAL_DAYS = 30;
export const REF_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{6}$/;

export type StoredReferral = {
  expires_at: string;
  ref_code: string;
};

type MaybePromise<T> = T | Promise<T>;

export type ReferralStorageAdapter = {
  getItem: (key: string) => MaybePromise<string | null | undefined>;
  removeItem: (key: string) => MaybePromise<void>;
  setItem: (key: string, value: string) => MaybePromise<void>;
};

const REFERRAL_TTL_MS = REFERRAL_DAYS * 24 * 60 * 60 * 1000;

export function normalizeRefCode(value: string) {
  return value.trim().toUpperCase().replace(/[^0-9A-HJKMNP-TV-Z]/g, '').slice(0, 6);
}

export function createStoredReferral(rawCode: string, nowMs = Date.now()): StoredReferral | null {
  const refCode = normalizeRefCode(rawCode);

  if (!REF_CODE_PATTERN.test(refCode)) {
    return null;
  }

  return {
    expires_at: new Date(nowMs + REFERRAL_TTL_MS).toISOString(),
    ref_code: refCode,
  };
}

export function parseStoredReferral(raw: string, nowMs = Date.now()) {
  try {
    const payload = JSON.parse(raw) as Partial<StoredReferral>;

    if (typeof payload.ref_code !== 'string' || typeof payload.expires_at !== 'string') {
      return null;
    }

    const expiresAtMs = new Date(payload.expires_at).getTime();

    if (!Number.isFinite(expiresAtMs) || expiresAtMs < nowMs) {
      return null;
    }

    const refCode = normalizeRefCode(payload.ref_code);

    return REF_CODE_PATTERN.test(refCode) ? refCode : null;
  } catch {
    return null;
  }
}

export async function storeReferralCodeWithAdapter(rawCode: string, adapter: ReferralStorageAdapter, nowMs = Date.now()) {
  const payload = createStoredReferral(rawCode, nowMs);

  if (!payload) {
    return null;
  }

  await adapter.setItem(REFERRAL_STORAGE_KEY, JSON.stringify(payload));

  return payload;
}

export async function readStoredReferralCodeWithAdapter(adapter: ReferralStorageAdapter, nowMs = Date.now()) {
  const raw = await adapter.getItem(REFERRAL_STORAGE_KEY);

  if (!raw) {
    return null;
  }

  const refCode = parseStoredReferral(raw, nowMs);

  if (!refCode) {
    await adapter.removeItem(REFERRAL_STORAGE_KEY);
  }

  return refCode;
}
