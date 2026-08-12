import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { useAuthSession } from '@/lib/auth/useAuthSession';
import { defaultTenantSlug } from '@/lib/marketplace/hospitalProducts';
import { supabase, supabaseConfigStatus } from '@/lib/supabase';
import {
  configForVertical,
  GENERIC_TENANT_CONFIG,
  resolveTenantConfig,
  type RawTenantConfig,
  type TenantConfig,
  type TenantVocabulary,
} from '@/lib/tenant/vocabulary';

type TenantRow = { display_name: string | null; id: string; logo_url: string | null };

// Loads the active tenant's white-label config (vertical + vocabulary +
// branding) and resolves it against generic defaults. Falls back to generic
// when Supabase is not configured or the tenant has no settings row.
export async function loadTenantSettings(slug = defaultTenantSlug): Promise<TenantConfig> {
  if (!supabaseConfigStatus.isConfigured) {
    return GENERIC_TENANT_CONFIG;
  }

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id,display_name,logo_url')
    .eq('slug', slug)
    .maybeSingle();

  if (tenantError || !tenant) {
    return GENERIC_TENANT_CONFIG;
  }

  const tenantRow = tenant as TenantRow;
  const fallbackBranding = { brandName: tenantRow.display_name, logoUrl: tenantRow.logo_url };

  const { data: settings, error: settingsError } = await supabase
    .from('tenant_settings')
    .select('vertical,vocabulary,branding')
    .eq('tenant_id', tenantRow.id)
    .maybeSingle();

  if (settingsError || !settings) {
    return resolveTenantConfig(null, fallbackBranding);
  }

  return resolveTenantConfig(settings as RawTenantConfig, fallbackBranding);
}

export type TenantConfigState = {
  config: TenantConfig;
  isLoading: boolean;
};

// React hook used by admin and customer screens. In demo / unauthenticated mode
// it returns generic copy, or a vertical preview when the route carries
// `?vertical=beauty_clinic` (used for sales demos).
export function useTenantConfig(): TenantConfigState {
  const auth = useAuthSession();
  const params = useLocalSearchParams<{ vertical?: string }>();
  const demoVertical = typeof params.vertical === 'string' && params.vertical.trim().length > 0 ? params.vertical.trim() : null;
  const demoConfig = demoVertical ? configForVertical(demoVertical) : GENERIC_TENANT_CONFIG;
  const [state, setState] = useState<TenantConfigState>({ config: demoConfig, isLoading: true });

  useEffect(() => {
    let isMounted = true;

    async function run() {
      if (!supabaseConfigStatus.isConfigured || !auth.session) {
        if (isMounted) {
          setState({ config: demoConfig, isLoading: false });
        }
        return;
      }

      try {
        const config = await loadTenantSettings();

        if (isMounted) {
          setState({ config, isLoading: false });
        }
      } catch {
        if (isMounted) {
          setState({ config: demoConfig, isLoading: false });
        }
      }
    }

    void run();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.session, auth.user, demoVertical]);

  return state;
}

export function useTenantVocabulary(): TenantVocabulary {
  return useTenantConfig().config.vocabulary;
}
