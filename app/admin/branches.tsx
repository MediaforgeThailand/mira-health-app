import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { AdminBadge, AdminCard, AdminHeader, AdminScreen, EmptyState, SectionTitle, SummaryChips } from '@/components/admin/adminUi';
import { MiraDesign } from '@/constants/Design';
import { useAuthSession } from '@/lib/auth/useAuthSession';
import {
  canWriteTenantCatalog,
  defaultTenantSlug,
  loadBranches,
  loadTenantMemberContext,
  saveBranch,
  type BranchDraft,
  type BranchSummary,
  type TenantMemberContext,
} from '@/lib/marketplace/hospitalProducts';
import { showcaseDemoBranches, showcaseDemoTenantContext } from '@/lib/showcase/demoFixtures';
import { supabaseConfigStatus } from '@/lib/supabase';

const emptyDraft: BranchDraft = {
  active: true,
  address: '',
  district: '',
  imageUrl: '',
  mapUrl: '',
  name: '',
  phone: '',
  sort: '',
};

export default function AdminBranchesScreen() {
  const auth = useAuthSession();
  const { tour } = useLocalSearchParams<{ tour?: string }>();
  const { width } = useWindowDimensions();
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [draft, setDraft] = useState<BranchDraft>(emptyDraft);
  const [editingBranch, setEditingBranch] = useState<BranchSummary | null>(null);
  const [tenantContext, setTenantContext] = useState<TenantMemberContext | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyBranchId, setBusyBranchId] = useState<string | null>(null);
  const [demoFallbackReason, setDemoFallbackReason] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isWide = width >= 980;
  const isTourMode = tour === 'admin';
  const isBaseDemoMode = isTourMode || !auth.session || !supabaseConfigStatus.isConfigured;
  const isDemoMode = isBaseDemoMode || Boolean(demoFallbackReason);
  const canEditBranches = !isDemoMode && Boolean(auth.session) && canWriteTenantCatalog(tenantContext);
  const canSave = canEditBranches && draft.name.trim().length > 1;

  const summary = useMemo(
    () => ({
      active: branches.filter((branch) => branch.active).length,
      inactive: branches.filter((branch) => !branch.active).length,
      total: branches.length,
    }),
    [branches],
  );

  function loadDemoBranches(reason: string | null = null) {
    setDemoFallbackReason(reason);
    setTenantContext(showcaseDemoTenantContext);
    setBranches(showcaseDemoBranches);
  }

  useEffect(() => {
    let isMounted = true;

    loadBranchAdmin().finally(() => {
      if (isMounted) {
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [auth.user, isBaseDemoMode]);

  async function loadBranchAdmin() {
    try {
      setError(null);

      if (isBaseDemoMode || !auth.user) {
        loadDemoBranches(null);
        return;
      }

      setDemoFallbackReason(null);
      const context = await loadTenantMemberContext();
      setTenantContext(context);

      if (!context) {
        loadDemoBranches(`บัญชีนี้ยังไม่ได้เชื่อมกับ tenant "${defaultTenantSlug}"`);
        return;
      }

      setBranches(await loadBranches());
    } catch (loadError) {
      const reason = loadError instanceof Error ? loadError.message : 'โหลดข้อมูลสาขาจาก backend ไม่สำเร็จ';
      loadDemoBranches(reason);
    }
  }

  function updateDraft<K extends keyof BranchDraft>(field: K, value: BranchDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function editBranch(branch: BranchSummary) {
    setEditingBranch(branch);
    setDraft(draftFromBranch(branch));
    setMessage(null);
    setError(null);
  }

  function resetForm() {
    setEditingBranch(null);
    setDraft(emptyDraft);
    setMessage(null);
    setError(null);
  }

  async function refreshBranches() {
    try {
      setError(null);
      if (isDemoMode) {
        loadDemoBranches(demoFallbackReason);
        setMessage('กำลังแสดงข้อมูลตัวอย่างอยู่');
        return;
      }
      setBranches(await loadBranches());
    } catch (refreshError) {
      const reason = refreshError instanceof Error ? refreshError.message : 'รีเฟรชข้อมูลสาขาไม่สำเร็จ';
      loadDemoBranches(reason);
      setMessage('กำลังแสดงข้อมูลตัวอย่างอยู่');
    }
  }

  async function saveDraft() {
    if (!canSave || isSaving) {
      return;
    }

    try {
      setIsSaving(true);
      setError(null);
      setMessage(null);
      const saved = await saveBranch(draft, editingBranch?.id);
      setBranches((current) => [saved, ...current.filter((branch) => branch.id !== saved.id)].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)));
      setEditingBranch(saved);
      setDraft(draftFromBranch(saved));
      setMessage(`Saved ${saved.name}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save branch.');
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleBranch(branch: BranchSummary) {
    if (!canEditBranches || busyBranchId) {
      return;
    }

    try {
      setBusyBranchId(branch.id);
      setError(null);
      setMessage(null);
      const saved = await saveBranch({ ...draftFromBranch(branch), active: !branch.active }, branch.id);
      setBranches((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      if (editingBranch?.id === saved.id) {
        setEditingBranch(saved);
        setDraft(draftFromBranch(saved));
      }
      setMessage(`${saved.name} is now ${saved.active ? 'active' : 'inactive'}.`);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Unable to update branch.');
    } finally {
      setBusyBranchId(null);
    }
  }

  return (
    <AdminScreen>
      <AdminHeader
        actions={
          <>
            <Pressable
              accessibilityLabel="รีเฟรช"
              accessibilityRole="button"
              disabled={isLoading}
              onPress={refreshBranches}
              style={[styles.headerBtn, isLoading ? styles.disabled : null]}
            >
              <SymbolView name={{ android: 'refresh', ios: 'arrow.clockwise', web: 'refresh' }} size={16} tintColor={MiraDesign.color.primaryDeep} />
              <Text style={styles.headerBtnText}>{isLoading ? 'กำลังรีเฟรช' : 'รีเฟรช'}</Text>
            </Pressable>
            <Link href="/admin/catalog" asChild>
              <Pressable accessibilityRole="link" style={styles.headerBtn}>
                <SymbolView name={{ android: 'inventory_2', ios: 'cube', web: 'inventory_2' }} size={16} tintColor={MiraDesign.color.primaryDeep} />
                <Text style={styles.headerBtnText}>แค็ตตาล็อก</Text>
              </Pressable>
            </Link>
          </>
        }
        eyebrow="หลังบ้าน / สาขา"
        metaText={tenantContext ? `${tenantContext.display_name} · ${tenantContext.role}` : defaultTenantSlug}
        modeLabel={isDemoMode ? 'โหมดตัวอย่าง' : 'ใช้งานจริง'}
        modeTone={isDemoMode ? 'amber' : 'primary'}
        note={
          isDemoMode
            ? 'โหมดตัวอย่าง: ปุ่มบันทึกข้อมูลจริงจะถูกปิดไว้'
            : tenantContext && !canEditBranches
              ? 'สิทธิ์อ่านอย่างเดียว: เฉพาะ tenant_admin หรือ superadmin แก้ไขได้'
              : null
        }
        title="จัดการสาขา"
      />

      <SummaryChips
        items={[
          { key: 'total', label: 'ทั้งหมด', value: summary.total },
          { key: 'active', label: 'เปิดใช้งาน', value: summary.active },
          { key: 'inactive', label: 'ปิดใช้งาน', value: summary.inactive },
        ]}
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {message ? <Text style={styles.successText}>{message}</Text> : null}

      <View style={[styles.workspace, !isWide ? styles.workspaceStack : null]}>
        <View style={styles.listCol}>
          <SectionTitle meta={isLoading ? 'กำลังโหลด' : `${summary.total} สาขา`} title="รายชื่อสาขา" />
          {branches.length === 0 ? (
            <EmptyState
              body="สร้างสาขาหลักก่อนผูกสินค้าเข้ากับสาขา"
              icon={{ android: 'store', ios: 'building.2', web: 'store' }}
              title="ยังไม่มีสาขา"
            />
          ) : (
            <View style={styles.list}>
              {branches.map((branch) => (
                <AdminCard key={branch.id} style={editingBranch?.id === branch.id ? styles.cardSelected : undefined}>
                  <View style={styles.branchTop}>
                    <Text numberOfLines={1} style={styles.branchTitle}>
                      {branch.name}
                    </Text>
                    <AdminBadge label={branch.active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'} tone={branch.active ? 'success' : 'muted'} />
                  </View>
                  <Text numberOfLines={1} style={styles.branchMeta}>
                    {[branch.address, branch.district, branch.phone].filter(Boolean).join(' · ') || 'ยังไม่มีที่อยู่'}
                  </Text>
                  <View style={styles.rowActions}>
                    <Pressable accessibilityRole="button" onPress={() => editBranch(branch)} style={styles.smallBtn}>
                      <Text style={styles.smallBtnText}>แก้ไข</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={!canEditBranches || Boolean(busyBranchId)}
                      onPress={() => void toggleBranch(branch)}
                      style={[styles.smallBtn, !canEditBranches || busyBranchId ? styles.disabled : null]}
                    >
                      <Text style={styles.smallBtnText}>
                        {busyBranchId === branch.id ? 'กำลังบันทึก' : branch.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                      </Text>
                    </Pressable>
                  </View>
                </AdminCard>
              ))}
            </View>
          )}
        </View>

        <View style={styles.formCol}>
          <View style={styles.formCard}>
            <View style={styles.formHead}>
              <Text style={styles.formTitle}>{editingBranch ? 'แก้ไขสาขา' : 'เพิ่มสาขา'}</Text>
              {editingBranch ? (
                <Pressable accessibilityRole="button" onPress={resetForm} style={styles.smallBtn}>
                  <Text style={styles.smallBtnText}>รายการใหม่</Text>
                </Pressable>
              ) : null}
            </View>

            <Field label="ชื่อสาขา" onChangeText={(value) => updateDraft('name', value)} value={draft.name} />
            <Field label="ที่อยู่" multiline onChangeText={(value) => updateDraft('address', value)} value={draft.address ?? ''} />
            <View style={styles.twoColumn}>
              <Field label="เขต/อำเภอ" onChangeText={(value) => updateDraft('district', value)} value={draft.district ?? ''} />
              <Field label="เบอร์โทร" onChangeText={(value) => updateDraft('phone', value)} value={draft.phone ?? ''} />
            </View>
            <Field label="ลิงก์แผนที่" onChangeText={(value) => updateDraft('mapUrl', value)} value={draft.mapUrl ?? ''} />
            <Field label="ลิงก์รูปภาพ" onChangeText={(value) => updateDraft('imageUrl', value)} value={draft.imageUrl ?? ''} />
            <View style={styles.twoColumn}>
              <Field label="ลำดับ" onChangeText={(value) => updateDraft('sort', value)} value={draft.sort ?? ''} />
              <View style={styles.controlGroup}>
                <Text style={styles.fieldLabel}>สถานะ</Text>
                <View style={styles.segmentRow}>
                  <Pressable onPress={() => updateDraft('active', true)} style={[styles.segment, draft.active !== false ? styles.segmentActive : null]}>
                    <Text style={[styles.segmentText, draft.active !== false ? styles.segmentTextActive : null]}>เปิดใช้งาน</Text>
                  </Pressable>
                  <Pressable onPress={() => updateDraft('active', false)} style={[styles.segment, draft.active === false ? styles.segmentActive : null]}>
                    <Text style={[styles.segmentText, draft.active === false ? styles.segmentTextActive : null]}>ปิดใช้งาน</Text>
                  </Pressable>
                </View>
              </View>
            </View>

            <Pressable disabled={!canSave || isSaving} onPress={saveDraft} style={[styles.saveButton, !canSave || isSaving ? styles.disabled : null]}>
              <Text style={styles.saveButtonText}>{isSaving ? 'กำลังบันทึก' : editingBranch ? 'บันทึกสาขา' : 'สร้างสาขา'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </AdminScreen>
  );
}

function draftFromBranch(branch: BranchSummary): BranchDraft {
  return {
    active: branch.active,
    address: branch.address ?? '',
    district: branch.district ?? '',
    imageUrl: branch.imageUrl ?? '',
    mapUrl: branch.mapUrl ?? '',
    name: branch.name,
    phone: branch.phone ?? '',
    sort: `${branch.sort}`,
  };
}

function Field({
  label,
  multiline = false,
  onChangeText,
  value,
}: {
  label: string;
  multiline?: boolean;
  onChangeText: (value: string) => void;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        multiline={multiline}
        onChangeText={onChangeText}
        placeholderTextColor={MiraDesign.color.inkSoft}
        style={[styles.input, multiline ? styles.multilineInput : null]}
        textAlignVertical={multiline ? 'top' : 'center'}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headerBtn: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    cursor: 'pointer',
    flexDirection: 'row',
    gap: 6,
    height: 38,
    paddingHorizontal: 12,
  },
  headerBtnText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 13,
    fontWeight: '800',
  },
  errorText: {
    color: MiraDesign.color.danger,
    fontSize: 13,
    fontWeight: '800',
  },
  successText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 13,
    fontWeight: '800',
  },
  workspace: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
  },
  workspaceStack: {
    flexDirection: 'column',
  },
  listCol: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    gap: 8,
    minWidth: 0,
  },
  formCol: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
  },
  list: {
    gap: 8,
  },
  cardSelected: {
    borderColor: MiraDesign.color.primary,
  },
  branchTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  branchTitle: {
    color: MiraDesign.color.ink,
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
  },
  branchMeta: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '600',
  },
  rowActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  smallBtn: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.surfaceSoft,
    borderRadius: 8,
    cursor: 'pointer',
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: 12,
  },
  smallBtnText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '800',
  },
  formCard: {
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  formHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  formTitle: {
    color: MiraDesign.color.ink,
    fontSize: 15,
    fontWeight: '900',
  },
  field: {
    flex: 1,
    gap: 6,
  },
  fieldLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: '#FBFDFE',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    color: MiraDesign.color.ink,
    fontSize: 14,
    minHeight: 42,
    paddingHorizontal: 12,
  },
  multilineInput: {
    minHeight: 76,
    paddingTop: 10,
  },
  twoColumn: {
    flexDirection: 'row',
    gap: 10,
  },
  controlGroup: {
    flex: 1,
    gap: 6,
  },
  segmentRow: {
    backgroundColor: MiraDesign.color.surfaceSoft,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  segment: {
    alignItems: 'center',
    borderRadius: 6,
    cursor: 'pointer',
    flex: 1,
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: 8,
  },
  segmentActive: {
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderWidth: 1,
  },
  segmentText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '800',
  },
  segmentTextActive: {
    color: MiraDesign.color.primaryDeep,
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.primary,
    borderRadius: 8,
    cursor: 'pointer',
    justifyContent: 'center',
    minHeight: 44,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  disabled: {
    opacity: 0.45,
  },
});
