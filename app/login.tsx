import { Link, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ActionButton, Card, Pill, Screen } from '@/components/MiraUI';
import { MiraDesign, shadow } from '@/constants/Design';
import {
  signInWithEmailPassword,
  signUpWithEmailPassword,
  useAuthSession,
  useSignOut,
  type AuthAccountKind,
} from '@/lib/auth/useAuthSession';
import { supabaseConfigStatus } from '@/lib/supabase';

type LoginMode = 'admin' | 'chat' | 'referral';

type LoginCopy = {
  accountKind: AuthAccountKind;
  defaultRedirect: string;
  eyebrow: string;
  footerLabel: string;
  hint: string;
  primaryLabel: string;
  tone: 'amber' | 'blue' | 'mint';
  title: string;
};

const modeCopy: Record<LoginMode, LoginCopy> = {
  admin: {
    accountKind: 'staff',
    defaultRedirect: '/admin-panel',
    eyebrow: 'Admin Panel',
    footerLabel: 'Admin',
    hint: 'สำหรับทีมงานเท่านั้น ต้องมีสิทธิ์ใน tenant_members ก่อนจึงจะอ่านหรือแก้ข้อมูล backend ได้',
    primaryLabel: 'เข้าสู่ระบบทีมงาน',
    tone: 'blue',
    title: 'เข้าสู่ระบบ Admin Panel',
  },
  chat: {
    accountKind: 'customer',
    defaultRedirect: '/prototype',
    eyebrow: 'Chat AI',
    footerLabel: 'Chat AI',
    hint: 'บัญชีลูกค้าสำหรับคุยกับ Mira AI, เก็บประวัติแชต, ออเดอร์ และข้อมูลสุขภาพของตัวเอง',
    primaryLabel: 'เข้าสู่ระบบลูกค้า',
    tone: 'mint',
    title: 'เข้าสู่ระบบ Chat AI',
  },
  referral: {
    accountKind: 'referrer',
    defaultRedirect: '/partner',
    eyebrow: 'Referral',
    footerLabel: 'Referral',
    hint: 'บัญชีผู้แนะนำแยกจากลูกค้าและทีมงาน ใช้ ref code ที่ admin สร้างให้เพื่อ claim โปรไฟล์และดูค่าคอมมิชชัน',
    primaryLabel: 'เข้าสู่ระบบ Referral',
    tone: 'amber',
    title: 'เข้าสู่ระบบ Referral',
  },
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function safeRedirect(value: string | undefined, fallback: string) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return fallback;
  }

  return value;
}

function resolveMode(mode: string | undefined, redirect: string | undefined): LoginMode {
  if (mode === 'admin' || mode === 'chat' || mode === 'referral') {
    return mode;
  }

  if (redirect?.startsWith('/admin')) {
    return 'admin';
  }

  if (redirect?.startsWith('/partner') || redirect?.startsWith('/sales-portal')) {
    return 'referral';
  }

  return 'chat';
}

export default function LoginScreen() {
  const auth = useAuthSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; redirect?: string }>();
  const signOut = useSignOut();
  const requestedMode = firstParam(params.mode);
  const requestedRedirect = firstParam(params.redirect);
  const mode = resolveMode(requestedMode, requestedRedirect);
  const copy = modeCopy[mode];
  const redirect = safeRedirect(requestedRedirect, copy.defaultRedirect);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [refCode, setRefCode] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const switchLinks = useMemo(
    () =>
      (Object.keys(modeCopy) as LoginMode[]).map((item) => ({
        href: {
          params: {
            mode: item,
            redirect: modeCopy[item].defaultRedirect,
          },
          pathname: '/login',
        } as Href,
        label: modeCopy[item].footerLabel,
        selected: item === mode,
      })),
    [mode],
  );

  async function submit() {
    if (!supabaseConfigStatus.isConfigured) {
      setMessage('ยังไม่ได้ตั้งค่า Supabase สำหรับระบบ login');
      return;
    }

    if (!email.trim() || password.length < 6) {
      setMessage('กรอกอีเมลและรหัสผ่านอย่างน้อย 6 ตัวอักษร');
      return;
    }

    if (isSignUp && mode === 'referral' && !refCode.trim()) {
      setMessage('สมัครบัญชี Referral ต้องใช้ ref code ที่ admin สร้างให้');
      return;
    }

    try {
      setIsBusy(true);
      setMessage(null);

      const access = {
        accountKind: copy.accountKind,
        displayName,
        phone,
        refCode,
      };

      if (isSignUp) {
        const result = await signUpWithEmailPassword(email, password, displayName, access);

        if (!result.session) {
          setMessage('สมัครบัญชีแล้ว กรุณาตรวจอีเมลเพื่อยืนยันก่อนเข้าสู่ระบบ');
          return;
        }
      } else {
        await signInWithEmailPassword(email, password, access);
      }

      router.replace(redirect as Href);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setIsBusy(false);
    }
  }

  async function logout() {
    try {
      setIsBusy(true);
      setMessage(null);
      await signOut();
      setMessage('ออกจากระบบแล้ว');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'ออกจากระบบไม่สำเร็จ');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.shell}>
        <View style={styles.hero}>
          <Pill label={copy.eyebrow} tone={copy.tone} />
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.subtitle}>{copy.hint}</Text>
        </View>

        <Card style={styles.formCard}>
          {auth.session ? (
            <>
              <View style={styles.sessionBox}>
                <Text style={styles.sessionLabel}>กำลัง login อยู่</Text>
                <Text style={styles.sessionEmail}>{auth.user?.email ?? 'ไม่พบอีเมล'}</Text>
                <Text style={styles.sessionHint}>ถ้าจะเข้าอีก platform ให้ logout แล้วใช้บัญชีของ platform นั้น</Text>
              </View>
              <View style={styles.actionRow}>
                <ActionButton disabled={isBusy} label="ไปหน้าที่ต้องการ" onPress={() => router.replace(redirect as Href)} />
                <ActionButton disabled={isBusy} label="ออกจากระบบ" onPress={() => void logout()} variant="secondary" />
              </View>
            </>
          ) : (
            <>
              <View style={styles.modeSwitch}>
                <Pressable onPress={() => setIsSignUp(false)} style={[styles.modeButton, !isSignUp ? styles.modeButtonActive : null]}>
                  <Text style={[styles.modeText, !isSignUp ? styles.modeTextActive : null]}>Login</Text>
                </Pressable>
                <Pressable onPress={() => setIsSignUp(true)} style={[styles.modeButton, isSignUp ? styles.modeButtonActive : null]}>
                  <Text style={[styles.modeText, isSignUp ? styles.modeTextActive : null]}>Sign up</Text>
                </Pressable>
              </View>

              {isSignUp ? (
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>ชื่อที่แสดง</Text>
                  <TextInput
                    autoCapitalize="words"
                    onChangeText={setDisplayName}
                    placeholder={mode === 'admin' ? 'เช่น Admin User' : mode === 'referral' ? 'เช่น พญ. นก' : 'เช่น คุณบอส'}
                    placeholderTextColor={MiraDesign.color.showcaseNavySoft}
                    style={styles.input}
                    value={displayName}
                  />
                </View>
              ) : null}

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>อีเมล</Text>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  onChangeText={setEmail}
                  placeholder={mode === 'admin' ? 'staff@hospital.com' : mode === 'referral' ? 'doctor@example.com' : 'customer@example.com'}
                  placeholderTextColor={MiraDesign.color.showcaseNavySoft}
                  style={styles.input}
                  value={email}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>รหัสผ่าน</Text>
                <TextInput
                  autoCapitalize="none"
                  onChangeText={setPassword}
                  placeholder="อย่างน้อย 6 ตัวอักษร"
                  placeholderTextColor={MiraDesign.color.showcaseNavySoft}
                  secureTextEntry
                  style={styles.input}
                  value={password}
                />
              </View>

              {mode === 'chat' || mode === 'referral' ? (
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>เบอร์โทร</Text>
                  <TextInput
                    keyboardType="phone-pad"
                    onChangeText={setPhone}
                    placeholder="08xxxxxxxx"
                    placeholderTextColor={MiraDesign.color.showcaseNavySoft}
                    style={styles.input}
                    value={phone}
                  />
                </View>
              ) : null}

              {mode === 'referral' ? (
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Ref code</Text>
                  <TextInput
                    autoCapitalize="characters"
                    onChangeText={(value) => setRefCode(value.replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, 6))}
                    placeholder="เช่น DRNOK2"
                    placeholderTextColor={MiraDesign.color.showcaseNavySoft}
                    style={styles.input}
                    value={refCode}
                  />
                </View>
              ) : null}

              <ActionButton
                disabled={isBusy || !supabaseConfigStatus.isConfigured}
                label={isBusy ? 'กำลังทำรายการ' : isSignUp ? `สมัคร${copy.footerLabel}` : copy.primaryLabel}
                onPress={() => void submit()}
              />
            </>
          )}

          {message ? <Text style={styles.message}>{message}</Text> : null}
          {!supabaseConfigStatus.isConfigured ? <Text style={styles.message}>ยังไม่ได้ตั้งค่า Supabase URL / publishable key</Text> : null}
        </Card>

        <View style={styles.footerLinks}>
          {switchLinks.map((item) => {
            const footerLinkStyle = StyleSheet.flatten([styles.footerLink, item.selected ? styles.footerLinkActive : null]);
            const footerLinkTextStyle = StyleSheet.flatten([styles.footerLinkText, item.selected ? styles.footerLinkTextActive : null]);

            return (
              <Link key={item.label} href={item.href} asChild>
                <Pressable style={footerLinkStyle}>
                  <Text style={footerLinkTextStyle}>{item.label}</Text>
                </Pressable>
              </Link>
            );
          })}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: MiraDesign.space.md,
  },
  fieldGroup: {
    gap: 6,
  },
  footerLink: {
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: MiraDesign.radius.sm,
    borderWidth: 1,
    paddingHorizontal: MiraDesign.space.md,
    paddingVertical: MiraDesign.space.sm,
  },
  footerLinkActive: {
    backgroundColor: MiraDesign.color.showcaseBlueSoft,
    borderColor: MiraDesign.color.showcaseBlue,
  },
  footerLinkText: {
    color: MiraDesign.color.showcaseBlueDeep,
    fontSize: 13,
    fontWeight: '900',
  },
  footerLinkTextActive: {
    color: MiraDesign.color.showcaseNavy,
  },
  footerLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: MiraDesign.space.sm,
    justifyContent: 'center',
  },
  formCard: {
    alignSelf: 'center',
    maxWidth: 460,
    width: '100%',
    ...shadow,
  },
  hero: {
    alignSelf: 'center',
    gap: MiraDesign.space.sm,
    maxWidth: 610,
  },
  input: {
    backgroundColor: '#F7FBFF',
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: MiraDesign.radius.sm,
    borderWidth: 1,
    color: MiraDesign.color.showcaseNavy,
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: MiraDesign.space.md,
  },
  label: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 13,
    fontWeight: '900',
  },
  message: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  modeButton: {
    alignItems: 'center',
    borderRadius: MiraDesign.radius.sm,
    flex: 1,
    minHeight: 40,
    justifyContent: 'center',
  },
  modeButtonActive: {
    backgroundColor: MiraDesign.color.showcaseBlue,
  },
  modeSwitch: {
    backgroundColor: MiraDesign.color.showcaseBlueSoft,
    borderRadius: MiraDesign.radius.sm,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  modeText: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 13,
    fontWeight: '900',
  },
  modeTextActive: {
    color: '#FFFFFF',
  },
  sessionBox: {
    backgroundColor: MiraDesign.color.showcaseBlueSoft,
    borderRadius: MiraDesign.radius.sm,
    gap: 5,
    padding: MiraDesign.space.md,
  },
  sessionEmail: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 16,
    fontWeight: '900',
  },
  sessionHint: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  sessionLabel: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  shell: {
    gap: MiraDesign.space.xl,
    justifyContent: 'center',
    minHeight: 600,
  },
  subtitle: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  title: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 32,
    fontWeight: '900',
    lineHeight: 38,
    textAlign: 'center',
  },
});
