import { Link } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { BranchOptionRow } from '@/components/chat/BranchOptionRow';
import { OrderPanel } from '@/components/chat/OrderPanel';
import { MiraDesign, softShadow } from '@/constants/Design';
import { invokeFunction } from '@/lib/api/client';
import { useAuthSession } from '@/lib/auth/useAuthSession';
import {
  defaultTenantSlug,
  getProductCategoryLabel,
  loadActiveHospitalProducts,
  type BranchSummary,
  type HospitalProduct,
} from '@/lib/marketplace/hospitalProducts';
import { createReferralShareLink, formatPercent } from '@/lib/marketplace/referralMock';
import { showcaseDemoCommissions, showcaseDemoProducts, showcaseDemoReferrers, showcaseDemoTenant } from '@/lib/showcase/demoFixtures';
import { supabase, supabaseConfigStatus } from '@/lib/supabase';
import type {
  CommissionEntryRow,
  OrderPanelBranch,
  OrderPanelState,
  ReferralSelfProvisionRequest,
  ReferralSelfProvisionResponse,
  ReferrerOrderBranchesResponse,
  ReferrerOrderRequest,
  ReferrerOrderResponse,
  ReferrerRow,
} from '@/lib/types/api';

type SalesTab = 'dashboard' | 'products' | 'referral';

type TenantInfo = {
  display_name: string;
  id: string;
};

type TenantMemberInfo = {
  role: string;
};

type CommissionWithOrder = CommissionEntryRow & {
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
};

const tabs: { id: SalesTab; label: string }[] = [
  { id: 'products', label: 'สินค้า' },
  { id: 'referral', label: 'Referral' },
  { id: 'dashboard', label: 'Dashboard' },
];

function fromJoin<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function formatMoney(amount: number) {
  return `${amount.toLocaleString('th-TH')} THB`;
}

function toOrderPanelBranch(branch: BranchSummary): OrderPanelBranch {
  return {
    address: branch.address,
    district: branch.district,
    id: branch.id,
    name: branch.name,
  };
}

function activeProductBranches(product: HospitalProduct | null): OrderPanelBranch[] {
  return product?.branches.filter((branch) => branch.active).map(toOrderPanelBranch) ?? [];
}

function buyerAgeError(value: string) {
  const parsed = Number(value.trim());

  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 120 ? null : 'กรุณากรอกอายุ 1-120 ปี';
}

function digitsOnly(value: string) {
  return value.replace(/[^\d]/g, '');
}

function normalizeQuery(value: string) {
  return value.trim().toLowerCase();
}

function productMatches(product: HospitalProduct, query: string) {
  const normalizedQuery = normalizeQuery(query);

  if (!normalizedQuery) {
    return true;
  }

  return [product.title, product.catalogKey, product.description, product.category, ...product.tags]
    .join(' ')
    .toLowerCase()
    .includes(normalizedQuery);
}

function schemeValueForProduct(referrer: ReferrerRow | null, product: HospitalProduct | null) {
  if (!referrer || !product) {
    return null;
  }

  const value = referrer.commission_scheme.by_category?.[product.category] ?? referrer.commission_scheme.default;

  return {
    mode: referrer.commission_scheme.mode,
    value,
  };
}

function commissionLabel(referrer: ReferrerRow | null, product: HospitalProduct | null) {
  const schemeValue = schemeValueForProduct(referrer, product);

  if (!schemeValue) {
    return '-';
  }

  return schemeValue.mode === 'percent' ? formatPercent(schemeValue.value) : formatMoney(schemeValue.value);
}

function estimatedCommission(referrer: ReferrerRow | null, product: HospitalProduct | null) {
  const schemeValue = schemeValueForProduct(referrer, product);

  if (!schemeValue || !product) {
    return 0;
  }

  if (schemeValue.mode === 'flat_baht') {
    return Math.max(0, Math.round(schemeValue.value));
  }

  const fraction = Math.abs(schemeValue.value) > 1 ? schemeValue.value / 100 : schemeValue.value;

  return Math.max(0, Math.round(product.priceAmount * fraction));
}

function statusTone(status: CommissionEntryRow['status']) {
  if (status === 'paid') {
    return styles.statusPaid;
  }

  if (status === 'approved') {
    return styles.statusApproved;
  }

  if (status === 'void') {
    return styles.statusVoid;
  }

  return styles.statusPending;
}

export default function SalesPortalScreen() {
  const auth = useAuthSession();
  const { width } = useWindowDimensions();
  const [activeTab, setActiveTab] = useState<SalesTab>('products');
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [memberRole, setMemberRole] = useState<string | null>(null);
  const [referrer, setReferrer] = useState<ReferrerRow | null>(null);
  const [products, setProducts] = useState<HospitalProduct[]>([]);
  const [commissions, setCommissions] = useState<CommissionWithOrder[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [buyerName, setBuyerName] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [buyerAge, setBuyerAge] = useState('');
  const [ageError, setAgeError] = useState<string | null>(null);
  const [preferredDate, setPreferredDate] = useState('');
  const [branchChoices, setBranchChoices] = useState<OrderPanelBranch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [activeOrder, setActiveOrder] = useState<OrderPanelState>(null);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isDemoMode = !auth.session || !supabaseConfigStatus.isConfigured;
  const selectedProduct = products.find((product) => product.id === selectedProductId) ?? products[0] ?? null;
  const filteredProducts = useMemo(() => products.filter((product) => productMatches(product, query)), [products, query]);
  const buyerAgeNumber = Number(buyerAge.trim());
  const hasValidBuyerAge = Number.isInteger(buyerAgeNumber) && buyerAgeNumber >= 1 && buyerAgeNumber <= 120;
  const selectedBranch = branchChoices.find((branch) => branch.id === selectedBranchId) ?? null;
  const requiresBranchChoice = branchChoices.length > 1;
  const shareLink = referrer ? createReferralShareLink(referrer.ref_code) : null;
  const isCompact = width < 840;
  const canSelfProvision = Boolean(auth.session && !isDemoMode && tenant && memberRole && !referrer && !isProvisioning);
  const canCreateOrder = Boolean(
    selectedProduct &&
      referrer &&
      buyerName.trim().length > 1 &&
      /^0[689]\d{8}$/.test(buyerPhone.trim()) &&
      hasValidBuyerAge &&
      !isLoadingBranches &&
      (!requiresBranchChoice || selectedBranch) &&
      !isSubmitting,
  );

  const totals = useMemo(
    () => ({
      approved: commissions.filter((entry) => entry.status === 'approved').reduce((sum, entry) => sum + entry.amount_baht, 0),
      paid: commissions.filter((entry) => entry.status === 'paid').reduce((sum, entry) => sum + entry.amount_baht, 0),
      pending: commissions.filter((entry) => entry.status === 'pending').reduce((sum, entry) => sum + entry.amount_baht, 0),
    }),
    [commissions],
  );

  const loadSalesPortalData = useCallback(async () => {
    if (!supabaseConfigStatus.isConfigured || !auth.user) {
      return;
    }

    const { data: tenantRow, error: tenantError } = await supabase
      .from('tenants')
      .select('id,display_name')
      .eq('slug', defaultTenantSlug)
      .maybeSingle();

    if (tenantError || !tenantRow) {
      throw new Error(tenantError?.message ?? `Tenant "${defaultTenantSlug}" is not available.`);
    }

    const { data: memberRow, error: memberError } = await supabase
      .from('tenant_members')
      .select('role')
      .eq('tenant_id', (tenantRow as TenantInfo).id)
      .eq('auth_user_id', auth.user.id)
      .maybeSingle();

    if (memberError) {
      throw new Error(memberError.message);
    }

    const { data: referrerRow, error: referrerError } = await supabase
      .from('referrers')
      .select('id,tenant_id,ref_code,name,type,phone,auth_user_id,commission_scheme,active,created_at')
      .eq('tenant_id', (tenantRow as TenantInfo).id)
      .eq('auth_user_id', auth.user.id)
      .eq('active', true)
      .maybeSingle();

    if (referrerError) {
      throw new Error(referrerError.message);
    }

    setTenant(tenantRow as TenantInfo);
    setMemberRole(String((memberRow as TenantMemberInfo | null)?.role ?? '') || null);
    setReferrer((referrerRow as ReferrerRow | null) ?? null);
    setProducts(await loadActiveHospitalProducts(80));

    if (referrerRow) {
      const { data: commissionRows, error: commissionError } = await supabase
        .from('commission_entries')
        .select('id,tenant_id,referrer_id,order_id,scheme_snapshot,amount_baht,status,created_at,orders(amount_baht,products(name))')
        .eq('referrer_id', (referrerRow as ReferrerRow).id)
        .order('created_at', { ascending: false })
        .limit(80);

      if (commissionError) {
        throw new Error(commissionError.message);
      }

      setCommissions((commissionRows ?? []) as unknown as CommissionWithOrder[]);
    } else {
      setCommissions([]);
    }
  }, [auth.user]);

  useEffect(() => {
    let isMounted = true;

    async function boot() {
      if (auth.isLoading) {
        return;
      }

      if (isDemoMode) {
        setTenant({ display_name: showcaseDemoTenant.display_name, id: showcaseDemoTenant.id });
        setMemberRole(null);
        setReferrer(showcaseDemoReferrers[0] ?? null);
        setProducts(showcaseDemoProducts);
        setCommissions(showcaseDemoCommissions as unknown as CommissionWithOrder[]);
        setIsLoading(false);
        return;
      }

      try {
        setError(null);
        await loadSalesPortalData();
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load sales referral workspace.');
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
  }, [auth.isLoading, auth.session, isDemoMode, loadSalesPortalData]);

  useEffect(() => {
    if (!selectedProductId && products.length > 0) {
      setSelectedProductId(products[0].id);
    }
  }, [products, selectedProductId]);

  useEffect(() => {
    let isMounted = true;
    const localBranches = activeProductBranches(selectedProduct);

    setBranchChoices(localBranches);
    setSelectedBranchId(localBranches.length > 1 ? localBranches[0]?.id ?? '' : '');

    if (!selectedProduct || isDemoMode || !referrer) {
      setIsLoadingBranches(false);
      return () => {
        isMounted = false;
      };
    }

    async function loadBranchesForProduct() {
      try {
        setIsLoadingBranches(true);
        const result = await invokeFunction<ReferrerOrderRequest, ReferrerOrderBranchesResponse>('referrer-order', {
          action: 'list_branches',
          catalog_key: selectedProduct.catalogKey,
          tenant_slug: defaultTenantSlug,
        });

        if (isMounted) {
          setBranchChoices(result.branches);
          setSelectedBranchId(result.branches.length > 1 ? result.branches[0]?.id ?? '' : '');
        }
      } catch (branchError) {
        if (isMounted) {
          setError(branchError instanceof Error ? branchError.message : 'ไม่สามารถโหลดสาขาสำหรับแพ็กเกจนี้ได้');
        }
      } finally {
        if (isMounted) {
          setIsLoadingBranches(false);
        }
      }
    }

    void loadBranchesForProduct();

    return () => {
      isMounted = false;
    };
  }, [isDemoMode, referrer, selectedProduct]);

  async function createOrder() {
    if (!selectedProduct || !canCreateOrder) {
      const nextAgeError = buyerAgeError(buyerAge);

      if (nextAgeError) {
        setAgeError(nextAgeError);
      }

      if (requiresBranchChoice && !selectedBranch) {
        setError('กรุณาเลือกสาขาก่อนสร้าง QR');
      }

      return;
    }

    if (isDemoMode) {
      const orderId = `demo-sales-order-${Date.now()}`;

      setActiveOrder({
        amount_baht: selectedProduct.priceAmount,
        booking_at: null,
        branch_name: selectedBranch?.name ?? branchChoices[0]?.name ?? null,
        id: orderId,
        missing_fields: [],
        payment_provider: 'promptpay',
        preferred_date: preferredDate.trim() || null,
        preferred_date_end: preferredDate.trim() || null,
        preferred_time_window: null,
        product_name: selectedProduct.title,
        qr_payload: `demo-promptpay:${orderId}:${selectedProduct.priceAmount}`,
        step: 'qr',
        status: 'awaiting_payment',
      });
      setMessage(`โหมดตัวอย่าง: สร้างออเดอร์ให้ ${buyerName.trim()} แล้ว`);
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      setMessage(null);
      const result = await invokeFunction<ReferrerOrderRequest, ReferrerOrderResponse>('referrer-order', {
        action: 'create_order',
        ...(requiresBranchChoice && selectedBranch ? { branch_id: selectedBranch.id } : {}),
        buyer_age: buyerAgeNumber,
        buyer_name: buyerName.trim(),
        buyer_phone: buyerPhone.trim(),
        catalog_key: selectedProduct.catalogKey,
        preferred_date: preferredDate.trim() || undefined,
        tenant_slug: defaultTenantSlug,
      });
      setActiveOrder(result.order);
      setMessage(`สร้างออเดอร์ให้ ${buyerName.trim()} แล้ว`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'ไม่สามารถสร้างออเดอร์ได้');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function markPaymentDone(orderId: string) {
    if (isDemoMode && activeOrder) {
      setActiveOrder({ ...activeOrder, step: 'tracking', status: 'submitted' });
      setMessage('โหมดตัวอย่าง: ส่งสถานะชำระเงินแล้วให้แอดมินตรวจสอบ');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      setMessage(null);
      const result = await invokeFunction<ReferrerOrderRequest, ReferrerOrderResponse>('referrer-order', {
        action: 'payment_done',
        order_id: orderId,
        tenant_slug: defaultTenantSlug,
      });
      setActiveOrder(result.order);
      setMessage('ส่งสถานะชำระเงินให้แอดมินตรวจสอบแล้ว');
      await loadSalesPortalData();
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : 'ไม่สามารถส่งสถานะชำระเงินได้');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function provisionReferralCode() {
    if (!canSelfProvision) {
      return;
    }

    try {
      setIsProvisioning(true);
      setError(null);
      setMessage(null);
      const result = await invokeFunction<ReferralSelfProvisionRequest, ReferralSelfProvisionResponse>('referral-self-provision', {
        tenant_slug: defaultTenantSlug,
      });

      setMessage(result.created ? 'สร้าง referral code ของฉันเรียบร้อยแล้ว' : 'พบ referral code เดิมของบัญชีนี้แล้ว');
      await loadSalesPortalData();
      setActiveTab('referral');
    } catch (provisionError) {
      setError(provisionError instanceof Error ? provisionError.message : 'ไม่สามารถสร้าง referral code ได้');
    } finally {
      setIsProvisioning(false);
    }
  }

  async function copyShareLink() {
    if (!shareLink) {
      return;
    }

    await (globalThis as typeof globalThis & { navigator?: { clipboard?: { writeText: (value: string) => Promise<void> } } }).navigator?.clipboard
      ?.writeText(shareLink)
      .catch(() => undefined);
    setMessage('คัดลอกลิงก์ referral แล้ว');
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.topBar}>
          <View style={styles.titleBlock}>
            <Text style={styles.eyebrow}>Sales Referral</Text>
            <Text style={styles.title}>Referral Sales Portal</Text>
            <Text style={styles.subtitle}>
              {referrer ? `${referrer.name} · ${referrer.ref_code}` : isLoading ? 'กำลังโหลด referrer profile' : 'ยังไม่มี referrer profile ที่ผูกกับบัญชีนี้'}
            </Text>
          </View>
          <View style={styles.shareBox}>
            <Text style={styles.shareLabel}>ลิงก์ referral</Text>
            <Text selectable numberOfLines={2} style={styles.shareValue}>
              {shareLink ?? 'ยังไม่มีลิงก์'}
            </Text>
          </View>
        </View>

        {error ? <Banner tone="error" text={error} /> : null}
        {message ? <Banner tone="success" text={message} /> : null}
        {isDemoMode ? <Banner tone="success" text="โหมดตัวอย่าง: เปิด workspace ได้โดยไม่ต้องล็อกอิน และปุ่มออเดอร์จะไม่ส่งข้อมูลจริง" /> : null}

        {!referrer && !isLoading ? (
          <View style={styles.noticeInline}>
            <Text style={styles.noticeTitle}>{canSelfProvision ? 'สร้าง referral code ของฉัน' : 'ยังไม่มี referrer ที่ผูกกับบัญชีนี้'}</Text>
            <Text style={styles.noticeBody}>
              {canSelfProvision
                ? 'บัญชีนี้เป็นสมาชิกของ tenant แล้ว กดครั้งเดียวเพื่อสร้างโค้ด active ทันทีโดยไม่ต้องกรอกข้อมูล'
                : memberRole
                  ? 'ระบบยังไม่พบ referrer profile ที่ active สำหรับบัญชีนี้'
                  : 'ให้ tenant admin เพิ่มบัญชีนี้เป็นสมาชิก tenant ก่อน แล้วจึงสร้าง referral code ได้'}
            </Text>
            {canSelfProvision ? (
              <Pressable disabled={isProvisioning} onPress={() => void provisionReferralCode()} style={[styles.primaryButton, isProvisioning ? styles.disabled : null]}>
                <Text style={styles.primaryButtonText}>{isProvisioning ? 'กำลังสร้าง' : 'สร้าง referral code ของฉัน'}</Text>
              </Pressable>
            ) : (
              <Link href="/admin/referrers" asChild>
                <Pressable style={styles.secondaryAction}>
                  <Text style={styles.secondaryActionText}>เปิดหน้า Referrers Admin</Text>
                </Pressable>
              </Link>
            )}
          </View>
        ) : null}

        <View style={styles.metrics}>
          <Metric label="Pending" value={formatMoney(totals.pending)} />
          <Metric label="Approved" value={formatMoney(totals.approved)} />
          <Metric label="Paid" value={formatMoney(totals.paid)} />
          <Metric label="Share Code" value={referrer?.ref_code ?? '-'} />
        </View>

        <View style={styles.tabs}>
          {tabs.map((tab) => (
            <Pressable key={tab.id} onPress={() => setActiveTab(tab.id)} style={[styles.tab, activeTab === tab.id ? styles.activeTab : null]}>
              <Text style={[styles.tabText, activeTab === tab.id ? styles.activeTabText : null]}>{tab.label}</Text>
            </Pressable>
          ))}
        </View>

        {activeTab === 'products' ? (
          <ProductsWorkspace
            activeOrder={activeOrder}
            ageError={ageError}
            branchChoices={branchChoices}
            buyerAge={buyerAge}
            buyerName={buyerName}
            buyerPhone={buyerPhone}
            canCreateOrder={canCreateOrder}
            filteredProducts={filteredProducts}
            isCompact={isCompact}
            isLoading={isLoading}
            isLoadingBranches={isLoadingBranches}
            isSubmitting={isSubmitting}
            onAgeBlur={() => setAgeError(buyerAge ? buyerAgeError(buyerAge) : null)}
            onAgeChange={(value) => {
              setBuyerAge(digitsOnly(value).slice(0, 3));
              setAgeError(null);
            }}
            onBuyerNameChange={setBuyerName}
            onBuyerPhoneChange={(value) => setBuyerPhone(digitsOnly(value).slice(0, 10))}
            onCreateOrder={() => void createOrder()}
            onMarkPaymentDone={(orderId) => void markPaymentDone(orderId)}
            onPreferredDateChange={setPreferredDate}
            onProductPress={(product) => {
              setSelectedProductId(product.id);
              setActiveOrder(null);
              setError(null);
            }}
            onQueryChange={setQuery}
            onSelectBranch={setSelectedBranchId}
            preferredDate={preferredDate}
            query={query}
            referrer={referrer}
            selectedBranchId={selectedBranchId}
            selectedProduct={selectedProduct}
          />
        ) : null}

        {activeTab === 'referral' ? (
          <ReferralPanel
            canSelfProvision={canSelfProvision}
            isProvisioning={isProvisioning}
            onCopy={() => void copyShareLink()}
            onProvision={() => void provisionReferralCode()}
            referrer={referrer}
            shareLink={shareLink}
          />
        ) : null}

        {activeTab === 'dashboard' ? (
          <DashboardPanel commissions={commissions} referrer={referrer} selectedProduct={selectedProduct} totals={totals} />
        ) : null}
      </ScrollView>
    </View>
  );
}

function ProductsWorkspace({
  activeOrder,
  ageError,
  branchChoices,
  buyerAge,
  buyerName,
  buyerPhone,
  canCreateOrder,
  filteredProducts,
  isCompact,
  isLoading,
  isLoadingBranches,
  isSubmitting,
  onAgeBlur,
  onAgeChange,
  onBuyerNameChange,
  onBuyerPhoneChange,
  onCreateOrder,
  onMarkPaymentDone,
  onPreferredDateChange,
  onProductPress,
  onQueryChange,
  onSelectBranch,
  preferredDate,
  query,
  referrer,
  selectedBranchId,
  selectedProduct,
}: {
  activeOrder: OrderPanelState;
  ageError: string | null;
  branchChoices: OrderPanelBranch[];
  buyerAge: string;
  buyerName: string;
  buyerPhone: string;
  canCreateOrder: boolean;
  filteredProducts: HospitalProduct[];
  isCompact: boolean;
  isLoading: boolean;
  isLoadingBranches: boolean;
  isSubmitting: boolean;
  onAgeBlur: () => void;
  onAgeChange: (value: string) => void;
  onBuyerNameChange: (value: string) => void;
  onBuyerPhoneChange: (value: string) => void;
  onCreateOrder: () => void;
  onMarkPaymentDone: (orderId: string) => void;
  onPreferredDateChange: (value: string) => void;
  onProductPress: (product: HospitalProduct) => void;
  onQueryChange: (value: string) => void;
  onSelectBranch: (branchId: string) => void;
  preferredDate: string;
  query: string;
  referrer: ReferrerRow | null;
  selectedBranchId: string;
  selectedProduct: HospitalProduct | null;
}) {
  return (
    <View style={[styles.workspace, isCompact ? styles.workspaceStack : null]}>
      <View style={styles.productPane}>
        <SectionTitle subtitle={`${filteredProducts.length} รายการ`} title="เลือกแพ็กเกจ" />
        <TextInput
          onChangeText={onQueryChange}
          placeholder="ค้นหาชื่อแพ็กเกจ หมวด หรือ catalog key"
          placeholderTextColor={MiraDesign.color.muted}
          style={styles.input}
          value={query}
        />
        <View style={styles.productGrid}>
          {isLoading ? <Text style={styles.emptyBody}>กำลังโหลดสินค้า...</Text> : null}
          {!isLoading && filteredProducts.length === 0 ? <Text style={styles.emptyBody}>ยังไม่พบสินค้าที่ตรงกับคำค้น</Text> : null}
          {filteredProducts.map((product) => (
            <Pressable
              key={product.id}
              onPress={() => onProductPress(product)}
              style={[styles.productCard, selectedProduct?.id === product.id ? styles.productCardSelected : null]}
            >
              {product.imageUrl ? <Image source={{ uri: product.imageUrl }} style={styles.productImage} /> : <View style={styles.productImageFallback} />}
              <View style={styles.productCopy}>
                <Text numberOfLines={2} style={styles.productTitle}>
                  {product.title}
                </Text>
                <Text style={styles.productMeta}>
                  {product.catalogKey} · {getProductCategoryLabel(product.category)}
                </Text>
                <View style={styles.productBottom}>
                  <Text style={styles.productPrice}>{formatMoney(product.priceAmount)}</Text>
                  <Text style={styles.productCommission}>{commissionLabel(referrer, product)}</Text>
                </View>
              </View>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.checkoutPane}>
        <SectionTitle subtitle={selectedProduct?.title ?? 'เลือกแพ็กเกจก่อน'} title="สร้างออเดอร์ช่วยขาย" />
        <TextInput
          onChangeText={onBuyerNameChange}
          placeholder="ชื่อ-นามสกุลผู้ซื้อ"
          placeholderTextColor={MiraDesign.color.muted}
          style={styles.input}
          value={buyerName}
        />
        <TextInput
          keyboardType="phone-pad"
          onChangeText={onBuyerPhoneChange}
          placeholder="08xxxxxxxx"
          placeholderTextColor={MiraDesign.color.muted}
          style={styles.input}
          value={buyerPhone}
        />
        <View style={styles.fieldStack}>
          <TextInput
            keyboardType="number-pad"
            onBlur={onAgeBlur}
            onChangeText={onAgeChange}
            placeholder="อายุ"
            placeholderTextColor={MiraDesign.color.muted}
            style={[styles.input, ageError ? styles.inputError : null]}
            value={buyerAge}
          />
          {ageError ? <Text style={styles.fieldError}>{ageError}</Text> : null}
        </View>
        <TextInput
          onChangeText={onPreferredDateChange}
          placeholder="วันที่สะดวก YYYY-MM-DD"
          placeholderTextColor={MiraDesign.color.muted}
          style={styles.input}
          value={preferredDate}
        />
        {selectedProduct && (isLoadingBranches || branchChoices.length > 0) ? (
          <View style={styles.branchBlock}>
            <Text style={styles.fieldLabel}>สาขา</Text>
            {isLoadingBranches ? <Text style={styles.branchHint}>กำลังโหลดสาขา...</Text> : null}
            {!isLoadingBranches && branchChoices.length === 1 ? (
              <View style={styles.branchStatic}>
                <Text style={styles.branchStaticName}>{branchChoices[0].name}</Text>
                <Text style={styles.branchHint}>
                  {[branchChoices[0].address, branchChoices[0].district].filter(Boolean).join(' · ') || 'รายละเอียดสาขาจะอัปเดตในระบบ'}
                </Text>
              </View>
            ) : null}
            {!isLoadingBranches && branchChoices.length > 1 ? (
              <View style={styles.branchList}>
                {branchChoices.map((branch, index) => (
                  <BranchOptionRow
                    key={branch.id}
                    branch={branch}
                    disabled={isSubmitting}
                    isSelected={branch.id === selectedBranchId}
                    onPress={() => onSelectBranch(branch.id)}
                    showDivider={index < branchChoices.length - 1}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={styles.estimateBox}>
          <Text style={styles.estimateLabel}>ค่าคอมมิชชันโดยประมาณ</Text>
          <Text style={styles.estimateValue}>{formatMoney(estimatedCommission(referrer, selectedProduct))}</Text>
        </View>
        <Pressable disabled={!canCreateOrder} onPress={onCreateOrder} style={[styles.primaryButton, !canCreateOrder ? styles.disabled : null]}>
          <Text style={styles.primaryButtonText}>{isSubmitting ? 'กำลังสร้าง' : 'สร้าง QR ชำระเงิน'}</Text>
        </Pressable>

        {activeOrder ? (
          <View style={styles.orderStack}>
            <OrderPanel disabled={isSubmitting} onOpenDetails={() => undefined} order={activeOrder} />
            {activeOrder.qr_payload && activeOrder.status === 'awaiting_payment' ? (
              <View style={styles.qrBox}>
                <QRCode size={170} value={activeOrder.qr_payload} />
                <Text style={styles.qrCaption}>PromptPay QR</Text>
              </View>
            ) : null}
            {activeOrder.status === 'awaiting_payment' ? (
              <Pressable disabled={isSubmitting} onPress={() => onMarkPaymentDone(activeOrder.id)} style={[styles.primaryButton, isSubmitting ? styles.disabled : null]}>
                <Text style={styles.primaryButtonText}>{isSubmitting ? 'กำลังส่ง' : 'แจ้งชำระเงินแล้ว'}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ReferralPanel({
  canSelfProvision,
  isProvisioning,
  onCopy,
  onProvision,
  referrer,
  shareLink,
}: {
  canSelfProvision: boolean;
  isProvisioning: boolean;
  onCopy: () => void;
  onProvision: () => void;
  referrer: ReferrerRow | null;
  shareLink: string | null;
}) {
  return (
    <View style={styles.twoColumn}>
      <View style={styles.panel}>
        <SectionTitle subtitle={referrer?.ref_code ?? 'ยังไม่มี code'} title="ลิงก์แชร์จริง" />
        {shareLink ? (
          <>
            <View style={styles.shareQrWrap}>
              <QRCode size={210} value={shareLink} />
            </View>
            <Text selectable style={styles.linkText}>
              {shareLink}
            </Text>
            <Pressable onPress={onCopy} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>คัดลอกลิงก์</Text>
            </Pressable>
          </>
        ) : canSelfProvision ? (
          <View style={styles.selfProvisionBox}>
            <Text style={styles.selfProvisionTitle}>สร้างโค้ดของคุณได้ทันที</Text>
            <Text style={styles.selfProvisionBody}>ไม่ต้องกรอกข้อมูล ระบบจะใช้ชื่อบัญชีของคุณและ commission default ของ tenant</Text>
            <Pressable disabled={isProvisioning} onPress={onProvision} style={[styles.primaryButton, isProvisioning ? styles.disabled : null]}>
              <Text style={styles.primaryButtonText}>{isProvisioning ? 'กำลังสร้าง' : 'สร้าง referral code ของฉัน'}</Text>
            </Pressable>
          </View>
        ) : (
          <EmptyState body="บัญชีนี้ต้องเป็นสมาชิก tenant ก่อนจึงจะสร้าง code ได้" title="ยังสร้างลิงก์ไม่ได้" />
        )}
      </View>
      <View style={styles.panel}>
        <SectionTitle title="ข้อมูล referrer" />
        {referrer ? (
          <View style={styles.detailList}>
            <DetailRow label="ชื่อ" value={referrer.name} />
            <DetailRow label="ประเภท" value={referrer.type} />
            <DetailRow label="เบอร์" value={referrer.phone ?? '-'} />
            <DetailRow label="Commission" value={`${referrer.commission_scheme.mode} · default ${referrer.commission_scheme.default}`} />
          </View>
        ) : (
          <EmptyState body="ให้ tenant admin ผูก auth_user_id กับ referrer profile ก่อนใช้งานจริง" title="ไม่พบ profile" />
        )}
      </View>
    </View>
  );
}

function DashboardPanel({
  commissions,
  referrer,
  selectedProduct,
  totals,
}: {
  commissions: CommissionWithOrder[];
  referrer: ReferrerRow | null;
  selectedProduct: HospitalProduct | null;
  totals: { approved: number; paid: number; pending: number };
}) {
  return (
    <View style={styles.dashboard}>
      <View style={styles.panel}>
        <SectionTitle subtitle={selectedProduct?.title ?? 'เลือกสินค้าในแท็บสินค้า'} title="Commission Preview" />
        <View style={styles.estimateLarge}>
          <Text style={styles.estimateLargeValue}>{formatMoney(estimatedCommission(referrer, selectedProduct))}</Text>
          <Text style={styles.estimateLargeMeta}>{commissionLabel(referrer, selectedProduct)} จากราคาสินค้า {selectedProduct ? formatMoney(selectedProduct.priceAmount) : '-'}</Text>
        </View>
      </View>
      <View style={styles.panel}>
        <SectionTitle subtitle={`${commissions.length} entries`} title="รายการค่าคอมมิชชัน" />
        <View style={styles.summaryStrip}>
          <Metric label="Pending" value={formatMoney(totals.pending)} />
          <Metric label="Approved" value={formatMoney(totals.approved)} />
          <Metric label="Paid" value={formatMoney(totals.paid)} />
        </View>
        {commissions.length === 0 ? (
          <EmptyState body="รายการจะเกิดหลังมี order ที่ถูกยืนยันโดยแอดมิน" title="ยังไม่มี commission" />
        ) : (
          <View style={styles.commissionList}>
            {commissions.map((entry) => {
              const order = fromJoin(entry.orders);
              const product = fromJoin(order?.products);

              return (
                <View key={entry.id} style={styles.commissionRow}>
                  <View style={styles.commissionCopy}>
                    <Text style={styles.commissionTitle}>{product?.name ?? `Order ${entry.order_id.slice(0, 8)}`}</Text>
                    <Text style={styles.commissionMeta}>{new Date(entry.created_at).toLocaleDateString('th-TH')}</Text>
                  </View>
                  <Text style={styles.commissionAmount}>{formatMoney(entry.amount_baht)}</Text>
                  <View style={[styles.statusChip, statusTone(entry.status)]}>
                    <Text style={styles.statusText}>{entry.status}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>
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
      <Text numberOfLines={1} style={styles.metricValue}>
        {value}
      </Text>
    </View>
  );
}

function SectionTitle({ subtitle, title }: { subtitle?: string; title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function EmptyState({ body, title }: { body: string; title: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

const panelBase = {
  backgroundColor: '#FFFFFF',
  borderColor: MiraDesign.color.line,
  borderRadius: 8,
  borderWidth: 1,
  ...softShadow,
} as const;

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#F5F8F7',
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
    flexWrap: 'wrap',
    gap: 16,
    justifyContent: 'space-between',
  },
  titleBlock: {
    flex: 1,
    flexBasis: 320,
    gap: 6,
    minWidth: 0,
  },
  eyebrow: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  title: {
    color: MiraDesign.color.ink,
    fontSize: 31,
    fontWeight: '900',
    lineHeight: 36,
  },
  subtitle: {
    color: MiraDesign.color.inkSoft,
    fontSize: 14,
    lineHeight: 20,
  },
  shareBox: {
    ...panelBase,
    minWidth: 260,
    padding: 12,
  },
  shareLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  shareValue: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
    marginTop: 4,
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
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metric: {
    ...panelBase,
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
    fontSize: 20,
    fontWeight: '900',
    marginTop: 5,
  },
  tabs: {
    backgroundColor: '#E9F3F1',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  tab: {
    alignItems: 'center',
    borderRadius: 7,
    flex: 1,
    justifyContent: 'center',
    minHeight: 42,
  },
  activeTab: {
    backgroundColor: '#FFFFFF',
    ...softShadow,
  },
  tabText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 13,
    fontWeight: '900',
  },
  activeTabText: {
    color: MiraDesign.color.primaryDeep,
  },
  workspace: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 16,
  },
  workspaceStack: {
    flexDirection: 'column',
  },
  productPane: {
    flexBasis: 520,
    flexGrow: 1.2,
    flexShrink: 1,
    gap: 12,
    minWidth: 0,
  },
  checkoutPane: {
    ...panelBase,
    flexBasis: 390,
    flexGrow: 0.8,
    flexShrink: 1,
    gap: 12,
    minWidth: 320,
    padding: 16,
  },
  panel: {
    ...panelBase,
    flex: 1,
    gap: 14,
    minWidth: 300,
    padding: 16,
  },
  sectionHeader: {
    gap: 3,
  },
  sectionTitle: {
    color: MiraDesign.color.ink,
    fontSize: 18,
    fontWeight: '900',
  },
  sectionSubtitle: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '800',
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
  inputError: {
    borderColor: '#C83E3E',
  },
  fieldStack: {
    gap: 5,
  },
  fieldError: {
    color: '#A53434',
    fontSize: 12,
    fontWeight: '800',
  },
  productGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  productCard: {
    ...panelBase,
    flexDirection: 'row',
    gap: 10,
    minWidth: 260,
    padding: 10,
    width: '48%',
  },
  productCardSelected: {
    borderColor: MiraDesign.color.primary,
    borderWidth: 2,
  },
  productImage: {
    backgroundColor: '#EAF3F2',
    borderRadius: 8,
    height: 74,
    width: 74,
  },
  productImageFallback: {
    backgroundColor: '#EAF3F2',
    borderRadius: 8,
    height: 74,
    width: 74,
  },
  productCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  productTitle: {
    color: MiraDesign.color.ink,
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 19,
  },
  productMeta: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '800',
  },
  productBottom: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  productPrice: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 14,
    fontWeight: '900',
  },
  productCommission: {
    color: '#6A4D00',
    fontSize: 12,
    fontWeight: '900',
  },
  branchBlock: {
    gap: 8,
  },
  fieldLabel: {
    color: MiraDesign.color.ink,
    fontSize: 13,
    fontWeight: '900',
  },
  branchHint: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  branchStatic: {
    backgroundColor: '#F7FBFA',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  branchStaticName: {
    color: MiraDesign.color.ink,
    fontSize: 14,
    fontWeight: '900',
  },
  branchList: {
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  estimateBox: {
    backgroundColor: '#F7FBFA',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  estimateLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  estimateValue: {
    color: MiraDesign.color.ink,
    fontSize: 20,
    fontWeight: '900',
    marginTop: 4,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.primary,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  secondaryAction: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 12,
  },
  secondaryActionText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '900',
  },
  disabled: {
    opacity: 0.45,
  },
  orderStack: {
    gap: 10,
  },
  qrBox: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  qrCaption: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '800',
  },
  twoColumn: {
    alignItems: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  shareQrWrap: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
  },
  linkText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 20,
  },
  selfProvisionBox: {
    backgroundColor: '#F7FBFA',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  selfProvisionTitle: {
    color: MiraDesign.color.ink,
    fontSize: 17,
    fontWeight: '900',
  },
  selfProvisionBody: {
    color: MiraDesign.color.inkSoft,
    fontSize: 13,
    lineHeight: 19,
  },
  detailList: {
    gap: 10,
  },
  detailRow: {
    borderBottomColor: MiraDesign.color.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
    paddingBottom: 10,
  },
  detailLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  detailValue: {
    color: MiraDesign.color.ink,
    fontSize: 15,
    fontWeight: '900',
  },
  dashboard: {
    gap: 16,
  },
  estimateLarge: {
    backgroundColor: '#F7FBFA',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 5,
    padding: 16,
  },
  estimateLargeValue: {
    color: MiraDesign.color.ink,
    fontSize: 30,
    fontWeight: '900',
  },
  estimateLargeMeta: {
    color: MiraDesign.color.inkSoft,
    fontSize: 13,
    fontWeight: '800',
  },
  summaryStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  commissionList: {
    gap: 8,
  },
  commissionRow: {
    alignItems: 'center',
    backgroundColor: '#F7FBFA',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    padding: 12,
  },
  commissionCopy: {
    flex: 1,
    gap: 3,
    minWidth: 160,
  },
  commissionTitle: {
    color: MiraDesign.color.ink,
    fontSize: 14,
    fontWeight: '900',
  },
  commissionMeta: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  commissionAmount: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 15,
    fontWeight: '900',
  },
  statusChip: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  statusPaid: {
    backgroundColor: '#DDF2E6',
  },
  statusApproved: {
    backgroundColor: '#E4F0FF',
  },
  statusPending: {
    backgroundColor: '#FFF4D9',
  },
  statusVoid: {
    backgroundColor: '#FDECEC',
  },
  statusText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 10,
    fontWeight: '900',
  },
  emptyState: {
    backgroundColor: '#F7FBFA',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 14,
  },
  emptyTitle: {
    color: MiraDesign.color.ink,
    fontSize: 15,
    fontWeight: '900',
  },
  emptyBody: {
    color: MiraDesign.color.inkSoft,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
  },
});
