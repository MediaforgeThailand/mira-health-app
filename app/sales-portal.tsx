import { Link } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type DimensionValue,
  type ImageSourcePropType,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

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
import { createReferralAppLink, createReferralShareLink, formatPercent } from '@/lib/marketplace/referralMock';
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

const brand = {
  blue: MiraDesign.color.blue,
  blueDeep: MiraDesign.color.primaryDeep,
  blueMid: MiraDesign.color.primary,
  blueSoft: MiraDesign.color.blueSoft,
  canvas: MiraDesign.color.blueSoft,
  line: MiraDesign.color.line,
  mist: MiraDesign.color.surface,
  muted: MiraDesign.color.inkSoft,
  text: MiraDesign.color.ink,
} as const;

const tabs = [
  { id: 'products', label: 'สินค้า' },
  { id: 'referral', label: 'Referral' },
  { id: 'dashboard', label: 'Dashboard' },
] as const;

type SalesTab = (typeof tabs)[number]['id'];

const productPreviewImages = {
  blood: require('@/assets/images/sales-package-blood.png'),
  cancer: require('@/assets/images/sales-package-cancer.png'),
  health: require('@/assets/images/sales-package-health.png'),
  longevity: require('@/assets/images/sales-package-longevity.png'),
} satisfies Record<string, ImageSourcePropType>;

const productPreviewOrder = ['longevity', 'health', 'cancer', 'blood'] as const;

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

type ChartPoint = {
  label: string;
  value: number;
  x: number;
  y: number;
};

function fromJoin<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function formatMoney(value: number) {
  return `${value.toLocaleString('th-TH')} THB`;
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

function productPreviewKey(product: HospitalProduct, index: number): (typeof productPreviewOrder)[number] {
  const text = [product.title, product.catalogKey, product.description, product.category, ...product.tags].join(' ').toLowerCase();

  if (/cancer|มะเร็ง/.test(text)) {
    return 'cancer';
  }

  if (/blood|lab|diabetes|เบาหวาน|เลือด/.test(text)) {
    return 'blood';
  }

  if (/heart|cardio|vaccine|วัคซีน|หัวใจ/.test(text)) {
    return 'health';
  }

  if (/executive|longevity|plus|premium/.test(text)) {
    return 'longevity';
  }

  return productPreviewOrder[index % productPreviewOrder.length];
}

function productImageSource(product: HospitalProduct, index: number): ImageSourcePropType {
  return product.imageUrl ? { uri: product.imageUrl } : productPreviewImages[productPreviewKey(product, index)];
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

function buildTrendRows(commissions: CommissionWithOrder[]) {
  const monthFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'Asia/Bangkok' });
  const now = new Date();
  const rows = Array.from({ length: 7 }, (_, index) => {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - (6 - index), 1);
    const key = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;

    return {
      key,
      label: monthFormatter.format(monthDate),
      value: 0,
    };
  });

  for (const entry of commissions) {
    if (entry.status === 'void') {
      continue;
    }

    const createdAt = new Date(entry.created_at);
    const key = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`;
    const row = rows.find((item) => item.key === key);

    if (row) {
      row.value += entry.amount_baht;
    }
  }

  return rows;
}

async function copyText(value: string) {
  await (globalThis as typeof globalThis & { navigator?: { clipboard?: { writeText: (text: string) => Promise<void> } } }).navigator?.clipboard
    ?.writeText(value)
    .catch(() => undefined);
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
  const backendReady = supabaseConfigStatus.isConfigured;
  const filteredProducts = useMemo(() => products.filter((product) => productMatches(product, query)), [products, query]);
  const selectedProduct = products.find((product) => product.id === selectedProductId) ?? products[0] ?? null;
  const buyerAgeNumber = Number(buyerAge.trim());
  const hasValidBuyerAge = Number.isInteger(buyerAgeNumber) && buyerAgeNumber >= 1 && buyerAgeNumber <= 120;
  const selectedBranch = branchChoices.find((branch) => branch.id === selectedBranchId) ?? null;
  const requiresBranchChoice = branchChoices.length > 1;
  const referralLink = referrer ? createReferralShareLink(referrer.ref_code) : null;
  const appLink = referrer ? createReferralAppLink(referrer.ref_code) : null;
  const isCompact = width < 720;
  const canSelfProvision = Boolean(auth.session && backendReady && tenant && memberRole && !referrer && !isProvisioning);
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

      if (!backendReady || !auth.user) {
        setTenant(null);
        setMemberRole(null);
        setReferrer(null);
        setProducts([]);
        setCommissions([]);
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
  }, [auth.isLoading, auth.session, auth.user, backendReady, loadSalesPortalData]);

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

    if (!selectedProduct || !backendReady || !referrer) {
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
  }, [backendReady, referrer, selectedProduct]);

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

  async function copyReferralCode() {
    if (!referrer) {
      return;
    }

    await copyText(referrer.ref_code);
    setMessage('คัดลอก referral code แล้ว');
  }

  async function copyReferralLink() {
    if (!referralLink) {
      return;
    }

    await copyText(referralLink);
    setMessage('คัดลอกลิงก์ referral แล้ว');
  }

  async function copyAppLink() {
    if (!appLink) {
      return;
    }

    await copyText(appLink);
    setMessage('คัดลอก deep link แล้ว');
  }

  return (
    <PageShell activeTab={activeTab} onTabChange={setActiveTab}>
      <BrandHeader
        subtitle={referrer ? `${referrer.name} · ${referrer.ref_code}` : isLoading ? 'กำลังโหลด referrer profile' : 'ยังไม่มี referrer profile ที่ผูกกับบัญชีนี้'}
      />

      {error ? <Banner tone="error" text={error} /> : null}
      {message ? <Banner tone="success" text={message} /> : null}
      {!backendReady ? <Banner tone="error" text="ยังไม่ได้เชื่อมต่อ backend สำหรับ Referral Program" /> : null}
      {backendReady && !auth.session ? <Banner tone="error" text="กรุณาเข้าสู่ระบบ Referral ก่อนใช้งาน Sales Portal จริง" /> : null}

      {activeTab === 'products' ? (
        <ProductsPanel
          isCompact={isCompact}
          isLoading={isLoading}
          onProductPress={(product) => {
            setSelectedProductId(product.id);
            setActiveOrder(null);
            setError(null);
          }}
          onQueryChange={setQuery}
          products={filteredProducts}
          query={query}
          referrer={referrer}
          selectedProduct={selectedProduct}
        />
      ) : null}

      {activeTab === 'referral' ? (
        <ReferralPanel
          appLink={appLink}
          canSelfProvision={canSelfProvision}
          isProvisioning={isProvisioning}
          onCopyCode={() => void copyReferralCode()}
          onCopyLink={() => void copyReferralLink()}
          onCopyAppLink={() => void copyAppLink()}
          onProvision={() => void provisionReferralCode()}
          referrer={referrer}
          referralLink={referralLink}
        />
      ) : null}

      {activeTab === 'dashboard' ? (
        <DashboardPanel commissions={commissions} referrer={referrer} selectedProduct={selectedProduct} totals={totals} />
      ) : null}
    </PageShell>
  );
}

function PageShell({ activeTab, children, onTabChange }: { activeTab: SalesTab; children: ReactNode; onTabChange: (tab: SalesTab) => void }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.pageContent} keyboardShouldPersistTaps="handled" style={styles.pageScroll}>
        {children}
      </ScrollView>
      <BottomTabs activeTab={activeTab} onTabChange={onTabChange} />
    </SafeAreaView>
  );
}

function BrandHeader({ subtitle }: { subtitle: string }) {
  return (
    <View style={styles.brandHero}>
      <Image resizeMode="contain" source={require('@/assets/images/mira-care-logo.png')} style={styles.brandLogo} />
      <Text style={styles.brandProgramText}>referral program</Text>
      <Text style={styles.brandSubtitle}>{subtitle}</Text>
    </View>
  );
}

function BottomTabs({ activeTab, onTabChange }: { activeTab: SalesTab; onTabChange: (tab: SalesTab) => void }) {
  return (
    <View style={styles.bottomTabShell}>
      <View style={styles.bottomTabBar}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;

          return (
            <Pressable key={tab.id} onPress={() => onTabChange(tab.id)} style={[styles.bottomTabButton, isActive ? styles.bottomTabButtonActive : null]}>
              <View style={[styles.bottomTabDot, isActive ? styles.bottomTabDotActive : null]} />
              <Text style={[styles.bottomTabText, isActive ? styles.bottomTabTextActive : null]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ProductsPanel({
  isCompact,
  isLoading,
  onProductPress,
  onQueryChange,
  products,
  query,
  referrer,
  selectedProduct,
}: {
  isCompact: boolean;
  isLoading: boolean;
  onProductPress: (product: HospitalProduct) => void;
  onQueryChange: (value: string) => void;
  products: HospitalProduct[];
  query: string;
  referrer: ReferrerRow | null;
  selectedProduct: HospitalProduct | null;
}) {
  const cardWidth = (isCompact ? '48%' : 220) as DimensionValue;

  return (
    <View style={styles.panel}>
      <View style={styles.searchRow}>
        <TextInput
          onChangeText={onQueryChange}
          placeholder="ค้นหาสินค้า โรงพยาบาล หรือหมวดหมู่"
          placeholderTextColor={brand.muted}
          style={styles.searchInput}
          value={query}
        />
        <Text style={styles.resultCount}>{products.length} items</Text>
      </View>

      <View style={styles.productGrid}>
        {isLoading ? <Text style={styles.emptyBody}>กำลังโหลดสินค้า...</Text> : null}
        {!isLoading && products.length === 0 ? <Text style={styles.emptyBody}>ยังไม่พบสินค้าที่ตรงกับคำค้น</Text> : null}
        {products.map((product, index) => (
          <Pressable
            key={`${product.id}-${product.catalogKey}-${index}`}
            onPress={() => onProductPress(product)}
            style={[styles.productCard, { width: cardWidth }, selectedProduct?.id === product.id ? styles.productCardSelected : null]}
          >
            <View style={styles.productImageWrap}>
              <Image resizeMode="contain" source={productImageSource(product, index)} style={styles.productImage} />
            </View>
            <View style={styles.productCardBody}>
              <Text numberOfLines={2} style={styles.productTitle}>{product.title}</Text>
              <Text style={styles.productMeta}>{getProductCategoryLabel(product.category)}</Text>
              <Text style={styles.productPrice}>{formatMoney(product.priceAmount)}</Text>
              <Text style={styles.productCommission}>{commissionLabel(referrer, product)}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function ReferralPanel({
  appLink,
  canSelfProvision,
  isProvisioning,
  onCopyAppLink,
  onCopyCode,
  onCopyLink,
  onProvision,
  referrer,
  referralLink,
}: {
  appLink: string | null;
  canSelfProvision: boolean;
  isProvisioning: boolean;
  onCopyAppLink: () => void;
  onCopyCode: () => void;
  onCopyLink: () => void;
  onProvision: () => void;
  referrer: ReferrerRow | null;
  referralLink: string | null;
}) {
  return (
    <View style={styles.panel}>
      <View style={styles.card}>
        <Text style={styles.panelTitle}>Referral link ของคุณ</Text>
        <Text style={styles.panelBody}>ส่งลิงก์นี้ให้ลูกค้า QR และ copy link ใช้ ref_code จริงของบัญชีที่ล็อกอินอยู่</Text>

        {referrer && referralLink ? (
          <>
            <View style={styles.qrBox}>
              <QRCode backgroundColor="#FFFFFF" color={brand.blueDeep} quietZone={10} size={210} value={referralLink} />
            </View>

            <View style={styles.codeBox}>
              <Text style={styles.codeLabel}>Referral code</Text>
              <Text style={styles.codeText}>{referrer.ref_code}</Text>
              <Text numberOfLines={2} style={styles.linkText}>{referralLink}</Text>
            </View>

            <View style={styles.actionRow}>
              <Pressable onPress={onCopyCode} style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>Copy code</Text>
              </Pressable>
              <Pressable onPress={onCopyLink} style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>Copy link</Text>
              </Pressable>
            </View>
          </>
        ) : canSelfProvision ? (
          <View style={styles.selfProvisionBox}>
            <Text style={styles.selfProvisionTitle}>สร้าง referral code ของฉัน</Text>
            <Text style={styles.panelBody}>บัญชีนี้เป็นสมาชิกของ tenant แล้ว กดครั้งเดียวเพื่อสร้าง code จริงได้เลย</Text>
            <Pressable disabled={isProvisioning} onPress={onProvision} style={[styles.primaryAction, isProvisioning ? styles.disabled : null]}>
              <Text style={styles.primaryActionText}>{isProvisioning ? 'กำลังสร้าง' : 'สร้าง referral code ของฉัน'}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.selfProvisionBox}>
            <Text style={styles.selfProvisionTitle}>ยังไม่มี referrer profile</Text>
            <Text style={styles.panelBody}>ให้ tenant admin เพิ่มบัญชีนี้เป็นสมาชิกหรือเปิด referrer profile ก่อน</Text>
            <Link href="/admin/referrers" asChild>
              <Pressable style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>เปิดหน้า Referrers Admin</Text>
              </Pressable>
            </Link>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.panelTitle}>Customer flow</Text>
        {[
          'ลูกค้ากด referral link หรือสแกน QR',
          'ระบบเปิด /r/<CODE> และบันทึก attribution',
          'ถ้ามี app แล้วใช้ deep link เข้าสู่ MiraCare',
          'เมื่อลูกค้าซื้อสินค้า commission จะเข้าบัญชีนี้',
        ].map((step, index) => (
          <View key={step} style={styles.flowStep}>
            <Text style={styles.flowNumber}>{index + 1}</Text>
            <Text style={styles.flowText}>{step}</Text>
          </View>
        ))}

        <View style={styles.deepLinkBox}>
          <Text style={styles.deepLinkLabel}>App deep link</Text>
          <Text selectable numberOfLines={2} style={styles.deepLinkText}>{appLink ?? 'ยังไม่มี deep link'}</Text>
        </View>
        {appLink ? (
          <View style={styles.actionRow}>
            <Pressable onPress={() => void Linking.openURL(appLink)} style={styles.secondaryAction}>
              <Text style={styles.secondaryActionText}>เปิดในแอป</Text>
            </Pressable>
            <Pressable onPress={onCopyAppLink} style={styles.secondaryAction}>
              <Text style={styles.secondaryActionText}>Copy deep link</Text>
            </Pressable>
          </View>
        ) : null}
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
  const areaRows = buildTrendRows(commissions);
  const chartWidth = 320;
  const chartHeight = 218;
  const chartLeft = 38;
  const chartRight = 304;
  const chartTop = 20;
  const chartBottom = 166;
  const minValue = Math.min(...areaRows.map((row) => row.value), 0);
  const maxValue = Math.max(...areaRows.map((row) => row.value), 1);
  const valueRange = Math.max(maxValue - minValue, 1);
  const chartPoints: ChartPoint[] = areaRows.map((row, index) => {
    const x = chartLeft + index * ((chartRight - chartLeft) / Math.max(areaRows.length - 1, 1));
    const y = chartTop + (1 - (row.value - minValue) / valueRange) * (chartBottom - chartTop);

    return { ...row, x, y };
  });
  const chartPath = chartPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const chartFillPath = `${chartPath} L ${chartPoints[chartPoints.length - 1].x} ${chartBottom} L ${chartPoints[0].x} ${chartBottom} Z`;
  const gridRows = [
    { label: formatMoney(maxValue).replace(' THB', ''), y: chartTop },
    { label: formatMoney(Math.round(maxValue / 2)).replace(' THB', ''), y: chartTop + (chartBottom - chartTop) / 2 },
    { label: '0', y: chartBottom },
  ];
  const totalCommission = totals.pending + totals.approved + totals.paid;
  const conversionBase = commissions.filter((entry) => entry.status !== 'void').length;
  const paidCount = commissions.filter((entry) => entry.status === 'paid').length;
  const conversion = conversionBase ? Math.round((paidCount / conversionBase) * 100) : 0;

  return (
    <View style={styles.panel}>
      <View style={styles.statsGrid}>
        {[
          [formatMoney(totalCommission), 'ยอด commission ทั้งหมด'],
          [String(commissions.length), 'รายการ commission'],
          [formatMoney(totals.pending), 'รอ payout'],
          [`${conversion}%`, 'Paid conversion'],
        ].map(([value, label]) => (
          <View key={label} style={styles.statCard}>
            <Text style={styles.statValue}>{value}</Text>
            <Text style={styles.statLabel}>{label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <View style={styles.chartHeader}>
          <View>
            <Text style={styles.panelTitle}>Commission trend</Text>
            <Text style={styles.panelBody}>ยอดค่าคอมมิชชันจริงจาก commission_entries</Text>
          </View>
          <Text style={styles.chartTotal}>{formatMoney(totalCommission)}</Text>
        </View>

        <View style={styles.areaChartCard}>
          <Svg height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`} width="100%">
            <Defs>
              <LinearGradient id="commissionAreaFill" x1="0" x2="0" y1="0" y2="1">
                <Stop offset="0" stopColor={brand.blueMid} stopOpacity={0.62} />
                <Stop offset="1" stopColor={brand.blueMid} stopOpacity={0.28} />
              </LinearGradient>
            </Defs>
            <SvgText fill={brand.blueDeep} fontSize={11} fontWeight="900" textAnchor="start" x={chartLeft} y={12}>
              COMMISSION
            </SvgText>
            {gridRows.map((row) => (
              <G key={row.label}>
                <SvgText fill={brand.muted} fontSize={9} fontWeight="700" textAnchor="end" x={chartLeft - 8} y={row.y + 3}>
                  {row.label}
                </SvgText>
                <Line stroke={brand.line} strokeWidth={1} x1={chartLeft} x2={chartRight} y1={row.y} y2={row.y} />
              </G>
            ))}
            <Line stroke={brand.line} strokeWidth={1} x1={chartLeft} x2={chartLeft} y1={chartTop} y2={chartBottom} />
            <Line stroke={brand.line} strokeWidth={1.4} x1={chartLeft} x2={chartRight} y1={chartBottom} y2={chartBottom} />
            <Path d={chartFillPath} fill="url(#commissionAreaFill)" />
            <Path d={chartPath} fill="none" stroke={brand.blueMid} strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} />
            {chartPoints.map((point) => (
              <Circle cx={point.x} cy={point.y} fill="#FFFFFF" key={`area-dot-${point.label}`} r={3.6} stroke={brand.blueMid} strokeWidth={2.4} />
            ))}
            {chartPoints.map((point) => (
              <SvgText fill={brand.muted} fontSize={8.5} fontWeight="800" key={`area-label-${point.label}`} textAnchor="middle" x={point.x} y={chartBottom + 18}>
                {point.label}
              </SvgText>
            ))}
          </Svg>
        </View>

        <View style={styles.chartLegendRow}>
          <Text style={styles.chartLegendText}>{areaRows[0].label} {formatMoney(areaRows[0].value)}</Text>
          <Text style={styles.chartLegendText}>{areaRows[areaRows.length - 1].label} {formatMoney(areaRows[areaRows.length - 1].value)}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.chartHeader}>
          <View>
            <Text style={styles.panelTitle}>Commission status</Text>
            <Text style={styles.panelBody}>สถานะจริงจากรายการ commission_entries</Text>
          </View>
          <Text style={styles.chartTotal}>{commissions.length}</Text>
        </View>
        {[
          ['pending', commissions.filter((entry) => entry.status === 'pending').length],
          ['approved', commissions.filter((entry) => entry.status === 'approved').length],
          ['paid', paidCount],
        ].map(([label, value]) => {
          const width = `${Math.max(10, Math.round((Number(value) / Math.max(conversionBase, 1)) * 100))}%` as DimensionValue;

          return (
            <View key={label} style={styles.funnelRow}>
              <View style={styles.funnelCopy}>
                <Text style={styles.funnelLabel}>{label}</Text>
                <Text style={styles.funnelValue}>{value}</Text>
              </View>
              <View style={styles.funnelTrack}>
                <View style={[styles.funnelFill, { width }]} />
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.card}>
        <Text style={styles.panelTitle}>Selected product estimate</Text>
        <Text style={styles.panelBody}>
          {selectedProduct
            ? `${selectedProduct.title} จะได้ commission ประมาณ ${formatMoney(estimatedCommission(referrer, selectedProduct))} ต่อ order`
            : 'เลือกสินค้าจาก tab สินค้า เพื่อดู commission estimate รายสินค้า'}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.panelTitle}>รายการล่าสุด</Text>
        {commissions.length === 0 ? (
          <Text style={styles.panelBody}>รายการจะเกิดหลังมี order ที่ถูกยืนยันโดยแอดมิน</Text>
        ) : (
          <View style={styles.commissionList}>
            {commissions.slice(0, 8).map((entry) => {
              const order = fromJoin(entry.orders);
              const product = fromJoin(order?.products);

              return (
                <View key={entry.id} style={styles.commissionRow}>
                  <View style={styles.commissionCopy}>
                    <Text numberOfLines={1} style={styles.commissionTitle}>{product?.name ?? `Order ${entry.order_id.slice(0, 8)}`}</Text>
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

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: brand.canvas,
    flex: 1,
  },
  pageScroll: {
    flex: 1,
  },
  pageContent: {
    alignSelf: 'center',
    gap: 12,
    maxWidth: 1180,
    padding: 16,
    paddingBottom: 86,
    width: '100%',
  },
  brandHero: {
    alignItems: 'center',
    backgroundColor: brand.blueSoft,
    borderColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    justifyContent: 'center',
    minHeight: 118,
    overflow: 'hidden',
    paddingHorizontal: 18,
    paddingVertical: 18,
    ...softShadow,
  },
  brandLogo: {
    height: 58,
    maxWidth: 280,
    width: '84%',
  },
  brandProgramText: {
    color: brand.blueDeep,
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'lowercase',
  },
  brandSubtitle: {
    color: brand.muted,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
    textAlign: 'center',
  },
  panel: {
    gap: 10,
  },
  card: {
    backgroundColor: brand.mist,
    borderColor: brand.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  panelTitle: {
    color: brand.text,
    fontSize: 17,
    fontWeight: '900',
  },
  panelBody: {
    color: brand.muted,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 18,
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
    color: brand.text,
    fontSize: 17,
    fontWeight: '900',
  },
  noticeBody: {
    color: brand.muted,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 19,
  },
  searchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  searchInput: {
    backgroundColor: '#FFFFFF',
    borderColor: brand.line,
    borderRadius: 8,
    borderWidth: 1,
    color: brand.text,
    flex: 1,
    fontSize: 13,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  formInput: {
    backgroundColor: '#FFFFFF',
    borderColor: brand.line,
    borderRadius: 8,
    borderWidth: 1,
    color: brand.text,
    fontSize: 13,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  inputError: {
    borderColor: MiraDesign.color.danger,
  },
  fieldStack: {
    gap: 5,
  },
  fieldError: {
    color: MiraDesign.color.danger,
    fontSize: 12,
    fontWeight: '800',
  },
  resultCount: {
    color: brand.blue,
    fontSize: 12,
    fontWeight: '900',
  },
  productGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  productCard: {
    backgroundColor: '#FFFFFF',
    borderColor: brand.line,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  productCardSelected: {
    borderColor: brand.blue,
    borderWidth: 2,
  },
  productImageWrap: {
    backgroundColor: '#FFFFFF',
    height: 154,
  },
  productImage: {
    height: '100%',
    width: '100%',
  },
  productImageFallback: {
    alignItems: 'center',
    backgroundColor: brand.blueSoft,
    height: '100%',
    justifyContent: 'center',
    padding: 8,
    width: '100%',
  },
  productImageFallbackText: {
    color: brand.blueDeep,
    fontSize: 11,
    fontWeight: '900',
    textAlign: 'center',
  },
  productCardBody: {
    gap: 5,
    padding: 9,
  },
  productTitle: {
    color: brand.text,
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 17,
  },
  productMeta: {
    color: brand.muted,
    fontSize: 10,
    fontWeight: '800',
  },
  productPrice: {
    color: brand.text,
    fontSize: 12,
    fontWeight: '900',
  },
  productCommission: {
    color: '#6A4D00',
    fontSize: 11,
    fontWeight: '900',
  },
  branchBlock: {
    gap: 8,
  },
  fieldLabel: {
    color: brand.text,
    fontSize: 13,
    fontWeight: '900',
  },
  branchHint: {
    color: brand.muted,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  branchStatic: {
    backgroundColor: '#FFFFFF',
    borderColor: brand.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 10,
  },
  branchStaticName: {
    color: brand.text,
    fontSize: 13,
    fontWeight: '900',
  },
  branchList: {
    backgroundColor: '#FFFFFF',
    borderColor: brand.line,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  estimateBox: {
    backgroundColor: '#FFFFFF',
    borderColor: brand.blueSoft,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 11,
  },
  estimateValue: {
    color: brand.blueDeep,
    fontSize: 20,
    fontWeight: '900',
  },
  primaryAction: {
    alignItems: 'center',
    backgroundColor: brand.blue,
    borderRadius: 8,
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  disabled: {
    opacity: 0.45,
  },
  orderStack: {
    gap: 10,
  },
  qrCaption: {
    color: brand.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  qrBox: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: brand.line,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    padding: 14,
  },
  codeBox: {
    backgroundColor: '#FFFFFF',
    borderColor: brand.blueSoft,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 11,
  },
  codeLabel: {
    color: brand.blue,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  codeText: {
    color: brand.blueDeep,
    fontSize: 22,
    fontWeight: '900',
  },
  linkText: {
    color: brand.blue,
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 16,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  secondaryAction: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: brand.line,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  secondaryActionText: {
    color: brand.blue,
    fontSize: 12,
    fontWeight: '900',
  },
  selfProvisionBox: {
    gap: 10,
  },
  selfProvisionTitle: {
    color: brand.text,
    fontSize: 15,
    fontWeight: '900',
  },
  flowStep: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  flowNumber: {
    backgroundColor: brand.blueSoft,
    borderRadius: 999,
    color: brand.blue,
    fontSize: 11,
    fontWeight: '900',
    height: 24,
    lineHeight: 24,
    textAlign: 'center',
    width: 24,
  },
  flowText: {
    color: brand.text,
    flex: 1,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
  },
  deepLinkBox: {
    backgroundColor: '#FFFFFF',
    borderColor: brand.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 10,
  },
  deepLinkLabel: {
    color: brand.muted,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  deepLinkText: {
    color: brand.text,
    fontSize: 12,
    fontWeight: '800',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statCard: {
    backgroundColor: brand.mist,
    borderColor: brand.line,
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    width: '48%',
  },
  statValue: {
    color: brand.blueDeep,
    fontSize: 18,
    fontWeight: '900',
  },
  statLabel: {
    color: brand.muted,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 4,
  },
  chartHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  chartTotal: {
    color: brand.blue,
    fontSize: 14,
    fontWeight: '900',
  },
  areaChartCard: {
    backgroundColor: '#FFFFFF',
    borderColor: brand.line,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 8,
  },
  chartLegendRow: {
    borderTopColor: brand.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  chartLegendText: {
    color: brand.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  funnelRow: {
    gap: 7,
  },
  funnelCopy: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  funnelLabel: {
    color: brand.text,
    fontSize: 12,
    fontWeight: '900',
  },
  funnelValue: {
    color: brand.blue,
    fontSize: 12,
    fontWeight: '900',
  },
  funnelTrack: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    height: 10,
    overflow: 'hidden',
  },
  funnelFill: {
    backgroundColor: brand.blueMid,
    borderRadius: 999,
    height: '100%',
  },
  commissionList: {
    gap: 8,
  },
  commissionRow: {
    alignItems: 'center',
    borderBottomColor: brand.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 8,
  },
  commissionCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  commissionTitle: {
    color: brand.text,
    fontSize: 12,
    fontWeight: '900',
  },
  commissionMeta: {
    color: brand.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  commissionAmount: {
    color: brand.blue,
    fontSize: 12,
    fontWeight: '900',
  },
  statusChip: {
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  statusText: {
    color: brand.text,
    fontSize: 10,
    fontWeight: '900',
  },
  statusPaid: {
    backgroundColor: '#DFF8EC',
  },
  statusApproved: {
    backgroundColor: '#E5F0FF',
  },
  statusPending: {
    backgroundColor: '#FFF4D6',
  },
  statusVoid: {
    backgroundColor: '#F6DCDC',
  },
  emptyBody: {
    color: brand.muted,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 18,
  },
  bottomTabShell: {
    alignItems: 'center',
    backgroundColor: brand.canvas,
    borderTopColor: brand.line,
    borderTopWidth: 1,
    paddingBottom: 10,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  bottomTabBar: {
    backgroundColor: '#FFFFFF',
    borderColor: brand.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    maxWidth: 560,
    padding: 5,
    width: '100%',
    ...softShadow,
  },
  bottomTabButton: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    gap: 4,
    minHeight: 48,
    justifyContent: 'center',
  },
  bottomTabButtonActive: {
    backgroundColor: brand.blueSoft,
  },
  bottomTabDot: {
    backgroundColor: MiraDesign.color.muted,
    borderRadius: 999,
    height: 5,
    width: 18,
  },
  bottomTabDotActive: {
    backgroundColor: brand.blue,
  },
  bottomTabText: {
    color: brand.muted,
    fontSize: 11,
    fontWeight: '900',
  },
  bottomTabTextActive: {
    color: brand.blue,
  },
});
