import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { MiraDesign } from '@/constants/Design';
import { createReferralAppLink } from '@/lib/marketplace/referralMock';
import { normalizeRefCode, storeReferralCode } from '@/lib/referrals/attribution';

export default function ReferralLandingScreen() {
  const params = useLocalSearchParams<{ ref_code?: string }>();
  const router = useRouter();
  const refCode = useMemo(() => normalizeRefCode(String(params.ref_code ?? '')), [params.ref_code]);
  const appLink = useMemo(() => (refCode ? createReferralAppLink(refCode) : null), [refCode]);
  const [storedCode, setStoredCode] = useState<string | null>(null);
  const [attemptedAppOpen, setAttemptedAppOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function persistReferral() {
      const stored = await storeReferralCode(refCode);

      if (!isMounted) {
        return;
      }

      setStoredCode(stored?.ref_code ?? null);

      if (!stored) {
        return;
      }

      if (Platform.OS !== 'web') {
        router.replace('/prototype');
        return;
      }

      if (appLink && isLikelyMobileWeb()) {
        setAttemptedAppOpen(true);
        await Linking.openURL(appLink).catch(() => undefined);
      }
    }

    void persistReferral();

    return () => {
      isMounted = false;
    };
  }, [appLink, refCode, router]);

  return (
    <View style={styles.screen}>
      <View style={styles.panel}>
        <Text style={styles.eyebrow}>Referral</Text>
        <Text style={styles.title}>{storedCode ? 'บันทึก referral แล้ว' : 'ไม่พบ referral code ที่ใช้ได้'}</Text>
        <Text style={styles.body}>
          {storedCode
            ? `โค้ด ${storedCode} จะถูกแนบกับคำสั่งซื้อที่เข้าเงื่อนไขภายในช่วง attribution`
            : 'เปิดลิงก์ referral ที่ถูกต้องก่อนเริ่มซื้อแพ็กเกจ'}
        </Text>
        {attemptedAppOpen ? <Text style={styles.hint}>ถ้าแอปไม่เปิดอัตโนมัติ เลือกปุ่มด้านล่างได้เลย</Text> : null}
        <View style={styles.actions}>
          {appLink ? (
            <Pressable onPress={() => void Linking.openURL(appLink)} style={styles.button}>
              <Text style={styles.buttonText}>เปิดในแอป</Text>
            </Pressable>
          ) : null}
          <Link href="/prototype" asChild>
            <Pressable style={[styles.button, styles.secondaryButton]}>
              <Text style={[styles.buttonText, styles.secondaryButtonText]}>เล่นต่อบนเว็บ</Text>
            </Pressable>
          </Link>
        </View>
      </View>
    </View>
  );
}

function isLikelyMobileWeb() {
  const userAgent = (globalThis as typeof globalThis & { navigator?: { userAgent?: string } }).navigator?.userAgent ?? '';

  return /Android|iPhone|iPad|iPod/i.test(userAgent);
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    backgroundColor: '#F5F8F7',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  panel: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    maxWidth: 520,
    padding: 20,
    width: '100%',
  },
  eyebrow: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  title: {
    color: MiraDesign.color.ink,
    fontSize: 28,
    fontWeight: '900',
  },
  body: {
    color: MiraDesign.color.inkSoft,
    fontSize: 14,
    lineHeight: 21,
  },
  hint: {
    color: MiraDesign.color.muted,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  button: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: MiraDesign.color.primary,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  secondaryButton: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderWidth: 1,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  secondaryButtonText: {
    color: MiraDesign.color.primaryDeep,
  },
});
