import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { Pill } from '@/components/MiraUI';
import { MiraDesign, softShadow } from '@/constants/Design';
import { useAuthSession } from '@/lib/auth/useAuthSession';
import { defaultTenantSlug } from '@/lib/marketplace/hospitalProducts';
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
  staff: 'ทีมโรงพยาบาล',
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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isWide = width >= 1080;
  const isCompact = width < 760;
  const backendReady = supabaseConfigStatus.isConfigured;
  const canEdit = backendReady && Boolean(auth.session) && (tenant?.role === 'tenant_admin' || tenant?.role === 'superadmin');
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

  const loadData = useCallback(async () => {
    if (auth.isLoading) {
      return;
    }

    if (!backendReady || !auth.user) {
      setTenant(null);
      setReferrers([]);
      setCommissions([]);
      setSelectedCommissionIds(new Set());
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
    setReferrers((referrerRows ?? []) as unknown as ReferrerRow[]);
    setCommissions(nextCommissions);
    setSelectedCommissionIds((current) => {
      const visibleIds = new Set(nextCommissions.map((entry) => entry.id));

      return new Set([...current].filter((id) => visibleIds.has(id)));
    });
  }, [auth.isLoading, auth.user, backendReady]);

  useEffect(() => {
    let isMounted = true;

    async function boot() {
      try {
        setError(null);
        await loadData();
      } catch (loadError) {
        if (isMounted) {
          const reason = loadError instanceof Error ? loadError.message : 'โหลดข้อมูล referral จาก backend ไม่สำเร็จ';
          setTenant(null);
          setReferrers([]);
          setCommissions([]);
          setSelectedCommissionIds(new Set());
          setError(reason);
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
  }, [auth.session, loadData]);

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

      await loadData();
      setMessage('รีเฟรชข้อมูล referral แล้ว');
    } catch (refreshError) {
      const reason = refreshError instanceof Error ? refreshError.message : 'รีเฟรชข้อมูล referral ไม่สำเร็จ';
      setTenant(null);
      setReferrers([]);
      setCommissions([]);
      setSelectedCommissionIds(new Set());
      setError(reason);
    }
  }

  async function saveReferrer() {
    if (!tenant || !canSave || isSaving) {
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
        <View style={[styles.hero, !isWide ? styles.heroStack : null]}>
          <View style={styles.heroCopy}>
            <View style={styles.brandRow}>
              <Image source={brandLogo} resizeMode="contain" style={styles.brandLogo} />
              <View style={styles.brandDivider} />
              <Text style={styles.brandText}>Referral Ops</Text>
            </View>
            <Text style={styles.eyebrow}>Referral User Program</Text>
            <Text style={styles.title}>จัดการสมาชิก Ref Program</Text>
            <Text style={styles.subtitle}>
              {tenant ? `${tenant.display_name} · ${tenant.role}` : isLoading ? 'กำลังโหลดสิทธิ์ tenant' : defaultTenantSlug}
              {' · '}ค่าคอมมิชชันอิงจากสินค้าใน catalog
            </Text>
          </View>

          <View style={[styles.heroPanel, !isWide ? styles.heroPanelStacked : null]}>
            <View style={styles.heroPanelTop}>
              <Text style={styles.panelMeta}>สถานะพื้นที่ทำงาน</Text>
              <Pill label={canEdit ? 'แก้ไขได้' : backendReady ? 'อ่านอย่างเดียว' : 'ยังไม่เชื่อม backend'} tone={canEdit ? 'mint' : backendReady ? 'blue' : 'amber'} />
            </View>
            <Text style={styles.heroPanelTitle}>{activeReferrerCount} สมาชิกที่เปิดใช้งาน</Text>
            <Text style={styles.heroPanelBody}>ยอด commission ทั้งหมด {formatMoney(totalCommission)} จาก {commissions.length} รายการล่าสุด · rate อยู่ที่สินค้า</Text>
            <Pressable disabled={isLoading} onPress={() => void refreshReferrers()} style={[styles.secondaryButton, styles.refreshButton, isLoading ? styles.disabled : null]}>
              <Text style={styles.secondaryButtonText}>{isLoading ? 'กำลังรีเฟรช' : 'รีเฟรช'}</Text>
            </Pressable>
          </View>
        </View>

        {!canEdit && tenant ? (
          <View style={styles.noticeInline}>
            <Text style={styles.noticeTitle}>สิทธิ์อ่านอย่างเดียว</Text>
            <Text style={styles.noticeBody}>เฉพาะ tenant admin เท่านั้นที่แก้ไขสมาชิก หรือสถานะค่าคอมมิชชันได้</Text>
          </View>
        ) : null}

        {error ? <Banner tone="error" text={error} /> : null}
        {message ? <Banner tone="success" text={message} /> : null}
        {!backendReady ? <Banner tone="error" text="ยังไม่ได้เชื่อมต่อ backend สำหรับ Referrers Admin" /> : null}
        {backendReady && !auth.session ? <Banner tone="error" text="กรุณาเข้าสู่ระบบด้วยบัญชี tenant ก่อนจัดการ referrers จริง" /> : null}

        <View style={[styles.metrics, isCompact ? styles.metricsCompact : null]}>
          <Metric compact={isCompact} detail="รอตรวจรายการก่อนจ่าย" label="รออนุมัติ" value={formatMoney(totals.pending)} />
          <Metric compact={isCompact} detail="พร้อมส่งต่อฝ่ายการเงิน" label="อนุมัติแล้ว" value={formatMoney(totals.approved)} />
          <Metric compact={isCompact} detail="ปิดรอบ payout แล้ว" label="จ่ายแล้ว" value={formatMoney(totals.paid)} />
          <Metric compact={isCompact} detail={`${activeReferrerCount} เปิดใช้งาน`} label="สมาชิก" value={`${referrers.length} คน`} />
        </View>

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
                <Empty title="ยังไม่มีสมาชิก" body="เพิ่มสมาชิก ref program คนแรกเพื่อเปิด flow ช่วยปิดการขาย" />
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
                      <Pill label={referrer.active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'} tone={referrer.active ? 'mint' : 'amber'} />
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
                <Empty title="ยังไม่มีค่าคอมมิชชัน" body="รายการจะถูกสร้างเมื่อ admin ยืนยันออเดอร์ที่มี attribution" />
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

function Banner({ text, tone }: { text: string; tone: 'error' | 'success' }) {
  return (
    <View style={[styles.banner, tone === 'error' ? styles.errorBanner : styles.successBanner]}>
      <Text style={[styles.bannerText, tone === 'error' ? styles.errorBannerText : styles.successBannerText]}>{text}</Text>
    </View>
  );
}

function Metric({ compact, detail, label, value }: { compact?: boolean; detail?: string; label: string; value: string }) {
  return (
    <View style={[styles.metric, compact ? styles.metricCompact : null]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      {detail ? <Text style={styles.metricDetail}>{detail}</Text> : null}
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
        placeholderTextColor={MiraDesign.color.showcaseNavySoft}
        style={[styles.input, disabled ? styles.inputDisabled : null]}
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
        <Pill label={commissionStatusLabel(entry.status)} tone={entry.status === 'paid' ? 'mint' : entry.status === 'void' ? 'danger' : 'amber'} />
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
  screen: {
    backgroundColor: MiraDesign.color.showcaseCanvas,
    flex: 1,
  },
  container: {
    gap: 14,
    padding: 22,
    paddingBottom: 48,
    width: '100%',
  },
  containerCompact: {
    padding: 14,
    paddingBottom: 44,
  },
  hero: {
    alignItems: 'stretch',
    backgroundColor: MiraDesign.color.showcaseSurface,
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
    padding: 16,
    ...softShadow,
  },
  heroStack: {
    flexDirection: 'column',
  },
  heroCopy: {
    flex: 1,
    gap: 7,
    minWidth: 0,
  },
  brandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 4,
  },
  brandLogo: {
    height: 30,
    width: 118,
  },
  brandDivider: {
    backgroundColor: MiraDesign.color.showcaseLine,
    height: 24,
    width: 1,
  },
  brandText: {
    color: MiraDesign.color.showcaseBlueDeep,
    fontSize: 13,
    fontWeight: '900',
  },
  eyebrow: {
    color: MiraDesign.color.showcaseBlueDeep,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  title: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 34,
  },
  subtitle: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 14,
    lineHeight: 20,
  },
  heroPanel: {
    backgroundColor: '#F6FBFF',
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    justifyContent: 'space-between',
    maxWidth: 330,
    minWidth: 280,
    padding: 14,
    ...softShadow,
  },
  heroPanelStacked: {
    maxWidth: '100%',
    minWidth: '100%',
  },
  heroPanelTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  heroPanelTitle: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 28,
  },
  heroPanelBody: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 13,
    lineHeight: 19,
  },
  noticeInline: {
    backgroundColor: '#FFF7DD',
    borderColor: '#F3D17B',
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  noticeTitle: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 17,
    fontWeight: '900',
  },
  noticeBody: {
    color: MiraDesign.color.showcaseNavySoft,
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
  metricsCompact: {
    alignItems: 'stretch',
    flexDirection: 'column',
  },
  metric: {
    backgroundColor: MiraDesign.color.showcaseSurface,
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    flexGrow: 1,
    gap: 4,
    minWidth: 168,
    padding: 12,
  },
  metricCompact: {
    flexGrow: 0,
    maxWidth: '100%',
    minWidth: 0,
    width: '100%',
  },
  metricLabel: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  metricValue: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 19,
    fontWeight: '900',
    marginTop: 5,
  },
  metricDetail: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  workspace: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
  },
  workspaceStack: {
    flexDirection: 'column',
  },
  fullWidthPane: {
    maxWidth: '100%',
    width: '100%',
  },
  formPane: {
    backgroundColor: MiraDesign.color.showcaseSurface,
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    flex: 0.84,
    gap: 11,
    maxWidth: 400,
    minWidth: 310,
    padding: 14,
    ...softShadow,
  },
  operationsPane: {
    flex: 1.36,
    gap: 12,
    minWidth: 0,
  },
  listPane: {
    gap: 12,
    width: '100%',
  },
  commissionsPane: {
    backgroundColor: MiraDesign.color.showcaseSurface,
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
    ...softShadow,
  },
  bulkBar: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  panelHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  panelHeaderCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  panelTitle: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 17,
    fontWeight: '900',
  },
  panelMeta: {
    color: MiraDesign.color.showcaseBlue,
    fontSize: 12,
    fontWeight: '900',
    marginTop: 3,
  },
  textButton: {
    backgroundColor: MiraDesign.color.showcaseBlueSoft,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  textButtonLabel: {
    color: MiraDesign.color.showcaseBlueDeep,
    fontSize: 12,
    fontWeight: '900',
  },
  field: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  fieldLabel: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: '#F7FBFF',
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    color: MiraDesign.color.showcaseNavy,
    fontSize: 13,
    minHeight: 40,
    minWidth: 0,
    paddingHorizontal: 12,
  },
  inputDisabled: {
    backgroundColor: MiraDesign.color.showcaseBlueSoft,
    color: MiraDesign.color.showcaseNavySoft,
  },
  twoColumn: {
    flexDirection: 'row',
    gap: 10,
  },
  twoColumnStack: {
    flexDirection: 'column',
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  typeOption: {
    alignItems: 'center',
    backgroundColor: '#F7FBFF',
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 32,
    minWidth: 86,
    paddingHorizontal: 10,
  },
  typeOptionActive: {
    backgroundColor: MiraDesign.color.showcaseBlue,
    borderColor: MiraDesign.color.showcaseBlue,
  },
  typeOptionText: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },
  typeOptionTextActive: {
    color: '#FFFFFF',
  },
  segmentRow: {
    backgroundColor: MiraDesign.color.showcaseBlueSoft,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 4,
    minWidth: 0,
    padding: 4,
  },
  segment: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    justifyContent: 'center',
    minHeight: 34,
  },
  segmentActive: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.showcaseLine,
    borderWidth: 1,
  },
  segmentText: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 12,
    fontWeight: '900',
  },
  segmentTextActive: {
    color: MiraDesign.color.showcaseBlueDeep,
  },
  productRateNote: {
    backgroundColor: MiraDesign.color.showcaseBlueSoft,
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    gap: 5,
    padding: 10,
  },
  productRateTitle: {
    color: MiraDesign.color.showcaseBlueDeep,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  productRateBody: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 18,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.showcaseBlue,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 14,
    width: '100%',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 12,
  },
  secondaryButtonText: {
    color: MiraDesign.color.showcaseBlueDeep,
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },
  refreshButton: {
    alignSelf: 'flex-start',
    minWidth: 110,
  },
  referrerRow: {
    backgroundColor: MiraDesign.color.showcaseSurface,
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 12,
    ...softShadow,
  },
  commissionRow: {
    backgroundColor: '#F7FBFF',
    borderColor: MiraDesign.color.showcaseLineSoft,
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.showcaseBlueSoft,
    borderRadius: 8,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  avatarText: {
    color: MiraDesign.color.showcaseBlueDeep,
    fontSize: 16,
    fontWeight: '900',
  },
  rowTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
  },
  rowCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  rowTitle: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 20,
  },
  rowMeta: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
  },
  rowStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  rowStat: {
    backgroundColor: '#F6FBFF',
    borderColor: MiraDesign.color.showcaseLineSoft,
    borderRadius: 8,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 112,
    padding: 9,
  },
  rowStatLabel: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 11,
    fontWeight: '900',
  },
  rowStatValue: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 14,
    fontWeight: '900',
    marginTop: 3,
  },
  rowActionButton: {
    alignSelf: 'flex-start',
    minWidth: 120,
  },
  ledgerAmount: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.showcaseLineSoft,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    justifyContent: 'space-between',
    padding: 9,
  },
  rowBody: {
    color: MiraDesign.color.showcaseBlueDeep,
    fontSize: 13,
    fontWeight: '900',
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  checkBox: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 6,
    borderWidth: 1,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  checkBoxSelected: {
    backgroundColor: MiraDesign.color.showcaseBlue,
    borderColor: MiraDesign.color.showcaseBlue,
  },
  checkBoxText: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 16,
  },
  checkBoxTextSelected: {
    color: '#FFFFFF',
  },
  smallButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.showcaseBlue,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 32,
    minWidth: 96,
    paddingHorizontal: 10,
  },
  smallButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },
  emptyState: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: 5,
    padding: 16,
  },
  emptyTitle: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 15,
    fontWeight: '900',
  },
  emptyBody: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 13,
    lineHeight: 19,
  },
  disabled: {
    opacity: 0.45,
  },
});
