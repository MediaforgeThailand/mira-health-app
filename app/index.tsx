import { LinearGradient } from 'expo-linear-gradient';
import { Link } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import type { ComponentProps, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { invokeFunction } from '@/lib/api/client';
import { askAiWithRag, aiChatConfigStatus, getCurrentChatSessionId, loadLatestChatHistoryPage, type ChatMessage } from '@/lib/ai/miraChat';
import { useAuthSession } from '@/lib/auth/useAuthSession';
import {
  defaultTenantSlug,
  loadActiveHospitalProducts,
  loadBranches,
  loadManagedHospitalProducts,
  loadPrimaryTenant,
  saveCatalogProduct,
  syncHospitalProductToStripe,
  updateHospitalProductStatus,
  type BranchSummary,
  type HospitalProduct,
  type HospitalProductDraft,
  type HospitalProductStatus,
  type TenantMemberContext,
} from '@/lib/marketplace/hospitalProducts';
import { supabase, supabaseConfigStatus } from '@/lib/supabase';
import type {
  AdminOrderActionRequest,
  AdminSlipUrlResponse,
  ChatMessageRow,
  CommissionEntryRow,
  OrderPanelState,
  OrderRow,
  OrderStatus,
  ReferrerOrderRequest,
  ReferrerOrderResponse,
  ReferrerRow,
} from '@/lib/types/api';

const brandLogo = require('@/assets/images/mira-ai-logo.webp');

type ProductModule = 'referral' | 'admin' | 'chat';
type ReferralView = 'home' | 'share' | 'earnings';
type AdminView = 'dashboard' | 'orders' | 'catalog' | 'referrers' | 'conv' | 'pay' | 'line';
type AdminDevice = 'desktop' | 'mobile';
type OrderFilter = 'all' | 'pending' | 'submitted' | 'confirmed' | 'booked' | 'done' | 'cancelled';
type OrderSort = 'newest' | 'amount_desc' | 'amount_asc';
type PaymentFilter = 'submitted' | 'awaiting' | 'paid' | 'failed' | 'refund';
type ConversationFilter = 'all' | 'line' | 'pwa' | 'app';
type OrderMutationAction = Extract<AdminOrderActionRequest, { action: 'book' | 'cancel' | 'confirm' | 'done' }>['action'];
type SymbolName = ComponentProps<typeof SymbolView>['name'];

type TenantInfo = {
  display_name: string;
  id: string;
  logo_url: string | null;
  role?: string;
  slug: string;
};

function fallbackTenantInfo(): TenantInfo {
  return {
    display_name: 'Mira AI',
    id: '',
    logo_url: null,
    slug: defaultTenantSlug,
  };
}

type ProductJoin = {
  catalog_key: string;
  category: string;
  image_url: string | null;
  name: string;
  price_baht: number;
};

type CustomerJoin = {
  nickname: string | null;
  phone: string | null;
};

type BranchJoin = {
  address: string | null;
  district: string | null;
  name: string;
};

type ReferrerJoin = {
  name: string;
  ref_code: string;
};

type AdminOrderRow = OrderRow & {
  branches?: BranchJoin | BranchJoin[] | null;
  customers?: CustomerJoin | CustomerJoin[] | null;
  products?: ProductJoin | ProductJoin[] | null;
  referrers?: ReferrerJoin | ReferrerJoin[] | null;
};

type CommissionWithJoins = CommissionEntryRow & {
  orders?: {
    amount_baht: number;
    products?: { name: string } | { name: string }[] | null;
  } | {
    amount_baht: number;
    products?: { name: string } | { name: string }[] | null;
  }[] | null;
  referrers?: ReferrerJoin | ReferrerJoin[] | null;
};

type TranscriptRow = Pick<ChatMessageRow, 'content' | 'created_at' | 'id' | 'role'>;

type ConversationCustomerJoin = {
  line_user_id: string | null;
  nickname: string | null;
  phone?: string | null;
};

type ConversationSessionRow = {
  agent_mode: 'ai' | 'human' | null;
  channel: 'app' | 'line' | 'pwa' | string | null;
  customers?: ConversationCustomerJoin | ConversationCustomerJoin[] | null;
  id: string;
  last_message_at: string | null;
};

type CatalogStatusFilter = 'all' | HospitalProductStatus;

const modules: Array<{ id: ProductModule; label: string }> = [
  { id: 'referral', label: 'Referral' },
  { id: 'admin', label: 'Admin Panel' },
  { id: 'chat', label: 'AI Chat' },
];

const emptyCatalogDraft: HospitalProductDraft = {
  branchInfo: '',
  branchIds: [],
  category: 'checkup',
  description: '',
  hospitalAddress: '',
  hospitalMapQuery: '',
  hospitalName: '',
  imageUrl: '',
  priceAmount: '',
  requiresAppointment: true,
  title: '',
};

const catalogStatusFilters: Array<{ id: CatalogStatusFilter; label: string }> = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'active', label: 'เปิดขาย' },
  { id: 'archived', label: 'ปิดขาย' },
  { id: 'draft', label: 'Draft' },
  { id: 'pending_review', label: 'รอตรวจ' },
  { id: 'rejected', label: 'ไม่ผ่าน' },
];

function referralPublicLink(refCode: string) {
  const globalLocation = (globalThis as typeof globalThis & { location?: { origin?: string } }).location;
  const origin = globalLocation?.origin && globalLocation.origin.startsWith('http') ? globalLocation.origin : 'https://mira.ai';

  return `${origin}/r/${encodeURIComponent(refCode)}`;
}

const adminViews: Array<{ icon: SymbolName; id: AdminView; label: string }> = [
  { icon: { android: 'dashboard', ios: 'square.grid.2x2', web: 'dashboard' }, id: 'dashboard', label: 'ภาพรวม' },
  { icon: { android: 'receipt_long', ios: 'doc.text', web: 'receipt_long' }, id: 'orders', label: 'ออเดอร์' },
  { icon: { android: 'inventory_2', ios: 'cube', web: 'inventory_2' }, id: 'catalog', label: 'สินค้าและบริการ' },
  { icon: { android: 'group', ios: 'person.2', web: 'group' }, id: 'referrers', label: 'ผู้แนะนำ' },
  { icon: { android: 'chat_bubble', ios: 'bubble.left.and.bubble.right', web: 'chat_bubble' }, id: 'conv', label: 'บทสนทนา' },
  { icon: { android: 'payments', ios: 'creditcard', web: 'payments' }, id: 'pay', label: 'การชำระเงิน' },
  { icon: { android: 'hub', ios: 'network', web: 'hub' }, id: 'line', label: 'LINE Channel' },
];

const referralViews: Array<{ icon: SymbolName; id: ReferralView; label: string }> = [
  { icon: { android: 'home', ios: 'house', web: 'home' }, id: 'home', label: 'หน้าหลัก' },
  { icon: { android: 'qr_code_2', ios: 'qrcode', web: 'qr_code_2' }, id: 'share', label: 'แชร์' },
  { icon: { android: 'payments', ios: 'creditcard', web: 'payments' }, id: 'earnings', label: 'รายได้' },
];

const orderFilters: Array<{ id: OrderFilter; label: string }> = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'pending', label: 'รอชำระ' },
  { id: 'submitted', label: 'รอตรวจ' },
  { id: 'confirmed', label: 'ยืนยันแล้ว' },
  { id: 'booked', label: 'จองคิว/จัดส่ง' },
  { id: 'done', label: 'เสร็จสิ้น' },
  { id: 'cancelled', label: 'ยกเลิก' },
];

const paymentFilters: Array<{ id: PaymentFilter; label: string }> = [
  { id: 'submitted', label: 'รอตรวจสลิป' },
  { id: 'awaiting', label: 'รอชำระ' },
  { id: 'paid', label: 'ชำระแล้ว' },
  { id: 'failed', label: 'ล้มเหลว' },
  { id: 'refund', label: 'ต้องคืนเงิน' },
];

const conversationFilters: Array<{ id: ConversationFilter; label: string }> = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'line', label: 'LINE' },
  { id: 'pwa', label: 'เว็บ' },
  { id: 'app', label: 'แอป' },
];

const orderSelectColumns = [
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
  'branches(name,address,district)',
  'products(name,catalog_key,category,price_baht,image_url)',
  'customers(nickname,phone)',
  'referrers(name,ref_code)',
].join(',');

function fromJoin<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function formatMoney(amount: number | null | undefined, compact = false) {
  const safeAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  return compact ? `฿${safeAmount.toLocaleString('th-TH')}` : `${safeAmount.toLocaleString('th-TH')} THB`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatShortDate(value: string | null | undefined) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    month: 'short',
  }).format(date);
}

function todayBangkokDateValue() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
  }).formatToParts(new Date());
  const byType = new Map(parts.map((part) => [part.type, part.value]));

  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`;
}

function shiftDateValue(dateValue: string, offsetDays: number) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offsetDays));

  return date.toISOString().slice(0, 10);
}

function bangkokDateKey(value: string | null | undefined) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));

  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`;
}

function bangkokWeekdayLabel(dateValue: string) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const labels = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

  return labels[date.getUTCDay()] ?? '-';
}

function composeBangkokIso(dateValue: string, timeValue: string) {
  const date = dateValue.trim();
  const time = timeValue.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) {
    return null;
  }

  const [hourPart, minutePart] = time.split(':');
  const hour = Number(hourPart);
  const minute = Number(minutePart);

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) {
    return null;
  }

  return `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+07:00`;
}

function productFromOrder(order: AdminOrderRow) {
  return fromJoin(order.products);
}

function orderProductName(order: AdminOrderRow) {
  return productFromOrder(order)?.name ?? 'ไม่พบสินค้า';
}

function orderBuyerName(order: AdminOrderRow) {
  return order.buyer_name || fromJoin(order.customers)?.nickname || 'ไม่ระบุชื่อ';
}

function orderBuyerPhone(order: AdminOrderRow) {
  return order.buyer_phone || fromJoin(order.customers)?.phone || '-';
}

function orderBranchName(order: AdminOrderRow) {
  return fromJoin(order.branches)?.name ?? order.preferred_branch ?? 'ยังไม่ระบุ';
}

function orderReferrerName(order: AdminOrderRow) {
  const referrer = fromJoin(order.referrers);
  return referrer ? `${referrer.name} (${referrer.ref_code})` : '-';
}

function orderKind(order: AdminOrderRow) {
  const product = productFromOrder(order);
  const name = product?.name.toLowerCase() ?? '';
  const category = product?.category.toLowerCase() ?? '';

  return name.includes('kit') || category.includes('product') || category.includes('home') ? 'product' : 'service';
}

function stageForStatus(status: OrderStatus) {
  const map: Record<OrderStatus, number> = {
    awaiting_payment: 2,
    booked: 4,
    cancelled: 0,
    collecting_info: 1,
    confirmed: 3,
    done: 5,
    selecting_branch: 0,
    submitted: 2,
  };

  return map[status];
}

function stepsForOrder(order: AdminOrderRow) {
  return orderKind(order) === 'product'
    ? ['เลือกสินค้า', 'ที่อยู่จัดส่ง', 'รอชำระเงิน', 'ยืนยันแล้ว', 'จัดส่งแล้ว', 'เสร็จสิ้น']
    : ['เลือกสาขา', 'เก็บข้อมูล', 'รอชำระเงิน', 'ยืนยันแล้ว', 'นัดหมายแล้ว', 'เสร็จสิ้น'];
}

function statusMeta(status: OrderStatus, kind: 'product' | 'service' = 'service') {
  if (status === 'cancelled') {
    return { bg: '#F1F5F9', fg: '#64748B', key: 'cancelled' as const, label: 'ยกเลิก' };
  }

  if (status === 'selecting_branch' || status === 'collecting_info') {
    return { bg: '#F1F5F9', fg: '#64748B', key: 'new' as const, label: 'ออเดอร์ใหม่' };
  }

  if (status === 'awaiting_payment') {
    return { bg: 'rgba(245,166,35,0.14)', fg: '#C9810A', key: 'pending' as const, label: 'รอชำระ' };
  }

  if (status === 'submitted') {
    return { bg: 'rgba(245,166,35,0.14)', fg: '#C9810A', key: 'submitted' as const, label: 'รอตรวจชำระ' };
  }

  if (status === 'confirmed') {
    return { bg: 'rgba(37,99,235,0.1)', fg: '#2563EB', key: 'confirmed' as const, label: 'ยืนยันแล้ว' };
  }

  if (status === 'booked') {
    return {
      bg: kind === 'product' ? 'rgba(37,99,235,0.1)' : 'rgba(139,92,246,0.12)',
      fg: kind === 'product' ? '#2563EB' : '#7C3AED',
      key: 'booked' as const,
      label: kind === 'product' ? 'กำลังจัดส่ง' : 'จองคิวแล้ว',
    };
  }

  return { bg: 'rgba(16,185,129,0.12)', fg: '#0F9D70', key: 'done' as const, label: 'เสร็จสิ้น' };
}

function statusFilterKey(order: AdminOrderRow): OrderFilter {
  if (order.status === 'awaiting_payment') {
    return 'pending';
  }

  if (order.status === 'submitted') {
    return 'submitted';
  }

  if (order.status === 'confirmed') {
    return 'confirmed';
  }

  if (order.status === 'booked') {
    return 'booked';
  }

  if (order.status === 'done') {
    return 'done';
  }

  if (order.status === 'cancelled') {
    return 'cancelled';
  }

  return 'all';
}

function primaryActionForOrder(order: AdminOrderRow): OrderMutationAction | null {
  if (order.status === 'submitted') {
    return 'confirm';
  }

  if (order.status === 'confirmed') {
    return 'book';
  }

  if (order.status === 'booked') {
    return 'done';
  }

  return null;
}

function primaryActionLabel(order: AdminOrderRow) {
  const action = primaryActionForOrder(order);

  if (action === 'confirm') {
    return 'ยืนยันการชำระ';
  }

  if (action === 'book') {
    return orderKind(order) === 'product' ? 'บันทึกการจัดส่ง' : 'จองคิว / นัดหมาย';
  }

  if (action === 'done') {
    return orderKind(order) === 'product' ? 'ยืนยันรับสินค้า' : 'ปิดงาน';
  }

  if (order.status === 'awaiting_payment') {
    return 'รอหลักฐานชำระ';
  }

  return 'ดูรายละเอียด';
}

function canCancelOrder(order: AdminOrderRow) {
  return order.status !== 'cancelled' && order.status !== 'done';
}

function channelLabel(channel: OrderRow['channel']) {
  if (channel === 'chat_line') {
    return 'LINE OA';
  }

  if (channel === 'chat_pwa') {
    return 'Web Chat';
  }

  if (channel === 'referrer') {
    return 'Referral';
  }

  return 'AI Chat';
}

function conversationChannelLabel(channel: ConversationSessionRow['channel']) {
  if (channel === 'line') {
    return 'LINE';
  }

  if (channel === 'pwa') {
    return 'เว็บ';
  }

  if (channel === 'app') {
    return 'แอป';
  }

  return channel ?? 'อื่น ๆ';
}

function conversationChannelTone(channel: ConversationSessionRow['channel']) {
  if (channel === 'line') {
    return { bg: 'rgba(6,199,85,0.12)', fg: '#06A04A' };
  }

  if (channel === 'pwa') {
    return { bg: 'rgba(37,99,235,0.1)', fg: '#2563EB' };
  }

  if (channel === 'app') {
    return { bg: 'rgba(139,92,246,0.12)', fg: '#7C3AED' };
  }

  return { bg: '#F1F5F9', fg: '#64748B' };
}

function conversationCustomerName(row: ConversationSessionRow | null) {
  const customer = fromJoin(row?.customers);

  return customer?.nickname?.trim() || customer?.phone?.trim() || (row?.channel === 'line' ? 'ลูกค้า LINE' : 'ลูกค้า');
}

function paymentFilterKey(order: AdminOrderRow): PaymentFilter {
  if (order.status === 'submitted') {
    return 'submitted';
  }

  if (order.status === 'awaiting_payment') {
    return 'awaiting';
  }

  if (order.status === 'cancelled' && order.paid_at) {
    return 'refund';
  }

  if (order.status === 'cancelled') {
    return 'failed';
  }

  if (order.status === 'confirmed' || order.status === 'booked' || order.status === 'done') {
    return 'paid';
  }

  return 'awaiting';
}

function paymentStatusLabel(order: AdminOrderRow) {
  const key = paymentFilterKey(order);

  if (key === 'submitted') {
    return 'รอตรวจสลิป';
  }

  if (key === 'awaiting') {
    return 'รอชำระ';
  }

  if (key === 'paid') {
    return 'ชำระแล้ว';
  }

  if (key === 'refund') {
    return 'ต้องคืนเงิน';
  }

  return 'ล้มเหลว';
}

function paymentStatusTone(order: AdminOrderRow) {
  const key = paymentFilterKey(order);

  if (key === 'submitted' || key === 'awaiting') {
    return { bg: '#FDF1DE', fg: '#C9810A' };
  }

  if (key === 'paid') {
    return { bg: 'rgba(16,185,129,0.12)', fg: '#0F9D70' };
  }

  if (key === 'refund') {
    return { bg: 'rgba(139,92,246,0.12)', fg: '#7C3AED' };
  }

  return { bg: '#F1F5F9', fg: '#64748B' };
}

function activeProductBranches(product: HospitalProduct | null) {
  return product?.branches.filter((branch) => branch.active) ?? [];
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

function catalogStatusLabel(status: HospitalProductStatus) {
  if (status === 'active') {
    return 'เปิดขาย';
  }

  if (status === 'archived') {
    return 'ปิดขาย';
  }

  if (status === 'pending_review') {
    return 'รอตรวจ';
  }

  if (status === 'rejected') {
    return 'ไม่ผ่าน';
  }

  return 'Draft';
}

function catalogStatusTone(status: HospitalProductStatus) {
  if (status === 'active') {
    return { bg: 'rgba(16,185,129,0.12)', fg: '#0F9D70' };
  }

  if (status === 'archived') {
    return { bg: '#F1F5F9', fg: '#64748B' };
  }

  if (status === 'rejected') {
    return { bg: '#FEF2F2', fg: '#DC2626' };
  }

  return { bg: 'rgba(245,158,11,0.14)', fg: '#B45309' };
}

function draftFromCatalogProduct(product: HospitalProduct): HospitalProductDraft {
  return {
    branchInfo: product.hospitalAddress ?? '',
    branchIds: product.branchIds,
    category: product.category,
    description: product.description,
    hospitalAddress: product.hospitalAddress ?? '',
    hospitalMapQuery: product.hospitalMapQuery ?? product.hospitalAddress ?? '',
    hospitalName: product.hospitalName,
    imageUrl: product.imageUrl ?? '',
    priceAmount: String(product.priceAmount || ''),
    requiresAppointment: product.requiresAppointment,
    title: product.title,
  };
}

function shortName(value: string) {
  const parts = value.trim().split(/\s+/);

  if (parts.length <= 1) {
    return value;
  }

  return `${parts[0]} ${parts[1]?.charAt(0) ?? ''}.`;
}

function textInitial(value: string | null | undefined) {
  return value?.trim().charAt(0) || 'ม';
}

function copyText(text: string) {
  const maybeNavigator = globalThis as typeof globalThis & {
    navigator?: {
      clipboard?: {
        writeText?: (value: string) => Promise<void>;
      };
    };
  };

  return maybeNavigator.navigator?.clipboard?.writeText?.(text) ?? Promise.resolve();
}

function connectionLabel() {
  if (!supabaseConfigStatus.isConfigured) {
    return 'Backend setup required';
  }

  if (!aiChatConfigStatus.hasSupabaseProxy) {
    return 'Backend ready · AI proxy setup required';
  }

  return 'Backend + AI ready';
}

function Icon({ color = '#5A6B86', name, size = 18 }: { color?: string; name: SymbolName; size?: number }) {
  return <SymbolView name={name} size={size} tintColor={color} />;
}

function Pill({ bg, children, fg }: { bg: string; children: ReactNode; fg: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]}>{children}</Text>
    </View>
  );
}

function EmptyState({ detail, title }: { detail: string; title: string }) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyMark} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDetail}>{detail}</Text>
    </View>
  );
}

export default function MiraPlatformScreen() {
  const auth = useAuthSession();
  const { width } = useWindowDimensions();
  const [webViewportWidth, setWebViewportWidth] = useState<number | null>(null);
  const [hasMeasuredViewport, setHasMeasuredViewport] = useState(false);
  const viewportWidth = hasMeasuredViewport
    ? webViewportWidth
      ? Math.min(width || webViewportWidth, webViewportWidth)
      : width
    : 0;
  const [module, setModule] = useState<ProductModule>('admin');
  const [referralView, setReferralView] = useState<ReferralView>('home');
  const [adminView, setAdminView] = useState<AdminView>('dashboard');
  const [adminDevice, setAdminDevice] = useState<AdminDevice>('desktop');
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [tenantMember, setTenantMember] = useState<TenantMemberContext | null>(null);
  const [products, setProducts] = useState<HospitalProduct[]>([]);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [referrers, setReferrers] = useState<ReferrerRow[]>([]);
  const [commissions, setCommissions] = useState<CommissionWithJoins[]>([]);
  const [myReferrer, setMyReferrer] = useState<ReferrerRow | null>(null);
  const [myCommissions, setMyCommissions] = useState<CommissionWithJoins[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedStage, setSelectedStage] = useState<number | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(() => new Set());
  const [orderSearch, setOrderSearch] = useState('');
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('all');
  const [orderSort, setOrderSort] = useState<OrderSort>('newest');
  const [transcript, setTranscript] = useState<TranscriptRow[]>([]);
  const [bookingDate, setBookingDate] = useState(todayBangkokDateValue());
  const [bookingTime, setBookingTime] = useState('09:00');
  const [adminNote, setAdminNote] = useState('');
  const [busyOrderAction, setBusyOrderAction] = useState<OrderMutationAction | 'bulk' | 'note' | 'slip' | null>(null);
  const [signedSlipUrls, setSignedSlipUrls] = useState<Record<string, string>>({});
  const [refBuyerName, setRefBuyerName] = useState('');
  const [refBuyerPhone, setRefBuyerPhone] = useState('');
  const [refBuyerAge, setRefBuyerAge] = useState('');
  const [refPreferredDate, setRefPreferredDate] = useState('');
  const [refProductId, setRefProductId] = useState('');
  const [refBranchId, setRefBranchId] = useState('');
  const [referralOrder, setReferralOrder] = useState<OrderPanelState>(null);
  const [referralBusy, setReferralBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('submitted');
  const [conversationFilter, setConversationFilter] = useState<ConversationFilter>('all');
  const [conversationSessions, setConversationSessions] = useState<ConversationSessionRow[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [conversationMessages, setConversationMessages] = useState<TranscriptRow[]>([]);
  const [conversationInput, setConversationInput] = useState('');
  const [conversationBusy, setConversationBusy] = useState<'load' | 'mode' | 'reply' | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [lineTestText, setLineTestText] = useState('');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogStatusFilter, setCatalogStatusFilter] = useState<CatalogStatusFilter>('all');
  const [catalogEditorOpen, setCatalogEditorOpen] = useState(false);
  const [editingCatalogProduct, setEditingCatalogProduct] = useState<HospitalProduct | null>(null);
  const [catalogDraft, setCatalogDraft] = useState<HospitalProductDraft>(emptyCatalogDraft);
  const [catalogBusy, setCatalogBusy] = useState<'refresh' | 'save' | 'status' | 'stripe' | null>(null);
  const [catalogMessage, setCatalogMessage] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    setHasMeasuredViewport(true);

    if (typeof window === 'undefined') {
      return undefined;
    }

    const updateWidth = () => setWebViewportWidth(window.innerWidth);
    updateWidth();
    window.addEventListener('resize', updateWidth);

    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  const isCompact = viewportWidth > 0 && viewportWidth < 760;
  const isNarrowDesktop = viewportWidth > 0 && viewportWidth < 1120;
  const phoneFrameWidth = useMemo(() => {
    const baseWidth = viewportWidth > 0 ? viewportWidth : 392;
    const availableWidth = Math.max(252, baseWidth - (isCompact ? 70 : 88));

    return isCompact ? Math.min(280, availableWidth) : Math.min(392, Math.max(320, availableWidth));
  }, [isCompact, viewportWidth]);
  const phoneFrameStyle = useMemo(
    () => ({
      height: Math.round(phoneFrameWidth * (806 / 392)),
      width: phoneFrameWidth,
    }),
    [phoneFrameWidth],
  );
  const backendReady = supabaseConfigStatus.isConfigured;
  const activeTenantSlug = tenant?.slug ?? defaultTenantSlug;
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, '') ?? '';
  const lineWebhookUrl = supabaseUrl ? `${supabaseUrl}/functions/v1/line-webhook?tenant=${encodeURIComponent(activeTenantSlug)}` : `https://<supabase-project>.supabase.co/functions/v1/line-webhook?tenant=${encodeURIComponent(activeTenantSlug)}`;
  const selectedOrder = useMemo(() => orders.find((order) => order.id === selectedOrderId) ?? null, [orders, selectedOrderId]);
  const selectedConversation = useMemo(() => conversationSessions.find((session) => session.id === selectedConversationId) ?? null, [conversationSessions, selectedConversationId]);
  const selectedReferralProduct = products.find((product) => product.id === refProductId || product.catalogKey === refProductId) ?? products[0] ?? null;
  const referralBranches = activeProductBranches(selectedReferralProduct);
  const selectedReferralBranch = referralBranches.find((branch) => branch.id === refBranchId) ?? referralBranches[0] ?? null;
  const canUseAdminActions = backendReady && Boolean(auth.session) && Boolean(tenantMember);
  const isAdminWritable = tenantMember?.role === 'superadmin' || tenantMember?.role === 'tenant_admin';
  const canEditCatalog = canUseAdminActions && isAdminWritable;
  const filteredCatalogProducts = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase();

    return products.filter((product) => {
      const statusMatches = catalogStatusFilter === 'all' || product.status === catalogStatusFilter;
      const queryMatches = !query || [
        product.title,
        product.catalogKey,
        product.category,
        product.description,
        product.hospitalName,
        product.hospitalAddress ?? '',
        product.branches.map((branch) => branch.name).join(' '),
      ].join(' ').toLowerCase().includes(query);

      return statusMatches && queryMatches;
    });
  }, [catalogSearch, catalogStatusFilter, products]);
  const catalogCounts = useMemo(
    () => catalogStatusFilters.reduce<Record<CatalogStatusFilter, number>>((acc, filter) => {
      acc[filter.id] = filter.id === 'all' ? products.length : products.filter((product) => product.status === filter.id).length;
      return acc;
    }, {} as Record<CatalogStatusFilter, number>),
    [products],
  );

  const refreshOrders = useCallback(
    async (tenantId = tenant?.id) => {
      if (!tenantId) {
        return;
      }

      const { data, error } = await supabase
        .from('orders')
        .select(orderSelectColumns)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        throw new Error(error.message);
      }

      setOrders((data ?? []) as unknown as AdminOrderRow[]);
    },
    [tenant?.id],
  );

  const refreshConversations = useCallback(
    async (tenantId = tenant?.id) => {
      if (!tenantId || !backendReady || !auth.session) {
        setConversationSessions([]);
        return;
      }

      setConversationBusy((current) => current ?? 'load');
      setConversationError(null);

      try {
        let query = supabase
          .from('chat_sessions')
          .select('id,agent_mode,channel,last_message_at,customers(nickname,phone,line_user_id)')
          .eq('tenant_id', tenantId)
          .order('last_message_at', { ascending: false })
          .limit(80);

        if (conversationFilter !== 'all') {
          query = query.eq('channel', conversationFilter);
        }

        const { data, error } = await query;

        if (error) {
          throw new Error(error.message);
        }

        const nextRows = (data ?? []) as unknown as ConversationSessionRow[];
        setConversationSessions(nextRows);
        setSelectedConversationId((current) => current && nextRows.some((row) => row.id === current) ? current : nextRows[0]?.id ?? null);
      } catch (error) {
        setConversationSessions([]);
        setConversationError(error instanceof Error ? error.message : 'โหลดบทสนทนาไม่สำเร็จ');
      } finally {
        setConversationBusy((current) => current === 'load' ? null : current);
      }
    },
    [auth.session, backendReady, conversationFilter, tenant?.id],
  );

  const refreshCatalog = useCallback(async () => {
    if (!tenantMember) {
      return;
    }

    setCatalogBusy('refresh');
    setCatalogError(null);

    try {
      const [nextProducts, nextBranches] = await Promise.all([
        loadManagedHospitalProducts(80),
        loadBranches(),
      ]);

      setProducts(nextProducts);
      setBranches(nextBranches);
      setCatalogMessage('รีเฟรช catalog จาก backend แล้ว');
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : 'รีเฟรชสินค้าไม่สำเร็จ');
    } finally {
      setCatalogBusy(null);
    }
  }, [tenantMember]);

  function updateCatalogDraft<K extends keyof HospitalProductDraft>(field: K, value: HospitalProductDraft[K]) {
    setCatalogDraft((current) => ({ ...current, [field]: value }));
  }

  function openNewCatalogProduct() {
    setEditingCatalogProduct(null);
    setCatalogDraft({
      ...emptyCatalogDraft,
      hospitalName: tenant?.display_name ?? '',
    });
    setCatalogEditorOpen(true);
    setCatalogMessage(null);
    setCatalogError(null);
  }

  function editCatalogProduct(product: HospitalProduct) {
    setEditingCatalogProduct(product);
    setCatalogDraft(draftFromCatalogProduct(product));
    setCatalogEditorOpen(true);
    setCatalogMessage(null);
    setCatalogError(null);
  }

  function mergeCatalogProduct(product: HospitalProduct) {
    setProducts((current) =>
      current.some((item) => item.id === product.id)
        ? current.map((item) => (item.id === product.id ? product : item))
        : [product, ...current],
    );
    setEditingCatalogProduct((current) => current?.id === product.id ? product : current);
  }

  function toggleCatalogDraftBranch(branchId: string) {
    setCatalogDraft((current) => {
      const currentIds = current.branchIds ?? [];
      const branchIds = currentIds.includes(branchId) ? currentIds.filter((id) => id !== branchId) : [...currentIds, branchId];

      return { ...current, branchIds };
    });
  }

  async function saveCatalogDraft() {
    if (!canEditCatalog || catalogBusy) {
      return;
    }

    if (!catalogDraft.title.trim() || !catalogDraft.description.trim() || Number(catalogDraft.priceAmount) <= 0) {
      setCatalogError('กรอกชื่อสินค้า รายละเอียด และราคามากกว่า 0 ก่อนบันทึก');
      return;
    }

    setCatalogBusy('save');
    setCatalogError(null);
    setCatalogMessage(null);

    try {
      const result = await saveCatalogProduct(catalogDraft, editingCatalogProduct?.id);
      mergeCatalogProduct(result.product);
      setCatalogDraft(draftFromCatalogProduct(result.product));
      setEditingCatalogProduct(result.product);
      setCatalogMessage(`บันทึก ${result.product.title} แล้ว`);
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : 'บันทึกสินค้าไม่สำเร็จ');
    } finally {
      setCatalogBusy(null);
    }
  }

  async function changeCatalogStatus(product: HospitalProduct, nextStatus: HospitalProductStatus) {
    if (!canEditCatalog || catalogBusy) {
      return;
    }

    setCatalogBusy('status');
    setCatalogError(null);
    setCatalogMessage(null);

    try {
      const updated = await updateHospitalProductStatus(product, nextStatus);
      mergeCatalogProduct(updated);
      setCatalogMessage(`${updated.title}: ${catalogStatusLabel(updated.status)}`);
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : 'เปลี่ยนสถานะสินค้าไม่สำเร็จ');
    } finally {
      setCatalogBusy(null);
    }
  }

  async function syncCatalogStripe(product: HospitalProduct) {
    if (!canEditCatalog || catalogBusy) {
      return;
    }

    setCatalogBusy('stripe');
    setCatalogError(null);
    setCatalogMessage(null);

    try {
      const result = await syncHospitalProductToStripe(product);
      mergeCatalogProduct(result.product);
      setCatalogMessage(`Stripe synced: ${result.summary}`);
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : 'ซิงก์ Stripe ไม่สำเร็จ');
    } finally {
      setCatalogBusy(null);
    }
  }

  useEffect(() => {
    let isMounted = true;

    async function boot() {
      if (auth.isLoading) {
        return;
      }

      setDataLoading(true);
      setGlobalError(null);
      setNotice(null);

      if (!backendReady) {
        setTenant(null);
        setTenantMember(null);
        setProducts([]);
        setBranches([]);
        setOrders([]);
        setReferrers([]);
        setCommissions([]);
        setMyReferrer(null);
        setMyCommissions([]);
        setDataLoading(false);
        return;
      }

      try {
        const tenantRow = await loadPrimaryTenant(defaultTenantSlug);

        if (!tenantRow) {
          if (!isMounted) {
            return;
          }

          setTenant(fallbackTenantInfo());
          setTenantMember(null);
          setProducts([]);
          setBranches([]);
          setOrders([]);
          setReferrers([]);
          setCommissions([]);
          setMyReferrer(null);
          setMyCommissions([]);
          setDataLoading(false);
          return;
        }

        const nextTenant = tenantRow as TenantInfo;
        let nextTenantMember: TenantMemberContext | null = null;
        let nextProducts: HospitalProduct[] = [];
        let nextBranches: BranchSummary[] = [];
        let nextOrders: AdminOrderRow[] = [];
        let nextReferrers: ReferrerRow[] = [];
        let nextCommissions: CommissionWithJoins[] = [];
        let nextMyReferrer: ReferrerRow | null = null;
        let nextMyCommissions: CommissionWithJoins[] = [];

        if (auth.user) {
          const { data: member } = await supabase
            .from('tenant_members')
            .select('role')
            .eq('tenant_id', nextTenant.id)
            .eq('auth_user_id', auth.user.id)
            .maybeSingle();

          if (member) {
            nextTenantMember = {
              ...(nextTenant as TenantMemberContext),
              role: String((member as { role: string }).role),
            };
          }

          const { data: referrerRow, error: referrerError } = await supabase
            .from('referrers')
            .select('id,tenant_id,ref_code,name,type,phone,auth_user_id,commission_scheme,active,created_at')
            .eq('tenant_id', nextTenant.id)
            .eq('auth_user_id', auth.user.id)
            .eq('active', true)
            .maybeSingle();

          if (referrerError) {
            throw new Error(referrerError.message);
          }

          nextMyReferrer = (referrerRow as ReferrerRow | null) ?? null;

          if (nextMyReferrer) {
            const { data: myCommissionRows, error: myCommissionError } = await supabase
              .from('commission_entries')
              .select('id,tenant_id,referrer_id,order_id,scheme_snapshot,amount_baht,status,created_at,orders(amount_baht,products(name))')
              .eq('referrer_id', nextMyReferrer.id)
              .order('created_at', { ascending: false })
              .limit(60);

            if (myCommissionError) {
              throw new Error(myCommissionError.message);
            }

            nextMyCommissions = (myCommissionRows ?? []) as unknown as CommissionWithJoins[];
          }
        }

        if (nextTenantMember) {
          [nextProducts, nextBranches] = await Promise.all([
            loadManagedHospitalProducts(80),
            loadBranches(),
          ]);
        } else {
          nextProducts = await loadActiveHospitalProducts(40);
        }

        if (nextTenantMember) {
          const { data: orderRows, error: orderError } = await supabase
            .from('orders')
            .select(orderSelectColumns)
            .eq('tenant_id', nextTenant.id)
            .order('created_at', { ascending: false })
            .limit(100);

          if (orderError) {
            throw new Error(orderError.message);
          }

          const { data: referrerRows, error: adminReferrerError } = await supabase
            .from('referrers')
            .select('id,tenant_id,ref_code,name,type,phone,auth_user_id,commission_scheme,active,created_at')
            .eq('tenant_id', nextTenant.id)
            .order('created_at', { ascending: false });

          if (adminReferrerError) {
            throw new Error(adminReferrerError.message);
          }

          const { data: commissionRows, error: commissionError } = await supabase
            .from('commission_entries')
            .select('id,tenant_id,referrer_id,order_id,scheme_snapshot,amount_baht,status,created_at,referrers(name,ref_code),orders(amount_baht,products(name))')
            .eq('tenant_id', nextTenant.id)
            .order('created_at', { ascending: false })
            .limit(100);

          if (commissionError) {
            throw new Error(commissionError.message);
          }

          nextOrders = (orderRows ?? []) as unknown as AdminOrderRow[];
          nextReferrers = (referrerRows ?? []) as unknown as ReferrerRow[];
          nextCommissions = (commissionRows ?? []) as unknown as CommissionWithJoins[];
        }

        if (!isMounted) {
          return;
        }

        setTenant(nextTenant);
        setTenantMember(nextTenantMember);
        setProducts(nextProducts);
        setBranches(nextBranches);
        setOrders(nextOrders);
        setReferrers(nextReferrers);
        setCommissions(nextCommissions);
        setMyReferrer(nextMyReferrer);
        setMyCommissions(nextMyCommissions);
        setRefProductId((current) => current || nextProducts[0]?.id || nextProducts[0]?.catalogKey || '');

        if (auth.user && !nextTenantMember && !nextMyReferrer) {
          setNotice('บัญชีนี้ยังไม่ถูกผูกกับ Admin หรือ Referral profile ของ tenant นี้');
        }
      } catch (error) {
        if (isMounted) {
          setTenant(null);
          setTenantMember(null);
          setProducts([]);
          setBranches([]);
          setOrders([]);
          setReferrers([]);
          setCommissions([]);
          setMyReferrer(null);
          setMyCommissions([]);
          setGlobalError(error instanceof Error ? error.message : 'โหลดข้อมูล live backend ไม่สำเร็จ');
        }
      } finally {
        if (isMounted) {
          setDataLoading(false);
        }
      }
    }

    void boot();

    return () => {
      isMounted = false;
    };
  }, [auth.isLoading, auth.session, auth.user, backendReady]);

  useEffect(() => {
    if (!tenantMember || !backendReady || !auth.session) {
      return undefined;
    }

    const channel = supabase
      .channel(`mira-redesign-orders-${tenantMember.id}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          filter: `tenant_id=eq.${tenantMember.id}`,
          schema: 'public',
          table: 'orders',
        },
        () => {
          void refreshOrders(tenantMember.id);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [auth.session, backendReady, refreshOrders, tenantMember]);

  useEffect(() => {
    if (!selectedOrder) {
      setSelectedStage(null);
      setTranscript([]);
      setAdminNote('');
      return;
    }

    setSelectedStage(stageForStatus(selectedOrder.status));
    setAdminNote(selectedOrder.admin_note ?? '');

    if (selectedOrder.booking_at) {
      const date = new Date(selectedOrder.booking_at);

      if (!Number.isNaN(date.getTime())) {
        const parts = new Intl.DateTimeFormat('en-GB', {
          day: '2-digit',
          hour: '2-digit',
          hourCycle: 'h23',
          minute: '2-digit',
          month: '2-digit',
          timeZone: 'Asia/Bangkok',
          year: 'numeric',
        }).formatToParts(date);
        const byType = new Map(parts.map((part) => [part.type, part.value]));
        setBookingDate(`${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`);
        setBookingTime(`${byType.get('hour')}:${byType.get('minute')}`);
      }
    } else {
      setBookingDate(todayBangkokDateValue());
      setBookingTime('09:00');
    }
  }, [selectedOrder]);

  useEffect(() => {
    if (!selectedOrder?.session_id) {
      setTranscript([]);
      return undefined;
    }

    let isMounted = true;

    async function loadTranscript() {
      const { data } = await supabase
        .from('chat_messages')
        .select('id,role,content,created_at')
        .eq('session_id', selectedOrder?.session_id)
        .order('created_at', { ascending: true })
        .limit(80);

      if (isMounted) {
        setTranscript((data ?? []) as unknown as TranscriptRow[]);
      }
    }

    void loadTranscript();

    return () => {
      isMounted = false;
    };
  }, [selectedOrder?.session_id]);

  useEffect(() => {
    if (adminView !== 'conv' && adminView !== 'line') {
      return undefined;
    }

    void refreshConversations();
    const timer = setInterval(() => {
      void refreshConversations();
    }, 9000);

    return () => clearInterval(timer);
  }, [adminView, refreshConversations]);

  useEffect(() => {
    if (!selectedConversationId || adminView !== 'conv') {
      setConversationMessages([]);
      return undefined;
    }

    let isMounted = true;

    async function loadConversationMessages() {
      setConversationError(null);

      const { data, error } = await supabase
        .from('chat_messages')
        .select('id,role,content,created_at')
        .eq('session_id', selectedConversationId)
        .order('created_at', { ascending: false })
        .limit(120);

      if (!isMounted) {
        return;
      }

      if (error) {
        setConversationMessages([]);
        setConversationError(error.message);
        return;
      }

      setConversationMessages(((data ?? []) as unknown as TranscriptRow[]).reverse());
    }

    void loadConversationMessages();
    const timer = setInterval(() => {
      void loadConversationMessages();
    }, 6000);

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [adminView, selectedConversationId]);

  useEffect(() => {
    if (!selectedReferralProduct) {
      setRefBranchId('');
      return;
    }

    setRefBranchId((current) => current || activeProductBranches(selectedReferralProduct)[0]?.id || '');
  }, [selectedReferralProduct]);

  useEffect(() => {
    if (module !== 'chat' || chatMessages.length > 0 || !backendReady) {
      return undefined;
    }

    let isMounted = true;

    async function loadChat() {
      try {
        const page = await loadLatestChatHistoryPage(24);

        if (!isMounted) {
          return;
        }

        if (page.messages.length > 0) {
          setChatMessages(page.messages);
          setChatSessionId(page.sessionId ?? getCurrentChatSessionId());
        } else {
          setChatMessages([
            {
              content: 'สวัสดีค่ะ ฉันคือ Mira AI ผู้ช่วยขายอัจฉริยะ บอกเป้าหมาย งบประมาณ หรือแพ็กเกจที่สนใจได้เลย',
              createdAt: new Date().toISOString(),
              id: 'welcome',
              role: 'assistant',
              uiCards: products.length
                ? [
                    {
                      id: 'live-catalog-preview',
                      products: products.slice(0, 3).map((product) => ({
                        category: product.category,
                        description: product.description,
                        hospitalName: product.hospitalName,
                        id: product.id,
                        includes: product.includes,
                        priceAmount: product.priceAmount,
                        productImagePreviewUri: product.productImagePreviewUri,
                        tags: product.tags,
                        title: product.title,
                      })),
                      title: 'สินค้าขายดีจาก catalog จริง',
                      type: 'product_grid',
                    },
                  ]
                : [],
            },
          ]);
        }
      } catch {
        if (isMounted) {
          setChatMessages([
            {
              content: 'ยังโหลดประวัติแชตไม่ได้ แต่สามารถส่งข้อความใหม่ได้เมื่อ backend และ AI proxy พร้อม',
              createdAt: new Date().toISOString(),
              id: 'chat-history-error',
              role: 'system_notice',
            },
          ]);
        }
      }
    }

    void loadChat();

    return () => {
      isMounted = false;
    };
  }, [backendReady, chatMessages.length, module, products]);

  const orderCounts = useMemo(() => {
    const counts: Record<OrderFilter, number> = {
      all: orders.length,
      booked: 0,
      cancelled: 0,
      confirmed: 0,
      done: 0,
      pending: 0,
      submitted: 0,
    };

    for (const order of orders) {
      const key = statusFilterKey(order);

      if (key !== 'all') {
        counts[key] += 1;
      }
    }

    return counts;
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const needle = orderSearch.trim().toLowerCase();
    const rows = orders.filter((order) => {
      const haystack = [
        order.id,
        orderBuyerName(order),
        orderBuyerPhone(order),
        orderProductName(order),
        orderBranchName(order),
        orderReferrerName(order),
        channelLabel(order.channel),
        statusMeta(order.status, orderKind(order)).label,
      ]
        .join(' ')
        .toLowerCase();

      return (orderFilter === 'all' || statusFilterKey(order) === orderFilter) && (!needle || haystack.includes(needle));
    });

    return [...rows].sort((left, right) => {
      if (orderSort === 'amount_desc') {
        return right.amount_baht - left.amount_baht;
      }

      if (orderSort === 'amount_asc') {
        return left.amount_baht - right.amount_baht;
      }

      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    });
  }, [orderFilter, orderSearch, orderSort, orders]);

  const paymentCounts = useMemo(() => {
    const counts: Record<PaymentFilter, number> = {
      awaiting: 0,
      failed: 0,
      paid: 0,
      refund: 0,
      submitted: 0,
    };

    for (const order of orders) {
      counts[paymentFilterKey(order)] += 1;
    }

    return counts;
  }, [orders]);

  const paymentRows = useMemo(
    () => orders.filter((order) => paymentFilterKey(order) === paymentFilter),
    [orders, paymentFilter],
  );

  const selectedPaymentOrder = useMemo(
    () => (selectedOrder && paymentRows.some((order) => order.id === selectedOrder.id) ? selectedOrder : paymentRows[0] ?? null),
    [paymentRows, selectedOrder],
  );

  const dashboardStats = useMemo(() => {
    const paidOrders = orders.filter((order) => ['submitted', 'confirmed', 'booked', 'done'].includes(order.status));
    const revenue = paidOrders.reduce((sum, order) => sum + order.amount_baht, 0);
    const pending = orders.filter((order) => order.status === 'awaiting_payment' || order.status === 'submitted').length;
    const activeReferrers = referrers.filter((referrer) => referrer.active).length;
    const totalCommission = commissions.reduce((sum, entry) => sum + entry.amount_baht, 0);
    const activeProducts = products.filter((product) => product.status === 'active').length;

    return {
      activeProducts,
      activeReferrers,
      paidOrders: paidOrders.length,
      pending,
      revenue,
      totalCommission,
    };
  }, [commissions, orders, products, referrers]);

  const referralTotals = useMemo(
    () => ({
      approved: myCommissions.filter((entry) => entry.status === 'approved').reduce((sum, entry) => sum + entry.amount_baht, 0),
      paid: myCommissions.filter((entry) => entry.status === 'paid').reduce((sum, entry) => sum + entry.amount_baht, 0),
      pending: myCommissions.filter((entry) => entry.status === 'pending').reduce((sum, entry) => sum + entry.amount_baht, 0),
    }),
    [myCommissions],
  );

  const selectedOrders = useMemo(() => orders.filter((order) => selectedOrderIds.has(order.id)), [orders, selectedOrderIds]);

  function toggleOrderSelection(orderId: string) {
    setSelectedOrderIds((current) => {
      const next = new Set(current);

      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }

      return next;
    });
  }

  async function runOrderAction(order: AdminOrderRow, action: OrderMutationAction) {
    if (!canUseAdminActions || busyOrderAction) {
      setNotice('ต้องเข้าสู่ระบบด้วยบัญชีทีมงานที่อยู่ใน tenant ก่อนดำเนินการ');
      return;
    }

    const bookingAt = action === 'book' ? composeBangkokIso(bookingDate, bookingTime) : undefined;

    if (action === 'book' && !bookingAt) {
      setGlobalError('กรุณาระบุวันและเวลาเป็นรูปแบบ YYYY-MM-DD และ HH:mm ก่อนบันทึกนัดหมาย');
      return;
    }

    try {
      setBusyOrderAction(action);
      setGlobalError(null);
      setNotice(null);
      const result = await invokeFunction<AdminOrderActionRequest, { order: OrderRow }>('admin-order-action', {
        action,
        booking_at: bookingAt ?? undefined,
        note: adminNote.trim() || undefined,
        order_id: order.id,
      });
      await refreshOrders(result.order.tenant_id);
      setNotice(`อัปเดตออเดอร์ ${order.id} แล้ว`);
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : 'อัปเดตออเดอร์ไม่สำเร็จ');
    } finally {
      setBusyOrderAction(null);
    }
  }

  async function saveOrderNote() {
    if (!selectedOrder || !canUseAdminActions || busyOrderAction) {
      return;
    }

    if (!adminNote.trim()) {
      setGlobalError('กรุณากรอกโน้ตภายในก่อนบันทึก');
      return;
    }

    try {
      setBusyOrderAction('note');
      setGlobalError(null);
      const result = await invokeFunction<AdminOrderActionRequest, { order: OrderRow }>('admin-order-action', {
        action: 'note',
        note: adminNote.trim(),
        order_id: selectedOrder.id,
      });
      await refreshOrders(result.order.tenant_id);
      setNotice('บันทึกโน้ตภายในแล้ว');
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : 'บันทึกโน้ตไม่สำเร็จ');
    } finally {
      setBusyOrderAction(null);
    }
  }

  async function requestSlipUrl(order: AdminOrderRow) {
    if (!canUseAdminActions || busyOrderAction) {
      return;
    }

    try {
      setBusyOrderAction('slip');
      setGlobalError(null);
      const signed = await invokeFunction<Extract<AdminOrderActionRequest, { action: 'slip_url' }>, AdminSlipUrlResponse>('admin-order-action', {
        action: 'slip_url',
        order_id: order.id,
      });

      setSignedSlipUrls((current) => ({
        ...current,
        [order.id]: signed.signed_url ?? '',
      }));
      setNotice(signed.signed_url ? 'สร้างลิงก์ดูสลิปแล้ว' : 'ออเดอร์นี้ยังไม่มีสลิป');
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : 'เปิดสลิปไม่สำเร็จ');
    } finally {
      setBusyOrderAction(null);
    }
  }

  async function runBulk(kind: 'cancel' | 'confirm') {
    if (!canUseAdminActions || selectedOrders.length === 0 || busyOrderAction) {
      return;
    }

    const action: OrderMutationAction = kind === 'confirm' ? 'confirm' : 'cancel';
    const targets = selectedOrders.filter((order) => {
      if (action === 'confirm') {
        return order.status === 'submitted';
      }

      return canCancelOrder(order);
    });

    if (targets.length === 0) {
      setGlobalError(kind === 'confirm' ? 'ไม่มีออเดอร์ที่อยู่สถานะรอตรวจชำระในรายการที่เลือก' : 'ไม่มีออเดอร์ที่ยกเลิกได้ในรายการที่เลือก');
      return;
    }

    try {
      setBusyOrderAction('bulk');
      setGlobalError(null);
      await Promise.all(
        targets.map((order) =>
          invokeFunction<AdminOrderActionRequest, { order: OrderRow }>('admin-order-action', {
            action,
            order_id: order.id,
          }),
        ),
      );
      setSelectedOrderIds(new Set());
      await refreshOrders();
      setNotice(`อัปเดต ${targets.length} รายการแล้ว`);
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : 'bulk action ไม่สำเร็จ');
    } finally {
      setBusyOrderAction(null);
    }
  }

  async function setConversationMode(agentMode: 'ai' | 'human') {
    if (!selectedConversationId || conversationBusy) {
      return;
    }

    try {
      setConversationBusy('mode');
      setConversationError(null);
      await invokeFunction('admin-line-reply', {
        action: 'set_mode',
        agent_mode: agentMode,
        session_id: selectedConversationId,
      });
      await refreshConversations();
      setNotice(agentMode === 'human' ? 'สลับเป็นทีมงานดูแลบทสนทนาแล้ว' : 'คืนบทสนทนาให้ AI แล้ว');
    } catch (error) {
      setConversationError(error instanceof Error ? error.message : 'สลับโหมดบทสนทนาไม่สำเร็จ');
    } finally {
      setConversationBusy(null);
    }
  }

  async function sendConversationReply() {
    const text = conversationInput.trim();

    if (!selectedConversationId || !text || conversationBusy) {
      return;
    }

    try {
      setConversationBusy('reply');
      setConversationError(null);
      await invokeFunction('admin-line-reply', {
        action: 'reply',
        session_id: selectedConversationId,
        text,
      });
      setConversationInput('');
      await refreshConversations();
      setNotice('ส่งข้อความจากทีมงานแล้ว');
    } catch (error) {
      setConversationError(error instanceof Error ? error.message : 'ส่งข้อความไม่สำเร็จ');
    } finally {
      setConversationBusy(null);
    }
  }

  async function copyLineWebhookUrl() {
    await copyText(lineWebhookUrl);
    setNotice('คัดลอก LINE webhook URL แล้ว');
  }

  async function handleCopyReferralLink() {
    const code = myReferrer?.ref_code;

    if (!code) {
      setNotice('ยังไม่มี ref code ที่ผูกกับบัญชีนี้');
      return;
    }

    const link = referralPublicLink(code);
    await copyText(link);
    setCopied(true);
    setNotice('คัดลอกลิงก์แนะนำแล้ว');
    setTimeout(() => setCopied(false), 1700);
  }

  async function createReferralOrder() {
    if (!selectedReferralProduct || !myReferrer || referralBusy) {
      return;
    }

    const age = Number(refBuyerAge.trim());

    if (!refBuyerName.trim() || !/^0[689]\d{8}$/.test(refBuyerPhone.trim()) || !Number.isInteger(age) || age < 1 || age > 120) {
      setGlobalError('กรุณากรอกชื่อลูกค้า เบอร์โทรไทย และอายุ 1-120 ให้ครบก่อนสร้างออเดอร์');
      return;
    }

    try {
      setReferralBusy(true);
      setGlobalError(null);
      setNotice(null);
      const result = await invokeFunction<ReferrerOrderRequest, ReferrerOrderResponse>('referrer-order', {
        action: 'create_order',
        ...(selectedReferralBranch ? { branch_id: selectedReferralBranch.id } : {}),
        buyer_age: age,
        buyer_name: refBuyerName.trim(),
        buyer_phone: refBuyerPhone.trim(),
        catalog_key: selectedReferralProduct.catalogKey,
        preferred_date: refPreferredDate.trim() || undefined,
        tenant_slug: activeTenantSlug,
      });
      setReferralOrder(result.order);
      setNotice(`สร้างออเดอร์ให้ ${refBuyerName.trim()} แล้ว`);
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : 'สร้างออเดอร์ Referral ไม่สำเร็จ');
    } finally {
      setReferralBusy(false);
    }
  }

  async function markReferralPaymentDone() {
    if (!referralOrder?.id || referralBusy) {
      return;
    }

    try {
      setReferralBusy(true);
      setGlobalError(null);
      const result = await invokeFunction<ReferrerOrderRequest, ReferrerOrderResponse>('referrer-order', {
        action: 'payment_done',
        order_id: referralOrder.id,
        tenant_slug: activeTenantSlug,
      });
      setReferralOrder(result.order);
      setNotice('ส่งสถานะชำระเงินให้แอดมินตรวจสอบแล้ว');
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : 'ส่งสถานะชำระเงินไม่สำเร็จ');
    } finally {
      setReferralBusy(false);
    }
  }

  async function sendChatMessage() {
    const question = chatInput.trim();

    if (!question || chatBusy) {
      return;
    }

    if (!aiChatConfigStatus.hasProxy) {
      setChatMessages((current) => [
        ...current,
        {
          content: 'ยังไม่ได้ตั้งค่า AI proxy จึงตอบจาก model จริงไม่ได้',
          createdAt: new Date().toISOString(),
          id: `notice-${Date.now()}`,
          role: 'system_notice',
        },
      ]);
      setChatInput('');
      return;
    }

    const userMessage: ChatMessage = {
      content: question,
      createdAt: new Date().toISOString(),
      id: `user-${Date.now()}`,
      role: 'user',
    };
    const nextMessages = [...chatMessages, userMessage];

    setChatMessages(nextMessages);
    setChatInput('');
    setChatBusy(true);

    try {
      const result = await askAiWithRag({
        messages: nextMessages,
        question,
        sessionId: chatSessionId ?? getCurrentChatSessionId(),
      });

      setChatSessionId(result.sessionId ?? getCurrentChatSessionId());
      setChatMessages((current) => [
        ...current,
        {
          cards: result.cards,
          content: result.text,
          createdAt: new Date().toISOString(),
          id: `assistant-${Date.now()}`,
          order: result.order,
          role: result.responseRole ?? 'assistant',
          uiCards: result.uiCards,
        },
      ]);
    } catch (error) {
      setChatMessages((current) => [
        ...current,
        {
          content: error instanceof Error ? error.message : 'Mira AI ยังตอบไม่ได้ในตอนนี้',
          createdAt: new Date().toISOString(),
          id: `chat-error-${Date.now()}`,
          role: 'system_notice',
        },
      ]);
    } finally {
      setChatBusy(false);
    }
  }

  const moduleCopy: Record<ProductModule, { accent: string; caption: string }> = {
    admin: {
      accent: 'Admin Panel',
      caption: 'สำหรับทีมงาน · จัดการ Orders, Catalog, Referral และสถานะปฏิบัติการจาก backend จริง',
    },
    chat: {
      accent: 'AI Sales Chat',
      caption: 'สำหรับลูกค้าบนมือถือ · ใช้ AI model และ catalog จริงผ่าน chat engine เดิม',
    },
    referral: {
      accent: 'Referral Program',
      caption: 'สำหรับผู้แนะนำ · ลิงก์แชร์ รายได้ และ direct purchase เชื่อม order backend เดิม',
    },
  };

  function renderStatusBar() {
    return (
      <View style={styles.phoneStatusBar}>
        <Text style={styles.phoneStatusText}>9:41</Text>
        <View style={styles.phoneSignalGroup}>
          <View style={[styles.signalBar, { height: 6 }]} />
          <View style={[styles.signalBar, { height: 8 }]} />
          <View style={[styles.signalBar, { height: 10 }]} />
          <View style={[styles.signalBattery]} />
        </View>
      </View>
    );
  }

  function renderPhoneShell(children: ReactNode, darkHeader = false) {
    return (
      <View style={styles.phoneStage}>
        <View style={[styles.phoneShell, isCompact ? styles.phoneShellCompact : styles.phoneShellDesktop, phoneFrameStyle]}>
          <View style={styles.phoneNotch} />
          <View style={[styles.phoneScreen, darkHeader ? styles.phoneScreenFlat : null]}>
            {children}
          </View>
        </View>
      </View>
    );
  }

  function renderReferralHome() {
    const total = referralTotals.approved + referralTotals.paid + referralTotals.pending;
    const paidPlusApproved = referralTotals.approved + referralTotals.paid;
    const latest = myCommissions.slice(0, 4);

    return (
      <ScrollView contentContainerStyle={styles.phoneScrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.mobileGreeting}>
          <View>
            <Text style={styles.mobileMuted}>สวัสดีตอนเช้า</Text>
            <Text style={styles.mobileTitle}>{myReferrer?.name ?? 'Referral member'}</Text>
          </View>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{textInitial(myReferrer?.name)}</Text>
          </View>
        </View>

        <LinearGradient colors={['#2563EB', '#3B82F6', '#60A5FA']} style={styles.earningsHero}>
          <View style={styles.earningsGlow} />
          <Text style={styles.earningsLabel}>คอมมิชชั่นเดือนนี้</Text>
          <View style={styles.earningsAmountRow}>
            <Text style={styles.earningsAmount}>{formatMoney(total, true)}</Text>
            <Text style={styles.earningsChip}>live</Text>
          </View>
          <Text style={styles.earningsSub}>จ่ายแล้วและอนุมัติแล้ว · {formatMoney(paidPlusApproved, true)}</Text>
        </LinearGradient>

        <Pressable disabled={!myReferrer} onPress={() => void handleCopyReferralLink()} style={[styles.bigBlueButton, !myReferrer ? styles.disabled : null]}>
          <Icon color="#FFFFFF" name={{ android: 'auto_awesome', ios: 'sparkles', web: 'auto_awesome' }} size={19} />
          <Text style={styles.bigBlueButtonText}>{copied ? 'คัดลอกแล้ว' : 'แชร์ลิงก์แนะนำของฉัน'}</Text>
        </Pressable>

        <View style={styles.quickStatGrid}>
          <MiniStat label="รออนุมัติ" value={formatMoney(referralTotals.pending, true)} />
          <MiniStat label="อนุมัติ" value={formatMoney(referralTotals.approved, true)} />
          <MiniStat label="จ่ายแล้ว" value={formatMoney(referralTotals.paid, true)} active />
        </View>

        <View style={styles.phoneSectionHeader}>
          <Text style={styles.phoneSectionTitle}>การแนะนำล่าสุด</Text>
          <Text style={styles.phoneSectionAction}>backend</Text>
        </View>

        <View style={styles.mobileList}>
          {latest.length > 0 ? (
            latest.map((entry) => (
              <ReferralCommissionItem entry={entry} key={entry.id} />
            ))
          ) : (
            <EmptyState detail={auth.session ? 'ยังไม่มีรายการคอมมิชชั่นจาก backend' : 'เข้าสู่ระบบ Referral เพื่อดูข้อมูลจริง'} title="ยังไม่มีรายได้" />
          )}
        </View>

        {renderReferralDirectOrder()}
      </ScrollView>
    );
  }

  function renderReferralShare() {
    const refCode = myReferrer?.ref_code ?? 'MIRA-READY';
    const link = referralPublicLink(refCode);

    return (
      <ScrollView contentContainerStyle={styles.phoneScrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.shareIntro}>
          <Text style={styles.mobileTitle}>แชร์เพื่อรับรายได้</Text>
          <Text style={styles.mobileMuted}>ทุกออเดอร์ที่สำเร็จจะผูก attribution และ commission จาก backend</Text>
        </View>

        <View style={styles.qrCard}>
          <View style={styles.qrBox}>
            <QRCode backgroundColor="#FFFFFF" color="#0B1C3F" quietZone={8} size={146} value={link} />
          </View>
          <Text style={styles.qrCaption}>สแกนเพื่อเปิดลิงก์แนะนำของ {myReferrer?.name ?? 'บัญชีนี้'}</Text>
        </View>

        <View style={styles.linkCard}>
          <Text style={styles.linkLabel}>Referral link</Text>
          <Text selectable style={styles.linkValue}>{link}</Text>
          <Pressable disabled={!myReferrer} onPress={() => void handleCopyReferralLink()} style={[styles.compactBlueButton, !myReferrer ? styles.disabled : null]}>
            <Text style={styles.compactBlueButtonText}>คัดลอกลิงก์</Text>
          </Pressable>
        </View>

        <View style={styles.refCodeCard}>
          <Text style={styles.mobileMuted}>รหัสแนะนำ</Text>
          <Text style={styles.refCodeText}>{refCode}</Text>
        </View>
      </ScrollView>
    );
  }

  function renderReferralEarnings() {
    return (
      <ScrollView contentContainerStyle={styles.phoneScrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.mobileTitle}>รายได้และคอมมิชชั่น</Text>
        <Text style={styles.mobileMuted}>ข้อมูลจากตาราง commission_entries</Text>
        <View style={styles.earningBreakdown}>
          <MiniStat label="รออนุมัติ" value={formatMoney(referralTotals.pending, true)} />
          <MiniStat label="อนุมัติแล้ว" value={formatMoney(referralTotals.approved, true)} />
          <MiniStat label="จ่ายแล้ว" value={formatMoney(referralTotals.paid, true)} active />
        </View>
        <View style={styles.mobileList}>
          {myCommissions.length > 0 ? (
            myCommissions.map((entry) => <ReferralCommissionItem entry={entry} key={entry.id} />)
          ) : (
            <EmptyState detail="เมื่อออเดอร์จาก ref สำเร็จ รายการจะขึ้นที่นี่" title="ยังไม่มีรายการ" />
          )}
        </View>
      </ScrollView>
    );
  }

  function renderReferralDirectOrder() {
    return (
      <View style={styles.directOrderCard}>
        <View style={styles.phoneSectionHeader}>
          <Text style={styles.phoneSectionTitle}>สร้างออเดอร์แทนลูกค้า</Text>
          <Text style={styles.phoneSectionAction}>referrer-order</Text>
        </View>

        <View style={styles.productPicker}>
          {products.slice(0, 4).map((product) => (
            <Pressable
              key={product.id}
              onPress={() => {
                setRefProductId(product.id);
                setRefBranchId(product.branches.find((branch) => branch.active)?.id ?? '');
              }}
              style={[styles.productPickChip, selectedReferralProduct?.id === product.id ? styles.productPickChipActive : null]}
            >
              <Text numberOfLines={1} style={[styles.productPickText, selectedReferralProduct?.id === product.id ? styles.productPickTextActive : null]}>
                {product.title}
              </Text>
            </Pressable>
          ))}
        </View>

        <TextInput onChangeText={setRefBuyerName} placeholder="ชื่อลูกค้า" placeholderTextColor="#9AA8C2" style={styles.mobileInput} value={refBuyerName} />
        <TextInput keyboardType="phone-pad" onChangeText={setRefBuyerPhone} placeholder="เบอร์โทร 08xxxxxxxx" placeholderTextColor="#9AA8C2" style={styles.mobileInput} value={refBuyerPhone} />
        <View style={styles.inlineInputs}>
          <TextInput keyboardType="number-pad" onChangeText={setRefBuyerAge} placeholder="อายุ" placeholderTextColor="#9AA8C2" style={[styles.mobileInput, styles.inlineInput]} value={refBuyerAge} />
          <TextInput onChangeText={setRefPreferredDate} placeholder="วันที่สะดวก" placeholderTextColor="#9AA8C2" style={[styles.mobileInput, styles.inlineInput]} value={refPreferredDate} />
        </View>

        {referralBranches.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.branchScroll}>
            {referralBranches.map((branch) => (
              <Pressable key={branch.id} onPress={() => setRefBranchId(branch.id)} style={[styles.branchChip, selectedReferralBranch?.id === branch.id ? styles.branchChipActive : null]}>
                <Text style={[styles.branchChipText, selectedReferralBranch?.id === branch.id ? styles.branchChipTextActive : null]}>{branch.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        <Pressable disabled={!myReferrer || !selectedReferralProduct || referralBusy} onPress={() => void createReferralOrder()} style={[styles.bigBlueButton, (!myReferrer || !selectedReferralProduct || referralBusy) ? styles.disabled : null]}>
          <Text style={styles.bigBlueButtonText}>{referralBusy ? 'กำลังสร้างออเดอร์' : 'สร้าง QR / ออเดอร์'}</Text>
        </Pressable>

        {referralOrder ? (
          <View style={styles.orderMiniPanel}>
            <Text style={styles.orderMiniTitle}>ออเดอร์ {referralOrder.id}</Text>
            <Text style={styles.mobileMuted}>{referralOrder.product_name} · {formatMoney(referralOrder.amount_baht, true)}</Text>
            <Text style={styles.mobileMuted}>สถานะ: {referralOrder.status}</Text>
            <Pressable disabled={referralBusy} onPress={() => void markReferralPaymentDone()} style={styles.compactBlueButton}>
              <Text style={styles.compactBlueButtonText}>แจ้งชำระเงินแล้ว</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  function renderReferralPhone() {
    const body = referralView === 'home' ? renderReferralHome() : referralView === 'share' ? renderReferralShare() : renderReferralEarnings();

    return renderPhoneShell(
      <>
        {renderStatusBar()}
        <View style={styles.phoneBody}>{body}</View>
        <View style={styles.phoneBottomNav}>
          {referralViews.map((item) => {
            const active = referralView === item.id;

            return (
              <Pressable key={item.id} onPress={() => setReferralView(item.id)} style={styles.phoneNavButton}>
                <Icon color={active ? '#2563EB' : '#9AA8C2'} name={item.icon} size={22} />
                <Text style={[styles.phoneNavText, active ? styles.phoneNavTextActive : null]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </>,
    );
  }

  function renderAdminDashboard() {
    const today = todayBangkokDateValue();
    const dateValues = Array.from({ length: 7 }, (_, index) => shiftDateValue(today, index - 6));
    const revenueByDay = dateValues.reduce<Record<string, number>>((acc, dateValue) => {
      acc[dateValue] = 0;
      return acc;
    }, {});

    orders.forEach((order) => {
      if (!['submitted', 'confirmed', 'booked', 'done'].includes(order.status)) {
        return;
      }

      const dateKey = bangkokDateKey(order.paid_at ?? order.created_at);

      if (dateKey in revenueByDay) {
        revenueByDay[dateKey] += order.amount_baht;
      }
    });

    const maxRevenue = Math.max(0, ...Object.values(revenueByDay));
    const chartPoints = dateValues.map((dateValue) => {
      const revenue = revenueByDay[dateValue] ?? 0;

      return {
        dateValue,
        height: maxRevenue > 0 ? Math.max(12, Math.round((revenue / maxRevenue) * 100)) : 0,
        label: bangkokWeekdayLabel(dateValue),
        revenue,
      };
    });

    return (
      <ScrollView contentContainerStyle={styles.adminScrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.kpiGrid}>
          <DashboardCard label="ยอดขายรวม" meta={`${dashboardStats.paidOrders} ออเดอร์ชำระแล้ว`} value={formatMoney(dashboardStats.revenue, true)} />
          <DashboardCard label="รอดำเนินการ" meta="รอชำระ/รอตรวจ" value={String(dashboardStats.pending)} />
          <DashboardCard label="ผู้แนะนำ Active" meta={formatMoney(dashboardStats.totalCommission, true)} value={String(dashboardStats.activeReferrers)} />
          <DashboardCard label="สินค้า Active" meta={`${dashboardStats.activeProducts}/${products.length} เปิดขาย`} value={String(dashboardStats.activeProducts)} />
        </View>

        <View style={styles.dashboardGrid}>
          <View style={styles.dashboardPanelWide}>
            <View style={styles.panelTitleRow}>
              <Text style={styles.panelTitle}>รายได้ 7 วันล่าสุด</Text>
              <Text style={styles.panelAction}>จาก backend</Text>
            </View>
            <View style={styles.barChart}>
              {chartPoints.map((point) => (
                <View key={point.dateValue} style={styles.barSlot}>
                  <View style={styles.chartTrack}>
                    <View style={[styles.chartBar, { height: point.height > 0 ? `${point.height}%` : 8 }]} />
                  </View>
                  <Text style={styles.chartValue}>{formatMoney(point.revenue, true)}</Text>
                  <Text style={styles.chartLabel}>{point.label}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.dashboardPanel}>
            <Text style={styles.panelTitle}>สถานะออเดอร์</Text>
            {orderFilters.slice(1).map((filter) => {
              const count = orderCounts[filter.id];
              const percent = orders.length ? Math.min(100, Math.round((count / orders.length) * 100)) : 0;

              return (
                <View key={filter.id} style={styles.statusProgressRow}>
                  <View style={styles.statusProgressLabelRow}>
                    <Text style={styles.statusProgressLabel}>{filter.label}</Text>
                    <Text style={styles.statusProgressValue}>{count}</Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${percent}%` }]} />
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.dashboardPanelFull}>
          <View style={styles.panelTitleRow}>
            <Text style={styles.panelTitle}>ออเดอร์ล่าสุด</Text>
            <Pressable onPress={() => setAdminView('orders')}>
              <Text style={styles.panelAction}>ดูทั้งหมด</Text>
            </Pressable>
          </View>
          {orders.slice(0, 5).map((order) => renderOrderMiniRow(order))}
          {orders.length === 0 ? <EmptyState detail={adminEmptyDetail()} title="ยังไม่มีออเดอร์" /> : null}
        </View>
      </ScrollView>
    );
  }

  function renderOrderMiniRow(order: AdminOrderRow) {
    const meta = statusMeta(order.status, orderKind(order));

    return (
      <Pressable key={order.id} onPress={() => {
        setSelectedOrderId(order.id);
        setAdminView('orders');
      }} style={styles.miniTableRow}>
        <Text style={styles.miniOrderId}>{order.id}</Text>
        <Text numberOfLines={1} style={styles.miniCustomer}>{shortName(orderBuyerName(order))}</Text>
        <Text numberOfLines={1} style={styles.miniProduct}>{orderProductName(order)}</Text>
        <Text style={styles.miniAmount}>{formatMoney(order.amount_baht, true)}</Text>
        <Pill bg={meta.bg} fg={meta.fg}>{meta.label}</Pill>
      </Pressable>
    );
  }

  function renderAdminOrders() {
    return (
      <View style={styles.ordersView}>
        <View style={styles.ordersToolbar}>
          <View style={styles.searchBox}>
            <Icon color="#9AA8C2" name={{ android: 'search', ios: 'magnifyingglass', web: 'search' }} size={17} />
            <TextInput
              onChangeText={setOrderSearch}
              placeholder="ค้นหา #ออเดอร์ / ลูกค้า / สินค้า"
              placeholderTextColor="#9AA8C2"
              style={styles.searchInput}
              value={orderSearch}
            />
          </View>
          <View style={styles.sortGroup}>
            {[
              { id: 'newest', label: 'ใหม่ล่าสุด' },
              { id: 'amount_desc', label: 'ยอดสูง' },
              { id: 'amount_asc', label: 'ยอดต่ำ' },
            ].map((item) => (
              <Pressable key={item.id} onPress={() => setOrderSort(item.id as OrderSort)} style={[styles.sortChip, orderSort === item.id ? styles.sortChipActive : null]}>
                <Text style={[styles.sortChipText, orderSort === item.id ? styles.sortChipTextActive : null]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
          {orderFilters.map((filter) => {
            const active = orderFilter === filter.id;

            return (
              <Pressable key={filter.id} onPress={() => setOrderFilter(filter.id)} style={[styles.filterChip, active ? styles.filterChipActive : null]}>
                <Text style={[styles.filterChipText, active ? styles.filterChipTextActive : null]}>{filter.label}</Text>
                <Text style={[styles.filterCount, active ? styles.filterCountActive : null]}>{orderCounts[filter.id]}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {selectedOrderIds.size > 0 ? (
          <View style={styles.bulkBar}>
            <Text style={styles.bulkText}>เลือกแล้ว {selectedOrderIds.size} รายการ</Text>
            <View style={styles.bulkActions}>
              <Pressable disabled={busyOrderAction !== null} onPress={() => void runBulk('confirm')} style={styles.bulkPrimary}>
                <Text style={styles.bulkPrimaryText}>ยืนยันการชำระ</Text>
              </Pressable>
              <Pressable disabled={busyOrderAction !== null} onPress={() => void runBulk('cancel')} style={styles.bulkDanger}>
                <Text style={styles.bulkPrimaryText}>ยกเลิก</Text>
              </Pressable>
              <Pressable onPress={() => setSelectedOrderIds(new Set())} style={styles.bulkClear}>
                <Text style={styles.bulkGhostText}>ล้าง</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={styles.ordersWorkspace}>
          <ScrollView contentContainerStyle={styles.orderTableContent} style={styles.orderTable}>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeadText, styles.cellCheck]} />
              <Text style={[styles.tableHeadText, styles.cellId]}>ออเดอร์</Text>
              <Text style={[styles.tableHeadText, styles.cellCustomer]}>ลูกค้า</Text>
              <Text style={[styles.tableHeadText, styles.cellProduct]}>แพ็กเกจ</Text>
              <Text style={[styles.tableHeadText, styles.cellAmount]}>ยอด</Text>
              <Text style={[styles.tableHeadText, styles.cellStatus]}>สถานะ</Text>
              <Text style={[styles.tableHeadText, styles.cellAction]}>การจัดการ</Text>
            </View>

            {filteredOrders.map((order) => renderOrderRow(order))}
            {filteredOrders.length === 0 ? <EmptyState detail="ลองเปลี่ยนคำค้นหรือ filter" title="ไม่พบออเดอร์" /> : null}
          </ScrollView>

          {selectedOrder ? (
            <View style={styles.orderSidePanel}>
              {renderOrderDetail(selectedOrder, false)}
            </View>
          ) : (
            <View style={styles.orderSidePanel}>
              <EmptyState detail="กดปุ่มดำเนินการหรือแถวออเดอร์เพื่อเปิด sidebar รายละเอียด" title="เลือกออเดอร์" />
            </View>
          )}
        </View>
      </View>
    );
  }

  function renderOrderRow(order: AdminOrderRow) {
    const meta = statusMeta(order.status, orderKind(order));
    const selected = selectedOrderIds.has(order.id);
    const action = primaryActionForOrder(order);

    return (
      <Pressable key={order.id} onPress={() => setSelectedOrderId(order.id)} style={[styles.tableRow, selected ? styles.tableRowSelected : null]}>
        <Pressable onPress={() => toggleOrderSelection(order.id)} style={[styles.checkbox, selected ? styles.checkboxOn : null]}>
          {selected ? <Text style={styles.checkboxMark}>✓</Text> : null}
        </Pressable>
        <Text numberOfLines={1} style={[styles.tableCell, styles.cellId, styles.orderIdText]}>{order.id}</Text>
        <Text numberOfLines={1} style={[styles.tableCell, styles.cellCustomer]}>{shortName(orderBuyerName(order))}</Text>
        <Text numberOfLines={1} style={[styles.tableCell, styles.cellProduct]}>{orderProductName(order)}</Text>
        <Text style={[styles.tableCell, styles.cellAmount, styles.amountText]}>{formatMoney(order.amount_baht, true)}</Text>
        <View style={styles.cellStatus}>
          <Pill bg={meta.bg} fg={meta.fg}>{meta.label}</Pill>
        </View>
        <View style={[styles.cellAction, styles.rowActions]}>
          <Pressable onPress={() => setSelectedOrderId(order.id)} style={[styles.rowPrimaryButton, !action && order.status === 'awaiting_payment' ? styles.rowPrimaryMuted : null]}>
            <Text style={styles.rowPrimaryButtonText}>{action ? 'ดำเนินการ' : primaryActionLabel(order)}</Text>
          </Pressable>
        </View>
      </Pressable>
    );
  }

  function renderCatalog() {
    const activeProducts = products.filter((product) => product.status === 'active').length;
    const stripeReady = products.filter((product) => product.stripeProductId && product.stripePriceId).length;

    return (
      <ScrollView contentContainerStyle={styles.adminScrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.panelTitleRow}>
          <View>
            <Text style={styles.panelTitle}>สินค้าและบริการ</Text>
            <Text style={styles.panelSubtitle}>จัดการ catalog กลางที่ AI Chat, Referral และ Payment ใช้ร่วมกัน</Text>
          </View>
          <View style={styles.catalogTopActions}>
            <Pressable disabled={catalogBusy === 'refresh'} onPress={() => void refreshCatalog()} style={[styles.secondarySmallButton, catalogBusy === 'refresh' ? styles.disabled : null]}>
              <Text style={styles.secondarySmallButtonText}>{catalogBusy === 'refresh' ? 'กำลังโหลด' : 'รีเฟรช'}</Text>
            </Pressable>
            <Pressable disabled={!canEditCatalog} onPress={openNewCatalogProduct} style={[styles.rowPrimaryButton, !canEditCatalog ? styles.disabled : null]}>
              <Text style={styles.rowPrimaryButtonText}>+ เพิ่มสินค้า</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.kpiGrid}>
          <DashboardCard label="สินค้าในระบบ" meta="อ่านจาก backend" value={String(products.length)} />
          <DashboardCard label="เปิดขาย" meta="AI/Referral มองเห็น" value={String(activeProducts)} />
          <DashboardCard label="Stripe ready" meta="มี product/price mapping" value={`${stripeReady}/${products.length}`} />
          <DashboardCard label="สาขา" meta="ใช้กับ booking/branch selection" value={String(branches.length)} />
        </View>

        <View style={styles.catalogToolbar}>
          <View style={styles.searchBox}>
            <Icon color="#9AA8C2" name={{ android: 'search', ios: 'magnifyingglass', web: 'search' }} size={17} />
            <TextInput
              onChangeText={setCatalogSearch}
              placeholder="ค้นหาสินค้า หมวดหมู่ สาขา catalog key"
              placeholderTextColor="#9AA8C2"
              style={styles.searchInput}
              value={catalogSearch}
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {catalogStatusFilters.map((filter) => {
              const active = catalogStatusFilter === filter.id;

              return (
                <Pressable key={filter.id} onPress={() => setCatalogStatusFilter(filter.id)} style={[styles.subFilterChip, active ? styles.subFilterChipActive : null]}>
                  <Text style={[styles.subFilterChipText, active ? styles.subFilterChipTextActive : null]}>{filter.label}</Text>
                  <Text style={[styles.filterCount, active ? styles.filterCountActive : null]}>{catalogCounts[filter.id]}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {catalogMessage ? <Text style={styles.inlineSuccessText}>{catalogMessage}</Text> : null}
        {catalogError ? <Text style={styles.inlineErrorText}>{catalogError}</Text> : null}

        <View style={styles.catalogWorkspace}>
          <View style={styles.catalogListPane}>
            <View style={styles.catalogGrid}>
              {filteredCatalogProducts.map((product) => {
                const tone = catalogStatusTone(product.status);
                const nextStatus: HospitalProductStatus = product.status === 'active' ? 'archived' : 'active';

                return (
                  <Pressable key={product.id} onPress={() => editCatalogProduct(product)} style={styles.catalogCard}>
                    <LinearGradient colors={product.status === 'active' ? ['#60A5FA', '#2563EB'] : ['#CBD5E1', '#94A3B8']} style={styles.catalogImage}>
                      <Text style={styles.catalogImageText}>{product.category}</Text>
                    </LinearGradient>
                    <View style={styles.catalogBody}>
                      <View style={styles.catalogCardHeader}>
                        <Text numberOfLines={2} style={styles.catalogTitle}>{product.title}</Text>
                        <Pill bg={tone.bg} fg={tone.fg}>{catalogStatusLabel(product.status)}</Pill>
                      </View>
                      <Text style={styles.catalogPrice}>{formatMoney(product.priceAmount, true)}</Text>
                      <Text numberOfLines={2} style={styles.catalogDesc}>{product.description}</Text>
                      <View style={styles.catalogFooter}>
                        <Text style={styles.catalogBranch}>{product.branches.length ? `${product.branches.length} สาขา` : 'ยังไม่ผูกสาขา'}</Text>
                        <Text style={styles.catalogBranch}>{product.stripeProductId ? 'Stripe ready' : 'ยังไม่ sync Stripe'}</Text>
                      </View>
                      <View style={styles.catalogActions}>
                        <Pressable onPress={() => editCatalogProduct(product)} style={styles.compactGhostButton}>
                          <Text style={styles.compactGhostButtonText}>แก้ไข</Text>
                        </Pressable>
                        <Pressable disabled={!canEditCatalog || catalogBusy !== null} onPress={() => void changeCatalogStatus(product, nextStatus)} style={[styles.compactBlueButton, (!canEditCatalog || catalogBusy !== null) ? styles.disabled : null]}>
                          <Text style={styles.compactBlueButtonText}>{nextStatus === 'active' ? 'เปิดขาย' : 'ปิดขาย'}</Text>
                        </Pressable>
                        <Pressable disabled={!canEditCatalog || catalogBusy !== null} onPress={() => void syncCatalogStripe(product)} style={[styles.compactGhostButton, (!canEditCatalog || catalogBusy !== null) ? styles.disabled : null]}>
                          <Text style={styles.compactGhostButtonText}>Stripe</Text>
                        </Pressable>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            {filteredCatalogProducts.length === 0 ? <EmptyState detail={adminEmptyDetail()} title="ยังไม่มีสินค้าในเงื่อนไขนี้" /> : null}
          </View>

          {catalogEditorOpen ? (
            <View style={styles.catalogEditorPanel}>
              <View style={styles.panelTitleRow}>
                <View>
                  <Text style={styles.panelTitle}>{editingCatalogProduct ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่'}</Text>
                  <Text style={styles.panelSubtitle}>บันทึกลง product catalog backend จริง</Text>
                </View>
                <Pressable onPress={() => setCatalogEditorOpen(false)} style={styles.backButton}>
                  <Icon color="#5A6B86" name={{ android: 'close', ios: 'xmark', web: 'close' }} size={18} />
                </Pressable>
              </View>

              <View style={styles.catalogFormGrid}>
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>ชื่อสินค้า/บริการ</Text>
                  <TextInput onChangeText={(value) => updateCatalogDraft('title', value)} placeholder="เช่น ตรวจสุขภาพ Basic" placeholderTextColor="#9AA8C2" style={styles.adminInput} value={catalogDraft.title} />
                </View>
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>ราคา (บาท)</Text>
                  <TextInput keyboardType="numeric" onChangeText={(value) => updateCatalogDraft('priceAmount', value)} placeholder="2990" placeholderTextColor="#9AA8C2" style={styles.adminInput} value={catalogDraft.priceAmount} />
                </View>
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>หมวดหมู่</Text>
                  <TextInput onChangeText={(value) => updateCatalogDraft('category', value as HospitalProductDraft['category'])} placeholder="checkup / blood / product" placeholderTextColor="#9AA8C2" style={styles.adminInput} value={catalogDraft.category ?? ''} />
                </View>
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>ภาพสินค้า URL</Text>
                  <TextInput onChangeText={(value) => updateCatalogDraft('imageUrl', value)} placeholder="https://..." placeholderTextColor="#9AA8C2" style={styles.adminInput} value={catalogDraft.imageUrl ?? ''} />
                </View>
              </View>

              <View style={styles.formField}>
                <Text style={styles.formLabel}>รายละเอียดที่ AI ใช้อธิบายสินค้า</Text>
                <TextInput
                  multiline
                  onChangeText={(value) => updateCatalogDraft('description', value)}
                  placeholder="รายละเอียดแพ็กเกจ สิ่งที่รวม เงื่อนไขการนัดหมาย"
                  placeholderTextColor="#9AA8C2"
                  style={[styles.adminInput, styles.catalogDescriptionInput]}
                  value={catalogDraft.description}
                />
              </View>

              <View style={styles.formField}>
                <Text style={styles.formLabel}>ข้อมูลสาขา/พื้นที่ให้บริการ</Text>
                <TextInput onChangeText={(value) => {
                  updateCatalogDraft('branchInfo', value);
                  updateCatalogDraft('hospitalAddress', value);
                  updateCatalogDraft('hospitalMapQuery', value);
                }} placeholder="สาขาหลัก / จัดส่งทั่วประเทศ" placeholderTextColor="#9AA8C2" style={styles.adminInput} value={catalogDraft.branchInfo ?? ''} />
              </View>

              <View style={styles.catalogToggleRow}>
                <Pressable onPress={() => updateCatalogDraft('requiresAppointment', !catalogDraft.requiresAppointment)} style={[styles.checkbox, catalogDraft.requiresAppointment ? styles.checkboxOn : null]}>
                  {catalogDraft.requiresAppointment ? <Text style={styles.checkboxMark}>✓</Text> : null}
                </Pressable>
                <View>
                  <Text style={styles.formLabel}>ต้องนัดหมาย/เลือกสาขา</Text>
                  <Text style={styles.panelSubtitle}>ปิดไว้สำหรับสินค้าจัดส่งหรือสินค้าที่ไม่ต้องจองคิว</Text>
                </View>
              </View>

              <View style={styles.formField}>
                <Text style={styles.formLabel}>สาขาที่ขายได้</Text>
                <View style={styles.branchPicker}>
                  {branches.map((branch) => {
                    const selected = (catalogDraft.branchIds ?? []).includes(branch.id);

                    return (
                      <Pressable key={branch.id} onPress={() => toggleCatalogDraftBranch(branch.id)} style={[styles.branchPickChip, selected ? styles.branchPickChipActive : null]}>
                        <Text style={[styles.branchPickText, selected ? styles.branchPickTextActive : null]}>{branch.name}</Text>
                      </Pressable>
                    );
                  })}
                  {branches.length === 0 ? <Text style={styles.panelSubtitle}>ยังไม่มีสาขาใน backend หรือบัญชียังไม่มีสิทธิ์โหลดสาขา</Text> : null}
                </View>
              </View>

              <View style={styles.catalogEditorActions}>
                <Pressable disabled={!canEditCatalog || catalogBusy === 'save'} onPress={() => void saveCatalogDraft()} style={[styles.bigBlueButton, (!canEditCatalog || catalogBusy === 'save') ? styles.disabled : null]}>
                  <Text style={styles.bigBlueButtonText}>{catalogBusy === 'save' ? 'กำลังบันทึก' : 'บันทึกสินค้า'}</Text>
                </Pressable>
                {editingCatalogProduct ? (
                  <Pressable disabled={!canEditCatalog || catalogBusy !== null} onPress={() => void syncCatalogStripe(editingCatalogProduct)} style={[styles.secondarySmallButton, (!canEditCatalog || catalogBusy !== null) ? styles.disabled : null]}>
                    <Text style={styles.secondarySmallButtonText}>ซิงก์ Stripe</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : (
            <View style={styles.catalogEditorPanel}>
              <EmptyState detail={canEditCatalog ? 'กดการ์ดสินค้าเพื่อแก้ไข หรือกดเพิ่มสินค้าเพื่อสร้างรายการใหม่' : 'บัญชีนี้ยังไม่มีสิทธิ์ tenant admin สำหรับแก้ catalog'} title="เลือกสินค้า" />
            </View>
          )}
        </View>
      </ScrollView>
    );
  }

  function renderReferrersAdmin() {
    return (
      <ScrollView contentContainerStyle={styles.adminScrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.kpiGrid}>
          <DashboardCard label="สมาชิก REF" meta="ทั้งหมดใน tenant" value={String(referrers.length)} />
          <DashboardCard label="Active" meta="เปิดใช้งาน" value={String(referrers.filter((referrer) => referrer.active).length)} />
          <DashboardCard label="Commission" meta="รวมทุกสถานะ" value={formatMoney(commissions.reduce((sum, entry) => sum + entry.amount_baht, 0), true)} />
          <DashboardCard label="Pending" meta="รออนุมัติ" value={formatMoney(commissions.filter((entry) => entry.status === 'pending').reduce((sum, entry) => sum + entry.amount_baht, 0), true)} />
        </View>

        <View style={styles.dashboardPanelFull}>
          <Text style={styles.panelTitle}>ผู้แนะนำ</Text>
          {referrers.map((referrer) => (
            <View key={referrer.id} style={styles.referrerRow}>
              <View style={styles.avatarCircleSmall}>
                <Text style={styles.avatarTextSmall}>{textInitial(referrer.name)}</Text>
              </View>
              <View style={styles.referrerMain}>
                <Text style={styles.referrerName}>{referrer.name}</Text>
                <Text style={styles.referrerMeta}>{referrer.ref_code} · {referrer.type}</Text>
              </View>
              <Pill bg={referrer.active ? 'rgba(16,185,129,0.12)' : '#F1F5F9'} fg={referrer.active ? '#0F9D70' : '#64748B'}>
                {referrer.active ? 'active' : 'inactive'}
              </Pill>
            </View>
          ))}
          {referrers.length === 0 ? <EmptyState detail={adminEmptyDetail()} title="ยังไม่มีผู้แนะนำ" /> : null}
        </View>

        <View style={styles.dashboardPanelFull}>
          <Text style={styles.panelTitle}>รายการคอมมิชชั่น</Text>
          {commissions.slice(0, 12).map((entry) => (
            <ReferralCommissionItem entry={entry} key={entry.id} showReferrer />
          ))}
          {commissions.length === 0 ? <EmptyState detail="ยังไม่มี commission_entries จาก backend" title="ยังไม่มีคอมมิชชั่น" /> : null}
        </View>
      </ScrollView>
    );
  }

  function renderAdminConversations() {
    const selectedLinkedOrder = selectedConversation ? orders.find((order) => order.session_id === selectedConversation.id) ?? null : null;
    const isHumanMode = selectedConversation?.agent_mode === 'human';

    return (
      <View style={styles.convWorkspace}>
        <View style={styles.convInbox}>
          <View style={styles.panelTitleRow}>
            <Text style={styles.panelTitle}>กล่องข้อความ</Text>
            <Pill bg={conversationError ? '#FEF2F2' : 'rgba(37,99,235,0.1)'} fg={conversationError ? '#B91C1C' : '#2563EB'}>
              {conversationBusy === 'load' ? 'กำลังโหลด' : `${conversationSessions.length} ห้อง`}
            </Pill>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
            {conversationFilters.map((filter) => {
              const active = conversationFilter === filter.id;

              return (
                <Pressable key={filter.id} onPress={() => setConversationFilter(filter.id)} style={[styles.subFilterChip, active ? styles.subFilterChipActive : null]}>
                  <Text style={[styles.subFilterChipText, active ? styles.subFilterChipTextActive : null]}>{filter.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {conversationError ? <Text style={styles.inlineErrorText}>{conversationError}</Text> : null}
          <ScrollView contentContainerStyle={styles.convInboxList} showsVerticalScrollIndicator={false}>
            {conversationSessions.map((session) => {
              const active = session.id === selectedConversationId;
              const tone = conversationChannelTone(session.channel);

              return (
                <Pressable key={session.id} onPress={() => setSelectedConversationId(session.id)} style={[styles.convInboxRow, active ? styles.convInboxRowActive : null]}>
                  <View style={styles.convAvatar}>
                    <Text style={styles.avatarTextSmall}>{textInitial(conversationCustomerName(session))}</Text>
                  </View>
                  <View style={styles.convInboxMain}>
                    <View style={styles.convInboxTop}>
                      <Text numberOfLines={1} style={styles.convName}>{conversationCustomerName(session)}</Text>
                      <View style={styles.unreadDot} />
                    </View>
                    <View style={styles.convMetaRow}>
                      <Pill bg={tone.bg} fg={tone.fg}>{conversationChannelLabel(session.channel)}</Pill>
                      <Text style={styles.convTime}>{formatDateTime(session.last_message_at)}</Text>
                    </View>
                  </View>
                </Pressable>
              );
            })}
            {conversationSessions.length === 0 ? <EmptyState detail={adminEmptyDetail()} title="ยังไม่มีบทสนทนา" /> : null}
          </ScrollView>
        </View>

        <View style={styles.convThread}>
          {selectedConversation ? (
            <>
              <View style={styles.threadHeaderClean}>
                <View>
                  <Text style={styles.threadTitle}>{conversationCustomerName(selectedConversation)}</Text>
                  <Text style={styles.threadSubtitle}>{conversationChannelLabel(selectedConversation.channel)} · {selectedConversation.agent_mode === 'human' ? 'ทีมงานดูแลอยู่' : 'AI กำลังดูแล'}</Text>
                </View>
                <Pressable
                  disabled={!canUseAdminActions || conversationBusy === 'mode'}
                  onPress={() => void setConversationMode(isHumanMode ? 'ai' : 'human')}
                  style={[styles.threadModeButton, isHumanMode ? styles.threadModeButtonMuted : null, !canUseAdminActions ? styles.disabled : null]}
                >
                  <Text style={styles.threadModeButtonText}>{isHumanMode ? 'คืนให้ AI' : 'เข้าดูแลเอง'}</Text>
                </Pressable>
              </View>
              <ScrollView contentContainerStyle={styles.convMessages} showsVerticalScrollIndicator={false}>
                {conversationMessages.map((message) => {
                  const fromUser = message.role === 'user';

                  return (
                    <View key={message.id} style={[styles.convBubble, fromUser ? styles.convBubbleUser : styles.convBubbleAgent]}>
                      <Text style={[styles.convBubbleText, !fromUser ? styles.convBubbleTextAgent : null]}>{message.content}</Text>
                      <Text style={[styles.convBubbleTime, !fromUser ? styles.convBubbleTimeAgent : null]}>{formatDateTime(message.created_at)}</Text>
                    </View>
                  );
                })}
                {conversationMessages.length === 0 ? <EmptyState detail="เลือกห้องแชตหรือรอข้อความใหม่จาก backend" title="ยังไม่มีข้อความ" /> : null}
              </ScrollView>
              {conversationError ? <Text style={styles.inlineErrorText}>{conversationError}</Text> : null}
              <View style={styles.convComposer}>
                <TextInput
                  editable={isHumanMode && !conversationBusy}
                  multiline
                  onChangeText={setConversationInput}
                  placeholder={isHumanMode ? 'พิมพ์ข้อความตอบลูกค้า...' : 'กดเข้าดูแลเองก่อนตอบลูกค้า'}
                  placeholderTextColor="#9AA8C2"
                  style={styles.convInput}
                  value={conversationInput}
                />
                <Pressable disabled={!isHumanMode || !conversationInput.trim() || conversationBusy === 'reply'} onPress={() => void sendConversationReply()} style={[styles.chatSendButton, (!isHumanMode || !conversationInput.trim()) ? styles.disabled : null]}>
                  <Icon color="#FFFFFF" name={{ android: 'send', ios: 'paperplane.fill', web: 'send' }} size={18} />
                </Pressable>
              </View>
            </>
          ) : (
            <EmptyState detail="เลือกบทสนทนาจากกล่องข้อความเพื่อดู transcript และตอบกลับ" title="เลือกบทสนทนา" />
          )}
        </View>

        <View style={styles.convContext}>
          <Text style={styles.panelTitle}>ข้อมูลลูกค้า</Text>
          {selectedConversation ? (
            <>
              <View style={styles.customerCard}>
                <View style={styles.avatarCircle}>
                  <Text style={styles.avatarText}>{textInitial(conversationCustomerName(selectedConversation))}</Text>
                </View>
                <View style={styles.customerMain}>
                  <Text style={styles.customerName}>{conversationCustomerName(selectedConversation)}</Text>
                  <Text style={styles.customerPhone}>{conversationChannelLabel(selectedConversation.channel)}</Text>
                </View>
              </View>
              {selectedLinkedOrder ? (
                <Pressable onPress={() => {
                  setSelectedOrderId(selectedLinkedOrder.id);
                  setAdminView('orders');
                }} style={styles.linkedOrderCard}>
                  <Text style={styles.orderIdText}>{selectedLinkedOrder.id}</Text>
                  <Text numberOfLines={1} style={styles.mobileOrderTitle}>{orderProductName(selectedLinkedOrder)}</Text>
                  <Text style={styles.mobileMuted}>{formatMoney(selectedLinkedOrder.amount_baht, true)}</Text>
                  <Text style={styles.panelAction}>เปิดรายละเอียดออเดอร์ →</Text>
                </Pressable>
              ) : (
                <EmptyState detail="ยังไม่มีออเดอร์ที่ผูกกับ session นี้" title="ไม่มีออเดอร์" />
              )}
            </>
          ) : (
            <EmptyState detail="context จะแสดงหลังเลือกบทสนทนา" title="ยังไม่ได้เลือก" />
          )}
        </View>
      </View>
    );
  }

  function renderPaymentAdmin() {
    const selected = selectedPaymentOrder;

    return (
      <View style={styles.paymentWorkspace}>
        <View style={styles.paymentLeftPane}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
            {paymentFilters.map((filter) => {
              const active = paymentFilter === filter.id;

              return (
                <Pressable key={filter.id} onPress={() => setPaymentFilter(filter.id)} style={[styles.subFilterChip, active ? styles.subFilterChipActive : null]}>
                  <Text style={[styles.subFilterChipText, active ? styles.subFilterChipTextActive : null]}>{filter.label}</Text>
                  <Text style={[styles.filterCount, active ? styles.filterCountActive : null]}>{paymentCounts[filter.id]}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <ScrollView contentContainerStyle={styles.paymentTableContent} showsVerticalScrollIndicator={false}>
            <View style={styles.paymentHeaderRow}>
              <Text style={[styles.tableHeadText, styles.payCellCode]}>รหัส</Text>
              <Text style={[styles.tableHeadText, styles.payCellOrder]}>ออเดอร์</Text>
              <Text style={[styles.tableHeadText, styles.payCellAmount]}>ยอด</Text>
              <Text style={[styles.tableHeadText, styles.payCellProvider]}>ช่องทาง</Text>
              <Text style={[styles.tableHeadText, styles.payCellStatus]}>สถานะ</Text>
            </View>
            {paymentRows.map((order) => {
              const active = selected?.id === order.id;
              const tone = paymentStatusTone(order);

              return (
                <Pressable key={order.id} onPress={() => setSelectedOrderId(order.id)} style={[styles.paymentRow, active ? styles.paymentRowActive : null]}>
                  <Text style={[styles.tableCell, styles.payCellCode]}>PM-{order.id.slice(0, 4).toUpperCase()}</Text>
                  <Text style={[styles.tableCell, styles.payCellOrder, styles.orderIdText]}>{order.id}</Text>
                  <Text style={[styles.tableCell, styles.payCellAmount, styles.amountText]}>{formatMoney(order.amount_baht, true)}</Text>
                  <Text style={[styles.tableCell, styles.payCellProvider]}>{order.payment_provider ?? 'PromptPay'}</Text>
                  <View style={styles.payCellStatus}>
                    <Pill bg={tone.bg} fg={tone.fg}>{paymentStatusLabel(order)}</Pill>
                  </View>
                </Pressable>
              );
            })}
            {paymentRows.length === 0 ? <EmptyState detail={adminEmptyDetail()} title="ไม่มีรายการชำระเงินในสถานะนี้" /> : null}
          </ScrollView>
        </View>

        <View style={styles.paymentDetailPane}>
          {selected ? (
            <>
              <View style={styles.panelTitleRow}>
                <View>
                  <Text style={styles.detailOrderId}>PM-{selected.id.slice(0, 4).toUpperCase()}</Text>
                  <Text style={styles.panelSubtitle}>ออเดอร์ {selected.id}</Text>
                </View>
                <Pill bg={paymentStatusTone(selected).bg} fg={paymentStatusTone(selected).fg}>{paymentStatusLabel(selected)}</Pill>
              </View>
              <View style={styles.paymentDetailGrid}>
                <InfoPair label="ยอด" value={formatMoney(selected.amount_baht, true)} />
                <InfoPair label="ช่องทาง" value={selected.payment_provider ?? 'PromptPay'} />
                <InfoPair label="เวลา" value={formatDateTime(selected.paid_at ?? selected.updated_at)} />
                <InfoPair label="ลูกค้า" value={orderBuyerName(selected)} />
              </View>
              <View style={styles.slipPreviewBox}>
                <Icon color="#5A6B86" name={{ android: 'receipt_long', ios: 'doc.text', web: 'receipt_long' }} size={28} />
                <Text style={styles.slipPreviewTitle}>{selected.slip_url ? 'มีสลิปจากลูกค้า' : 'ยังไม่มีสลิป'}</Text>
                <Text style={styles.mobileMuted}>{selected.slip_url ? 'กดดูสลิปเพื่อสร้าง signed URL' : 'รอ webhook หรือหลักฐานชำระเงินจากลูกค้า'}</Text>
              </View>
              {signedSlipUrls[selected.id] ? <Text selectable style={styles.signedUrl}>{signedSlipUrls[selected.id]}</Text> : null}
              <View style={styles.paymentActionRow}>
                <Pressable disabled={!selected.slip_url || busyOrderAction === 'slip'} onPress={() => void requestSlipUrl(selected)} style={[styles.compactBlueButton, !selected.slip_url ? styles.disabled : null]}>
                  <Text style={styles.compactBlueButtonText}>ดูสลิป</Text>
                </Pressable>
                <Pressable disabled={!canUseAdminActions || selected.status !== 'submitted' || busyOrderAction !== null} onPress={() => void runOrderAction(selected, 'confirm')} style={[styles.detailPrimaryButton, (!canUseAdminActions || selected.status !== 'submitted') ? styles.disabled : null]}>
                  <Text style={styles.detailPrimaryButtonText}>ยืนยันการชำระ</Text>
                </Pressable>
                <Pressable disabled={!canUseAdminActions || !canCancelOrder(selected) || busyOrderAction !== null} onPress={() => void runOrderAction(selected, 'cancel')} style={[styles.detailDangerButton, (!canUseAdminActions || !canCancelOrder(selected)) ? styles.disabled : null]}>
                  <Text style={styles.detailDangerButtonText}>ปฏิเสธ/ยกเลิก</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <EmptyState detail="เลือก payment row เพื่อดู slip, provider, order และ action" title="เลือกรายการชำระเงิน" />
          )}
        </View>
      </View>
    );
  }

  function renderLineChannel() {
    const lineOrders = orders.filter((order) => order.channel === 'chat_line');
    const lineConversations = conversationSessions.filter((session) => session.channel === 'line');

    return (
      <ScrollView contentContainerStyle={styles.adminScrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.lineGrid}>
          <View style={styles.dashboardPanelWide}>
            <View style={styles.panelTitleRow}>
              <Text style={styles.panelTitle}>การเชื่อมต่อ LINE Official Account</Text>
              <Pill bg={backendReady ? 'rgba(16,185,129,0.12)' : '#FEF2F2'} fg={backendReady ? '#0F9D70' : '#B91C1C'}>
                {backendReady ? 'backend พร้อม' : 'ยังไม่พร้อม'}
              </Pill>
            </View>
            <Text style={styles.panelSubtitle}>Webhook URL สำหรับตั้งค่าใน LINE Developers Console</Text>
            <View style={styles.webhookBox}>
              <Text selectable numberOfLines={1} style={styles.webhookText}>{lineWebhookUrl}</Text>
              <Pressable onPress={() => void copyLineWebhookUrl()} style={styles.compactBlueButton}>
                <Text style={styles.compactBlueButtonText}>คัดลอก</Text>
              </Pressable>
            </View>
            <LineStatusRow label="Channel secret" status="ตรวจจาก Supabase secrets" ok={backendReady} />
            <LineStatusRow label="Channel access token" status="ตรวจจาก Supabase secrets" ok={backendReady} />
            <LineStatusRow label="Webhook verified" status={backendReady ? 'line-webhook deploy gate ผ่าน audit' : 'รอ env'} ok={backendReady} />
          </View>

          <View style={styles.dashboardPanel}>
            <Text style={styles.panelTitle}>เหตุการณ์ล่าสุด</Text>
            <InfoPair label="บทสนทนา LINE" value={`${lineConversations.length} ห้อง`} />
            <InfoPair label="ออเดอร์ช่องทาง LINE" value={`${lineOrders.length} รายการ`} />
            <InfoPair label="ฟังก์ชันตอบกลับ" value="admin-line-reply" />
          </View>
        </View>

        <View style={styles.lineGrid}>
          <View style={styles.dashboardPanelWide}>
            <Text style={styles.panelTitle}>ทดสอบข้อความ</Text>
            <Text style={styles.panelSubtitle}>ใช้สำหรับตรวจ UI state เท่านั้น การส่งจริงต้องทำในบทสนทนาที่เลือกและผ่าน admin-line-reply</Text>
            <View style={styles.lineTestRow}>
              <TextInput onChangeText={setLineTestText} placeholder="พิมพ์ข้อความทดสอบ..." placeholderTextColor="#9AA8C2" style={[styles.adminInput, styles.lineTestInput]} value={lineTestText} />
              <Pressable disabled={!lineTestText.trim()} onPress={() => {
                setNotice('ทดสอบ UI สำเร็จ: การส่งข้อความจริงให้เลือกบทสนทนา LINE ในหน้า บทสนทนา');
                setLineTestText('');
              }} style={[styles.compactBlueButton, !lineTestText.trim() ? styles.disabled : null]}>
                <Text style={styles.compactBlueButtonText}>ส่ง test</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.dashboardPanel}>
            <Text style={styles.panelTitle}>ทางลัด</Text>
            <Pressable onPress={() => {
              setConversationFilter('line');
              setAdminView('conv');
            }} style={styles.shortcutRow}>
              <Text style={styles.shortcutText}>บทสนทนาจาก LINE</Text>
              <Text style={styles.panelAction}>→</Text>
            </Pressable>
            <Pressable onPress={() => {
              setOrderFilter('all');
              setOrderSearch('LINE');
              setAdminView('orders');
            }} style={styles.shortcutRow}>
              <Text style={styles.shortcutText}>ออเดอร์ช่องทาง chat_line</Text>
              <Text style={styles.panelAction}>→</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    );
  }

  function renderAdminMain() {
    if (adminView === 'orders') {
      return renderAdminOrders();
    }

    if (adminView === 'catalog') {
      return renderCatalog();
    }

    if (adminView === 'referrers') {
      return renderReferrersAdmin();
    }

    if (adminView === 'conv') {
      return renderAdminConversations();
    }

    if (adminView === 'pay') {
      return renderPaymentAdmin();
    }

    if (adminView === 'line') {
      return renderLineChannel();
    }

    return renderAdminDashboard();
  }

  function renderAdminDesktop() {
    return (
      <View style={styles.adminDesktopOuter}>
        <View style={styles.adminDesktopBody}>
          <View style={styles.adminSidebar}>
            <Image resizeMode="contain" source={brandLogo} style={styles.sidebarLogo} />
            <Text style={styles.sidebarSection}>เมนู</Text>
            {adminViews.map((item) => {
              const active = adminView === item.id;

              return (
                <Pressable key={item.id} onPress={() => setAdminView(item.id)} style={[styles.sidebarButton, active ? styles.sidebarButtonActive : null]}>
                  <Icon color={active ? '#2563EB' : '#5A6B86'} name={item.icon} size={19} />
                  <Text style={[styles.sidebarButtonText, active ? styles.sidebarButtonTextActive : null]}>{item.label}</Text>
                </Pressable>
              );
            })}
            <View style={styles.sidebarUser}>
              <View style={styles.avatarCircleSmall}>
                <Text style={styles.avatarTextSmall}>{textInitial(tenant?.display_name)}</Text>
              </View>
              <View style={styles.sidebarUserText}>
                <Text numberOfLines={1} style={styles.sidebarUserName}>{tenant?.display_name ?? defaultTenantSlug}</Text>
                <Text style={styles.sidebarUserRole}>{tenantMember?.role ?? 'ยังไม่เข้า tenant'}</Text>
              </View>
            </View>
          </View>

          <View style={styles.adminContent}>
            <View style={styles.adminHeader}>
              <Text style={styles.adminHeaderTitle}>{adminViews.find((view) => view.id === adminView)?.label}</Text>
              <View style={styles.adminHeaderRight}>
                <View style={styles.headerSearchGhost}>
                  <Icon color="#9AA8C2" name={{ android: 'search', ios: 'magnifyingglass', web: 'search' }} size={15} />
                  <Text style={styles.headerSearchText}>ค้นหาออเดอร์ ลูกค้า...</Text>
                </View>
                <View style={styles.notificationBox}>
                  <Icon color="#5A6B86" name={{ android: 'notifications', ios: 'bell', web: 'notifications' }} size={18} />
                  {dashboardStats.pending > 0 ? <View style={styles.notificationDot} /> : null}
                </View>
              </View>
            </View>
            <View style={styles.adminContentBody}>{renderAdminMain()}</View>
          </View>
        </View>
      </View>
    );
  }

  function renderAdminMobile() {
    return renderPhoneShell(
      <View style={styles.adminMobileRoot}>
        {renderStatusBar()}
        <View style={styles.adminMobileHeader}>
          <View>
            <Text style={styles.adminMobileEyebrow}>Mira AI Back Office</Text>
            <Text style={styles.adminMobileTitle}>{adminViews.find((view) => view.id === adminView)?.label}</Text>
          </View>
          <View style={styles.avatarCircleSmall}>
            <Text style={styles.avatarTextSmall}>{textInitial(tenant?.display_name)}</Text>
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.adminMobileScroll} showsVerticalScrollIndicator={false}>
          {adminView === 'orders'
            ? filteredOrders.slice(0, 12).map((order) => (
                <Pressable key={order.id} onPress={() => setSelectedOrderId(order.id)} style={styles.mobileOrderCard}>
                  <View style={styles.mobileOrderTop}>
                    <Text style={styles.orderIdText}>{order.id}</Text>
                    <Pill bg={statusMeta(order.status, orderKind(order)).bg} fg={statusMeta(order.status, orderKind(order)).fg}>
                      {statusMeta(order.status, orderKind(order)).label}
                    </Pill>
                  </View>
                  <Text style={styles.mobileOrderTitle}>{orderProductName(order)}</Text>
                  <Text style={styles.mobileMuted}>{shortName(orderBuyerName(order))} · {formatMoney(order.amount_baht, true)}</Text>
                  <Pressable onPress={() => setSelectedOrderId(order.id)} style={styles.compactBlueButton}>
                    <Text style={styles.compactBlueButtonText}>ดำเนินการ</Text>
                  </Pressable>
                </Pressable>
              ))
            : adminView === 'conv'
              ? conversationSessions.slice(0, 12).map((session) => (
                  <Pressable key={session.id} onPress={() => {
                    setSelectedConversationId(session.id);
                    setAdminDevice('desktop');
                  }} style={styles.mobileOrderCard}>
                    <Text style={styles.mobileOrderTitle}>{conversationCustomerName(session)}</Text>
                    <Text style={styles.mobileMuted}>{conversationChannelLabel(session.channel)} · {formatDateTime(session.last_message_at)}</Text>
                    <Pill bg={session.agent_mode === 'human' ? '#FDF1DE' : 'rgba(37,99,235,0.1)'} fg={session.agent_mode === 'human' ? '#C9810A' : '#2563EB'}>
                      {session.agent_mode === 'human' ? 'ทีมงานดูแล' : 'AI ดูแล'}
                    </Pill>
                  </Pressable>
                ))
            : adminView === 'pay'
              ? paymentRows.slice(0, 12).map((order) => (
                  <Pressable key={order.id} onPress={() => setSelectedOrderId(order.id)} style={styles.mobileOrderCard}>
                    <View style={styles.mobileOrderTop}>
                      <Text style={styles.orderIdText}>{order.id}</Text>
                      <Pill bg={paymentStatusTone(order).bg} fg={paymentStatusTone(order).fg}>
                        {paymentStatusLabel(order)}
                      </Pill>
                    </View>
                    <Text style={styles.mobileOrderTitle}>{formatMoney(order.amount_baht, true)}</Text>
                    <Text style={styles.mobileMuted}>{order.payment_provider ?? 'PromptPay'} · {orderBuyerName(order)}</Text>
                  </Pressable>
                ))
            : adminView === 'line'
              ? (
                  <View style={styles.mobileDashboardGrid}>
                    <MiniStat label="LINE orders" value={String(orders.filter((order) => order.channel === 'chat_line').length)} active />
                    <MiniStat label="Webhook" value={backendReady ? 'พร้อม' : 'ยัง'} />
                    <MiniStat label="Conversations" value={String(conversationSessions.filter((session) => session.channel === 'line').length)} />
                    <MiniStat label="Tenant" value={activeTenantSlug} />
                  </View>
                )
            : adminView === 'catalog'
              ? products.slice(0, 12).map((product) => (
                  <View key={product.id} style={styles.mobileOrderCard}>
                    <Text style={styles.mobileOrderTitle}>{product.title}</Text>
                    <Text style={styles.catalogPrice}>{formatMoney(product.priceAmount, true)}</Text>
                    <Text numberOfLines={2} style={styles.mobileMuted}>{product.description}</Text>
                  </View>
                ))
              : adminView === 'referrers'
                ? referrers.slice(0, 12).map((referrer) => (
                    <View key={referrer.id} style={styles.mobileOrderCard}>
                      <Text style={styles.mobileOrderTitle}>{referrer.name}</Text>
                      <Text style={styles.mobileMuted}>{referrer.ref_code} · {referrer.type}</Text>
                    </View>
                  ))
                : (
                    <View style={styles.mobileDashboardGrid}>
                      <MiniStat label="ยอดขาย" value={formatMoney(dashboardStats.revenue, true)} active />
                      <MiniStat label="รอดำเนินการ" value={String(dashboardStats.pending)} />
                      <MiniStat label="สินค้า" value={`${dashboardStats.activeProducts}/${products.length}`} />
                      <MiniStat label="REF" value={String(dashboardStats.activeReferrers)} />
                    </View>
                  )}
        </ScrollView>
        <View style={styles.adminMobileNav}>
          {adminViews.map((item) => {
            const active = adminView === item.id;

            return (
              <Pressable key={item.id} onPress={() => setAdminView(item.id)} style={styles.phoneNavButton}>
                <Icon color={active ? '#2563EB' : '#9AA8C2'} name={item.icon} size={21} />
                <Text style={[styles.phoneNavText, active ? styles.phoneNavTextActive : null]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {selectedOrder ? (
          <View style={styles.mobileSheet}>
            {renderOrderDetail(selectedOrder, true)}
          </View>
        ) : null}
      </View>,
    );
  }

  function stageInfo(order: AdminOrderRow, stage: number) {
    const kind = orderKind(order);
    const isProduct = kind === 'product';

    if (stage === 0) {
      return {
        lines: [{ label: isProduct ? 'สินค้า' : 'สาขาที่เลือก', value: isProduct ? orderProductName(order) : orderBranchName(order) }],
        note: isProduct ? 'ลูกค้าเลือกสินค้าจาก AI Chat หรือ Referral' : 'ลูกค้าเลือกสาขาที่สะดวกก่อนกรอกข้อมูล',
      };
    }

    if (stage === 1) {
      return {
        lines: [
          { label: 'ชื่อ', value: orderBuyerName(order) },
          { label: 'เบอร์โทร', value: orderBuyerPhone(order) },
          { label: isProduct ? 'ที่อยู่จัดส่ง' : 'ช่วงเวลาสะดวก', value: isProduct ? order.preferred_branch ?? '-' : order.preferred_time_window ?? '-' },
        ],
        note: '',
      };
    }

    if (stage === 2) {
      return {
        lines: [
          { label: 'ยอดที่ต้องชำระ', value: formatMoney(order.amount_baht, true) },
          { label: 'ช่องทาง', value: order.payment_provider ?? 'PromptPay / Stripe' },
          { label: 'สถานะชำระ', value: order.status === 'submitted' ? 'ส่งหลักฐานแล้ว รอตรวจ' : 'รอชำระ' },
        ],
        note: 'การยืนยันชำระเงินต้องผ่าน backend admin-order-action หรือ webhook เท่านั้น',
      };
    }

    if (stage === 3) {
      return {
        lines: [
          { label: 'ยืนยันเมื่อ', value: formatDateTime(order.paid_at ?? order.updated_at) },
          { label: 'ผู้ยืนยัน', value: order.status === 'confirmed' ? 'ทีมงาน / ระบบ' : 'ระบบ' },
        ],
        note: 'หลังยืนยันแล้ว ทีมงานจึงบันทึกนัดหมายหรือการจัดส่งในขั้นถัดไป',
      };
    }

    if (stage === 4) {
      return {
        lines: [
          { label: isProduct ? 'ขนส่ง' : 'วันนัดหมาย', value: isProduct ? 'ระบุในโน้ตภายใน' : formatDateTime(order.booking_at) },
          { label: isProduct ? 'เลขพัสดุ' : 'สาขา', value: isProduct ? order.admin_note ?? '-' : orderBranchName(order) },
        ],
        note: isProduct ? 'ใส่ข้อมูลขนส่งในโน้ตภายในก่อนปิดงาน' : 'ตรวจวัน เวลา และสาขาก่อนยืนยันนัดหมาย',
      };
    }

    return {
      lines: [{ label: 'ปิดงานเมื่อ', value: formatDateTime(order.updated_at) }],
      note: isProduct ? 'ลูกค้าได้รับสินค้าเรียบร้อยแล้ว' : 'ลูกค้าเข้ารับบริการเรียบร้อยแล้ว',
    };
  }

  function renderOrderDetail(order: AdminOrderRow, mobile: boolean) {
    const kind = orderKind(order);
    const meta = statusMeta(order.status, kind);
    const stage = selectedStage ?? stageForStatus(order.status);
    const steps = stepsForOrder(order);
    const info = stageInfo(order, stage);
    const primaryAction = primaryActionForOrder(order);
    const signedSlipUrl = signedSlipUrls[order.id];

    return (
      <View style={[styles.detailRoot, mobile ? styles.detailRootMobile : null]}>
        <View style={styles.detailHeader}>
          {mobile ? (
            <Pressable onPress={() => setSelectedOrderId(null)} style={styles.backButton}>
              <Icon color="#5A6B86" name={{ android: 'arrow_back', ios: 'chevron.left', web: 'arrow_back' }} size={18} />
            </Pressable>
          ) : null}
          <View style={styles.detailTitleGroup}>
            <Text style={styles.detailOrderId}>{order.id}</Text>
            <View style={styles.detailPills}>
              <Pill bg={meta.bg} fg={meta.fg}>{meta.label}</Pill>
              <Pill bg={kind === 'product' ? 'rgba(139,92,246,0.12)' : 'rgba(37,99,235,0.1)'} fg={kind === 'product' ? '#7C3AED' : '#2563EB'}>
                {kind === 'product' ? 'สินค้า' : 'บริการ'}
              </Pill>
            </View>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.detailScrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.customerCard}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>{textInitial(orderBuyerName(order))}</Text>
            </View>
            <View style={styles.customerMain}>
              <Text style={styles.customerName}>{orderBuyerName(order)}</Text>
              <Text style={styles.customerPhone}>{orderBuyerPhone(order)}</Text>
            </View>
            <Pill bg={order.channel === 'chat_line' ? 'rgba(6,199,85,0.12)' : 'rgba(37,99,235,0.1)'} fg={order.channel === 'chat_line' ? '#06A04A' : '#2563EB'}>
              {channelLabel(order.channel)}
            </Pill>
          </View>

          <Text style={styles.timelineLabel}>ความคืบหน้าออเดอร์</Text>
          <View style={styles.timeline}>
            {steps.map((stepLabel, index) => {
              const currentStage = stageForStatus(order.status);
              const state = order.status === 'cancelled' ? 'todo' : index < currentStage ? 'done' : index === currentStage ? 'current' : 'todo';

              return (
                <Pressable key={stepLabel} onPress={() => setSelectedStage(index)} style={styles.timelineRow}>
                  <View style={styles.timelineDotColumn}>
                    <View style={[styles.timelineDot, state === 'done' ? styles.timelineDotDone : state === 'current' ? styles.timelineDotCurrent : null]}>
                      {state === 'done' ? <Text style={styles.timelineCheck}>✓</Text> : null}
                    </View>
                    {index < steps.length - 1 ? <View style={[styles.timelineLine, state === 'done' ? styles.timelineLineDone : null]} /> : null}
                  </View>
                  <Text style={[styles.timelineText, stage === index ? styles.timelineTextSelected : state === 'todo' ? styles.timelineTextMuted : null]}>{stepLabel}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.stageCard}>
            <View style={styles.panelTitleRow}>
              <Text style={styles.stageCardTitle}>{steps[stage]}</Text>
              <Pill bg={stage < stageForStatus(order.status) ? 'rgba(16,185,129,0.12)' : stage === stageForStatus(order.status) ? 'rgba(37,99,235,0.1)' : '#F1F5F9'} fg={stage < stageForStatus(order.status) ? '#0F9D70' : stage === stageForStatus(order.status) ? '#2563EB' : '#94A3B8'}>
                {stage < stageForStatus(order.status) ? 'เสร็จแล้ว' : stage === stageForStatus(order.status) ? 'กำลังดำเนินการ' : 'รอดำเนินการ'}
              </Pill>
            </View>
            {info.lines.map((line) => (
              <View key={line.label} style={styles.infoLine}>
                <Text style={styles.infoLineLabel}>{line.label}</Text>
                <Text style={styles.infoLineValue}>{line.value}</Text>
              </View>
            ))}
            {info.note ? <Text style={styles.stageNote}>{info.note}</Text> : null}
          </View>

          {primaryAction === 'book' ? (
            <View style={styles.stageCard}>
              <Text style={styles.stageCardTitle}>{kind === 'product' ? 'ข้อมูลจัดส่ง' : 'ข้อมูลนัดหมาย'}</Text>
              <View style={styles.inlineInputs}>
                <TextInput onChangeText={setBookingDate} placeholder="YYYY-MM-DD" placeholderTextColor="#9AA8C2" style={[styles.adminInput, styles.inlineInput]} value={bookingDate} />
                <TextInput onChangeText={setBookingTime} placeholder="HH:mm" placeholderTextColor="#9AA8C2" style={[styles.adminInput, styles.inlineInput]} value={bookingTime} />
              </View>
            </View>
          ) : null}

          <View style={styles.paymentCard}>
            <View>
              <Text style={styles.paymentLabel}>การชำระเงิน · {order.payment_provider ?? 'ยังไม่ระบุ'}</Text>
              <Text style={styles.paymentAmount}>{formatMoney(order.amount_baht, true)}</Text>
            </View>
            <Pressable disabled={!order.slip_url || busyOrderAction === 'slip'} onPress={() => void requestSlipUrl(order)}>
              <Text style={[styles.panelAction, !order.slip_url ? styles.mutedAction : null]}>{signedSlipUrl ? 'ลิงก์พร้อม' : 'ดูสลิป'}</Text>
            </Pressable>
          </View>
          {signedSlipUrl ? <Text selectable style={styles.signedUrl}>{signedSlipUrl}</Text> : null}

          <View style={styles.referralInfoCard}>
            <View>
              <Text style={styles.paymentLabel}>ผู้แนะนำ</Text>
              <Text style={styles.referralInfoText}>{orderReferrerName(order)}</Text>
            </View>
            <View style={styles.rightText}>
              <Text style={styles.paymentLabel}>คอมมิชชั่น</Text>
              <Text style={styles.paymentAmount}>{order.commission_scheme_snapshot ? 'ตาม snapshot' : '-'}</Text>
            </View>
          </View>

          <View style={styles.stageCard}>
            <Text style={styles.stageCardTitle}>โน้ตภายใน</Text>
            <TextInput
              multiline
              onChangeText={setAdminNote}
              placeholder="เพิ่มโน้ตสำหรับทีมงาน"
              placeholderTextColor="#9AA8C2"
              style={[styles.adminInput, styles.noteInput]}
              value={adminNote}
            />
            <Pressable disabled={!canUseAdminActions || busyOrderAction !== null} onPress={() => void saveOrderNote()} style={[styles.compactBlueButton, (!canUseAdminActions || busyOrderAction !== null) ? styles.disabled : null]}>
              <Text style={styles.compactBlueButtonText}>บันทึกโน้ต</Text>
            </Pressable>
          </View>

          <Text style={styles.timelineLabel}>บทสนทนากับ AI</Text>
          <View style={styles.transcriptCard}>
            {transcript.length > 0 ? (
              transcript.map((message) => (
                <View key={message.id} style={[styles.transcriptBubble, message.role === 'user' ? styles.transcriptBubbleUser : null]}>
                  <Text style={[styles.transcriptText, message.role === 'user' ? styles.transcriptTextUser : null]}>{message.content}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.mobileMuted}>ยังไม่มี transcript ใน session นี้</Text>
            )}
          </View>
        </ScrollView>

        <View style={styles.detailFooter}>
          {primaryAction ? (
            <Pressable disabled={!canUseAdminActions || busyOrderAction !== null} onPress={() => void runOrderAction(order, primaryAction)} style={[styles.detailPrimaryButton, (!canUseAdminActions || busyOrderAction !== null) ? styles.disabled : null]}>
              <Text style={styles.detailPrimaryButtonText}>{busyOrderAction === primaryAction ? 'กำลังอัปเดต' : primaryActionLabel(order)}</Text>
            </Pressable>
          ) : null}
          {canCancelOrder(order) ? (
            <Pressable disabled={!canUseAdminActions || busyOrderAction !== null} onPress={() => void runOrderAction(order, 'cancel')} style={styles.detailDangerButton}>
              <Text style={styles.detailDangerButtonText}>ยกเลิก</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => setSelectedOrderId(null)} style={styles.detailCloseButton}>
            <Text style={styles.detailCloseButtonText}>ปิด</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  function renderAdmin() {
    return (
      <View style={styles.adminStage}>
        {adminDevice === 'desktop' && !isCompact ? renderAdminDesktop() : renderAdminMobile()}
      </View>
    );
  }

  function renderChatCards(message: ChatMessage) {
    const cards = message.uiCards ?? [];

    if (cards.length === 0 && !message.order) {
      return null;
    }

    return (
      <View style={styles.chatCards}>
        {cards.map((card) => {
          if (card.type === 'product_grid') {
            return (
              <View key={card.id} style={styles.chatCardPanel}>
                <Text style={styles.chatCardTitle}>{card.title}</Text>
                {card.products.slice(0, 3).map((product) => (
                  <View key={product.id} style={styles.chatProductCard}>
                    <Text numberOfLines={1} style={styles.chatProductTitle}>{product.title}</Text>
                    <Text style={styles.chatProductPrice}>{formatMoney(product.priceAmount, true)}</Text>
                    <Text numberOfLines={2} style={styles.chatProductDesc}>{product.description}</Text>
                  </View>
                ))}
              </View>
            );
          }

          if (card.type === 'checkout_draft') {
            return (
              <View key={card.id} style={styles.chatCardPanel}>
                <Text style={styles.chatCardTitle}>{card.title}</Text>
                <Text style={styles.chatProductTitle}>{card.product.title}</Text>
                <Text style={styles.chatProductPrice}>{formatMoney(card.product.priceAmount, true)}</Text>
                <Pressable style={styles.compactBlueButton}>
                  <Text style={styles.compactBlueButtonText}>ดำเนินการชำระเงิน</Text>
                </Pressable>
              </View>
            );
          }

          if (card.type === 'order_status') {
            return (
              <View key={card.id} style={styles.chatCardPanel}>
                <Text style={styles.chatCardTitle}>{card.title}</Text>
                {card.orders.map((order) => (
                  <Text key={order.id} style={styles.chatProductDesc}>{order.id} · {order.status}</Text>
                ))}
              </View>
            );
          }

          return null;
        })}
        {message.order ? (
          <View style={styles.chatCardPanel}>
            <Text style={styles.chatCardTitle}>สรุปออเดอร์</Text>
            <Text style={styles.chatProductTitle}>{message.order.product_name}</Text>
            <Text style={styles.chatProductPrice}>{formatMoney(message.order.amount_baht, true)}</Text>
            <Text style={styles.chatProductDesc}>สถานะ: {message.order.status}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  function renderChatPhone() {
    return renderPhoneShell(
      <View style={styles.chatRoot}>
        <View style={styles.chatHeader}>
          <View style={styles.chatAvatar}>
            <Icon color="#FFFFFF" name={{ android: 'auto_awesome', ios: 'sparkles', web: 'auto_awesome' }} size={22} />
            <View style={styles.onlineDot} />
          </View>
          <View style={styles.chatHeaderText}>
            <Text style={styles.chatHeaderTitle}>Mira AI</Text>
            <Text style={styles.chatHeaderSub}>ผู้ช่วยขายอัจฉริยะ · ออนไลน์</Text>
          </View>
          <Icon color="#8FA6CE" name={{ android: 'more_horiz', ios: 'ellipsis', web: 'more_horiz' }} size={20} />
        </View>

        <ScrollView contentContainerStyle={styles.chatMessages} showsVerticalScrollIndicator={false}>
          <Text style={styles.chatDateChip}>วันนี้ 09:41</Text>
          {chatMessages.map((message) => (
            <View key={message.id} style={styles.chatMessageBlock}>
              <View style={[
                styles.chatBubble,
                message.role === 'user' ? styles.chatBubbleUser : message.role === 'system_notice' ? styles.chatBubbleNotice : null,
              ]}>
                <Text style={[
                  styles.chatBubbleText,
                  message.role === 'user' ? styles.chatBubbleTextUser : message.role === 'system_notice' ? styles.chatBubbleTextNotice : null,
                ]}>
                  {message.content}
                </Text>
              </View>
              {renderChatCards(message)}
            </View>
          ))}
          {chatBusy ? (
            <View style={styles.typingBubble}>
              <View style={styles.typingDot} />
              <View style={styles.typingDot} />
              <View style={styles.typingDot} />
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.chatComposer}>
          <TextInput
            multiline
            onChangeText={setChatInput}
            placeholder={auth.session || aiChatConfigStatus.hasProxy ? 'พิมพ์คำถามหรือขอแพ็กเกจ...' : 'ตั้งค่า backend/AI เพื่อคุยจริง'}
            placeholderTextColor="#9AA8C2"
            style={styles.chatInput}
            value={chatInput}
          />
          <Pressable disabled={!chatInput.trim() || chatBusy} onPress={() => void sendChatMessage()} style={[styles.chatSendButton, (!chatInput.trim() || chatBusy) ? styles.disabled : null]}>
            <Icon color="#FFFFFF" name={{ android: 'send', ios: 'paperplane.fill', web: 'send' }} size={18} />
          </Pressable>
        </View>
      </View>,
      true,
    );
  }

  function adminEmptyDetail() {
    if (dataLoading || auth.isLoading) {
      return 'กำลังโหลดข้อมูลจาก backend';
    }

    if (!backendReady) {
      return 'ยังไม่ได้ตั้งค่า Supabase public env';
    }

    if (!auth.session) {
      return 'เข้าสู่ระบบด้วยบัญชี Admin/Referral เพื่อดูข้อมูลจริง';
    }

    if (!tenantMember) {
      return 'บัญชีนี้ยังไม่ได้อยู่ใน tenant_members';
    }

    return 'ยังไม่มีข้อมูลใน tenant นี้';
  }

  const stageContent = module === 'referral' ? renderReferralPhone() : module === 'admin' ? renderAdmin() : renderChatPhone();

  return (
    <LinearGradient colors={['#EAF2FF', '#DCEAFF', '#E8F0FF']} style={styles.screen}>
      <View pointerEvents="none" style={styles.meshOne} />
      <View pointerEvents="none" style={styles.meshTwo} />
      <ScrollView contentContainerStyle={[styles.container, isCompact ? styles.containerCompact : null]} showsVerticalScrollIndicator={false}>
        <View style={[styles.topChrome, isCompact ? styles.topChromeCompact : null]}>
          <View style={styles.brandGroup}>
            <View style={styles.logoPlate}>
              <Image resizeMode="contain" source={brandLogo} style={styles.logo} />
            </View>
            <View style={styles.brandCopy}>
              <Text style={styles.brandLine}>แพลตฟอร์มขายอัจฉริยะ</Text>
              <Text style={styles.brandSub}>Live system base</Text>
            </View>
          </View>

          <View style={styles.moduleTabs}>
            {modules.map((item) => (
              <Pressable key={item.id} onPress={() => setModule(item.id)} style={[styles.moduleTab, module === item.id ? styles.moduleTabActive : null]}>
                <Text style={[styles.moduleTabText, module === item.id ? styles.moduleTabTextActive : null]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={[styles.captionRow, isCompact ? styles.captionRowCompact : null]}>
          <Text style={[styles.caption, isCompact ? styles.captionCompact : null]}>
            <Text style={styles.captionAccent}>{moduleCopy[module].accent}</Text>
            {' · '}
            {moduleCopy[module].caption}
          </Text>
          {module === 'admin' ? (
            <View style={[styles.deviceToggle, isCompact ? styles.deviceToggleCompact : null]}>
              <Pressable onPress={() => setAdminDevice('desktop')} style={[styles.deviceButton, adminDevice === 'desktop' ? styles.deviceButtonActive : null]}>
                <Text style={[styles.deviceButtonText, adminDevice === 'desktop' ? styles.deviceButtonTextActive : null]}>Desktop</Text>
              </Pressable>
              <Pressable onPress={() => setAdminDevice('mobile')} style={[styles.deviceButton, adminDevice === 'mobile' ? styles.deviceButtonActive : null]}>
                <Text style={[styles.deviceButtonText, adminDevice === 'mobile' ? styles.deviceButtonTextActive : null]}>Mobile</Text>
              </Pressable>
            </View>
          ) : null}
          {module === 'chat' ? (
            <Pressable onPress={() => setChatMessages([])} style={styles.replayButton}>
              <Icon color="#2563EB" name={{ android: 'refresh', ios: 'arrow.clockwise', web: 'refresh' }} size={15} />
              <Text style={styles.replayButtonText}>เล่นใหม่</Text>
            </Pressable>
          ) : null}
          <Text style={[styles.connectionPill, isCompact ? styles.connectionPillCompact : null]}>{connectionLabel()}</Text>
        </View>

        {globalError ? <Text style={styles.errorBanner}>{globalError}</Text> : null}
        {notice ? <Text style={styles.noticeBanner}>{notice}</Text> : null}

        <View style={[styles.stage, isCompact ? styles.stageCompact : null, module === 'admin' && adminDevice === 'desktop' && !isCompact && !isNarrowDesktop ? styles.stageAdminDesktop : null]}>
          {stageContent}
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

function DashboardCard({ label, meta, value }: { label: string; meta: string; value: string }) {
  return (
    <View style={styles.dashboardCard}>
      <Text style={styles.dashboardCardLabel}>{label}</Text>
      <Text style={styles.dashboardCardValue}>{value}</Text>
      <Text numberOfLines={1} style={styles.dashboardCardMeta}>{meta}</Text>
    </View>
  );
}

function InfoPair({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoPair}>
      <Text style={styles.infoPairLabel}>{label}</Text>
      <Text style={styles.infoPairValue}>{value}</Text>
    </View>
  );
}

function LineStatusRow({ label, ok, status }: { label: string; ok: boolean; status: string }) {
  return (
    <View style={styles.lineStatusRow}>
      <Text style={styles.lineStatusLabel}>{label}</Text>
      <Text style={[styles.lineStatusValue, ok ? styles.lineStatusOk : styles.lineStatusMissing]}>{ok ? `✓ ${status}` : status}</Text>
    </View>
  );
}

function MiniStat({ active = false, label, value }: { active?: boolean; label: string; value: string }) {
  return (
    <View style={[styles.miniStat, active ? styles.miniStatActive : null]}>
      <Text style={[styles.miniStatValue, active ? styles.miniStatValueActive : null]}>{value}</Text>
      <Text style={styles.miniStatLabel}>{label}</Text>
    </View>
  );
}

function ReferralCommissionItem({ entry, showReferrer = false }: { entry: CommissionWithJoins; showReferrer?: boolean }) {
  const order = fromJoin(entry.orders);
  const product = fromJoin(order?.products);
  const referrer = fromJoin(entry.referrers);
  const success = entry.status === 'approved' || entry.status === 'paid';

  return (
    <View style={styles.commissionItem}>
      <View style={[styles.commissionAvatar, success ? styles.commissionAvatarSuccess : null]} />
      <View style={styles.commissionMain}>
        <Text numberOfLines={1} style={styles.commissionTitle}>
          {showReferrer && referrer ? `${referrer.name} · ` : ''}
          {product?.name ?? entry.order_id}
        </Text>
        <Text style={styles.commissionMeta}>{formatShortDate(entry.created_at)}</Text>
      </View>
      <View style={styles.commissionRight}>
        <Text style={[styles.commissionAmount, success ? styles.commissionAmountSuccess : null]}>+{formatMoney(entry.amount_baht, true)}</Text>
        <Text style={[styles.commissionStatus, success ? styles.commissionStatusSuccess : null]}>{commissionStatusLabel(entry.status)}</Text>
      </View>
    </View>
  );
}

const shadowSoft = {
  shadowColor: '#1F54AA',
  shadowOffset: { height: 8, width: 0 },
  shadowOpacity: 0.12,
  shadowRadius: 24,
};

const styles = StyleSheet.create({
  adminContent: {
    backgroundColor: '#F5F8FC',
    flex: 1,
    minWidth: 0,
  },
  adminContentBody: {
    flex: 1,
    minHeight: 0,
  },
  adminDesktopBody: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 0,
  },
  adminDesktopOuter: {
    backgroundColor: '#F5F8FC',
    borderColor: '#DDE8F7',
    borderRadius: 0,
    borderWidth: 1,
    height: 740,
    maxWidth: '100%',
    overflow: 'hidden',
    shadowColor: '#0D2656',
    shadowOffset: { height: 44, width: 0 },
    shadowOpacity: 0.32,
    shadowRadius: 100,
    width: 1100,
  },
  adminHeader: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomColor: '#ECF0F7',
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 66,
    justifyContent: 'space-between',
    paddingHorizontal: 26,
  },
  adminHeaderRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
  },
  adminHeaderTitle: {
    color: '#0E2143',
    fontSize: 19,
    fontWeight: '800',
  },
  adminInput: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E4ECF8',
    borderRadius: 11,
    borderWidth: 1,
    color: '#0E2143',
    fontSize: 14,
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  adminMobileEyebrow: {
    color: '#7B89A4',
    fontSize: 12,
    fontWeight: '700',
  },
  adminMobileHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  adminMobileNav: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.86)',
    borderTopColor: 'rgba(255,255,255,0.95)',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingBottom: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  adminMobileRoot: {
    backgroundColor: '#F5F8FC',
    flex: 1,
  },
  adminMobileScroll: {
    gap: 12,
    padding: 18,
    paddingBottom: 24,
  },
  adminMobileTitle: {
    color: '#0E2143',
    fontSize: 21,
    fontWeight: '900',
  },
  adminScrollContent: {
    gap: 16,
    padding: 24,
  },
  adminSidebar: {
    backgroundColor: '#FFFFFF',
    borderRightColor: '#E7EEF8',
    borderRightWidth: 1,
    gap: 5,
    paddingHorizontal: 18,
    paddingVertical: 24,
    width: 238,
  },
  adminStage: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  amountText: {
    color: '#0E2143',
    fontWeight: '800',
  },
  avatarCircle: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 23,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  avatarCircleSmall: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
  },
  avatarTextSmall: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: '#F3F6FB',
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  barChart: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 14,
    height: 172,
    paddingTop: 12,
  },
  barSlot: {
    alignItems: 'center',
    flex: 1,
    gap: 8,
    height: '100%',
    justifyContent: 'flex-end',
  },
  bigBlueButton: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 16,
    shadowColor: '#2563EB',
    shadowOffset: { height: 12, width: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 26,
  },
  bigBlueButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  branchChip: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E4ECF8',
    borderRadius: 10,
    borderWidth: 1,
    marginRight: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  branchChipActive: {
    backgroundColor: 'rgba(37,99,235,0.1)',
    borderColor: '#2563EB',
  },
  branchChipText: {
    color: '#8595B0',
    fontSize: 12,
    fontWeight: '800',
  },
  branchChipTextActive: {
    color: '#2563EB',
  },
  branchScroll: {
    marginVertical: 4,
  },
  brandCopy: {
    gap: 2,
  },
  brandGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
  },
  brandLine: {
    color: '#5A6B86',
    fontSize: 14,
    lineHeight: 19,
  },
  brandSub: {
    color: '#9AA8C2',
    fontSize: 14,
  },
  bulkActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginLeft: 'auto',
  },
  bulkBar: {
    alignItems: 'center',
    backgroundColor: '#0E2143',
    borderRadius: 13,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  bulkClear: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bulkDanger: {
    backgroundColor: '#DC2626',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bulkGhost: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bulkGhostText: {
    color: '#D7E0EE',
    fontSize: 12,
    fontWeight: '800',
  },
  bulkPrimary: {
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bulkPrimaryText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  bulkText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  caption: {
    color: '#5A6B86',
    flexShrink: 1,
    fontSize: 14.5,
    lineHeight: 21,
    textAlign: 'center',
  },
  captionCompact: {
    maxWidth: '100%',
    paddingHorizontal: 4,
    width: '100%',
  },
  captionAccent: {
    color: '#2563EB',
    fontWeight: '900',
  },
  captionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center',
    minHeight: 36,
  },
  captionRowCompact: {
    alignSelf: 'stretch',
    flexDirection: 'column',
    maxWidth: '100%',
    overflow: 'hidden',
    width: '100%',
  },
  catalogBody: {
    gap: 8,
    padding: 16,
  },
  branchPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  branchPickChip: {
    backgroundColor: '#FFFFFF',
    borderColor: '#DCE7F5',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  branchPickChipActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  branchPickText: {
    color: '#5A6B86',
    fontSize: 12,
    fontWeight: '900',
  },
  branchPickTextActive: {
    color: '#FFFFFF',
  },
  catalogBranch: {
    color: '#8595B0',
    fontSize: 12,
    fontWeight: '700',
  },
  catalogActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  catalogCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#ECF0F7',
    borderRadius: 16,
    borderWidth: 1,
    flexBasis: 220,
    flexGrow: 1,
    maxWidth: 280,
    overflow: 'hidden',
  },
  catalogCardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  catalogDesc: {
    color: '#5A6B86',
    fontSize: 12.5,
    lineHeight: 18,
  },
  catalogDescriptionInput: {
    minHeight: 112,
    textAlignVertical: 'top',
  },
  catalogEditorActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  catalogEditorPanel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#ECF0F7',
    borderRadius: 16,
    borderWidth: 1,
    flex: 0.9,
    gap: 14,
    minWidth: 320,
    padding: 18,
  },
  catalogFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  catalogFormGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  catalogGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  catalogListPane: {
    flex: 1.15,
    minWidth: 420,
  },
  catalogToggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  catalogToolbar: {
    gap: 12,
  },
  catalogTopActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  catalogWorkspace: {
    flexDirection: 'row',
    gap: 16,
  },
  catalogImage: {
    height: 120,
    justifyContent: 'flex-end',
    padding: 12,
  },
  catalogImageText: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderRadius: 7,
    color: '#2563EB',
    fontSize: 11,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  catalogPrice: {
    color: '#2563EB',
    fontSize: 18,
    fontWeight: '900',
  },
  catalogTitle: {
    color: '#0E2143',
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 20,
  },
  cellAction: {
    flexBasis: 110,
  },
  cellAmount: {
    flexBasis: 78,
  },
  cellCheck: {
    flexBasis: 28,
  },
  cellCustomer: {
    flex: 1,
    minWidth: 90,
  },
  cellId: {
    flexBasis: 92,
  },
  cellProduct: {
    flex: 1.25,
    minWidth: 130,
  },
  cellStatus: {
    flexBasis: 116,
  },
  chartBar: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    width: '100%',
  },
  chartLabel: {
    color: '#8595B0',
    fontSize: 11,
    fontWeight: '700',
  },
  chartTrack: {
    alignItems: 'stretch',
    backgroundColor: '#DCEBFA',
    borderRadius: 8,
    flex: 1,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    width: '100%',
  },
  chartValue: {
    color: '#0E2143',
    fontSize: 11,
    fontWeight: '900',
  },
  chatAvatar: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 21,
    height: 42,
    justifyContent: 'center',
    position: 'relative',
    width: 42,
  },
  chatBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderColor: '#EAF0FA',
    borderRadius: 18,
    borderTopLeftRadius: 4,
    borderWidth: 1,
    maxWidth: '84%',
    paddingHorizontal: 15,
    paddingVertical: 11,
    ...shadowSoft,
  },
  chatBubbleNotice: {
    alignSelf: 'center',
    backgroundColor: '#FFF7ED',
    borderColor: '#FED7AA',
  },
  chatBubbleText: {
    color: '#0E2143',
    fontSize: 14,
    lineHeight: 20,
  },
  chatBubbleTextNotice: {
    color: '#C9810A',
    fontSize: 12.5,
  },
  chatBubbleTextUser: {
    color: '#FFFFFF',
  },
  chatBubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
    borderRadius: 18,
    borderTopRightRadius: 4,
  },
  chatCardPanel: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderColor: '#EAF0FA',
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
    maxWidth: '92%',
    padding: 12,
  },
  chatCardTitle: {
    color: '#0E2143',
    fontSize: 13,
    fontWeight: '900',
  },
  chatCards: {
    gap: 8,
    marginTop: 8,
  },
  chatComposer: {
    alignItems: 'flex-end',
    backgroundColor: '#FFFFFF',
    borderTopColor: '#EAF0FA',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  chatDateChip: {
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderRadius: 9,
    color: '#9AA8C2',
    fontSize: 11.5,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  chatHeader: {
    alignItems: 'center',
    backgroundColor: '#0E2143',
    flexDirection: 'row',
    gap: 12,
    paddingBottom: 14,
    paddingHorizontal: 18,
    paddingTop: 48,
  },
  chatHeaderSub: {
    color: '#8FA6CE',
    fontSize: 12,
  },
  chatHeaderText: {
    flex: 1,
  },
  chatHeaderTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
  },
  chatInput: {
    backgroundColor: '#F3F6FB',
    borderRadius: 16,
    color: '#0E2143',
    flex: 1,
    fontSize: 14,
    maxHeight: 82,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  chatMessageBlock: {
    gap: 2,
  },
  chatMessages: {
    gap: 11,
    padding: 16,
  },
  chatProductCard: {
    backgroundColor: '#F6FAFF',
    borderRadius: 12,
    gap: 4,
    padding: 10,
  },
  chatProductDesc: {
    color: '#5A6B86',
    fontSize: 12,
    lineHeight: 17,
  },
  chatProductPrice: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '900',
  },
  chatProductTitle: {
    color: '#0E2143',
    fontSize: 13.5,
    fontWeight: '900',
  },
  chatRoot: {
    backgroundColor: '#EEF4FC',
    flex: 1,
  },
  chatSendButton: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 14,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  checkbox: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#CBD8EC',
    borderRadius: 6,
    borderWidth: 1.5,
    flexBasis: 19,
    height: 19,
    justifyContent: 'center',
    marginRight: 9,
    width: 19,
  },
  checkboxMark: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 13,
  },
  checkboxOn: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  commissionAmount: {
    color: '#C9810A',
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'right',
  },
  commissionAmountSuccess: {
    color: '#0F9D70',
  },
  commissionAvatar: {
    backgroundColor: '#BFDBFE',
    borderRadius: 19,
    height: 38,
    width: 38,
  },
  commissionAvatarSuccess: {
    backgroundColor: '#60A5FA',
  },
  commissionItem: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.74)',
    borderColor: 'rgba(255,255,255,0.9)',
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    ...shadowSoft,
  },
  commissionMain: {
    flex: 1,
    minWidth: 0,
  },
  commissionMeta: {
    color: '#7B89A4',
    fontSize: 12,
    marginTop: 2,
  },
  commissionRight: {
    alignItems: 'flex-end',
  },
  commissionStatus: {
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderRadius: 7,
    color: '#C9810A',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 3,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  commissionStatusSuccess: {
    backgroundColor: 'rgba(16,185,129,0.13)',
    color: '#0F9D70',
  },
  commissionTitle: {
    color: '#0E2143',
    fontSize: 14,
    fontWeight: '800',
  },
  compactBlueButton: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  compactBlueButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  compactGhostButton: {
    alignItems: 'center',
    backgroundColor: '#EEF5FF',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  compactGhostButtonText: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '900',
  },
  connectionPill: {
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderColor: 'rgba(255,255,255,0.9)',
    borderRadius: 999,
    borderWidth: 1,
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  connectionPillCompact: {
    alignSelf: 'center',
    maxWidth: '100%',
    textAlign: 'center',
  },
  container: {
    gap: 26,
    marginHorizontal: 'auto' as never,
    maxWidth: 1280,
    paddingBottom: 80,
    paddingHorizontal: 24,
    paddingTop: 40,
    width: '100%',
  },
  containerCompact: {
    gap: 18,
    paddingHorizontal: 16,
    paddingTop: 34,
  },
  customerCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#EEF2F8',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 13,
    padding: 14,
  },
  customerMain: {
    flex: 1,
    minWidth: 0,
  },
  customerName: {
    color: '#0E2143',
    fontSize: 15,
    fontWeight: '900',
  },
  customerPhone: {
    color: '#8595B0',
    fontSize: 12.5,
    marginTop: 2,
  },
  dashboardCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#ECF0F7',
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    minWidth: 150,
    padding: 18,
  },
  dashboardCardLabel: {
    color: '#8595B0',
    fontSize: 13,
  },
  dashboardCardMeta: {
    color: '#8595B0',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
  },
  dashboardCardValue: {
    color: '#0E2143',
    fontSize: 27,
    fontWeight: '900',
    marginTop: 6,
  },
  dashboardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  dashboardPanel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#ECF0F7',
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    gap: 14,
    minWidth: 260,
    padding: 20,
  },
  dashboardPanelFull: {
    backgroundColor: '#FFFFFF',
    borderColor: '#ECF0F7',
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    padding: 20,
  },
  dashboardPanelWide: {
    backgroundColor: '#FFFFFF',
    borderColor: '#ECF0F7',
    borderRadius: 16,
    borderWidth: 1,
    flex: 1.65,
    minWidth: 360,
    padding: 20,
  },
  detailCloseButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E4ECF8',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  detailCloseButtonText: {
    color: '#5A6B86',
    fontSize: 14,
    fontWeight: '900',
  },
  detailDangerButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#F2D4D4',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  detailDangerButtonText: {
    color: '#DC2626',
    fontSize: 14,
    fontWeight: '900',
  },
  detailFooter: {
    backgroundColor: '#FFFFFF',
    borderTopColor: '#F0F3F9',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 14,
  },
  detailHeader: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomColor: '#F0F3F9',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 16,
  },
  detailOrderId: {
    color: '#0E2143',
    fontSize: 17,
    fontWeight: '900',
  },
  detailPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  detailPrimaryButton: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 12,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 12,
  },
  detailPrimaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  detailRoot: {
    backgroundColor: '#F5F8FC',
    flex: 1,
    minHeight: 0,
  },
  detailRootMobile: {
    borderRadius: 0,
  },
  detailScrollContent: {
    gap: 12,
    padding: 14,
  },
  detailTitleGroup: {
    flex: 1,
    gap: 6,
  },
  deviceButton: {
    borderRadius: 9,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  deviceButtonActive: {
    backgroundColor: '#2563EB',
  },
  deviceButtonText: {
    color: '#5A6B86',
    fontSize: 13,
    fontWeight: '900',
  },
  deviceButtonTextActive: {
    color: '#FFFFFF',
  },
  deviceToggle: {
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderColor: 'rgba(255,255,255,0.85)',
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    padding: 5,
  },
  deviceToggleCompact: {
    alignSelf: 'center',
  },
  directOrderCard: {
    backgroundColor: 'rgba(255,255,255,0.78)',
    borderColor: 'rgba(255,255,255,0.95)',
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    marginTop: 8,
    padding: 14,
  },
  disabled: {
    opacity: 0.52,
  },
  earningBreakdown: {
    gap: 10,
  },
  earningsAmount: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '900',
    lineHeight: 38,
  },
  earningsAmountRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  earningsChip: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 8,
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 4,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  earningsGlow: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 80,
    height: 160,
    position: 'absolute',
    right: -30,
    top: -40,
    width: 160,
  },
  earningsHero: {
    borderRadius: 24,
    overflow: 'hidden',
    padding: 22,
    shadowColor: '#2563EB',
    shadowOffset: { height: 20, width: 0 },
    shadowOpacity: 0.32,
    shadowRadius: 40,
  },
  earningsLabel: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13.5,
  },
  earningsSub: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 12.5,
    marginTop: 12,
  },
  emptyDetail: {
    color: '#7B89A4',
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: 'center',
  },
  emptyMark: {
    backgroundColor: '#DCEAFF',
    borderRadius: 20,
    height: 40,
    width: 40,
  },
  emptyState: {
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
    padding: 24,
  },
  emptyTitle: {
    color: '#0E2143',
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
  },
  errorBanner: {
    alignSelf: 'stretch',
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderRadius: 12,
    borderWidth: 1,
    color: '#B91C1C',
    maxWidth: 860,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 10,
    textAlign: 'center',
  },
  filterChip: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E4ECF8',
    borderRadius: 11,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    marginRight: 9,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  filterChipActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  filterChipText: {
    color: '#5A6B86',
    fontSize: 13,
    fontWeight: '900',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  filterCount: {
    backgroundColor: '#EEF3FB',
    borderRadius: 7,
    color: '#7B89A4',
    fontSize: 11.5,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  filterCountActive: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    color: '#FFFFFF',
  },
  filterScroll: {
    marginBottom: 14,
  },
  formField: {
    flex: 1,
    gap: 7,
    minWidth: 180,
  },
  formLabel: {
    color: '#42506B',
    fontSize: 12,
    fontWeight: '900',
  },
  subFilterChip: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#DCE7F5',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    height: 40,
    marginRight: 9,
    paddingHorizontal: 13,
  },
  subFilterChipActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  subFilterChipText: {
    color: '#5A6B86',
    fontSize: 13,
    fontWeight: '900',
  },
  subFilterChipTextActive: {
    color: '#FFFFFF',
  },
  headerSearchGhost: {
    alignItems: 'center',
    backgroundColor: '#F3F6FB',
    borderRadius: 11,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    width: 210,
  },
  headerSearchText: {
    color: '#8595B0',
    fontSize: 13,
  },
  infoLine: {
    borderBottomColor: '#F4F7FB',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'space-between',
    paddingVertical: 7,
  },
  infoLineLabel: {
    color: '#8595B0',
    flexShrink: 0,
    fontSize: 13,
  },
  infoLineValue: {
    color: '#0E2143',
    flex: 1,
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'right',
  },
  inlineInput: {
    flex: 1,
    minWidth: 0,
  },
  inlineInputs: {
    flexDirection: 'row',
    gap: 10,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  linkCard: {
    backgroundColor: 'rgba(255,255,255,0.78)',
    borderColor: 'rgba(255,255,255,0.95)',
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  linkLabel: {
    color: '#8595B0',
    fontSize: 12,
    fontWeight: '800',
  },
  linkValue: {
    color: '#0E2143',
    fontSize: 13,
    fontWeight: '800',
  },
  logo: {
    height: 26,
    width: 132,
  },
  logoPlate: {
    alignItems: 'center',
    backgroundColor: '#0E2143',
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: 20,
    shadowColor: '#0E2143',
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 26,
  },
  meshOne: {
    backgroundColor: 'rgba(96,165,250,0.24)',
    borderRadius: 310,
    height: 620,
    left: -120,
    position: 'absolute',
    top: -180,
    width: 620,
  },
  meshTwo: {
    backgroundColor: 'rgba(166,200,255,0.36)',
    borderRadius: 340,
    bottom: -220,
    height: 680,
    position: 'absolute',
    right: -140,
    width: 680,
  },
  miniAmount: {
    color: '#0E2143',
    flexBasis: 92,
    fontSize: 13,
    fontWeight: '900',
  },
  miniCustomer: {
    color: '#0E2143',
    flex: 1,
    fontSize: 13,
  },
  miniOrderId: {
    color: '#0E2143',
    flexBasis: 92,
    fontSize: 13,
    fontWeight: '900',
  },
  miniProduct: {
    color: '#5A6B86',
    flex: 1.2,
    fontSize: 13,
  },
  miniStat: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderColor: 'rgba(255,255,255,0.9)',
    borderRadius: 16,
    borderWidth: 1,
    flexBasis: '22%',
    flexGrow: 1,
    minWidth: 72,
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  miniStatActive: {
    backgroundColor: '#FFFFFF',
  },
  miniStatGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  miniStatLabel: {
    color: '#7B89A4',
    fontSize: 10.5,
    marginTop: 2,
    textAlign: 'center',
  },
  miniStatValue: {
    color: '#0E2143',
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
  },
  miniStatValueActive: {
    color: '#2563EB',
  },
  miniTableRow: {
    alignItems: 'center',
    borderBottomColor: '#F6F8FC',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 12,
  },
  mobileDashboardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  mobileGreeting: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
    marginTop: 8,
  },
  mobileInput: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E4ECF8',
    borderRadius: 12,
    borderWidth: 1,
    color: '#0E2143',
    fontSize: 14,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  mobileList: {
    gap: 9,
  },
  mobileMuted: {
    color: '#7B89A4',
    fontSize: 13,
    lineHeight: 18,
  },
  mobileOrderCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#EEF2F8',
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  mobileOrderTitle: {
    color: '#0E2143',
    fontSize: 15,
    fontWeight: '900',
  },
  mobileOrderTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  mobileSheet: {
    backgroundColor: '#F5F8FC',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 50,
  },
  mobileTitle: {
    color: '#0E2143',
    fontSize: 21,
    fontWeight: '900',
  },
  moduleTab: {
    alignItems: 'center',
    borderRadius: 13,
    justifyContent: 'center',
    minHeight: 46,
    minWidth: 106,
    paddingHorizontal: 18,
  },
  moduleTabActive: {
    backgroundColor: '#2563EB',
    shadowColor: '#2563EB',
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.26,
    shadowRadius: 22,
  },
  moduleTabText: {
    color: '#5A6B86',
    fontSize: 14,
    fontWeight: '900',
  },
  moduleTabTextActive: {
    color: '#FFFFFF',
  },
  moduleTabs: {
    backgroundColor: 'rgba(255,255,255,0.58)',
    borderColor: 'rgba(255,255,255,0.85)',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 6,
    ...shadowSoft,
  },
  mutedAction: {
    color: '#9AA8C2',
  },
  noteInput: {
    minHeight: 78,
    textAlignVertical: 'top',
  },
  noticeBanner: {
    alignSelf: 'stretch',
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderRadius: 12,
    borderWidth: 1,
    color: '#2563EB',
    maxWidth: 860,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 10,
    textAlign: 'center',
  },
  notificationBox: {
    alignItems: 'center',
    backgroundColor: '#F3F6FB',
    borderRadius: 11,
    height: 38,
    justifyContent: 'center',
    position: 'relative',
    width: 38,
  },
  notificationDot: {
    backgroundColor: '#EF4444',
    borderColor: '#FFFFFF',
    borderRadius: 4,
    borderWidth: 1.5,
    height: 8,
    position: 'absolute',
    right: 9,
    top: 8,
    width: 8,
  },
  onlineDot: {
    backgroundColor: '#10B981',
    borderColor: '#15294e',
    borderRadius: 6,
    borderWidth: 2,
    bottom: 1,
    height: 12,
    position: 'absolute',
    right: 1,
    width: 12,
  },
  orderIdText: {
    color: '#0E2143',
    fontWeight: '900',
  },
  orderMiniPanel: {
    backgroundColor: '#F6FAFF',
    borderColor: '#D7E7FF',
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  orderMiniTitle: {
    color: '#0E2143',
    fontSize: 14,
    fontWeight: '900',
  },
  orderSidePanel: {
    backgroundColor: '#F5F8FC',
    borderLeftColor: '#ECF0F7',
    borderLeftWidth: 1,
    flexBasis: 330,
    minWidth: 300,
  },
  orderTable: {
    flex: 1,
  },
  orderTableContent: {
    minWidth: 760,
  },
  ordersToolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 14,
  },
  ordersView: {
    flex: 1,
    minHeight: 0,
    padding: 20,
  },
  ordersWorkspace: {
    backgroundColor: '#FFFFFF',
    borderColor: '#ECF0F7',
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    minHeight: 0,
    overflow: 'hidden',
  },
  panelAction: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '900',
  },
  panelSubtitle: {
    color: '#8595B0',
    fontSize: 13,
    marginTop: 2,
  },
  panelTitle: {
    color: '#0E2143',
    fontSize: 15,
    fontWeight: '900',
  },
  panelTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  paymentAmount: {
    color: '#2563EB',
    fontSize: 18,
    fontWeight: '900',
    marginTop: 2,
  },
  paymentCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#EEF2F8',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 14,
  },
  paymentLabel: {
    color: '#8595B0',
    fontSize: 12,
  },
  phoneBody: {
    flex: 1,
  },
  phoneBottomNav: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.86)',
    borderTopColor: 'rgba(255,255,255,0.95)',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingBottom: 20,
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  phoneNavButton: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
  },
  phoneNavText: {
    color: '#9AA8C2',
    fontSize: 10.5,
    fontWeight: '900',
  },
  phoneNavTextActive: {
    color: '#2563EB',
  },
  phoneNotch: {
    backgroundColor: '#0B1B36',
    borderRadius: 18,
    height: 31,
    left: '50%',
    marginLeft: -56,
    position: 'absolute',
    top: 15,
    width: 112,
    zIndex: 20,
  },
  phoneScreen: {
    backgroundColor: '#F6FAFF',
    borderRadius: 37,
    flex: 1,
    overflow: 'hidden',
  },
  phoneScreenFlat: {
    backgroundColor: '#EEF4FC',
  },
  phoneScrollContent: {
    gap: 14,
    paddingBottom: 104,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  phoneSectionAction: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '900',
  },
  phoneSectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  phoneSectionTitle: {
    color: '#0E2143',
    fontSize: 16,
    fontWeight: '900',
  },
  phoneShell: {
    backgroundColor: '#0B1B36',
    borderRadius: 48,
    padding: 13,
    position: 'relative',
    shadowColor: '#0D2656',
    shadowOffset: { height: 40, width: 0 },
    shadowOpacity: 0.42,
    shadowRadius: 90,
  },
  phoneShellCompact: {
    maxWidth: 280,
  },
  phoneShellDesktop: {
    maxWidth: 392,
  },
  phoneSignalGroup: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 4,
  },
  phoneStage: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  phoneStatusBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 6,
    paddingHorizontal: 26,
    paddingTop: 16,
  },
  phoneStatusText: {
    color: '#0E2143',
    fontSize: 13,
    fontWeight: '900',
  },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: 7,
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  pillText: {
    fontSize: 11.5,
    fontWeight: '900',
  },
  productPickChip: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E4ECF8',
    borderRadius: 10,
    borderWidth: 1,
    maxWidth: '48%',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  productPickChipActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  productPickText: {
    color: '#5A6B86',
    fontSize: 12,
    fontWeight: '800',
  },
  productPickTextActive: {
    color: '#FFFFFF',
  },
  productPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  progressFill: {
    backgroundColor: '#2563EB',
    borderRadius: 4,
    height: '100%',
  },
  progressTrack: {
    backgroundColor: '#F0F3F9',
    borderRadius: 4,
    height: 7,
  },
  qrBox: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    height: 170,
    justifyContent: 'center',
    padding: 16,
    width: 170,
  },
  qrCaption: {
    color: '#5A6B86',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 16,
    textAlign: 'center',
  },
  qrCard: {
    backgroundColor: 'rgba(255,255,255,0.78)',
    borderColor: 'rgba(255,255,255,0.95)',
    borderRadius: 24,
    borderWidth: 1,
    padding: 22,
    ...shadowSoft,
  },
  quickStatGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  refCodeCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(37,99,235,0.08)',
    borderColor: 'rgba(37,99,235,0.12)',
    borderRadius: 18,
    borderWidth: 1,
    gap: 6,
    padding: 18,
  },
  refCodeText: {
    color: '#2563EB',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 1,
  },
  referralInfoCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(37,99,235,0.05)',
    borderColor: 'rgba(37,99,235,0.12)',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 14,
  },
  referralInfoText: {
    color: '#0E2143',
    fontSize: 13,
    fontWeight: '900',
    marginTop: 2,
  },
  referrerMain: {
    flex: 1,
    minWidth: 0,
  },
  referrerMeta: {
    color: '#8595B0',
    fontSize: 12,
    marginTop: 2,
  },
  referrerName: {
    color: '#0E2143',
    fontSize: 14,
    fontWeight: '900',
  },
  referrerRow: {
    alignItems: 'center',
    borderBottomColor: '#F6F8FC',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
  },
  replayButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderColor: 'rgba(255,255,255,0.9)',
    borderRadius: 11,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 15,
    paddingVertical: 7,
  },
  replayButtonText: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '900',
  },
  convAvatar: {
    alignItems: 'center',
    backgroundColor: '#3B82F6',
    borderRadius: 21,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  convBubble: {
    borderRadius: 16,
    gap: 4,
    maxWidth: '78%',
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  convBubbleAgent: {
    alignSelf: 'flex-end',
    backgroundColor: '#2563EB',
    borderTopRightRadius: 4,
  },
  convBubbleText: {
    color: '#0E2143',
    fontSize: 13,
    lineHeight: 19,
  },
  convBubbleTextAgent: {
    color: '#FFFFFF',
  },
  convBubbleTime: {
    color: '#94A3B8',
    fontSize: 10.5,
  },
  convBubbleTimeAgent: {
    color: 'rgba(255,255,255,0.72)',
  },
  convBubbleUser: {
    alignSelf: 'flex-start',
    backgroundColor: '#EEF4FC',
    borderTopLeftRadius: 4,
  },
  convComposer: {
    alignItems: 'flex-end',
    backgroundColor: '#FFFFFF',
    borderTopColor: '#EEF2F8',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  convContext: {
    backgroundColor: '#FFFFFF',
    borderColor: '#ECF0F7',
    borderRadius: 16,
    borderWidth: 1,
    flexBasis: 230,
    gap: 12,
    minWidth: 220,
    padding: 14,
  },
  convInbox: {
    backgroundColor: '#FFFFFF',
    borderColor: '#ECF0F7',
    borderRadius: 16,
    borderWidth: 1,
    flexBasis: 285,
    gap: 10,
    minWidth: 260,
    padding: 14,
  },
  convInboxList: {
    gap: 8,
    paddingBottom: 8,
  },
  convInboxMain: {
    flex: 1,
    gap: 5,
    minWidth: 0,
  },
  convInboxRow: {
    alignItems: 'center',
    borderColor: '#EFF3FA',
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 11,
    padding: 11,
  },
  convInboxRowActive: {
    backgroundColor: '#EEF5FF',
    borderColor: '#BFD8FF',
  },
  convInboxTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  convInput: {
    backgroundColor: '#F3F6FB',
    borderRadius: 14,
    color: '#0E2143',
    flex: 1,
    fontSize: 13,
    maxHeight: 92,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  convMessages: {
    gap: 9,
    padding: 14,
  },
  convMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  convName: {
    color: '#0E2143',
    flex: 1,
    fontSize: 13.5,
    fontWeight: '900',
  },
  convThread: {
    backgroundColor: '#FFFFFF',
    borderColor: '#ECF0F7',
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    minHeight: 0,
    minWidth: 320,
    overflow: 'hidden',
  },
  convTime: {
    color: '#9AA8C2',
    fontSize: 11,
  },
  convWorkspace: {
    flex: 1,
    flexDirection: 'row',
    gap: 14,
    minHeight: 0,
    padding: 18,
  },
  infoPair: {
    gap: 4,
  },
  infoPairLabel: {
    color: '#8595B0',
    fontSize: 12,
    fontWeight: '700',
  },
  infoPairValue: {
    color: '#0E2143',
    fontSize: 13.5,
    fontWeight: '900',
  },
  inlineErrorText: {
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    color: '#B91C1C',
    fontSize: 12,
    fontWeight: '800',
    padding: 10,
  },
  inlineSuccessText: {
    backgroundColor: 'rgba(16,185,129,0.1)',
    borderRadius: 10,
    color: '#0F9D70',
    fontSize: 12,
    fontWeight: '900',
    padding: 10,
  },
  lineGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  lineStatusLabel: {
    color: '#5A6B86',
    fontSize: 13,
  },
  lineStatusMissing: {
    color: '#C9810A',
  },
  lineStatusOk: {
    color: '#0F9D70',
  },
  lineStatusRow: {
    alignItems: 'center',
    borderTopColor: '#F1F5F9',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  lineStatusValue: {
    fontSize: 13,
    fontWeight: '900',
  },
  lineTestInput: {
    flex: 1,
    minWidth: 220,
  },
  lineTestRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  linkedOrderCard: {
    borderColor: '#E4ECF8',
    borderRadius: 13,
    borderWidth: 1,
    gap: 6,
    padding: 13,
  },
  payCellAmount: {
    flexBasis: 76,
  },
  payCellCode: {
    flexBasis: 74,
  },
  payCellOrder: {
    flexBasis: 94,
  },
  payCellProvider: {
    flex: 1,
    minWidth: 86,
  },
  payCellStatus: {
    flexBasis: 110,
  },
  paymentActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  paymentDetailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  paymentDetailPane: {
    backgroundColor: '#FFFFFF',
    borderColor: '#ECF0F7',
    borderRadius: 16,
    borderWidth: 1,
    flex: 0.84,
    gap: 16,
    minWidth: 300,
    padding: 18,
  },
  paymentHeaderRow: {
    alignItems: 'center',
    backgroundColor: '#FAFBFE',
    borderBottomColor: '#F0F3F9',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 15,
    paddingVertical: 13,
  },
  paymentLeftPane: {
    flex: 1,
    minHeight: 0,
    minWidth: 430,
  },
  paymentRow: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomColor: '#F2F5FA',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 62,
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  paymentRowActive: {
    backgroundColor: '#EEF5FF',
  },
  paymentTableContent: {
    backgroundColor: '#FFFFFF',
    borderColor: '#ECF0F7',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  paymentWorkspace: {
    flex: 1,
    flexDirection: 'row',
    gap: 16,
    minHeight: 0,
    padding: 18,
  },
  rightText: {
    alignItems: 'flex-end',
  },
  rowActions: {
    alignItems: 'flex-end',
  },
  rowPrimaryButton: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 9,
    justifyContent: 'center',
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  rowPrimaryButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  rowPrimaryMuted: {
    backgroundColor: '#94A3B8',
  },
  secondarySmallButton: {
    alignItems: 'center',
    backgroundColor: '#EEF5FF',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  secondarySmallButtonText: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '900',
  },
  screen: {
    flex: 1,
    overflow: 'hidden',
  },
  searchBox: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E4ECF8',
    borderRadius: 11,
    borderWidth: 1,
    flexDirection: 'row',
    flexGrow: 1,
    gap: 8,
    maxWidth: 360,
    minHeight: 42,
    paddingHorizontal: 12,
  },
  searchInput: {
    color: '#0E2143',
    flex: 1,
    fontSize: 13.5,
    outlineStyle: 'none' as never,
    paddingVertical: 8,
  },
  shareIntro: {
    gap: 4,
    marginBottom: 2,
    marginTop: 8,
  },
  sidebarButton: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 13,
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  sidebarButtonActive: {
    backgroundColor: '#EAF1FE',
    borderLeftColor: '#2563EB',
    borderLeftWidth: 3,
  },
  sidebarButtonText: {
    color: '#42506B',
    fontSize: 14,
    fontWeight: '900',
  },
  sidebarButtonTextActive: {
    color: '#2563EB',
  },
  sidebarLogo: {
    height: 24,
    marginBottom: 20,
    width: 124,
  },
  sidebarSection: {
    color: '#9AA8C2',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 3,
    paddingHorizontal: 10,
  },
  sidebarUser: {
    alignItems: 'center',
    backgroundColor: '#F7FAFF',
    borderColor: '#E4ECF8',
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 11,
    marginTop: 'auto',
    padding: 12,
  },
  sidebarUserName: {
    color: '#0E2143',
    fontSize: 13,
    fontWeight: '900',
  },
  sidebarUserRole: {
    color: '#7B89A4',
    fontSize: 11.5,
  },
  sidebarUserText: {
    flex: 1,
    minWidth: 0,
  },
  signalBar: {
    backgroundColor: '#0E2143',
    borderRadius: 1,
    width: 4,
  },
  signalBattery: {
    borderColor: '#0E2143',
    borderRadius: 3,
    borderWidth: 1.4,
    height: 12,
    width: 22,
  },
  shortcutRow: {
    alignItems: 'center',
    borderColor: '#E9EEF6',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  shortcutText: {
    color: '#42506B',
    fontSize: 13,
    fontWeight: '900',
  },
  signedUrl: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    color: '#2563EB',
    fontSize: 11,
    padding: 10,
  },
  slipPreviewBox: {
    alignItems: 'center',
    backgroundColor: '#F4F8FE',
    borderColor: '#DDE8F7',
    borderRadius: 14,
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: 6,
    minHeight: 120,
    justifyContent: 'center',
    padding: 18,
  },
  slipPreviewTitle: {
    color: '#0E2143',
    fontSize: 14,
    fontWeight: '900',
  },
  sortChip: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E4ECF8',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sortChipActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  sortChipText: {
    color: '#5A6B86',
    fontSize: 12,
    fontWeight: '800',
  },
  sortChipTextActive: {
    color: '#FFFFFF',
  },
  sortGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  stage: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 820,
    width: '100%',
  },
  stageCompact: {
    alignSelf: 'stretch',
    maxWidth: '100%',
    minHeight: 680,
    overflow: 'hidden',
  },
  stageAdminDesktop: {
    minHeight: 760,
  },
  stageCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#EEF2F8',
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    padding: 15,
  },
  stageCardTitle: {
    color: '#0E2143',
    fontSize: 14.5,
    fontWeight: '900',
  },
  stageNote: {
    backgroundColor: '#F4F8FE',
    borderRadius: 10,
    color: '#42506B',
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 4,
    padding: 10,
  },
  statusProgressLabel: {
    color: '#5A6B86',
    fontSize: 13,
  },
  statusProgressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  statusProgressRow: {
    gap: 0,
  },
  statusProgressValue: {
    color: '#0E2143',
    fontSize: 13,
    fontWeight: '900',
  },
  tableCell: {
    color: '#42506B',
    fontSize: 13,
  },
  tableHeadText: {
    color: '#8595B0',
    fontSize: 12,
    fontWeight: '800',
  },
  tableHeader: {
    alignItems: 'center',
    backgroundColor: '#FAFBFE',
    borderBottomColor: '#F0F3F9',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  tableRow: {
    alignItems: 'center',
    borderBottomColor: '#F2F5FA',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 58,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  tableRowSelected: {
    backgroundColor: '#F2F7FF',
  },
  timeline: {
    paddingHorizontal: 4,
  },
  timelineCheck: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 12,
  },
  timelineDot: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#D7E0EE',
    borderRadius: 9,
    borderWidth: 2,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  timelineDotColumn: {
    alignItems: 'center',
  },
  timelineDotCurrent: {
    borderColor: '#2563EB',
    shadowColor: '#2563EB',
    shadowOffset: { height: 0, width: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
  },
  timelineDotDone: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  timelineLabel: {
    color: '#5A6B86',
    fontSize: 13,
    fontWeight: '900',
    marginHorizontal: 2,
  },
  timelineLine: {
    backgroundColor: '#E4ECF8',
    flex: 1,
    minHeight: 14,
    width: 2,
  },
  timelineLineDone: {
    backgroundColor: '#10B981',
  },
  timelineRow: {
    flexDirection: 'row',
    gap: 12,
  },
  timelineText: {
    color: '#42506B',
    fontSize: 13.5,
    paddingBottom: 12,
    paddingTop: 1,
  },
  timelineTextMuted: {
    color: '#9DB1D6',
  },
  timelineTextSelected: {
    color: '#2563EB',
    fontWeight: '900',
  },
  threadHeaderClean: {
    alignItems: 'center',
    borderBottomColor: '#EEF2F8',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  threadModeButton: {
    backgroundColor: '#2563EB',
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  threadModeButtonMuted: {
    backgroundColor: '#5A6B86',
  },
  threadModeButtonText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '900',
  },
  threadSubtitle: {
    color: '#8595B0',
    fontSize: 12,
    marginTop: 3,
  },
  threadTitle: {
    color: '#0E2143',
    fontSize: 16,
    fontWeight: '900',
  },
  topChrome: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 20,
    justifyContent: 'space-between',
  },
  topChromeCompact: {
    alignItems: 'flex-start',
    flexDirection: 'column',
  },
  transcriptBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#F2F6FC',
    borderRadius: 14,
    borderTopLeftRadius: 4,
    maxWidth: '86%',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  transcriptBubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: '#2563EB',
    borderRadius: 14,
    borderTopRightRadius: 4,
  },
  transcriptCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#EEF2F8',
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  transcriptText: {
    color: '#0E2143',
    fontSize: 13,
    lineHeight: 18,
  },
  transcriptTextUser: {
    color: '#FFFFFF',
  },
  unreadDot: {
    backgroundColor: '#EF4444',
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  webhookBox: {
    alignItems: 'center',
    backgroundColor: '#F7FAFF',
    borderColor: '#E4ECF8',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  webhookText: {
    color: '#0E2143',
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
  },
  typingBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderTopLeftRadius: 4,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  typingDot: {
    backgroundColor: '#9AA8C2',
    borderRadius: 3,
    height: 6,
    width: 6,
  },
});
