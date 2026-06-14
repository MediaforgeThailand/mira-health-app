import { useCallback, useEffect, useState } from 'react';

import { invokeFunction } from '@/lib/api/client';
import { readStoredReferralCode } from '@/lib/referrals/attribution';
import { supabase, supabaseConfigStatus } from '@/lib/supabase';
import type { ReferralBindRequest, ReferralBindResponse } from '@/lib/types/api';

import type { Session, User } from '@supabase/supabase-js';

const defaultTenantSlug = process.env.EXPO_PUBLIC_MIRA_TENANT_SLUG?.trim() || 'demo-hospital';
const attemptedReferralBindKeys = new Set<string>();

export type AuthSessionState = {
  isConfigured: boolean;
  isLoading: boolean;
  session: Session | null;
  user: User | null;
};

async function bindStoredReferralBestEffort(session: Session | null) {
  if (!supabaseConfigStatus.isConfigured || !session?.user?.id) {
    return;
  }

  try {
    const refCode = await readStoredReferralCode();

    if (!refCode) {
      return;
    }

    const attemptKey = `${defaultTenantSlug}:${session.user.id}:${refCode}`;

    if (attemptedReferralBindKeys.has(attemptKey)) {
      return;
    }

    attemptedReferralBindKeys.add(attemptKey);

    await invokeFunction<ReferralBindRequest, ReferralBindResponse>('referral-bind', {
      ref_code: refCode,
      tenant_slug: defaultTenantSlug,
    });
  } catch (error) {
    console.warn('referral_bind_failed', error);
  }
}

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

      if (data.session) {
        void bindStoredReferralBestEffort(data.session);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);

      if (nextSession) {
        void bindStoredReferralBestEffort(nextSession);
      }
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

export async function signInWithEmailPassword(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (data.session && data.user) {
    await ensureProfile(data.user.id, data.user.user_metadata?.display_name || data.user.email || email);
    void bindStoredReferralBestEffort(data.session);
  }

  return data;
}

export async function signUpWithEmailPassword(email: string, password: string, displayName?: string) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: {
        display_name: displayName?.trim() || email.trim(),
      },
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  if (data.session && data.user) {
    await ensureProfile(data.user.id, displayName || data.user.email || email);
    void bindStoredReferralBestEffort(data.session);
  }

  return data;
}

export async function ensureProfile(userId: string, displayName?: string | null) {
  const { error } = await supabase.from('profiles').upsert({
    id: userId,
    display_name: displayName?.trim() || null,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(error.message);
  }
}
