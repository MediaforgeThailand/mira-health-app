import { useQuery } from '@tanstack/react-query';
import { Link, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { OrderStatusCard } from '@/components/chat/OrderStatusCard';
import { ActionButton, BrandHeader, Card, Screen, SectionHeader, StatTile } from '@/components/MiraUI';
import { MiraDesign } from '@/constants/Design';
import { useAuthSession } from '@/lib/auth/useAuthSession';
import { supabase, supabaseConfigStatus } from '@/lib/supabase';
import type { OrderStatus, OrderStatusInfo } from '@/lib/types/api';

type OrderListRow = {
  amount_baht: number;
  booking_at: string | null;
  branches?: { name: string } | { name: string }[] | null;
  created_at: string;
  id: string;
  products?: { name: string } | { name: string }[] | null;
  status: OrderStatus;
};

const activeStatuses: OrderStatus[] = ['selecting_branch', 'collecting_info', 'awaiting_payment', 'submitted', 'confirmed', 'booked'];

function firstJoin<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function toStatusInfo(row: OrderListRow): OrderStatusInfo {
  return {
    amount_baht: row.amount_baht,
    booking_at: row.booking_at,
    branch_name: firstJoin(row.branches)?.name ?? null,
    created_at: row.created_at,
    id: row.id,
    product_name: firstJoin(row.products)?.name ?? 'สินค้า/บริการ',
    status: row.status,
  };
}

async function loadCustomerOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select('id,status,amount_baht,booking_at,created_at,products(name),branches(name)')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as OrderListRow[]).map(toStatusInfo);
}

export default function OrdersScreen() {
  const auth = useAuthSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ focus?: string; orderId?: string }>();
  const focus = Array.isArray(params.focus) ? params.focus[0] : params.focus;
  const orderId = Array.isArray(params.orderId) ? params.orderId[0] : params.orderId;
  const targetOrderId = focus || orderId;

  const ordersQuery = useQuery({
    enabled: Boolean(auth.session && supabaseConfigStatus.isConfigured),
    queryFn: loadCustomerOrders,
    queryKey: ['customer-orders', auth.user?.id ?? 'anonymous'],
  });

  const orders = useMemo(() => {
    const rows = ordersQuery.data ?? [];

    if (!targetOrderId) {
      return rows;
    }

    return [...rows].sort((left, right) => Number(right.id === targetOrderId) - Number(left.id === targetOrderId));
  }, [ordersQuery.data, targetOrderId]);

  const activeCount = orders.filter((order) => activeStatuses.includes(order.status)).length;
  const completedCount = orders.filter((order) => order.status === 'done').length;
  const cancelledCount = orders.filter((order) => order.status === 'cancelled').length;

  if (!supabaseConfigStatus.isConfigured) {
    return (
      <Screen>
        <BrandHeader eyebrow="Customer Orders" title="คำสั่งซื้อของฉัน" subtitle="ต้องตั้งค่า Supabase public config ก่อนอ่านคำสั่งซื้อจริง" />
        <Card>
          <Text style={styles.noticeTitle}>ยังไม่ได้เชื่อมต่อ backend</Text>
          <Text style={styles.noticeBody}>{supabaseConfigStatus.message}</Text>
        </Card>
      </Screen>
    );
  }

  if (!auth.session) {
    return (
      <Screen>
        <BrandHeader eyebrow="Customer Orders" title="คำสั่งซื้อของฉัน" subtitle="หน้านี้อ่านออเดอร์จริงผ่าน RLS ของบัญชีลูกค้าเท่านั้น" />
        <Card>
          <Text style={styles.noticeTitle}>ต้องเข้าสู่ระบบก่อน</Text>
          <Text style={styles.noticeBody}>เข้าสู่ระบบด้วยบัญชีลูกค้าเพื่อดูคำสั่งซื้อจริงที่ผูกกับบัญชีนี้</Text>
          <ActionButton label="เข้าสู่ระบบลูกค้า" onPress={() => router.push({ pathname: '/login', params: { mode: 'chat', redirect: '/orders' } })} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <BrandHeader
        eyebrow="Customer Orders"
        title="คำสั่งซื้อของฉัน"
        subtitle="รายการจริงจาก backend เดียวกับ AI Chat, referral และ admin order queue"
      />

      <View style={styles.metrics}>
        <StatTile detail="กำลังกรอกข้อมูล รอชำระ รอตรวจ หรือจองแล้ว" label="กำลังดำเนินการ" value={`${activeCount}`} />
        <StatTile detail="ปิดงานเรียบร้อยแล้ว" label="เสร็จสิ้น" value={`${completedCount}`} />
        <StatTile detail="รายการที่ถูกยกเลิก" label="ยกเลิก" value={`${cancelledCount}`} />
      </View>

      <View style={styles.actions}>
        <ActionButton disabled={ordersQuery.isFetching} label={ordersQuery.isFetching ? 'กำลังรีเฟรช' : 'รีเฟรช'} onPress={() => void ordersQuery.refetch()} />
        <Link href={'/chat' as Href} asChild>
          <Pressable style={styles.secondaryAction}>
            <Text style={styles.secondaryActionText}>กลับไปคุยกับ AI</Text>
          </Pressable>
        </Link>
      </View>

      {ordersQuery.error ? (
        <Card>
          <Text style={styles.noticeTitle}>โหลดคำสั่งซื้อไม่สำเร็จ</Text>
          <Text style={styles.noticeBody}>{ordersQuery.error instanceof Error ? ordersQuery.error.message : 'ลองรีเฟรชอีกครั้ง'}</Text>
        </Card>
      ) : null}

      <SectionHeader title="รายการคำสั่งซื้อ" meta={ordersQuery.isLoading ? 'กำลังโหลด' : `${orders.length} รายการ`} />
      {ordersQuery.isLoading ? (
        <Card>
          <Text style={styles.noticeBody}>กำลังอ่านออเดอร์จริงจาก Supabase</Text>
        </Card>
      ) : (
        <OrderStatusCard orders={orders} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: MiraDesign.space.sm,
  },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: MiraDesign.space.md,
  },
  noticeBody: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 14,
    lineHeight: 21,
  },
  noticeTitle: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 18,
    fontWeight: '900',
  },
  secondaryAction: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.showcaseSurface,
    borderColor: '#BBD8F8',
    borderRadius: MiraDesign.radius.sm,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: MiraDesign.space.lg,
  },
  secondaryActionText: {
    color: MiraDesign.color.showcaseBlueDeep,
    fontSize: 15,
    fontWeight: '900',
  },
});
