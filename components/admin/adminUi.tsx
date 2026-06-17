// Shared admin design kit.
//
// Extracted from the orders workbench redesign so every admin page shares one
// clean, calm visual language: compact header, compact summary chips, neutral
// white cards, teal-only accents for primary/active/selected, restrained type,
// minimal text, progressive disclosure. Use these instead of bespoke per-page
// chrome so the console stays consistent.

import { SymbolView } from 'expo-symbols';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MiraDesign, softShadow } from '@/constants/Design';

export type AdminTone = 'amber' | 'blue' | 'danger' | 'muted' | 'primary' | 'success';
type SymbolName = ComponentProps<typeof SymbolView>['name'];

const toneColor: Record<AdminTone, { bg: string; fg: string }> = {
  amber: { bg: '#FBEFD3', fg: '#946200' },
  blue: { bg: MiraDesign.color.blueSoft, fg: MiraDesign.color.blue },
  danger: { bg: '#FCE7E7', fg: MiraDesign.color.danger },
  muted: { bg: MiraDesign.color.surfaceSoft, fg: MiraDesign.color.inkSoft },
  primary: { bg: MiraDesign.color.primarySoft, fg: MiraDesign.color.primaryDeep },
  success: { bg: MiraDesign.color.primarySoft, fg: MiraDesign.color.primaryDeep },
};

export function AdminScreen({ children }: { children: ReactNode }) {
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </View>
  );
}

export function AdminBadge({ label, tone = 'muted' }: { label: string; tone?: AdminTone }) {
  const color = toneColor[tone];

  return <Text style={[styles.badge, { backgroundColor: color.bg, color: color.fg }]}>{label}</Text>;
}

export function AdminButton({
  disabled,
  icon,
  label,
  onPress,
  primary,
}: {
  disabled?: boolean;
  icon?: SymbolName;
  label: string;
  onPress?: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, primary ? styles.buttonPrimary : null, disabled ? styles.disabled : null]}
    >
      {icon ? <SymbolView name={icon} size={16} tintColor={primary ? '#FFFFFF' : MiraDesign.color.primaryDeep} /> : null}
      <Text style={[styles.buttonText, primary ? styles.buttonTextPrimary : null]}>{label}</Text>
    </Pressable>
  );
}

export function AdminHeader({
  actions,
  eyebrow,
  metaText,
  modeLabel,
  modeTone = 'primary',
  note,
  title,
}: {
  actions?: ReactNode;
  eyebrow: string;
  metaText?: string | null;
  modeLabel?: string | null;
  modeTone?: AdminTone;
  note?: string | null;
  title: string;
}) {
  const mode = modeLabel ? toneColor[modeTone] : null;

  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <View style={styles.headerMain}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <View style={styles.headerTitleRow}>
            <Text style={styles.title}>{title}</Text>
            {mode ? (
              <View style={[styles.modePill, { backgroundColor: mode.bg }]}>
                <Text style={[styles.modePillText, { color: mode.fg }]}>{modeLabel}</Text>
              </View>
            ) : null}
            {metaText ? <Text style={styles.headerMeta}>{metaText}</Text> : null}
          </View>
        </View>
        {actions ? <View style={styles.headerActions}>{actions}</View> : null}
      </View>
      {note ? (
        <Text numberOfLines={1} style={styles.headerNote}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

export type SummaryChipItem = { key: string; label: string; tone?: AdminTone; value: number | string };

export function SummaryChips({
  activeKey,
  items,
  onSelect,
}: {
  activeKey?: string;
  items: SummaryChipItem[];
  onSelect?: (key: string) => void;
}) {
  return (
    <View style={styles.summaryRow}>
      {items.map((item) => {
        const active = activeKey === item.key;
        const interactive = Boolean(onSelect);

        return (
          <Pressable
            accessibilityLabel={`${item.label} ${item.value}`}
            accessibilityRole={interactive ? 'button' : 'text'}
            accessibilityState={{ selected: active }}
            disabled={!interactive}
            key={item.key}
            onPress={() => onSelect?.(item.key)}
            style={[styles.summaryChip, active ? styles.summaryChipActive : null]}
          >
            <Text style={[styles.summaryValue, active ? styles.summaryValueActive : null]}>
              {typeof item.value === 'number' ? item.value.toLocaleString('th-TH') : item.value}
            </Text>
            <Text style={[styles.summaryLabel, active ? styles.summaryLabelActive : null]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SectionTitle({ action, meta, title }: { action?: ReactNode; meta?: string; title: string }) {
  return (
    <View style={styles.sectionTitleRow}>
      <View style={styles.sectionTitleGroup}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {meta ? <Text style={styles.sectionMeta}>{meta}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function AdminCard({ children, onPress, style }: { children: ReactNode; onPress?: () => void; style?: object }) {
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress} style={[styles.card, styles.cardInteractive, style]}>
        {children}
      </Pressable>
    );
  }

  return <View style={[styles.card, style]}>{children}</View>;
}

export function DefList({ children }: { children: ReactNode }) {
  return <View style={styles.defList}>{children}</View>;
}

export function DefRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.defRow}>
      <Text style={styles.defLabel}>{label}</Text>
      <Text numberOfLines={2} style={styles.defValue}>
        {value}
      </Text>
    </View>
  );
}

export function EmptyState({
  action,
  body,
  icon = { android: 'inbox', ios: 'tray', web: 'inbox' },
  title,
}: {
  action?: ReactNode;
  body: string;
  icon?: SymbolName;
  title: string;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <SymbolView name={icon} size={24} tintColor={MiraDesign.color.primary} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: MiraDesign.color.canvas,
    flex: 1,
  },
  screenContent: {
    gap: 12,
    padding: 16,
    paddingBottom: 32,
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
  headerMain: {
    flex: 1,
    gap: 2,
    minWidth: 200,
  },
  eyebrow: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  headerTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  title: {
    color: MiraDesign.color.ink,
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 26,
  },
  headerMeta: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  headerNote: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '600',
  },
  modePill: {
    borderRadius: MiraDesign.radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  modePillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  badge: {
    borderRadius: MiraDesign.radius.pill,
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  button: {
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
  buttonPrimary: {
    backgroundColor: MiraDesign.color.primary,
    borderColor: MiraDesign.color.primary,
  },
  buttonText: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 13,
    fontWeight: '800',
  },
  buttonTextPrimary: {
    color: '#FFFFFF',
  },
  disabled: {
    opacity: 0.45,
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
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  summaryChipActive: {
    backgroundColor: MiraDesign.color.primarySoft,
    borderColor: MiraDesign.color.primary,
  },
  summaryValue: {
    color: MiraDesign.color.ink,
    fontSize: 14,
    fontWeight: '900',
  },
  summaryValueActive: {
    color: MiraDesign.color.primaryDeep,
  },
  summaryLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '800',
  },
  summaryLabelActive: {
    color: MiraDesign.color.primaryDeep,
  },
  sectionTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sectionTitleGroup: {
    alignItems: 'baseline',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sectionTitle: {
    color: MiraDesign.color.ink,
    fontSize: 15,
    fontWeight: '900',
  },
  sectionMeta: {
    color: MiraDesign.color.inkSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  card: {
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  cardInteractive: {
    cursor: 'pointer',
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
  empty: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 28,
  },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.primarySoft,
    borderRadius: 999,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  emptyTitle: {
    color: MiraDesign.color.ink,
    fontSize: 15,
    fontWeight: '900',
  },
  emptyBody: {
    color: MiraDesign.color.inkSoft,
    fontSize: 13,
    maxWidth: 360,
    textAlign: 'center',
  },
});
