import { Link, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import type { ComponentProps, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { PdpaActions } from '@/components/admin/PdpaActions';
import { MiraDesign, softShadow } from '@/constants/Design';
import { invokeFunction } from '@/lib/api/client';
import { useAuthSession } from '@/lib/auth/useAuthSession';
import { defaultTenantSlug } from '@/lib/marketplace/hospitalProducts';
import { showcaseDemoAdminOrders, showcaseDemoTenant, showcaseDemoTranscript } from '@/lib/showcase/demoFixtures';
import { supabase, supabaseConfigStatus } from '@/lib/supabase';
import type { AdminOrderActionRequest, AdminSlipUrlResponse, ChatMessageRow, OrderRow, OrderStatus, TenantSummary } from '@/lib/types/api';

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

type ReferrerJoin = {
  name: string;
  ref_code: string;
};

type BranchJoin = {
  address: string | null;
  district: string | null;
  name: string;
};

type OrderQueueRow = OrderRow & {
  branches?: BranchJoin | BranchJoin[] | null;
  customers?: CustomerJoin | CustomerJoin[] | null;
  products?: ProductJoin | ProductJoin[] | null;
  referrers?: ReferrerJoin | ReferrerJoin[] | null;
};

type TenantContext = TenantSummary & {
  role: string;
};

type TranscriptRow = Pick<ChatMessageRow, 'content' | 'created_at' | 'id' | 'role'>;
type OrderMutationAction = Extract<AdminOrderActionRequest, { action: 'book' | 'cancel' | 'confirm' | 'done' }>['action'];
type QueueFilter = 'all' | 'attention' | 'booking' | 'done' | 'in_progress' | 'paid' | 'review';
type SortKey = 'attention' | 'latest' | 'payment';
type DetailTab = 'summary' | 'timeline' | 'conversation' | 'notes';
type SymbolName = ComponentProps<typeof SymbolView>['name'];
type BadgeTone = 'amber' | 'blue' | 'danger' | 'muted' | 'success';

const activeStatuses: OrderStatus[] = ['selecting_branch', 'collecting_info', 'awaiting_payment', 'submitted', 'confirmed', 'booked'];
const attentionStatuses: OrderStatus[] = ['awaiting_payment', 'selecting_branch', 'collecting_info', 'submitted', 'confirmed'];
const notePresets = ['โทรแล้ว-ไม่รับ', 'โทรแล้ว-เลื่อน'] as const;
const actionLabels: Record<OrderMutationAction, string> = {
  book: 'บันทึกนัดหมาย',
  cancel: 'ยกเลิก',
  confirm: 'ยืนยันชำระเงิน',
  done: 'ปิดงาน',
};

const queueFilterOptions: Array<{ key: QueueFilter; label: string }> = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'attention', label: 'ต้องดำเนินการ' },
  { key: 'in_progress', label: 'กำลังดำเนินการ' },
  { key: 'review', label: 'รอตรวจ' },
  { key: 'done', label: 'เสร็จสิ้น' },
];

const sortOptions: Array<{ key: SortKey; label: string }> = [
  { key: 'latest', label: 'ล่าสุด' },
  { key: 'attention', label: 'ต้องดำเนินการก่อน' },
  { key: 'payment', label: 'อัปเดตชำระเงินล่าสุด' },
];

const calendarWeekdays = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] as const;
const bookingHourOptions = Array.from({ length: 11 }, (_, index) => String(index + 8).padStart(2, '0'));
const bookingMinuteOptions = ['00', '10', '20', '30', '40', '50'] as const;
const defaultBookingHour = bookingHourOptions[0] ?? '08';
const defaultBookingMinute = bookingMinuteOptions[0] ?? '00';

function fromJoin<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function formatMoney(amount: number) {
  return `${amount.toLocaleString('th-TH')} THB`;
}

function formatDateTime(value: string | null) {
  if (!value) {
    return '-';
  }

  return new Date(value).toLocaleString('th-TH', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatShortTime(value: Date | null) {
  if (!value) {
    return 'ยังไม่ได้รีเฟรช';
  }

  return value.toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function bangkokDateTimeParts(value: string | null) {
  if (!value) {
    return {
      date: '',
      time: '',
    };
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return {
      date: '',
      time: '',
    };
  }

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

  return {
    date: `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`,
    time: `${byType.get('hour')}:${byType.get('minute')}`,
  };
}

function bangkokTodayDate() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
  }).formatToParts(new Date());
  const byType = new Map(parts.map((part) => [part.type, part.value]));

  return new Date(Number(byType.get('year')), Number(byType.get('month')) - 1, Number(byType.get('day')));
}

function formatDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDateValue(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);

  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null;
  }

  return date;
}

function fullDateLabel(value: string) {
  const date = parseDateValue(value);

  if (!date) {
    return value || 'ยังไม่ได้เลือกวันที่';
  }

  return new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    month: 'long',
    weekday: 'long',
    year: 'numeric',
  }).format(date);
}

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function monthValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthDateFromValue(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);

  if (!match) {
    return monthStart(bangkokTodayDate());
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, 1);
}

function calendarMonthForDate(value: string) {
  return monthValue(monthStart(parseDateValue(value) ?? bangkokTodayDate()));
}

function calendarMonthLabel(value: string) {
  return new Intl.DateTimeFormat('th-TH', {
    month: 'long',
    year: 'numeric',
  }).format(monthDateFromValue(value));
}

function calendarCells(month: string, selectedValue: string) {
  const visibleMonth = monthDateFromValue(month);
  const today = bangkokTodayDate();
  const selectedDate = parseDateValue(selectedValue);
  const firstCell = new Date(visibleMonth);
  firstCell.setDate(1 - visibleMonth.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstCell);
    date.setDate(firstCell.getDate() + index);
    const value = formatDateValue(date);
    const isSelected = selectedDate ? value === formatDateValue(selectedDate) : false;

    return {
      day: date.getDate(),
      isCurrentMonth: date.getMonth() === visibleMonth.getMonth(),
      isDisabled: date < today && !isSelected,
      isSelected,
      isToday: value === formatDateValue(today),
      value,
    };
  });
}

function parseTimeValue(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);

  if (!match) {
    return null;
  }

  const hourNumber = Number(match[1]);
  const minuteNumber = Number(match[2]);

  if (hourNumber > 23 || minuteNumber > 59) {
    return null;
  }

  return {
    hour: String(hourNumber).padStart(2, '0'),
    minute: String(minuteNumber).padStart(2, '0'),
  };
}

function mergeTimeOption(options: readonly string[], selected: string | undefined) {
  if (!selected || options.includes(selected)) {
    return [...options];
  }

  return [...options, selected].sort((first, second) => Number(first) - Number(second));
}

function composeTimeValue(hour: string, minute: string) {
  return `${hour}:${minute}`;
}

function composeBangkokIso(dateValue: string, timeValue: string) {
  const date = dateValue.trim();
  const time = timeValue.trim();
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(time);

  if (!dateMatch || !timeMatch) {
    return null;
  }

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (hour > 23 || minute > 59) {
    return null;
  }

  const normalizedTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const iso = `${date}T${normalizedTime}:00+07:00`;
  const parsed = new Date(iso);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return iso;
}

function statusTone(status: OrderStatus): BadgeTone {
  if (status === 'cancelled') {
    return 'danger';
  }

  if (status === 'submitted' || status === 'confirmed' || status === 'booked' || status === 'done') {
    return 'success';
  }

  if (status === 'awaiting_payment') {
    return 'blue';
  }

  return 'amber';
}

function statusLabel(status: OrderStatus) {
  if (status === 'selecting_branch') {
    return 'เลือกสาขา';
  }

  if (status === 'collecting_info') {
    return 'เก็บข้อมูล';
  }

  if (status === 'awaiting_payment') {
    return 'รอชำระ';
  }

  if (status === 'submitted') {
    return 'รอตรวจ';
  }

  if (status === 'confirmed') {
    return 'ยืนยันแล้ว';
  }

  if (status === 'booked') {
    return 'นัดแล้ว';
  }

  if (status === 'done') {
    return 'เสร็จสิ้น';
  }

  return 'ยกเลิก';
}

function channelLabel(channel: OrderRow['channel']) {
  if (channel === 'chat_line') {
    return 'LINE';
  }

  if (channel === 'chat_pwa') {
    return 'Web';
  }

  if (channel === 'referrer') {
    return 'Referral';
  }

  return 'App';
}

function formatPayment(order: Pick<OrderQueueRow, 'paid_at' | 'payment_provider' | 'status' | 'stripe_payment_status'>) {
  if (order.status === 'cancelled') {
    return 'ยกเลิก';
  }

  if (order.status === 'awaiting_payment') {
    return order.payment_provider ? `รอชำระผ่าน ${order.payment_provider}` : 'รอชำระเงิน';
  }

  if (order.status === 'submitted') {
    return order.payment_provider ? `ชำระแล้ว · ${order.payment_provider}` : 'ชำระแล้ว รอตรวจ';
  }

  if (isPaidOrder(order)) {
    return order.stripe_payment_status ? `${order.payment_provider}: ${order.stripe_payment_status}` : order.payment_provider ?? 'ชำระแล้ว';
  }

  return order.payment_provider ?? 'ยังไม่ระบุ';
}

function isPaidOrder(order: Pick<OrderQueueRow, 'paid_at' | 'payment_provider' | 'status' | 'stripe_payment_status'>) {
  return (
    Boolean(order.paid_at) ||
    order.status === 'submitted' ||
    order.status === 'confirmed' ||
    order.status === 'booked' ||
    order.status === 'done' ||
    order.stripe_payment_status === 'paid'
  );
}

function bookingStatusLabel(order: Pick<OrderQueueRow, 'booking_at' | 'status'>) {
  if (order.status === 'cancelled') {
    return 'ยกเลิก';
  }

  if (order.status === 'done') {
    return 'เสร็จสิ้น';
  }

  if (order.status === 'booked' || order.booking_at) {
    return 'นัดแล้ว';
  }

  if (order.status === 'confirmed') {
    return 'รอนัดหมาย';
  }

  return 'ยังไม่ถึงขั้นนัด';
}

function bookingTone(order: Pick<OrderQueueRow, 'booking_at' | 'status'>): BadgeTone {
  if (order.status === 'cancelled') {
    return 'danger';
  }

  if (order.status === 'done' || order.status === 'booked' || order.booking_at) {
    return 'success';
  }

  if (order.status === 'confirmed') {
    return 'amber';
  }

  return 'muted';
}

function formatPreferredDateRange(order: Pick<OrderQueueRow, 'preferred_date' | 'preferred_date_end'>) {
  const start = order.preferred_date;
  const end = order.preferred_date_end && order.preferred_date_end !== start ? order.preferred_date_end : null;

  return start ? (end ? `${start} - ${end}` : start) : '-';
}

function formatPreferredTimeWindow(order: Pick<OrderQueueRow, 'preferred_time_window'>) {
  return order.preferred_time_window?.trim() || '-';
}

function canAct(order: OrderQueueRow, action: OrderMutationAction) {
  if (action === 'confirm') {
    return order.status === 'submitted';
  }

  if (action === 'book') {
    return order.status === 'confirmed';
  }

  if (action === 'done') {
    return order.status === 'booked';
  }

  return order.status !== 'done' && order.status !== 'cancelled';
}

function compactOrderId(id: string) {
  return id.length > 12 ? id.slice(0, 8) : id;
}

function maskPhone(phone: string | null | undefined) {
  if (!phone) {
    return '-';
  }

  const digits = phone.replace(/\D/g, '');

  if (digits.length < 7) {
    return phone;
  }

  return `${digits.slice(0, 3)}xxx${digits.slice(-4)}`;
}

function orderBuyerName(order: OrderQueueRow) {
  const customer = fromJoin(order.customers);

  return order.buyer_name || customer?.nickname || 'ไม่ระบุชื่อผู้ซื้อ';
}

function orderBuyerPhone(order: OrderQueueRow) {
  const customer = fromJoin(order.customers);

  return order.buyer_phone || customer?.phone || null;
}

function orderProductName(order: OrderQueueRow) {
  return fromJoin(order.products)?.name ?? 'ไม่พบสินค้า';
}

function orderBranchName(order: OrderQueueRow) {
  const branch = fromJoin(order.branches);

  return branch?.name ?? order.preferred_branch ?? 'ไม่ระบุสาขา';
}

function nextActionForOrder(order: OrderQueueRow): { detail: string; label: string; tone: BadgeTone } {
  if (order.status === 'selecting_branch') {
    return { detail: 'ลูกค้ายังเลือกสาขาไม่ครบ', label: 'รอข้อมูลสาขา', tone: 'amber' };
  }

  if (order.status === 'collecting_info') {
    return { detail: 'รอชื่อ เบอร์ หรือช่วงเวลาที่สะดวก', label: 'รอข้อมูลผู้ซื้อ', tone: 'amber' };
  }

  if (order.status === 'awaiting_payment') {
    return { detail: 'ติดตามการโอน PromptPay หรือ payment provider', label: 'รอชำระเงิน', tone: 'blue' };
  }

  if (order.status === 'submitted') {
    return { detail: 'ตรวจสลิป/หลักฐานแล้วกดยืนยัน', label: 'ตรวจและยืนยัน', tone: 'amber' };
  }

  if (order.status === 'confirmed') {
    return { detail: 'เลือกวันเวลาแล้วบันทึกนัดหมาย', label: 'บันทึกนัดหมาย', tone: 'blue' };
  }

  if (order.status === 'booked') {
    return { detail: 'ติดตามเข้ารับบริการ แล้วปิดงาน', label: 'รอปิดงาน', tone: 'success' };
  }

  if (order.status === 'done') {
    return { detail: 'ปิดงานเรียบร้อย', label: 'เสร็จสิ้น', tone: 'success' };
  }

  return { detail: 'คำสั่งซื้อถูกยกเลิก', label: 'ยกเลิก', tone: 'danger' };
}

function primaryActionForOrder(order: OrderQueueRow): OrderMutationAction | null {
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

function statusMatchesFilter(order: OrderQueueRow, filter: QueueFilter) {
  if (filter === 'all') {
    return true;
  }

  if (filter === 'attention') {
    return attentionStatuses.includes(order.status);
  }

  if (filter === 'in_progress') {
    return activeStatuses.includes(order.status);
  }

  if (filter === 'review') {
    return order.status === 'submitted';
  }

  if (filter === 'paid') {
    return isPaidOrder(order);
  }

  if (filter === 'booking') {
    return order.status === 'confirmed' || order.status === 'booked' || Boolean(order.booking_at);
  }

  return order.status === 'done';
}

function attentionRank(order: OrderQueueRow) {
  const rank: Partial<Record<OrderStatus, number>> = {
    submitted: 0,
    confirmed: 1,
    awaiting_payment: 2,
    booked: 3,
    collecting_info: 4,
    selecting_branch: 5,
    done: 6,
    cancelled: 7,
  };

  return rank[order.status] ?? 99;
}

function orderTimeValue(value: string | null) {
  const time = value ? new Date(value).getTime() : 0;

  return Number.isNaN(time) ? 0 : time;
}

function sortOrders(orders: OrderQueueRow[], sortKey: SortKey) {
  return [...orders].sort((left, right) => {
    if (sortKey === 'attention') {
      return attentionRank(left) - attentionRank(right) || orderTimeValue(right.updated_at) - orderTimeValue(left.updated_at);
    }

    if (sortKey === 'payment') {
      return (
        orderTimeValue(right.paid_at ?? right.updated_at) -
        orderTimeValue(left.paid_at ?? left.updated_at) ||
        orderTimeValue(right.created_at) - orderTimeValue(left.created_at)
      );
    }

    return orderTimeValue(right.created_at) - orderTimeValue(left.created_at);
  });
}

function uniqueBranchNames(orders: OrderQueueRow[]) {
  return Array.from(new Set(orders.map(orderBranchName).filter((branch) => branch && branch !== 'ไม่ระบุสาขา'))).sort((left, right) =>
    left.localeCompare(right, 'th'),
  );
}

export function OrdersQueue({ title = 'คิวคำสั่งซื้อ' }: { title?: string }) {
  const auth = useAuthSession();
  const { tour } = useLocalSearchParams<{ tour?: string }>();
  const { width } = useWindowDimensions();
  const [tenant, setTenant] = useState<TenantContext | null>(null);
  const [orders, setOrders] = useState<OrderQueueRow[]>([]);
  const [signedSlipUrls, setSignedSlipUrls] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptRow[]>([]);
  const [bookingDate, setBookingDate] = useState('');
  const [bookingTime, setBookingTime] = useState('');
  const [note, setNote] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<QueueFilter>('all');
  const [showActiveOnly, setShowActiveOnly] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('attention');
  const [channelFilter, setChannelFilter] = useState<OrderRow['channel'] | 'all'>('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busyAction, setBusyAction] = useState<OrderMutationAction | null>(null);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [demoFallbackReason, setDemoFallbackReason] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>('summary');
  const isDesktop = width >= 1024;
  const isTourMode = tour === 'admin';
  const isBaseDemoMode = isTourMode || !auth.session || !supabaseConfigStatus.isConfigured;
  const isDemoMode = isBaseDemoMode || Boolean(demoFallbackReason);
  const selectedOrder = useMemo(() => orders.find((order) => order.id === selectedId) ?? null, [orders, selectedId]);

  const channels = useMemo(() => Array.from(new Set(orders.map((order) => order.channel))).sort(), [orders]);
  const branchOptions = useMemo(() => uniqueBranchNames(orders), [orders]);

  const filteredOrders = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = orders.filter((order) => {
      const product = fromJoin(order.products);
      const customer = fromJoin(order.customers);
      const referrer = fromJoin(order.referrers);
      const branch = fromJoin(order.branches);
      const haystack = [
        order.id,
        order.buyer_name,
        order.buyer_phone,
        order.buyer_age,
        order.channel,
        channelLabel(order.channel),
        order.status,
        statusLabel(order.status),
        order.preferred_date,
        order.preferred_date_end,
        order.preferred_time_window,
        product?.catalog_key,
        product?.name,
        customer?.nickname,
        customer?.phone,
        referrer?.name,
        referrer?.ref_code,
        branch?.name,
        branch?.address,
        branch?.district,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return (
        (!showActiveOnly || activeStatuses.includes(order.status)) &&
        statusMatchesFilter(order, statusFilter) &&
        (channelFilter === 'all' || order.channel === channelFilter) &&
        (branchFilter === 'all' || orderBranchName(order) === branchFilter) &&
        (!needle || haystack.includes(needle))
      );
    });

    return sortOrders(filtered, sortKey);
  }, [branchFilter, channelFilter, orders, query, showActiveOnly, sortKey, statusFilter]);

  const summary = useMemo(
    () => ({
      active: orders.filter((order) => activeStatuses.includes(order.status)).length,
      attention: orders.filter((order) => attentionStatuses.includes(order.status)).length,
      booking: orders.filter((order) => order.status === 'confirmed' || order.status === 'booked' || Boolean(order.booking_at)).length,
      done: orders.filter((order) => order.status === 'done').length,
      paid: orders.filter(isPaidOrder).length,
      review: orders.filter((order) => order.status === 'submitted').length,
      total: orders.length,
    }),
    [orders],
  );

  const activeFilterCount = useMemo(
    () => [channelFilter !== 'all', branchFilter !== 'all', !showActiveOnly].filter(Boolean).length,
    [branchFilter, channelFilter, showActiveOnly],
  );

  const loadTenantContext = useCallback(async () => {
    if (!auth.user) {
      return null;
    }

    const { data: tenantRow, error: tenantError } = await supabase
      .from('tenants')
      .select('id,slug,display_name,logo_url')
      .eq('slug', defaultTenantSlug)
      .maybeSingle();

    if (tenantError || !tenantRow) {
      throw new Error(tenantError?.message ?? `Tenant "${defaultTenantSlug}" is not available.`);
    }

    const { data: member, error: memberError } = await supabase
      .from('tenant_members')
      .select('role')
      .eq('tenant_id', tenantRow.id)
      .eq('auth_user_id', auth.user.id)
      .maybeSingle();

    if (memberError || !member) {
      throw new Error(memberError?.message ?? 'Your account is not a member of this tenant.');
    }

    return {
      ...(tenantRow as TenantSummary),
      role: String((member as { role: string }).role),
    };
  }, [auth.user]);

  const loadDemoOrders = useCallback((reason: string | null = null) => {
    setDemoFallbackReason(reason);
    setTenant({ ...showcaseDemoTenant, role: 'demo' });
    setOrders(showcaseDemoAdminOrders);
    setSignedSlipUrls({});
    setSelectedId((current) => (showcaseDemoAdminOrders.some((order) => order.id === current) ? current : showcaseDemoAdminOrders[0]?.id ?? null));
    setLastRefreshedAt(new Date());
  }, []);

  const refreshOrders = useCallback(
    async (tenantId = tenant?.id) => {
      if (isDemoMode) {
        loadDemoOrders(demoFallbackReason);
        setMessage('กำลังแสดงข้อมูลตัวอย่างอยู่');
        return;
      }

      if (!tenantId) {
        return;
      }

      const { data, error: loadError } = await supabase
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
            'branches(name,address,district)',
            'products(name,catalog_key,category,price_baht,image_url)',
            'customers(nickname,phone)',
            'referrers(name,ref_code)',
          ].join(','),
        )
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (loadError) {
        throw new Error(loadError.message);
      }

      const rows = (data ?? []) as unknown as OrderQueueRow[];
      const nextSignedUrls: Record<string, string> = {};

      await Promise.all(
        rows.map(async (order) => {
          if (!order.slip_url) {
            return;
          }

          try {
            const signed = await invokeFunction<Extract<AdminOrderActionRequest, { action: 'slip_url' }>, AdminSlipUrlResponse>(
              'admin-order-action',
              {
                action: 'slip_url',
                order_id: order.id,
              },
            );

            if (signed.signed_url) {
              nextSignedUrls[order.id] = signed.signed_url;
            }
          } catch {
            // Keep the queue usable even if one thumbnail cannot be signed.
          }
        }),
      );

      setSignedSlipUrls(nextSignedUrls);
      setOrders(rows);
      setLastRefreshedAt(new Date());
    },
    [demoFallbackReason, isDemoMode, loadDemoOrders, tenant?.id],
  );

  useEffect(() => {
    let isMounted = true;

    async function boot() {
      if (isBaseDemoMode) {
        loadDemoOrders(null);
        setIsLoading(false);
        return;
      }

      try {
        setError(null);
        const tenantContext = await loadTenantContext();

        if (!isMounted || !tenantContext) {
          return;
        }

        setTenant(tenantContext);
        setDemoFallbackReason(null);
        await refreshOrders(tenantContext.id);
      } catch (loadError) {
        if (isMounted) {
          const reason = loadError instanceof Error ? loadError.message : 'โหลดคิวออเดอร์จาก backend ไม่สำเร็จ';
          loadDemoOrders(reason);
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
  }, [auth.session, isBaseDemoMode, loadDemoOrders, loadTenantContext]);

  useEffect(() => {
    if (!tenant || isDemoMode) {
      return;
    }

    const channel = supabase
      .channel(`orders-queue-${tenant.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          filter: `tenant_id=eq.${tenant.id}`,
          schema: 'public',
          table: 'orders',
        },
        () => {
          void refreshOrders(tenant.id);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isDemoMode, refreshOrders, tenant]);

  useEffect(() => {
    if (orders.length === 0 && selectedId) {
      setSelectedId(null);
      return;
    }

    if (selectedId && !orders.some((order) => order.id === selectedId)) {
      setSelectedId(null);
    }
  }, [orders, selectedId]);

  useEffect(() => {
    if (isDemoMode) {
      setTranscript(showcaseDemoTranscript);
      return;
    }

    const selectedSessionId = selectedOrder?.session_id;

    if (!selectedSessionId) {
      setTranscript([]);
      return;
    }

    let isMounted = true;

    async function loadTranscript() {
      const { data, error: transcriptError } = await supabase
        .from('chat_messages')
        .select('id,role,content,created_at')
        .eq('session_id', selectedSessionId)
        .order('created_at', { ascending: true })
        .limit(80);

      if (isMounted) {
        setTranscript(transcriptError ? [] : ((data ?? []) as unknown as TranscriptRow[]));
      }
    }

    void loadTranscript();

    return () => {
      isMounted = false;
    };
  }, [isDemoMode, selectedOrder?.session_id]);

  useEffect(() => {
    setDetailTab('summary');

    if (!selectedOrder) {
      setBookingDate('');
      setBookingTime('');
      setNote('');
      return;
    }

    const nextBooking = bangkokDateTimeParts(selectedOrder.booking_at);
    setBookingDate(nextBooking.date);
    setBookingTime(nextBooking.time);
    setNote(selectedOrder.admin_note ?? '');
  }, [selectedOrder?.id]);

  async function handleRefreshOrders() {
    if (isRefreshing || isLoading) {
      return;
    }

    try {
      setIsRefreshing(true);
      setError(null);
      await refreshOrders();
      setMessage(isDemoMode ? 'กำลังแสดงข้อมูลตัวอย่างอยู่' : 'รีเฟรชคิวแล้ว');
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'รีเฟรชคิวไม่สำเร็จ');
    } finally {
      setIsRefreshing(false);
    }
  }

  async function runAction(action: OrderMutationAction) {
    if (!selectedOrder || busyAction || !canAct(selectedOrder, action)) {
      return;
    }

    if (isDemoMode) {
      setMessage('โหมดตัวอย่าง: ปุ่ม action จะไม่ส่งข้อมูลจริง');
      return;
    }

    const bookingAt = action === 'book' ? composeBangkokIso(bookingDate, bookingTime) : undefined;

    if (action === 'book' && !bookingAt) {
      setError('Booking date and time must be valid Bangkok time.');
      return;
    }

    try {
      setBusyAction(action);
      setError(null);
      setMessage(null);
      const result = await invokeFunction<AdminOrderActionRequest, { order: OrderRow }>('admin-order-action', {
        action,
        booking_at: bookingAt ?? undefined,
        note: note.trim() || undefined,
        order_id: selectedOrder.id,
      });
      setMessage(actionSuccessMessage(action, result.order));
      await refreshOrders(result.order.tenant_id);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Unable to update order.');
    } finally {
      setBusyAction(null);
    }
  }

  async function saveNote(nextNote = note) {
    if (!selectedOrder || isSavingNote) {
      return;
    }

    if (isDemoMode) {
      setMessage('โหมดตัวอย่าง: ปุ่ม action จะไม่ส่งข้อมูลจริง');
      return;
    }

    const trimmedNote = nextNote.trim();

    if (!trimmedNote) {
      setError('Internal note is required before saving.');
      return;
    }

    try {
      setIsSavingNote(true);
      setError(null);
      setMessage(null);
      const result = await invokeFunction<AdminOrderActionRequest, { order: OrderRow }>('admin-order-action', {
        action: 'note',
        note: trimmedNote,
        order_id: selectedOrder.id,
      });
      setMessage('บันทึกโน้ตภายในแล้ว');
      await refreshOrders(result.order.tenant_id);
    } catch (noteError) {
      setError(noteError instanceof Error ? noteError.message : 'บันทึกโน้ตไม่สำเร็จ');
    } finally {
      setIsSavingNote(false);
    }
  }

  const summaryItems: Array<{ key: QueueFilter; label: string; value: number }> = [
    { key: 'all', label: 'ทั้งหมด', value: summary.total },
    { key: 'attention', label: 'ต้องดูแล', value: summary.attention },
    { key: 'review', label: 'รอตรวจ', value: summary.review },
    { key: 'paid', label: 'ชำระแล้ว', value: summary.paid },
    { key: 'booking', label: 'รอนัด', value: summary.booking },
    { key: 'done', label: 'เสร็จสิ้น', value: summary.done },
  ];
  const hasActiveFilters =
    statusFilter !== 'all' || channelFilter !== 'all' || branchFilter !== 'all' || query.trim().length > 0 || !showActiveOnly;

  function clearAllFilters() {
    setStatusFilter('all');
    setChannelFilter('all');
    setBranchFilter('all');
    setQuery('');
    setShowActiveOnly(() => true);
  }

  function renderDetail(onClose?: () => void) {
    if (!selectedOrder) {
      return <EmptyDetail />;
    }

    return (
      <OrderDetailPanel
        activeTab={detailTab}
        bookingDate={bookingDate}
        bookingTime={bookingTime}
        busyAction={busyAction}
        canErase={!isDemoMode && (tenant?.role === 'tenant_admin' || tenant?.role === 'superadmin')}
        isDemoMode={isDemoMode}
        isSavingNote={isSavingNote}
        note={note}
        onAction={(action) => void runAction(action)}
        onBookingDateChange={setBookingDate}
        onBookingTimeChange={setBookingTime}
        onClose={onClose}
        onNoteChange={setNote}
        onSaveNote={(nextNote) => void saveNote(nextNote)}
        onTabChange={setDetailTab}
        order={selectedOrder}
        signedSlipUrl={signedSlipUrls[selectedOrder.id]}
        tenant={tenant}
        transcript={transcript}
      />
    );
  }

  const inboxList = (
    <OrdersInboxList
      error={error}
      hasActiveFilters={hasActiveFilters}
      isLoading={isLoading}
      onClearFilters={clearAllFilters}
      onRetry={() => void handleRefreshOrders()}
      onSelectOrder={(order) => setSelectedId(order.id)}
      orders={filteredOrders}
      selectedId={selectedId}
      totalCount={orders.length}
    />
  );

  const topBlock = (
    <>
      <OrdersHeader
        demoReason={demoFallbackReason}
        isDemoMode={isDemoMode}
        isLoading={isLoading || isRefreshing}
        lastRefreshedAt={lastRefreshedAt}
        onRefresh={() => void handleRefreshOrders()}
        title={title}
      />
      {error ? <Banner tone="error" text={error} /> : null}
      {message ? <Banner tone="success" text={message} /> : null}
      <OrdersStatusSummary activeFilter={statusFilter} items={summaryItems} onSelect={setStatusFilter} />
      <OrdersToolbar
        activeFilterCount={activeFilterCount}
        onOpenFilter={() => setFilterOpen(true)}
        query={query}
        resultCount={filteredOrders.length}
        setQuery={setQuery}
        setSortKey={setSortKey}
        sortKey={sortKey}
      />
    </>
  );

  return (
    <View style={styles.screen}>
      {isDesktop ? (
        <View style={[styles.container, styles.containerDesktop]}>
          {topBlock}
          <View style={styles.workbench}>
            <View style={styles.listPane}>
              <ScrollView contentContainerStyle={styles.listScrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {inboxList}
              </ScrollView>
            </View>
            <View style={styles.detailPane}>{renderDetail()}</View>
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.mobileScrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.container}>
            {topBlock}
            {inboxList}
          </View>
        </ScrollView>
      )}

      {!isDesktop && selectedOrder ? <View style={styles.mobileDetailOverlay}>{renderDetail(() => setSelectedId(null))}</View> : null}

      {filterOpen ? (
        <OrdersFilterPanel
          activeCount={activeFilterCount}
          branchFilter={branchFilter}
          branchOptions={branchOptions}
          channelFilter={channelFilter}
          channels={channels}
          isDesktop={isDesktop}
          onClear={() => {
            setChannelFilter('all');
            setBranchFilter('all');
            setShowActiveOnly(() => true);
          }}
          onClose={() => setFilterOpen(false)}
          setBranchFilter={setBranchFilter}
          setChannelFilter={setChannelFilter}
          setShowActiveOnly={setShowActiveOnly}
          showActiveOnly={showActiveOnly}
        />
      ) : null}
    </View>
  );
}

function OrdersHeader({
  demoReason,
  isDemoMode,
  isLoading,
  lastRefreshedAt,
  onRefresh,
  title,
}: {
  demoReason: string | null;
  isDemoMode: boolean;
  isLoading: boolean;
  lastRefreshedAt: Date | null;
  onRefresh: () => void;
  title: string;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <View style={styles.headerTitleGroup}>
          <Text style={styles.eyebrow}>หลังบ้าน / คำสั่งซื้อ</Text>
          <View style={styles.headerTitleRow}>
            <Text style={styles.title}>{title}</Text>
            <View style={[styles.modePill, isDemoMode ? styles.modePillDemo : styles.modePillLive]}>
              <Text style={[styles.modePillText, isDemoMode ? styles.modePillTextDemo : styles.modePillTextLive]}>
                {isDemoMode ? 'โหมดตัวอย่าง' : 'ใช้งานจริง'}
              </Text>
            </View>
            {lastRefreshedAt ? <Text style={styles.headerMetaText}>อัปเดต {formatShortTime(lastRefreshedAt)}</Text> : null}
          </View>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel="รีเฟรช"
            accessibilityRole="button"
            disabled={isLoading}
            onPress={onRefresh}
            style={[styles.iconButton, isLoading ? styles.disabled : null]}
          >
            <SymbolView name={{ android: 'refresh', ios: 'arrow.clockwise', web: 'refresh' }} size={17} tintColor={MiraDesign.color.primaryDeep} />
            <Text style={styles.iconButtonText}>{isLoading ? 'กำลังรีเฟรช' : 'รีเฟรช'}</Text>
          </Pressable>
          <Link href="/admin/catalog" asChild>
            <Pressable accessibilityLabel="เปิดแค็ตตาล็อก" accessibilityRole="link" style={styles.iconButton}>
              <SymbolView name={{ android: 'inventory_2', ios: 'cube', web: 'inventory_2' }} size={17} tintColor={MiraDesign.color.primaryDeep} />
              <Text style={styles.iconButtonText}>แค็ตตาล็อก</Text>
            </Pressable>
          </Link>
        </View>
      </View>
      {isDemoMode ? (
        <Text numberOfLines={1} style={styles.headerDemoNote}>
          {demoReason ? `โหมดตัวอย่าง: ${demoReason} · ปุ่ม action จะไม่ส่งข้อมูลจริง` : 'โหมดตัวอย่าง: ปุ่ม action จะไม่ส่งข้อมูลจริง'}
        </Text>
      ) : null}
    </View>
  );
}

function OrdersStatusSummary({
  activeFilter,
  items,
  onSelect,
}: {
  activeFilter: QueueFilter;
  items: Array<{ key: QueueFilter; label: string; value: number }>;
  onSelect: (filter: QueueFilter) => void;
}) {
  return (
    <View style={styles.summaryRow}>
      {items.map((item) => {
        const active = activeFilter === item.key;

        return (
          <Pressable
            accessibilityLabel={`กรองตาม ${item.label}`}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            key={item.key}
            onPress={() => onSelect(item.key)}
            style={[styles.summaryChip, active ? styles.summaryChipActive : null]}
          >
            <Text style={[styles.summaryChipValue, active ? styles.summaryChipValueActive : null]}>{item.value.toLocaleString('th-TH')}</Text>
            <Text style={[styles.summaryChipLabel, active ? styles.summaryChipLabelActive : null]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function OrdersToolbar({
  activeFilterCount,
  onOpenFilter,
  query,
  resultCount,
  setQuery,
  setSortKey,
  sortKey,
}: {
  activeFilterCount: number;
  onOpenFilter: () => void;
  query: string;
  resultCount: number;
  setQuery: (value: string) => void;
  setSortKey: (value: SortKey) => void;
  sortKey: SortKey;
}) {
  const sortLabel = sortOptions.find((option) => option.key === sortKey)?.label ?? 'ล่าสุด';
  const cycleSort = () => {
    const index = sortOptions.findIndex((option) => option.key === sortKey);
    const next = sortOptions[(index + 1) % sortOptions.length];

    if (next) {
      setSortKey(next.key);
    }
  };

  return (
    <View style={styles.toolbarRow}>
      <View style={styles.searchBox}>
        <SymbolView name={{ android: 'search', ios: 'magnifyingglass', web: 'search' }} size={17} tintColor={MiraDesign.color.inkSoft} />
        <TextInput
          accessibilityLabel="ค้นหาคิวคำสั่งซื้อ"
          onChangeText={setQuery}
          placeholder="ค้นหาเลขออเดอร์ ชื่อลูกค้า เบอร์โทร หรือแพ็กเกจ"
          placeholderTextColor={MiraDesign.color.inkSoft}
          style={styles.searchInput}
          value={query}
        />
        {query ? (
          <Pressable accessibilityLabel="ล้างการค้นหา" accessibilityRole="button" onPress={() => setQuery('')} style={styles.searchClear}>
            <SymbolView name={{ android: 'close', ios: 'xmark', web: 'close' }} size={14} tintColor={MiraDesign.color.inkSoft} />
          </Pressable>
        ) : null}
      </View>
      <Pressable
        accessibilityLabel="ตัวกรอง"
        accessibilityRole="button"
        onPress={onOpenFilter}
        style={[styles.toolbarButton, activeFilterCount > 0 ? styles.toolbarButtonActive : null]}
      >
        <SymbolView
          name={{ android: 'tune', ios: 'slider.horizontal.3', web: 'tune' }}
          size={16}
          tintColor={activeFilterCount > 0 ? MiraDesign.color.primaryDeep : MiraDesign.color.inkSoft}
        />
        <Text style={[styles.toolbarButtonText, activeFilterCount > 0 ? styles.toolbarButtonTextActive : null]}>
          {activeFilterCount > 0 ? `ตัวกรอง · ${activeFilterCount}` : 'ตัวกรอง'}
        </Text>
      </Pressable>
      <Pressable accessibilityLabel={`เรียงตาม ${sortLabel}`} accessibilityRole="button" onPress={cycleSort} style={styles.toolbarButton}>
        <SymbolView name={{ android: 'swap_vert', ios: 'arrow.up.arrow.down', web: 'swap_vert' }} size={16} tintColor={MiraDesign.color.inkSoft} />
        <Text style={styles.toolbarButtonText}>{sortLabel}</Text>
      </Pressable>
    </View>
  );
}

function OrdersFilterPanel({
  activeCount,
  branchFilter,
  branchOptions,
  channelFilter,
  channels,
  isDesktop,
  onClear,
  onClose,
  setBranchFilter,
  setChannelFilter,
  setShowActiveOnly,
  showActiveOnly,
}: {
  activeCount: number;
  branchFilter: string;
  branchOptions: string[];
  channelFilter: OrderRow['channel'] | 'all';
  channels: OrderRow['channel'][];
  isDesktop: boolean;
  onClear: () => void;
  onClose: () => void;
  setBranchFilter: (value: string) => void;
  setChannelFilter: (value: OrderRow['channel'] | 'all') => void;
  setShowActiveOnly: (updater: (current: boolean) => boolean) => void;
  showActiveOnly: boolean;
}) {
  return (
    <View style={styles.overlay}>
      <Pressable accessibilityLabel="ปิดตัวกรอง" accessibilityRole="button" onPress={onClose} style={styles.overlayBackdrop} />
      <View style={[styles.filterPanel, isDesktop ? styles.filterPanelDesktop : styles.filterPanelSheet]}>
        <View style={styles.filterHeader}>
          <Text style={styles.filterTitle}>{activeCount > 0 ? `ตัวกรอง · ${activeCount}` : 'ตัวกรอง'}</Text>
          <Pressable accessibilityLabel="ปิด" accessibilityRole="button" onPress={onClose} style={styles.filterClose}>
            <SymbolView name={{ android: 'close', ios: 'xmark', web: 'close' }} size={18} tintColor={MiraDesign.color.inkSoft} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.filterBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <FilterGroup label="ช่องทาง">
            <ChipButton active={channelFilter === 'all'} label="ทั้งหมด" onPress={() => setChannelFilter('all')} />
            {channels.map((channel) => (
              <ChipButton active={channelFilter === channel} key={channel} label={channelLabel(channel)} onPress={() => setChannelFilter(channel)} />
            ))}
          </FilterGroup>

          {branchOptions.length > 0 ? (
            <FilterGroup label="สาขา">
              <ChipButton active={branchFilter === 'all'} label="ทั้งหมด" onPress={() => setBranchFilter('all')} />
              {branchOptions.map((branch) => (
                <ChipButton active={branchFilter === branch} key={branch} label={branch} onPress={() => setBranchFilter(branch)} />
              ))}
            </FilterGroup>
          ) : null}

          <FilterGroup label="การแสดงผล">
            <ChipButton active={showActiveOnly} label="เฉพาะที่กำลังดำเนินการ" onPress={() => setShowActiveOnly(() => true)} />
            <ChipButton active={!showActiveOnly} label="ทุกสถานะ" onPress={() => setShowActiveOnly(() => false)} />
          </FilterGroup>
        </ScrollView>
        <View style={styles.filterFooter}>
          <Pressable accessibilityRole="button" onPress={onClear} style={styles.filterClearButton}>
            <Text style={styles.filterClearText}>ล้างค่า</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.filterApplyButton}>
            <Text style={styles.filterApplyText}>ใช้ตัวกรอง</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function OrdersInboxList({
  error,
  hasActiveFilters,
  isLoading,
  onClearFilters,
  onRetry,
  onSelectOrder,
  orders,
  selectedId,
  totalCount,
}: {
  error: string | null;
  hasActiveFilters: boolean;
  isLoading: boolean;
  onClearFilters: () => void;
  onRetry: () => void;
  onSelectOrder: (order: OrderQueueRow) => void;
  orders: OrderQueueRow[];
  selectedId: string | null;
  totalCount: number;
}) {
  if (isLoading) {
    return <OrdersSkeleton />;
  }

  if (error && totalCount === 0) {
    return <ErrorState onRetry={onRetry} text={error} />;
  }

  if (totalCount === 0) {
    return <QueueEmptyState />;
  }

  if (orders.length === 0) {
    return <NoResultsState hasFilters={hasActiveFilters} onClear={onClearFilters} />;
  }

  return (
    <View style={styles.inboxStack}>
      {orders.map((order) => (
        <OrderInboxCard key={order.id} order={order} selected={selectedId === order.id} onSelect={() => onSelectOrder(order)} />
      ))}
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

function OrderInboxCard({ onSelect, order, selected }: { onSelect: () => void; order: OrderQueueRow; selected: boolean }) {
  const nextAction = nextActionForOrder(order);
  const metaLine = [orderBuyerName(order), formatMoney(order.amount_baht), channelLabel(order.channel), formatDateTime(order.updated_at)]
    .filter(Boolean)
    .join(' · ');
  const statusLine = `${formatPayment(order)} · ${bookingStatusLabel(order)}`;

  return (
    <Pressable
      accessibilityLabel={`เปิดรายละเอียดคำสั่งซื้อ ${compactOrderId(order.id)}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onSelect}
      style={[styles.inboxCard, selected ? styles.inboxCardSelected : null]}
    >
      {selected ? <View style={styles.inboxCardAccent} /> : null}
      <View style={styles.inboxCardBody}>
        <View style={styles.inboxCardTop}>
          <Text numberOfLines={1} style={styles.inboxOrderId}>
            #{compactOrderId(order.id)}
          </Text>
          <StatusBadge label={statusLabel(order.status)} tone={statusTone(order.status)} />
        </View>
        <Text numberOfLines={1} style={styles.inboxProduct}>
          {orderProductName(order)}
        </Text>
        <Text numberOfLines={1} style={styles.inboxMeta}>
          {metaLine}
        </Text>
        <View style={styles.inboxBottom}>
          <Text numberOfLines={1} style={styles.inboxStatusLine}>
            {statusLine}
          </Text>
          <View style={styles.nextActionPill}>
            <Text numberOfLines={1} style={styles.nextActionPillText}>
              {nextAction.label}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const detailTabs: Array<{ key: DetailTab; label: string }> = [
  { key: 'summary', label: 'สรุป' },
  { key: 'timeline', label: 'ไทม์ไลน์' },
  { key: 'conversation', label: 'บทสนทนา' },
  { key: 'notes', label: 'โน้ต' },
];

function OrderDetailPanel({
  activeTab,
  bookingDate,
  bookingTime,
  busyAction,
  canErase,
  isDemoMode,
  isSavingNote,
  note,
  onAction,
  onBookingDateChange,
  onBookingTimeChange,
  onClose,
  onNoteChange,
  onSaveNote,
  onTabChange,
  order,
  signedSlipUrl,
  tenant,
  transcript,
}: {
  activeTab: DetailTab;
  bookingDate: string;
  bookingTime: string;
  busyAction: OrderMutationAction | null;
  canErase: boolean;
  isDemoMode: boolean;
  isSavingNote: boolean;
  note: string;
  onAction: (action: OrderMutationAction) => void;
  onBookingDateChange: (value: string) => void;
  onBookingTimeChange: (value: string) => void;
  onClose?: () => void;
  onNoteChange: (value: string) => void;
  onSaveNote: (nextNote?: string) => void;
  onTabChange: (tab: DetailTab) => void;
  order: OrderQueueRow;
  signedSlipUrl?: string;
  tenant: TenantContext | null;
  transcript: TranscriptRow[];
}) {
  const primaryAction = primaryActionForOrder(order);
  const primaryDisabled =
    isDemoMode || !primaryAction || !canAct(order, primaryAction) || (primaryAction === 'book' && (!bookingDate || !bookingTime));

  return (
    <View style={styles.detailPanel}>
      <View style={styles.detailHeader}>
        {onClose ? (
          <Pressable accessibilityLabel="กลับไปรายการ" accessibilityRole="button" onPress={onClose} style={styles.detailBack}>
            <SymbolView name={{ android: 'arrow_back', ios: 'chevron.left', web: 'arrow_back' }} size={18} tintColor={MiraDesign.color.ink} />
            <Text style={styles.detailBackText}>กลับ</Text>
          </Pressable>
        ) : null}
        <View style={styles.detailHeaderRow}>
          <View style={styles.detailHeaderMain}>
            <Text style={styles.detailEyebrow}>#{compactOrderId(order.id)}</Text>
            <Text numberOfLines={1} style={styles.detailTitle}>
              {orderProductName(order)}
            </Text>
            <Text numberOfLines={1} style={styles.detailSubtitle}>
              {orderBuyerName(order)} · {formatMoney(order.amount_baht)}
            </Text>
          </View>
          {primaryAction ? <ActionButton action={primaryAction} busyAction={busyAction} compact disabled={primaryDisabled} onAction={onAction} /> : null}
        </View>
        <View style={styles.detailBadgeRow}>
          <StatusBadge label={statusLabel(order.status)} tone={statusTone(order.status)} />
          <StatusBadge label={isPaidOrder(order) ? 'ชำระแล้ว' : 'ยังไม่ชำระ'} tone={isPaidOrder(order) ? 'success' : 'amber'} />
          <StatusBadge label={bookingStatusLabel(order)} tone={bookingTone(order)} />
        </View>
        <View style={styles.detailTabs}>
          {detailTabs.map((tab) => {
            const active = activeTab === tab.key;

            return (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                key={tab.key}
                onPress={() => onTabChange(tab.key)}
                style={[styles.detailTab, active ? styles.detailTabActive : null]}
              >
                <Text style={[styles.detailTabText, active ? styles.detailTabTextActive : null]}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.detailBodyScrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.detailBodyScroll}
      >
        {activeTab === 'summary' ? <OrderSummaryTab order={order} signedSlipUrl={signedSlipUrl} /> : null}
        {activeTab === 'timeline' ? (
          <View style={styles.tabBody}>
            <OrderTimeline order={order} />
          </View>
        ) : null}
        {activeTab === 'conversation' ? <OrderConversationTab transcript={transcript} /> : null}
        {activeTab === 'notes' ? (
          <OrderNotesTab
            bookingDate={bookingDate}
            bookingTime={bookingTime}
            busyAction={busyAction}
            canErase={canErase}
            isDemoMode={isDemoMode}
            isSavingNote={isSavingNote}
            note={note}
            onAction={onAction}
            onBookingDateChange={onBookingDateChange}
            onBookingTimeChange={onBookingTimeChange}
            onNoteChange={onNoteChange}
            onSaveNote={onSaveNote}
            order={order}
            tenant={tenant}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function DefRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.defRow}>
      <Text style={styles.defLabel}>{label}</Text>
      <Text numberOfLines={2} style={styles.defValue}>
        {value}
      </Text>
    </View>
  );
}

function OrderSummaryTab({ order, signedSlipUrl }: { order: OrderQueueRow; signedSlipUrl?: string }) {
  const product = fromJoin(order.products);
  const referrer = fromJoin(order.referrers);
  const slipImageUrl = order.slip_url?.startsWith('http') ? order.slip_url : signedSlipUrl ?? null;
  const rows: Array<{ label: string; value: string }> = [
    { label: 'ผู้ซื้อ', value: orderBuyerName(order) },
    { label: 'เบอร์โทร', value: maskPhone(orderBuyerPhone(order)) },
    { label: 'อายุ', value: order.buyer_age ? `${order.buyer_age}` : '-' },
    { label: 'ช่องทาง', value: channelLabel(order.channel) },
    { label: 'การชำระเงิน', value: formatPayment(order) },
    { label: 'นัดหมาย', value: bookingStatusLabel(order) },
    { label: 'สาขา', value: orderBranchName(order) },
    { label: 'แพ็กเกจ', value: product?.name ?? 'ไม่พบสินค้า' },
    { label: 'วันที่สะดวก', value: formatPreferredDateRange(order) },
    { label: 'เวลาที่สะดวก', value: formatPreferredTimeWindow(order) },
    { label: 'ผู้แนะนำ', value: referrer ? `${referrer.name} (${referrer.ref_code})` : '-' },
    { label: 'อัปเดตล่าสุด', value: formatDateTime(order.updated_at) },
  ];

  return (
    <View style={styles.tabBody}>
      <View style={styles.defList}>
        {rows.map((row) => (
          <DefRow key={row.label} label={row.label} value={row.value} />
        ))}
      </View>
      {order.slip_url ? (
        <View style={styles.slipBlock}>
          <Text style={styles.tabSectionTitle}>หลักฐานชำระเงิน</Text>
          <View style={styles.slipRow}>
            {slipImageUrl ? <Image source={{ uri: slipImageUrl }} style={styles.slipImage} /> : null}
            <Text numberOfLines={3} style={styles.slipText}>
              {slipImageUrl ? 'ลิงก์ดูสลิปใช้ได้ 60 นาที' : 'มี storage path สำหรับสลิป'}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function OrderConversationTab({ transcript }: { transcript: TranscriptRow[] }) {
  if (transcript.length === 0) {
    return (
      <View style={styles.tabBody}>
        <View style={styles.tabEmpty}>
          <Text style={styles.tabEmptyTitle}>ยังไม่มีบทสนทนา</Text>
          <Text style={styles.tabEmptyText}>บทสนทนาที่ผูกกับออเดอร์นี้จะแสดงที่นี่</Text>
          <Link href="/admin/conversations" asChild>
            <Pressable accessibilityRole="link" style={styles.tabLinkButton}>
              <Text style={styles.tabLinkText}>เปิดกล่องข้อความ</Text>
            </Pressable>
          </Link>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.tabBody}>
      <View style={styles.transcript}>
        {transcript.slice(-8).map((message) => (
          <View key={message.id} style={styles.transcriptItem}>
            <Text style={styles.transcriptRole}>{message.role === 'user' ? 'ลูกค้า' : message.role === 'assistant' ? 'ผู้ช่วย' : 'ระบบ'}</Text>
            <Text style={styles.transcriptText}>{message.content}</Text>
          </View>
        ))}
      </View>
      <Link href="/admin/conversations" asChild>
        <Pressable accessibilityRole="link" style={styles.tabLinkButton}>
          <Text style={styles.tabLinkText}>เปิดกล่องข้อความ</Text>
        </Pressable>
      </Link>
    </View>
  );
}

function OrderNotesTab({
  bookingDate,
  bookingTime,
  busyAction,
  canErase,
  isDemoMode,
  isSavingNote,
  note,
  onAction,
  onBookingDateChange,
  onBookingTimeChange,
  onNoteChange,
  onSaveNote,
  order,
  tenant,
}: {
  bookingDate: string;
  bookingTime: string;
  busyAction: OrderMutationAction | null;
  canErase: boolean;
  isDemoMode: boolean;
  isSavingNote: boolean;
  note: string;
  onAction: (action: OrderMutationAction) => void;
  onBookingDateChange: (value: string) => void;
  onBookingTimeChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onSaveNote: (nextNote?: string) => void;
  order: OrderQueueRow;
  tenant: TenantContext | null;
}) {
  return (
    <View style={styles.tabBody}>
      {isDemoMode ? <Text style={styles.demoActionNotice}>โหมดตัวอย่าง: ปุ่มนี้จะไม่ส่งข้อมูลจริง</Text> : null}

      <Text style={styles.tabSectionTitle}>นัดหมาย</Text>
      <View style={styles.dateTimeRow}>
        <BookingDatePicker disabled={isDemoMode} onChange={onBookingDateChange} value={bookingDate} />
        <BookingTimePicker disabled={isDemoMode} onChange={onBookingTimeChange} value={bookingTime} />
      </View>

      <Text style={styles.tabSectionTitle}>โน้ตภายใน</Text>
      <TextInput
        accessibilityLabel="โน้ตภายใน"
        editable={!isDemoMode}
        multiline
        onChangeText={onNoteChange}
        placeholder="โน้ตภายใน"
        placeholderTextColor={MiraDesign.color.inkSoft}
        style={[styles.input, styles.noteInput, isDemoMode ? styles.disabledInput : null]}
        value={note}
      />
      <View style={styles.notePresetRow}>
        {notePresets.map((preset) => (
          <Pressable
            accessibilityRole="button"
            disabled={isSavingNote || isDemoMode}
            key={preset}
            onPress={() => {
              onNoteChange(preset);
              onSaveNote(preset);
            }}
            style={[styles.notePresetButton, isSavingNote || isDemoMode ? styles.disabled : null]}
          >
            <Text style={styles.notePresetText}>{preset}</Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          disabled={isSavingNote || isDemoMode}
          onPress={() => onSaveNote()}
          style={[styles.noteSaveButton, isSavingNote || isDemoMode ? styles.disabled : null]}
        >
          <Text style={styles.noteSaveText}>{isSavingNote ? 'กำลังบันทึก' : 'บันทึกโน้ต'}</Text>
        </Pressable>
      </View>

      <Text style={styles.tabSectionTitle}>การดำเนินการ</Text>
      <View style={styles.actions}>
        <ActionButton action="confirm" busyAction={busyAction} disabled={isDemoMode || !canAct(order, 'confirm')} onAction={onAction} />
        <ActionButton action="book" busyAction={busyAction} disabled={isDemoMode || !canAct(order, 'book') || !bookingDate || !bookingTime} onAction={onAction} />
        <ActionButton action="done" busyAction={busyAction} disabled={isDemoMode || !canAct(order, 'done')} onAction={onAction} />
        <ActionButton action="cancel" busyAction={busyAction} danger disabled={isDemoMode || !canAct(order, 'cancel')} onAction={onAction} />
      </View>

      <Text style={styles.tabSectionTitle}>ข้อมูลระบบ</Text>
      <View style={styles.defList}>
        <DefRow label="Tenant" value={tenant?.display_name ?? order.tenant_id} />
        <DefRow label="Order ID" value={order.id} />
        <DefRow label="สร้างเมื่อ" value={formatDateTime(order.created_at)} />
        <DefRow label="ชำระเมื่อ" value={formatDateTime(order.paid_at)} />
        <DefRow label="นัดหมาย" value={formatDateTime(order.booking_at)} />
      </View>
      <PdpaActions canErase={canErase} customerId={order.customer_id ?? null} />
    </View>
  );
}

function OrderTimeline({ order }: { order: OrderQueueRow }) {
  const paid = isPaidOrder(order);
  const steps: Array<{ detail: string; key: string; label: string; state: 'complete' | 'current' | 'pending'; time: string | null }> = [
    {
      detail: 'สร้างจาก checkout ในแชท',
      key: 'created',
      label: 'สร้างออเดอร์',
      state: 'complete',
      time: order.created_at,
    },
    {
      detail: order.status === 'awaiting_payment' ? 'รอหลักฐานการชำระเงิน' : 'มี payment provider หรือสถานะ paid',
      key: 'paid',
      label: 'ชำระเงิน',
      state: paid ? 'complete' : order.status === 'awaiting_payment' ? 'current' : 'pending',
      time: order.paid_at,
    },
    {
      detail: 'ทีมงานตรวจหลักฐานและยืนยันสถานะ',
      key: 'review',
      label: 'ตรวจ/ยืนยัน',
      state: order.status === 'submitted' ? 'current' : order.status === 'confirmed' || order.status === 'booked' || order.status === 'done' ? 'complete' : 'pending',
      time: order.status === 'submitted' || order.status === 'confirmed' || order.status === 'booked' || order.status === 'done' ? order.updated_at : null,
    },
    {
      detail: 'บันทึกเวลานัดหมายกับสาขา',
      key: 'booking',
      label: 'นัดหมาย',
      state: order.status === 'confirmed' ? 'current' : order.status === 'booked' || order.status === 'done' || Boolean(order.booking_at) ? 'complete' : 'pending',
      time: order.booking_at,
    },
    {
      detail: order.status === 'cancelled' ? 'รายการถูกยกเลิก' : 'ปิดงานหลังรับบริการ',
      key: 'done',
      label: order.status === 'cancelled' ? 'ยกเลิก' : 'เสร็จสิ้น',
      state: order.status === 'done' || order.status === 'cancelled' ? 'complete' : 'pending',
      time: order.status === 'done' || order.status === 'cancelled' ? order.updated_at : null,
    },
  ];

  return (
    <View style={styles.timeline}>
      {steps.map((step, index) => (
        <View key={step.key} style={styles.timelineItem}>
          <View style={styles.timelineRail}>
            <View style={[styles.timelineDot, step.state === 'complete' ? styles.timelineDotComplete : null, step.state === 'current' ? styles.timelineDotCurrent : null]} />
            {index < steps.length - 1 ? <View style={[styles.timelineLine, step.state === 'complete' ? styles.timelineLineComplete : null]} /> : null}
          </View>
          <View style={[styles.timelineCopy, step.state === 'pending' ? styles.timelineCopyPending : null]}>
            <View style={styles.timelineTitleRow}>
              <Text style={styles.timelineTitle}>{step.label}</Text>
              <Text style={styles.timelineTime}>{formatDateTime(step.time)}</Text>
            </View>
            <Text style={styles.timelineDetail}>{step.detail}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function BookingDatePicker({ disabled, onChange, value }: { disabled: boolean; onChange: (value: string) => void; value: string }) {
  const [visibleMonth, setVisibleMonth] = useState(calendarMonthForDate(value));
  const cells = useMemo(() => calendarCells(visibleMonth, value), [value, visibleMonth]);

  useEffect(() => {
    if (value) {
      setVisibleMonth(calendarMonthForDate(value));
    }
  }, [value]);

  return (
    <View style={styles.pickerField}>
      <View style={styles.pickerLabelRow}>
        <Text style={styles.formLabel}>วันที่</Text>
        <Text style={styles.selectedPickerValue}>{fullDateLabel(value)}</Text>
      </View>
      <View style={[styles.calendarPanel, disabled ? styles.disabledInput : null]}>
        <View style={styles.calendarHeader}>
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => setVisibleMonth((current) => monthValue(addMonths(monthDateFromValue(current), -1)))}
            style={[styles.calendarNavButton, disabled ? styles.disabled : null]}
          >
            <Text style={styles.calendarNavText}>ก่อนหน้า</Text>
          </Pressable>
          <Text style={styles.calendarMonthTitle}>{calendarMonthLabel(visibleMonth)}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => setVisibleMonth((current) => monthValue(addMonths(monthDateFromValue(current), 1)))}
            style={[styles.calendarNavButton, disabled ? styles.disabled : null]}
          >
            <Text style={styles.calendarNavText}>ถัดไป</Text>
          </Pressable>
        </View>
        <View style={styles.calendarWeekRow}>
          {calendarWeekdays.map((day) => (
            <Text key={day} style={styles.calendarWeekday}>
              {day}
            </Text>
          ))}
        </View>
        <View style={styles.calendarGrid}>
          {cells.map((cell) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: disabled || cell.isDisabled, selected: cell.isSelected }}
              disabled={disabled || cell.isDisabled}
              key={cell.value}
              onPress={() => onChange(cell.value)}
              style={[
                styles.calendarCell,
                !cell.isCurrentMonth ? styles.calendarCellMuted : null,
                cell.isToday ? styles.calendarCellToday : null,
                cell.isSelected ? styles.calendarCellSelected : null,
                disabled || cell.isDisabled ? styles.calendarCellDisabled : null,
              ]}
            >
              <Text
                style={[
                  styles.calendarCellText,
                  !cell.isCurrentMonth ? styles.calendarCellTextMuted : null,
                  cell.isSelected ? styles.calendarCellTextSelected : null,
                  disabled || cell.isDisabled ? styles.calendarCellTextDisabled : null,
                ]}
              >
                {cell.day}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

function BookingTimePicker({ disabled, onChange, value }: { disabled: boolean; onChange: (value: string) => void; value: string }) {
  const parsed = parseTimeValue(value);
  const selectedHour = parsed?.hour;
  const selectedMinute = parsed?.minute;
  const hourOptions = useMemo(() => mergeTimeOption(bookingHourOptions, selectedHour), [selectedHour]);
  const minuteOptions = useMemo(() => mergeTimeOption(bookingMinuteOptions, selectedMinute), [selectedMinute]);
  const chooseHour = useCallback(
    (hour: string) => {
      onChange(composeTimeValue(hour, selectedMinute ?? defaultBookingMinute));
    },
    [onChange, selectedMinute],
  );
  const chooseMinute = useCallback(
    (minute: string) => {
      onChange(composeTimeValue(selectedHour ?? defaultBookingHour, minute));
    },
    [onChange, selectedHour],
  );

  return (
    <View style={styles.pickerField}>
      <View style={styles.pickerLabelRow}>
        <Text style={styles.formLabel}>เวลา</Text>
        <Text style={styles.selectedPickerValue}>{value || 'เลือกเวลา'}</Text>
      </View>
      <View style={[styles.timePickerPanel, disabled ? styles.disabledInput : null]}>
        <View style={styles.timePickerColumn}>
          <Text style={styles.timePickerColumnTitle}>ชั่วโมง</Text>
          <View style={styles.timePickerGrid}>
            {hourOptions.map((hour) => {
              const isSelected = hour === selectedHour;

              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled, selected: isSelected }}
                  disabled={disabled}
                  key={hour}
                  onPress={() => chooseHour(hour)}
                  style={[styles.timePickerButton, isSelected ? styles.timePickerButtonActive : null, disabled ? styles.disabled : null]}
                >
                  <Text style={[styles.timePickerButtonText, isSelected ? styles.timePickerButtonTextActive : null]}>{hour}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={styles.timePickerColumn}>
          <Text style={styles.timePickerColumnTitle}>นาที</Text>
          <View style={styles.timePickerGrid}>
            {minuteOptions.map((minute) => {
              const isSelected = minute === selectedMinute;

              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled, selected: isSelected }}
                  disabled={disabled}
                  key={minute}
                  onPress={() => chooseMinute(minute)}
                  style={[styles.timePickerButton, isSelected ? styles.timePickerButtonActive : null, disabled ? styles.disabled : null]}
                >
                  <Text style={[styles.timePickerButtonText, isSelected ? styles.timePickerButtonTextActive : null]}>{minute}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </View>
  );
}

function ActionButton({
  action,
  busyAction,
  compact,
  danger,
  disabled,
  onAction,
}: {
  action: OrderMutationAction;
  busyAction: OrderMutationAction | null;
  compact?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onAction: (action: OrderMutationAction) => void;
}) {
  const isBusy = busyAction === action;
  const label = actionLabels[action];

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || Boolean(busyAction) }}
      disabled={disabled || Boolean(busyAction)}
      onPress={() => onAction(action)}
      style={[
        styles.actionButton,
        compact ? styles.actionButtonCompact : null,
        danger ? styles.dangerActionButton : null,
        disabled || busyAction ? styles.disabled : null,
      ]}
    >
      <Text style={[styles.actionButtonText, danger ? styles.dangerActionButtonText : null]}>{isBusy ? 'กำลังบันทึก' : label}</Text>
    </Pressable>
  );
}

function actionSuccessMessage(action: OrderMutationAction, order: OrderRow) {
  if (action === 'confirm') {
    return 'ยืนยันชำระเงินแล้ว โทรหาลูกค้า เลือกวันเวลา แล้วบันทึกนัดหมาย';
  }

  if (action === 'book') {
    return `บันทึกนัดหมายแล้วสำหรับ ${formatDateTime(order.booking_at)}`;
  }

  if (action === 'done') {
    return 'ปิดงานออเดอร์นี้แล้ว';
  }

  return `อัปเดตออเดอร์เป็น ${statusLabel(order.status)} แล้ว`;
}

function StatusBadge({ label, tone = 'blue' }: { label: string; tone?: BadgeTone }) {
  return <Text style={[styles.statusBadge, styles[`${tone}Badge`]]}>{label}</Text>;
}

function ChipButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.chipButton, active ? styles.chipButtonActive : null]}>
      <Text style={[styles.chipButtonText, active ? styles.chipButtonTextActive : null]}>{label}</Text>
    </Pressable>
  );
}

function FilterGroup({ children, label }: { children: ReactNode; label: string }) {
  return (
    <View style={styles.filterGroup}>
      <Text style={styles.filterLabel}>{label}</Text>
      <View style={styles.filterChipRow}>{children}</View>
    </View>
  );
}

function EmptyDetail() {
  return (
    <View style={styles.emptyDetail}>
      <View style={styles.emptyIcon}>
        <SymbolView name={{ android: 'receipt_long', ios: 'list.bullet.rectangle', web: 'receipt_long' }} size={26} tintColor={MiraDesign.color.blue} />
      </View>
      <Text style={styles.emptyDetailTitle}>เลือกคำสั่งซื้อ</Text>
      <Text style={styles.emptyDetailText}>รายละเอียด การชำระเงิน ไทม์ไลน์ และโน้ตจะแสดงที่นี่</Text>
    </View>
  );
}

function NoResultsState({ hasFilters, onClear }: { hasFilters: boolean; onClear: () => void }) {
  return (
    <View style={styles.emptyQueue}>
      <View style={styles.emptyIcon}>
        <SymbolView name={{ android: 'search_off', ios: 'magnifyingglass', web: 'search_off' }} size={26} tintColor={MiraDesign.color.blue} />
      </View>
      <Text style={styles.emptyTitle}>ไม่พบคำสั่งซื้อ</Text>
      <Text style={styles.emptyBody}>ลองล้างตัวกรองหรือค้นหาด้วยชื่อ เบอร์โทร หรือแพ็กเกจอื่น</Text>
      {hasFilters ? (
        <Pressable accessibilityRole="button" onPress={onClear} style={styles.emptyAction}>
          <Text style={styles.emptyActionText}>ล้างตัวกรอง</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function QueueEmptyState() {
  return (
    <View style={styles.emptyQueue}>
      <View style={styles.emptyIcon}>
        <SymbolView name={{ android: 'inbox', ios: 'tray', web: 'inbox' }} size={30} tintColor={MiraDesign.color.blue} />
      </View>
      <Text style={styles.emptyTitle}>ยังไม่มีคำสั่งซื้อ</Text>
      <Text style={styles.emptyBody}>คำสั่งซื้อจาก chat checkout จะแสดงที่นี่เมื่อมีข้อมูลเข้าระบบ</Text>
      <Link href="/admin/catalog" asChild>
        <Pressable accessibilityRole="link" style={styles.emptyAction}>
          <Text style={styles.emptyActionText}>ไปที่แค็ตตาล็อก</Text>
        </Pressable>
      </Link>
    </View>
  );
}

function ErrorState({ onRetry, text }: { onRetry: () => void; text: string }) {
  return (
    <View style={styles.emptyQueue}>
      <View style={styles.emptyIconDanger}>
        <SymbolView name={{ android: 'error', ios: 'exclamationmark.triangle', web: 'error' }} size={30} tintColor={MiraDesign.color.danger} />
      </View>
      <Text style={styles.emptyTitle}>โหลดคิวคำสั่งซื้อไม่สำเร็จ</Text>
      <Text style={styles.emptyBody}>{text}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.emptyAction}>
        <Text style={styles.emptyActionText}>ลองอีกครั้ง</Text>
      </Pressable>
    </View>
  );
}

function OrdersSkeleton() {
  return (
    <View style={styles.queueStack}>
      {Array.from({ length: 5 }, (_, index) => (
        <View key={index} style={styles.skeletonCard}>
          <View style={styles.skeletonTop}>
            <View style={styles.skeletonAvatar} />
            <View style={styles.skeletonLines}>
              <View style={styles.skeletonLineWide} />
              <View style={styles.skeletonLine} />
            </View>
          </View>
          <View style={styles.skeletonGrid}>
            <View style={styles.skeletonPill} />
            <View style={styles.skeletonPill} />
            <View style={styles.skeletonPill} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: MiraDesign.color.canvas,
    flex: 1,
  },
  mobileScrollContent: {
    flexGrow: 1,
  },
  container: {
    gap: 8,
    padding: 12,
    paddingBottom: 28,
  },
  containerDesktop: {
    flex: 1,
    padding: 16,
  },
  header: {
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...softShadow,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  headerTitleGroup: {
    flex: 1,
    gap: 2,
    minWidth: 200,
  },
  headerTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  headerMetaText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  modePill: {
    alignSelf: 'flex-start',
    borderRadius: MiraDesign.radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  modePillDemo: {
    backgroundColor: '#FBEFD3',
  },
  modePillLive: {
    backgroundColor: MiraDesign.color.primarySoft,
  },
  modePillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  modePillTextDemo: {
    color: '#946200',
  },
  modePillTextLive: {
    color: MiraDesign.color.primaryDeep,
  },
  iconButton: {
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
  iconButtonText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 13,
    fontWeight: '800',
  },
  headerDemoNote: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '600',
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  summaryChip: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: MiraDesign.radius.pill,
    borderWidth: 1,
    cursor: 'pointer',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  summaryChipActive: {
    backgroundColor: MiraDesign.color.primarySoft,
    borderColor: MiraDesign.color.primary,
  },
  summaryChipValue: {
    color: MiraDesign.color.ink,
    fontSize: 14,
    fontWeight: '900',
  },
  summaryChipValueActive: {
    color: MiraDesign.color.primaryDeep,
  },
  summaryChipLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '800',
  },
  summaryChipLabelActive: {
    color: MiraDesign.color.primaryDeep,
  },
  toolbarRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  searchClear: {
    cursor: 'pointer',
    padding: 2,
  },
  toolbarButton: {
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
  toolbarButtonActive: {
    backgroundColor: MiraDesign.color.primarySoft,
    borderColor: MiraDesign.color.primary,
  },
  toolbarButtonText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 13,
    fontWeight: '800',
  },
  toolbarButtonTextActive: {
    color: MiraDesign.color.primaryDeep,
  },
  toolbarCount: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '800',
    marginLeft: 'auto',
  },
  workbench: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 0,
  },
  listPane: {
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
  },
  listScrollContent: {
    gap: 8,
    padding: 8,
  },
  mobileDetailOverlay: {
    backgroundColor: MiraDesign.color.canvas,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 40,
  },
  inboxStack: {
    gap: 8,
  },
  inboxCard: {
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    cursor: 'pointer',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  inboxCardSelected: {
    backgroundColor: MiraDesign.color.surfaceSoft,
  },
  inboxCardAccent: {
    alignSelf: 'stretch',
    backgroundColor: MiraDesign.color.primary,
    width: 3,
  },
  inboxCardBody: {
    flex: 1,
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inboxCardTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  inboxOrderId: {
    color: MiraDesign.color.inkSoft,
    flex: 1,
    fontSize: 12,
    fontWeight: '800',
  },
  inboxProduct: {
    color: MiraDesign.color.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  inboxMeta: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '600',
  },
  inboxBottom: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    marginTop: 2,
  },
  inboxStatusLine: {
    color: MiraDesign.color.inkSoft,
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
  },
  nextActionPill: {
    backgroundColor: MiraDesign.color.primarySoft,
    borderRadius: MiraDesign.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  nextActionPillText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '800',
  },
  detailPanel: {
    flex: 1,
    minHeight: 0,
  },
  detailHeader: {
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderBottomWidth: 1,
    gap: 8,
    padding: 12,
  },
  detailBack: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    cursor: 'pointer',
    flexDirection: 'row',
    gap: 4,
  },
  detailBackText: {
    color: MiraDesign.color.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  detailHeaderRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  detailHeaderMain: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  detailTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  detailTab: {
    borderRadius: 8,
    cursor: 'pointer',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  detailTabActive: {
    backgroundColor: MiraDesign.color.primarySoft,
  },
  detailTabText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 13,
    fontWeight: '800',
  },
  detailTabTextActive: {
    color: MiraDesign.color.primaryDeep,
  },
  detailBodyScroll: {
    flex: 1,
    minHeight: 0,
  },
  detailBodyScrollContent: {
    paddingBottom: 16,
  },
  tabBody: {
    gap: 10,
    padding: 12,
  },
  defList: {
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  defRow: {
    borderColor: MiraDesign.color.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  defLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  defValue: {
    color: MiraDesign.color.ink,
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 12,
    textAlign: 'right',
  },
  tabSectionTitle: {
    color: MiraDesign.color.ink,
    fontSize: 13,
    fontWeight: '900',
  },
  slipBlock: {
    gap: 8,
  },
  slipText: {
    color: MiraDesign.color.inkSoft,
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  tabEmpty: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 28,
  },
  tabEmptyTitle: {
    color: MiraDesign.color.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  tabEmptyText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 13,
    textAlign: 'center',
  },
  tabLinkButton: {
    alignSelf: 'center',
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    cursor: 'pointer',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  tabLinkText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 13,
    fontWeight: '800',
  },
  overlay: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 50,
  },
  overlayBackdrop: {
    backgroundColor: 'rgba(10, 32, 40, 0.32)',
    bottom: 0,
    cursor: 'pointer',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  filterPanel: {
    backgroundColor: MiraDesign.color.surface,
    overflow: 'hidden',
  },
  filterPanelDesktop: {
    borderColor: MiraDesign.color.line,
    borderLeftWidth: 1,
    bottom: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    width: 360,
  },
  filterPanelSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    bottom: 0,
    left: 0,
    maxHeight: '82%',
    position: 'absolute',
    right: 0,
  },
  filterHeader: {
    alignItems: 'center',
    borderColor: MiraDesign.color.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  filterTitle: {
    color: MiraDesign.color.ink,
    fontSize: 15,
    fontWeight: '900',
  },
  filterClose: {
    cursor: 'pointer',
    padding: 4,
  },
  filterBody: {
    gap: 16,
    padding: 14,
  },
  filterFooter: {
    borderColor: MiraDesign.color.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 8,
    padding: 12,
  },
  filterClearButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    cursor: 'pointer',
    flex: 1,
    height: 42,
    justifyContent: 'center',
  },
  filterClearText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 13,
    fontWeight: '800',
  },
  filterApplyButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.primary,
    borderRadius: 8,
    cursor: 'pointer',
    flex: 1,
    height: 42,
    justifyContent: 'center',
  },
  filterApplyText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  emptyDetail: {
    alignItems: 'center',
    flex: 1,
    gap: 8,
    justifyContent: 'center',
    padding: 24,
  },
  emptyDetailTitle: {
    color: MiraDesign.color.ink,
    fontSize: 16,
    fontWeight: '800',
  },
  emptyDetailText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 13,
    maxWidth: 280,
    textAlign: 'center',
  },
  headerCard: {
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 11,
    ...softShadow,
  },
  headerMain: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  titleGroup: {
    flex: 1,
    gap: 5,
    minWidth: 260,
  },
  eyebrow: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  title: {
    color: MiraDesign.color.ink,
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 26,
  },
  subtitle: {
    color: MiraDesign.color.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    maxWidth: 760,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.showcaseBlue,
    borderRadius: 8,
    cursor: 'pointer',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 13,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    cursor: 'pointer',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 13,
  },
  secondaryButtonText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '800',
  },
  statusPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  banner: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 9,
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
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  errorBannerText: {
    color: '#8F2424',
  },
  successBannerText: {
    color: '#1E7C63',
  },
  demoBanner: {
    alignItems: 'flex-start',
    backgroundColor: '#FBFDFE',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    padding: 8,
  },
  demoBannerCopy: {
    flex: 1,
    gap: 2,
  },
  demoBannerTitle: {
    color: MiraDesign.color.ink,
    fontSize: 12,
    fontWeight: '800',
  },
  demoBannerText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    lineHeight: 17,
  },
  kpiScroll: {
    marginHorizontal: -16,
  },
  kpiScrollContent: {
    gap: 8,
    paddingHorizontal: 16,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  kpiCard: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    cursor: 'pointer',
    gap: 3,
    minHeight: 72,
    minWidth: 132,
    overflow: 'hidden',
    padding: 8,
    width: 140,
  },
  kpiCardActive: {
    backgroundColor: '#F7FBFF',
    borderColor: MiraDesign.color.blue,
  },
  kpiAccent: {
    borderRadius: 8,
    height: 3,
    marginBottom: 1,
    width: 34,
  },
  kpiLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '800',
  },
  kpiValue: {
    color: MiraDesign.color.ink,
    fontSize: 21,
    fontWeight: '900',
    lineHeight: 24,
  },
  kpiDetail: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    lineHeight: 15,
  },
  blueAccent: {
    backgroundColor: MiraDesign.color.showcaseBlue,
  },
  amberAccent: {
    backgroundColor: MiraDesign.color.amber,
  },
  successAccent: {
    backgroundColor: MiraDesign.color.showcaseMint,
  },
  dangerAccent: {
    backgroundColor: MiraDesign.color.danger,
  },
  mutedAccent: {
    backgroundColor: MiraDesign.color.line,
  },
  toolbar: {
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 7,
    padding: 9,
    ...softShadow,
  },
  toolbarTop: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  searchBox: {
    alignItems: 'center',
    backgroundColor: '#FBFDFE',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 240,
    flexDirection: 'row',
    gap: 8,
    maxWidth: 560,
    minHeight: 38,
    minWidth: 160,
    paddingHorizontal: 10,
  },
  searchInput: {
    color: MiraDesign.color.ink,
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    minHeight: 36,
    minWidth: 0,
    paddingHorizontal: 0,
  },
  toggleButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    cursor: 'pointer',
    flexDirection: 'row',
    gap: 8,
    minHeight: 38,
    paddingHorizontal: 10,
  },
  toggleButtonActive: {
    backgroundColor: MiraDesign.color.blueSoft,
    borderColor: MiraDesign.color.blue,
  },
  toggleDot: {
    backgroundColor: MiraDesign.color.line,
    borderRadius: 7,
    height: 14,
    width: 14,
  },
  toggleDotActive: {
    backgroundColor: MiraDesign.color.showcaseBlue,
  },
  toggleText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '800',
  },
  toggleTextActive: {
    color: MiraDesign.color.primaryDeep,
  },
  toolbarSection: {
    gap: 5,
  },
  toolbarSectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  toolbarLabel: {
    color: MiraDesign.color.ink,
    fontSize: 11,
    fontWeight: '800',
  },
  toolbarMeta: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '800',
  },
  segmentRow: {
    backgroundColor: '#F0F5F6',
    borderRadius: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
    padding: 3,
  },
  segment: {
    alignItems: 'center',
    borderRadius: 8,
    cursor: 'pointer',
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: 28,
    minWidth: 98,
    paddingHorizontal: 7,
  },
  segmentActive: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderWidth: 1,
  },
  segmentText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '800',
  },
  segmentTextActive: {
    color: MiraDesign.color.primaryDeep,
  },
  toolbarGrid: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    minWidth: 0,
  },
  filterLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  filterChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  chipButton: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    cursor: 'pointer',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  chipButtonActive: {
    backgroundColor: MiraDesign.color.blueSoft,
    borderColor: MiraDesign.color.blue,
  },
  chipButtonText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '800',
  },
  chipButtonTextActive: {
    color: MiraDesign.color.primaryDeep,
  },
  workspace: {
    alignItems: 'stretch',
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 0,
  },
  workspaceStack: {
    flexDirection: 'column',
  },
  queuePane: {
    flex: 1,
    minWidth: 0,
  },
  queuePaneMobile: {
    width: '100%',
  },
  queueScrollContent: {
    gap: 8,
    paddingBottom: 16,
  },
  detailPane: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    flex: 0.92,
    minHeight: 380,
    minWidth: 360,
    overflow: 'hidden',
    ...softShadow,
  },
  queueStack: {
    gap: 8,
  },
  queueHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  panelTitle: {
    color: MiraDesign.color.ink,
    fontSize: 16,
    fontWeight: '900',
  },
  panelSubtitle: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  orderRow: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    cursor: 'pointer',
    gap: 9,
    overflow: 'hidden',
    padding: 12,
    position: 'relative',
  },
  orderRowSelected: {
    backgroundColor: '#F7FBFF',
    borderColor: '#B8D4F3',
  },
  orderSelectedAccent: {
    backgroundColor: MiraDesign.color.blue,
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
    width: 3,
  },
  orderRowTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
  },
  productMedia: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.blueSoft,
    borderRadius: 8,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  productImage: {
    borderRadius: 8,
    height: 44,
    width: 44,
  },
  orderMain: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  orderTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  orderId: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '800',
  },
  orderTitle: {
    color: MiraDesign.color.ink,
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 20,
  },
  orderPersonRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  customerName: {
    color: MiraDesign.color.ink,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '800',
  },
  customerMeta: {
    color: MiraDesign.color.inkSoft,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '700',
  },
  dotSeparator: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '900',
  },
  orderSignalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  infoPill: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 5,
    maxWidth: '100%',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  mutedInfoPill: {
    backgroundColor: '#F2F6F7',
  },
  blueInfoPill: {
    backgroundColor: MiraDesign.color.blueSoft,
  },
  amberInfoPill: {
    backgroundColor: '#FFF2C8',
  },
  successInfoPill: {
    backgroundColor: '#E7F8F2',
  },
  dangerInfoPill: {
    backgroundColor: '#FFE2E2',
  },
  infoPillText: {
    color: MiraDesign.color.ink,
    fontSize: 11,
    fontWeight: '800',
  },
  orderMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  queueFactsLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  queueFactText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
  },
  nextActionRow: {
    alignItems: 'center',
    backgroundColor: '#FAFCFD',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 8,
  },
  nextActionText: {
    color: MiraDesign.color.inkSoft,
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
    minWidth: 180,
  },
  detailShell: {
    flex: 1,
    minHeight: 0,
  },
  detailScroll: {
    flex: 1,
  },
  detailScrollContent: {
    paddingBottom: 8,
  },
  detailBody: {
    gap: 10,
    padding: 12,
  },
  detailHead: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  detailTitleBlock: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  detailEyebrow: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  detailTitle: {
    color: MiraDesign.color.ink,
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 23,
  },
  detailSubtitle: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  detailBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 3,
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 11,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: MiraDesign.color.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  sectionBodyStrong: {
    color: MiraDesign.color.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  helperText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 13,
    lineHeight: 19,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaCell: {
    backgroundColor: 'transparent',
    borderBottomColor: '#E7EEF0',
    borderBottomWidth: 1,
    flexGrow: 1,
    minWidth: 132,
    paddingHorizontal: 0,
    paddingVertical: 7,
  },
  metaLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  metaValue: {
    color: MiraDesign.color.ink,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
    marginTop: 3,
  },
  slipRow: {
    alignItems: 'center',
    backgroundColor: '#FAFCFD',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 10,
  },
  slipImage: {
    backgroundColor: MiraDesign.color.blueSoft,
    borderRadius: 8,
    height: 72,
    width: 72,
  },
  slipCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  timeline: {
    gap: 0,
  },
  timelineItem: {
    flexDirection: 'row',
    gap: 10,
  },
  timelineRail: {
    alignItems: 'center',
    width: 20,
  },
  timelineDot: {
    backgroundColor: '#E1E9EB',
    borderColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 2,
    height: 16,
    width: 16,
  },
  timelineDotComplete: {
    backgroundColor: MiraDesign.color.showcaseMint,
  },
  timelineDotCurrent: {
    backgroundColor: MiraDesign.color.amber,
  },
  timelineLine: {
    backgroundColor: '#E1E9EB',
    flex: 1,
    minHeight: 28,
    width: 2,
  },
  timelineLineComplete: {
    backgroundColor: '#B9DDD2',
  },
  timelineCopy: {
    flex: 1,
    gap: 3,
    paddingBottom: 10,
  },
  timelineCopyPending: {
    opacity: 0.6,
  },
  timelineTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  timelineTitle: {
    color: MiraDesign.color.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  timelineTime: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 11,
    fontWeight: '800',
  },
  timelineDetail: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    lineHeight: 17,
  },
  inlineLinkButton: {
    backgroundColor: MiraDesign.color.blueSoft,
    borderRadius: 8,
    cursor: 'pointer',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  inlineLinkText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 11,
    fontWeight: '800',
  },
  transcript: {
    gap: 8,
  },
  transcriptItem: {
    backgroundColor: '#FAFCFD',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 9,
  },
  transcriptRole: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  transcriptText: {
    color: MiraDesign.color.ink,
    fontSize: 13,
    lineHeight: 19,
  },
  demoActionNotice: {
    backgroundColor: '#FBFDFE',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 18,
    padding: 10,
  },
  formBlock: {
    gap: 9,
  },
  dateTimeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  pickerField: {
    flex: 1,
    gap: 8,
    minWidth: 260,
  },
  pickerLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  formLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  selectedPickerValue: {
    color: MiraDesign.color.primaryDeep,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'right',
  },
  calendarPanel: {
    backgroundColor: '#FAFCFD',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  calendarHeader: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomColor: MiraDesign.color.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 42,
    paddingHorizontal: 8,
  },
  calendarMonthTitle: {
    color: MiraDesign.color.ink,
    flex: 1,
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
  },
  calendarNavButton: {
    alignItems: 'center',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    cursor: 'pointer',
    justifyContent: 'center',
    minHeight: 31,
    minWidth: 54,
    paddingHorizontal: 8,
  },
  calendarNavText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 11,
    fontWeight: '900',
  },
  calendarWeekRow: {
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    paddingHorizontal: 6,
    paddingTop: 8,
  },
  calendarWeekday: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '900',
    textAlign: 'center',
    width: `${100 / 7}%`,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 6,
  },
  calendarCell: {
    alignItems: 'center',
    aspectRatio: 1,
    borderColor: 'transparent',
    borderRadius: 8,
    borderWidth: 1,
    cursor: 'pointer',
    justifyContent: 'center',
    width: `${100 / 7}%`,
  },
  calendarCellMuted: {
    opacity: 0.55,
  },
  calendarCellToday: {
    borderColor: MiraDesign.color.blue,
  },
  calendarCellSelected: {
    backgroundColor: MiraDesign.color.blue,
    borderColor: MiraDesign.color.blue,
  },
  calendarCellDisabled: {
    opacity: 0.28,
  },
  calendarCellText: {
    color: MiraDesign.color.ink,
    fontSize: 12,
    fontWeight: '900',
  },
  calendarCellTextMuted: {
    color: MiraDesign.color.inkSoft,
  },
  calendarCellTextSelected: {
    color: '#FFFFFF',
  },
  calendarCellTextDisabled: {
    color: MiraDesign.color.inkSoft,
  },
  timePickerPanel: {
    backgroundColor: '#FAFCFD',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 10,
  },
  timePickerColumn: {
    flex: 1,
    gap: 8,
  },
  timePickerColumnTitle: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  timePickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  timePickerButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    cursor: 'pointer',
    justifyContent: 'center',
    minHeight: 34,
    minWidth: 44,
    paddingHorizontal: 8,
  },
  timePickerButtonActive: {
    backgroundColor: MiraDesign.color.blue,
    borderColor: MiraDesign.color.blue,
  },
  timePickerButtonText: {
    color: MiraDesign.color.ink,
    fontSize: 12,
    fontWeight: '900',
  },
  timePickerButtonTextActive: {
    color: '#FFFFFF',
  },
  input: {
    backgroundColor: '#FAFCFD',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    color: MiraDesign.color.ink,
    fontSize: 14,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  noteInput: {
    minHeight: 84,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  disabledInput: {
    backgroundColor: '#F3F7FA',
  },
  notePresetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  notePresetButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.blueSoft,
    borderRadius: 8,
    cursor: 'pointer',
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 10,
  },
  notePresetText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '900',
  },
  noteSaveButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.primaryDeep,
    borderRadius: 8,
    cursor: 'pointer',
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 12,
  },
  noteSaveText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.showcaseBlue,
    borderRadius: 8,
    cursor: 'pointer',
    justifyContent: 'center',
    minHeight: 38,
    minWidth: 92,
    paddingHorizontal: 12,
  },
  actionButtonCompact: {
    minHeight: 40,
    minWidth: 118,
  },
  dangerActionButton: {
    backgroundColor: '#FFE8E8',
    borderColor: '#F7B9BA',
    borderWidth: 1,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'capitalize',
  },
  dangerActionButtonText: {
    color: '#A23538',
  },
  detailStickyBar: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderTopColor: MiraDesign.color.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    padding: 10,
  },
  stickyCopy: {
    flex: 1,
    minWidth: 0,
  },
  stickyLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  stickyTitle: {
    color: MiraDesign.color.ink,
    fontSize: 14,
    fontWeight: '900',
    marginTop: 3,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  blueBadge: {
    backgroundColor: MiraDesign.color.blueSoft,
    color: MiraDesign.color.primaryDeep,
  },
  amberBadge: {
    backgroundColor: '#FFF2C8',
    color: '#7A5A05',
  },
  successBadge: {
    backgroundColor: '#E7F8F2',
    color: '#087B5D',
  },
  dangerBadge: {
    backgroundColor: '#FFE2E2',
    color: MiraDesign.color.danger,
  },
  mutedBadge: {
    backgroundColor: '#F2F6F7',
    color: MiraDesign.color.inkSoft,
  },
  noSelection: {
    alignItems: 'center',
    flex: 1,
    gap: 10,
    justifyContent: 'center',
    minHeight: 360,
    padding: 28,
  },
  emptyQueue: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: 10,
    justifyContent: 'center',
    minHeight: 260,
    padding: 22,
  },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.blueSoft,
    borderRadius: 8,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  emptyIconDanger: {
    alignItems: 'center',
    backgroundColor: '#FFE2E2',
    borderRadius: 8,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  emptyTitle: {
    color: MiraDesign.color.ink,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyBody: {
    color: MiraDesign.color.inkSoft,
    fontSize: 13,
    lineHeight: 19,
    maxWidth: 420,
    textAlign: 'center',
  },
  hintList: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    marginTop: 4,
  },
  hintText: {
    backgroundColor: '#F2F6F7',
    borderRadius: 8,
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  emptyAction: {
    backgroundColor: MiraDesign.color.blue,
    borderRadius: 8,
    cursor: 'pointer',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  emptyActionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  skeletonCard: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 14,
    padding: 14,
  },
  skeletonTop: {
    flexDirection: 'row',
    gap: 12,
  },
  skeletonAvatar: {
    backgroundColor: '#E4EFF9',
    borderRadius: 8,
    height: 52,
    width: 52,
  },
  skeletonLines: {
    flex: 1,
    gap: 8,
    justifyContent: 'center',
  },
  skeletonLineWide: {
    backgroundColor: '#E4EFF9',
    borderRadius: 8,
    height: 14,
    width: '74%',
  },
  skeletonLine: {
    backgroundColor: '#EEF5FB',
    borderRadius: 8,
    height: 12,
    width: '48%',
  },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  skeletonPill: {
    backgroundColor: '#EEF5FB',
    borderRadius: 8,
    height: 34,
    width: 110,
  },
  disabled: {
    opacity: 0.45,
  },
});
