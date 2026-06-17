import { Link, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import type { ComponentProps, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { AdminHeader, SummaryChips } from '@/components/admin/adminUi';
import { MiraDesign, softShadow } from '@/constants/Design';
import { useAuthSession } from '@/lib/auth/useAuthSession';
import {
  canWriteTenantCatalog,
  defaultTenantSlug,
  formatCommissionPercent,
  getProductCategories,
  getProductCategoryLabel,
  hasStripeCatalogMapping,
  loadBranches,
  loadTenantMemberContext,
  loadManagedHospitalProducts,
  loadProductCategories,
  saveCatalogProduct,
  saveProductCategory,
  shouldSyncCatalogStatusToStripe,
  syncHospitalProductToStripe,
  updateHospitalProductStatus,
  uploadProductImage,
  type BranchSummary,
  type HospitalProduct,
  type HospitalProductDraft,
  type HospitalProductStatus,
  type ProductCategory,
  type ProductCategoryDraft,
  type ProductCategoryOption,
  type TenantMemberContext,
} from '@/lib/marketplace/hospitalProducts';
import { demoCatalogForVertical, showcaseDemoTenantContext } from '@/lib/showcase/demoFixtures';
import { supabaseConfigStatus } from '@/lib/supabase';
import { useTenantConfig } from '@/lib/tenant/useTenantConfig';
import { catalogScreenCopy } from '@/lib/tenant/vocabulary';

const emptyDraft: HospitalProductDraft = {
  branchInfo: '',
  branchIds: [],
  category: 'general',
  description: '',
  hospitalAddress: '',
  hospitalMapQuery: '',
  hospitalName: '',
  imageUrl: '',
  priceAmount: '',
  requiresAppointment: true,
  title: '',
};

type SymbolName = ComponentProps<typeof SymbolView>['name'];

const statusFilters = ['all', 'active', 'draft', 'pending_review', 'rejected', 'archived'] as const;
const ragFilters = ['all', 'ready', 'publish', 'embedding', 'error'] as const;
const stripeFilters = ['all', 'synced', 'missing', 'partial'] as const;
const catalogMobileBreakpoint = 760;
const catalogDesktopBreakpoint = 1120;

type StatusFilter = (typeof statusFilters)[number];
type RagFilter = (typeof ragFilters)[number];
type StripeFilter = (typeof stripeFilters)[number];
type ReadinessTone = 'danger' | 'info' | 'muted' | 'success' | 'warning';
type RagReadinessKey = 'ready' | 'publish' | 'embedding' | 'review' | 'error' | 'archived';

function statusFilterLabel(status: StatusFilter) {
  if (status === 'active') {
    return 'เปิดขาย';
  }

  if (status === 'draft') {
    return 'Draft';
  }

  if (status === 'pending_review') {
    return 'รอตรวจ';
  }

  if (status === 'rejected') {
    return 'ไม่ผ่าน';
  }

  if (status === 'archived') {
    return 'เก็บถาวร';
  }

  return 'ทั้งหมด';
}

function productStatusLabel(status: HospitalProductStatus) {
  if (status === 'active') {
    return 'เปิดขาย';
  }

  if (status === 'draft') {
    return 'draft';
  }

  if (status === 'pending_review') {
    return 'รอตรวจ';
  }

  if (status === 'rejected') {
    return 'ไม่ผ่าน';
  }

  return 'เก็บถาวร';
}

function ragFilterLabel(filter: RagFilter) {
  if (filter === 'ready') {
    return 'พร้อมใช้กับ RAG';
  }

  if (filter === 'publish') {
    return 'รอ publish';
  }

  if (filter === 'embedding') {
    return 'รอ embedding';
  }

  if (filter === 'error') {
    return 'ผิดพลาด';
  }

  return 'ทั้งหมด';
}

function stripeFilterLabel(filter: StripeFilter) {
  if (filter === 'synced') {
    return 'ซิงก์แล้ว';
  }

  if (filter === 'missing') {
    return 'รอซิงก์';
  }

  if (filter === 'partial') {
    return 'ข้อมูลไม่ครบ';
  }

  return 'ทั้งหมด';
}

export function CatalogCrud({ title }: { title?: string }) {
  const auth = useAuthSession();
  const { tour } = useLocalSearchParams<{ tour?: string }>();
  const { config: tenantConfig } = useTenantConfig();
  const vocab = tenantConfig.vocabulary;
  const copy = catalogScreenCopy(vocab);
  const { width } = useWindowDimensions();
  const webViewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
  const viewportWidth = width > 0 ? width : webViewportWidth;
  const [draft, setDraft] = useState<HospitalProductDraft>(emptyDraft);
  const [editingProduct, setEditingProduct] = useState<HospitalProduct | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [categories, setCategories] = useState<ProductCategoryOption[]>([]);
  const [categoryDraft, setCategoryDraft] = useState<ProductCategoryDraft>({
    active: true,
    icon: '',
    key: '',
    labelTh: '',
    sort: '',
  });
  const [products, setProducts] = useState<HospitalProduct[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<ProductCategory | 'all'>('all');
  const [ragFilter, setRagFilter] = useState<RagFilter>('all');
  const [stripeFilter, setStripeFilter] = useState<StripeFilter>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tenantContext, setTenantContext] = useState<TenantMemberContext | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isBulkSyncing, setIsBulkSyncing] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [demoFallbackReason, setDemoFallbackReason] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMobile = viewportWidth > 0 && viewportWidth < catalogMobileBreakpoint;
  const isWide = viewportWidth >= catalogDesktopBreakpoint;
  const isTourMode = tour === 'admin';
  const isBaseDemoMode = isTourMode || !auth.session || !supabaseConfigStatus.isConfigured;
  const isDemoMode = isBaseDemoMode || Boolean(demoFallbackReason);
  const canEditCatalog = !isDemoMode && Boolean(auth.session) && canWriteTenantCatalog(tenantContext);
  const canSave =
    canEditCatalog &&
    draft.title.trim().length > 1 &&
    draft.description.trim().length > 3 &&
    Number(draft.priceAmount.replace(/,/g, '')) >= 0;
  const categoryOptions = useMemo<ProductCategoryOption[]>(
    () =>
      categories.length > 0
        ? categories
        : getProductCategories().map((category, index) => ({
            active: true,
            icon: null,
            imageUrl: null,
            key: category,
            labelTh: getProductCategoryLabel(category),
            sort: index,
          })),
    [categories],
  );
  const activeCategoryOptions = useMemo(() => categoryOptions.filter((category) => category.active), [categoryOptions]);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return products.filter((product) => {
      const matchesStatus = statusFilter === 'all' || product.status === statusFilter;
      const matchesCategory = categoryFilter === 'all' || product.category === categoryFilter;
      const matchesRag = matchesRagFilter(product, ragFilter);
      const matchesStripe = matchesStripeFilter(product, stripeFilter);
      const categoryLabel = categoryOptions.find((category) => category.key === product.category)?.labelTh ?? getProductCategoryLabel(product.category);
      const searchText = [
        product.title,
        product.catalogKey,
        product.description,
        product.hospitalName,
        product.hospitalAddress,
        product.category,
        categoryLabel,
        ...product.tags,
        ...product.includes,
        ...product.branches.flatMap((branch) => [branch.name, branch.address, branch.district]),
      ]
        .join(' ')
        .toLowerCase();

      return matchesStatus && matchesCategory && matchesRag && matchesStripe && (!normalizedQuery || searchText.includes(normalizedQuery));
    });
  }, [categoryFilter, categoryOptions, products, query, ragFilter, statusFilter, stripeFilter]);

  const summary = useMemo(
    () => ({
      active: products.filter((product) => product.status === 'active').length,
      archived: products.filter((product) => product.status === 'archived').length,
      draft: products.filter((product) => product.status === 'draft' || product.status === 'pending_review' || product.status === 'rejected').length,
      ragLive: products.filter((product) => product.status === 'active' && isRagReady(product)).length,
      ragWaiting: products.filter((product) => product.status === 'active' && !isRagReady(product)).length,
      stripeMissing: products.filter((product) => product.status === 'active' && !hasStripeCatalogMapping(product)).length,
      total: products.length,
    }),
    [products],
  );
  const stripeSyncTargets = useMemo(
    () => products.filter((product) => product.status === 'active' && !hasStripeCatalogMapping(product)),
    [products],
  );
  const visibleStatusFilters = useMemo(
    () => statusFilters.filter((status) => status === 'all' || products.some((product) => product.status === status)),
    [products],
  );
  const visibleCategoryOptions = useMemo(() => {
    const usedCategories = new Set(products.map((product) => product.category));

    return categoryOptions.filter((category) => category.active && usedCategories.has(category.key));
  }, [categoryOptions, products]);
  const hasActiveFilters =
    query.trim().length > 0 ||
    statusFilter !== 'all' ||
    categoryFilter !== 'all' ||
    ragFilter !== 'all' ||
    stripeFilter !== 'all';
  const activeFilterCount = [statusFilter !== 'all', categoryFilter !== 'all', ragFilter !== 'all', stripeFilter !== 'all'].filter(Boolean).length;
  const disabledActionHint = !canEditCatalog
    ? isDemoMode
      ? 'โหมดตัวอย่าง: ปุ่มนี้จะไม่ส่งข้อมูลจริง'
      : 'สิทธิ์อ่านอย่างเดียว: ต้องเป็น tenant admin เพื่อบันทึก'
    : null;
  const lastRefreshedText = lastRefreshedAt ? `รีเฟรชล่าสุด ${formatShortDateTime(lastRefreshedAt)}` : 'รอข้อมูลล่าสุด';

  function loadDemoCatalog(reason: string | null = null) {
    const demo = demoCatalogForVertical(tenantConfig.vertical);
    setDemoFallbackReason(reason);
    setTenantContext(showcaseDemoTenantContext);
    setProducts(demo.products);
    setBranches(demo.branches);
    setCategories(demo.categories);
    setLastRefreshedAt(new Date().toISOString());
  }

  useEffect(() => {
    let isMounted = true;

    loadCatalog().finally(() => {
      if (isMounted) {
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [auth.user, isBaseDemoMode]);

  async function loadCatalog() {
    try {
      setError(null);

      if (isBaseDemoMode || !auth.user) {
        loadDemoCatalog(null);
        return;
      }

      setDemoFallbackReason(null);
      const context = await loadTenantMemberContext();
      setTenantContext(context);

      if (!context) {
        loadDemoCatalog(`บัญชีนี้ยังไม่ได้เชื่อมกับ tenant "${defaultTenantSlug}"`);
        return;
      }

      const [items, branchList, categoryList] = await Promise.all([
        loadManagedHospitalProducts(),
        loadBranches(),
        loadProductCategories(),
      ]);
      setProducts(items);
      setBranches(branchList);
      setCategories(categoryList);
      setLastRefreshedAt(new Date().toISOString());
    } catch (loadError) {
      const reason = loadError instanceof Error ? loadError.message : 'โหลด catalog จาก backend ไม่สำเร็จ';
      loadDemoCatalog(reason);
    }
  }

  function updateDraft<K extends keyof HospitalProductDraft>(field: K, value: HospitalProductDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function toggleDraftBranch(branchId: string) {
    setDraft((current) => {
      const currentIds = current.branchIds ?? [];
      const nextIds = currentIds.includes(branchId) ? currentIds.filter((id) => id !== branchId) : [...currentIds, branchId];

      return {
        ...current,
        branchIds: nextIds,
      };
    });
  }

  async function refreshProducts() {
    try {
      setError(null);

      if (isDemoMode) {
        loadDemoCatalog(demoFallbackReason);
        setMessage('กำลังแสดงข้อมูลตัวอย่างอยู่');
        return;
      }

      if (!tenantContext) {
        await loadCatalog();
        return;
      }

      const [items, branchList, categoryList] = await Promise.all([
        loadManagedHospitalProducts(),
        loadBranches(),
        loadProductCategories(),
      ]);
      setProducts(items);
      setBranches(branchList);
      setCategories(categoryList);
      setLastRefreshedAt(new Date().toISOString());
    } catch (refreshError) {
      const reason = refreshError instanceof Error ? refreshError.message : 'รีเฟรช catalog ไม่สำเร็จ';
      loadDemoCatalog(reason);
      setMessage('กำลังแสดงข้อมูลตัวอย่างอยู่');
    }
  }

  async function addCategory() {
    if (!canEditCatalog) {
      setError('Only tenant admins can add product categories.');
      return;
    }

    if (!categoryDraft.key.trim() || !categoryDraft.labelTh.trim()) {
      setError('Category key and Thai label are required.');
      return;
    }

    try {
      setIsSaving(true);
      setError(null);
      setMessage(null);
      const saved = await saveProductCategory(categoryDraft);
      setCategories((current) => [saved, ...current.filter((category) => category.key !== saved.key)].sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key)));
      updateDraft('category', saved.key);
      setCategoryDraft({
        active: true,
        icon: '',
        key: '',
        labelTh: '',
        sort: '',
      });
      setMessage(`Added category ${saved.labelTh}.`);
    } catch (categoryError) {
      setError(categoryError instanceof Error ? categoryError.message : 'Unable to add category.');
    } finally {
      setIsSaving(false);
    }
  }

  function mergeProduct(updatedProduct: HospitalProduct, selectProduct = false) {
    setProducts((current) =>
      current.some((product) => product.id === updatedProduct.id)
        ? current.map((product) => (product.id === updatedProduct.id ? updatedProduct : product))
        : [updatedProduct, ...current],
    );

    if (selectProduct || editingProduct?.id === updatedProduct.id) {
      setEditingProduct(updatedProduct);
      setDraft(draftFromProduct(updatedProduct));
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
      const result = await saveCatalogProduct(draft, editingProduct?.id);
      mergeProduct(result.product, true);

      try {
        const syncResult = await syncHospitalProductToStripe(result.product);

        mergeProduct(syncResult.product, true);
        setMessage(`Saved ${syncResult.product.title} as ${result.catalogKey}. Auto-synced Stripe: ${syncResult.summary}.`);
      } catch (syncError) {
        setMessage(`Saved ${result.product.title} as ${result.catalogKey}.`);
        setError(syncError instanceof Error ? `Saved product, but Stripe auto-sync failed: ${syncError.message}` : 'Saved product, but Stripe auto-sync failed.');
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save product.');
    } finally {
      setIsSaving(false);
    }
  }

  function chooseProductImage() {
    if (!canEditCatalog) {
      setError('Only tenant admins can upload product images.');
      return;
    }

    if (typeof document === 'undefined') {
      setError('Image upload is available in the web admin. Paste a hosted image URL for this build.');
      return;
    }

    const input = document.createElement('input');
    input.accept = 'image/jpeg,image/png,image/webp';
    input.type = 'file';
    input.onchange = () => {
      void uploadSelectedProductImage(input.files?.item(0) ?? null);
    };
    input.click();
  }

  async function uploadSelectedProductImage(file: (Blob & { name?: string; type?: string }) | null) {
    if (!file || isUploadingImage) {
      return;
    }

    if (!file.type?.startsWith('image/')) {
      setError('Choose a JPEG, PNG, or WebP image.');
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setError('Choose an image under 8 MB.');
      return;
    }

    try {
      setIsUploadingImage(true);
      setError(null);
      setMessage(null);
      const result = await uploadProductImage(file, editingProduct?.id);
      updateDraft('imageUrl', result.publicUrl);
      setMessage(`Uploaded product image to ${result.path}.`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload product image.');
    } finally {
      setIsUploadingImage(false);
    }
  }

  async function changeStatus(product: HospitalProduct, nextStatus: HospitalProductStatus) {
    if (busyProductId || !canEditCatalog) {
      return;
    }

    try {
      setBusyProductId(product.id);
      setError(null);
      setMessage(null);
      const updatedProduct = await updateHospitalProductStatus(product, nextStatus);
      mergeProduct(updatedProduct);

      if (shouldSyncCatalogStatusToStripe(updatedProduct, nextStatus)) {
        try {
          const syncResult = await syncHospitalProductToStripe(updatedProduct);

          mergeProduct(syncResult.product);
          setMessage(`${syncResult.product.title} is now ${nextStatus}. Auto-synced Stripe: ${syncResult.summary}.`);
        } catch (syncError) {
          setMessage(`${updatedProduct.title} is now ${nextStatus}.`);
          setError(syncError instanceof Error ? `Status saved, but Stripe auto-sync failed: ${syncError.message}` : 'Status saved, but Stripe auto-sync failed.');
        }
      } else {
        setMessage(`${updatedProduct.title} is now ${nextStatus}.`);
      }
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Unable to update product status.');
    } finally {
      setBusyProductId(null);
    }
  }

  async function syncStripeProduct(product: HospitalProduct) {
    if (busyProductId || !canEditCatalog) {
      return;
    }

    try {
      setBusyProductId(product.id);
      setError(null);
      setMessage(null);
      const result = await syncHospitalProductToStripe(product);
      mergeProduct(result.product);
      setMessage(`Stripe synced for ${result.product.title}: ${result.summary}.`);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Unable to sync product to Stripe.');
    } finally {
      setBusyProductId(null);
    }
  }

  async function syncMissingStripeProducts() {
    if (isBulkSyncing || busyProductId || !canEditCatalog || stripeSyncTargets.length === 0) {
      return;
    }

    try {
      setIsBulkSyncing(true);
      setError(null);
      setMessage(null);
      const syncedProducts: HospitalProduct[] = [];
      const failures: string[] = [];

      for (const product of stripeSyncTargets) {
        try {
          const result = await syncHospitalProductToStripe(product);

          syncedProducts.push(result.product);
        } catch (syncError) {
          const detail = syncError instanceof Error ? syncError.message : 'unknown error';

          failures.push(`${product.title}: ${detail}`);
        }
      }

      if (syncedProducts.length > 0) {
        setProducts((current) =>
          current.map((product) => syncedProducts.find((syncedProduct) => syncedProduct.id === product.id) ?? product),
        );

        const syncedEditingProduct = editingProduct ? syncedProducts.find((product) => product.id === editingProduct.id) : null;

        if (syncedEditingProduct) {
          setEditingProduct(syncedEditingProduct);
          setDraft(draftFromProduct(syncedEditingProduct));
        }
      }

      setMessage(`Stripe auto-sync completed for ${syncedProducts.length}/${stripeSyncTargets.length} active products.`);

      if (failures.length > 0) {
        setError(`Stripe auto-sync failed for ${failures.length} products: ${failures.slice(0, 2).join('; ')}`);
      }
    } finally {
      setIsBulkSyncing(false);
    }
  }

  function editProduct(product: HospitalProduct) {
    setEditingProduct(product);
    setIsEditorOpen(true);
    setDraft(draftFromProduct(product));
    setMessage(null);
    setError(null);
  }

  function openNewProduct() {
    setEditingProduct(null);
    setIsEditorOpen(true);
    setDraft({ ...emptyDraft, category: activeCategoryOptions[0]?.key ?? emptyDraft.category });
    setMessage(null);
    setError(null);
  }

  function resetForm() {
    setEditingProduct(null);
    setIsEditorOpen(true);
    setDraft(emptyDraft);
    setMessage(null);
    setError(null);
  }

  function clearFilters() {
    setQuery('');
    setStatusFilter('all');
    setCategoryFilter('all');
    setRagFilter('all');
    setStripeFilter('all');
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <AdminHeader
          actions={
            <>
              <Pressable
                accessibilityLabel="รีเฟรช"
                accessibilityRole="button"
                disabled={isLoading}
                onPress={refreshProducts}
                style={[styles.headerBtn, isLoading ? styles.disabled : null]}
              >
                <SymbolView name={{ android: 'refresh', ios: 'arrow.clockwise', web: 'refresh' }} size={16} tintColor={MiraDesign.color.primaryDeep} />
                <Text style={styles.headerBtnText}>{isLoading ? 'กำลังรีเฟรช' : 'รีเฟรช'}</Text>
              </Pressable>
              {canEditCatalog ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={isBulkSyncing || busyProductId !== null || stripeSyncTargets.length === 0}
                  onPress={syncMissingStripeProducts}
                  style={[styles.headerBtn, isBulkSyncing || busyProductId !== null || stripeSyncTargets.length === 0 ? styles.disabled : null]}
                >
                  <Text style={styles.headerBtnText}>{isBulkSyncing ? 'กำลังซิงก์ Stripe' : `ซิงก์ Stripe (${stripeSyncTargets.length})`}</Text>
                </Pressable>
              ) : null}
              <Link href={{ pathname: '/package-detail', params: { tour: 'admin' } }} asChild>
                <Pressable accessibilityRole="link" style={styles.headerBtn}>
                  <SymbolView name={{ android: 'phone_iphone', ios: 'iphone', web: 'phone_iphone' }} size={16} tintColor={MiraDesign.color.primaryDeep} />
                  <Text style={styles.headerBtnText}>mobile</Text>
                </Pressable>
              </Link>
              <Pressable accessibilityRole="button" onPress={openNewProduct} style={styles.headerBtnPrimary}>
                <SymbolView name={{ android: 'add', ios: 'plus', web: 'add' }} size={18} tintColor="#FFFFFF" />
                <Text style={styles.headerBtnPrimaryText}>{copy.addProduct}</Text>
              </Pressable>
            </>
          }
          eyebrow={copy.eyebrow}
          metaText={`${tenantContext ? tenantContext.display_name : isLoading ? 'กำลังตรวจ tenant' : 'ยังไม่เชื่อม tenant'} · ${lastRefreshedText}`}
          modeLabel={isDemoMode ? 'โหมดตัวอย่าง' : 'ใช้งานจริง'}
          modeTone={isDemoMode ? 'amber' : 'primary'}
          note={
            isDemoMode
              ? 'โหมดตัวอย่าง: ปุ่มบันทึก อัปโหลด และ archive จะถูกปิดไว้'
              : auth.session && !tenantContext && !isLoading
                ? 'บัญชีที่อยู่ใน tenant_members เท่านั้นที่จะใช้หน้าแอดมินนี้ได้'
                : tenantContext && !canEditCatalog
                  ? 'เฉพาะ tenant_admin หรือ superadmin เท่านั้นที่สร้าง อัปโหลด archive หรือ restore สินค้าได้'
                  : null
          }
          title={title || copy.title}
        />

        <SummaryChips
          items={[
            { key: 'total', label: copy.totalLabel, value: summary.total },
            { key: 'active', label: 'เปิดขาย', value: summary.active },
            { key: 'draft', label: 'รอตรวจ', value: summary.draft },
            { key: 'archived', label: 'เก็บถาวร', value: summary.archived },
            { key: 'rag', label: 'RAG พร้อม', value: summary.ragLive },
            { key: 'stripe', label: 'รอซิงก์ Stripe', value: summary.stripeMissing },
            { key: 'embed', label: 'รอ embedding', value: summary.ragWaiting },
          ]}
        />

        <View style={[styles.workspace, !isWide ? styles.workspaceStack : null]}>
          {isWide ? (
            <View style={styles.sidePane}>
            {isEditorOpen || editingProduct ? (
              <View style={styles.editorPanel}>
            <View style={styles.panelHeader}>
              <View>
                <Text style={styles.panelTitle}>{editingProduct ? copy.editProduct : copy.addProduct}</Text>
                <Text style={styles.panelMeta}>{editingProduct ? `Key: ${editingProduct.catalogKey}` : 'สร้าง catalog key ตอนบันทึก'}</Text>
              </View>
              {editingProduct ? (
                <Pressable onPress={resetForm} style={styles.textButton}>
                  <Text style={styles.textButtonLabel}>รายการใหม่</Text>
                </Pressable>
              ) : null}
            </View>

            <Field label={copy.nameField} onChangeText={(value) => updateDraft('title', value)} value={draft.title} />
            <Field label="รายละเอียด" multiline onChangeText={(value) => updateDraft('description', value)} value={draft.description} />
            <View style={styles.twoColumn}>
              <Field label="ราคา THB" onChangeText={(value) => updateDraft('priceAmount', value)} value={draft.priceAmount} />
              <View style={styles.imageField}>
                <Text style={styles.fieldLabel}>{copy.imageField}</Text>
                <View style={styles.imageInputRow}>
                  <TextInput
                    onChangeText={(value) => updateDraft('imageUrl', value)}
                    placeholder={`Public URL หรือรูป${vocab.productTerm}ที่อัปโหลดแล้ว`}
                    placeholderTextColor={MiraDesign.color.inkSoft}
                    style={[styles.input, styles.imageUrlInput]}
                    value={draft.imageUrl ?? ''}
                  />
                  <Pressable
                    disabled={isUploadingImage || !canEditCatalog}
                    onPress={chooseProductImage}
                    style={[styles.uploadButton, isUploadingImage || !canEditCatalog ? styles.disabled : null]}
                  >
                    <Text style={styles.uploadButtonText}>{isUploadingImage ? 'กำลังอัปโหลด' : 'อัปโหลด'}</Text>
                  </Pressable>
                </View>
                {draft.imageUrl ? (
                  <View style={styles.imagePreviewRow}>
                    <Image source={{ uri: draft.imageUrl }} resizeMode="cover" style={styles.imagePreview} />
                    <Text numberOfLines={2} style={styles.imagePreviewText}>
                      {draft.imageUrl}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            {draft.branchInfo ? (
              <View style={styles.legacyNotice}>
                <Text style={styles.legacyTitle}>branch_info เดิม</Text>
                <Text style={styles.legacyBody}>{draft.branchInfo}</Text>
                <Text style={styles.helperText}>ใช้การเลือกสาขาด้านล่างสำหรับ v3 ข้อความเดิมยังถูกเก็บไว้แต่ไม่ถูก parse</Text>
              </View>
            ) : null}

            <View style={styles.controlGroup}>
              <Text style={styles.fieldLabel}>หมวดหมู่</Text>
              <View style={styles.segmentRow}>
                {activeCategoryOptions.map((category) => (
                  <Pressable
                    key={category.key}
                    onPress={() => updateDraft('category', category.key)}
                    style={[styles.segment, draft.category === category.key ? styles.segmentActive : null]}
                  >
                    <Text style={[styles.segmentText, draft.category === category.key ? styles.segmentTextActive : null]}>
                      {category.labelTh}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {canEditCatalog ? (
              <View style={styles.inlineAdminPanel}>
                <Text style={styles.fieldLabel}>เพิ่มหมวดหมู่</Text>
                <View style={styles.categoryAdminRow}>
                  <TextInput
                    onChangeText={(value) => setCategoryDraft((current) => ({ ...current, key: value }))}
                    placeholder="key"
                    placeholderTextColor={MiraDesign.color.inkSoft}
                    style={[styles.input, styles.compactInput]}
                    value={categoryDraft.key}
                  />
                  <TextInput
                    onChangeText={(value) => setCategoryDraft((current) => ({ ...current, labelTh: value }))}
                    placeholder="label_th"
                    placeholderTextColor={MiraDesign.color.inkSoft}
                    style={[styles.input, styles.compactInput]}
                    value={categoryDraft.labelTh}
                  />
                  <TextInput
                    onChangeText={(value) => setCategoryDraft((current) => ({ ...current, icon: value }))}
                    placeholder="icon"
                    placeholderTextColor={MiraDesign.color.inkSoft}
                    style={[styles.input, styles.iconInput]}
                    value={categoryDraft.icon ?? ''}
                  />
                  <Pressable disabled={isSaving} onPress={addCategory} style={[styles.inlineButton, isSaving ? styles.disabled : null]}>
                    <Text style={styles.inlineButtonText}>เพิ่ม</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            <View style={styles.controlGroup}>
              <Text style={styles.fieldLabel}>สาขาที่ให้บริการ</Text>
              {branches.length === 0 ? (
                <Text style={styles.helperText}>ยังไม่มีสาขา เพิ่มสาขาก่อนผูกสินค้าเข้ากับสาขา</Text>
              ) : (
                <View style={styles.branchOptionList}>
                  {branches.map((branch) => {
                    const selected = (draft.branchIds ?? []).includes(branch.id);

                    return (
                      <Pressable
                        key={branch.id}
                        disabled={!canEditCatalog}
                        onPress={() => toggleDraftBranch(branch.id)}
                        style={[styles.branchOption, selected ? styles.branchOptionActive : null, !branch.active ? styles.branchOptionInactive : null]}
                      >
                        <View style={[styles.radioDot, selected ? styles.radioDotActive : null]} />
                        <View style={styles.branchOptionCopy}>
                          <Text style={styles.branchOptionTitle}>
                            {branch.name}
                            {!branch.active ? ' (ปิดใช้งาน)' : ''}
                          </Text>
                          <Text numberOfLines={2} style={styles.branchOptionMeta}>
                            {[branch.address, branch.district, branch.phone].filter(Boolean).join(' · ') || 'ยังไม่มีที่อยู่'}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>

            <View style={styles.controlGroup}>
              <Text style={styles.fieldLabel}>การจอง</Text>
              <View style={styles.segmentRow}>
                <Pressable
                  onPress={() => updateDraft('requiresAppointment', true)}
                  style={[styles.segment, draft.requiresAppointment !== false ? styles.segmentActive : null]}
                >
                  <Text style={[styles.segmentText, draft.requiresAppointment !== false ? styles.segmentTextActive : null]}>
                    ต้องนัดหมาย
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => updateDraft('requiresAppointment', false)}
                  style={[styles.segment, draft.requiresAppointment === false ? styles.segmentActive : null]}
                >
                  <Text style={[styles.segmentText, draft.requiresAppointment === false ? styles.segmentTextActive : null]}>
                    Walk-in ได้
                  </Text>
                </Pressable>
              </View>
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {message ? <Text style={styles.successText}>{message}</Text> : null}

            <Pressable disabled={!canSave || isSaving} onPress={saveDraft} style={[styles.saveButton, !canSave || isSaving ? styles.disabled : null]}>
              <Text style={styles.saveButtonText}>{isSaving ? 'กำลังบันทึก' : editingProduct ? copy.saveProduct : copy.createProduct}</Text>
            </Pressable>
            {editingProduct ? (
              <ProductEditorActions
                disabled={Boolean(busyProductId) || isBulkSyncing || !canEditCatalog}
                isBusy={busyProductId === editingProduct.id}
                onArchive={() => changeStatus(editingProduct, 'archived')}
                onRestore={() => changeStatus(editingProduct, 'active')}
                onSyncStripe={() => syncStripeProduct(editingProduct)}
                product={editingProduct}
              />
            ) : null}
              </View>
            ) : (
              <ReferralWorkspaceCard
                productTerm={vocab.productTerm}
                providerTerm={vocab.providerTerm}
                tenantName={tenantContext?.display_name ?? defaultTenantSlug}
              />
            )}
            </View>
          ) : null}

          <View style={styles.listPane}>
            <View style={[styles.inventoryHeader, !isWide ? styles.inventoryHeaderStack : null]}>
              <View>
                <Text style={styles.inventoryTitle}>{copy.inventoryTitle}</Text>
                <Text style={styles.inventoryMeta}>
                  {isLoading ? 'กำลังโหลดสินค้า' : `แสดง ${filteredProducts.length.toLocaleString('th-TH')} จาก ${products.length.toLocaleString('th-TH')} รายการ`}
                </Text>
              </View>
              <View style={styles.inventoryActions}>
                <Link href="/admin/referrers" asChild>
                  <Pressable style={styles.secondaryButton}>
                    <SymbolView name={{ android: 'person_add', ios: 'person.badge.plus', web: 'person_add' }} size={18} tintColor={MiraDesign.color.primary} />
                    <Text style={styles.secondaryButtonText}>พื้นที่ Referral</Text>
                  </Pressable>
                </Link>
                <Pressable onPress={refreshProducts} style={styles.secondaryButton}>
                  <SymbolView name={{ android: 'database', ios: 'cylinder.split.1x2', web: 'database' }} size={18} tintColor={MiraDesign.color.inkSoft} />
                  <Text style={styles.secondaryButtonText}>รีเฟรชข้อมูล</Text>
                </Pressable>
              </View>
            </View>

            <ProductToolbar
              activeCategory={categoryFilter}
              activeFilterCount={activeFilterCount}
              activeRag={ragFilter}
              activeStatus={statusFilter}
              activeStripe={stripeFilter}
              categories={visibleCategoryOptions}
              filtersOpen={filtersOpen}
              hasActiveFilters={hasActiveFilters}
              isMobile={isMobile}
              onCategoryChange={setCategoryFilter}
              onClear={clearFilters}
              onRagChange={setRagFilter}
              onStatusChange={setStatusFilter}
              onStripeChange={setStripeFilter}
              onToggleFilters={() => setFiltersOpen((current) => !current)}
              query={query}
              searchPlaceholder={copy.searchPlaceholder}
              statusOptions={visibleStatusFilters}
              onQueryChange={setQuery}
            />

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {message ? <Text style={styles.successText}>{message}</Text> : null}

            {isLoading && products.length === 0 ? (
              <ProductSkeleton />
            ) : products.length === 0 ? (
              <ProductEmptyState
                addLabel={copy.addProduct}
                body={copy.emptyBody}
                canCreate={canEditCatalog}
                onCreate={openNewProduct}
                title={copy.emptyTitle}
              />
            ) : filteredProducts.length === 0 ? (
              <ProductNoResultsState onClear={clearFilters} productTerm={vocab.productTerm} />
            ) : (
              <View style={styles.productGrid}>
                {filteredProducts.map((product) => (
                  <ProductRow
                    key={product.id}
                    onEdit={() => editProduct(product)}
                    product={product}
                    productCategoryLabel={categoryOptions.find((category) => category.key === product.category)?.labelTh ?? getProductCategoryLabel(product.category)}
                    selected={editingProduct?.id === product.id}
                  />
                ))}
              </View>
            )}
          </View>

          {!isWide ? (
            <View style={styles.sidePane}>
              {isEditorOpen || editingProduct ? (
                <View style={styles.editorPanel}>
                  <View style={styles.panelHeader}>
                    <View>
                      <Text style={styles.panelTitle}>{editingProduct ? copy.editProduct : copy.addProduct}</Text>
                      <Text style={styles.panelMeta}>{editingProduct ? `Key: ${editingProduct.catalogKey}` : 'สร้าง catalog key ตอนบันทึก'}</Text>
                    </View>
                    {editingProduct ? (
                      <Pressable onPress={resetForm} style={styles.textButton}>
                        <Text style={styles.textButtonLabel}>รายการใหม่</Text>
                      </Pressable>
                    ) : null}
                  </View>

                  <Field label={copy.nameField} onChangeText={(value) => updateDraft('title', value)} value={draft.title} />
                  <Field label="รายละเอียด" multiline onChangeText={(value) => updateDraft('description', value)} value={draft.description} />
                  <View style={styles.twoColumn}>
                    <Field label="ราคา THB" onChangeText={(value) => updateDraft('priceAmount', value)} value={draft.priceAmount} />
                    <View style={styles.imageField}>
                      <Text style={styles.fieldLabel}>{copy.imageField}</Text>
                      <View style={styles.imageInputRow}>
                        <TextInput
                          onChangeText={(value) => updateDraft('imageUrl', value)}
                          placeholder={`Public URL หรือรูป${vocab.productTerm}ที่อัปโหลดแล้ว`}
                          placeholderTextColor={MiraDesign.color.inkSoft}
                          style={[styles.input, styles.imageUrlInput]}
                          value={draft.imageUrl ?? ''}
                        />
                        <Pressable
                          disabled={isUploadingImage || !canEditCatalog}
                          onPress={chooseProductImage}
                          style={[styles.uploadButton, isUploadingImage || !canEditCatalog ? styles.disabled : null]}
                        >
                          <Text style={styles.uploadButtonText}>{isUploadingImage ? 'กำลังอัปโหลด' : 'อัปโหลด'}</Text>
                        </Pressable>
                      </View>
                      {draft.imageUrl ? (
                        <View style={styles.imagePreviewRow}>
                          <Image source={{ uri: draft.imageUrl }} resizeMode="cover" style={styles.imagePreview} />
                          <Text numberOfLines={2} style={styles.imagePreviewText}>
                            {draft.imageUrl}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>

                  {draft.branchInfo ? (
                    <View style={styles.legacyNotice}>
                      <Text style={styles.legacyTitle}>branch_info เดิม</Text>
                      <Text style={styles.legacyBody}>{draft.branchInfo}</Text>
                      <Text style={styles.helperText}>ใช้การเลือกสาขาด้านล่างสำหรับ v3 ข้อความเดิมยังถูกเก็บไว้แต่ไม่ถูก parse</Text>
                    </View>
                  ) : null}

                  <View style={styles.controlGroup}>
                    <Text style={styles.fieldLabel}>หมวดหมู่</Text>
                    <View style={styles.segmentRow}>
                      {activeCategoryOptions.map((category) => (
                        <Pressable
                          key={category.key}
                          onPress={() => updateDraft('category', category.key)}
                          style={[styles.segment, draft.category === category.key ? styles.segmentActive : null]}
                        >
                          <Text style={[styles.segmentText, draft.category === category.key ? styles.segmentTextActive : null]}>
                            {category.labelTh}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>

                  {canEditCatalog ? (
                    <View style={styles.inlineAdminPanel}>
                      <Text style={styles.fieldLabel}>เพิ่มหมวดหมู่</Text>
                      <View style={styles.categoryAdminRow}>
                        <TextInput
                          onChangeText={(value) => setCategoryDraft((current) => ({ ...current, key: value }))}
                          placeholder="key"
                          placeholderTextColor={MiraDesign.color.inkSoft}
                          style={[styles.input, styles.compactInput]}
                          value={categoryDraft.key}
                        />
                        <TextInput
                          onChangeText={(value) => setCategoryDraft((current) => ({ ...current, labelTh: value }))}
                          placeholder="label_th"
                          placeholderTextColor={MiraDesign.color.inkSoft}
                          style={[styles.input, styles.compactInput]}
                          value={categoryDraft.labelTh}
                        />
                        <TextInput
                          onChangeText={(value) => setCategoryDraft((current) => ({ ...current, icon: value }))}
                          placeholder="icon"
                          placeholderTextColor={MiraDesign.color.inkSoft}
                          style={[styles.input, styles.iconInput]}
                          value={categoryDraft.icon ?? ''}
                        />
                        <Pressable disabled={isSaving} onPress={addCategory} style={[styles.inlineButton, isSaving ? styles.disabled : null]}>
                          <Text style={styles.inlineButtonText}>เพิ่ม</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}

                  <View style={styles.controlGroup}>
                    <Text style={styles.fieldLabel}>สาขาที่ให้บริการ</Text>
                    {branches.length === 0 ? (
                      <Text style={styles.helperText}>ยังไม่มีสาขา เพิ่มสาขาก่อนผูกสินค้าเข้ากับสาขา</Text>
                    ) : (
                      <View style={styles.branchOptionList}>
                        {branches.map((branch) => {
                          const selected = (draft.branchIds ?? []).includes(branch.id);

                          return (
                            <Pressable
                              key={branch.id}
                              disabled={!canEditCatalog}
                              onPress={() => toggleDraftBranch(branch.id)}
                              style={[styles.branchOption, selected ? styles.branchOptionActive : null, !branch.active ? styles.branchOptionInactive : null]}
                            >
                              <View style={[styles.radioDot, selected ? styles.radioDotActive : null]} />
                              <View style={styles.branchOptionCopy}>
                                <Text style={styles.branchOptionTitle}>
                                  {branch.name}
                                  {!branch.active ? ' (ปิดใช้งาน)' : ''}
                                </Text>
                                <Text numberOfLines={2} style={styles.branchOptionMeta}>
                                  {[branch.address, branch.district, branch.phone].filter(Boolean).join(' · ') || 'ยังไม่มีที่อยู่'}
                                </Text>
                              </View>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                  </View>

                  <View style={styles.controlGroup}>
                    <Text style={styles.fieldLabel}>การจอง</Text>
                    <View style={styles.segmentRow}>
                      <Pressable
                        onPress={() => updateDraft('requiresAppointment', true)}
                        style={[styles.segment, draft.requiresAppointment !== false ? styles.segmentActive : null]}
                      >
                        <Text style={[styles.segmentText, draft.requiresAppointment !== false ? styles.segmentTextActive : null]}>
                          ต้องนัดหมาย
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => updateDraft('requiresAppointment', false)}
                        style={[styles.segment, draft.requiresAppointment === false ? styles.segmentActive : null]}
                      >
                        <Text style={[styles.segmentText, draft.requiresAppointment === false ? styles.segmentTextActive : null]}>
                          Walk-in ได้
                        </Text>
                      </Pressable>
                    </View>
                  </View>

                  {error ? <Text style={styles.errorText}>{error}</Text> : null}
                  {message ? <Text style={styles.successText}>{message}</Text> : null}

                  <Pressable disabled={!canSave || isSaving} onPress={saveDraft} style={[styles.saveButton, !canSave || isSaving ? styles.disabled : null]}>
                    <Text style={styles.saveButtonText}>{isSaving ? 'กำลังบันทึก' : editingProduct ? copy.saveProduct : copy.createProduct}</Text>
                  </Pressable>
                  {editingProduct ? (
                    <ProductEditorActions
                      disabled={Boolean(busyProductId) || isBulkSyncing || !canEditCatalog}
                      isBusy={busyProductId === editingProduct.id}
                      onArchive={() => changeStatus(editingProduct, 'archived')}
                      onRestore={() => changeStatus(editingProduct, 'active')}
                      onSyncStripe={() => syncStripeProduct(editingProduct)}
                      product={editingProduct}
                    />
                  ) : null}
                </View>
              ) : (
                <ReferralWorkspaceCard
                productTerm={vocab.productTerm}
                providerTerm={vocab.providerTerm}
                tenantName={tenantContext?.display_name ?? defaultTenantSlug}
              />
              )}
            </View>
          ) : null}
        </View>
      </ScrollView>

      {filtersOpen ? (
        <CatalogFilterPanel
          activeCategory={categoryFilter}
          activeRag={ragFilter}
          activeStatus={statusFilter}
          activeStripe={stripeFilter}
          categories={visibleCategoryOptions}
          isMobile={isMobile}
          onCategoryChange={setCategoryFilter}
          onClear={clearFilters}
          onClose={() => setFiltersOpen(false)}
          onRagChange={setRagFilter}
          onStatusChange={setStatusFilter}
          onStripeChange={setStripeFilter}
          statusOptions={visibleStatusFilters}
        />
      ) : null}
    </View>
  );
}

function StatCard({
  action,
  detail,
  icon,
  label,
  tone,
  value,
}: {
  action?: ReactNode;
  detail: string;
  icon: SymbolName;
  label: string;
  tone: 'blue' | 'mint' | 'orange' | 'violet';
  value: string;
}) {
  const toneStyle = {
    blue: styles.statIconBlue,
    mint: styles.statIconMint,
    orange: styles.statIconOrange,
    violet: styles.statIconViolet,
  }[tone];
  const iconColor = {
    blue: MiraDesign.color.primary,
    mint: '#0F9F72',
    orange: '#F97316',
    violet: '#6D28D9',
  }[tone];

  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, toneStyle]}>
        <SymbolView name={icon} size={20} tintColor={iconColor} />
      </View>
      <View style={styles.statCopy}>
        <Text style={styles.statLabel}>{label}</Text>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statDetail}>{detail}</Text>
      </View>
      {action ? <View style={styles.statCardAction}>{action}</View> : null}
    </View>
  );
}

function ReferralWorkspaceCard({ productTerm, providerTerm, tenantName }: { productTerm: string; providerTerm: string; tenantName: string }) {
  return (
    <View style={styles.referralPanel}>
      <View style={styles.referralHeader}>
        <View>
          <Text style={styles.referralTitle}>พื้นที่ Referral</Text>
          <Text style={styles.referralLink}>{tenantName}</Text>
        </View>
        <Text style={styles.waitingBadge}>{`พร้อมเลือก${productTerm}`}</Text>
      </View>
      <View style={styles.referralCallout}>
        <SymbolView name={{ android: 'person_add', ios: 'person.badge.plus', web: 'person_add' }} size={26} tintColor={MiraDesign.color.primary} />
        <View style={styles.referralCopy}>
          <Text style={styles.referralCalloutTitle}>{`เลือก${productTerm}จากรายการเพื่อสร้าง referral code`}</Text>
          <Text style={styles.referralBody}>{`ใช้กับพาร์ทเนอร์ของ${providerTerm}โดยไม่เปลี่ยนข้อมูล catalog หรือสถานะ${productTerm}`}</Text>
        </View>
      </View>
    </View>
  );
}

function draftFromProduct(product: HospitalProduct): HospitalProductDraft {
  return {
    branchInfo: product.hospitalAddress ?? '',
    branchIds: product.branchIds,
    category: product.category,
    description: product.description,
    hospitalAddress: product.hospitalAddress ?? '',
    hospitalMapQuery: product.hospitalAddress ?? '',
    hospitalName: product.hospitalName,
    imageUrl: product.imageUrl ?? '',
    priceAmount: `${product.priceAmount}`,
    requiresAppointment: product.requiresAppointment,
    title: product.title,
  };
}

function ProductToolbar({
  activeCategory,
  activeFilterCount,
  activeRag,
  activeStatus,
  activeStripe,
  categories,
  filtersOpen,
  hasActiveFilters,
  isMobile,
  onCategoryChange,
  onClear,
  onQueryChange,
  onRagChange,
  onStatusChange,
  onStripeChange,
  onToggleFilters,
  query,
  searchPlaceholder,
  statusOptions,
}: {
  activeCategory: ProductCategory | 'all';
  activeFilterCount: number;
  activeRag: RagFilter;
  activeStatus: StatusFilter;
  activeStripe: StripeFilter;
  categories: ProductCategoryOption[];
  filtersOpen: boolean;
  hasActiveFilters: boolean;
  isMobile: boolean;
  onCategoryChange: (category: ProductCategory | 'all') => void;
  onClear: () => void;
  onQueryChange: (query: string) => void;
  onRagChange: (filter: RagFilter) => void;
  onStatusChange: (status: StatusFilter) => void;
  onStripeChange: (filter: StripeFilter) => void;
  onToggleFilters: () => void;
  query: string;
  searchPlaceholder: string;
  statusOptions: StatusFilter[];
}) {
  return (
    <View style={styles.toolbar}>
      <View style={styles.toolbarTopRow}>
        <View style={styles.searchBox}>
          <SymbolView name={{ android: 'search', ios: 'magnifyingglass', web: 'search' }} size={18} tintColor={MiraDesign.color.inkSoft} />
          <TextInput
            onChangeText={onQueryChange}
            placeholder={searchPlaceholder}
            placeholderTextColor={MiraDesign.color.inkSoft}
            style={styles.searchInput}
            value={query}
          />
        </View>
        <Pressable
          accessibilityLabel="ตัวกรอง"
          accessibilityRole="button"
          onPress={onToggleFilters}
          style={[styles.filterToggle, filtersOpen || activeFilterCount > 0 ? styles.filterToggleActive : null]}
        >
          <SymbolView
            name={{ android: 'tune', ios: 'slider.horizontal.3', web: 'tune' }}
            size={17}
            tintColor={filtersOpen || activeFilterCount > 0 ? MiraDesign.color.primaryDeep : MiraDesign.color.inkSoft}
          />
          <Text style={[styles.filterToggleText, filtersOpen || activeFilterCount > 0 ? styles.filterToggleTextActive : null]}>
            {activeFilterCount > 0 ? `ตัวกรอง · ${activeFilterCount}` : 'ตัวกรอง'}
          </Text>
        </Pressable>
        {hasActiveFilters ? (
          <Pressable onPress={onClear} style={styles.clearButton}>
            <Text style={styles.clearButtonText}>ล้างตัวกรอง</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function CatalogFilterPanel({
  activeCategory,
  activeRag,
  activeStatus,
  activeStripe,
  categories,
  isMobile,
  onCategoryChange,
  onClear,
  onClose,
  onRagChange,
  onStatusChange,
  onStripeChange,
  statusOptions,
}: {
  activeCategory: ProductCategory | 'all';
  activeRag: RagFilter;
  activeStatus: StatusFilter;
  activeStripe: StripeFilter;
  categories: ProductCategoryOption[];
  isMobile: boolean;
  onCategoryChange: (category: ProductCategory | 'all') => void;
  onClear: () => void;
  onClose: () => void;
  onRagChange: (filter: RagFilter) => void;
  onStatusChange: (status: StatusFilter) => void;
  onStripeChange: (filter: StripeFilter) => void;
  statusOptions: StatusFilter[];
}) {
  return (
    <View style={styles.filterOverlay}>
      <Pressable accessibilityLabel="ปิดตัวกรอง" onPress={onClose} style={styles.filterBackdrop} />
      <View style={[styles.filterPanel, isMobile ? styles.filterPanelSheet : styles.filterPanelDesktop]}>
        <View style={styles.filterPanelHeader}>
          <Text style={styles.filterPanelTitle}>ตัวกรอง</Text>
          <Pressable accessibilityLabel="ปิด" accessibilityRole="button" onPress={onClose} style={styles.filterCloseBtn}>
            <SymbolView name={{ android: 'close', ios: 'xmark', web: 'close' }} size={18} tintColor={MiraDesign.color.inkSoft} />
          </Pressable>
        </View>
        <View style={styles.filterPanelBody}>
          <FilterGroup label="สถานะ">
            {statusOptions.map((status) => (
              <FilterChip
                key={status}
                active={activeStatus === status}
                label={statusFilterLabel(status)}
                onPress={() => onStatusChange(status)}
              />
            ))}
          </FilterGroup>
          <FilterGroup label="หมวดหมู่">
            <FilterChip active={activeCategory === 'all'} label="ทุกหมวด" onPress={() => onCategoryChange('all')} />
            {categories.map((category) => (
              <FilterChip
                key={category.key}
                active={activeCategory === category.key}
                label={category.labelTh}
                onPress={() => onCategoryChange(category.key)}
              />
            ))}
          </FilterGroup>
          <FilterGroup label="RAG">
            {ragFilters.map((filter) => (
              <FilterChip
                key={filter}
                active={activeRag === filter}
                label={ragFilterLabel(filter)}
                onPress={() => onRagChange(filter)}
              />
            ))}
          </FilterGroup>
          <FilterGroup label="Stripe">
            {stripeFilters.map((filter) => (
              <FilterChip
                key={filter}
                active={activeStripe === filter}
                label={stripeFilterLabel(filter)}
                onPress={() => onStripeChange(filter)}
              />
            ))}
          </FilterGroup>
        </View>
        <View style={styles.filterPanelFooter}>
          <Pressable accessibilityRole="button" onPress={onClear} style={styles.filterClearBtn}>
            <Text style={styles.filterClearBtnText}>ล้างค่า</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.filterApplyBtn}>
            <Text style={styles.filterApplyBtnText}>เสร็จสิ้น</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function FilterGroup({ children, label }: { children: ReactNode; label: string }) {
  return (
    <View style={styles.filterGroup}>
      <Text style={styles.filterGroupLabel}>{label}</Text>
      <View style={styles.chipRow}>{children}</View>
    </View>
  );
}

function FilterChip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.filterChip, active ? styles.filterChipActive : null]}>
      <Text style={[styles.filterChipText, active ? styles.filterChipTextActive : null]}>{label}</Text>
    </Pressable>
  );
}

function ProductRow({
  onEdit,
  product,
  productCategoryLabel,
  selected,
}: {
  onEdit: () => void;
  product: HospitalProduct;
  productCategoryLabel: string;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onEdit}
      style={[styles.gridCard, selected ? styles.gridCardSelected : null, product.status === 'archived' ? styles.gridCardArchived : null]}
    >
      <View style={styles.gridThumb}>
        {product.imageUrl ? (
          <Image resizeMode="cover" source={{ uri: product.imageUrl }} style={styles.gridImage} />
        ) : (
          <View style={styles.gridImagePlaceholder}>
            <SymbolView name={categoryIcon(product.category)} size={38} tintColor={MiraDesign.color.primary} />
          </View>
        )}
        <View style={styles.gridStatusWrap}>
          <StatusBadge label={productStatusLabel(product.status)} tone={getProductStatusTone(product.status)} />
        </View>
      </View>
      <View style={styles.gridInfo}>
        <Text numberOfLines={2} style={styles.gridTitle}>
          {product.title}
        </Text>
        <Text numberOfLines={1} style={styles.gridCategory}>
          {productCategoryLabel}
        </Text>
        <Text style={styles.gridPrice}>฿{product.priceAmount.toLocaleString('th-TH')}</Text>
      </View>
    </Pressable>
  );
}

function ProductEditorActions({
  disabled,
  isBusy,
  onArchive,
  onRestore,
  onSyncStripe,
  product,
}: {
  disabled: boolean;
  isBusy: boolean;
  onArchive: () => void;
  onRestore: () => void;
  onSyncStripe: () => void;
  product: HospitalProduct;
}) {
  const isActive = product.status === 'active';

  return (
    <View style={styles.editorActions}>
      <Pressable accessibilityRole="button" disabled={disabled} onPress={onSyncStripe} style={[styles.editorActionBtn, disabled ? styles.disabled : null]}>
        <Text style={styles.editorActionText}>{isBusy ? 'กำลังซิงก์' : 'ซิงก์ Stripe'}</Text>
      </Pressable>
      {isActive ? (
        <Pressable accessibilityRole="button" disabled={disabled} onPress={onArchive} style={[styles.editorActionDanger, disabled ? styles.disabled : null]}>
          <Text style={styles.editorActionDangerText}>{isBusy ? 'กำลังเก็บ' : 'เก็บถาวร'}</Text>
        </Pressable>
      ) : (
        <Pressable accessibilityRole="button" disabled={disabled} onPress={onRestore} style={[styles.editorActionBtn, disabled ? styles.disabled : null]}>
          <Text style={styles.editorActionText}>{isBusy ? 'กำลังกู้คืน' : 'กู้คืน'}</Text>
        </Pressable>
      )}
    </View>
  );
}

function ProductVisual({ product }: { product: HospitalProduct }) {
  if (product.imageUrl) {
    return <Image source={{ uri: product.imageUrl }} resizeMode="cover" style={styles.productImage} />;
  }

  return (
    <View style={styles.productIconBox}>
      <SymbolView name={categoryIcon(product.category)} size={46} tintColor={MiraDesign.color.primary} />
    </View>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: ReadinessTone }) {
  return <Text style={[styles.statusBadge, readinessToneStyle(tone)]}>{label}</Text>;
}

function ReadinessBadge({ label, tone, value }: { label: string; tone: ReadinessTone; value: string }) {
  return (
    <View style={[styles.readinessBadge, readinessBadgeToneStyle(tone)]}>
      <Text style={styles.readinessLabel}>{label}</Text>
      <Text numberOfLines={1} style={[styles.readinessValue, readinessValueToneStyle(tone)]}>{value}</Text>
    </View>
  );
}

function ProductFact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.productFact}>
      <Text style={styles.productFactLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.productFactValue}>{value}</Text>
    </View>
  );
}

function ProductSkeleton() {
  return (
    <View style={styles.skeletonStack}>
      {[0, 1, 2].map((item) => (
        <View key={item} style={styles.skeletonCard}>
          <View style={styles.skeletonImage} />
          <View style={styles.skeletonBody}>
            <View style={styles.skeletonLineWide} />
            <View style={styles.skeletonLine} />
            <View style={styles.skeletonChipRow}>
              <View style={styles.skeletonChip} />
              <View style={styles.skeletonChip} />
              <View style={styles.skeletonChip} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

function ProductEmptyState({
  addLabel,
  body,
  canCreate,
  onCreate,
  title,
}: {
  addLabel: string;
  body: string;
  canCreate: boolean;
  onCreate: () => void;
  title: string;
}) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {canCreate ? (
        <Pressable onPress={onCreate} style={styles.emptyAction}>
          <Text style={styles.emptyActionText}>{addLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ProductNoResultsState({ onClear, productTerm }: { onClear: () => void; productTerm: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{`ไม่พบ${productTerm}ที่ตรงกับตัวกรอง`}</Text>
      <Text style={styles.emptyBody}>{`ลองล้างตัวกรองหรือค้นหาด้วยชื่อ${productTerm} หมวดหมู่ หรือสาขาอื่น`}</Text>
      <Pressable onPress={onClear} style={styles.emptySecondaryAction}>
        <Text style={styles.emptySecondaryActionText}>ล้างตัวกรอง</Text>
      </Pressable>
    </View>
  );
}

function getStripeStatus(product: HospitalProduct): { key: StripeFilter; label: string; tone: ReadinessTone } {
  if (product.stripeProductId && product.stripePriceId) {
    return {
      key: 'synced',
      label: 'ซิงก์แล้ว',
      tone: 'success',
    };
  }

  if (product.stripeProductId && !product.stripePriceId) {
    return {
      key: 'partial',
      label: 'ขาดราคา Stripe',
      tone: 'danger',
    };
  }

  return {
    key: 'missing',
    label: 'ยังไม่ซิงก์',
    tone: 'warning',
  };
}

function getRagReadiness(product: HospitalProduct): { key: RagReadinessKey; label: string; tone: ReadinessTone } {
  if (product.status === 'archived' || product.ragStatus === 'archived') {
    return { key: 'archived', label: 'RAG ถูกเก็บถาวร', tone: 'muted' };
  }

  if (product.ragEmbeddingStatus === 'error' || product.ragStatus === 'error') {
    return { key: 'error', label: 'RAG ผิดพลาด', tone: 'danger' };
  }

  if (product.ragStatus === 'rejected') {
    return { key: 'error', label: 'RAG ไม่ผ่าน', tone: 'danger' };
  }

  if (product.ragStatus === 'published' && product.ragEmbeddingStatus === 'embedded') {
    return { key: 'ready', label: 'พร้อมใช้กับ RAG', tone: 'success' };
  }

  if (product.ragStatus === 'published' && product.ragEmbeddingStatus !== 'embedded') {
    return { key: 'embedding', label: 'รอซิงก์ embedding', tone: 'warning' };
  }

  if (product.ragEmbeddingStatus === 'pending') {
    return { key: 'embedding', label: 'กำลังซิงก์ embedding', tone: 'warning' };
  }

  if (product.ragStatus === 'pending_review') {
    return { key: 'review', label: 'รอตรวจ RAG', tone: 'warning' };
  }

  return { key: 'publish', label: 'รอ publish RAG', tone: 'warning' };
}

function getEmbeddingStatus(product: HospitalProduct): { key: 'ready' | 'pending' | 'missing' | 'error' | 'skipped'; label: string; tone: ReadinessTone } {
  if (product.ragEmbeddingStatus === 'embedded') {
    return { key: 'ready', label: product.ragEmbeddingModel ? 'ซิงก์แล้ว' : 'embedded', tone: 'success' };
  }

  if (product.ragEmbeddingStatus === 'pending') {
    return { key: 'pending', label: 'กำลังซิงก์', tone: 'warning' };
  }

  if (product.ragEmbeddingStatus === 'error') {
    return { key: 'error', label: 'ผิดพลาด', tone: 'danger' };
  }

  if (product.ragEmbeddingStatus === 'skipped') {
    return { key: 'skipped', label: 'ยังไม่เปิดใช้', tone: 'muted' };
  }

  return { key: 'missing', label: 'รอซิงก์', tone: 'warning' };
}

function isRagReady(product: HospitalProduct) {
  return getRagReadiness(product).key === 'ready';
}

function matchesRagFilter(product: HospitalProduct, filter: RagFilter) {
  if (filter === 'all') {
    return true;
  }

  const readiness = getRagReadiness(product);

  if (filter === 'ready') {
    return readiness.key === 'ready';
  }

  if (filter === 'publish') {
    return readiness.key === 'publish' || readiness.key === 'review';
  }

  if (filter === 'embedding') {
    return readiness.key === 'embedding';
  }

  return readiness.key === 'error';
}

function matchesStripeFilter(product: HospitalProduct, filter: StripeFilter) {
  if (filter === 'all') {
    return true;
  }

  return getStripeStatus(product).key === filter;
}

function getProductStatusTone(status: HospitalProductStatus): ReadinessTone {
  if (status === 'active') {
    return 'success';
  }

  if (status === 'archived') {
    return 'muted';
  }

  if (status === 'rejected') {
    return 'danger';
  }

  return 'warning';
}

function getNextCatalogAction(product: HospitalProduct) {
  if (product.status === 'archived') {
    return 'ตรวจสอบก่อนกู้คืนสินค้าให้กลับมาเปิดขาย';
  }

  if (product.status === 'draft') {
    return 'ตรวจรายละเอียดสินค้าและเปิดขายเมื่อพร้อม';
  }

  if (product.status === 'pending_review') {
    return 'รอตรวจข้อมูลสินค้าและ RAG ก่อนเปิดใช้งาน';
  }

  if (product.status === 'rejected') {
    return 'แก้ไขข้อมูลตามเหตุผลที่ไม่ผ่านแล้วส่งตรวจใหม่';
  }

  if (product.branches.length === 0) {
    return 'ผูกสาขาที่ให้บริการเพื่อให้ staff นัดหมายได้ถูกต้อง';
  }

  const stripeStatus = getStripeStatus(product);
  if (stripeStatus.key !== 'synced') {
    return 'ซิงก์ Stripe เพื่อให้ข้อมูล payment product ตรงกับ catalog';
  }

  const ragStatus = getRagReadiness(product);
  if (ragStatus.key !== 'ready') {
    return ragStatus.key === 'embedding' ? 'ซิงก์ embedding ให้พร้อมใช้กับ RAG answers' : 'publish RAG เพื่อให้ chat ตอบจากข้อมูลสินค้านี้ได้';
  }

  return 'พร้อมใช้ใน catalog, chat checkout, RAG และ Referral workflow';
}

function formatShortDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatShortDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(date);
}

function getProductTimestamp(product: HospitalProduct) {
  const updatedAt = product.updatedAt ?? product.createdAt;

  return `${product.updatedAt ? 'อัปเดต' : 'สร้าง'} ${formatShortDate(updatedAt)}`;
}

function readinessToneStyle(tone: ReadinessTone) {
  if (tone === 'success') {
    return styles.statusBadgeSuccess;
  }

  if (tone === 'warning') {
    return styles.statusBadgeWarning;
  }

  if (tone === 'danger') {
    return styles.statusBadgeDanger;
  }

  if (tone === 'info') {
    return styles.statusBadgeInfo;
  }

  return styles.statusBadgeMuted;
}

function readinessBadgeToneStyle(tone: ReadinessTone) {
  if (tone === 'success') {
    return styles.readinessBadgeSuccess;
  }

  if (tone === 'warning') {
    return styles.readinessBadgeWarning;
  }

  if (tone === 'danger') {
    return styles.readinessBadgeDanger;
  }

  if (tone === 'info') {
    return styles.readinessBadgeInfo;
  }

  return styles.readinessBadgeMuted;
}

function readinessValueToneStyle(tone: ReadinessTone) {
  if (tone === 'success') {
    return styles.readinessValueSuccess;
  }

  if (tone === 'warning') {
    return styles.readinessValueWarning;
  }

  if (tone === 'danger') {
    return styles.readinessValueDanger;
  }

  if (tone === 'info') {
    return styles.readinessValueInfo;
  }

  return styles.readinessValueMuted;
}

function categoryIcon(category: ProductCategory): SymbolName {
  if (category === 'vaccine') {
    return { android: 'vaccines', ios: 'syringe', web: 'vaccines' };
  }

  if (category === 'imaging') {
    return { android: 'monitor_heart', ios: 'waveform.path.ecg', web: 'monitor_heart' };
  }

  if (category === 'consult') {
    return { android: 'stethoscope', ios: 'stethoscope', web: 'stethoscope' };
  }

  return { android: 'water_drop', ios: 'drop', web: 'water_drop' };
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function Meta({ icon, label, value }: { icon: SymbolName; label: string; value: string }) {
  return (
    <View style={styles.metaCell}>
      <SymbolView name={icon} size={23} tintColor={MiraDesign.color.primary} />
      <View style={styles.metaCopy}>
        <Text style={styles.metaLabel}>{label}</Text>
        <Text numberOfLines={1} style={styles.metaValue}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: MiraDesign.color.canvas,
    flex: 1,
  },
  container: {
    gap: 12,
    padding: 16,
    paddingBottom: 40,
  },
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
  headerBtnPrimary: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.primary,
    borderRadius: 8,
    cursor: 'pointer',
    flexDirection: 'row',
    gap: 6,
    height: 38,
    paddingHorizontal: 14,
  },
  headerBtnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  headerCard: {
    alignItems: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderColor: '#D8E4EE',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
    padding: 18,
    width: '100%',
    ...softShadow,
  },
  headerCardStack: {
    flexDirection: 'column',
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 18,
    justifyContent: 'space-between',
  },
  topBarStack: {
    flexDirection: 'column',
  },
  titleGroup: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  eyebrow: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '800',
  },
  title: {
    color: MiraDesign.color.ink,
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 30,
  },
  subtitle: {
    color: MiraDesign.color.inkSoft,
    fontSize: 14,
    lineHeight: 21,
    maxWidth: 760,
  },
  topActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    flexShrink: 1,
    gap: 8,
    justifyContent: 'flex-end',
    maxWidth: '100%',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.primary,
    borderRadius: 8,
    flexDirection: 'row',
    flexShrink: 1,
    gap: 8,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#D8E4EE',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    flexShrink: 1,
    gap: 8,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 12,
  },
  secondaryButtonText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 13,
    fontWeight: '900',
  },
  notice: {
    backgroundColor: '#FFF7DD',
    borderColor: '#F3D17B',
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  noticeTitle: {
    color: '#6F5100',
    fontSize: 15,
    fontWeight: '900',
  },
  noticeBody: {
    color: '#806729',
    fontSize: 13,
    lineHeight: 19,
  },
  noticeCompact: {
    alignItems: 'flex-start',
    backgroundColor: '#FFF8E8',
    borderColor: '#E9D29A',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  noticeCompactText: {
    color: '#6F5100',
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  noticeButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#6F5100',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 14,
  },
  noticeButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  statCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#D8E4EE',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 70,
    minWidth: 140,
    padding: 10,
    ...softShadow,
  },
  statIcon: {
    alignItems: 'center',
    borderRadius: 999,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  statIconBlue: {
    backgroundColor: '#EAF2FF',
  },
  statIconMint: {
    backgroundColor: '#E7F8F2',
  },
  statIconOrange: {
    backgroundColor: '#FFF1E4',
  },
  statIconViolet: {
    backgroundColor: '#F0EAFE',
  },
  statCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  statLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '800',
  },
  statValue: {
    color: MiraDesign.color.ink,
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 25,
  },
  statDetail: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '700',
  },
  statCardAction: {
    alignSelf: 'flex-start',
  },
  statAction: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 42,
    paddingHorizontal: 12,
  },
  statActionText: {
    color: MiraDesign.color.primary,
    fontSize: 12,
    fontWeight: '900',
  },
  workspace: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 16,
  },
  workspaceStack: {
    flexDirection: 'column',
  },
  sidePane: {
    gap: 12,
    maxWidth: '100%',
    width: 328,
  },
  sideTitle: {
    color: MiraDesign.color.ink,
    fontSize: 16,
    fontWeight: '900',
  },
  searchBox: {
    alignItems: 'center',
    backgroundColor: '#FBFDFE',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 240,
    flexDirection: 'row',
    gap: 10,
    maxWidth: 440,
    minHeight: 40,
    minWidth: 160,
    paddingHorizontal: 12,
  },
  editorPanel: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
    ...softShadow,
  },
  referralPanel: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
    ...softShadow,
  },
  referralHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  referralTitle: {
    color: MiraDesign.color.ink,
    fontSize: 13,
    fontWeight: '900',
  },
  referralLink: {
    color: MiraDesign.color.primary,
    fontSize: 13,
    fontWeight: '900',
    marginTop: 8,
  },
  waitingBadge: {
    backgroundColor: '#FFF2D8',
    borderRadius: 8,
    color: '#B7791F',
    fontSize: 12,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  referralCallout: {
    alignItems: 'flex-start',
    backgroundColor: MiraDesign.color.primarySoft,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 12,
    padding: 16,
  },
  referralCopy: {
    flex: 1,
    gap: 8,
  },
  referralCalloutTitle: {
    color: MiraDesign.color.ink,
    fontSize: 15,
    fontWeight: '900',
  },
  referralBody: {
    color: MiraDesign.color.inkSoft,
    fontSize: 13,
    lineHeight: 20,
  },
  formPane: {
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    flex: 0.8,
    gap: 14,
    padding: 18,
    width: '100%',
    ...softShadow,
  },
  listPane: {
    alignSelf: 'stretch',
    backgroundColor: '#FFFFFF',
    borderColor: '#D8E4EE',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    gap: 12,
    minWidth: 0,
    padding: 14,
    ...softShadow,
  },
  panelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
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
    marginTop: 3,
  },
  inventoryHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingTop: 2,
  },
  inventoryHeaderStack: {
    alignItems: 'stretch',
    flexDirection: 'column',
  },
  inventoryTitle: {
    color: MiraDesign.color.ink,
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 25,
  },
  inventoryMeta: {
    color: MiraDesign.color.primary,
    fontSize: 13,
    fontWeight: '900',
    marginTop: 6,
  },
  inventoryActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
    maxWidth: '100%',
  },
  textButton: {
    backgroundColor: MiraDesign.color.primarySoft,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  textButtonLabel: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '900',
  },
  field: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  fieldLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
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
    minHeight: 46,
    paddingHorizontal: 12,
  },
  multilineInput: {
    minHeight: 92,
    paddingTop: 12,
  },
  twoColumn: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  imageField: {
    flex: 1,
    gap: 6,
    minWidth: 220,
  },
  imageInputRow: {
    alignItems: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  imageUrlInput: {
    flex: 1,
    minWidth: 220,
  },
  uploadButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: MiraDesign.color.primaryDeep,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 46,
    minWidth: 112,
    paddingHorizontal: 14,
  },
  uploadButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  imagePreviewRow: {
    alignItems: 'center',
    backgroundColor: '#F7FBFA',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 8,
  },
  imagePreview: {
    backgroundColor: '#EAF3F2',
    borderRadius: 6,
    height: 52,
    width: 70,
  },
  imagePreviewText: {
    color: MiraDesign.color.inkSoft,
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
  },
  controlGroup: {
    gap: 8,
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
    minHeight: 36,
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
    fontWeight: '900',
  },
  segmentTextActive: {
    color: MiraDesign.color.primaryDeep,
  },
  inlineAdminPanel: {
    backgroundColor: '#F7FBFA',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  categoryAdminRow: {
    alignItems: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  compactInput: {
    flex: 1,
    minWidth: 120,
  },
  iconInput: {
    width: 70,
  },
  inlineButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.primaryDeep,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 14,
  },
  inlineButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  branchOptionList: {
    gap: 8,
  },
  branchOption: {
    alignItems: 'center',
    backgroundColor: '#F7FBFA',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 58,
    padding: 10,
  },
  branchOptionActive: {
    backgroundColor: '#E7F4ED',
    borderColor: MiraDesign.color.primary,
  },
  branchOptionInactive: {
    opacity: 0.65,
  },
  radioDot: {
    borderColor: MiraDesign.color.inkSoft,
    borderRadius: 8,
    borderWidth: 2,
    height: 16,
    width: 16,
  },
  radioDotActive: {
    backgroundColor: MiraDesign.color.primary,
    borderColor: MiraDesign.color.primary,
  },
  branchOptionCopy: {
    flex: 1,
    gap: 3,
  },
  branchOptionTitle: {
    color: MiraDesign.color.ink,
    fontSize: 13,
    fontWeight: '900',
  },
  branchOptionMeta: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    lineHeight: 17,
  },
  legacyNotice: {
    backgroundColor: '#FFF7DD',
    borderColor: '#F3D17B',
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  legacyTitle: {
    color: '#6F5100',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  legacyBody: {
    color: MiraDesign.color.ink,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  helperText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    lineHeight: 17,
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.primary,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 46,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  disabled: {
    opacity: 0.45,
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
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
  },
  metric: {
    backgroundColor: '#F7FBFA',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 82,
    padding: 10,
  },
  metricLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  metricValue: {
    color: MiraDesign.color.ink,
    fontSize: 17,
    fontWeight: '900',
    marginTop: 4,
  },
  filterBar: {
    gap: 10,
  },
  searchInput: {
    color: MiraDesign.color.ink,
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    minHeight: 40,
    minWidth: 0,
    paddingHorizontal: 0,
  },
  statusPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 2,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusBadgeSuccess: {
    backgroundColor: '#E7F8F2',
    color: '#087B5D',
  },
  statusBadgeWarning: {
    backgroundColor: '#FFF4D8',
    color: '#8A5B00',
  },
  statusBadgeDanger: {
    backgroundColor: '#FFE8E8',
    color: '#A23538',
  },
  statusBadgeInfo: {
    backgroundColor: '#EAF2FF',
    color: MiraDesign.color.primaryDeep,
  },
  statusBadgeMuted: {
    backgroundColor: '#EEF4F8',
    color: MiraDesign.color.inkSoft,
  },
  toolbar: {
    backgroundColor: '#F8FBFD',
    borderColor: '#D8E4EE',
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 10,
  },
  toolbarTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterToggle: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    cursor: 'pointer',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 12,
  },
  filterToggleActive: {
    backgroundColor: MiraDesign.color.primarySoft,
    borderColor: MiraDesign.color.primary,
  },
  filterToggleText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '800',
  },
  filterToggleTextActive: {
    color: MiraDesign.color.primaryDeep,
  },
  clearButton: {
    alignItems: 'center',
    alignSelf: 'stretch',
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 8,
  },
  clearButtonText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '800',
  },
  filterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  filterGroup: {
    flexGrow: 1,
    gap: 6,
    minWidth: 164,
  },
  filterGroupLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '800',
  },
  chipGroup: {
    gap: 11,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D8E4EE',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  filterChipActive: {
    backgroundColor: MiraDesign.color.primary,
    borderColor: MiraDesign.color.primary,
  },
  filterChipText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '900',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  filterOverlay: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 50,
  },
  filterBackdrop: {
    backgroundColor: 'rgba(15, 42, 46, 0.34)',
    bottom: 0,
    cursor: 'pointer',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  filterPanel: {
    backgroundColor: MiraDesign.color.surface,
    position: 'absolute',
    ...softShadow,
  },
  filterPanelDesktop: {
    borderColor: MiraDesign.color.line,
    borderLeftWidth: 1,
    bottom: 0,
    right: 0,
    top: 0,
    width: 360,
  },
  filterPanelSheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    bottom: 0,
    left: 0,
    maxHeight: '84%',
    right: 0,
  },
  filterPanelHeader: {
    alignItems: 'center',
    borderBottomWidth: 1,
    borderColor: MiraDesign.color.line,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  filterPanelTitle: {
    color: MiraDesign.color.ink,
    fontSize: 16,
    fontWeight: '800',
  },
  filterCloseBtn: {
    cursor: 'pointer',
    padding: 4,
  },
  filterPanelBody: {
    gap: 18,
    padding: 18,
  },
  filterPanelFooter: {
    borderColor: MiraDesign.color.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 16,
  },
  filterClearBtn: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.surfaceSoft,
    borderRadius: 10,
    cursor: 'pointer',
    flex: 1,
    paddingVertical: 11,
  },
  filterClearBtnText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 13,
    fontWeight: '800',
  },
  filterApplyBtn: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.primary,
    borderRadius: 10,
    cursor: 'pointer',
    flex: 1,
    paddingVertical: 11,
  },
  filterApplyBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  productGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  gridCard: {
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 14,
    borderWidth: 1,
    cursor: 'pointer',
    flexBasis: 210,
    flexGrow: 1,
    minWidth: 190,
    overflow: 'hidden',
    ...softShadow,
  },
  gridCardSelected: {
    backgroundColor: MiraDesign.color.surfaceSoft,
    borderColor: MiraDesign.color.primary,
  },
  gridCardArchived: {
    opacity: 0.7,
  },
  gridThumb: {
    backgroundColor: MiraDesign.color.surfaceSoft,
    height: 148,
    position: 'relative',
    width: '100%',
  },
  gridImage: {
    height: '100%',
    width: '100%',
  },
  gridImagePlaceholder: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.primarySoft,
    height: '100%',
    justifyContent: 'center',
    width: '100%',
  },
  gridStatusWrap: {
    left: 10,
    position: 'absolute',
    top: 10,
  },
  gridInfo: {
    gap: 3,
    padding: 12,
  },
  gridTitle: {
    color: MiraDesign.color.ink,
    fontSize: 14.5,
    fontWeight: '800',
    lineHeight: 19,
  },
  gridCategory: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '600',
  },
  gridPrice: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 15,
    fontWeight: '900',
    marginTop: 2,
  },
  editorActions: {
    borderColor: MiraDesign.color.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
    paddingTop: 12,
  },
  editorActionBtn: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.surfaceSoft,
    borderRadius: 8,
    cursor: 'pointer',
    flex: 1,
    paddingVertical: 9,
  },
  editorActionText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12.5,
    fontWeight: '800',
  },
  editorActionDanger: {
    alignItems: 'center',
    backgroundColor: '#FCE7E7',
    borderRadius: 8,
    cursor: 'pointer',
    flex: 1,
    paddingVertical: 9,
  },
  editorActionDangerText: {
    color: MiraDesign.color.danger,
    fontSize: 12.5,
    fontWeight: '800',
  },
  emptyState: {
    backgroundColor: '#F8FBFD',
    borderColor: '#D8E4EE',
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
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
  emptyAction: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: MiraDesign.color.primary,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 14,
  },
  emptyActionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  emptySecondaryAction: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderColor: '#D8E4EE',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 14,
  },
  emptySecondaryActionText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '800',
  },
  skeletonStack: {
    gap: 10,
  },
  skeletonCard: {
    alignItems: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderColor: '#D8E4EE',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  skeletonImage: {
    backgroundColor: '#E8F0F6',
    borderRadius: 8,
    height: 72,
    width: 72,
  },
  skeletonBody: {
    flex: 1,
    gap: 10,
  },
  skeletonLineWide: {
    backgroundColor: '#E8F0F6',
    borderRadius: 999,
    height: 14,
    width: '65%',
  },
  skeletonLine: {
    backgroundColor: '#EEF4F8',
    borderRadius: 999,
    height: 12,
    width: '84%',
  },
  skeletonChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  skeletonChip: {
    backgroundColor: '#EEF4F8',
    borderRadius: 999,
    height: 22,
    width: 86,
  },
  productCard: {
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 14,
    position: 'relative',
    ...softShadow,
  },
  pCardBody: {
    gap: 6,
  },
  pCardHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  pCardTitle: {
    color: MiraDesign.color.ink,
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
  },
  pCardMeta: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12.5,
    fontWeight: '600',
  },
  pCardStatusLine: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  pCardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  pCardBtn: {
    backgroundColor: MiraDesign.color.surfaceSoft,
    borderRadius: 8,
    cursor: 'pointer',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pCardBtnText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '800',
  },
  pCardBtnDanger: {
    backgroundColor: '#FCE7E7',
    borderRadius: 8,
    cursor: 'pointer',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pCardBtnDangerText: {
    color: MiraDesign.color.danger,
    fontSize: 12,
    fontWeight: '800',
  },
  productCardSelected: {
    backgroundColor: MiraDesign.color.surfaceSoft,
    borderColor: MiraDesign.color.primary,
  },
  productCardArchived: {
    opacity: 0.78,
  },
  selectedRail: {
    backgroundColor: MiraDesign.color.primary,
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
    width: 4,
  },
  productCardTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    minWidth: 0,
  },
  productRow: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
    ...softShadow,
  },
  productRowSelected: {
    borderColor: MiraDesign.color.primary,
  },
  productHead: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  productHero: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 14,
  },
  productMain: {
    flex: 1,
    gap: 8,
    minWidth: 0,
  },
  productImage: {
    backgroundColor: MiraDesign.color.primarySoft,
    borderRadius: 8,
    height: 72,
    width: 72,
  },
  productIconBox: {
    alignItems: 'center',
    backgroundColor: '#EEF6FF',
    borderRadius: 8,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  productTitleGroup: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  productTitle: {
    color: MiraDesign.color.ink,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 21,
  },
  productKey: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  rowPills: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'flex-end',
  },
  productDescription: {
    color: MiraDesign.color.inkSoft,
    fontSize: 13,
    lineHeight: 19,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagPill: {
    backgroundColor: '#EEF4F8',
    borderRadius: 8,
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '700',
    maxWidth: 150,
    overflow: 'hidden',
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  timestampPill: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D8E4EE',
    borderRadius: 8,
    borderWidth: 1,
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  productFactRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  productFact: {
    backgroundColor: '#F8FBFD',
    borderRadius: 8,
    flexGrow: 1,
    gap: 3,
    minWidth: 118,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  productFactLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '700',
  },
  productFactValue: {
    color: MiraDesign.color.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  branchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  branchChip: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D8E4EE',
    borderRadius: 999,
    borderWidth: 1,
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '700',
    maxWidth: 160,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  branchPlaceholder: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  readinessCluster: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  readinessBadge: {
    borderRadius: 8,
    flexGrow: 1,
    gap: 3,
    minWidth: 116,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  readinessBadgeSuccess: {
    backgroundColor: '#E7F8F2',
  },
  readinessBadgeWarning: {
    backgroundColor: '#FFF6E4',
  },
  readinessBadgeDanger: {
    backgroundColor: '#FFECEC',
  },
  readinessBadgeInfo: {
    backgroundColor: '#EAF2FF',
  },
  readinessBadgeMuted: {
    backgroundColor: '#EEF4F8',
  },
  readinessLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 10,
    fontWeight: '800',
  },
  readinessValue: {
    fontSize: 12,
    fontWeight: '800',
  },
  readinessValueSuccess: {
    color: '#087B5D',
  },
  readinessValueWarning: {
    color: '#8A5B00',
  },
  readinessValueDanger: {
    color: '#A23538',
  },
  readinessValueInfo: {
    color: MiraDesign.color.primaryDeep,
  },
  readinessValueMuted: {
    color: MiraDesign.color.inkSoft,
  },
  productMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaCell: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    flexGrow: 1,
    gap: 10,
    minHeight: 52,
    minWidth: 168,
    padding: 9,
  },
  metaCopy: {
    flex: 1,
    minWidth: 0,
  },
  metaLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  metaValue: {
    color: MiraDesign.color.ink,
    fontSize: 13,
    fontWeight: '900',
    marginTop: 4,
  },
  productFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    maxWidth: '100%',
  },
  nextActionRow: {
    alignItems: 'center',
    backgroundColor: '#F8FBFD',
    borderRadius: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
    padding: 10,
  },
  nextActionCopy: {
    flex: 1,
    gap: 3,
    minWidth: 180,
  },
  nextActionLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '800',
  },
  nextActionText: {
    color: MiraDesign.color.ink,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  productBottom: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  productLocation: {
    color: MiraDesign.color.inkSoft,
    flex: 1,
    fontSize: 12,
    fontWeight: '800',
    minWidth: 220,
  },
  stripePanel: {
    backgroundColor: '#F7FBFA',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 10,
  },
  stripeId: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '800',
  },
  stripeButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#D8E4EE',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 38,
    minWidth: 122,
    paddingHorizontal: 12,
  },
  stripeButtonText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '900',
  },
  editButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#D8E4EE',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 38,
    minWidth: 88,
    paddingHorizontal: 12,
  },
  editButtonText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '800',
  },
  referralButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#D8E4EE',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 38,
    minWidth: 122,
    paddingHorizontal: 12,
  },
  referralButtonText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '800',
  },
  disabledHint: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: '#FFE8E8',
    borderColor: '#F7B9BA',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 38,
    minWidth: 102,
    paddingHorizontal: 12,
  },
  dangerButtonText: {
    color: '#A23538',
    fontSize: 12,
    fontWeight: '900',
  },
  restoreButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.primary,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 38,
    minWidth: 102,
    paddingHorizontal: 12,
  },
  restoreButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
});
