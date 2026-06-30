import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, {
  Circle,
  Defs,
  LinearGradient as SvgLinearGradient,
  Path,
  RadialGradient as SvgRadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import type { ChatMessage } from '@/lib/ai/miraChat';
import type { ChatProductCard, ChatUiCard } from '@/lib/ai/healthChatTypes';
import type { OrderPanelState, StripePromptPayQrResponse } from '@/lib/types/api';
import { miraChatStyles as styles, miraChatTokens } from './miraChatRedesign.styles';

const miraCareLogo = require('@/assets/images/mira-care-logo.png');
const miraCareMark = require('@/assets/images/mira-care-mark.png');

export type MiraChatMessage = ChatMessage & {
  order?: OrderPanelState;
  uiCards?: ChatUiCard[];
};

export type MiraOrderInfoFormSubmit = {
  buyerAge: number;
  buyerName: string;
  buyerPhone: string;
  orderId: string;
  preferredDate?: string;
  preferredDateEnd?: string;
  preferredTimeWindow?: string;
};

type MiraChatShellProps = {
  authLabel: string;
  brandName?: string | null;
  canUseLiveAi: boolean;
  greetingText?: string | null;
  input: string;
  isAuthLoading: boolean;
  isAuthenticated: boolean;
  isSending: boolean;
  messages: MiraChatMessage[];
  onAuthPress: () => void;
  onBackPress: () => void;
  onBrowseCategory: (category: string, label: string) => void;
  onQuickReply: (text: string) => void;
  onSelectBranch: (productId: string, branchId: string) => void;
  onSelectProduct: (productId: string, productTitle: string) => void;
  onSendMessage: () => void;
  onSetInput: (value: string) => void;
  onStripePromptPayQr: (orderId: string) => Promise<StripePromptPayQrResponse>;
  onStripePromptPayStatus: (orderId: string) => Promise<StripePromptPayQrResponse>;
  onSubmitOrderInfo: (payload: MiraOrderInfoFormSubmit) => Promise<void>;
  onVoicePress: () => void;
  voiceStatus: string | null;
};

type PreferredDateOption = {
  dayNumber: string;
  key: string;
  monthLabel: string;
  shortLabel: string;
  weekdayLabel: string;
};

type PreferredTimeSlot = {
  detail: string;
  key: 'morning' | 'afternoon';
  label: string;
};

const preferredDateWeekdays = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];
const preferredDateMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const preferredDateMonthTitles = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];
const preferredTimeSlots: PreferredTimeSlot[] = [
  { detail: '09:00 - 12:00', key: 'morning', label: 'ช่วงเช้า' },
  { detail: '13:00 - 17:00', key: 'afternoon', label: 'ช่วงบ่าย' },
];

const quickReplyLabels = ['ตรวจสุขภาพ', 'ให้พ่อแม่', 'เปรียบเทียบ', 'จองคิว'];

function useReduceMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) {
          setReducedMotion(enabled);
        }
      })
      .catch(() => undefined);

    const subscription = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReducedMotion);

    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  return reducedMotion;
}

function useEntranceMotion(index = 0) {
  const reducedMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  const translate = useRef(new Animated.Value(reducedMotion ? 0 : 12)).current;

  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(1);
      translate.setValue(0);
      return undefined;
    }

    const animation = Animated.parallel([
      Animated.timing(opacity, {
        delay: Math.min(index * 45, 220),
        duration: 260,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.spring(translate, {
        delay: Math.min(index * 45, 220),
        friction: 8,
        tension: 120,
        toValue: 0,
        useNativeDriver: true,
      }),
    ]);

    animation.start();
    return () => animation.stop();
  }, [index, opacity, reducedMotion, translate]);

  return { opacity, transform: [{ translateY: translate }] };
}

function preferredDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addPreferredDateDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addPreferredMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function createPreferredDateOption(date: Date): PreferredDateOption {
  const dayNumber = `${date.getDate()}`;
  const monthLabel = preferredDateMonths[date.getMonth()] ?? '';

  return {
    dayNumber,
    key: preferredDateKey(date),
    monthLabel,
    shortLabel: `${dayNumber} ${monthLabel}`,
    weekdayLabel: preferredDateWeekdays[(date.getDay() + 6) % 7] ?? '',
  };
}

function preferredDateOptionFromKey(key: string) {
  const [year, month, day] = key.split('-').map((part) => Number.parseInt(part, 10));

  if (!year || !month || !day) {
    return undefined;
  }

  return createPreferredDateOption(new Date(year, month - 1, day));
}

function createPreferredDateOptions(monthDate: Date) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const leadingBlanks = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<PreferredDateOption | null> = Array.from({ length: leadingBlanks }, () => null);

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(createPreferredDateOption(new Date(year, month, day)));
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

function preferredMonthTitle(date: Date) {
  return `${preferredDateMonthTitles[date.getMonth()] ?? ''} ${date.getFullYear()}`;
}

function formatPreferredDateRange(start: PreferredDateOption | undefined, end: PreferredDateOption | undefined, timeSlot: PreferredTimeSlot | undefined) {
  if (!start || !end) {
    return '';
  }

  return `${start.shortLabel} - ${end.shortLabel} · ${timeSlot?.label ?? ''} ${timeSlot?.detail ?? ''}`.trim();
}

function formatMoney(amount: number | null | undefined) {
  if (typeof amount !== 'number' || Number.isNaN(amount)) {
    return '';
  }

  return `${amount.toLocaleString('th-TH')} บาท`;
}

function formatMessageTime(value?: string | null) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

function orderStepLabel(step: NonNullable<OrderPanelState>['step']) {
  if (step === 'branch') {
    return 'เลือกสาขา';
  }

  if (step === 'form') {
    return 'กรอกข้อมูล';
  }

  if (step === 'qr') {
    return 'ชำระเงิน';
  }

  if (step === 'tracking') {
    return 'ติดตามคิว';
  }

  return 'ยกเลิก';
}

function orderHint(order: NonNullable<OrderPanelState>) {
  if (order.step === 'branch') {
    return order.branches?.length ? 'เลือกสาขาที่สะดวกจากรายการที่ระบบเตรียมไว้ให้ค่ะ' : 'รอเจ้าหน้าที่ช่วยยืนยันสาขาที่เหมาะสมค่ะ';
  }

  if (order.step === 'form') {
    return 'กรอกข้อมูลผู้จองและช่วงเวลาที่สะดวกเพื่อไปขั้นตอนออก QR ค่ะ';
  }

  if (order.step === 'qr') {
    return 'สแกน QR ที่ผูกกับรายการนี้ แล้วกดตรวจสอบสถานะเมื่อชำระเสร็จค่ะ';
  }

  if (order.step === 'tracking') {
    return order.booking_at ? `ลงคิวแล้ว ${new Date(order.booking_at).toLocaleString('th-TH')}` : 'รายการส่งให้ทีมโรงพยาบาลตรวจสอบและยืนยันคิวค่ะ';
  }

  return 'รายการนี้ถูกยกเลิกแล้วค่ะ';
}

function orderStatusText(status: Extract<ChatUiCard, { type: 'order_status' }>['orders'][number]['status']) {
  if (status === 'submitted') {
    return 'รอตรวจสอบ';
  }

  if (status === 'confirmed') {
    return 'รอนัดหมาย';
  }

  if (status === 'booked') {
    return 'ลงคิวแล้ว';
  }

  if (status === 'done') {
    return 'ใช้บริการแล้ว';
  }

  if (status === 'cancelled') {
    return 'ยกเลิกแล้ว';
  }

  return 'กำลังดำเนินการ';
}

function BackIcon({ color = miraChatTokens.color.primary }: { color?: string }) {
  return (
    <Svg height={21} viewBox="0 0 24 24" width={21}>
      <Path d="M14.8 5.3 8.1 12l6.7 6.7" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} />
    </Svg>
  );
}

function MicIcon({ color = miraChatTokens.color.textSoft }: { color?: string }) {
  return (
    <Svg height={21} viewBox="0 0 24 24" width={21}>
      <Rect fill="none" height={10.5} rx={4} stroke={color} strokeWidth={1.8} width={7} x={8.5} y={3.2} />
      <Path d="M5.7 11.2c.35 4 2.76 6.38 6.3 6.38s5.95-2.38 6.3-6.38M12 17.58v3.05M8.8 20.63h6.4" fill="none" stroke={color} strokeLinecap="round" strokeWidth={1.8} />
    </Svg>
  );
}

function SendIcon() {
  return (
    <Svg height={21} viewBox="0 0 24 24" width={21}>
      <Path d="M4.2 11.6 19.4 4.7c.58-.26 1.18.34.92.92L13.4 20.8c-.25.56-1.05.52-1.24-.07l-1.78-5.46-5.46-1.78c-.59-.19-.63-.99-.07-1.24Z" fill="#FFFFFF" />
      <Path d="m10.58 15.06 4.12-4.12" fill="none" stroke="rgba(255,255,255,0.82)" strokeLinecap="round" strokeWidth={1.6} />
    </Svg>
  );
}

function CheckIcon({ color = miraChatTokens.color.mint }: { color?: string }) {
  return (
    <Svg height={16} viewBox="0 0 20 20" width={16}>
      <Path d="m4.2 10.3 3.42 3.42L15.8 5.7" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} />
    </Svg>
  );
}

function ShieldIcon({ color = miraChatTokens.color.primary2 }: { color?: string }) {
  return (
    <Svg height={18} viewBox="0 0 24 24" width={18}>
      <Path d="M12 3.2 18.2 5v5.2c0 4.2-2.42 7.6-6.2 9.55-3.78-1.95-6.2-5.35-6.2-9.55V5L12 3.2Z" fill="none" stroke={color} strokeLinejoin="round" strokeWidth={1.9} />
      <Path d="m8.8 11.7 2 2 4.4-4.7" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} />
    </Svg>
  );
}

function DataIcon({ color = miraChatTokens.color.primary2 }: { color?: string }) {
  return (
    <Svg height={18} viewBox="0 0 24 24" width={18}>
      <Path d="M5 7.5c0-2 3.13-3.6 7-3.6s7 1.6 7 3.6-3.13 3.6-7 3.6-7-1.6-7-3.6Z" fill="none" stroke={color} strokeWidth={1.8} />
      <Path d="M5 7.5v4.5c0 2 3.13 3.6 7 3.6s7-1.6 7-3.6V7.5M5 12v4.5c0 2 3.13 3.6 7 3.6s7-1.6 7-3.6V12" fill="none" stroke={color} strokeWidth={1.8} />
    </Svg>
  );
}

function AgentIcon({ color = miraChatTokens.color.primary2 }: { color?: string }) {
  return (
    <Svg height={18} viewBox="0 0 24 24" width={18}>
      <Circle cx={8.4} cy={9.2} fill="none" r={3.2} stroke={color} strokeWidth={1.8} />
      <Circle cx={16.2} cy={8.2} fill="none" r={2.7} stroke={color} strokeWidth={1.7} />
      <Path d="M3.8 19c.7-3.2 2.52-4.8 5.46-4.8 2.84 0 4.62 1.5 5.34 4.5M13.5 14.2c2.95.1 4.78 1.55 5.48 4.35" fill="none" stroke={color} strokeLinecap="round" strokeWidth={1.8} />
    </Svg>
  );
}

function MedicalIcon({ color = miraChatTokens.color.primary2 }: { color?: string }) {
  return (
    <Svg height={24} viewBox="0 0 24 24" width={24}>
      <Path d="M12 4.5v15M4.5 12h15" fill="none" stroke={color} strokeLinecap="round" strokeWidth={2.4} />
      <Circle cx={12} cy={12} fill="none" r={8.2} stroke={color} strokeOpacity={0.24} strokeWidth={1.7} />
    </Svg>
  );
}

function SparkIcon() {
  return (
    <Svg height={16} viewBox="0 0 20 20" width={16}>
      <Path d="M11.4 2.8 12.8 7l4.2 1.6-4.2 1.6-1.4 4.2-1.6-4.2L5.8 8.6 9.8 7l1.6-4.2Z" fill={miraChatTokens.color.cyan} />
      <Path d="M5.2 12.4 6 14.5l2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8.8-2.1Z" fill={miraChatTokens.color.primary3} />
    </Svg>
  );
}

function BackgroundSheen() {
  return (
    <Svg height="100%" pointerEvents="none" style={styles.sheenLayer} viewBox="0 0 390 760" width="100%">
      <Defs>
        <SvgLinearGradient id="miraTopSheen" x1="0" x2="1" y1="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.72} />
          <Stop offset="0.55" stopColor="#E5EEFF" stopOpacity={0.28} />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
        </SvgLinearGradient>
        <SvgLinearGradient id="miraCyanSheen" x1="1" x2="0" y1="0" y2="1">
          <Stop offset="0" stopColor="#DDF7FF" stopOpacity={0.48} />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
        </SvgLinearGradient>
        <SvgLinearGradient id="miraLavenderSheen" x1="0" x2="1" y1="1" y2="0">
          <Stop offset="0" stopColor="#F0E8FF" stopOpacity={0.62} />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
        </SvgLinearGradient>
      </Defs>
      <Path d="M-42 98C36 18 125 30 199 4c62-22 116-9 228 28v166C278 159 146 168-42 262Z" fill="url(#miraTopSheen)" />
      <Path d="M16 266c80-42 154-38 226-80 51-30 103-34 173-1v174c-125-41-219-19-399 43Z" fill="url(#miraCyanSheen)" />
      <Path d="M-46 620c106-70 201-44 276-103 52-40 101-48 187-20v282H-46Z" fill="url(#miraLavenderSheen)" />
    </Svg>
  );
}

export function MiraOrb({ size = 52 }: { size?: number }) {
  return (
    <View style={[styles.orbFrame, { height: size + 6, width: size + 6 }]}>
      <Animated.View style={[styles.orbGlow, { height: size + 6, width: size + 6 }]} />
      <Svg height={size} style={styles.orbSvg} viewBox="0 0 56 56" width={size}>
        <Defs>
          <SvgRadialGradient cx="70%" cy="35%" id="miraOrbGradient" r="72%">
            <Stop offset="0" stopColor="#FFFFFF" />
            <Stop offset="0.12" stopColor="#BFEFFF" />
            <Stop offset="0.36" stopColor="#6C7CFF" />
            <Stop offset="0.68" stopColor="#3239D7" />
            <Stop offset="1" stopColor="#1E228F" />
          </SvgRadialGradient>
        </Defs>
        <Circle cx={28} cy={28} fill="url(#miraOrbGradient)" r={27} />
        <Circle cx={20} cy={18} fill="#FFFFFF" opacity={0.28} r={7} />
        <Path d="M16 32c7.4 7.7 18.3 7.4 25.5-1" fill="none" stroke="#FFFFFF" strokeLinecap="round" strokeOpacity={0.42} strokeWidth={2.4} />
      </Svg>
    </View>
  );
}

function MiraAssistantAvatar() {
  return (
    <View style={styles.assistantAvatar}>
      <Image accessibilityIgnoresInvertColors resizeMode="contain" source={miraCareMark} style={styles.assistantLogoMark} />
    </View>
  );
}

function MiraButton({
  children,
  disabled,
  label,
  onPress,
}: {
  children?: ReactNode;
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" disabled={disabled} onPress={onPress}>
      {({ pressed }) => (
        <LinearGradient
          colors={['#2837D8', '#4C6FFF', '#7C8CFF']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.primaryButton, disabled ? styles.primaryButtonDisabled : null, pressed && !disabled ? styles.primaryButtonPressed : null]}
        >
          {children ?? <Text style={styles.primaryButtonText}>{label}</Text>}
        </LinearGradient>
      )}
    </Pressable>
  );
}

function MiraChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress}>
      {({ pressed }) => (
        <View style={[styles.chip, pressed ? styles.chipPressed : null]}>
          <Text style={styles.chipText}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

function MiraStatusPill({
  children,
  tone = 'blue',
}: {
  children: ReactNode;
  tone?: 'blue' | 'mint' | 'warning';
}) {
  return (
    <View style={[styles.statusPill, tone === 'mint' ? styles.statusPillMint : tone === 'warning' ? styles.statusPillWarning : null]}>
      <Text style={[styles.statusPillText, tone === 'mint' ? styles.statusPillMintText : null]}>{children}</Text>
    </View>
  );
}

function MiraChatHeader({
  authLabel,
  canUseLiveAi,
  isAuthLoading,
  isAuthenticated,
  onAuthPress,
  onBackPress,
}: Pick<MiraChatShellProps, 'authLabel' | 'canUseLiveAi' | 'isAuthLoading' | 'isAuthenticated' | 'onAuthPress' | 'onBackPress'>) {
  return (
    <View style={styles.header}>
      <Pressable accessibilityLabel="กลับไปหน้า Showcase" accessibilityRole="button" onPress={onBackPress}>
        {({ pressed }) => (
          <View style={[styles.glassCircleButton, pressed ? styles.glassCircleButtonPressed : null]}>
            <BackIcon />
          </View>
        )}
      </Pressable>

      <View style={styles.headerCenter}>
        <Image accessibilityIgnoresInvertColors resizeMode="contain" source={miraCareLogo} style={styles.headerLogoImage} />
        <View style={[styles.headerStatusDot, canUseLiveAi ? null : styles.headerStatusDotMuted]} />
      </View>

      <Pressable accessibilityLabel={isAuthenticated ? 'ออกจากระบบ Mira AI Chat' : 'เข้าสู่ระบบ Mira AI Chat'} accessibilityRole="button" onPress={onAuthPress}>
        {({ pressed }) => (
          <View style={[styles.authPill, isAuthenticated ? styles.authPillLive : null, pressed ? styles.authPillPressed : null]}>
            <Text style={styles.authPillText}>{authLabel}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

function MiraBrandContext({ brandName }: { brandName?: string | null }) {
  const displayName = brandName?.trim() ? `MiraCare by ${brandName.trim()}` : 'MiraCare';

  return (
    <View style={styles.brandPanel}>
      <Text style={styles.brandEyebrow}>{displayName}</Text>
      <View style={styles.brandTitleRow}>
        <Text style={styles.brandTitle}>Smart healthcare concierge</Text>
        <View style={styles.smartBadge}>
          <SparkIcon />
          <Text style={styles.smartBadgeText}>Live care</Text>
        </View>
      </View>
    </View>
  );
}

function MiraTrustRow() {
  const trustItems = [
    { icon: <DataIcon />, label: 'ข้อมูลอัปเดตล่าสุด' },
    { icon: <ShieldIcon />, label: 'เชื่อมกับข้อมูลจริง' },
    { icon: <AgentIcon />, label: 'ส่งต่อเจ้าหน้าที่ได้' },
  ];

  return (
    <View style={styles.trustRow}>
      {trustItems.map((item) => (
        <View key={item.label} style={styles.trustItem}>
          <View style={styles.trustIcon}>{item.icon}</View>
          <Text style={styles.trustText}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

function MiraGreetingCard({ greetingText }: { greetingText?: string | null }) {
  const text =
    greetingText?.trim() ||
    'อยากตรวจสุขภาพเรื่องไหนคะ';

  return (
    <BlurView intensity={28} tint="light" style={styles.greetingCard}>
      <View style={styles.greetingHeader}>
        <Image accessibilityIgnoresInvertColors resizeMode="contain" source={miraCareLogo} style={styles.greetingLogoImage} />
        <Text numberOfLines={2} style={styles.greetingText}>{text}</Text>
      </View>
    </BlurView>
  );
}

function MiraQuickReplies({ disabled, onQuickReply }: { disabled?: boolean; onQuickReply: (text: string) => void }) {
  return (
    <View style={styles.quickReplies}>
      {quickReplyLabels.map((label) => (
        <MiraChip key={label} label={label} onPress={() => !disabled && onQuickReply(label)} />
      ))}
    </View>
  );
}

function orderProgressIndex(order: NonNullable<OrderPanelState>) {
  if (order.step === 'branch' || order.step === 'form') {
    return 1;
  }

  if (order.step === 'qr') {
    return 3;
  }

  if (order.step === 'tracking') {
    return 4;
  }

  return 0;
}

function MiraFlowProgress({ order }: { order: OrderPanelState }) {
  if (!order) {
    return null;
  }

  const activeIndex = orderProgressIndex(order);
  const steps = ['เข้าใจความต้องการ', 'แนะนำแพ็กเกจ', 'จองคิว', 'ชำระเงิน'];

  return (
    <View style={styles.flowProgress}>
      <Text style={styles.flowProgressTitle}>ขั้นตอนของรายการนี้</Text>
      <View style={styles.flowSteps}>
        {steps.map((step, index) => {
          const isActive = index + 1 <= activeIndex;

          return (
            <View key={step} style={styles.flowStep}>
              <View style={[styles.flowStepDot, isActive ? styles.flowStepDotActive : null]}>
                {isActive ? <CheckIcon color={miraChatTokens.color.primary2} /> : <Text style={styles.flowStepLabel}>{index + 1}</Text>}
              </View>
              <Text style={[styles.flowStepLabel, isActive ? styles.flowStepLabelActive : null]}>{step}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function ProductPreview({ product }: { product: ChatProductCard }) {
  if (product.productImagePreviewUri) {
    return <Image source={{ uri: product.productImagePreviewUri }} resizeMode="cover" style={styles.packageImage} />;
  }

  return <MedicalIcon />;
}

function MiraPackageCard({
  isRecommended,
  onSelectProduct,
  product,
}: {
  isRecommended: boolean;
  onSelectProduct: (productId: string, productTitle: string) => void;
  product: ChatProductCard;
}) {
  const tags = product.tags.filter(Boolean).slice(0, 2);
  const includes = product.includes.filter(Boolean).slice(0, 3);
  const price = formatMoney(product.priceAmount);
  const metaParts = [product.duration, product.hospitalName].filter((item): item is string => Boolean(item));

  return (
    <View style={[styles.packageCard, isRecommended ? styles.packageCardRecommended : null]}>
      <View style={styles.packageHero}>
        <View style={styles.packageMedia}>
          <ProductPreview product={product} />
        </View>
        <View style={styles.packageCopy}>
          <View style={styles.packageBadges}>
            {isRecommended ? (
              <View style={[styles.badge, styles.badgeMint]}>
                <Text style={[styles.badgeText, styles.badgeMintText]}>Mira แนะนำ</Text>
              </View>
            ) : null}
            {tags.map((tag) => (
              <View key={tag} style={styles.badge}>
                <Text style={styles.badgeText}>{tag}</Text>
              </View>
            ))}
          </View>
          <Text numberOfLines={2} style={styles.packageTitle}>
            {product.title}
          </Text>
          {product.description ? (
            <Text numberOfLines={3} style={styles.packageDescription}>
              {product.reason || product.description}
            </Text>
          ) : null}
        </View>
      </View>

      {includes.length ? (
        <View style={styles.packageIncludes}>
          {includes.map((item) => (
            <View key={item} style={styles.includeRow}>
              <View style={styles.includeDot} />
              <Text numberOfLines={1} style={styles.includeText}>
                {item}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.packageFooter}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {price ? <Text style={styles.packagePrice}>{price}</Text> : null}
          {metaParts.length ? (
            <Text numberOfLines={1} style={styles.packageMeta}>
              {metaParts.join(' · ')}
            </Text>
          ) : null}
        </View>
        <MiraButton label="จองคิว" onPress={() => onSelectProduct(product.id, product.title)} />
      </View>
    </View>
  );
}

function MiraPackageGrid({
  card,
  onSelectProduct,
}: {
  card: Extract<ChatUiCard, { type: 'product_grid' }>;
  onSelectProduct: (productId: string, productTitle: string) => void;
}) {
  if (card.products.length === 0) {
    return <MiraEmptyState body="ยังไม่มีแพ็กเกจที่พร้อมแสดงในตอนนี้ค่ะ" title="ไม่มีรายการแพ็กเกจ" />;
  }

  return (
    <View style={styles.commerceCard}>
      <View style={styles.commerceHeader}>
        <Text style={styles.commerceEyebrow}>แพ็กเกจที่เกี่ยวข้อง</Text>
        <Text style={styles.commerceTitle}>{card.title}</Text>
      </View>
      <View style={styles.packageGrid}>
        {card.products.map((product, index) => (
          <MiraPackageCard key={product.id} isRecommended={index === 0} onSelectProduct={onSelectProduct} product={product} />
        ))}
      </View>
    </View>
  );
}

function MiraCategoryGrid({
  card,
  onBrowseCategory,
}: {
  card: Extract<ChatUiCard, { type: 'category_grid' }>;
  onBrowseCategory: (category: string, label: string) => void;
}) {
  return (
    <View style={styles.commerceCard}>
      <View style={styles.commerceHeader}>
        <Text style={styles.commerceEyebrow}>เลือกหมวดบริการ</Text>
        <Text style={styles.commerceTitle}>{card.title}</Text>
      </View>
      <View style={styles.categoryGrid}>
        {card.categories.slice(0, 4).map((category) => (
          <Pressable
            accessibilityLabel={`ดูหมวด ${category.label_th}`}
            accessibilityRole="button"
            key={category.key}
            onPress={() => onBrowseCategory(category.key, category.label_th)}
            style={styles.categoryPressable}
          >
            {({ pressed }) => (
              <View style={[styles.categoryCard, pressed ? styles.categoryCardPressed : null]}>
                <View style={styles.categoryIconCircle}>
                  <MedicalIcon color={miraChatTokens.color.primary2} />
                </View>
                <Text numberOfLines={2} style={styles.categoryTitle}>
                  {category.label_th}
                </Text>
                <Text style={styles.categoryMeta}>{category.product_count.toLocaleString('th-TH')} รายการ</Text>
              </View>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function MiraBranchLocationCard({
  card,
  onSelectBranch,
}: {
  card: Extract<ChatUiCard, { type: 'branch_location' }>;
  onSelectBranch: (productId: string, branchId: string) => void;
}) {
  return (
    <View style={styles.commerceCard}>
      <View style={styles.commerceHeader}>
        <Text style={styles.commerceEyebrow}>สาขาที่รองรับ</Text>
        <Text style={styles.commerceTitle}>{card.product.title}</Text>
      </View>

      <View style={styles.branchCard}>
        {card.branches.map((branch, index) => (
          <Pressable
            accessibilityLabel={`เลือกสาขา ${branch.name}`}
            accessibilityRole="button"
            key={branch.id}
            onPress={() => onSelectBranch(card.product.id, branch.id)}
          >
            {({ pressed }) => (
              <View style={[styles.branchRow, pressed ? styles.categoryCardPressed : null]}>
                <View style={styles.branchNumber}>
                  <Text style={styles.branchNumberText}>{index + 1}</Text>
                </View>
                <View style={styles.branchCopy}>
                  <Text numberOfLines={1} style={styles.branchName}>
                    {branch.name}
                  </Text>
                  <Text numberOfLines={1} style={styles.branchMeta}>
                    {[branch.address ?? branch.distanceLabel, branch.nextSlot].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Text style={styles.branchAction}>เลือก</Text>
              </View>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function MiraCheckoutDraftCard({ card }: { card: Extract<ChatUiCard, { type: 'checkout_draft' }> }) {
  return (
    <View style={styles.commerceCard}>
      <View style={styles.commerceHeader}>
        <Text style={styles.commerceEyebrow}>ร่างรายการจอง</Text>
        <Text style={styles.commerceTitle}>{card.product.title}</Text>
      </View>
      <View style={styles.orderStatusRow}>
        <View style={styles.orderCopy}>
          <Text style={styles.orderTitle}>{card.branch?.name ?? card.product.hospitalName}</Text>
          <Text style={styles.orderMeta}>{formatMoney(card.product.priceAmount)}</Text>
        </View>
        <MiraStatusPill tone="mint">พร้อมต่อ</MiraStatusPill>
      </View>
    </View>
  );
}

function MiraOrderStatusCard({ card }: { card: Extract<ChatUiCard, { type: 'order_status' }> }) {
  return (
    <View style={styles.commerceCard}>
      <View style={styles.commerceHeader}>
        <Text style={styles.commerceEyebrow}>สถานะคำสั่งซื้อ</Text>
        <Text style={styles.commerceTitle}>{card.title}</Text>
      </View>
      {card.orders.length === 0 ? (
        <MiraEmptyState body="ยังไม่มีคำสั่งซื้อที่ต้องติดตามค่ะ" title="ยังไม่มีรายการ" />
      ) : (
        card.orders.slice(0, 3).map((order) => (
          <View key={order.id} style={styles.orderStatusRow}>
            <View style={styles.orderCopy}>
              <Text numberOfLines={2} style={styles.orderTitle}>
                {order.product_name}
              </Text>
              <Text numberOfLines={1} style={styles.orderMeta}>
                {[order.branch_name ?? 'ไม่ระบุสาขา', formatMoney(order.amount_baht)].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <MiraStatusPill tone={order.status === 'booked' || order.status === 'done' ? 'mint' : 'blue'}>{orderStatusText(order.status)}</MiraStatusPill>
          </View>
        ))
      )}
    </View>
  );
}

function MiraMemorySavedCard({ card }: { card: Extract<ChatUiCard, { type: 'memory_saved' }> }) {
  return (
    <View style={styles.memoryCard}>
      <Text style={styles.memoryTitle}>จำข้อมูลสำคัญไว้แล้ว</Text>
      <Text numberOfLines={2} style={styles.memoryText}>
        {card.summaries.slice(0, 2).join(' · ') || `${card.count} items`}
      </Text>
    </View>
  );
}

function MiraChatCardRenderer({
  card,
  onBrowseCategory,
  onSelectBranch,
  onSelectProduct,
}: {
  card: ChatUiCard;
  onBrowseCategory: (category: string, label: string) => void;
  onSelectBranch: (productId: string, branchId: string) => void;
  onSelectProduct: (productId: string, productTitle: string) => void;
}) {
  if (card.type === 'product_grid') {
    return <MiraPackageGrid card={card} onSelectProduct={onSelectProduct} />;
  }

  if (card.type === 'category_grid') {
    return <MiraCategoryGrid card={card} onBrowseCategory={onBrowseCategory} />;
  }

  if (card.type === 'order_status') {
    return <MiraOrderStatusCard card={card} />;
  }

  if (card.type === 'branch_location') {
    return <MiraBranchLocationCard card={card} onSelectBranch={onSelectBranch} />;
  }

  if (card.type === 'checkout_draft') {
    return <MiraCheckoutDraftCard card={card} />;
  }

  return <MiraMemorySavedCard card={card} />;
}

function MiraBookingPanel({
  isSending,
  onSubmitOrderInfo,
  order,
}: {
  isSending: boolean;
  onSubmitOrderInfo: (payload: MiraOrderInfoFormSubmit) => Promise<void>;
  order: NonNullable<OrderPanelState>;
}) {
  const initialRangeStart = useMemo(() => addPreferredDateDays(new Date(), 1), []);
  const initialRangeEnd = useMemo(() => addPreferredDateDays(new Date(), 3), []);
  const [visibleMonthDate, setVisibleMonthDate] = useState(() => new Date(initialRangeStart.getFullYear(), initialRangeStart.getMonth(), 1));
  const preferredDayOptions = useMemo(() => createPreferredDateOptions(visibleMonthDate), [visibleMonthDate]);
  const [buyerName, setBuyerName] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [buyerAge, setBuyerAge] = useState('');
  const [rangeStartKey, setRangeStartKey] = useState(() => preferredDateKey(initialRangeStart));
  const [rangeEndKey, setRangeEndKey] = useState(() => preferredDateKey(initialRangeEnd));
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [selectedTimeSlotKey, setSelectedTimeSlotKey] = useState<PreferredTimeSlot['key']>('morning');
  const [formError, setFormError] = useState<string | null>(null);
  const [didSubmit, setDidSubmit] = useState(false);
  const ageDigits = buyerAge.replace(/[^\d]/g, '');
  const ageValue = Number.parseInt(ageDigits, 10);
  const phoneDigits = buyerPhone.replace(/[^\d]/g, '');
  const rangeStart = preferredDateOptionFromKey(rangeStartKey);
  const rangeEnd = preferredDateOptionFromKey(rangeEndKey);
  const selectedTimeSlot = preferredTimeSlots.find((slot) => slot.key === selectedTimeSlotKey) ?? preferredTimeSlots[0];
  const preferredDateRange = formatPreferredDateRange(rangeStart, rangeEnd, selectedTimeSlot);
  const rangeSummary = rangeStart && rangeEnd ? `${rangeStart.shortLabel} - ${rangeEnd.shortLabel}` : rangeStart ? `${rangeStart.shortLabel} - เลือกวันสุดท้าย` : 'เลือกช่วงวันที่';
  const canSubmit = buyerName.trim().length > 0 && /^0[689]\d{8}$/.test(phoneDigits) && Number.isFinite(ageValue) && ageValue > 0 && ageValue <= 120 && Boolean(preferredDateRange);
  const isSubmitLocked = isSending || didSubmit;
  const isButtonMuted = isSubmitLocked || !canSubmit;

  function selectRangeDay(dayKey: string) {
    if (isSubmitLocked) {
      return;
    }

    setFormError(null);

    if (!rangeStartKey || rangeEndKey) {
      setRangeStartKey(dayKey);
      setRangeEndKey('');
      return;
    }

    if (dayKey < rangeStartKey) {
      setRangeStartKey(dayKey);
      setRangeEndKey(rangeStartKey);
      return;
    }

    if (dayKey === rangeStartKey) {
      setRangeEndKey('');
      return;
    }

    setRangeEndKey(dayKey);
    setIsCalendarOpen(false);
  }

  async function submitOrderForm() {
    if (!canSubmit) {
      setFormError('กรอกชื่อ เบอร์โทร อายุ และเลือกช่วงวันที่/เวลาให้ครบก่อนค่ะ');
      return;
    }

    setFormError(null);

    try {
      await onSubmitOrderInfo({
        buyerAge: ageValue,
        buyerName: buyerName.trim(),
        buyerPhone: phoneDigits,
        orderId: order.id,
        preferredDate: rangeStartKey || undefined,
        preferredDateEnd: rangeEndKey || rangeStartKey || undefined,
        preferredTimeWindow: selectedTimeSlot ? `${selectedTimeSlot.label} ${selectedTimeSlot.detail}` : undefined,
      });
      setDidSubmit(true);
    } catch {
      setDidSubmit(false);
    }
  }

  return (
    <View style={styles.orderPanel}>
      <View style={styles.orderHeader}>
        <View style={styles.orderCopy}>
          <Text style={styles.orderEyebrow}>ข้อมูลผู้จอง</Text>
          <Text numberOfLines={2} style={styles.orderTitle}>
            {order.product_name}
          </Text>
          <Text numberOfLines={1} style={styles.orderMeta}>
            {[order.branch_name ?? 'ยังไม่ระบุสาขา', formatMoney(order.amount_baht)].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <MiraStatusPill>ออก QR</MiraStatusPill>
      </View>

      <View style={styles.formFields}>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>ชื่อผู้จอง</Text>
          <TextInput
            accessibilityLabel="ชื่อผู้จอง"
            autoCapitalize="words"
            editable={!didSubmit && !isSending}
            onChangeText={setBuyerName}
            placeholder="เช่น คุณมิรา"
            placeholderTextColor="rgba(82,99,138,0.52)"
            style={styles.textInput}
            value={buyerName}
          />
        </View>

        <View style={styles.formRow}>
          <View style={styles.formField}>
            <Text style={styles.formLabel}>เบอร์โทร</Text>
            <TextInput
              accessibilityLabel="เบอร์โทร"
              editable={!didSubmit && !isSending}
              keyboardType="phone-pad"
              onChangeText={setBuyerPhone}
              placeholder="08x-xxx-xxxx"
              placeholderTextColor="rgba(82,99,138,0.52)"
              style={styles.textInput}
              value={buyerPhone}
            />
          </View>
          <View style={styles.formFieldSmall}>
            <Text style={styles.formLabel}>อายุ</Text>
            <TextInput
              accessibilityLabel="อายุ"
              editable={!didSubmit && !isSending}
              keyboardType="number-pad"
              maxLength={3}
              onChangeText={(text) => setBuyerAge(text.replace(/[^\d]/g, ''))}
              placeholder="35"
              placeholderTextColor="rgba(82,99,138,0.52)"
              style={styles.textInput}
              value={buyerAge}
            />
          </View>
        </View>

        <View style={styles.formField}>
          <Text style={styles.formLabel}>ช่วงวันที่สะดวก</Text>
          <Pressable
            accessibilityLabel="เลือกช่วงวันที่สะดวก"
            accessibilityRole="button"
            disabled={isSubmitLocked}
            onPress={() => setIsCalendarOpen((current) => !current)}
          >
            {({ pressed }) => (
              <View style={[styles.dateButton, pressed && !isSubmitLocked ? styles.dateButtonPressed : null]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={styles.dateButtonTitle}>
                    {rangeSummary}
                  </Text>
                  <Text numberOfLines={1} style={styles.dateButtonMeta}>
                    {selectedTimeSlot?.label} · {selectedTimeSlot?.detail}
                  </Text>
                </View>
                <Text style={styles.chevronText}>{isCalendarOpen ? '×' : '›'}</Text>
              </View>
            )}
          </Pressable>

          {isCalendarOpen ? (
            <View style={styles.calendarPanel}>
              <View style={styles.calendarHeader}>
                <Text style={styles.calendarTitle}>{preferredMonthTitle(visibleMonthDate)}</Text>
                <View style={styles.calendarNav}>
                  <Pressable accessibilityLabel="เดือนก่อนหน้า" accessibilityRole="button" onPress={() => setVisibleMonthDate((current) => addPreferredMonths(current, -1))}>
                    <View style={styles.calendarNavButton}>
                      <Text style={styles.chevronText}>‹</Text>
                    </View>
                  </Pressable>
                  <Pressable accessibilityLabel="เดือนถัดไป" accessibilityRole="button" onPress={() => setVisibleMonthDate((current) => addPreferredMonths(current, 1))}>
                    <View style={styles.calendarNavButton}>
                      <Text style={styles.chevronText}>›</Text>
                    </View>
                  </Pressable>
                </View>
              </View>

              <View style={styles.calendarWeekRow}>
                {preferredDateWeekdays.map((weekday) => (
                  <Text key={weekday} style={styles.calendarWeekday}>
                    {weekday}
                  </Text>
                ))}
              </View>

              <View style={styles.calendarGrid}>
                {preferredDayOptions.map((day, index) => {
                  if (!day) {
                    return (
                      <View key={`blank-${index}`} style={styles.calendarCellWrap}>
                        <View style={styles.calendarCell} />
                      </View>
                    );
                  }

                  const isStart = day.key === rangeStartKey;
                  const isEnd = day.key === rangeEndKey;
                  const isInside = Boolean(rangeStartKey && rangeEndKey && day.key > rangeStartKey && day.key < rangeEndKey);
                  const isSelected = isStart || isEnd;

                  return (
                    <Pressable
                      accessibilityLabel={`เลือกวันที่ ${day.shortLabel}`}
                      accessibilityRole="button"
                      disabled={isSubmitLocked}
                      key={day.key}
                      onPress={() => selectRangeDay(day.key)}
                      style={styles.calendarCellWrap}
                    >
                      <View style={[styles.calendarCell, isInside ? styles.calendarCellInRange : null, isSelected ? styles.calendarCellSelected : null]}>
                        <Text style={[styles.calendarDateText, isSelected ? styles.calendarDateTextSelected : null]}>{day.dayNumber}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.formField}>
          <Text style={styles.formLabel}>เวลาที่สะดวก</Text>
          <View style={styles.timeSlotRow}>
            {preferredTimeSlots.map((slot) => {
              const isSelected = slot.key === selectedTimeSlotKey;

              return (
                <Pressable
                  accessibilityLabel={`เลือก${slot.label}`}
                  accessibilityRole="button"
                  disabled={isSubmitLocked}
                  key={slot.key}
                  onPress={() => setSelectedTimeSlotKey(slot.key)}
                  style={styles.timeSlotPressable}
                >
                  <View style={[styles.timeSlotButton, isSelected ? styles.timeSlotButtonSelected : null]}>
                    <Text style={[styles.timeSlotLabel, isSelected ? styles.timeSlotSelectedText : null]}>{slot.label}</Text>
                    <Text style={[styles.timeSlotDetail, isSelected ? styles.timeSlotSelectedText : null]}>{slot.detail}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      {formError ? <Text style={styles.formError}>{formError}</Text> : null}

      <MiraButton disabled={isButtonMuted} label={didSubmit ? 'ส่งข้อมูลแล้ว' : isSending ? 'กำลังส่ง...' : 'ยืนยันและออก QR'} onPress={() => void submitOrderForm()} />
    </View>
  );
}

function MiraPaymentCard({
  isSending,
  onStripePromptPayQr,
  onStripePromptPayStatus,
  order,
}: {
  isSending: boolean;
  onStripePromptPayQr: (orderId: string) => Promise<StripePromptPayQrResponse>;
  onStripePromptPayStatus: (orderId: string) => Promise<StripePromptPayQrResponse>;
  order: NonNullable<OrderPanelState>;
}) {
  const [stripeQrResult, setStripeQrResult] = useState<StripePromptPayQrResponse | null>(null);
  const [stripeQrError, setStripeQrError] = useState<string | null>(null);
  const [isCreatingQr, setIsCreatingQr] = useState(false);
  const [isCheckingPayment, setIsCheckingPayment] = useState(false);
  const autoCreateAttemptKeyRef = useRef<string | null>(null);

  useEffect(() => {
    autoCreateAttemptKeyRef.current = null;
    setStripeQrResult(null);
    setStripeQrError(null);
  }, [order.id]);

  useEffect(() => {
    if (order.step === 'qr') {
      return;
    }

    autoCreateAttemptKeyRef.current = null;
    setStripeQrResult(null);
    setStripeQrError(null);
  }, [order.step]);

  useEffect(() => {
    if (order.step !== 'qr' || !stripeQrResult?.stripe_payment_intent_id || stripeQrResult.submitted) {
      return undefined;
    }

    let cancelled = false;
    const timer = setInterval(() => {
      setIsCheckingPayment(true);
      onStripePromptPayStatus(order.id)
        .then((response) => {
          if (cancelled) {
            return;
          }

          setStripeQrError(null);
          setStripeQrResult((current) => ({
            ...response,
            qr: response.qr ?? current?.qr ?? null,
          }));
        })
        .catch((error) => {
          if (!cancelled) {
            setStripeQrError(error instanceof Error ? error.message : 'ตรวจสอบสถานะ Stripe ไม่สำเร็จ');
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsCheckingPayment(false);
          }
        });
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [onStripePromptPayStatus, order.id, order.step, stripeQrResult?.stripe_payment_intent_id, stripeQrResult?.submitted]);

  const busy = isSending || isCreatingQr || isCheckingPayment;
  const stripeQr = stripeQrResult?.qr ?? null;
  const hasStripePaymentIntent = Boolean(stripeQrResult?.stripe_payment_intent_id);
  const stripeQrTitle = stripeQr
    ? 'QR PromptPay สำหรับรายการนี้'
    : stripeQrError
      ? 'สร้าง QR PromptPay ไม่สำเร็จ'
      : 'กำลังเตรียม QR PromptPay';
  const statusTone = stripeQrResult?.submitted || order.status === 'submitted' || order.status === 'confirmed' || order.status === 'booked' ? 'mint' : 'warning';
  const statusText = stripeQrResult?.submitted ? 'ชำระแล้ว' : isCheckingPayment ? 'กำลังตรวจสอบ' : 'รอชำระเงิน';

  async function createQr() {
    if (busy) {
      return;
    }

    setStripeQrError(null);
    setIsCreatingQr(true);

    try {
      const response = await onStripePromptPayQr(order.id);
      setStripeQrResult(response);
    } catch (error) {
      setStripeQrError(error instanceof Error ? error.message : 'สร้าง QR Stripe ไม่สำเร็จ');
    } finally {
      setIsCreatingQr(false);
    }
  }

  useEffect(() => {
    if (order.step !== 'qr' || stripeQr || hasStripePaymentIntent || isSending || isCreatingQr || isCheckingPayment) {
      return;
    }

    if (autoCreateAttemptKeyRef.current === order.id) {
      return;
    }

    autoCreateAttemptKeyRef.current = order.id;
    void createQr();
  }, [hasStripePaymentIntent, isCheckingPayment, isCreatingQr, isSending, order.id, order.step, stripeQr, stripeQrError]);

  async function checkPaymentNow() {
    if (busy || !stripeQrResult?.stripe_payment_intent_id) {
      return;
    }

    setStripeQrError(null);
    setIsCheckingPayment(true);

    try {
      const response = await onStripePromptPayStatus(order.id);
      setStripeQrResult((current) => ({
        ...response,
        qr: response.qr ?? current?.qr ?? null,
      }));
    } catch (error) {
      setStripeQrError(error instanceof Error ? error.message : 'ตรวจสอบสถานะ Stripe ไม่สำเร็จ');
    } finally {
      setIsCheckingPayment(false);
    }
  }

  return (
    <View style={styles.paymentCard}>
      <MiraStatusPill tone={statusTone}>{statusText}</MiraStatusPill>
      {stripeQr ? (
        <View style={styles.qrFrame}>
          <QRCode backgroundColor="#FFFFFF" color={miraChatTokens.color.text} size={152} value={stripeQr.data} />
        </View>
      ) : null}

      <Text style={styles.paymentTitle}>{stripeQrTitle}</Text>
      <Text style={styles.paymentMeta}>
        {stripeQrResult?.stripe_payment_status
          ? `สถานะ Stripe: ${stripeQrResult.stripe_payment_status}`
          : `${formatMoney(order.amount_baht)} · ใช้ QR ที่ผูกกับรายการนี้เท่านั้น`}
      </Text>

      {stripeQrError ? <Text style={styles.paymentError}>{stripeQrError}</Text> : null}

      {!stripeQr && !stripeQrError ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={miraChatTokens.color.primary2} size="small" />
          <Text style={styles.loadingText}>{isCreatingQr ? 'กำลังสร้าง QR...' : 'กำลังรอสร้าง QR...'}</Text>
        </View>
      ) : null}

      {!stripeQr && stripeQrError ? <MiraButton disabled={busy} label={isCreatingQr ? 'กำลังสร้าง QR...' : 'ลองสร้าง QR ใหม่'} onPress={() => void createQr()} /> : null}

      {stripeQr ? <MiraButton disabled={busy} label={isCheckingPayment ? 'กำลังตรวจสอบ...' : 'ตรวจสอบการชำระเงิน'} onPress={() => void checkPaymentNow()} /> : null}
    </View>
  );
}

function MiraOrderPanel({
  isSending,
  onStripePromptPayQr,
  onStripePromptPayStatus,
  onSubmitOrderInfo,
  order,
}: {
  isSending: boolean;
  onStripePromptPayQr: (orderId: string) => Promise<StripePromptPayQrResponse>;
  onStripePromptPayStatus: (orderId: string) => Promise<StripePromptPayQrResponse>;
  onSubmitOrderInfo: (payload: MiraOrderInfoFormSubmit) => Promise<void>;
  order: NonNullable<OrderPanelState>;
}) {
  const steps: Array<NonNullable<OrderPanelState>['step']> = ['branch', 'form', 'qr', 'tracking'];
  const activeIndex = order.step === 'cancelled' ? -1 : Math.max(0, steps.indexOf(order.step));

  if (order.step === 'form' || order.show_form) {
    return <MiraBookingPanel isSending={isSending} onSubmitOrderInfo={onSubmitOrderInfo} order={order} />;
  }

  return (
    <View style={styles.orderPanel}>
      <View style={styles.orderHeader}>
        <View style={styles.orderCopy}>
          <Text style={styles.orderEyebrow}>ขั้นตอนการจอง</Text>
          <Text numberOfLines={2} style={styles.orderTitle}>
            {order.product_name}
          </Text>
          <Text numberOfLines={1} style={styles.orderMeta}>
            {[order.branch_name ?? 'ยังไม่ระบุสาขา', formatMoney(order.amount_baht)].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <MiraStatusPill tone={order.step === 'tracking' ? 'mint' : order.step === 'qr' ? 'warning' : 'blue'}>{orderStepLabel(order.step)}</MiraStatusPill>
      </View>

      <View style={styles.orderSteps}>
        {steps.map((step, index) => {
          const isActive = index <= activeIndex;

          return (
            <View key={step} style={styles.orderStepItem}>
              <View style={styles.orderStepBar}>{isActive ? <View style={styles.orderStepBarActive} /> : null}</View>
              <Text style={[styles.orderStepLabel, isActive ? styles.orderStepLabelActive : null]}>{orderStepLabel(step)}</Text>
            </View>
          );
        })}
      </View>

      <Text style={styles.orderHint}>{orderHint(order)}</Text>
      {order.step === 'qr' ? (
        <MiraPaymentCard isSending={isSending} onStripePromptPayQr={onStripePromptPayQr} onStripePromptPayStatus={onStripePromptPayStatus} order={order} />
      ) : null}
    </View>
  );
}

function MiraChatBubble({
  index,
  isSending,
  message,
  onBrowseCategory,
  onSelectBranch,
  onSelectProduct,
  onStripePromptPayQr,
  onStripePromptPayStatus,
  onSubmitOrderInfo,
}: {
  index: number;
  isSending: boolean;
  message: MiraChatMessage;
  onBrowseCategory: (category: string, label: string) => void;
  onSelectBranch: (productId: string, branchId: string) => void;
  onSelectProduct: (productId: string, productTitle: string) => void;
  onStripePromptPayQr: (orderId: string) => Promise<StripePromptPayQrResponse>;
  onStripePromptPayStatus: (orderId: string) => Promise<StripePromptPayQrResponse>;
  onSubmitOrderInfo: (payload: MiraOrderInfoFormSubmit) => Promise<void>;
}) {
  const motionStyle = useEntranceMotion(index);
  const timestamp = formatMessageTime(message.createdAt);

  if (message.role === 'user') {
    return (
      <Animated.View style={[styles.userRow, motionStyle]}>
        <LinearGradient colors={['#2837D8', '#4C6FFF', '#7C8CFF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.userBubble}>
          <Text style={styles.userText}>{message.content}</Text>
        </LinearGradient>
        {timestamp ? <Text style={[styles.timestamp, styles.timestampUser]}>{timestamp}</Text> : null}
      </Animated.View>
    );
  }

  if (message.role === 'system_notice') {
    return (
      <Animated.View style={[styles.systemRow, motionStyle]}>
        <View style={styles.systemBubble}>
          <Text style={styles.systemText}>{message.content}</Text>
        </View>
        {message.order ? (
          <MiraOrderPanel
            isSending={isSending}
            onStripePromptPayQr={onStripePromptPayQr}
            onStripePromptPayStatus={onStripePromptPayStatus}
            onSubmitOrderInfo={onSubmitOrderInfo}
            order={message.order}
          />
        ) : null}
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.assistantRow, motionStyle]}>
      <MiraAssistantAvatar />
      <View style={styles.assistantStack}>
        {message.content ? (
          <BlurView intensity={24} tint="light" style={styles.assistantBubble}>
            <Text style={styles.assistantText}>{message.content}</Text>
            {timestamp ? <Text style={styles.timestamp}>{timestamp}</Text> : null}
          </BlurView>
        ) : null}
        {message.uiCards?.map((card) => (
          <MiraChatCardRenderer key={card.id} card={card} onBrowseCategory={onBrowseCategory} onSelectBranch={onSelectBranch} onSelectProduct={onSelectProduct} />
        ))}
        {message.order ? (
          <MiraOrderPanel
            isSending={isSending}
            onStripePromptPayQr={onStripePromptPayQr}
            onStripePromptPayStatus={onStripePromptPayStatus}
            onSubmitOrderInfo={onSubmitOrderInfo}
            order={message.order}
          />
        ) : null}
      </View>
    </Animated.View>
  );
}

function MiraTypingIndicator() {
  const reducedMotion = useReduceMotion();
  const dots = [useRef(new Animated.Value(0.35)).current, useRef(new Animated.Value(0.35)).current, useRef(new Animated.Value(0.35)).current];

  useEffect(() => {
    if (reducedMotion) {
      dots.forEach((dot) => dot.setValue(0.9));
      return undefined;
    }

    const animations = dots.map((dot, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 140),
          Animated.timing(dot, { duration: 360, easing: Easing.out(Easing.quad), toValue: 1, useNativeDriver: true }),
          Animated.timing(dot, { duration: 360, easing: Easing.in(Easing.quad), toValue: 0.35, useNativeDriver: true }),
        ]),
      ),
    );

    animations.forEach((animation) => animation.start());
    return () => animations.forEach((animation) => animation.stop());
  }, [dots, reducedMotion]);

  return (
    <View style={styles.assistantRow}>
      <MiraAssistantAvatar />
      <View style={styles.typingBubble}>
        {dots.map((opacity, index) => (
          <Animated.View key={index} style={[styles.typingDot, { opacity }]} />
        ))}
      </View>
    </View>
  );
}

function MiraChatInputBar({
  input,
  isSending,
  onSendMessage,
  onSetInput,
  onVoicePress,
  voiceStatus,
}: Pick<MiraChatShellProps, 'input' | 'isSending' | 'onSendMessage' | 'onSetInput' | 'onVoicePress' | 'voiceStatus'>) {
  const canSend = input.trim().length > 0 && !isSending;

  return (
    <View style={styles.inputWrap}>
      {voiceStatus ? (
        <View style={styles.voiceStatus}>
          <View style={styles.voiceStatusDot} />
          <Text numberOfLines={2} style={styles.voiceStatusText}>
            {voiceStatus}
          </Text>
        </View>
      ) : null}

      <BlurView intensity={34} tint="light" style={styles.inputBar}>
        <Pressable accessibilityLabel="สถานะไมค์" accessibilityRole="button" disabled={isSending} onPress={onVoicePress}>
          {({ pressed }) => (
            <View style={[styles.inputIconButton, isSending ? styles.inputIconButtonDisabled : null, pressed ? styles.glassCircleButtonPressed : null]}>
              <MicIcon />
            </View>
          )}
        </Pressable>

          <TextInput
          accessibilityLabel="พิมพ์ข้อความถึง Mira"
          editable={!isSending}
          onChangeText={onSetInput}
          onSubmitEditing={onSendMessage}
          placeholder="ถาม Mira..."
          placeholderTextColor={miraChatTokens.color.textMuted}
          returnKeyType="send"
          style={styles.composerInput}
          value={input}
        />

        <Pressable accessibilityLabel="ส่งข้อความ" accessibilityRole="button" disabled={!canSend} onPress={onSendMessage}>
          {({ pressed }) => (
            <LinearGradient
              colors={['#2837D8', '#4C6FFF', '#7C8CFF']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.sendButton, !canSend ? styles.sendButtonDisabled : null, pressed && canSend ? styles.primaryButtonPressed : null]}
            >
              {isSending ? <ActivityIndicator color="#FFFFFF" size="small" /> : <SendIcon />}
            </LinearGradient>
          )}
        </Pressable>
      </BlurView>
      <View style={styles.homeIndicator} />
    </View>
  );
}

function MiraEmptyState({ body, title }: { body: string; title: string }) {
  return (
    <View style={styles.emptyState}>
      <MiraOrb size={40} />
      <Text style={styles.emptyStateTitle}>{title}</Text>
      <Text style={styles.emptyStateText}>{body}</Text>
    </View>
  );
}

function MiraErrorState({ body, onRetry, title }: { body: string; onRetry?: () => void; title: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateTitle}>{title}</Text>
      <Text style={styles.emptyStateText}>{body}</Text>
      {onRetry ? <MiraButton label="ลองใหม่" onPress={onRetry} /> : null}
    </View>
  );
}

export function MiraChatShell({
  authLabel,
  brandName,
  canUseLiveAi,
  greetingText,
  input,
  isAuthLoading,
  isAuthenticated,
  isSending,
  messages,
  onAuthPress,
  onBackPress,
  onBrowseCategory,
  onQuickReply,
  onSelectBranch,
  onSelectProduct,
  onSendMessage,
  onSetInput,
  onStripePromptPayQr,
  onStripePromptPayStatus,
  onSubmitOrderInfo,
  onVoicePress,
  voiceStatus,
}: MiraChatShellProps) {
  const { height, width } = useWindowDimensions();
  const browserWidth = Platform.OS === 'web' && typeof window !== 'undefined' ? window.innerWidth : 390;
  const browserHeight = Platform.OS === 'web' && typeof window !== 'undefined' ? window.innerHeight : 760;
  const viewportWidth = width > 0 ? width : browserWidth;
  const viewportHeight = height > 0 ? height : browserHeight;
  const isCompact = viewportWidth < 430;
  const frameSize = useMemo(
    () => ({
      height: isCompact ? viewportHeight : Math.min(780, Math.max(700, viewportHeight - 36)),
      width: isCompact ? viewportWidth : 390,
    }),
    [isCompact, viewportHeight, viewportWidth],
  );
  const scrollRef = useRef<ScrollView>(null);
  const activeOrder = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.order) {
        return messages[index].order ?? null;
      }
    }

    return null;
  }, [messages]);

  useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [isSending, messages.length]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
        <View style={styles.stage}>
          <View style={[styles.phoneShell, isCompact ? styles.phoneShellCompact : null, frameSize]}>
            <LinearGradient colors={[miraChatTokens.color.bgStart, miraChatTokens.color.bgMid, miraChatTokens.color.bgEnd]} style={styles.screen}>
              <BackgroundSheen />
              <View style={styles.floatingGlassBand} />
              <MiraChatHeader
                authLabel={authLabel}
                canUseLiveAi={canUseLiveAi}
                isAuthLoading={isAuthLoading}
                isAuthenticated={isAuthenticated}
                onAuthPress={onAuthPress}
                onBackPress={onBackPress}
              />

              <ScrollView ref={scrollRef} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} style={styles.scroll}>
                <MiraGreetingCard greetingText={greetingText} />
                <MiraFlowProgress order={activeOrder} />
                <MiraQuickReplies disabled={isSending} onQuickReply={onQuickReply} />

                {messages.length === 0 ? (
                  null
                ) : (
                  messages.map((message, index) => (
                    <MiraChatBubble
                      index={index}
                      isSending={isSending}
                      key={message.id}
                      message={message}
                      onBrowseCategory={onBrowseCategory}
                      onSelectBranch={onSelectBranch}
                      onSelectProduct={onSelectProduct}
                      onStripePromptPayQr={onStripePromptPayQr}
                      onStripePromptPayStatus={onStripePromptPayStatus}
                      onSubmitOrderInfo={onSubmitOrderInfo}
                    />
                  ))
                )}

                {isSending ? <MiraTypingIndicator /> : null}
              </ScrollView>

              <MiraChatInputBar
                input={input}
                isSending={isSending}
                onSendMessage={onSendMessage}
                onSetInput={onSetInput}
                onVoicePress={onVoicePress}
                voiceStatus={voiceStatus}
              />
            </LinearGradient>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
