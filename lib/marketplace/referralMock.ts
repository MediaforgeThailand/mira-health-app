import { REF_CODE_PATTERN, normalizeRefCode } from '@/lib/referrals/attributionCore';

export { REF_CODE_PATTERN };

export function normalizeReferralCode(value: string) {
  return normalizeRefCode(value);
}

export function isValidReferralCode(value: string) {
  return REF_CODE_PATTERN.test(normalizeRefCode(value));
}

export function getReferralWebOrigin() {
  const configuredOrigin = process.env.EXPO_PUBLIC_WEB_ORIGIN?.trim().replace(/\/+$/, '');

  if (configuredOrigin) {
    return configuredOrigin;
  }

  return (globalThis as typeof globalThis & { location?: { origin?: string } }).location?.origin?.replace(/\/+$/, '') ?? '';
}

export function createReferralShareLink(refCode: string) {
  const normalizedCode = normalizeRefCode(refCode);
  const path = `/r/${encodeURIComponent(normalizedCode)}`;
  const origin = getReferralWebOrigin();

  return origin ? `${origin}${path}` : path;
}

export function createReferralAppLink(refCode: string) {
  return `mirahealth://r/${encodeURIComponent(normalizeRefCode(refCode))}`;
}

export function formatPercent(value: number) {
  const percent = Math.abs(value) > 1 ? value : value * 100;

  return `${Math.round(percent)}%`;
}
