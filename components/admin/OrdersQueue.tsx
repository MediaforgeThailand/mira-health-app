import { Link } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { Pill } from '@/components/MiraUI';
import { MiraDesign, softShadow } from '@/constants/Design';
import { invokeFunction } from '@/lib/api/client';
import { useAuthSession } from '@/lib/auth/useAuthSession';
import { supabase, supabaseConfigStatus } from '@/lib/supabase';
import type {
  AdminOrderActionRequest,
  AdminSlipUrlResponse,
  ChatMessageRow,
  OrderRow,
  OrderStatus,
  PdpaDeleteResponse,
  PdpaExportResponse,
  PdpaRequest,
  TenantSummary,
} from '@/lib/types/api';
import { defaultTenantSlug } from '@/lib/marketplace/hospitalProducts';
import { showcaseDemoAdminOrders, showcaseDemoTenant, showcaseDemoTranscript } from '@/lib/showcase/demoFixtures';

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

const activeStatuses: OrderStatus[] = ['selecting_branch', 'collecting_info', 'awaiting_payment', 'submitted', 'confirmed', 'booked'];
const notePresets = ['โทรแล้ว-ไม่รับ', 'โทรแล้ว-เลื่อน'] as const;

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

function statusTone(status: OrderStatus): 'amber' | 'blue' | 'danger' | 'mint' {
  if (status === 'cancelled') {
    return 'danger';
  }

  if (status === 'submitted' || status === 'confirmed' || status === 'booked' || status === 'done') {
    return 'mint';
  }

  if (status === 'awaiting_payment') {
    return 'blue';
  }

  return 'amber';
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

export function OrdersQueue({ title = 'Orders Queue' }: { title?: string }) {
  const auth = useAuthSession();
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
  const [showActiveOnly, setShowActiveOnly] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<OrderMutationAction | null>(null);
  const [pdpaBusyAction, setPdpaBusyAction] = useState<'delete' | 'export' | null>(null);
  const [pdpaConfirm, setPdpaConfirm] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isWide = width >= 1080;
  const isDemoMode = !auth.session || !supabaseConfigStatus.isConfigured;

  const selectedOrder = useMemo(() => orders.find((order) => order.id === selectedId) ?? orders[0] ?? null, [orders, selectedId]);
  const canRunPdpa =
    !isDemoMode &&
    Boolean(selectedOrder?.customer_id) &&
    (tenant?.role === 'superadmin' || tenant?.role === 'tenant_admin');

  const filteredOrders = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return orders.filter((order) => {
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
        order.status,
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

      return (!showActiveOnly || activeStatuses.includes(order.status)) && (!needle || haystack.includes(needle));
    });
  }, [orders, query, showActiveOnly]);

  const summary = useMemo(
    () => ({
      active: orders.filter((order) => activeStatuses.includes(order.status)).length,
      submitted: orders.filter((order) => order.status === 'submitted').length,
      total: orders.length,
    }),
    [orders],
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

  const refreshOrders = useCallback(
    async (tenantId = tenant?.id) => {
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
            'channel',
            'referrer_id',
            'commission_scheme_snapshot',
            'status',
            'slip_url',
            'booking_at',
            'branch_id',
            'buyer_age',
            'admin_note',
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
    },
    [tenant?.id],
  );

  useEffect(() => {
    let isMounted = true;

    async function boot() {
      if (isDemoMode) {
        setTenant({ ...showcaseDemoTenant, role: 'demo' });
        setOrders(showcaseDemoAdminOrders);
        setSelectedId((current) => current ?? showcaseDemoAdminOrders[0]?.id ?? null);
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
        await refreshOrders(tenantContext.id);
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load order queue.');
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
  }, [auth.session, isDemoMode, loadTenantContext, refreshOrders]);

  useEffect(() => {
    if (!tenant || isDemoMode) {
      return;
    }

    const channel = supabase
      .channel(`orders-queue-${tenant.id}`)
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
    if (isDemoMode) {
      setTranscript(showcaseDemoTranscript);
      return;
    }

    if (!selectedOrder?.session_id) {
      setTranscript([]);
      return;
    }

    let isMounted = true;

    async function loadTranscript() {
      const { data, error: transcriptError } = await supabase
        .from('chat_messages')
        .select('id,role,content,created_at')
        .eq('session_id', selectedOrder.session_id)
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

  async function runAction(action: OrderMutationAction) {
    if (!selectedOrder || busyAction || !canAct(selectedOrder, action)) {
      return;
    }

    if (isDemoMode) {
      setMessage('โหมดตัวอย่าง — ปุ่มนี้ยังไม่ส่งข้อมูลจริง');
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
      setMessage(`Order moved to ${result.order.status}.`);
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
      setNote(nextNote);
      setMessage('โหมดตัวอย่าง — บันทึก note เฉพาะหน้าจอนี้');
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
      setMessage('Saved internal note.');
      await refreshOrders(result.order.tenant_id);
    } catch (noteError) {
      setError(noteError instanceof Error ? noteError.message : 'Unable to save note.');
    } finally {
      setIsSavingNote(false);
    }
  }

  async function runPdpaExport() {
    if (!selectedOrder?.customer_id || !tenant || pdpaBusyAction) {
      return;
    }

    try {
      setPdpaBusyAction('export');
      setError(null);
      setMessage(null);
      const result = await invokeFunction<PdpaRequest, PdpaExportResponse>('pdpa-export', {
        customer_id: selectedOrder.customer_id,
        tenant_id: tenant.id,
      });
      setMessage(`ส่งออกข้อมูล (PDPA) สำเร็จ: ${result.pdpa_request_id}`);
    } catch (pdpaError) {
      setError(pdpaError instanceof Error ? pdpaError.message : 'ไม่สามารถส่งออกข้อมูล PDPA ได้');
    } finally {
      setPdpaBusyAction(null);
    }
  }

  async function runPdpaDelete() {
    if (!selectedOrder?.customer_id || !tenant || pdpaBusyAction) {
      return;
    }

    if (pdpaConfirm.trim() !== 'ลบถาวร') {
      setError('พิมพ์ "ลบถาวร" เพื่อยืนยันการลบข้อมูล PDPA');
      return;
    }

    try {
      setPdpaBusyAction('delete');
      setError(null);
      setMessage(null);
      const result = await invokeFunction<PdpaRequest, PdpaDeleteResponse>('pdpa-delete', {
        customer_id: selectedOrder.customer_id,
        tenant_id: tenant.id,
      });
      setPdpaConfirm('');
      setMessage(`ลบข้อมูลถาวร (PDPA) สำเร็จ: anonymized ${result.anonymized_orders} order(s)`);
      await refreshOrders(tenant.id);
    } catch (pdpaError) {
      setError(pdpaError instanceof Error ? pdpaError.message : 'ไม่สามารถลบข้อมูล PDPA ได้');
    } finally {
      setPdpaBusyAction(null);
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={[styles.topBar, !isWide ? styles.topBarStack : null]}>
          <View style={styles.titleGroup}>
            <Text style={styles.eyebrow}>MiraCare v2 Phase 3</Text>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>
              {tenant ? `${tenant.display_name} · ${tenant.role}` : isLoading ? 'Loading tenant access' : defaultTenantSlug}
            </Text>
          </View>
          <View style={styles.topActions}>
            <Pressable disabled={isLoading} onPress={() => void refreshOrders()} style={[styles.secondaryButton, isLoading ? styles.disabled : null]}>
              <Text style={styles.secondaryButtonText}>{isLoading ? 'Refreshing' : 'Refresh'}</Text>
            </Pressable>
            <Link href="/admin/catalog" asChild>
              <Pressable style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Catalog</Text>
              </Pressable>
            </Link>
          </View>
        </View>

        {error ? <Banner tone="error" text={error} /> : null}
        {message ? <Banner tone="success" text={message} /> : null}
        {isDemoMode ? <Banner tone="success" text="โหมดตัวอย่าง: เปิดดูคิวออเดอร์ได้โดยไม่ต้องล็อกอิน และปุ่ม action จะไม่ส่งข้อมูลจริง" /> : null}

        <View style={styles.metrics}>
          <Metric label="Total" value={`${summary.total}`} />
          <Metric label="Active" value={`${summary.active}`} />
          <Metric label="Submitted" value={`${summary.submitted}`} />
        </View>

        <View style={styles.filters}>
          <TextInput
            onChangeText={setQuery}
            placeholder="Search order, buyer, phone, product, branch"
            placeholderTextColor={MiraDesign.color.muted}
            style={styles.searchInput}
            value={query}
          />
          <Pressable onPress={() => setShowActiveOnly((current) => !current)} style={[styles.filterButton, showActiveOnly ? styles.filterButtonActive : null]}>
            <Text style={[styles.filterButtonText, showActiveOnly ? styles.filterButtonTextActive : null]}>
              {showActiveOnly ? 'Active only' : 'All orders'}
            </Text>
          </Pressable>
        </View>

        <View style={[styles.workspace, !isWide ? styles.workspaceStack : null]}>
          <View style={styles.queuePane}>
            {filteredOrders.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>{isLoading ? 'Loading orders' : 'No orders found'}</Text>
                <Text style={styles.emptyBody}>Orders from chat checkout will appear here in realtime.</Text>
              </View>
            ) : (
              filteredOrders.map((order) => (
                <OrderRowCard
                  key={order.id}
                  order={order}
                  selected={selectedOrder?.id === order.id}
                  onSelect={() => {
                    const nextBooking = bangkokDateTimeParts(order.booking_at);
                    setSelectedId(order.id);
                    setBookingDate(nextBooking.date);
                    setBookingTime(nextBooking.time);
                    setNote(order.admin_note ?? '');
                  }}
                />
              ))
            )}
          </View>

          <View style={styles.detailPane}>
            {selectedOrder ? (
              <OrderDetail
                bookingDate={bookingDate}
                bookingTime={bookingTime}
                busyAction={busyAction}
                canRunPdpa={canRunPdpa}
                isSavingNote={isSavingNote}
                note={note}
                onAction={(action) => void runAction(action)}
                onBookingDateChange={setBookingDate}
                onBookingTimeChange={setBookingTime}
                onNoteChange={setNote}
                onPdpaConfirmChange={setPdpaConfirm}
                onPdpaDelete={() => void runPdpaDelete()}
                onPdpaExport={() => void runPdpaExport()}
                onSaveNote={(nextNote) => void saveNote(nextNote)}
                order={selectedOrder}
                pdpaBusyAction={pdpaBusyAction}
                pdpaConfirm={pdpaConfirm}
                signedSlipUrl={signedSlipUrls[selectedOrder.id]}
                transcript={transcript}
              />
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>Select an order</Text>
                <Text style={styles.emptyBody}>Open an order to inspect buyer details, payment state, and transcript.</Text>
              </View>
            )}
          </View>
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function OrderRowCard({ onSelect, order, selected }: { onSelect: () => void; order: OrderQueueRow; selected: boolean }) {
  const branch = fromJoin(order.branches);
  const product = fromJoin(order.products);
  const customer = fromJoin(order.customers);
  const referrer = fromJoin(order.referrers);
  const buyerName = order.buyer_name || customer?.nickname || 'Unnamed buyer';
  const phone = order.buyer_phone || customer?.phone || '-';

  return (
    <Pressable onPress={onSelect} style={[styles.orderRow, selected ? styles.orderRowSelected : null]}>
      <View style={styles.orderHead}>
        <View style={styles.orderTitleBlock}>
          <Text numberOfLines={1} style={styles.orderTitle}>
            {product?.name ?? 'Unknown product'}
          </Text>
          <Text style={styles.orderMeta}>{formatDateTime(order.created_at)}</Text>
        </View>
        <Pill label={order.status} tone={statusTone(order.status)} />
      </View>
      <View style={styles.orderMetaGrid}>
        <Meta label="Buyer" value={buyerName} />
        <Meta label="Age" value={order.buyer_age ? `${order.buyer_age}` : '-'} />
        <Meta label="Phone" value={phone} />
        <Meta label="Branch" value={branch?.name ?? 'ไม่ระบุสาขา'} />
        <Meta label="Channel" value={order.channel} />
        <Meta label="Referrer" value={referrer ? `${referrer.name} (${referrer.ref_code})` : '-'} />
        <Meta label="Amount" value={formatMoney(order.amount_baht)} />
      </View>
    </Pressable>
  );
}

function OrderDetail({
  bookingDate,
  bookingTime,
  busyAction,
  canRunPdpa,
  isSavingNote,
  note,
  onAction,
  onBookingDateChange,
  onBookingTimeChange,
  onNoteChange,
  onPdpaConfirmChange,
  onPdpaDelete,
  onPdpaExport,
  onSaveNote,
  order,
  pdpaBusyAction,
  pdpaConfirm,
  signedSlipUrl,
  transcript,
}: {
  bookingDate: string;
  bookingTime: string;
  busyAction: OrderMutationAction | null;
  canRunPdpa: boolean;
  isSavingNote: boolean;
  note: string;
  onAction: (action: OrderMutationAction) => void;
  onBookingDateChange: (value: string) => void;
  onBookingTimeChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onPdpaConfirmChange: (value: string) => void;
  onPdpaDelete: () => void;
  onPdpaExport: () => void;
  onSaveNote: (nextNote?: string) => void;
  order: OrderQueueRow;
  pdpaBusyAction: 'delete' | 'export' | null;
  pdpaConfirm: string;
  signedSlipUrl?: string;
  transcript: TranscriptRow[];
}) {
  const branch = fromJoin(order.branches);
  const product = fromJoin(order.products);
  const customer = fromJoin(order.customers);
  const referrer = fromJoin(order.referrers);
  const slipImageUrl = order.slip_url?.startsWith('http') ? order.slip_url : signedSlipUrl ?? null;

  return (
    <View style={styles.detail}>
      <View style={styles.detailHead}>
        <View style={styles.detailTitleBlock}>
          <Text style={styles.detailEyebrow}>Order {order.id.slice(0, 8)}</Text>
          <Text style={styles.detailTitle}>{product?.name ?? 'Unknown product'}</Text>
        </View>
        <Pill label={order.status} tone={statusTone(order.status)} />
      </View>

      <View style={styles.detailGrid}>
        <Meta label="Created" value={formatDateTime(order.created_at)} />
        <Meta label="Buyer" value={order.buyer_name || customer?.nickname || '-'} />
        <Meta label="Age" value={order.buyer_age ? `${order.buyer_age}` : '-'} />
        <Meta label="Phone" value={order.buyer_phone || customer?.phone || '-'} />
        <Meta label="Branch" value={branch?.name ?? 'ไม่ระบุสาขา'} />
        <Meta label="Channel" value={order.channel} />
        <Meta label="Amount" value={formatMoney(order.amount_baht)} />
        <Meta label="Referrer" value={referrer ? `${referrer.name} (${referrer.ref_code})` : '-'} />
        <Meta label="Preferred date" value={order.preferred_date ?? '-'} />
        <Meta label="Booked at" value={formatDateTime(order.booking_at)} />
      </View>

      {order.slip_url ? (
        <View style={styles.slipRow}>
          {slipImageUrl ? <Image source={{ uri: slipImageUrl }} style={styles.slipImage} /> : null}
          <View style={styles.slipCopy}>
            <Text style={styles.sectionTitle}>Slip</Text>
            <Text numberOfLines={2} style={styles.helperText}>
              {slipImageUrl ? 'Signed URL valid for 60 minutes.' : order.slip_url}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.formBlock}>
        <Text style={styles.sectionTitle}>Booking</Text>
        <View style={styles.dateTimeRow}>
          <View style={styles.dateTimeField}>
            <Text style={styles.formLabel}>Date</Text>
            <TextInput
              onChangeText={onBookingDateChange}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={MiraDesign.color.muted}
              style={styles.input}
              value={bookingDate}
            />
          </View>
          <View style={styles.dateTimeField}>
            <Text style={styles.formLabel}>Time</Text>
            <TextInput
              onChangeText={onBookingTimeChange}
              placeholder="HH:mm"
              placeholderTextColor={MiraDesign.color.muted}
              style={styles.input}
              value={bookingTime}
            />
          </View>
        </View>
        <TextInput
          multiline
          onChangeText={onNoteChange}
          placeholder="Internal note"
          placeholderTextColor={MiraDesign.color.muted}
          style={[styles.input, styles.noteInput]}
          value={note}
        />
        <View style={styles.notePresetRow}>
          {notePresets.map((preset) => (
            <Pressable
              key={preset}
              disabled={isSavingNote}
              onPress={() => {
                onNoteChange(preset);
                onSaveNote(preset);
              }}
              style={[styles.notePresetButton, isSavingNote ? styles.disabled : null]}
            >
              <Text style={styles.notePresetText}>{preset}</Text>
            </Pressable>
          ))}
          <Pressable disabled={isSavingNote} onPress={() => onSaveNote()} style={[styles.noteSaveButton, isSavingNote ? styles.disabled : null]}>
            <Text style={styles.noteSaveText}>{isSavingNote ? 'Saving' : 'Save Note'}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.actions}>
        <ActionButton action="confirm" busyAction={busyAction} disabled={!canAct(order, 'confirm')} onAction={onAction} />
        <ActionButton action="book" busyAction={busyAction} disabled={!canAct(order, 'book')} onAction={onAction} />
        <ActionButton action="done" busyAction={busyAction} disabled={!canAct(order, 'done')} onAction={onAction} />
        <ActionButton action="cancel" busyAction={busyAction} disabled={!canAct(order, 'cancel')} danger onAction={onAction} />
      </View>

      {canRunPdpa ? (
        <View style={styles.pdpaBlock}>
          <View style={styles.pdpaHeader}>
            <View style={styles.pdpaTitleBlock}>
              <Text style={styles.sectionTitle}>PDPA</Text>
              <Text style={styles.helperText}>ส่งออกหรือลบข้อมูลลูกค้าหลังยืนยันตัวตนนอกระบบแล้ว</Text>
            </View>
            <Pressable disabled={Boolean(pdpaBusyAction)} onPress={onPdpaExport} style={[styles.secondaryButton, pdpaBusyAction ? styles.disabled : null]}>
              <Text style={styles.secondaryButtonText}>{pdpaBusyAction === 'export' ? 'กำลังส่งออก' : 'ส่งออกข้อมูล (PDPA)'}</Text>
            </Pressable>
          </View>
          <View style={styles.pdpaDeleteRow}>
            <TextInput
              onChangeText={onPdpaConfirmChange}
              placeholder="พิมพ์ ลบถาวร"
              placeholderTextColor={MiraDesign.color.muted}
              style={[styles.input, styles.pdpaConfirmInput]}
              value={pdpaConfirm}
            />
            <Pressable
              disabled={Boolean(pdpaBusyAction) || pdpaConfirm.trim() !== 'ลบถาวร'}
              onPress={onPdpaDelete}
              style={[
                styles.pdpaDeleteButton,
                Boolean(pdpaBusyAction) || pdpaConfirm.trim() !== 'ลบถาวร' ? styles.disabled : null,
              ]}
            >
              <Text style={styles.pdpaDeleteText}>{pdpaBusyAction === 'delete' ? 'กำลังลบ' : 'ลบข้อมูลถาวร (PDPA)'}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.transcript}>
        <Text style={styles.sectionTitle}>Transcript</Text>
        {transcript.length === 0 ? (
          <Text style={styles.helperText}>No chat transcript attached.</Text>
        ) : (
          transcript.map((message) => (
            <View key={message.id} style={styles.transcriptItem}>
              <Text style={styles.transcriptRole}>{message.role}</Text>
              <Text style={styles.transcriptText}>{message.content}</Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

function ActionButton({
  action,
  busyAction,
  danger,
  disabled,
  onAction,
}: {
  action: OrderMutationAction;
  busyAction: OrderMutationAction | null;
  danger?: boolean;
  disabled?: boolean;
  onAction: (action: OrderMutationAction) => void;
}) {
  const isBusy = busyAction === action;

  return (
    <Pressable
      disabled={disabled || Boolean(busyAction)}
      onPress={() => onAction(action)}
      style={[styles.actionButton, danger ? styles.dangerActionButton : null, disabled || busyAction ? styles.disabled : null]}
    >
      <Text style={[styles.actionButtonText, danger ? styles.dangerActionButtonText : null]}>{isBusy ? 'Saving' : action}</Text>
    </Pressable>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaCell}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.metaValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#F5F8F7',
    flex: 1,
  },
  container: {
    gap: 16,
    padding: 22,
    paddingBottom: 54,
  },
  topBar: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 18,
    justifyContent: 'space-between',
  },
  topBarStack: {
    flexDirection: 'column',
  },
  titleGroup: {
    flex: 1,
    gap: 6,
  },
  eyebrow: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  title: {
    color: MiraDesign.color.ink,
    fontSize: 30,
    fontWeight: '900',
    lineHeight: 36,
  },
  subtitle: {
    color: MiraDesign.color.inkSoft,
    fontSize: 14,
    lineHeight: 20,
  },
  topActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.primary,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 15,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 15,
  },
  secondaryButtonText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 13,
    fontWeight: '900',
  },
  notice: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    margin: 22,
    padding: 18,
    ...softShadow,
  },
  noticeTitle: {
    color: MiraDesign.color.ink,
    fontSize: 18,
    fontWeight: '900',
  },
  noticeBody: {
    color: MiraDesign.color.inkSoft,
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
  metric: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 130,
    padding: 13,
  },
  metricLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  metricValue: {
    color: MiraDesign.color.ink,
    fontSize: 22,
    fontWeight: '900',
    marginTop: 5,
  },
  filters: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  searchInput: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    color: MiraDesign.color.ink,
    flex: 1,
    fontSize: 14,
    minHeight: 44,
    minWidth: 220,
    paddingHorizontal: 12,
  },
  filterButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  filterButtonActive: {
    backgroundColor: MiraDesign.color.primary,
    borderColor: MiraDesign.color.primary,
  },
  filterButtonText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 13,
    fontWeight: '900',
  },
  filterButtonTextActive: {
    color: '#FFFFFF',
  },
  workspace: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 16,
  },
  workspaceStack: {
    flexDirection: 'column',
  },
  queuePane: {
    flex: 1,
    gap: 10,
    minWidth: 0,
    width: '100%',
  },
  detailPane: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    flex: 0.95,
    minWidth: 360,
    padding: 16,
    width: '100%',
    ...softShadow,
  },
  orderRow: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  orderRowSelected: {
    borderColor: MiraDesign.color.primary,
    borderWidth: 2,
  },
  orderHead: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  orderTitleBlock: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  orderTitle: {
    color: MiraDesign.color.ink,
    fontSize: 16,
    fontWeight: '900',
  },
  orderMeta: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '800',
  },
  orderMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaCell: {
    backgroundColor: '#F7FBFA',
    borderColor: '#E5EFEE',
    borderRadius: 8,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 118,
    padding: 9,
  },
  metaLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  metaValue: {
    color: MiraDesign.color.ink,
    fontSize: 13,
    fontWeight: '900',
    marginTop: 4,
  },
  detail: {
    gap: 14,
  },
  detailHead: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  detailTitleBlock: {
    flex: 1,
    gap: 4,
  },
  detailEyebrow: {
    color: MiraDesign.color.primary,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  detailTitle: {
    color: MiraDesign.color.ink,
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 24,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  slipRow: {
    alignItems: 'center',
    backgroundColor: '#F7FBFA',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 10,
  },
  slipImage: {
    backgroundColor: '#EAF3F2',
    borderRadius: 8,
    height: 72,
    width: 72,
  },
  slipCopy: {
    flex: 1,
    gap: 4,
  },
  sectionTitle: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  helperText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 13,
    lineHeight: 19,
  },
  formBlock: {
    gap: 8,
  },
  dateTimeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  dateTimeField: {
    flex: 1,
    gap: 5,
  },
  formLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: '#F7FBFA',
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
  notePresetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  notePresetButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.surfaceSoft,
    borderRadius: 8,
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
  pdpaBlock: {
    backgroundColor: '#F7FBFA',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  pdpaHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
  },
  pdpaTitleBlock: {
    flex: 1,
    gap: 4,
    minWidth: 220,
  },
  pdpaDeleteRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pdpaConfirmInput: {
    flex: 1,
    minWidth: 180,
  },
  pdpaDeleteButton: {
    alignItems: 'center',
    backgroundColor: '#FFE8E8',
    borderColor: '#F7B9BA',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 12,
  },
  pdpaDeleteText: {
    color: '#A23538',
    fontSize: 12,
    fontWeight: '900',
  },
  actionButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.primary,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 38,
    minWidth: 92,
    paddingHorizontal: 12,
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
  transcript: {
    borderTopColor: MiraDesign.color.line,
    borderTopWidth: 1,
    gap: 8,
    paddingTop: 12,
  },
  transcriptItem: {
    backgroundColor: '#F7FBFA',
    borderColor: '#E5EFEE',
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 9,
  },
  transcriptRole: {
    color: MiraDesign.color.primary,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  transcriptText: {
    color: MiraDesign.color.ink,
    fontSize: 13,
    lineHeight: 19,
  },
  emptyState: {
    backgroundColor: '#FFFFFF',
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: 5,
    padding: 18,
  },
  emptyTitle: {
    color: MiraDesign.color.ink,
    fontSize: 16,
    fontWeight: '900',
  },
  emptyBody: {
    color: MiraDesign.color.inkSoft,
    fontSize: 13,
    lineHeight: 19,
  },
  disabled: {
    opacity: 0.45,
  },
});
