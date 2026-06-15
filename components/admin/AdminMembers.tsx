import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { Pill } from '@/components/MiraUI';
import { MiraDesign, softShadow } from '@/constants/Design';
import { invokeFunction } from '@/lib/api/client';
import { useAuthSession } from '@/lib/auth/useAuthSession';
import { defaultTenantSlug } from '@/lib/marketplace/hospitalProducts';
import type { AdminMemberAssignableRole, AdminMemberRow, AdminMembersRequest, AdminMembersResponse } from '@/lib/types/api';

const roleOptions: AdminMemberAssignableRole[] = ['tenant_staff', 'tenant_admin'];
const roleLabels: Record<AdminMemberRow['role'], string> = {
  superadmin: 'Superadmin',
  tenant_admin: 'ผู้ดูแล',
  tenant_staff: 'พนักงาน',
};

function isAdminRole(role: AdminMemberRow['role']) {
  return role === 'superadmin' || role === 'tenant_admin';
}

function roleTone(role: AdminMemberRow['role']): 'amber' | 'blue' | 'mint' {
  if (role === 'superadmin') {
    return 'amber';
  }

  return role === 'tenant_admin' ? 'mint' : 'blue';
}

function displayName(member: AdminMemberRow) {
  return member.name || member.email || member.auth_user_id;
}

function compactId(value: string) {
  return value.length <= 12 ? value : `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function canSubmitEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function adminMembersErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;

  if (message === 'User must sign up before they can be added to this tenant.') {
    return 'บัญชีปลายทางยังไม่ได้สมัครใช้งานในระบบ ให้เจ้าของอีเมล signup ก่อน แล้วค่อยเพิ่มเป็นสมาชิกทีม';
  }

  if (message === 'Only tenant admins can manage members for this tenant.') {
    return 'บัญชีนี้ไม่มีสิทธิ์จัดการสมาชิกทีม ต้องเป็น tenant_admin หรือ superadmin';
  }

  if (message === 'This tenant must keep at least one admin.') {
    return 'ต้องเหลือผู้ดูแล tenant อย่างน้อย 1 คน';
  }

  return message;
}

function confirmAsync(title: string, message: string) {
  if (Platform.OS === 'web') {
    const confirm = (globalThis as typeof globalThis & { confirm?: (value: string) => boolean }).confirm;

    return Promise.resolve(confirm ? confirm(`${title}\n\n${message}`) : true);
  }

  return new Promise<boolean>((resolve) => {
    Alert.alert(title, message, [
      { onPress: () => resolve(false), style: 'cancel', text: 'ยกเลิก' },
      { onPress: () => resolve(true), style: 'destructive', text: 'ยืนยัน' },
    ], {
      cancelable: true,
      onDismiss: () => resolve(false),
    });
  });
}

export function AdminMembers({ title = 'จัดการสมาชิกทีม' }: { title?: string }) {
  const auth = useAuthSession();
  const { width } = useWindowDimensions();
  const [members, setMembers] = useState<AdminMemberRow[]>([]);
  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState<AdminMemberAssignableRole>('tenant_staff');
  const [isLoading, setIsLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isWide = width >= 980;
  const canMutate = Boolean(auth.session) && auth.isConfigured && !busyKey;
  const adminCount = useMemo(() => members.filter((member) => isAdminRole(member.role)).length, [members]);
  const stats = useMemo(() => ({
    admins: members.filter((member) => member.role === 'tenant_admin' || member.role === 'superadmin').length,
    staff: members.filter((member) => member.role === 'tenant_staff').length,
    total: members.length,
  }), [members]);

  const invokeMembers = useCallback(async (request: AdminMembersRequest) => {
    const response = await invokeFunction<AdminMembersRequest, AdminMembersResponse>('admin-members', request);

    setMembers(response.members);

    return response;
  }, []);

  const loadMembers = useCallback(async () => {
    if (!auth.session || !auth.isConfigured) {
      setMembers([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      await invokeMembers({ action: 'list', tenant_slug: defaultTenantSlug });
    } catch (loadError) {
      setMembers([]);
      setError(adminMembersErrorMessage(loadError, 'โหลดสมาชิกทีมไม่สำเร็จ'));
    } finally {
      setIsLoading(false);
    }
  }, [auth.isConfigured, auth.session, invokeMembers]);

  useEffect(() => {
    if (auth.isLoading) {
      return;
    }

    void loadMembers();
  }, [auth.isLoading, loadMembers]);

  async function addMember() {
    const trimmedEmail = email.trim();

    if (!canMutate || !canSubmitEmail(trimmedEmail)) {
      return;
    }

    try {
      setBusyKey('add');
      setError(null);
      setMessage(null);
      await invokeMembers({
        action: 'add',
        email: trimmedEmail,
        role: newRole,
        tenant_slug: defaultTenantSlug,
      });
      setEmail('');
      setNewRole('tenant_staff');
      setMessage('เพิ่มสมาชิกเรียบร้อยแล้ว');
    } catch (addError) {
      setError(adminMembersErrorMessage(addError, 'เพิ่มสมาชิกไม่สำเร็จ'));
    } finally {
      setBusyKey(null);
    }
  }

  async function setRole(member: AdminMemberRow, role: AdminMemberAssignableRole) {
    if (!canMutate || member.role === role || member.role === 'superadmin') {
      return;
    }

    if (member.auth_user_id === auth.user?.id && role === 'tenant_staff') {
      const confirmed = await confirmAsync('ลดสิทธิ์บัญชีตัวเอง?', 'หลังยืนยันแล้วบัญชีนี้จะไม่สามารถจัดการสมาชิกทีมได้');

      if (!confirmed) {
        return;
      }
    }

    try {
      setBusyKey(`role:${member.auth_user_id}`);
      setError(null);
      setMessage(null);
      await invokeMembers({
        action: 'set_role',
        auth_user_id: member.auth_user_id,
        role,
        tenant_slug: defaultTenantSlug,
      });
      setMessage('อัปเดต role เรียบร้อยแล้ว');
    } catch (roleError) {
      setError(adminMembersErrorMessage(roleError, 'อัปเดต role ไม่สำเร็จ'));
    } finally {
      setBusyKey(null);
    }
  }

  async function removeMember(member: AdminMemberRow) {
    if (!canMutate || member.role === 'superadmin') {
      return;
    }

    const title = member.auth_user_id === auth.user?.id ? 'ลบบัญชีตัวเองออกจาก tenant?' : 'ลบสมาชิกออกจาก tenant?';
    const confirmed = await confirmAsync(title, `${displayName(member)} จะถูกถอดสิทธิ์ออกจาก ${defaultTenantSlug}`);

    if (!confirmed) {
      return;
    }

    try {
      setBusyKey(`remove:${member.auth_user_id}`);
      setError(null);
      setMessage(null);
      await invokeMembers({
        action: 'remove',
        auth_user_id: member.auth_user_id,
        tenant_slug: defaultTenantSlug,
      });
      setMessage('ลบสมาชิกเรียบร้อยแล้ว');
    } catch (removeError) {
      setError(adminMembersErrorMessage(removeError, 'ลบสมาชิกไม่สำเร็จ'));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={[styles.topBar, !isWide ? styles.topBarStack : null]}>
          <View style={styles.titleBlock}>
            <Text style={styles.eyebrow}>MiraCare Admin</Text>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{defaultTenantSlug} · {auth.session ? auth.user?.email ?? auth.user?.id : 'ยังไม่ได้เข้าสู่ระบบ'}</Text>
          </View>
          <Pressable disabled={isLoading || !auth.session} onPress={() => void loadMembers()} style={[styles.secondaryButton, isLoading || !auth.session ? styles.disabled : null]}>
            <Text style={styles.secondaryButtonText}>{isLoading ? 'กำลังโหลด' : 'รีเฟรช'}</Text>
          </Pressable>
        </View>

        {!auth.session ? (
          <View style={styles.noticeInline}>
            <Text style={styles.noticeTitle}>ต้องเข้าสู่ระบบด้วยบัญชี tenant_admin หรือ superadmin</Text>
            <Text style={styles.noticeBody}>เข้าสู่ระบบด้วยบัญชีที่มีสิทธิ์จัดการสมาชิก แล้วรีเฟรชรายการอีกครั้ง</Text>
          </View>
        ) : null}

        {error ? <Banner tone="error" text={error} /> : null}
        {message ? <Banner tone="success" text={message} /> : null}

        <View style={styles.metrics}>
          <Metric label="สมาชิกทั้งหมด" value={`${stats.total}`} />
          <Metric label="Admin" value={`${stats.admins}`} />
          <Metric label="Staff" value={`${stats.staff}`} />
        </View>

        <View style={[styles.workspace, !isWide ? styles.workspaceStack : null]}>
          <View style={styles.formPane}>
            <Text style={styles.panelTitle}>เพิ่มสมาชิก</Text>
            <Field
              autoCapitalize="none"
              keyboardType="email-address"
              label="Email"
              onChangeText={setEmail}
              placeholder="doctor@example.com"
              value={email}
            />
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Role</Text>
              <View style={styles.segmentRow}>
                {roleOptions.map((role) => (
                  <Pressable
                    key={role}
                    onPress={() => setNewRole(role)}
                    style={[styles.segment, newRole === role ? styles.segmentActive : null]}
                  >
                    <Text style={[styles.segmentText, newRole === role ? styles.segmentTextActive : null]}>{roleLabels[role]}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <Pressable
              disabled={!canMutate || !canSubmitEmail(email) || busyKey === 'add'}
              onPress={addMember}
              style={[styles.primaryButton, !canMutate || !canSubmitEmail(email) || busyKey === 'add' ? styles.disabled : null]}
            >
              <Text style={styles.primaryButtonText}>{busyKey === 'add' ? 'กำลังเพิ่ม' : 'เพิ่มสมาชิก'}</Text>
            </Pressable>
            <Text style={styles.helperText}>บัญชีปลายทางต้องสมัครใช้งานแล้ว</Text>
          </View>

          <View style={styles.listPane}>
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>สมาชิกใน tenant</Text>
              <Text style={styles.panelMeta}>{isLoading ? 'loading' : `${members.length} accounts`}</Text>
            </View>
            {members.length === 0 ? (
              <Empty title={isLoading ? 'กำลังโหลดสมาชิก' : 'ยังไม่มีรายการ'} body={auth.session ? 'ถ้าเห็นข้อความนี้หลังโหลดเสร็จ ให้ตรวจสิทธิ์ tenant_admin ของบัญชีนี้' : 'เข้าสู่ระบบก่อนเพื่อดูรายชื่อ'} />
            ) : (
              members.map((member) => {
                const isSelf = member.auth_user_id === auth.user?.id;
                const isLastAdmin = isAdminRole(member.role) && adminCount <= 1;
                const isBusy = busyKey?.endsWith(member.auth_user_id) ?? false;
                const lockSuperadmin = member.role === 'superadmin';

                return (
                  <View key={member.auth_user_id} style={styles.memberRow}>
                    <View style={styles.rowTop}>
                      <View style={styles.rowCopy}>
                        <View style={styles.nameRow}>
                          <Text style={styles.rowTitle}>{displayName(member)}</Text>
                          {isSelf ? <Pill label="คุณ" tone="blue" /> : null}
                        </View>
                        <Text style={styles.rowMeta}>{member.email ?? 'ไม่มี email'} · {compactId(member.auth_user_id)}</Text>
                      </View>
                      <Pill label={roleLabels[member.role]} tone={roleTone(member.role)} />
                    </View>

                    <View style={styles.memberActions}>
                      <View style={styles.roleSwitch}>
                        {roleOptions.map((role) => {
                          const wouldReduceLastAdmin = role === 'tenant_staff' && isLastAdmin;
                          const disabled = !canMutate || lockSuperadmin || wouldReduceLastAdmin || isBusy;

                          return (
                            <Pressable
                              key={role}
                              disabled={disabled}
                              onPress={() => void setRole(member, role)}
                              style={[
                                styles.roleButton,
                                member.role === role ? styles.roleButtonActive : null,
                                disabled ? styles.disabled : null,
                              ]}
                            >
                              <Text style={[styles.roleButtonText, member.role === role ? styles.roleButtonTextActive : null]}>{roleLabels[role]}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <Pressable
                        disabled={!canMutate || lockSuperadmin || isLastAdmin || isBusy}
                        onPress={() => void removeMember(member)}
                        style={[styles.dangerButton, !canMutate || lockSuperadmin || isLastAdmin || isBusy ? styles.disabled : null]}
                      >
                        <Text style={styles.dangerButtonText}>{isBusy ? 'กำลังบันทึก' : 'ลบ'}</Text>
                      </Pressable>
                    </View>

                    {isLastAdmin ? <Text style={styles.lockText}>ต้องเหลือ admin อย่างน้อย 1 คน</Text> : null}
                    {lockSuperadmin ? <Text style={styles.lockText}>Superadmin แก้ผ่าน tenant role control นี้ไม่ได้</Text> : null}
                  </View>
                );
              })
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Banner({ text, tone }: { text: string; tone: 'error' | 'success' }) {
  return (
    <View style={[styles.banner, tone === 'error' ? styles.errorBanner : styles.successBanner]}>
      <Text style={[styles.bannerText, tone === 'error' ? styles.errorBannerText : styles.successBannerText]}>{text}</Text>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function Field({
  autoCapitalize,
  keyboardType,
  label,
  onChangeText,
  placeholder,
  value,
}: {
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'email-address';
  label: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={MiraDesign.color.muted}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

function Empty({ body, title }: { body: string; title: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: MiraDesign.color.canvas,
    flex: 1,
  },
  container: {
    gap: 16,
    padding: 22,
    paddingBottom: 54,
  },
  topBar: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
  },
  topBarStack: {
    flexDirection: 'column',
  },
  titleBlock: {
    flex: 1,
    gap: 6,
  },
  eyebrow: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  title: {
    color: MiraDesign.color.ink,
    fontSize: 30,
    fontWeight: '900',
    lineHeight: 36,
  },
  subtitle: {
    color: MiraDesign.color.inkSoft,
    fontSize: 14,
    lineHeight: 20,
  },
  noticeInline: {
    backgroundColor: '#FFF7DD',
    borderColor: '#F3D17B',
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  noticeTitle: {
    color: MiraDesign.color.ink,
    fontSize: 17,
    fontWeight: '900',
  },
  noticeBody: {
    color: MiraDesign.color.inkSoft,
    fontSize: 14,
    lineHeight: 20,
  },
  banner: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  errorBanner: {
    backgroundColor: '#FDECEC',
    borderColor: '#F4BBBB',
  },
  successBanner: {
    backgroundColor: '#E7F4ED',
    borderColor: '#B8DCCB',
  },
  bannerText: {
    fontSize: 13,
    fontWeight: '800',
  },
  errorBannerText: {
    color: '#8F2424',
  },
  successBannerText: {
    color: '#1E7C63',
  },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metric: {
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 150,
    padding: 13,
  },
  metricLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  metricValue: {
    color: MiraDesign.color.ink,
    fontSize: 21,
    fontWeight: '900',
    marginTop: 5,
  },
  workspace: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 16,
  },
  workspaceStack: {
    flexDirection: 'column',
  },
  formPane: {
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    flex: 0.85,
    gap: 12,
    padding: 16,
    width: '100%',
    ...softShadow,
  },
  listPane: {
    flex: 1.2,
    gap: 10,
    width: '100%',
  },
  panelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  panelTitle: {
    color: MiraDesign.color.ink,
    fontSize: 18,
    fontWeight: '900',
  },
  panelMeta: {
    color: MiraDesign.color.primary,
    fontSize: 12,
    fontWeight: '900',
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: '#F7FBFA',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    color: MiraDesign.color.ink,
    fontSize: 14,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  segmentRow: {
    backgroundColor: '#EAF3F2',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  segment: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    justifyContent: 'center',
    minHeight: 38,
  },
  segmentActive: {
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderWidth: 1,
  },
  segmentText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 13,
    fontWeight: '900',
  },
  segmentTextActive: {
    color: MiraDesign.color.primaryDeep,
  },
  primaryButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: MiraDesign.color.primary,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: MiraDesign.color.surfaceStrong,
    fontSize: 13,
    fontWeight: '900',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '900',
  },
  helperText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    lineHeight: 18,
  },
  memberRow: {
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  rowTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  rowCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  nameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  rowTitle: {
    color: MiraDesign.color.ink,
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '900',
  },
  rowMeta: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '800',
  },
  memberActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
  },
  roleSwitch: {
    backgroundColor: '#EAF3F2',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  roleButton: {
    alignItems: 'center',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 34,
    minWidth: 90,
    paddingHorizontal: 10,
  },
  roleButtonActive: {
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderWidth: 1,
  },
  roleButtonText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '900',
  },
  roleButtonTextActive: {
    color: MiraDesign.color.primaryDeep,
  },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: '#FFE2E2',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 38,
    minWidth: 72,
    paddingHorizontal: 12,
  },
  dangerButtonText: {
    color: MiraDesign.color.danger,
    fontSize: 12,
    fontWeight: '900',
  },
  lockText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    lineHeight: 18,
  },
  emptyState: {
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: 5,
    padding: 16,
  },
  emptyTitle: {
    color: MiraDesign.color.ink,
    fontSize: 15,
    fontWeight: '900',
  },
  emptyBody: {
    color: MiraDesign.color.inkSoft,
    fontSize: 13,
    lineHeight: 19,
  },
  disabled: {
    opacity: 0.45,
  },
});
