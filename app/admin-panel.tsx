import { Link } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton, BrandHeader, Card, Pill, Screen, SectionHeader, StatTile } from '@/components/MiraUI';
import { MiraDesign } from '@/constants/Design';
import { useAuthSession } from '@/lib/auth/useAuthSession';
import { loadManagedHospitalProducts, loadTenantMemberContext, type HospitalProduct } from '@/lib/marketplace/hospitalProducts';
import { supabase } from '@/lib/supabase';

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
    title: 'Manage products',
  },
  {
    body: 'ดู order ที่จ่ายเงินแล้ว โทรนัดลูกค้า และอัปเดต booking status',
    href: '/admin/orders',
    meta: 'booking',
    title: 'Orders queue',
  },
  {
    body: 'เพิ่มหมอและพนักงานด้วยอีเมล เปลี่ยน role และถอดสิทธิ์โดยไม่ให้ tenant เหลือศูนย์ admin',
    href: '/admin/members',
    meta: 'team access',
    title: 'Team members',
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
    <Screen>
      <BrandHeader
        compact
        eyebrow="Admin panel"
        title="Product, RAG, and booking operations."
        subtitle="ศูนย์กลางสำหรับ admin จัดการสินค้าโรงพยาบาล review RAG และเช็ค order ที่ต้องนัดหมายหลังชำระเงิน"
      />

      {!auth.session ? (
        <Card style={styles.noticeCard}>
          <View style={styles.noticeTop}>
            <Text style={styles.noticeTitle}>ยังไม่ได้ login เป็น admin/staff</Text>
            <Pill label="read only" tone="amber" />
          </View>
          <Text style={styles.body}>หน้า admin panel เปิดให้ดู workflow ได้ แต่ action จริงอย่าง approve, archive, retry embedding และ booking save ต้องใช้ account ที่มีสิทธิ์</Text>
          <Link href={{ pathname: '/', params: { redirect: '/admin-panel' } }} asChild>
            <ActionButton label="Login admin account" />
          </Link>
        </Card>
      ) : null}

      <View style={styles.statGrid}>
        <StatTile detail="products waiting for reviewer action" label="Pending review" value={`${stats.pendingReview}`} />
        <StatTile detail="approved products visible to users" label="Active products" value={`${stats.active}`} />
        <StatTile detail="RAG chunks needing retry" label="Embedding errors" value={`${stats.embeddingErrors}`} />
        <StatTile detail="paid orders awaiting booking call" label="Booking queue" value={`${stats.bookingWaiting}`} />
      </View>

      <SectionHeader title="Admin actions" meta="product + booking" />
      <View style={styles.actionGrid}>
        {adminActions.map((action) => (
          <Link key={action.href} href={action.href} asChild>
            <Pressable style={styles.actionCard}>
              <View style={styles.actionTop}>
                <Text style={styles.actionMeta}>{action.meta}</Text>
                <Text style={styles.actionArrow}>Open</Text>
              </View>
              <Text style={styles.actionTitle}>{action.title}</Text>
              <Text style={styles.body}>{action.body}</Text>
            </Pressable>
          </Link>
        ))}
      </View>

      <SectionHeader title="Product review queue" meta={isLoadingProducts ? 'loading' : `${reviewQueue.length} attention`} />
      <View style={styles.queueList}>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {reviewQueue.length === 0 ? (
          <Card>
            <Text style={styles.emptyTitle}>ยังไม่มีสินค้าใน review queue</Text>
            <Text style={styles.body}>เมื่อ hospital staff submit product ใหม่ หรือ embedding fail รายการจะขึ้นตรงนี้ให้ admin เข้าไปจัดการ</Text>
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

      <SectionHeader title="Booking status preview" meta={`${bookingOrders.length} live order`} />
      <View style={styles.queueList}>
        {bookingOrders.length === 0 ? (
          <Card>
            <Text style={styles.emptyTitle}>ยังไม่มี paid order ใน queue</Text>
            <Text style={styles.body}>เมื่อ Stripe webhook เปลี่ยน order เป็น submitted รายการจะขึ้นที่นี่และใน Orders Queue หลัก</Text>
          </Card>
        ) : (
          bookingOrders.map((order) => {
            const product = embeddedOne(order.products);

            return (
              <Card key={order.id} style={styles.queueCard}>
                <View style={styles.queueTop}>
                  <View style={styles.queueCopy}>
                    <Text style={styles.queueTitle}>{product?.name ?? 'Unknown product'}</Text>
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
  );
}

const styles = StyleSheet.create({
  actionArrow: {
    color: MiraDesign.color.primary,
    fontSize: 12,
    fontWeight: '900',
  },
  actionCard: {
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
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
    color: MiraDesign.color.primaryDeep,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  actionTitle: {
    color: MiraDesign.color.ink,
    fontSize: 18,
    fontWeight: '900',
  },
  actionTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  body: {
    color: MiraDesign.color.inkSoft,
    fontSize: 13,
    lineHeight: 19,
  },
  emptyTitle: {
    color: MiraDesign.color.ink,
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
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '800',
  },
  queueTitle: {
    color: MiraDesign.color.ink,
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
