import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  REFERRAL_DAYS,
  REFERRAL_STORAGE_KEY,
  createStoredReferral,
  normalizeRefCode,
  readStoredReferralCodeWithAdapter,
  storeReferralCodeWithAdapter,
  type ReferralStorageAdapter,
} from '@/lib/referrals/attributionCore';

function storage() {
  return (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
}

function documentCookie() {
  return (globalThis as typeof globalThis & { document?: { cookie: string } }).document;
}

const webAdapter: ReferralStorageAdapter = {
  getItem: (key) => storage()?.getItem(key),
  removeItem: (key) => {
    storage()?.removeItem(key);
  },
  setItem: (key, value) => {
    storage()?.setItem(key, value);
  },
};

const secureStoreAdapter: ReferralStorageAdapter = {
  getItem: (key) => SecureStore.getItemAsync(key),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
};

function writeReferralCookie(refCode: string) {
  const doc = documentCookie();

  if (doc) {
    doc.cookie = `${REFERRAL_STORAGE_KEY}=${encodeURIComponent(refCode)}; Max-Age=${REFERRAL_DAYS * 24 * 60 * 60}; Path=/; SameSite=Lax`;
  }
}

function platformAdapter() {
  return Platform.OS === 'web' ? webAdapter : secureStoreAdapter;
}

export { REFERRAL_DAYS, REFERRAL_STORAGE_KEY, createStoredReferral, normalizeRefCode };

export async function storeReferralCode(rawCode: string) {
  const payload = await storeReferralCodeWithAdapter(rawCode, platformAdapter());

  if (payload && Platform.OS === 'web') {
    writeReferralCookie(payload.ref_code);
  }

  return payload;
}

export async function readStoredReferralCode() {
  return readStoredReferralCodeWithAdapter(platformAdapter());
}
