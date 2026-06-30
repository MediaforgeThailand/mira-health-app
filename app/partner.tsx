import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'expo-router';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { BranchOptionRow } from '@/components/chat/BranchOptionRow';
import { OrderPanel } from '@/components/chat/OrderPanel';
import { Pill } from '@/components/MiraUI';
import { MiraDesign, softShadow } from '@/constants/Design';
import { invokeFunction } from '@/lib/api/client';
import { useAuthSession, useSignOut } from '@/lib/auth/useAuthSession';
import {
  defaultTenantSlug,
  type BranchSummary,
  loadActiveHospitalProducts,
  type HospitalProduct,
} from '@/lib/marketplace/hospitalProducts';
import { supabase, supabaseConfigStatus } from '@/lib/supabase';
import type {
  CommissionEntryRow,
  OrderPanelBranch,
  OrderPanelState,
  ReferrerOrderBranchesResponse,
  ReferrerOrderRequest,
  ReferrerOrderResponse,
  ReferrerRow,
} from '@/lib/types/api';

type TenantInfo = {
  display_name: string;
  id: string;
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

function fromJoin<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function formatMoney(amount: number) {
  return `${amount.toLocaleString('th-TH')} THB`;
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

export default function PartnerScreen() {
  const auth = useAuthSession();
  const signOut = useSignOut();
  const { width } = useWindowDimensions();
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [referrer, setReferrer] = useState<ReferrerRow | null>(null);
  const [products, setProducts] = useState<HospitalProduct[]>([]);
  const [commissions, setCommissions] = useState<CommissionWithOrder[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<HospitalProduct | null>(null);
  const [buyerName, setBuyerName] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [buyerAge, setBuyerAge] = useState('');
  const [ageError, setAgeError] = useState<string | null>(null);
  const [preferredDate, setPreferredDate] = useState('');
  const [branchChoices, setBranchChoices] = useState<OrderPanelBranch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [activeOrder, setActiveOrder] = useState<OrderPanelState>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const backendReady = supabaseConfigStatus.isConfigured;
  const isCompact = width < 720;
  const buyerAgeNumber = Number(buyerAge.trim());
  const hasValidBuyerAge = Number.isInteger(buyerAgeNumber) && buyerAgeNumber >= 1 && buyerAgeNumber <= 120;
  const selectedBranch = branchChoices.find((branch) => branch.id === selectedBranchId) ?? null;
  const requiresBranchChoice = branchChoices.length > 1;
  const canCreateOrder = Boolean(
    selectedProduct &&
      backendReady &&
      auth.session &&
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

  const loadPartnerData = useCallback(async () => {
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
    setReferrer((referrerRow as ReferrerRow | null) ?? null);
    setProducts(await loadActiveHospitalProducts(40));

    if (referrerRow) {
      const { data: commissionRows, error: commissionError } = await supabase
        .from('commission_entries')
        .select('id,tenant_id,referrer_id,order_id,scheme_snapshot,amount_baht,status,created_at,orders(amount_baht,products(name))')
        .eq('referrer_id', (referrerRow as ReferrerRow).id)
        .order('created_at', { ascending: false })
        .limit(50);

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
        setReferrer(null);
        setProducts([]);
        setCommissions([]);
        setIsLoading(false);
        return;
      }

      try {
        setError(null);
        await loadPartnerData();
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load referrer workspace.');
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
  }, [auth.isLoading, auth.session, auth.user, backendReady, loadPartnerData]);

  async function handleSignOut() {
    try {
      setError(null);
      setMessage(null);
      await signOut();
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : 'ออกจากระบบไม่สำเร็จ');
    }
  }

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

    const product = selectedProduct;

    async function loadBranchesForProduct() {
      try {
        setIsLoadingBranches(true);
        const result = await invokeFunction<ReferrerOrderRequest, ReferrerOrderBranchesResponse>('referrer-order', {
          action: 'list_branches',
          catalog_key: product.catalogKey,
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
      await loadPartnerData();
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : 'ไม่สามารถส่งสถานะชำระเงินได้');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.container, isCompact ? styles.containerCompact : null]} keyboardShouldPersistTaps="handled">
        <View style={[styles.topBar, isCompact ? styles.topBarCompact : null]}>
          <View style={[styles.titleBlock, isCompact ? styles.titleBlockCompact : null]}>
            <Image resizeMode="contain" source={require('@/assets/images/mira-care-logo.png')} style={styles.brandMark} />
            <Text style={styles.eyebrow}>ระบบแนะนำลูกค้า</Text>
            <Text style={styles.title}>หน้าช่วยปิดการขาย</Text>
            <Text style={styles.subtitle}>
              {referrer ? `${referrer.name} · ${referrer.ref_code}` : isLoading ? 'กำลังโหลดสิทธิ์ผู้แนะนำ' : 'ยังไม่มีโปรไฟล์ผู้แนะนำที่เปิดใช้งาน'}
            </Text>
          </View>
          <View style={[styles.shareBox, isCompact ? styles.shareBoxCompact : null]}>
            <Text style={styles.shareLabel}>ลิงก์แชร์</Text>
            <Text selectable style={styles.shareValue}>
              {referrer ? `/r/${referrer.ref_code}` : '-'}
            </Text>
            {auth.session ? (
              <Pressable onPress={() => void handleSignOut()} style={styles.portalAuthButton}>
                <Text style={styles.portalAuthButtonText}>ออกจากระบบ Referral</Text>
              </Pressable>
            ) : (
              <Link href={{ pathname: '/login', params: { mode: 'referral', redirect: '/partner' } }} asChild>
                <Pressable style={styles.portalAuthButton}>
                  <Text style={styles.portalAuthButtonText}>เข้าสู่ระบบ Referral</Text>
                </Pressable>
              </Link>
            )}
          </View>
        </View>

        {error ? <Banner tone="error" text={error} /> : null}
        {message ? <Banner tone="success" text={message} /> : null}
        {!backendReady ? <Banner tone="error" text="ยังไม่ได้เชื่อมต่อ backend สำหรับ Referral Program" /> : null}
        {backendReady && !auth.session ? <Banner tone="error" text="กรุณาเข้าสู่ระบบ Referral ก่อนใช้งาน workspace จริง" /> : null}

        {!referrer && !isLoading ? (
          <View style={styles.noticeInline}>
            <Text style={styles.noticeTitle}>ยังไม่มีผู้แนะนำที่ผูกบัญชีนี้</Text>
            <Text style={styles.noticeBody}>ให้ tenant admin สร้างโปรไฟล์ผู้แนะนำและผูก auth user id กับบัญชีนี้ก่อน</Text>
          </View>
        ) : null}

        <View style={[styles.metrics, isCompact ? styles.metricsCompact : null]}>
          <Metric compact={isCompact} label="รออนุมัติ" value={formatMoney(totals.pending)} />
          <Metric compact={isCompact} label="อนุมัติแล้ว" value={formatMoney(totals.approved)} />
          <Metric compact={isCompact} label="จ่ายแล้ว" value={formatMoney(totals.paid)} />
        </View>

        <View style={styles.workspace}>
          <View style={[styles.productPane, isCompact ? styles.productPaneCompact : null]}>
            <SectionTitle title="สินค้า" subtitle={tenant?.display_name ?? defaultTenantSlug} />
            <View style={styles.productGrid}>
              {products.map((product) => (
                <Pressable
                  key={product.id}
                  onPress={() => {
                    setSelectedProduct(product);
                    setActiveOrder(null);
                    setError(null);
                  }}
                  style={[styles.productCard, isCompact ? styles.productCardCompact : null, selectedProduct?.id === product.id ? styles.productCardSelected : null]}
                >
                  {product.imageUrl ? <Image source={{ uri: product.imageUrl }} style={styles.productImage} /> : <View style={styles.productImageFallback} />}
                  <View style={styles.productCopy}>
                    <Text numberOfLines={2} style={styles.productTitle}>
                      {product.title}
                    </Text>
                    <Text style={styles.productMeta}>{product.catalogKey}</Text>
                    <Text style={styles.productPrice}>{formatMoney(product.priceAmount)}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={[styles.checkoutPane, isCompact ? styles.checkoutPaneCompact : null]}>
            <SectionTitle title="ข้อมูลผู้ซื้อ" subtitle={selectedProduct?.title ?? 'เลือกแพ็กเกจก่อน'} />
            <TextInput
              onChangeText={setBuyerName}
              placeholder="ชื่อ-นามสกุลผู้ซื้อ"
              placeholderTextColor={MiraDesign.color.showcaseNavySoft}
              style={styles.input}
              value={buyerName}
            />
            <TextInput
              keyboardType="phone-pad"
              onChangeText={setBuyerPhone}
              placeholder="08xxxxxxxx"
              placeholderTextColor={MiraDesign.color.showcaseNavySoft}
              style={styles.input}
              value={buyerPhone}
            />
            <View style={styles.fieldStack}>
              <TextInput
                keyboardType="number-pad"
                onBlur={() => setAgeError(buyerAge ? buyerAgeError(buyerAge) : null)}
                onChangeText={(value) => {
                  setBuyerAge(value.replace(/[^\d]/g, '').slice(0, 3));
                  setAgeError(null);
                }}
                placeholder="อายุ"
                placeholderTextColor={MiraDesign.color.showcaseNavySoft}
                style={[styles.input, ageError ? styles.inputError : null]}
                value={buyerAge}
              />
              {ageError ? <Text style={styles.fieldError}>{ageError}</Text> : null}
            </View>
            <TextInput
              onChangeText={setPreferredDate}
              placeholder="วันที่สะดวก YYYY-MM-DD"
              placeholderTextColor={MiraDesign.color.showcaseNavySoft}
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
                        onPress={() => setSelectedBranchId(branch.id)}
                        showDivider={index < branchChoices.length - 1}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
            <Pressable disabled={!canCreateOrder || !referrer} onPress={createOrder} style={[styles.primaryButton, isCompact ? styles.primaryButtonCompact : null, !canCreateOrder || !referrer ? styles.disabled : null]}>
              <Text style={styles.primaryButtonText}>{isSubmitting ? 'กำลังสร้าง' : 'สร้าง QR ชำระเงิน'}</Text>
            </Pressable>

            {activeOrder ? (
              <View style={styles.partnerOrderStack}>
                <OrderPanel disabled={isSubmitting} onOpenDetails={() => undefined} order={activeOrder} />
                {activeOrder.status === 'awaiting_payment' ? (
                  <Pressable disabled={isSubmitting} onPress={() => void markPaymentDone(activeOrder.id)} style={[styles.primaryButton, isCompact ? styles.primaryButtonCompact : null, isSubmitting ? styles.disabled : null]}>
                    <Text style={styles.primaryButtonText}>{isSubmitting ? 'กำลังส่ง' : 'แจ้งชำระเงินแล้ว'}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.earningsPane}>
          <SectionTitle title="ค่าคอมมิชชัน" subtitle={`${commissions.length} รายการ`} />
          {commissions.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>ยังไม่มีค่าคอมมิชชัน</Text>
              <Text style={styles.emptyBody}>รายการจะแสดงหลัง admin ยืนยันออเดอร์ที่มีรหัสแนะนำ</Text>
            </View>
          ) : (
            commissions.map((entry) => {
              const order = fromJoin(entry.orders);
              const product = fromJoin(order?.products);

              return (
                <View key={entry.id} style={styles.commissionRow}>
                  <View style={styles.commissionCopy}>
                    <Text style={styles.commissionTitle}>{product?.name ?? `ออเดอร์ ${entry.order_id.slice(0, 8)}`}</Text>
                    <Text style={styles.commissionMeta}>{new Date(entry.created_at).toLocaleDateString('th-TH')}</Text>
                  </View>
                  <Text style={styles.commissionAmount}>{formatMoney(entry.amount_baht)}</Text>
                  <Pill label={commissionStatusLabel(entry.status)} tone={entry.status === 'paid' ? 'mint' : entry.status === 'void' ? 'danger' : 'amber'} />
                </View>
              );
            })
          )}
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

function Metric({ compact, label, value }: { compact?: boolean; label: string; value: string }) {
  return (
    <View style={[styles.metric, compact ? styles.metricCompact : null]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
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

const styles = StyleSheet.create({
  screen: {
    backgroundColor: MiraDesign.color.showcaseCanvas,
    flex: 1,
  },
  container: {
    gap: 16,
    padding: 22,
    paddingBottom: 54,
  },
  containerCompact: {
    gap: 14,
    padding: 14,
    paddingBottom: 72,
  },
  topBar: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    justifyContent: 'space-between',
  },
  topBarCompact: {
    flexDirection: 'column',
  },
  titleBlock: {
    flexBasis: 320,
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  titleBlockCompact: {
    flexBasis: 'auto',
    width: '100%',
  },
  brandMark: {
    height: 34,
    marginBottom: 4,
    width: 164,
  },
  eyebrow: {
    color: MiraDesign.color.showcaseBlueDeep,
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  title: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 31,
    fontWeight: '900',
    lineHeight: 36,
  },
  subtitle: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 14,
    lineHeight: 20,
  },
  shareBox: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 220,
    padding: 12,
  },
  shareBoxCompact: {
    minWidth: 0,
    width: '100%',
  },
  shareLabel: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  shareValue: {
    color: MiraDesign.color.showcaseBlueDeep,
    fontSize: 15,
    fontWeight: '900',
    marginTop: 4,
  },
  portalAuthButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.showcaseBlue,
    borderRadius: 8,
    justifyContent: 'center',
    marginTop: 10,
    minHeight: 36,
    paddingHorizontal: 12,
  },
  portalAuthButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  notice: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    margin: 22,
    padding: 18,
    ...softShadow,
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
    gap: 8,
  },
  metric: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 150,
    padding: 13,
  },
  metricCompact: {
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
    fontSize: 21,
    fontWeight: '900',
    marginTop: 5,
  },
  workspace: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  productPane: {
    flexBasis: 520,
    flexGrow: 1.2,
    flexShrink: 1,
    gap: 12,
    minWidth: 0,
  },
  productPaneCompact: {
    flexBasis: 'auto',
    width: '100%',
  },
  checkoutPane: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 380,
    flexGrow: 0.8,
    flexShrink: 1,
    gap: 12,
    minWidth: 320,
    padding: 16,
    ...softShadow,
  },
  checkoutPaneCompact: {
    flexBasis: 'auto',
    minWidth: 0,
    padding: 14,
    width: '100%',
  },
  partnerOrderStack: {
    gap: 10,
  },
  sectionHeader: {
    gap: 3,
  },
  sectionTitle: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 18,
    fontWeight: '900',
  },
  sectionSubtitle: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 12,
    fontWeight: '800',
  },
  productGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  productCard: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minWidth: 260,
    padding: 10,
    width: '48%',
  },
  productCardCompact: {
    minWidth: 0,
    width: '100%',
  },
  productCardSelected: {
    borderColor: MiraDesign.color.showcaseBlue,
    borderWidth: 2,
  },
  productImage: {
    backgroundColor: MiraDesign.color.showcaseBlueSoft,
    borderRadius: 8,
    height: 74,
    width: 74,
  },
  productImageFallback: {
    backgroundColor: MiraDesign.color.showcaseBlueSoft,
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
    color: MiraDesign.color.showcaseNavy,
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 19,
  },
  productMeta: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 11,
    fontWeight: '800',
  },
  productPrice: {
    color: MiraDesign.color.showcaseBlueDeep,
    fontSize: 14,
    fontWeight: '900',
  },
  input: {
    backgroundColor: '#F7FBFF',
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    color: MiraDesign.color.showcaseNavy,
    fontSize: 14,
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
  fieldLabel: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 13,
    fontWeight: '900',
  },
  branchBlock: {
    gap: 8,
  },
  branchList: {
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  branchStatic: {
    backgroundColor: MiraDesign.color.showcaseBlueSoft,
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    gap: 3,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  branchStaticName: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 14,
    fontWeight: '800',
  },
  branchHint: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  primaryButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: MiraDesign.color.showcaseBlue,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 16,
  },
  primaryButtonCompact: {
    alignSelf: 'stretch',
    width: '100%',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  earningsPane: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  commissionRow: {
    alignItems: 'center',
    backgroundColor: '#F7FBFF',
    borderColor: MiraDesign.color.showcaseLineSoft,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 10,
  },
  commissionCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  commissionTitle: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 14,
    fontWeight: '900',
  },
  commissionMeta: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 12,
    fontWeight: '700',
  },
  commissionAmount: {
    color: MiraDesign.color.showcaseBlueDeep,
    fontSize: 14,
    fontWeight: '900',
  },
  emptyState: {
    backgroundColor: '#F7FBFF',
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
