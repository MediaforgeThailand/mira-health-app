import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MiraDesign } from '@/constants/Design';
import { useAuthSession } from '@/lib/auth/useAuthSession';
import { normalizeRefCode, storeReferralCode } from '@/lib/referrals/attribution';
import { bindStoredReferralToCustomer } from '@/lib/referrals/bind';

export function generateStaticParams(): { ref_code: string }[] {
  return [{ ref_code: 'DRNOK2' }];
}

export default function ReferralLandingScreen() {
  const params = useLocalSearchParams<{ ref_code?: string }>();
  const router = useRouter();
  const auth = useAuthSession();
  const refCode = useMemo(() => normalizeRefCode(String(params.ref_code ?? '')), [params.ref_code]);
  const [storedCode, setStoredCode] = useState<string | null>(null);
  const [isInvalidCode, setIsInvalidCode] = useState(false);
  const [bindError, setBindError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function persistReferral() {
      if (!refCode) {
        setIsInvalidCode(true);
        return;
      }

      const stored = await storeReferralCode(refCode);

      if (!isMounted) {
        return;
      }

      setStoredCode(stored?.ref_code ?? null);
      setIsInvalidCode(!stored);
    }

    setStoredCode(null);
    setIsInvalidCode(false);
    setBindError(null);
    void persistReferral();

    return () => {
      isMounted = false;
    };
  }, [refCode]);

  useEffect(() => {
    let isMounted = true;

    async function continueReferralFlow() {
      if (!storedCode || auth.isLoading) {
        return;
      }

      if (!auth.session) {
        router.replace({
          pathname: '/login',
          params: {
            mode: 'chat',
            redirect: '/chat',
            reason: 'referral',
          },
        });
        return;
      }

      try {
        await bindStoredReferralToCustomer();

        if (isMounted) {
          router.replace('/chat' as Href);
        }
      } catch (error) {
        if (isMounted) {
          setBindError(error instanceof Error ? error.message : 'ผูก referral code ไม่สำเร็จ');
        }
      }
    }

    void continueReferralFlow();

    return () => {
      isMounted = false;
    };
  }, [auth.isLoading, auth.session, router, storedCode]);

  const title = bindError ? 'ผูก referral ไม่สำเร็จ' : isInvalidCode ? 'ไม่พบ referral code ที่ใช้ได้' : 'กำลังพาไปเข้าสู่ระบบ';
  const body = isInvalidCode
    ? 'เปิดลิงก์ referral ที่ถูกต้องก่อนเริ่มซื้อแพ็กเกจ'
    : bindError
      ? bindError
      : storedCode
        ? `กำลังเตรียมบัญชีของคุณสำหรับ referral code ${storedCode}`
        : 'กำลังตรวจสอบและบันทึก referral code จากลิงก์หมอ';

  return (
    <View style={styles.screen}>
      <View style={styles.panel}>
        <Text style={styles.eyebrow}>Referral</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.canvas,
    flex: 1,
    justifyContent: 'center',
    padding: MiraDesign.space.xl,
  },
  panel: {
    alignSelf: 'center',
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: MiraDesign.radius.md,
    borderWidth: 1,
    gap: 12,
    maxWidth: 520,
    padding: MiraDesign.space.xl,
    width: '100%',
  },
  eyebrow: {
    color: MiraDesign.color.blue,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  title: {
    color: MiraDesign.color.ink,
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 30,
  },
  body: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 14,
    lineHeight: 21,
  },
});
