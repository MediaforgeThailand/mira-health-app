import { Link, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { AdminBadge, AdminCard, AdminHeader, AdminScreen, DefList, DefRow, EmptyState, SectionTitle, SummaryChips } from '@/components/admin/adminUi';
import { MiraDesign } from '@/constants/Design';
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
import { showcaseDemoAdminOrders, showcaseDemoBranches, showcaseDemoCommissions, showcaseDemoProducts, showcaseDemoReferrers, showcaseDemoTenantContext } from '@/lib/showcase/demoFixtures';
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

function orderStatusTone(status: OrderRow['status']): 'amber' | 'blue' | 'danger' | 'success' {
  if (status === 'cancelled') {
    return 'danger';
  }

  if (status === 'done' || status === 'booked') {
    return 'success';
  }

  if (status === 'submitted' || status === 'confirmed') {
    return 'amber';
  }

  return 'blue';
}

export default function AdminDashboardScreen() {
  const auth = useAuthSession();
  const { tour } = useLocalSearchParams<{ tour?: string }>();
  const { width } = useWindowDimensions();
  const isWide = width >= 1080;
  const isTourMode = tour === 'admin';
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [commissions, setCommissions] = useState<CommissionEntryRow[]>([]);
  const [orders, setOrders] = useState<DashboardOrder[]>([]);
  const [products, setProducts] = useState<HospitalProduct[]>([]);
  const [referrers, setReferrers] = useState<ReferrerRow[]>([]);
  const [tenantContext, setTenantContext] = useState<TenantMemberContext | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [demoFallbackReason, setDemoFallbackReason] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isBaseDemoMode = isTourMode || !auth.session || !supabaseConfigStatus.isConfigured;
  const isDemoMode = isBaseDemoMode || Boolean(demoFallbackReason);

  const loadDemoDashboard = useCallback((reason: string | null = null) => {
    setDemoFallbackReason(reason);
    setTenantContext(showcaseDemoTenantContext);
    setProducts(showcaseDemoProducts);
    setBranches(showcaseDemoBranches);
    setOrders(showcaseDemoAdminOrders);
    setReferrers(showcaseDemoReferrers);
    setCommissions(showcaseDemoCommissions);
  }, []);

  const loadDashboard = useCallback(async () => {
    if (isBaseDemoMode) {
      loadDemoDashboard(null);
      return true;
    }

    const context = await loadTenantMemberContext();

    if (!context) {
      loadDemoDashboard(`บัญชีนี้ยังไม่ได้เชื่อมกับ tenant "${defaultTenantSlug}"`);
      return true;
    }

    setDemoFallbackReason(null);
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
      loadDemoDashboard(orderResult.error.message);
      return true;
    }

    if (referrerResult.error) {
      loadDemoDashboard(referrerResult.error.message);
      return true;
    }

    if (commissionResult.error) {
      loadDemoDashboard(commissionResult.error.message);
      return true;
    }

    setProducts(productRows);
    setBranches(branchRows);
    setOrders((orderResult.data ?? []) as unknown as DashboardOrder[]);
    setReferrers((referrerResult.data ?? []) as unknown as ReferrerRow[]);
    setCommissions((commissionResult.data ?? []) as unknown as CommissionEntryRow[]);
    return false;
  }, [isBaseDemoMode, loadDemoDashboard]);

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
          loadDemoDashboard(reason);
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
      const usedDemo = await loadDashboard();
      setMessage(usedDemo ? 'กำลังแสดงข้อมูลตัวอย่าง' : 'รีเฟรชข้อมูลหลังบ้านแล้ว');
    } catch (refreshError) {
      const reason = refreshError instanceof Error ? refreshError.message : 'รีเฟรช dashboard ไม่สำเร็จ';
      loadDemoDashboard(reason);
      setMessage('กำลังแสดงข้อมูลตัวอย่าง');
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
    <AdminScreen>
      <AdminHeader
        actions={
          <Pressable
            accessibilityLabel="รีเฟรช"
            accessibilityRole="button"
            disabled={isLoading}
            onPress={() => void refreshDashboard()}
            style={[styles.headerBtn, isLoading ? styles.disabled : null]}
          >
            <SymbolView name={{ android: 'refresh', ios: 'arrow.clockwise', web: 'refresh' }} size={16} tintColor={MiraDesign.color.primaryDeep} />
            <Text style={styles.headerBtnText}>{isLoading ? 'กำลังโหลด' : 'รีเฟรช'}</Text>
          </Pressable>
        }
        eyebrow="หลังบ้าน / รายงาน"
        metaText={tenantContext ? `${tenantContext.display_name} · ${tenantContext.role}` : defaultTenantSlug}
        modeLabel={isDemoMode ? 'โหมดตัวอย่าง' : 'ใช้งานจริง'}
        modeTone={isDemoMode ? 'amber' : 'primary'}
        note={
          isDemoMode
            ? demoFallbackReason
              ? `โหมดตัวอย่าง: ${demoFallbackReason}`
              : 'โหมดตัวอย่าง: login ด้วยบัญชี tenant admin/staff เพื่อดูข้อมูลจริง'
            : null
        }
        title="ภาพรวมหลังบ้าน"
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {message ? <Text style={styles.successText}>{message}</Text> : null}

      <SummaryChips
        items={[
          { key: 'rev', label: 'ยอดขาย 30 วัน', value: formatMoney(stats.paidRevenue30) },
          { key: 'ord', label: 'ออเดอร์ 30 วัน', value: stats.totalOrders30 },
          { key: 'queue', label: 'คิวที่ต้องดูแล', value: stats.activeQueue },
          { key: 'prod', label: 'สินค้า active', value: stats.activeProducts },
          { key: 'rag', label: 'RAG พร้อม', value: stats.ragReady },
          { key: 'ref', label: 'สมาชิก ref', value: stats.referrersActive },
        ]}
      />

      <View style={[styles.grid, !isWide ? styles.gridStack : null]}>
        <View style={styles.chartCard}>
          <SectionTitle
            action={
              <Link href={{ pathname: '/admin/orders', params: { tour: 'admin' } }} asChild>
                <Pressable accessibilityRole="link" style={styles.smallBtn}>
                  <Text style={styles.smallBtnText}>เปิดคิว</Text>
                </Pressable>
              </Link>
            }
            meta="7 วันล่าสุด"
            title="ออเดอร์รายวัน"
          />
          <View style={styles.chart}>
            {weeklySeries.map((point) => (
              <View key={point.key} style={styles.barSlot}>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { height: `${Math.max(8, (point.orders / maxWeeklyOrders) * 100)}%` }]} />
                </View>
                <Text style={styles.barValue}>{point.orders}</Text>
                <Text style={styles.barLabel}>{point.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.sideCol}>
          <AdminCard>
            <Text style={styles.cardLabel}>สินค้าขายดี</Text>
            <Text numberOfLines={1} style={styles.cardBig}>
              {topProduct?.name ?? '-'}
            </Text>
            <Text style={styles.cardSub}>
              {topProduct ? `${topProduct.count} orders · ${formatMoney(topProduct.revenue)}` : 'ยังไม่มี order ที่จ่ายเงิน'}
            </Text>
          </AdminCard>
          <AdminCard>
            <Text style={styles.cardLabel}>โครงสร้าง tenant</Text>
            <DefList>
              <DefRow label="สาขา active" value={`${stats.activeBranches}/${branches.length}`} />
              <DefRow label="สินค้า active" value={`${stats.activeProducts}/${stats.totalProducts}`} />
              <DefRow label="สมาชิก ref" value={`${stats.referrersActive}/${referrers.length}`} />
            </DefList>
          </AdminCard>
        </View>
      </View>

      <View style={[styles.grid, !isWide ? styles.gridStack : null]}>
        <View style={styles.listCol}>
          <SectionTitle meta={`${recentOrders.length} รายการ`} title="ออเดอร์ล่าสุด" />
          {recentOrders.length === 0 ? (
            <EmptyState
              body="เมื่อมีคำสั่งซื้อจาก chat หรือ referral รายการจะเข้ามาที่นี่"
              icon={{ android: 'receipt_long', ios: 'list.bullet.rectangle', web: 'receipt_long' }}
              title="ยังไม่มีออเดอร์"
            />
          ) : (
            <View style={styles.list}>
              {recentOrders.map((order) => (
                <OrderRowCard key={order.id} order={order} />
              ))}
            </View>
          )}
        </View>

        <View style={styles.listCol}>
          <SectionTitle title="งานหลังบ้าน" />
          <View style={styles.list}>
            <QuickLink body="สร้าง/แก้สินค้า ผูกสาขา อัปโหลดรูป และ sync Stripe" href="/admin/catalog" title="จัดการสินค้า" />
            <QuickLink body="เพิ่มสาขา แก้ข้อมูลติดต่อ และเปิด/ปิดการใช้งาน" href="/admin/branches" title="จัดการสาขา" />
            <QuickLink body="สร้างสมาชิก Ref Program และอนุมัติ/จ่ายค่าคอมมิชชัน" href="/admin/referrers" title="Referral Program" />
          </View>
        </View>
      </View>
    </AdminScreen>
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
        <Text numberOfLines={1} style={styles.orderTitle}>
          {product?.name ?? order.product_id}
        </Text>
        <Text numberOfLines={1} style={styles.orderMeta}>
          {[order.buyer_name ?? customer?.nickname ?? 'ไม่ระบุชื่อ', branch?.name, referrer ? `ref ${referrer.ref_code}` : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <View style={styles.orderAside}>
        <Text style={styles.amountText}>{formatMoney(order.amount_baht)}</Text>
        <AdminBadge label={order.status.replaceAll('_', ' ')} tone={orderStatusTone(order.status)} />
      </View>
    </View>
  );
}

function QuickLink({ body, href, title }: { body: string; href: string; title: string }) {
  return (
    <Link href={{ pathname: href as never, params: { tour: 'admin' } }} asChild>
      <Pressable accessibilityRole="link" style={styles.quickLink}>
        <View style={styles.quickTop}>
          <Text style={styles.quickTitle}>{title}</Text>
          <SymbolView name={{ android: 'chevron_right', ios: 'chevron.right', web: 'chevron_right' }} size={16} tintColor={MiraDesign.color.inkSoft} />
        </View>
        <Text numberOfLines={2} style={styles.quickBody}>
          {body}
        </Text>
      </Pressable>
    </Link>
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
  smallBtn: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.surfaceSoft,
    borderRadius: 8,
    cursor: 'pointer',
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 12,
  },
  smallBtnText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '800',
  },
  grid: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
  },
  gridStack: {
    flexDirection: 'column',
  },
  chartCard: {
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    flexGrow: 1.4,
    flexShrink: 1,
    flexBasis: 0,
    gap: 10,
    minWidth: 0,
    padding: 12,
  },
  chart: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 8,
    height: 160,
    justifyContent: 'space-between',
  },
  barSlot: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
    justifyContent: 'flex-end',
  },
  barTrack: {
    backgroundColor: MiraDesign.color.surfaceSoft,
    borderRadius: 6,
    flex: 1,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    width: '100%',
  },
  barFill: {
    backgroundColor: MiraDesign.color.primary,
    borderRadius: 6,
    width: '100%',
  },
  barValue: {
    color: MiraDesign.color.ink,
    fontSize: 12,
    fontWeight: '800',
  },
  barLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '700',
  },
  sideCol: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    gap: 12,
    minWidth: 0,
  },
  cardLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  cardBig: {
    color: MiraDesign.color.ink,
    fontSize: 18,
    fontWeight: '900',
  },
  cardSub: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '600',
  },
  listCol: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    gap: 8,
    minWidth: 0,
  },
  list: {
    gap: 8,
  },
  orderRow: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  orderCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  orderTitle: {
    color: MiraDesign.color.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  orderMeta: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '600',
  },
  orderAside: {
    alignItems: 'flex-end',
    gap: 4,
  },
  amountText: {
    color: MiraDesign.color.ink,
    fontSize: 13,
    fontWeight: '900',
  },
  quickLink: {
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    cursor: 'pointer',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  quickTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  quickTitle: {
    color: MiraDesign.color.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  quickBody: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
  disabled: {
    opacity: 0.45,
  },
});
