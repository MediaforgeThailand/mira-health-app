import { Link } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { Pill } from '@/components/MiraUI';
import { MiraDesign, softShadow } from '@/constants/Design';
import { useAuthSession } from '@/lib/auth/useAuthSession';
import {
  defaultTenantSlug,
  loadBranches,
  loadManagedHospitalProducts,
  loadTenantMemberContext,
  type BranchSummary,
  type HospitalProduct,
  type TenantMemberContext,
} from '@/lib/marketplace/hospitalProducts';
import { supabase, supabaseConfigStatus } from '@/lib/supabase';
import type { CommissionEntryRow, OrderRow, ReferrerRow } from '@/lib/types/api';

type DashboardProductJoin = {
  catalog_key: string;
  category: string;
  name: string;
  price_baht: number;
};

type DashboardBranchJoin = {
  name: string;
};

type DashboardCustomerJoin = {
  nickname: string | null;
  phone: string | null;
};

type DashboardReferrerJoin = {
  name: string;
  ref_code: string;
};

type DashboardOrder = OrderRow & {
  branches?: DashboardBranchJoin | DashboardBranchJoin[] | null;
  customers?: DashboardCustomerJoin | DashboardCustomerJoin[] | null;
  products?: DashboardProductJoin | DashboardProductJoin[] | null;
  referrers?: DashboardReferrerJoin | DashboardReferrerJoin[] | null;
};

type ChartPoint = {
  key: string;
  label: string;
  orders: number;
  revenue: number;
};

const paidStatuses = new Set<OrderRow['status']>(['submitted', 'confirmed', 'booked', 'done']);
const activeQueueStatuses = new Set<OrderRow['status']>(['submitted', 'confirmed', 'booked']);

function fromJoin<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function formatMoney(amount: number) {
  return `${amount.toLocaleString('th-TH')} THB`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('th-TH', {
    day: '2-digit',
    month: 'short',
  });
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function subtractDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() - days);
  return next;
}

function latestOrderDate(orders: DashboardOrder[]) {
  const latest = orders.reduce<Date | null>((current, order) => {
    const created = new Date(order.created_at);

    if (Number.isNaN(created.getTime())) {
      return current;
    }

    return !current || created > current ? created : current;
  }, null);

  return latest ?? new Date();
}

function buildWeeklySeries(orders: DashboardOrder[]): ChartPoint[] {
  const end = startOfDay(latestOrderDate(orders));
  const points = Array.from({ length: 7 }, (_, index) => {
    const date = subtractDays(end, 6 - index);

    return {
      key: dayKey(date),
      label: date.toLocaleDateString('th-TH', { weekday: 'short' }),
      orders: 0,
      revenue: 0,
    };
  });
  const pointByKey = new Map(points.map((point) => [point.key, point]));

  for (const order of orders) {
    const point = pointByKey.get(dayKey(new Date(order.created_at)));

    if (!point) {
      continue;
    }

    point.orders += 1;

    if (paidStatuses.has(order.status)) {
      point.revenue += order.amount_baht;
    }
  }

  return points;
}

function topProductLabel(orders: DashboardOrder[], products: HospitalProduct[]) {
  const counts = new Map<string, { count: number; name: string; revenue: number }>();

  for (const order of orders) {
    if (!paidStatuses.has(order.status)) {
      continue;
    }

    const product = fromJoin(order.products);
    const productId = order.product_id;
    const current = counts.get(productId) ?? {
      count: 0,
      name: product?.name ?? products.find((item) => item.id === productId)?.title ?? productId,
      revenue: 0,
    };

    current.count += order.qty || 1;
    current.revenue += order.amount_baht;
    counts.set(productId, current);
  }

  return [...counts.values()].sort((left, right) => right.count - left.count || right.revenue - left.revenue)[0] ?? null;
}

function orderStatusTone(status: OrderRow['status']): 'amber' | 'blue' | 'danger' | 'mint' {
  if (status === 'cancelled') {
    return 'danger';
  }

  if (status === 'done' || status === 'booked') {
    return 'mint';
  }

  if (status === 'submitted' || status === 'confirmed') {
    return 'amber';
  }

  return 'blue';
}

export default function AdminDashboardScreen() {
  const auth = useAuthSession();
  const { width } = useWindowDimensions();
  const isWide = width >= 1080;
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [commissions, setCommissions] = useState<CommissionEntryRow[]>([]);
  const [orders, setOrders] = useState<DashboardOrder[]>([]);
  const [products, setProducts] = useState<HospitalProduct[]>([]);
  const [referrers, setReferrers] = useState<ReferrerRow[]>([]);
  const [tenantContext, setTenantContext] = useState<TenantMemberContext | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const backendReady = supabaseConfigStatus.isConfigured;

  const loadDashboard = useCallback(async () => {
    if (auth.isLoading) {
      return false;
    }

    if (!backendReady || !auth.user) {
      setTenantContext(null);
      setProducts([]);
      setBranches([]);
      setOrders([]);
      setReferrers([]);
      setCommissions([]);
      return false;
    }

    const context = await loadTenantMemberContext();

    if (!context) {
      setTenantContext(null);
      setProducts([]);
      setBranches([]);
      setOrders([]);
      setReferrers([]);
      setCommissions([]);
      setError(`บัญชีนี้ยังไม่ได้เชื่อมกับ tenant "${defaultTenantSlug}"`);
      return false;
    }

    setTenantContext(context);

    const [productRows, branchRows, orderResult, referrerResult, commissionResult] = await Promise.all([
      loadManagedHospitalProducts(120),
      loadBranches(),
      supabase
        .from('orders')
        .select(
          [
            'id',
            'tenant_id',
            'customer_id',
            'session_id',
            'product_id',
            'qty',
            'amount_baht',
            'buyer_name',
            'buyer_phone',
            'preferred_branch',
            'preferred_date',
            'preferred_date_end',
            'preferred_time_window',
            'channel',
            'referrer_id',
            'commission_scheme_snapshot',
            'status',
            'slip_url',
            'booking_at',
            'branch_id',
            'buyer_age',
            'admin_note',
            'payment_provider',
            'stripe_checkout_session_id',
            'stripe_payment_intent_id',
            'stripe_payment_status',
            'paid_at',
            'created_at',
            'updated_at',
            'products(name,catalog_key,category,price_baht)',
            'branches(name)',
            'customers(nickname,phone)',
            'referrers(name,ref_code)',
          ].join(','),
        )
        .eq('tenant_id', context.id)
        .order('created_at', { ascending: false })
        .limit(150),
      supabase
        .from('referrers')
        .select('id,tenant_id,ref_code,name,type,phone,auth_user_id,commission_scheme,active,created_at')
        .eq('tenant_id', context.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('commission_entries')
        .select('id,tenant_id,referrer_id,order_id,scheme_snapshot,amount_baht,status,created_at')
        .eq('tenant_id', context.id)
        .order('created_at', { ascending: false })
        .limit(150),
    ]);

    if (orderResult.error) {
      throw new Error(orderResult.error.message);
    }

    if (referrerResult.error) {
      throw new Error(referrerResult.error.message);
    }

    if (commissionResult.error) {
      throw new Error(commissionResult.error.message);
    }

    setProducts(productRows);
    setBranches(branchRows);
    setOrders((orderResult.data ?? []) as unknown as DashboardOrder[]);
    setReferrers((referrerResult.data ?? []) as unknown as ReferrerRow[]);
    setCommissions((commissionResult.data ?? []) as unknown as CommissionEntryRow[]);
    return true;
  }, [auth.isLoading, auth.user, backendReady]);

  useEffect(() => {
    let isMounted = true;

    async function boot() {
      try {
        setError(null);
        setMessage(null);
        await loadDashboard();
      } catch (loadError) {
        if (isMounted) {
          const reason = loadError instanceof Error ? loadError.message : 'โหลด dashboard จาก backend ไม่สำเร็จ';
          setTenantContext(null);
          setProducts([]);
          setBranches([]);
          setOrders([]);
          setReferrers([]);
          setCommissions([]);
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
  }, [loadDashboard]);

  async function refreshDashboard() {
    try {
      setIsLoading(true);
      setError(null);
      setMessage(null);
      const loadedData = await loadDashboard();
      setMessage(loadedData ? 'รีเฟรชข้อมูลหลังบ้านแล้ว' : 'ยังไม่มีข้อมูลจริงให้แสดงในสถานะปัจจุบัน');
    } catch (refreshError) {
      const reason = refreshError instanceof Error ? refreshError.message : 'รีเฟรช dashboard ไม่สำเร็จ';
      setTenantContext(null);
      setProducts([]);
      setBranches([]);
      setOrders([]);
      setReferrers([]);
      setCommissions([]);
      setError(reason);
    } finally {
      setIsLoading(false);
    }
  }

  const weeklySeries = useMemo(() => buildWeeklySeries(orders), [orders]);
  const maxWeeklyOrders = Math.max(1, ...weeklySeries.map((point) => point.orders));
  const topProduct = useMemo(() => topProductLabel(orders, products), [orders, products]);
  const stats = useMemo(() => {
    const reference = startOfDay(latestOrderDate(orders));
    const last30Start = subtractDays(reference, 29);
    const orders30 = orders.filter((order) => new Date(order.created_at) >= last30Start);
    const paidOrders30 = orders30.filter((order) => paidStatuses.has(order.status));
    const activeProducts = products.filter((product) => product.status === 'active').length;
    const ragReady = products.filter((product) => product.ragEmbeddingStatus === 'embedded').length;
    const pendingCommission = commissions
      .filter((entry) => entry.status === 'pending')
      .reduce((sum, entry) => sum + entry.amount_baht, 0);

    return {
      activeBranches: branches.filter((branch) => branch.active).length,
      activeProducts,
      activeQueue: orders.filter((order) => activeQueueStatuses.has(order.status)).length,
      paidRevenue30: paidOrders30.reduce((sum, order) => sum + order.amount_baht, 0),
      pendingCommission,
      ragReady,
      referrersActive: referrers.filter((referrer) => referrer.active).length,
      totalOrders30: orders30.length,
      totalProducts: products.length,
    };
  }, [branches, commissions, orders, products, referrers]);
  const recentOrders = orders.slice(0, 6);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={[styles.topBar, !isWide ? styles.topBarStack : null]}>
          <View style={styles.titleGroup}>
            <Text style={styles.eyebrow}>Admin Live Dashboard</Text>
            <Text style={styles.title}>ภาพรวมหลังบ้าน</Text>
            <Text style={styles.subtitle}>
              {tenantContext ? `${tenantContext.display_name} · ${tenantContext.role}` : defaultTenantSlug}
              {' · '}ข้อมูลจาก backend เดียวกับ catalog, orders, branches และ referral
            </Text>
          </View>
          <View style={styles.topActions}>
            <Pill label={backendReady ? 'เชื่อมต่อระบบจริง' : 'ยังไม่เชื่อม backend'} tone={backendReady ? 'mint' : 'amber'} />
            <Pressable disabled={isLoading} onPress={() => void refreshDashboard()} style={[styles.secondaryButton, isLoading ? styles.disabled : null]}>
              <Text style={styles.secondaryButtonText}>{isLoading ? 'กำลังโหลด' : 'รีเฟรช'}</Text>
            </Pressable>
          </View>
        </View>

        {!backendReady ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>ยังไม่ได้เชื่อมต่อ backend</Text>
            <Text style={styles.noticeBody}>ตั้งค่า Supabase ก่อน หน้านี้จึงจะแสดงภาพรวม order, catalog, branches และ referral จริงได้</Text>
          </View>
        ) : null}

        {backendReady && !auth.session ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>กรุณาเข้าสู่ระบบ</Text>
            <Text style={styles.noticeBody}>ต้องเข้าสู่ระบบด้วยบัญชี tenant admin/staff ก่อนจึงจะเห็น dashboard จริง</Text>
          </View>
        ) : null}
        {error ? <Banner tone="error" text={error} /> : null}
        {message ? <Banner tone="success" text={message} /> : null}

        <View style={styles.metrics}>
          <Metric detail="นับจากสถานะที่ผ่าน payment/admin queue" label="ยอดขาย 30 วัน" value={formatMoney(stats.paidRevenue30)} />
          <Metric detail={`${stats.totalOrders30} รายการใน 30 วันล่าสุด`} label="ออเดอร์ 30 วัน" value={`${stats.totalOrders30}`} />
          <Metric detail={`${stats.activeQueue} รายการรอทีมหลังบ้านดำเนินการ`} label="คิวที่ต้องดูแล" value={`${stats.activeQueue}`} />
          <Metric detail={`${stats.activeProducts}/${stats.totalProducts} เปิดขาย`} label="สินค้า active" value={`${stats.activeProducts}`} />
          <Metric detail={`${stats.ragReady} รายการ embedded`} label="RAG พร้อมใช้" value={`${stats.ragReady}`} />
          <Metric detail={`รอ approve/pay ${formatMoney(stats.pendingCommission)}`} label="สมาชิก ref" value={`${stats.referrersActive}`} />
        </View>

        <View style={[styles.grid, !isWide ? styles.gridStack : null]}>
          <View style={styles.chartPane}>
            <View style={styles.panelHeader}>
              <View>
                <Text style={styles.panelTitle}>ออเดอร์ 7 วันล่าสุด</Text>
                <Text style={styles.panelMeta}>จำนวนรายการจาก backend</Text>
              </View>
              <Link href="/admin/orders" asChild>
                <Pressable style={styles.textButton}>
                  <Text style={styles.textButtonLabel}>เปิดคิว</Text>
                </Pressable>
              </Link>
            </View>
            <View style={styles.chart}>
              {weeklySeries.map((point) => (
                <View key={point.key} style={styles.barSlot}>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { height: `${Math.max(10, (point.orders / maxWeeklyOrders) * 100)}%` }]} />
                  </View>
                  <Text style={styles.barValue}>{point.orders}</Text>
                  <Text style={styles.barLabel}>{point.label}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.sidePane}>
            <View style={styles.summaryCard}>
              <Text style={styles.panelTitle}>สินค้าขายดี</Text>
              <Text style={styles.bigValue}>{topProduct?.name ?? '-'}</Text>
              <Text style={styles.cardBody}>
                {topProduct ? `${topProduct.count} orders · ${formatMoney(topProduct.revenue)}` : 'ยังไม่มี order ที่จ่ายเงินในช่วงข้อมูลล่าสุด'}
              </Text>
              <Link href="/admin/catalog" asChild>
                <Pressable style={styles.primaryButton}>
                  <Text style={styles.primaryButtonText}>เปิด catalog</Text>
                </Pressable>
              </Link>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.panelTitle}>โครงสร้าง tenant</Text>
              <View style={styles.stackStats}>
                <MiniStat label="สาขา active" value={`${stats.activeBranches}/${branches.length}`} />
                <MiniStat label="สินค้า active" value={`${stats.activeProducts}/${stats.totalProducts}`} />
                <MiniStat label="สมาชิก ref" value={`${stats.referrersActive}/${referrers.length}`} />
              </View>
            </View>
          </View>
        </View>

        <View style={[styles.grid, !isWide ? styles.gridStack : null]}>
          <View style={styles.listPane}>
            <View style={styles.panelHeader}>
              <View>
                <Text style={styles.panelTitle}>ออเดอร์ล่าสุด</Text>
                <Text style={styles.panelMeta}>{recentOrders.length} รายการล่าสุด</Text>
              </View>
            </View>
            {recentOrders.length === 0 ? (
              <Empty title="ยังไม่มีออเดอร์" body="เมื่อมีคำสั่งซื้อจาก chat หรือ referral รายการจะเข้ามาที่ dashboard และคิว order" />
            ) : (
              recentOrders.map((order) => <OrderRowCard key={order.id} order={order} />)
            )}
          </View>

          <View style={styles.listPane}>
            <View style={styles.panelHeader}>
              <View>
                <Text style={styles.panelTitle}>งานหลังบ้าน</Text>
                <Text style={styles.panelMeta}>เปิดไปจัดการหน้า live</Text>
              </View>
            </View>
            <QuickLink body="สร้าง/แก้สินค้า ผูกสาขา อัปโหลดรูป และ sync Stripe" href="/admin/catalog" title="จัดการสินค้า" />
            <QuickLink body="เพิ่มสาขา แก้ข้อมูลติดต่อ และเปิด/ปิดการใช้งาน" href="/admin/branches" title="จัดการสาขา" />
            <QuickLink body="สร้างสมาชิก Ref Program และอนุมัติ/จ่ายค่าคอมมิชชัน" href="/admin/referrers" title="Referral Program" />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Metric({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricDetail}>{detail}</Text>
    </View>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.miniValue}>{value}</Text>
    </View>
  );
}

function OrderRowCard({ order }: { order: DashboardOrder }) {
  const product = fromJoin(order.products);
  const branch = fromJoin(order.branches);
  const customer = fromJoin(order.customers);
  const referrer = fromJoin(order.referrers);

  return (
    <View style={styles.orderRow}>
      <View style={styles.orderCopy}>
        <Text numberOfLines={1} style={styles.orderTitle}>{product?.name ?? order.product_id}</Text>
        <Text numberOfLines={1} style={styles.orderMeta}>
          {[order.buyer_name ?? customer?.nickname ?? 'ไม่ระบุชื่อ', branch?.name, referrer ? `ref ${referrer.ref_code}` : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <View style={styles.orderAside}>
        <Text style={styles.amountText}>{formatMoney(order.amount_baht)}</Text>
        <Pill label={order.status.replaceAll('_', ' ')} tone={orderStatusTone(order.status)} />
      </View>
    </View>
  );
}

function QuickLink({ body, href, title }: { body: string; href: string; title: string }) {
  return (
    <Link href={href as never} asChild>
      <Pressable style={styles.quickLink}>
        <View style={styles.quickLinkTop}>
          <Text style={styles.quickTitle}>{title}</Text>
          <Text style={styles.textButtonLabel}>เปิด</Text>
        </View>
        <Text style={styles.cardBody}>{body}</Text>
      </Pressable>
    </Link>
  );
}

function Empty({ body, title }: { body: string; title: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.cardBody}>{body}</Text>
    </View>
  );
}

function Banner({ text, tone }: { text: string; tone: 'error' | 'success' }) {
  return (
    <View style={[styles.banner, tone === 'error' ? styles.bannerError : styles.bannerSuccess]}>
      <Text style={[styles.bannerText, tone === 'error' ? styles.bannerTextError : styles.bannerTextSuccess]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  amountText: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 13,
    fontWeight: '900',
  },
  banner: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  bannerError: {
    backgroundColor: '#FFE8E8',
    borderColor: '#F7B9BA',
  },
  bannerSuccess: {
    backgroundColor: '#E7F4ED',
    borderColor: '#B9E2CF',
  },
  bannerText: {
    fontSize: 13,
    fontWeight: '900',
  },
  bannerTextError: {
    color: '#A23538',
  },
  bannerTextSuccess: {
    color: MiraDesign.color.showcaseBlueDeep,
  },
  barFill: {
    backgroundColor: MiraDesign.color.showcaseBlue,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    minHeight: 12,
    width: '100%',
  },
  barLabel: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 11,
    fontWeight: '900',
  },
  barSlot: {
    alignItems: 'center',
    flex: 1,
    gap: 6,
  },
  barTrack: {
    backgroundColor: MiraDesign.color.showcaseBlueSoft,
    borderRadius: 8,
    height: 180,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    width: '100%',
  },
  barValue: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 12,
    fontWeight: '900',
  },
  bigValue: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 21,
    fontWeight: '900',
    lineHeight: 27,
  },
  cardBody: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 19,
  },
  chart: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 10,
    minHeight: 230,
  },
  chartPane: {
    backgroundColor: MiraDesign.color.showcaseSurface,
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1.3,
    gap: 14,
    minWidth: 0,
    padding: 14,
    ...softShadow,
  },
  container: {
    gap: 14,
    padding: 22,
    paddingBottom: 48,
  },
  disabled: {
    opacity: 0.45,
  },
  emptyState: {
    backgroundColor: '#F7FBFA',
    borderColor: MiraDesign.color.showcaseLineSoft,
    borderRadius: 8,
    borderWidth: 1,
    gap: 5,
    padding: 12,
  },
  emptyTitle: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 15,
    fontWeight: '900',
  },
  eyebrow: {
    color: MiraDesign.color.showcaseBlueDeep,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  grid: {
    alignItems: 'stretch',
    flexDirection: 'row',
    gap: 12,
  },
  gridStack: {
    flexDirection: 'column',
  },
  listPane: {
    backgroundColor: MiraDesign.color.showcaseSurface,
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    gap: 12,
    minWidth: 0,
    padding: 14,
    ...softShadow,
  },
  metricCard: {
    backgroundColor: MiraDesign.color.showcaseSurface,
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    flexGrow: 1,
    gap: 4,
    minWidth: 184,
    padding: 12,
    ...softShadow,
  },
  metricDetail: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
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
    lineHeight: 26,
  },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  miniStat: {
    backgroundColor: '#F7FBFA',
    borderColor: MiraDesign.color.showcaseLineSoft,
    borderRadius: 8,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 120,
    padding: 10,
  },
  miniValue: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 18,
    fontWeight: '900',
    marginTop: 4,
  },
  notice: {
    backgroundColor: '#FFF7DD',
    borderColor: '#F3D17B',
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  noticeBody: {
    color: '#806729',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 19,
  },
  noticeTitle: {
    color: '#6F5100',
    fontSize: 15,
    fontWeight: '900',
  },
  orderAside: {
    alignItems: 'flex-end',
    gap: 6,
  },
  orderCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  orderMeta: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 12,
    fontWeight: '800',
  },
  orderRow: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.showcaseLineSoft,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    padding: 12,
  },
  orderTitle: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 15,
    fontWeight: '900',
  },
  panelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  panelMeta: {
    color: MiraDesign.color.showcaseBlue,
    fontSize: 12,
    fontWeight: '900',
    marginTop: 3,
  },
  panelTitle: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 17,
    fontWeight: '900',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.showcaseBlue,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  quickLink: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.showcaseLineSoft,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  quickLinkTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  quickTitle: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 15,
    fontWeight: '900',
  },
  screen: {
    backgroundColor: '#EEF7FF',
    flex: 1,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.showcaseSurface,
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    color: MiraDesign.color.showcaseBlueDeep,
    fontSize: 13,
    fontWeight: '900',
  },
  sidePane: {
    flex: 0.8,
    gap: 12,
    minWidth: 290,
  },
  stackStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  subtitle: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 21,
  },
  summaryCard: {
    backgroundColor: MiraDesign.color.showcaseSurface,
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 14,
    ...softShadow,
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
  title: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 34,
  },
  titleGroup: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  topActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
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
});
