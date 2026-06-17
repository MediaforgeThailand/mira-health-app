import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { AdminBadge, AdminHeader, EmptyState, SummaryChips } from '@/components/admin/adminUi';
import { MiraDesign } from '@/constants/Design';
import { useAuthSession } from '@/lib/auth/useAuthSession';
import { defaultTenantSlug } from '@/lib/marketplace/hospitalProducts';
import { showcaseDemoCommissions, showcaseDemoReferrers, showcaseDemoTenant } from '@/lib/showcase/demoFixtures';
import { supabase, supabaseConfigStatus } from '@/lib/supabase';
import type { CommissionEntryRow, ReferrerRow, ReferrerType, TenantSummary } from '@/lib/types/api';

const brandLogo = require('@/assets/images/mira-care-logo.png');

type TenantContext = TenantSummary & {
  role: string;
};

type ReferrerDraft = {
  active: boolean;
  authUserId: string;
  name: string;
  phone: string;
  refCode: string;
  type: ReferrerType;
};

type CommissionWithJoins = CommissionEntryRow & {
  orders?: {
    amount_baht: number;
    products?: {
      name: string;
    } | {
      name: string;
    }[] | null;
  } | {
    amount_baht: number;
    products?: {
      name: string;
    } | {
      name: string;
    }[] | null;
  }[] | null;
  referrers?: {
    name: string;
    ref_code: string;
  } | {
    name: string;
    ref_code: string;
  }[] | null;
};

const emptyDraft: ReferrerDraft = {
  active: true,
  authUserId: '',
  name: '',
  phone: '',
  refCode: '',
  type: 'doctor',
};
const allowedReferrerTypes: ReferrerType[] = ['doctor', 'nurse', 'creator', 'staff'];
const referrerTypeLabels: Record<ReferrerType, string> = {
  creator: 'ครีเอเตอร์',
  doctor: 'แพทย์',
  nurse: 'พยาบาล',
  staff: 'ทีมงาน',
};

function fromJoin<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function formatMoney(amount: number) {
  return `${amount.toLocaleString('th-TH')} THB`;
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    month: 'short',
  }).format(new Date(value));
}

function commissionStatusLabel(status: CommissionEntryRow['status']) {
  if (status === 'approved') {
    return 'อนุมัติแล้ว';
  }

  if (status === 'paid') {
    return 'จ่ายแล้ว';
  }

  if (status === 'void') {
    return 'ยกเลิก';
  }

  return 'รออนุมัติ';
}

function commissionSchemeLabel(scheme: CommissionEntryRow['scheme_snapshot']) {
  const defaultValue = scheme.default;

  if (scheme.mode === 'flat_baht') {
    return `${defaultValue.toLocaleString('th-TH')} THB`;
  }

  return `${defaultValue.toLocaleString('th-TH')}%`;
}

export function ReferrersAdmin({ title = 'ผู้แนะนำและค่าคอมมิชชัน' }: { title?: string }) {
  const auth = useAuthSession();
  const { tour } = useLocalSearchParams<{ tour?: string }>();
  const { width } = useWindowDimensions();
  const [tenant, setTenant] = useState<TenantContext | null>(null);
  const [referrers, setReferrers] = useState<ReferrerRow[]>([]);
  const [commissions, setCommissions] = useState<CommissionWithJoins[]>([]);
  const [draft, setDraft] = useState<ReferrerDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyCommissionId, setBusyCommissionId] = useState<string | null>(null);
  const [selectedCommissionIds, setSelectedCommissionIds] = useState<Set<string>>(() => new Set());
  const [demoFallbackReason, setDemoFallbackReason] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isWide = width >= 1080;
  const isCompact = width < 760;
  const isTourMode = tour === 'admin';
  const isBaseDemoMode = isTourMode || !auth.session || !supabaseConfigStatus.isConfigured;
  const isDemoMode = isBaseDemoMode || Boolean(demoFallbackReason);
  const canEdit = !isDemoMode && Boolean(auth.session) && (tenant?.role === 'tenant_admin' || tenant?.role === 'superadmin');
  const canSave =
    canEdit &&
    draft.name.trim().length > 1 &&
    allowedReferrerTypes.includes(draft.type);
  const selectedCommissions = useMemo(
    () => commissions.filter((entry) => selectedCommissionIds.has(entry.id)),
    [commissions, selectedCommissionIds],
  );
  const allCommissionsSelected = commissions.length > 0 && selectedCommissions.length === commissions.length;

  const totals = useMemo(
    () => ({
      approved: commissions.filter((entry) => entry.status === 'approved').reduce((sum, entry) => sum + entry.amount_baht, 0),
      paid: commissions.filter((entry) => entry.status === 'paid').reduce((sum, entry) => sum + entry.amount_baht, 0),
      pending: commissions.filter((entry) => entry.status === 'pending').reduce((sum, entry) => sum + entry.amount_baht, 0),
    }),
    [commissions],
  );
  const activeReferrerCount = referrers.filter((referrer) => referrer.active).length;
  const totalCommission = totals.approved + totals.paid + totals.pending;

  const loadDemoReferrers = useCallback((reason: string | null = null) => {
    setDemoFallbackReason(reason);
    setTenant({ ...showcaseDemoTenant, role: 'demo' });
    setReferrers(showcaseDemoReferrers);
    setCommissions(showcaseDemoCommissions);
    setSelectedCommissionIds(new Set());
  }, []);

  const loadData = useCallback(async () => {
    if (!auth.user) {
      loadDemoReferrers(null);
      return;
    }

    const { data: tenantRow, error: tenantError } = await supabase
      .from('tenants')
      .select('id,slug,display_name,logo_url')
      .eq('slug', defaultTenantSlug)
      .maybeSingle();

    if (tenantError || !tenantRow) {
      throw new Error(tenantError?.message ?? `Tenant "${defaultTenantSlug}" is not available.`);
    }

    const { data: member, error: memberError } = await supabase
      .from('tenant_members')
      .select('role')
      .eq('tenant_id', (tenantRow as TenantSummary).id)
      .eq('auth_user_id', auth.user.id)
      .maybeSingle();

    if (memberError || !member) {
      throw new Error(memberError?.message ?? 'Your account is not a member of this tenant.');
    }

    const tenantContext = {
      ...(tenantRow as TenantSummary),
      role: String((member as { role: string }).role),
    };
    setTenant(tenantContext);

    const { data: referrerRows, error: referrerError } = await supabase
      .from('referrers')
      .select('id,tenant_id,ref_code,name,type,phone,auth_user_id,commission_scheme,active,created_at')
      .eq('tenant_id', tenantContext.id)
      .order('created_at', { ascending: false });

    if (referrerError) {
      throw new Error(referrerError.message);
    }

    const { data: commissionRows, error: commissionError } = await supabase
      .from('commission_entries')
      .select('id,tenant_id,referrer_id,order_id,scheme_snapshot,amount_baht,status,created_at,referrers(name,ref_code),orders(amount_baht,products(name))')
      .eq('tenant_id', tenantContext.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (commissionError) {
      throw new Error(commissionError.message);
    }

    const nextCommissions = (commissionRows ?? []) as unknown as CommissionWithJoins[];
    setDemoFallbackReason(null);
    setReferrers((referrerRows ?? []) as unknown as ReferrerRow[]);
    setCommissions(nextCommissions);
    setSelectedCommissionIds((current) => {
      const visibleIds = new Set(nextCommissions.map((entry) => entry.id));

      return new Set([...current].filter((id) => visibleIds.has(id)));
    });
  }, [auth.user, loadDemoReferrers]);

  useEffect(() => {
    let isMounted = true;

    async function boot() {
      if (isBaseDemoMode) {
        loadDemoReferrers(null);
        setIsLoading(false);
        return;
      }

      try {
        setError(null);
        await loadData();
      } catch (loadError) {
        if (isMounted) {
          const reason = loadError instanceof Error ? loadError.message : 'โหลดข้อมูล referral จาก backend ไม่สำเร็จ';
          loadDemoReferrers(reason);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void boot();

    return () => {
      isMounted = false;
    };
  }, [auth.session, isBaseDemoMode, loadData, loadDemoReferrers]);

  function editReferrer(referrer: ReferrerRow) {
    setEditingId(referrer.id);
    setDraft({
      active: referrer.active,
      authUserId: referrer.auth_user_id ?? '',
      name: referrer.name,
      phone: referrer.phone ?? '',
      refCode: referrer.ref_code,
      type: referrer.type,
    });
    setMessage(null);
    setError(null);
  }

  function resetForm() {
    setEditingId(null);
    setDraft(emptyDraft);
    setMessage(null);
    setError(null);
  }

  async function refreshReferrers() {
    try {
      setError(null);
      setMessage(null);

      if (isDemoMode) {
        loadDemoReferrers(demoFallbackReason);
        setMessage('กำลังแสดงข้อมูลตัวอย่างอยู่');
        return;
      }

      await loadData();
      setMessage('รีเฟรชข้อมูล referral แล้ว');
    } catch (refreshError) {
      const reason = refreshError instanceof Error ? refreshError.message : 'รีเฟรชข้อมูล referral ไม่สำเร็จ';
      loadDemoReferrers(reason);
    }
  }

  async function saveReferrer() {
    if (!tenant || !canSave || isSaving) {
      return;
    }

    if (isDemoMode) {
      setMessage('โหมดตัวอย่าง — ยังไม่สร้าง referrer จริง');
      return;
    }

    try {
      setIsSaving(true);
      setError(null);
      setMessage(null);
      const payload = {
        active: draft.active,
        auth_user_id: draft.authUserId.trim() || null,
        name: draft.name.trim(),
        phone: draft.phone.trim() || null,
        tenant_id: tenant.id,
        type: draft.type,
      };
      const query = editingId
        ? supabase.from('referrers').update(payload).eq('id', editingId).eq('tenant_id', tenant.id)
        : supabase.from('referrers').insert(payload);
      const { error: saveError } = await query;

      if (saveError) {
        throw new Error(saveError.message);
      }

      setMessage(editingId ? 'อัปเดตผู้แนะนำแล้ว' : 'สร้างผู้แนะนำแล้ว');
      resetForm();
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save referrer.');
    } finally {
      setIsSaving(false);
    }
  }

  async function updateCommissionStatus(entry: CommissionEntryRow, status: CommissionEntryRow['status']) {
    if (!canEdit || busyCommissionId) {
      return;
    }

    if (isDemoMode) {
      setMessage('โหมดตัวอย่าง — ยังไม่เปลี่ยนสถานะ commission จริง');
      return;
    }

    try {
      setBusyCommissionId(entry.id);
      setError(null);
      setMessage(null);
      const { error: updateError } = await supabase
        .from('commission_entries')
        .update({ status })
        .eq('id', entry.id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      setMessage(`อัปเดตค่าคอมมิชชันเป็น ${commissionStatusLabel(status)} แล้ว`);
      await loadData();
    } catch (commissionError) {
      setError(commissionError instanceof Error ? commissionError.message : 'Unable to update commission.');
    } finally {
      setBusyCommissionId(null);
    }
  }

  function toggleCommissionSelection(id: string) {
    setSelectedCommissionIds((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  function toggleAllCommissions() {
    setSelectedCommissionIds(() => {
      if (allCommissionsSelected) {
        return new Set();
      }

      return new Set(commissions.map((entry) => entry.id));
    });
  }

  async function updateSelectedCommissionStatus(status: Extract<CommissionEntryRow['status'], 'approved' | 'paid'>) {
    if (!canEdit || busyCommissionId || !tenant || selectedCommissions.length === 0) {
      return;
    }

    if (isDemoMode) {
      setMessage('โหมดตัวอย่าง — ยังไม่เปลี่ยนสถานะ commission จริง');
      return;
    }

    try {
      setBusyCommissionId('bulk');
      setError(null);
      setMessage(null);
      const selectedIds = selectedCommissions.map((entry) => entry.id);
      const { error: updateError } = await supabase
        .from('commission_entries')
        .update({ status })
        .eq('tenant_id', tenant.id)
        .in('id', selectedIds);

      if (updateError) {
        throw new Error(updateError.message);
      }

      setMessage(`อัปเดตค่าคอมมิชชัน ${selectedIds.length} รายการเป็น ${commissionStatusLabel(status)} แล้ว`);
      setSelectedCommissionIds(new Set());
      await loadData();
    } catch (commissionError) {
      setError(commissionError instanceof Error ? commissionError.message : 'Unable to update selected commissions.');
    } finally {
      setBusyCommissionId(null);
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.container, isCompact ? styles.containerCompact : null]} keyboardShouldPersistTaps="handled">
        <AdminHeader
          actions={
            <Pressable
              accessibilityLabel="รีเฟรช"
              accessibilityRole="button"
              disabled={isLoading}
              onPress={() => void refreshReferrers()}
              style={[styles.headerBtn, isLoading ? styles.disabled : null]}
            >
              <SymbolView name={{ android: 'refresh', ios: 'arrow.clockwise', web: 'refresh' }} size={16} tintColor={MiraDesign.color.primaryDeep} />
              <Text style={styles.headerBtnText}>{isLoading ? 'กำลังรีเฟรช' : 'รีเฟรช'}</Text>
            </Pressable>
          }
          eyebrow="หลังบ้าน / Referral"
          metaText={tenant ? `${tenant.display_name} · ${tenant.role}` : defaultTenantSlug}
          modeLabel={isDemoMode ? 'โหมดตัวอย่าง' : canEdit ? 'ใช้งานจริง' : 'อ่านอย่างเดียว'}
          modeTone={isDemoMode ? 'amber' : canEdit ? 'primary' : 'blue'}
          note={
            isDemoMode
              ? demoFallbackReason
                ? `โหมดตัวอย่าง: ${demoFallbackReason}`
                : 'โหมดตัวอย่าง: ปุ่มแก้ไขข้อมูลจริงจะถูกปิดไว้'
              : !canEdit && tenant
                ? 'สิทธิ์อ่านอย่างเดียว: เฉพาะ tenant admin แก้ไขได้'
                : null
          }
          title="จัดการสมาชิก Ref Program"
        />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {message ? <Text style={styles.successText}>{message}</Text> : null}

        <SummaryChips
          items={[
            { key: 'pending', label: 'รออนุมัติ', value: formatMoney(totals.pending) },
            { key: 'approved', label: 'อนุมัติแล้ว', value: formatMoney(totals.approved) },
            { key: 'paid', label: 'จ่ายแล้ว', value: formatMoney(totals.paid) },
            { key: 'members', label: 'สมาชิก', value: `${referrers.length} คน` },
          ]}
        />

        <View style={[styles.workspace, !isWide ? styles.workspaceStack : null]}>
          <View style={[styles.formPane, !isWide ? styles.fullWidthPane : null]}>
            <View style={styles.panelHeader}>
              <View style={styles.panelHeaderCopy}>
                <Text style={styles.panelTitle}>{editingId ? 'แก้ไขสมาชิก' : 'เพิ่มสมาชิก Ref Program'}</Text>
                <Text style={styles.panelMeta}>{editingId ?? 'ระบบสร้าง ref code ให้อัตโนมัติ'}</Text>
              </View>
              {editingId ? (
                <Pressable onPress={resetForm} style={styles.textButton}>
                  <Text style={styles.textButtonLabel}>รายการใหม่</Text>
                </Pressable>
              ) : null}
            </View>

            <Field label="ชื่อ" onChangeText={(value) => setDraft((current) => ({ ...current, name: value }))} value={draft.name} />
            <View style={[styles.twoColumn, isCompact ? styles.twoColumnStack : null]}>
              <Field disabled label="รหัสแนะนำ" onChangeText={() => null} value={editingId ? draft.refCode : 'สร้างเมื่อบันทึก'} />
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>ประเภท</Text>
                <View style={styles.typeGrid}>
                  {allowedReferrerTypes.map((type) => (
                    <Pressable
                      key={type}
                      onPress={() => setDraft((current) => ({ ...current, type }))}
                      style={[styles.typeOption, draft.type === type ? styles.typeOptionActive : null]}
                    >
                      <Text style={[styles.typeOptionText, draft.type === type ? styles.typeOptionTextActive : null]}>{referrerTypeLabels[type]}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
            <Field label="เบอร์โทร" onChangeText={(value) => setDraft((current) => ({ ...current, phone: value }))} value={draft.phone} />
            <Field label="Auth User ID" onChangeText={(value) => setDraft((current) => ({ ...current, authUserId: value }))} value={draft.authUserId} />

            <View style={styles.productRateNote}>
              <Text style={styles.productRateTitle}>Commission by product</Text>
              <Text style={styles.productRateBody}>หน้า Referral ใช้จัดการสมาชิกเท่านั้น ส่วน %/บาทที่สมาชิกได้รับให้อิงจากสินค้าใน catalog และ snapshot ตอนเกิด order</Text>
            </View>

            <View style={styles.segmentRow}>
              <Pressable onPress={() => setDraft((current) => ({ ...current, active: true }))} style={[styles.segment, draft.active ? styles.segmentActive : null]}>
                <Text style={[styles.segmentText, draft.active ? styles.segmentTextActive : null]}>เปิดใช้งาน</Text>
              </Pressable>
              <Pressable onPress={() => setDraft((current) => ({ ...current, active: false }))} style={[styles.segment, !draft.active ? styles.segmentActive : null]}>
                <Text style={[styles.segmentText, !draft.active ? styles.segmentTextActive : null]}>ปิดใช้งาน</Text>
              </Pressable>
            </View>

            <Pressable disabled={!canSave || isSaving} onPress={saveReferrer} style={[styles.primaryButton, !canSave || isSaving ? styles.disabled : null]}>
              <Text style={styles.primaryButtonText}>{isSaving ? 'กำลังบันทึก' : editingId ? 'บันทึกสมาชิก' : 'สร้างสมาชิก'}</Text>
            </Pressable>
          </View>

          <View style={[styles.operationsPane, !isWide ? styles.fullWidthPane : null]}>
            <View style={styles.listPane}>
              <View style={styles.sectionHeader}>
                <View style={styles.panelHeaderCopy}>
                  <Text style={styles.panelTitle}>สมาชิก Ref Program</Text>
                  <Text style={styles.panelMeta}>{referrers.length} โปรไฟล์ในระบบ</Text>
                </View>
              </View>
              {referrers.length === 0 ? (
                <EmptyState
                  body="เพิ่มสมาชิก ref program คนแรกเพื่อเปิด flow ช่วยปิดการขาย"
                  icon={{ android: 'group', ios: 'person.2', web: 'group' }}
                  title="ยังไม่มีสมาชิก"
                />
              ) : (
                referrers.map((referrer) => (
                  <View key={referrer.id} style={styles.referrerRow}>
                    <View style={styles.rowTop}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{referrer.name.trim().slice(0, 1) || 'M'}</Text>
                      </View>
                      <View style={styles.rowCopy}>
                        <Text style={styles.rowTitle}>{referrer.name}</Text>
                        <Text style={styles.rowMeta}>{referrer.ref_code} · {referrerTypeLabels[referrer.type] ?? referrer.type}</Text>
                      </View>
                      <AdminBadge label={referrer.active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'} tone={referrer.active ? 'success' : 'muted'} />
                    </View>
                    <View style={styles.rowStats}>
                      <View style={styles.rowStat}>
                        <Text style={styles.rowStatLabel}>COMMISSION SOURCE</Text>
                        <Text style={styles.rowStatValue}>ตามสินค้า</Text>
                      </View>
                      <View style={styles.rowStat}>
                        <Text style={styles.rowStatLabel}>สร้างเมื่อ</Text>
                        <Text style={styles.rowStatValue}>{formatShortDate(referrer.created_at)}</Text>
                      </View>
                    </View>
                    <Pressable disabled={!canEdit} onPress={() => editReferrer(referrer)} style={[styles.secondaryButton, styles.rowActionButton, !canEdit ? styles.disabled : null]}>
                      <Text style={styles.secondaryButtonText}>แก้ไข</Text>
                    </Pressable>
                  </View>
                ))
              )}
            </View>

            <View style={styles.commissionsPane}>
              <View style={styles.bulkBar}>
                <View style={styles.panelHeaderCopy}>
                  <Text style={styles.panelTitle}>ค่าคอมมิชชันตามสินค้า</Text>
                  <Text style={styles.panelMeta}>เลือกแล้ว {selectedCommissions.length} รายการ · rate จาก order snapshot</Text>
                </View>
                <View style={styles.actionRow}>
                  <Pressable
                    disabled={!canEdit || commissions.length === 0 || Boolean(busyCommissionId)}
                    onPress={toggleAllCommissions}
                    style={[styles.secondaryButton, !canEdit || commissions.length === 0 || Boolean(busyCommissionId) ? styles.disabled : null]}
                  >
                    <Text style={styles.secondaryButtonText}>{allCommissionsSelected ? 'ล้าง' : 'เลือกทั้งหมด'}</Text>
                  </Pressable>
                  <Pressable
                    disabled={!canEdit || selectedCommissions.length === 0 || Boolean(busyCommissionId)}
                    onPress={() => void updateSelectedCommissionStatus('approved')}
                    style={[styles.smallButton, !canEdit || selectedCommissions.length === 0 || Boolean(busyCommissionId) ? styles.disabled : null]}
                  >
                    <Text style={styles.smallButtonText}>{busyCommissionId === 'bulk' ? 'กำลังบันทึก' : 'อนุมัติที่เลือก'}</Text>
                  </Pressable>
                  <Pressable
                    disabled={!canEdit || selectedCommissions.length === 0 || Boolean(busyCommissionId)}
                    onPress={() => void updateSelectedCommissionStatus('paid')}
                    style={[styles.smallButton, !canEdit || selectedCommissions.length === 0 || Boolean(busyCommissionId) ? styles.disabled : null]}
                  >
                    <Text style={styles.smallButtonText}>{busyCommissionId === 'bulk' ? 'กำลังบันทึก' : 'ทำเครื่องหมายจ่ายแล้ว'}</Text>
                  </Pressable>
                </View>
              </View>
              {commissions.length === 0 ? (
                <EmptyState
                  body="รายการจะถูกสร้างเมื่อ admin ยืนยันออเดอร์ที่มี attribution"
                  icon={{ android: 'payments', ios: 'creditcard', web: 'payments' }}
                  title="ยังไม่มีค่าคอมมิชชัน"
                />
              ) : (
                commissions.map((entry) => (
                  <CommissionRow
                    key={entry.id}
                    busy={busyCommissionId === entry.id}
                    canEdit={canEdit}
                    entry={entry}
                    onStatus={(status) => void updateCommissionStatus(entry, status)}
                    onToggleSelected={() => toggleCommissionSelection(entry.id)}
                    selected={selectedCommissionIds.has(entry.id)}
                  />
                ))
              )}
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Field({
  disabled,
  label,
  onChangeText,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChangeText: (value: string) => void;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        editable={!disabled}
        onChangeText={onChangeText}
        placeholderTextColor={MiraDesign.color.inkSoft}
        style={[styles.input, disabled ? styles.inputDisabled : null]}
        value={value}
      />
    </View>
  );
}

function CommissionRow({
  busy,
  canEdit,
  entry,
  onStatus,
  onToggleSelected,
  selected,
}: {
  busy: boolean;
  canEdit: boolean;
  entry: CommissionWithJoins;
  onStatus: (status: CommissionEntryRow['status']) => void;
  onToggleSelected: () => void;
  selected: boolean;
}) {
  const referrer = fromJoin(entry.referrers);
  const order = fromJoin(entry.orders);
  const product = fromJoin(order?.products);

  return (
    <View style={styles.commissionRow}>
      <View style={styles.rowTop}>
        <Pressable
          accessibilityLabel={selected ? 'ยกเลิกเลือกค่าคอมมิชชัน' : 'เลือกค่าคอมมิชชัน'}
          disabled={!canEdit || busy}
          onPress={onToggleSelected}
          style={[styles.checkBox, selected ? styles.checkBoxSelected : null, !canEdit || busy ? styles.disabled : null]}
        >
          <Text style={[styles.checkBoxText, selected ? styles.checkBoxTextSelected : null]}>{selected ? 'x' : ''}</Text>
        </Pressable>
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>{product?.name ?? `ออเดอร์ ${entry.order_id.slice(0, 8)}`}</Text>
          <Text style={styles.rowMeta}>{formatShortDate(entry.created_at)} · {referrer ? `${referrer.name} · ${referrer.ref_code}` : entry.referrer_id}</Text>
        </View>
        <AdminBadge label={commissionStatusLabel(entry.status)} tone={entry.status === 'paid' ? 'success' : entry.status === 'void' ? 'danger' : 'amber'} />
      </View>
      <View style={styles.ledgerAmount}>
        <View>
          <Text style={styles.rowStatLabel}>ยอดจ่าย</Text>
          <Text style={styles.rowBody}>{formatMoney(entry.amount_baht)}</Text>
        </View>
        <View>
          <Text style={styles.rowStatLabel}>PRODUCT RATE SNAPSHOT</Text>
          <Text style={styles.rowBody}>{commissionSchemeLabel(entry.scheme_snapshot)}</Text>
        </View>
      </View>
      <View style={styles.actionRow}>
        {(['approved', 'paid', 'void'] as const).map((status) => (
          <Pressable
            key={status}
            disabled={!canEdit || busy || entry.status === status}
            onPress={() => onStatus(status)}
            style={[styles.smallButton, !canEdit || busy || entry.status === status ? styles.disabled : null]}
          >
            <Text style={styles.smallButtonText}>{busy ? 'กำลังบันทึก' : commissionStatusLabel(status)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: MiraDesign.color.canvas, flex: 1 },
  container: { gap: 12, padding: 16, paddingBottom: 32 },
  containerCompact: { padding: 12 },
  headerBtn: { alignItems: 'center', backgroundColor: MiraDesign.color.surface, borderColor: MiraDesign.color.line, borderRadius: 8, borderWidth: 1, cursor: 'pointer', flexDirection: 'row', gap: 6, height: 38, paddingHorizontal: 12 },
  headerBtnText: { color: MiraDesign.color.primaryDeep, fontSize: 13, fontWeight: '800' },
  errorText: { color: MiraDesign.color.danger, fontSize: 13, fontWeight: '800' },
  successText: { color: MiraDesign.color.primaryDeep, fontSize: 13, fontWeight: '800' },
  workspace: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  workspaceStack: { flexDirection: 'column' },
  formPane: { backgroundColor: MiraDesign.color.surface, borderColor: MiraDesign.color.line, borderRadius: 8, borderWidth: 1, flexGrow: 1, flexShrink: 1, flexBasis: 0, gap: 10, minWidth: 0, padding: 12 },
  fullWidthPane: { width: '100%' },
  operationsPane: { flexGrow: 1.3, flexShrink: 1, flexBasis: 0, gap: 12, minWidth: 0 },
  listPane: { backgroundColor: MiraDesign.color.surface, borderColor: MiraDesign.color.line, borderRadius: 8, borderWidth: 1, gap: 8, padding: 12 },
  commissionsPane: { backgroundColor: MiraDesign.color.surface, borderColor: MiraDesign.color.line, borderRadius: 8, borderWidth: 1, gap: 8, padding: 12 },
  panelHeader: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
  panelHeaderCopy: { flex: 1, gap: 2, minWidth: 0 },
  panelTitle: { color: MiraDesign.color.ink, fontSize: 15, fontWeight: '900' },
  panelMeta: { color: MiraDesign.color.inkSoft, fontSize: 12, fontWeight: '700' },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  bulkBar: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  textButton: { backgroundColor: MiraDesign.color.surfaceSoft, borderRadius: 8, cursor: 'pointer', paddingHorizontal: 12, paddingVertical: 8 },
  textButtonLabel: { color: MiraDesign.color.primaryDeep, fontSize: 12, fontWeight: '800' },
  field: { flex: 1, gap: 6 },
  fieldLabel: { color: MiraDesign.color.inkSoft, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  input: { backgroundColor: '#FBFDFE', borderColor: MiraDesign.color.line, borderRadius: 8, borderWidth: 1, color: MiraDesign.color.ink, fontSize: 14, minHeight: 42, paddingHorizontal: 12 },
  inputDisabled: { backgroundColor: MiraDesign.color.surfaceSoft, color: MiraDesign.color.inkSoft },
  twoColumn: { flexDirection: 'row', gap: 10 },
  twoColumnStack: { flexDirection: 'column' },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  typeOption: { backgroundColor: MiraDesign.color.surfaceSoft, borderRadius: 999, cursor: 'pointer', paddingHorizontal: 12, paddingVertical: 7 },
  typeOptionActive: { backgroundColor: MiraDesign.color.primarySoft, borderColor: MiraDesign.color.primary, borderWidth: 1 },
  typeOptionText: { color: MiraDesign.color.inkSoft, fontSize: 12, fontWeight: '800' },
  typeOptionTextActive: { color: MiraDesign.color.primaryDeep },
  productRateNote: { backgroundColor: MiraDesign.color.surfaceSoft, borderRadius: 8, gap: 4, padding: 10 },
  productRateTitle: { color: MiraDesign.color.ink, fontSize: 13, fontWeight: '800' },
  productRateBody: { color: MiraDesign.color.inkSoft, fontSize: 12, lineHeight: 17 },
  segmentRow: { backgroundColor: MiraDesign.color.surfaceSoft, borderRadius: 8, flexDirection: 'row', gap: 4, padding: 4 },
  segment: { alignItems: 'center', borderRadius: 6, cursor: 'pointer', flex: 1, justifyContent: 'center', minHeight: 34, paddingHorizontal: 8 },
  segmentActive: { backgroundColor: MiraDesign.color.surface, borderColor: MiraDesign.color.line, borderWidth: 1 },
  segmentText: { color: MiraDesign.color.inkSoft, fontSize: 12, fontWeight: '800' },
  segmentTextActive: { color: MiraDesign.color.primaryDeep },
  primaryButton: { alignItems: 'center', backgroundColor: MiraDesign.color.primary, borderRadius: 8, cursor: 'pointer', justifyContent: 'center', minHeight: 44 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  secondaryButton: { alignItems: 'center', backgroundColor: MiraDesign.color.surface, borderColor: MiraDesign.color.line, borderRadius: 8, borderWidth: 1, cursor: 'pointer', justifyContent: 'center', minHeight: 36, paddingHorizontal: 12 },
  secondaryButtonText: { color: MiraDesign.color.primaryDeep, fontSize: 12, fontWeight: '800' },
  smallButton: { alignItems: 'center', backgroundColor: MiraDesign.color.surfaceSoft, borderRadius: 8, cursor: 'pointer', justifyContent: 'center', minHeight: 34, paddingHorizontal: 12 },
  smallButtonText: { color: MiraDesign.color.primaryDeep, fontSize: 12, fontWeight: '800' },
  referrerRow: { borderColor: MiraDesign.color.line, borderRadius: 8, borderWidth: 1, gap: 8, padding: 12 },
  rowTop: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  avatar: { alignItems: 'center', backgroundColor: MiraDesign.color.primarySoft, borderRadius: 999, height: 38, justifyContent: 'center', width: 38 },
  avatarText: { color: MiraDesign.color.primaryDeep, fontSize: 15, fontWeight: '900' },
  rowCopy: { flex: 1, gap: 2, minWidth: 0 },
  rowTitle: { color: MiraDesign.color.ink, fontSize: 14, fontWeight: '800' },
  rowMeta: { color: MiraDesign.color.inkSoft, fontSize: 12, fontWeight: '600' },
  rowBody: { color: MiraDesign.color.ink, fontSize: 13, fontWeight: '700' },
  rowStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  rowStat: { gap: 2 },
  rowStatLabel: { color: MiraDesign.color.inkSoft, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  rowStatValue: { color: MiraDesign.color.ink, fontSize: 13, fontWeight: '700' },
  rowActionButton: { alignSelf: 'flex-start' },
  commissionRow: { borderColor: MiraDesign.color.line, borderRadius: 8, borderWidth: 1, gap: 8, padding: 12 },
  checkBox: { alignItems: 'center', backgroundColor: MiraDesign.color.surface, borderColor: MiraDesign.color.line, borderRadius: 6, borderWidth: 1, cursor: 'pointer', height: 24, justifyContent: 'center', width: 24 },
  checkBoxSelected: { backgroundColor: MiraDesign.color.primary, borderColor: MiraDesign.color.primary },
  checkBoxText: { color: 'transparent', fontSize: 14, fontWeight: '900' },
  checkBoxTextSelected: { color: '#FFFFFF' },
  ledgerAmount: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  disabled: { opacity: 0.45 },
});
