import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties, IframeHTMLAttributes } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { useAuthSession } from '@/lib/auth/useAuthSession';
import { defaultTenantSlug } from '@/lib/marketplace/hospitalProducts';
import { supabaseConfigStatus } from '@/lib/supabase';

const designSrc = './mira-design/mira-core-system.dc.html';

type MiraBackendConfig = {
  accessToken: string;
  backendReady: boolean;
  supabaseAnonKey: string;
  supabaseUrl: string;
  tenantSlug: string;
  userEmail: string;
};

export default function MiraDesignRoute() {
  const auth = useAuthSession();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const backendConfig = useMemo<MiraBackendConfig>(() => ({
    accessToken: auth.session?.access_token ?? '',
    backendReady: supabaseConfigStatus.isConfigured,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    tenantSlug: defaultTenantSlug,
    userEmail: auth.user?.email ?? '',
  }), [auth.session?.access_token, auth.user?.email]);

  const postBackendConfig = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage({
      config: backendConfig,
      type: 'MIRA_BACKEND_CONFIG',
    }, '*');
  }, [backendConfig]);

  useEffect(() => {
    postBackendConfig();
  }, [postBackendConfig]);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      return undefined;
    }

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'MIRA_DESIGN_READY') {
        postBackendConfig();
      }
    };

    window.addEventListener('message', onMessage);

    return () => window.removeEventListener('message', onMessage);
  }, [postBackendConfig]);

  if (Platform.OS !== 'web') {
    return (
      <View style={styles.nativeFallback}>
        <Text style={styles.nativeFallbackTitle}>Mira Core System</Text>
        <Text style={styles.nativeFallbackText}>This route uses the provided web design HTML. Open the web preview to use it.</Text>
      </View>
    );
  }

  return (
    <View style={styles.webHost}>
      {React.createElement('iframe', {
        allow: 'clipboard-write; fullscreen',
        onLoad: postBackendConfig,
        ref: iframeRef,
        src: designSrc,
        style: iframeStyle,
        title: 'Mira Core System',
      } as IframeHTMLAttributes<HTMLIFrameElement>)}
    </View>
  );
}

const iframeStyle: CSSProperties = {
  border: 0,
  display: 'block',
  height: '100vh',
  width: '100vw',
};

const styles = StyleSheet.create({
  nativeFallback: {
    alignItems: 'center',
    backgroundColor: '#EEF2F8',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  nativeFallbackText: {
    color: '#5A6B86',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  nativeFallbackTitle: {
    color: '#0E2143',
    fontSize: 22,
    fontWeight: '800',
  },
  webHost: {
    backgroundColor: '#EEF2F8',
    flex: 1,
    minHeight: '100vh' as never,
  },
});
