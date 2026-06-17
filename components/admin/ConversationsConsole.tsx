import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { AdminBadge, AdminHeader } from '@/components/admin/adminUi';
import { MiraDesign, softShadow } from '@/constants/Design';
import { invokeFunction } from '@/lib/api/client';
import { useAuthSession } from '@/lib/auth/useAuthSession';
import { showcaseDemoTranscript } from '@/lib/showcase/demoFixtures';
import { supabase, supabaseConfigStatus } from '@/lib/supabase';

type CustomerJoin = { line_user_id: string | null; nickname: string | null };

type SessionListRow = {
  agent_mode: 'ai' | 'human' | null;
  channel: string | null;
  customers: CustomerJoin | CustomerJoin[] | null;
  id: string;
  last_message_at: string | null;
};

type MessageRow = {
  content: string;
  created_at: string;
  id: string;
  role: string;
};

const CHANNEL_FILTERS = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'line', label: 'LINE' },
  { key: 'pwa', label: 'เว็บ' },
  { key: 'app', label: 'แอป' },
] as const;

type ChannelFilter = (typeof CHANNEL_FILTERS)[number]['key'];

const CHANNEL_META: Record<string, { bg: string; fg: string; label: string }> = {
  app: { bg: '#F3ECFF', fg: '#7C3AED', label: 'แอป' },
  line: { bg: '#E7F8EE', fg: '#1B8F4D', label: 'LINE' },
  pwa: { bg: '#EAF1FF', fg: '#2563EB', label: 'เว็บ' },
};

function channelMeta(channel: string | null) {
  return CHANNEL_META[channel ?? ''] ?? { bg: '#EEF2F6', fg: '#475467', label: channel ?? 'อื่นๆ' };
}

function fromJoin<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function formatTime(value: string | null) {
  if (!value) {
    return '';
  }

  return new Date(value).toLocaleString('th-TH', { day: '2-digit', hour: '2-digit', minute: '2-digit', month: 'short' });
}

function customerLabel(row: SessionListRow) {
  const customer = fromJoin(row.customers);

  return customer?.nickname?.trim() || (row.channel === 'line' ? 'ลูกค้า LINE' : 'ลูกค้า');
}

function ChannelBadge({ channel }: { channel: string | null }) {
  const meta = channelMeta(channel);

  return (
    <View style={[styles.channelBadge, { backgroundColor: meta.bg }]}>
      <Text style={[styles.channelBadgeText, { color: meta.fg }]}>{meta.label}</Text>
    </View>
  );
}

export function ConversationsConsole() {
  const { session: authSession } = useAuthSession();
  const { tour } = useLocalSearchParams<{ tour?: string }>();
  const queryClient = useQueryClient();
  const { width } = useWindowDimensions();
  const isCompact = width < 880;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');
  const [draft, setDraft] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);

  const isTourMode = tour === 'admin';
  const ready = supabaseConfigStatus.isConfigured && Boolean(authSession) && !isTourMode;
  const demoSessions = useMemo<SessionListRow[]>(
    () => [
      {
        agent_mode: 'ai',
        channel: 'line',
        customers: { line_user_id: 'demo-line-user', nickname: 'บอส' },
        id: 'demo-session',
        last_message_at: showcaseDemoTranscript[showcaseDemoTranscript.length - 1]?.created_at ?? null,
      },
    ],
    [],
  );
  const demoMessages = useMemo<MessageRow[]>(
    () =>
      showcaseDemoTranscript.map((message) => ({
        content: message.content,
        created_at: message.created_at,
        id: message.id,
        role: message.role,
      })),
    [],
  );

  const sessionsQuery = useQuery({
    enabled: ready,
    queryFn: async (): Promise<SessionListRow[]> => {
      let query = supabase
        .from('chat_sessions')
        .select('id,agent_mode,channel,last_message_at,customers(nickname,line_user_id)')
        .order('last_message_at', { ascending: false })
        .limit(100);

      if (channelFilter !== 'all') {
        query = query.eq('channel', channelFilter);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(error.message);
      }

      return (data ?? []) as SessionListRow[];
    },
    queryKey: ['console-sessions', channelFilter],
    refetchInterval: 6000,
  });

  const transcriptQuery = useQuery({
    enabled: ready && Boolean(selectedId),
    queryFn: async (): Promise<MessageRow[]> => {
      // Fetch the NEWEST 200 messages (descending), then flip to chronological order
      // for display. Ordering ascending + limit would pin the view to the oldest 200
      // and never show recent turns once a chat passes 200 messages.
      const { data, error } = await supabase
        .from('chat_messages')
        .select('id,role,content,created_at')
        .eq('session_id', selectedId)
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) {
        throw new Error(error.message);
      }

      return ((data ?? []) as MessageRow[]).reverse();
    },
    queryKey: ['console-transcript', selectedId],
    refetchInterval: 4000,
  });

  const isDemoMode = !ready || sessionsQuery.isError || transcriptQuery.isError;
  const fetchedSessions = isDemoMode
    ? demoSessions.filter((row) => channelFilter === 'all' || row.channel === channelFilter)
    : sessionsQuery.data ?? [];
  const visibleSessions = fetchedSessions;
  const activeSelectedId = isDemoMode ? selectedId ?? visibleSessions[0]?.id ?? null : selectedId;
  const visibleMessages = isDemoMode && activeSelectedId ? demoMessages : transcriptQuery.data ?? [];
  const selectedSession = useMemo(
    () => visibleSessions.find((row) => row.id === activeSelectedId) ?? null,
    [activeSelectedId, visibleSessions],
  );

  const replyMutation = useMutation({
    mutationFn: async (text: string) =>
      invokeFunction('admin-line-reply', { action: 'reply', session_id: selectedId, text }),
    onError: (error) => setErrorText(error instanceof Error ? error.message : 'ส่งไม่สำเร็จ'),
    onSuccess: () => {
      setDraft('');
      setErrorText(null);
      queryClient.invalidateQueries({ queryKey: ['console-transcript', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['console-sessions'] });
    },
  });

  const modeMutation = useMutation({
    mutationFn: async (agentMode: 'ai' | 'human') =>
      invokeFunction('admin-line-reply', { action: 'set_mode', agent_mode: agentMode, session_id: selectedId }),
    onError: (error) => setErrorText(error instanceof Error ? error.message : 'สลับโหมดไม่สำเร็จ'),
    onSuccess: () => {
      setErrorText(null);
      queryClient.invalidateQueries({ queryKey: ['console-sessions'] });
    },
  });

  const isHuman = !isDemoMode && selectedSession?.agent_mode === 'human';

  return (
    <View style={styles.page}>
      <AdminHeader
        eyebrow="หลังบ้าน / กล่องข้อความ"
        modeLabel={isDemoMode ? 'โหมดตัวอย่าง' : 'ใช้งานจริง'}
        modeTone={isDemoMode ? 'amber' : 'primary'}
        note={isDemoMode ? 'โหมดตัวอย่าง: แสดง transcript ตัวอย่างแบบอ่านอย่างเดียว' : null}
        title="กล่องข้อความ"
      />
      <View style={[styles.shell, isCompact ? styles.shellCompact : null]}>
        {/* Inbox */}
        <View style={[styles.inbox, isCompact ? styles.inboxCompact : null]}>
          <View style={styles.filterRow}>
            {CHANNEL_FILTERS.map((filter) => {
              const active = channelFilter === filter.key;

              return (
                <Pressable key={filter.key} onPress={() => setChannelFilter(filter.key)} style={[styles.filterChip, active ? styles.filterChipActive : null]}>
                  <Text style={[styles.filterChipText, active ? styles.filterChipTextActive : null]}>{filter.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {sessionsQuery.isLoading && !isDemoMode ? <ActivityIndicator color={MiraDesign.color.primary} /> : null}
          <ScrollView contentContainerStyle={styles.inboxList} showsVerticalScrollIndicator={false}>
            {visibleSessions.map((row) => {
              const active = row.id === activeSelectedId;

              return (
                <Pressable key={row.id} onPress={() => setSelectedId(row.id)} style={[styles.inboxRow, active ? styles.inboxRowActive : null]}>
                  <View style={styles.inboxRowTop}>
                    <Text numberOfLines={1} style={styles.inboxName}>
                      {customerLabel(row)}
                    </Text>
                    <AdminBadge label={row.agent_mode === 'human' ? 'คนดูแล' : 'AI'} tone={row.agent_mode === 'human' ? 'amber' : 'blue'} />
                  </View>
                  <View style={styles.inboxRowBottom}>
                    <ChannelBadge channel={row.channel} />
                    <Text style={styles.inboxTime}>{formatTime(row.last_message_at)}</Text>
                  </View>
                </Pressable>
              );
            })}
            {visibleSessions.length === 0 ? <Text style={styles.muted}>ยังไม่มีแชต</Text> : null}
          </ScrollView>
        </View>

        {/* Thread */}
        <View style={styles.thread}>
        {!selectedSession ? (
          <View style={styles.center}>
            <Text style={styles.muted}>เลือกห้องแชตทางซ้ายเพื่อดูบทสนทนา</Text>
          </View>
        ) : (
          <>
            <View style={styles.threadHeader}>
              <View style={styles.threadTitleWrap}>
                <Text style={styles.threadTitle}>{customerLabel(selectedSession)}</Text>
                <ChannelBadge channel={selectedSession.channel} />
              </View>
              <Pressable
                disabled={isDemoMode || modeMutation.isPending}
                onPress={() => modeMutation.mutate(isHuman ? 'ai' : 'human')}
                style={[styles.modeBtn, isHuman ? styles.modeBtnReturn : styles.modeBtnTakeover]}
              >
                <Text style={styles.modeBtnText}>{isHuman ? 'คืนให้ AI' : 'เข้าดูแลเอง'}</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.messages}>
              {visibleMessages.map((message) => {
                const fromCustomer = message.role === 'user';

                return (
                  <View
                    key={message.id}
                    style={[styles.bubbleRow, fromCustomer ? styles.bubbleRowLeft : styles.bubbleRowRight]}
                  >
                    <View style={[styles.bubble, fromCustomer ? styles.bubbleCustomer : styles.bubbleAgent]}>
                      <Text style={fromCustomer ? styles.bubbleTextCustomer : styles.bubbleTextAgent}>{message.content}</Text>
                      <Text style={styles.bubbleMeta}>{formatTime(message.created_at)}</Text>
                    </View>
                  </View>
                );
              })}
              {visibleMessages.length === 0 ? <Text style={styles.muted}>ยังไม่มีข้อความ</Text> : null}
            </ScrollView>

            {errorText ? <Text style={styles.error}>{errorText}</Text> : null}

            <View style={styles.composer}>
              <TextInput
                editable={isHuman && !replyMutation.isPending}
                multiline
                onChangeText={setDraft}
                placeholder={isHuman ? 'พิมพ์ข้อความตอบลูกค้า…' : 'กด “เข้าดูแลเอง” ก่อนเพื่อพิมพ์ตอบ'}
                placeholderTextColor={MiraDesign.color.showcaseNavySoft}
                style={styles.input}
                value={draft}
              />
              <Pressable
                disabled={isDemoMode || !isHuman || !draft.trim() || replyMutation.isPending}
                onPress={() => replyMutation.mutate(draft.trim())}
                style={[styles.sendBtn, !isHuman || !draft.trim() ? styles.sendBtnDisabled : null]}
              >
                <Text style={styles.sendBtnText}>{replyMutation.isPending ? '...' : 'ส่ง'}</Text>
              </Pressable>
            </View>
          </>
        )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: MiraDesign.color.canvas, flex: 1, gap: 12, padding: 16 },
  shell: { flex: 1, flexDirection: 'row', gap: 12, minHeight: 0 },
  shellCompact: { flexDirection: 'column' },
  inbox: { backgroundColor: MiraDesign.color.surface, borderColor: MiraDesign.color.line, borderRadius: 8, borderWidth: 1, gap: 10, padding: 12, width: 288 },
  inboxCompact: { maxHeight: 280, width: '100%' },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  filterChip: { backgroundColor: MiraDesign.color.surfaceSoft, borderRadius: 999, cursor: 'pointer', paddingHorizontal: 12, paddingVertical: 6 },
  filterChipActive: { backgroundColor: MiraDesign.color.primary },
  filterChipText: { color: MiraDesign.color.inkSoft, fontSize: 12, fontWeight: '800' },
  filterChipTextActive: { color: '#FFFFFF' },
  inboxList: { gap: 8 },
  inboxRow: { borderColor: MiraDesign.color.line, borderRadius: 8, borderWidth: 1, cursor: 'pointer', gap: 6, padding: 10 },
  inboxRowActive: { backgroundColor: MiraDesign.color.surfaceSoft, borderColor: MiraDesign.color.primary },
  inboxRowTop: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  inboxRowBottom: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  inboxName: { color: MiraDesign.color.ink, flexShrink: 1, fontSize: 14, fontWeight: '800' },
  inboxTime: { color: MiraDesign.color.inkSoft, fontSize: 12 },
  channelBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  channelBadgeText: { fontSize: 11, fontWeight: '800' },
  thread: { backgroundColor: MiraDesign.color.surface, borderColor: MiraDesign.color.line, borderRadius: 8, borderWidth: 1, flex: 1, minWidth: 0, overflow: 'hidden' },
  threadHeader: { alignItems: 'center', borderBottomColor: MiraDesign.color.line, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: 12 },
  threadTitleWrap: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  threadTitle: { color: MiraDesign.color.ink, fontSize: 16, fontWeight: '900' },
  modeBtn: { borderRadius: 8, cursor: 'pointer', paddingHorizontal: 14, paddingVertical: 9 },
  modeBtnTakeover: { backgroundColor: MiraDesign.color.primary },
  modeBtnReturn: { backgroundColor: MiraDesign.color.inkSoft },
  modeBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  messages: { gap: 8, padding: 14 },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowLeft: { justifyContent: 'flex-start' },
  bubbleRowRight: { justifyContent: 'flex-end' },
  bubble: { borderRadius: 14, gap: 4, maxWidth: '78%', padding: 10 },
  bubbleCustomer: { backgroundColor: MiraDesign.color.surfaceSoft },
  bubbleAgent: { backgroundColor: MiraDesign.color.primary },
  bubbleTextCustomer: { color: MiraDesign.color.ink, fontSize: 14 },
  bubbleTextAgent: { color: '#FFFFFF', fontSize: 14 },
  bubbleMeta: { color: MiraDesign.color.inkSoft, fontSize: 10 },
  composer: { alignItems: 'flex-end', borderTopColor: MiraDesign.color.line, borderTopWidth: 1, flexDirection: 'row', gap: 8, padding: 12 },
  input: { backgroundColor: '#FBFDFE', borderColor: MiraDesign.color.line, borderRadius: 8, borderWidth: 1, color: MiraDesign.color.ink, flex: 1, maxHeight: 120, minHeight: 44, padding: 10 },
  sendBtn: { backgroundColor: MiraDesign.color.primary, borderRadius: 8, cursor: 'pointer', paddingHorizontal: 20, paddingVertical: 12 },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  center: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  muted: { color: MiraDesign.color.inkSoft, fontSize: 13 },
  error: { color: MiraDesign.color.danger, fontSize: 12, paddingHorizontal: 14 },
});
