import { Link } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AdminShell } from '@/components/admin/AdminShell';
import { AdminBadge, AdminCard, AdminHeader, AdminScreen, EmptyState, SectionTitle, SummaryChips } from '@/components/admin/adminUi';
import { MiraDesign } from '@/constants/Design';
import { useAuthSession } from '@/lib/auth/useAuthSession';
import { loadManagedHospitalProducts, loadTenantMemberContext, type HospitalProduct } from '@/lib/marketplace/hospitalProducts';
import { supabase } from '@/lib/supabase';
import { useTenantConfig } from '@/lib/tenant/useTenantConfig';

type BookingPreviewOrder = {
  amount_baht: number;
  buyer_name: string | null;
  buyer_phone: string | null;
  created_at: string;
  id: string;
  products?: { name: string | null } | { name: string | null }[] | null;
  status: string;
};

const adminActions = [
  {
    body: 'สร้าง แก้ไข archive/restore จัดสาขา และ sync Stripe ในหน้าเดียว',
    href: '/admin/catalog',
    meta: 'inventory',
    title: 'จัดการสินค้า',
  },
  {
    body: 'ดู order ที่จ่ายเงินแล้ว โทรนัดลูกค้า และอัปเดต booking status',
    href: '/admin/orders',
    meta: 'booking',
    title: 'คิวคำสั่งซื้อ',
  },
  {
    body: 'เพิ่ม/แก้ไขสาขา เปิดปิดสาขา และใช้ข้อมูลนี้กับการขายสินค้าหลายสาขา',
    href: '/admin/branches',
    meta: 'branches',
    title: 'จัดการสาขา',
  },
  {
    body: 'จัดการสมาชิก Ref Program และตรวจรายการ commission จาก order จริง',
    href: '/admin/referrers',
    meta: 'referral',
    title: 'สมาชิกและค่าคอมมิชชัน',
  },
  {
    body: 'ดู KPI live จาก orders, products, branches, referral และ commission ledger',
    href: '/admin/dashboard',
    meta: 'dashboard',
    title: 'ภาพรวมหลังบ้าน',
  },
] as const;

function getProductStatusTone(product: HospitalProduct): 'amber' | 'blue' | 'danger' | 'mint' {
  if (product.ragEmbeddingStatus === 'error' || product.status === 'rejected') {
    return 'danger';
  }

  if (product.status === 'active' && product.ragEmbeddingStatus === 'embedded') {
    return 'mint';
  }

  if (product.status === 'pending_review') {
    return 'amber';
  }

  return 'blue';
}

function getBookingStatusLabel(value: string) {
  return value.replace('_', ' ');
}

function embeddedOne<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function formatMoney(amount: number) {
  return `${amount.toLocaleString('th-TH')} THB`;
}

export default function AdminPanelScreen() {
  const auth = useAuthSession();
  const vocab = useTenantConfig().config.vocabulary;
  const [bookingOrders, setBookingOrders] = useState<BookingPreviewOrder[]>([]);
  const [products, setProducts] = useState<HospitalProduct[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const stats = useMemo(() => {
    const pendingReview = products.filter((product) => product.status === 'pending_review').length;
    const active = products.filter((product) => product.status === 'active').length;
    const embeddingErrors = products.filter((product) => product.ragEmbeddingStatus === 'error').length;
    const bookingWaiting = bookingOrders.filter((order) => order.status === 'submitted').length;

    return {
      active,
      bookingWaiting,
      embeddingErrors,
      pendingReview,
    };
  }, [bookingOrders, products]);

  const reviewQueue = useMemo(
    () =>
      products
        .filter((product) => product.status === 'pending_review' || product.ragEmbeddingStatus === 'error')
        .slice(0, 4),
    [products],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadDashboard() {
      const items = await loadManagedHospitalProducts();

      if (isMounted) {
        setProducts(items);
      }

      if (!auth.user) {
        if (isMounted) {
          setBookingOrders([]);
        }
        return;
      }

      const tenantContext = await loadTenantMemberContext();

      if (!tenantContext) {
        if (isMounted) {
          setBookingOrders([]);
        }
        return;
      }

      const { data, error: orderError } = await supabase
        .from('orders')
        .select('id,status,buyer_name,buyer_phone,amount_baht,created_at,products(name)')
        .eq('tenant_id', tenantContext.id)
        .in('status', ['submitted', 'confirmed', 'booked'])
        .order('created_at', { ascending: false })
        .limit(5);

      if (orderError) {
        throw new Error(orderError.message);
      }

      if (isMounted) {
        setBookingOrders((data ?? []) as unknown as BookingPreviewOrder[]);
      }
    }

    loadDashboard()
      .then(() => {
        if (isMounted) {
          setError(null);
        }
      })
      .catch((loadError) => {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : 'โหลดสินค้าไม่สำเร็จ');
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingProducts(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [auth.user]);

  return (
    <AdminShell>
      <AdminScreen>
        <AdminHeader
          actions={
            !auth.session ? (
              <Link href={{ pathname: '/login', params: { mode: 'admin', redirect: '/admin-panel' } }} asChild>
                <Pressable accessibilityRole="link" style={styles.loginButton}>
                  <SymbolView name={{ android: 'login', ios: 'person.crop.circle', web: 'login' }} size={16} tintColor="#FFFFFF" />
                  <Text style={styles.loginButtonText}>เข้าสู่ระบบ</Text>
                </Pressable>
              </Link>
            ) : null
          }
          eyebrow="หลังบ้าน"
          modeLabel={auth.session ? 'ใช้งานจริง' : 'โหมดตัวอย่าง'}
          modeTone={auth.session ? 'primary' : 'amber'}
          note={!auth.session ? 'โหมดตัวอย่าง: ดู workflow ได้ · action จริงต้องใช้บัญชีที่มีสิทธิ์' : null}
          title="ศูนย์ปฏิบัติการ"
        />

        <SummaryChips
          items={[
            { key: 'review', label: 'รอตรวจ', value: stats.pendingReview },
            { key: 'active', label: 'เปิดขาย', value: stats.active },
            { key: 'rag', label: 'RAG error', value: stats.embeddingErrors },
            { key: 'booking', label: 'คิวจอง', value: stats.bookingWaiting },
          ]}
        />

        <SectionTitle title="งานหลัก" />
        <View style={styles.actionGrid}>
          {adminActions.map((action) => (
            <Link key={action.href} href={action.href} asChild>
              <Pressable accessibilityRole="link" style={styles.actionCard}>
                <View style={styles.actionTop}>
                  <Text style={styles.actionMeta}>{action.meta}</Text>
                  <SymbolView name={{ android: 'chevron_right', ios: 'chevron.right', web: 'chevron_right' }} size={16} tintColor={MiraDesign.color.inkSoft} />
                </View>
                <Text style={styles.actionTitle}>{action.title}</Text>
                <Text numberOfLines={2} style={styles.actionBody}>
                  {action.body}
                </Text>
              </Pressable>
            </Link>
          ))}
        </View>

        <SectionTitle meta={isLoadingProducts ? 'กำลังโหลด' : `${reviewQueue.length} รายการ`} title="คิวตรวจสินค้า" />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {reviewQueue.length === 0 ? (
          <EmptyState
            body={`เมื่อทีมงานส่ง${vocab.productTerm}ใหม่ หรือ embedding ล้มเหลว รายการจะขึ้นที่นี่`}
            icon={{ android: 'fact_check', ios: 'checklist', web: 'fact_check' }}
            title={`ยังไม่มี${vocab.productTerm}ในคิวตรวจ`}
          />
        ) : (
          <View style={styles.queueList}>
            {reviewQueue.map((product) => (
              <AdminCard key={product.id}>
                <View style={styles.queueRow}>
                  <Text numberOfLines={1} style={styles.queueTitle}>
                    {product.title}
                  </Text>
                  <AdminBadge
                    label={product.ragEmbeddingStatus === 'error' ? 'embedding error' : product.status}
                    tone={product.ragEmbeddingStatus === 'error' || product.status === 'rejected' ? 'danger' : product.status === 'pending_review' ? 'amber' : 'success'}
                  />
                </View>
                <Text numberOfLines={1} style={styles.queueMeta}>
                  {product.hospitalName}
                </Text>
              </AdminCard>
            ))}
          </View>
        )}

        <SectionTitle meta={`${bookingOrders.length} รายการ`} title="การจองล่าสุด" />
        {bookingOrders.length === 0 ? (
          <EmptyState
            body="เมื่อออเดอร์เข้าสถานะรอตรวจ จะแสดงที่นี่และในคิวคำสั่งซื้อ"
            icon={{ android: 'event_available', ios: 'calendar', web: 'event_available' }}
            title="ยังไม่มีออเดอร์ที่ชำระแล้ว"
          />
        ) : (
          <View style={styles.queueList}>
            {bookingOrders.map((order) => {
              const product = embeddedOne(order.products);

              return (
                <AdminCard key={order.id}>
                  <View style={styles.queueRow}>
                    <Text numberOfLines={1} style={styles.queueTitle}>
                      {product?.name ?? 'ไม่พบสินค้า'}
                    </Text>
                    <AdminBadge label={getBookingStatusLabel(order.status)} tone={order.status === 'booked' ? 'success' : 'amber'} />
                  </View>
                  <Text numberOfLines={1} style={styles.queueMeta}>
                    {(order.buyer_name ?? 'ไม่ระบุชื่อ')} · {formatMoney(order.amount_baht)}
                  </Text>
                </AdminCard>
              );
            })}
          </View>
        )}
      </AdminScreen>
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  loginButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.primary,
    borderRadius: 8,
    cursor: 'pointer',
    flexDirection: 'row',
    gap: 6,
    height: 38,
    paddingHorizontal: 14,
  },
  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionCard: {
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    cursor: 'pointer',
    flexBasis: 220,
    flexGrow: 1,
    gap: 6,
    padding: 12,
  },
  actionTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionMeta: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  actionTitle: {
    color: MiraDesign.color.ink,
    fontSize: 15,
    fontWeight: '900',
  },
  actionBody: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    lineHeight: 17,
  },
  errorText: {
    color: MiraDesign.color.danger,
    fontSize: 13,
    fontWeight: '800',
  },
  queueList: {
    gap: 8,
  },
  queueRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  queueTitle: {
    color: MiraDesign.color.ink,
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
  },
  queueMeta: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '600',
  },
});
