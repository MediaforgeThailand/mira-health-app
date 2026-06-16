import { Link } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AdminShell } from '@/components/admin/AdminShell';
import { ActionButton, BrandHeader, Card, Pill, Screen, SectionHeader, StatTile } from '@/components/MiraUI';
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
    <Screen>
      <BrandHeader
        compact
        eyebrow="หลังบ้าน"
        title="ศูนย์ปฏิบัติการหลังบ้าน"
        subtitle={`ศูนย์กลางสำหรับ admin จัดการ${vocab.productTerm} review RAG และเช็ค order ที่ต้องนัดหมายหลังชำระเงิน`}
      />

      {!auth.session ? (
        <Card style={styles.noticeCard}>
          <View style={styles.noticeTop}>
            <Text style={styles.noticeTitle}>ยังไม่ได้ login เป็น admin/staff</Text>
              <Pill label="ดูอย่างเดียว" tone="amber" />
          </View>
          <Text style={styles.body}>หน้า admin panel เปิดให้ดู workflow ได้ แต่ action จริงอย่าง approve, archive, retry embedding และ booking save ต้องใช้ account ที่มีสิทธิ์</Text>
          <Link href={{ pathname: '/login', params: { mode: 'admin', redirect: '/admin-panel' } }} asChild>
            <ActionButton label="เข้าสู่ระบบแอดมิน" />
          </Link>
        </Card>
      ) : null}

      <View style={styles.statGrid}>
        <StatTile detail="รอทีมตรวจสอบและอนุมัติ" label="รอตรวจ" value={`${stats.pendingReview}`} />
        <StatTile detail={`${vocab.productTerm}ที่ลูกค้าเห็นอยู่ตอนนี้`} label="เปิดขาย" value={`${stats.active}`} />
        <StatTile detail="ต้อง retry embedding" label="RAG error" value={`${stats.embeddingErrors}`} />
        <StatTile detail="รอทีมงานโทรนัด" label="คิวจอง" value={`${stats.bookingWaiting}`} />
      </View>

      <SectionHeader title="งานหลักของแอดมิน" meta="product + booking" />
      <View style={styles.actionGrid}>
        {adminActions.map((action) => (
          <Link key={action.href} href={action.href} asChild>
            <Pressable style={styles.actionCard}>
              <View style={styles.actionTop}>
                <Text style={styles.actionMeta}>{action.meta}</Text>
                <Text style={styles.actionArrow}>เปิด</Text>
              </View>
              <Text style={styles.actionTitle}>{action.title}</Text>
              <Text style={styles.body}>{action.body}</Text>
            </Pressable>
          </Link>
        ))}
      </View>

      <SectionHeader title="คิวตรวจสินค้า" meta={isLoadingProducts ? 'กำลังโหลด' : `${reviewQueue.length} รายการ`} />
      <View style={styles.queueList}>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {reviewQueue.length === 0 ? (
          <Card>
            <Text style={styles.emptyTitle}>{`ยังไม่มี${vocab.productTerm}ในคิวตรวจ`}</Text>
            <Text style={styles.body}>{`เมื่อทีมงานส่ง${vocab.productTerm}ใหม่ หรือ embedding ล้มเหลว รายการจะขึ้นตรงนี้ให้ admin เข้าไปจัดการ`}</Text>
          </Card>
        ) : (
          reviewQueue.map((product) => (
            <Card key={product.id} style={styles.queueCard}>
              <View style={styles.queueTop}>
                <View style={styles.queueCopy}>
                  <Text style={styles.queueTitle}>{product.title}</Text>
                  <Text style={styles.queueMeta}>{product.hospitalName}</Text>
                </View>
                <Pill label={product.ragEmbeddingStatus === 'error' ? 'embedding error' : product.status} tone={getProductStatusTone(product)} />
              </View>
              <Text numberOfLines={2} style={styles.body}>{product.description}</Text>
            </Card>
          ))
        )}
      </View>

      <SectionHeader title="สถานะการจองล่าสุด" meta={`${bookingOrders.length} order`} />
      <View style={styles.queueList}>
        {bookingOrders.length === 0 ? (
          <Card>
            <Text style={styles.emptyTitle}>ยังไม่มีออเดอร์ที่ชำระแล้วในคิว</Text>
            <Text style={styles.body}>เมื่อออเดอร์เข้าสถานะรอตรวจ รายการจะขึ้นที่นี่และในคิวคำสั่งซื้อหลัก</Text>
          </Card>
        ) : (
          bookingOrders.map((order) => {
            const product = embeddedOne(order.products);

            return (
              <Card key={order.id} style={styles.queueCard}>
                <View style={styles.queueTop}>
                  <View style={styles.queueCopy}>
                    <Text style={styles.queueTitle}>{product?.name ?? 'ไม่พบสินค้า'}</Text>
                    <Text style={styles.queueMeta}>{order.id} · {formatMoney(order.amount_baht)}</Text>
                  </View>
                  <Pill label={getBookingStatusLabel(order.status)} tone={order.status === 'booked' ? 'mint' : 'amber'} />
                </View>
                <Text style={styles.body}>{order.buyer_name ?? 'Unnamed buyer'} · {order.buyer_phone ?? '-'}</Text>
              </Card>
            );
          })
        )}
      </View>
    </Screen>
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  actionArrow: {
    color: MiraDesign.color.showcaseBlue,
    fontSize: 12,
    fontWeight: '900',
  },
  actionCard: {
    backgroundColor: MiraDesign.color.showcaseSurface,
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    gap: MiraDesign.space.sm,
    minWidth: 240,
    padding: MiraDesign.space.lg,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: MiraDesign.space.md,
  },
  actionMeta: {
    color: MiraDesign.color.showcaseBlueDeep,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  actionTitle: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 18,
    fontWeight: '900',
  },
  actionTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  body: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 13,
    lineHeight: 19,
  },
  emptyTitle: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 16,
    fontWeight: '900',
  },
  errorText: {
    color: MiraDesign.color.danger,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  noticeCard: {
    backgroundColor: '#FFF8E7',
    borderColor: '#F3D17B',
  },
  noticeTitle: {
    color: '#6F5100',
    fontSize: 16,
    fontWeight: '900',
  },
  noticeTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  queueCard: {
    borderRadius: 8,
  },
  queueCopy: {
    flex: 1,
    gap: MiraDesign.space.xs,
  },
  queueList: {
    gap: MiraDesign.space.md,
  },
  queueMeta: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 12,
    fontWeight: '800',
  },
  queueTitle: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 16,
    fontWeight: '900',
  },
  queueTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: MiraDesign.space.md,
    justifyContent: 'space-between',
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: MiraDesign.space.md,
  },
});
