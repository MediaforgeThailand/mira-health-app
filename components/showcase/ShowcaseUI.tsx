import { Link, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Button, Chip, Surface } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MiraDesign, softShadow } from '@/constants/Design';
import type { ShowcaseAuth, ShowcaseHref, ShowcaseModuleId, ShowcaseStatus } from '@/lib/showcase/registry';

const logo = require('@/assets/images/mira-care-logo.png');

const statusTone: Record<ShowcaseStatus, { backgroundColor: string; color: string; label: string }> = {
  live: { backgroundColor: '#E7F8F2', color: '#087B5D', label: 'LIVE' },
  planned: { backgroundColor: '#EDF2F7', color: '#587177', label: 'PLANNED' },
};

const authLabel: Record<ShowcaseAuth, string> = {
  admin: 'Admin',
  customer: 'Customer',
  none: 'Public',
};

export function withTourHref(href: ShowcaseHref, moduleId: ShowcaseModuleId): Href {
  if (typeof href === 'string') {
    return { pathname: href as never, params: { tour: moduleId } } as Href;
  }

  return {
    ...href,
    params: {
      ...(href.params ?? {}),
      tour: moduleId,
    },
  } as Href;
}

export function ShowcaseScreen({
  children,
  maxWidth = 1180,
  refreshControl,
}: {
  children: ReactNode;
  maxWidth?: number;
  refreshControl?: ScrollViewProps['refreshControl'];
}) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={[styles.container, { maxWidth }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function ShowcaseHeader({
  actions,
  eyebrow,
  subtitle,
  title,
}: {
  actions?: ReactNode;
  eyebrow: string;
  subtitle?: string;
  title: string;
}) {
  const { width } = useWindowDimensions();
  const isCompact = width < 720;

  return (
    <View style={[styles.header, isCompact ? styles.headerStack : null]}>
      <View style={styles.headerCopy}>
        <Image resizeMode="contain" source={logo} style={styles.logo} />
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={[styles.title, isCompact ? styles.titleCompact : null]}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {actions ? <View style={styles.headerActions}>{actions}</View> : null}
    </View>
  );
}

export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Surface elevation={0} style={[styles.panel, style]}>
      {children}
    </Surface>
  );
}

export function MetricTile({ detail, label, value }: { detail?: string; label: string; value: string }) {
  return (
    <Panel style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
      {detail ? <Text style={styles.metricDetail}>{detail}</Text> : null}
    </Panel>
  );
}

export function StatusChip({ status }: { status: ShowcaseStatus }) {
  const tone = statusTone[status];

  return (
    <Chip compact mode="flat" style={[styles.chip, { backgroundColor: tone.backgroundColor }]} textStyle={[styles.chipText, { color: tone.color }]}>
      {tone.label}
    </Chip>
  );
}

export function AuthChip({ auth }: { auth: ShowcaseAuth }) {
  return (
    <Chip compact mode="outlined" style={styles.authChip} textStyle={styles.authText}>
      {authLabel[auth]}
    </Chip>
  );
}

export function PrimaryAction({ disabled = false, label, onPress }: { disabled?: boolean; label: string; onPress: () => void }) {
  return (
    <Button disabled={disabled} mode="contained" onPress={onPress} style={styles.paperButton} labelStyle={styles.paperButtonLabel}>
      {label}
    </Button>
  );
}

export function LinkButton({ href, label }: { href: Href; label: string }) {
  return (
    <Link href={href} asChild>
      <Pressable style={styles.linkButton}>
        <Text style={styles.linkButtonText}>{label}</Text>
      </Pressable>
    </Link>
  );
}

export function MiniLabel({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.miniLabel}>
      <Text style={styles.miniLabelText}>{label}</Text>
      <Text numberOfLines={1} style={styles.miniLabelValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: MiraDesign.color.showcaseCanvas,
    flex: 1,
  },
  container: {
    alignSelf: 'center',
    gap: MiraDesign.space.xl,
    padding: MiraDesign.space.xl,
    paddingBottom: 58,
    width: '100%',
  },
  header: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: MiraDesign.space.lg,
    justifyContent: 'space-between',
  },
  headerStack: {
    alignItems: 'stretch',
    flexDirection: 'column',
  },
  headerCopy: {
    flex: 1,
    gap: MiraDesign.space.sm,
  },
  logo: {
    height: 38,
    width: 152,
  },
  eyebrow: {
    color: MiraDesign.color.showcaseBlue,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  title: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 38,
    fontWeight: '900',
    lineHeight: 44,
  },
  titleCompact: {
    fontSize: 30,
    lineHeight: 36,
  },
  subtitle: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 760,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: MiraDesign.space.sm,
  },
  panel: {
    backgroundColor: MiraDesign.color.showcaseSurface,
    borderColor: '#C6E0FA',
    borderRadius: MiraDesign.radius.sm,
    borderWidth: 1,
    gap: MiraDesign.space.md,
    overflow: 'hidden',
    padding: MiraDesign.space.lg,
    ...softShadow,
  },
  metric: {
    flex: 1,
    minHeight: 106,
    minWidth: 150,
  },
  metricValue: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 32,
  },
  metricLabel: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 13,
    fontWeight: '900',
  },
  metricDetail: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 12,
    lineHeight: 17,
  },
  chip: {
    borderRadius: MiraDesign.radius.pill,
    minHeight: 28,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '900',
  },
  authChip: {
    backgroundColor: MiraDesign.color.showcaseSurface,
    borderColor: '#BBD8F8',
    borderRadius: MiraDesign.radius.pill,
    minHeight: 28,
  },
  authText: {
    color: MiraDesign.color.showcaseBlueDeep,
    fontSize: 11,
    fontWeight: '900',
  },
  paperButton: {
    borderRadius: MiraDesign.radius.sm,
  },
  paperButtonLabel: {
    fontSize: 13,
    fontWeight: '900',
  },
  linkButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.showcaseBlue,
    borderRadius: MiraDesign.radius.sm,
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: MiraDesign.space.lg,
  },
  linkButtonText: {
    color: MiraDesign.color.surface,
    fontSize: 13,
    fontWeight: '900',
  },
  miniLabel: {
    backgroundColor: MiraDesign.color.showcaseBlueSoft,
    borderColor: '#BBD8F8',
    borderRadius: MiraDesign.radius.sm,
    borderWidth: 1,
    flexGrow: 1,
    gap: 4,
    minWidth: 132,
    padding: MiraDesign.space.md,
  },
  miniLabelText: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  miniLabelValue: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 14,
    fontWeight: '900',
  },
});

export const showcaseUiStyles = styles;
