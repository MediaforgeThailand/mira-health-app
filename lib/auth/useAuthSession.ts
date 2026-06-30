import { useCallback, useEffect, useState } from 'react';

import { supabase, supabaseConfigStatus } from '@/lib/supabase';
import { bindStoredReferralToCustomer } from '@/lib/referrals/bind';
import { defaultTenantSlug, resolvePrimaryTenantSlug } from '@/lib/marketplace/hospitalProducts';

import type { Session, User } from '@supabase/supabase-js';

export type AuthAccountKind = 'customer' | 'referrer' | 'staff';

export type AuthAccessOptions = {
  accountKind?: AuthAccountKind;
  displayName?: string | null;
  phone?: string | null;
  refCode?: string | null;
  tenantSlug?: string;
};

export type AuthSessionState = {
  isConfigured: boolean;
  isLoading: boolean;
  session: Session | null;
  user: User | null;
};

const accountKindLabels: Record<AuthAccountKind, string> = {
  customer: 'à¸šà¸±à¸à¸Šà¸µà¸¥à¸¹à¸à¸„à¹‰à¸² Chat AI',
  referrer: 'à¸šà¸±à¸à¸Šà¸µ Referral',
  staff: 'à¸šà¸±à¸à¸Šà¸µà¸—à¸µà¸¡à¸‡à¸²à¸™ Admin Panel',
};

export function useAuthSession(): AuthSessionState {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    if (!supabaseConfigStatus.isConfigured) {
      setIsLoading(false);
      return undefined;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (isMounted) {
        setSession(data.session ?? null);
        setIsLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return {
    isConfigured: supabaseConfigStatus.isConfigured,
    isLoading,
    session,
    user: session?.user ?? null,
  };
}

export function useSignOut() {
  return useCallback(async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      throw new Error(error.message);
    }
  }, []);
}

export async function signInWithEmailPassword(email: string, password: string, options: AuthAccessOptions = {}) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (data.session && data.user) {
    await ensureProfile(data.user.id, data.user.user_metadata?.display_name || data.user.email || email);
    await ensureAccountAccess(data.user, options);
  }

  return data;
}

export async function signUpWithEmailPassword(
  email: string,
  password: string,
  displayName?: string,
  options: AuthAccessOptions = {},
) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: {
        ...(options.accountKind ? { mira_account_kind: options.accountKind } : {}),
        display_name: displayName?.trim() || email.trim(),
      },
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  if (data.session && data.user) {
    await ensureProfile(data.user.id, displayName || data.user.email || email);
    await ensureAccountAccess(data.user, { ...options, displayName: displayName ?? options.displayName });
  }

  return data;
}

function normalizeAccountKind(value: unknown): AuthAccountKind | null {
  return value === 'customer' || value === 'referrer' || value === 'staff' ? value : null;
}

function accountKindFromMetadata(user: User) {
  return normalizeAccountKind(user.user_metadata?.mira_account_kind ?? user.user_metadata?.account_kind);
}

function accountKindMismatchMessage(expected: AuthAccountKind, actual: AuthAccountKind) {
  return `à¸šà¸±à¸à¸Šà¸µà¸™à¸µà¹‰à¸ªà¸¡à¸±à¸„à¸£à¹„à¸§à¹‰à¹€à¸›à¹‡à¸™ ${accountKindLabels[actual]} à¸à¸£à¸¸à¸“à¸²à¹ƒà¸Šà¹‰à¸«à¸™à¹‰à¸² login à¸‚à¸­à¸‡ ${accountKindLabels[expected]} à¹à¸¢à¸à¸à¸±à¸™`;
}

function friendlyAuthError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    if (error.message.includes('TENANT_NOT_FOUND')) {
      return `à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¸žà¸š tenant "${defaultTenantSlug}" à¹ƒà¸™à¸à¸²à¸™à¸‚à¹‰à¸­à¸¡à¸¹à¸¥`;
    }

    if (error.message.includes('INVALID_REF_CODE')) {
      return 'à¸£à¸«à¸±à¸ªà¹à¸™à¸°à¸™à¸³à¹„à¸¡à¹ˆà¸–à¸¹à¸à¸•à¹‰à¸­à¸‡ à¸à¸£à¸¸à¸“à¸²à¹ƒà¸Šà¹‰ ref code 6 à¸•à¸±à¸§à¸ˆà¸²à¸à¸—à¸µà¸¡à¹à¸­à¸”à¸¡à¸´à¸™';
    }

    if (error.message.includes('REF_CODE_NOT_AVAILABLE')) {
      return 'ref code à¸™à¸µà¹‰à¹„à¸¡à¹ˆà¸žà¸£à¹‰à¸­à¸¡à¹ƒà¸«à¹‰ claim à¹à¸¥à¹‰à¸§ à¸«à¸£à¸·à¸­à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¸ªà¸£à¹‰à¸²à¸‡à¹‚à¸”à¸¢ admin';
    }

    return error.message;
  }

  return fallback;
}

async function hasStaffMembership(userId: string) {
  const { data, error } = await supabase
    .from('tenant_members')
    .select('role')
    .eq('auth_user_id', userId)
    .limit(1);

  if (error) {
    return false;
  }

  return Boolean(data?.length);
}

async function visibleTenantId(tenantSlug: string) {
  const { data, error } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', tenantSlug)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return (data as { id: string }).id;
}

async function hasReferrerAccount(userId: string, tenantSlug?: string) {
  const tenantId = tenantSlug ? await visibleTenantId(tenantSlug) : null;

  if (tenantSlug && !tenantId) {
    return false;
  }

  const query = supabase
    .from('referrers')
    .select('id')
    .eq('auth_user_id', userId)
    .eq('active', true)
    .limit(1);

  if (tenantId) {
    query.eq('tenant_id', tenantId);
  }

  const { data, error } = await query;

  if (error) {
    return false;
  }

  return Boolean(data?.length);
}

async function ensureCustomerAccount(user: User, options: AuthAccessOptions) {
  const [isStaff, isReferrer] = await Promise.all([hasStaffMembership(user.id), hasReferrerAccount(user.id)]);
  const tenantSlug = await resolvePrimaryTenantSlug(options.tenantSlug ?? defaultTenantSlug);

  if (isStaff) {
    throw new Error(`à¸šà¸±à¸à¸Šà¸µà¸™à¸µà¹‰à¹€à¸›à¹‡à¸™ ${accountKindLabels.staff} à¸­à¸¢à¸¹à¹ˆà¹à¸¥à¹‰à¸§ à¸à¸£à¸¸à¸“à¸²à¸ªà¸¡à¸±à¸„à¸£à¸šà¸±à¸à¸Šà¸µà¸¥à¸¹à¸à¸„à¹‰à¸²à¹à¸¢à¸à¸•à¹ˆà¸²à¸‡à¸«à¸²à¸`);
  }

  if (isReferrer) {
    throw new Error(`à¸šà¸±à¸à¸Šà¸µà¸™à¸µà¹‰à¹€à¸›à¹‡à¸™ ${accountKindLabels.referrer} à¸­à¸¢à¸¹à¹ˆà¹à¸¥à¹‰à¸§ à¸à¸£à¸¸à¸“à¸²à¸ªà¸¡à¸±à¸„à¸£à¸šà¸±à¸à¸Šà¸µà¸¥à¸¹à¸à¸„à¹‰à¸²à¹à¸¢à¸à¸•à¹ˆà¸²à¸‡à¸«à¸²à¸`);
  }

  const { error } = await supabase.rpc('miracare_claim_customer_account', {
    p_nickname: options.displayName?.trim() || user.user_metadata?.display_name || user.email || null,
    p_phone: options.phone?.trim() || null,
    p_tenant_slug: tenantSlug,
  });

  if (error) {
    // Older databases can still create the customer through chat-orchestrator on
    // the first live message. Do not block customer login while a migration is
    // waiting to be applied.
    console.warn('customer account claim skipped:', error.message);
  }

  await bindStoredReferralToCustomer(tenantSlug);
}

async function ensureStaffAccount(user: User, options: AuthAccessOptions) {
  const tenantSlug = await resolvePrimaryTenantSlug(options.tenantSlug ?? defaultTenantSlug);
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', tenantSlug)
    .maybeSingle();

  if (tenantError || !tenant) {
    throw new Error(tenantError?.message ?? `à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¸žà¸š tenant "${tenantSlug}" à¸ªà¸³à¸«à¸£à¸±à¸šà¸—à¸µà¸¡à¸‡à¸²à¸™`);
  }

  const { data: member, error: memberError } = await supabase
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', (tenant as { id: string }).id)
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (memberError || !member) {
    throw new Error('à¸šà¸±à¸à¸Šà¸µà¸—à¸µà¸¡à¸‡à¸²à¸™à¸™à¸µà¹‰à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¸–à¸¹à¸à¹€à¸žà¸´à¹ˆà¸¡à¹ƒà¸™ tenant_members à¹‚à¸”à¸¢ admin');
  }
}

async function ensureReferrerAccount(user: User, options: AuthAccessOptions) {
  const refCode = options.refCode?.trim();
  const tenantSlug = await resolvePrimaryTenantSlug(options.tenantSlug ?? defaultTenantSlug);
  let claimedCurrentTenantReferrer = false;

  if (refCode) {
    const { error } = await supabase.rpc('miracare_claim_referrer_account', {
      p_name: options.displayName?.trim() || user.user_metadata?.display_name || user.email || null,
      p_phone: options.phone?.trim() || null,
      p_ref_code: refCode,
      p_tenant_slug: tenantSlug,
    });

    if (error) {
      throw new Error(friendlyAuthError(error, 'claim ref code à¹„à¸¡à¹ˆà¸ªà¸³à¹€à¸£à¹‡à¸ˆ'));
    }

    claimedCurrentTenantReferrer = true;
  }

  const isReferrer = claimedCurrentTenantReferrer || (await hasReferrerAccount(user.id, tenantSlug));

  if (!isReferrer) {
    throw new Error('à¸šà¸±à¸à¸Šà¸µà¸™à¸µà¹‰à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¸¡à¸µà¹‚à¸›à¸£à¹„à¸Ÿà¸¥à¹Œ Referral à¸—à¸µà¹ˆà¸œà¸¹à¸à¸à¸±à¸š ref code à¸‚à¸­à¸‡à¸£à¸°à¸šà¸š');
  }
}

async function ensureAccountAccess(user: User, options: AuthAccessOptions) {
  const accountKind = options.accountKind;

  if (!accountKind) {
    return;
  }

  const metadataKind = accountKindFromMetadata(user);

  if (metadataKind && metadataKind !== accountKind) {
    await supabase.auth.signOut();
    throw new Error(accountKindMismatchMessage(accountKind, metadataKind));
  }

  try {
    if (accountKind === 'customer') {
      await ensureCustomerAccount(user, options);
    } else if (accountKind === 'staff') {
      await ensureStaffAccount(user, options);
    } else {
      await ensureReferrerAccount(user, options);
    }
  } catch (error) {
    await supabase.auth.signOut();
    throw error;
  }
}

export async function ensureProfile(userId: string, displayName?: string | null) {
  // `profiles` is a legacy v1 table that is not part of the v2 customer model
  // (customers are resolved server-side per tenant). Keep writing it for v1
  // compatibility, but best-effort: a missing table or a denied write must never
  // break sign-in/sign-up (L1, deep-risk-audit-2026-06-14).
  const { error } = await supabase.from('profiles').upsert({
    id: userId,
    display_name: displayName?.trim() || null,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.warn('ensureProfile (legacy profiles) skipped:', error.message);
  }
}

