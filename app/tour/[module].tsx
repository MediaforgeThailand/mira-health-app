import { LinearGradient } from 'expo-linear-gradient';
import { Link, Redirect, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { ImageSourcePropType } from 'react-native';

import { AuthChip, LinkButton, Panel, ShowcaseScreen, StatusChip, withTourHref } from '@/components/showcase/ShowcaseUI';
import { MiraDesign } from '@/constants/Design';
import {
  findShowcaseModule,
  getShowcaseEntriesForModule,
  showcaseModules,
  type ShowcaseEntry,
  type ShowcaseModule,
  type ShowcaseModuleId,
} from '@/lib/showcase/registry';

const logo = require('@/assets/images/mira-care-logo.png');
type SymbolName = ComponentProps<typeof SymbolView>['name'];

const moduleNumbers: Record<ShowcaseModuleId, string> = {
  admin: '02',
  'ai-chat': '03',
  referral: '01',
};

const moduleVisuals: Record<
  ShowcaseModuleId,
  {
    fit: 'contain' | 'cover';
    image: ImageSourcePropType;
    icon: SymbolName;
    wash: string;
  }
> = {
  admin: {
    fit: 'cover',
    icon: { android: 'admin_panel_settings', ios: 'slider.horizontal.3', web: 'admin_panel_settings' },
    image: require('@/assets/images/sales-package-longevity.png'),
    wash: '#DDEBFF',
  },
  'ai-chat': {
    fit: 'cover',
    icon: { android: 'chat', ios: 'message.and.waveform.fill', web: 'chat' },
    image: require('@/assets/motion/mira-landing-motion-poster.png'),
    wash: '#DDF5F3',
  },
  referral: {
    fit: 'cover',
    icon: { android: 'link', ios: 'link', web: 'link' },
    image: require('@/assets/images/sales-package-health.png'),
    wash: '#FFF3CF',
  },
};

const pageVisuals: Record<string, { fit?: 'contain' | 'cover'; image: ImageSourcePropType }> = {
  'admin-branches': { image: require('@/assets/images/product-preview-cancer.png') },
  'admin-catalog': { image: require('@/assets/images/sales-package-longevity.png') },
  'admin-dashboard': { image: require('@/assets/motion/mira-landing-motion-poster.png') },
  'admin-login': { image: require('@/assets/images/mira-care-mark.png'), fit: 'contain' },
  'admin-orders': { image: require('@/assets/images/product-preview-blood.png') },
  'admin-operations-hub': { image: require('@/assets/motion/mira-landing-motion-poster.png') },
  'admin-referrers-shared': { image: require('@/assets/images/mira-care-mark.png'), fit: 'contain' },
  'ai-chat-login': { image: require('@/assets/images/mira-care-app-icon.png'), fit: 'contain' },
  'ai-chat-orders': { image: require('@/assets/images/product-preview-heart.png') },
  'ai-chat-package-detail': { image: require('@/assets/images/sales-package-blood.png') },
  'ai-chat-prototype': { image: require('@/assets/images/mira-care-app-icon.png'), fit: 'contain' },
  'referral-admin-referrers': { image: require('@/assets/images/mira-care-mark.png'), fit: 'contain' },
  'referral-login': { image: require('@/assets/images/mira-care-mark.png'), fit: 'contain' },
  'referral-partner-workspace': { image: require('@/assets/images/sales-package-longevity.png') },
  'referral-public-entry': { image: require('@/assets/images/mira-care-mark.png'), fit: 'contain' },
  'referral-sales-portal': { image: require('@/assets/images/sales-package-health.png') },
};

export function generateStaticParams(): { module: ShowcaseModuleId }[] {
  return showcaseModules.map((module) => ({ module: module.id }));
}

export default function ShowcaseDirectoryScreen() {
  const params = useLocalSearchParams<{ module?: string }>();
  const module = findShowcaseModule(params.module);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const isCompact = width < 720;

  if (!module) {
    return <Redirect href="/" />;
  }

  const moduleId = module.id;
  const entries = getShowcaseEntriesForModule(moduleId, true);
  const availableCount = entries.filter((entry) => entry.href).length;
  const liveCount = entries.filter((entry) => entry.status === 'live').length;
  const protectedCount = entries.filter((entry) => entry.auth !== 'none').length;

  async function copyUrl(entry: ShowcaseEntry) {
    const url = buildTourUrl(entry.path, moduleId);

    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(url);
    }

    setCopiedId(entry.id);
    setTimeout(() => setCopiedId((current) => (current === entry.id ? null : current)), 1600);
  }

  return (
    <ShowcaseScreen maxWidth={1220}>
      <View style={[styles.topBar, isCompact ? styles.topBarCompact : null]}>
        <LinkButton href="/" label="กลับหน้ารวม" />
        <Image resizeMode="contain" source={logo} style={styles.logo} />
      </View>

      <ModuleHero availableCount={availableCount} entriesCount={entries.length} liveCount={liveCount} protectedCount={protectedCount} module={module} />

      <Panel style={[styles.scriptPanel, isCompact ? styles.scriptPanelCompact : null]}>
        <View style={[styles.panelHead, isCompact ? styles.panelHeadCompact : null]}>
          <View>
            <Text style={styles.panelKicker}>FLOW</Text>
            <Text style={styles.panelTitle}>ลำดับพรีเซนต์</Text>
          </View>
          <Text style={styles.panelMeta}>{module.script_th.length} ขั้นตอน</Text>
        </View>
        <View style={styles.scriptList}>
          {module.script_th.map((line, index) => (
            <View key={line} style={styles.scriptRow}>
              <Text style={[styles.scriptIndex, { backgroundColor: module.accent }]}>{index + 1}</Text>
              <Text style={styles.scriptText}>{line}</Text>
            </View>
          ))}
        </View>
      </Panel>

      <View style={[styles.routeGrid, isCompact ? styles.routeGridCompact : null]}>
        {entries.map((entry) => (
          <RouteCard copied={copiedId === entry.id} entry={entry} isCompact={isCompact} key={entry.id} moduleId={moduleId} onCopy={() => void copyUrl(entry)} />
        ))}
      </View>
    </ShowcaseScreen>
  );
}

function ModuleHero({
  availableCount,
  entriesCount,
  liveCount,
  module,
  protectedCount,
}: {
  availableCount: number;
  entriesCount: number;
  liveCount: number;
  module: ShowcaseModule;
  protectedCount: number;
}) {
  const visual = moduleVisuals[module.id];
  const { width } = useWindowDimensions();
  const isCompact = width < 720;

  return (
    <View style={[styles.hero, isCompact ? styles.heroCompact : null]}>
      <View style={[styles.heroVisual, isCompact ? styles.heroVisualCompact : null, { backgroundColor: visual.wash }]}>
        <Image
          resizeMode={isCompact ? 'cover' : visual.fit}
          source={visual.image}
          style={[
            styles.heroImage,
            visual.fit === 'contain' && !isCompact ? styles.heroImageContain : null,
            isCompact ? styles.heroImageCompact : null,
          ]}
        />
        <LinearGradient
          colors={isCompact ? ['rgba(7,29,73,0.10)', 'rgba(7,29,73,0.92)'] : ['rgba(249,253,255,0)', 'rgba(7,29,73,0.78)']}
          style={styles.heroScrim}
        />
        <View style={styles.heroVisualTop}>
          <View style={[styles.iconBadge, { backgroundColor: module.accent }]}>
            <SymbolView name={visual.icon} size={28} tintColor={MiraDesign.color.showcaseNavy} />
          </View>
          <Text style={styles.moduleNumber}>{moduleNumbers[module.id]}</Text>
        </View>
        <View style={styles.heroVisualBottom}>
          <Text style={styles.heroEyebrow}>{module.eyebrow}</Text>
          <Text style={[styles.heroTitle, isCompact ? styles.heroTitleCompact : null]}>{module.title}</Text>
        </View>
      </View>

      <View style={[styles.heroCopyPanel, isCompact ? styles.heroCopyPanelCompact : null]}>
        <Text style={styles.storyText}>{module.body}</Text>
        <View style={styles.heroStats}>
          <HeroMetric label="หน้าในหมวด" value={`${entriesCount}`} />
          <HeroMetric label="เปิดได้" value={`${availableCount}`} />
          <HeroMetric label="LIVE" value={`${liveCount}`} />
          <HeroMetric label="AUTH" value={`${protectedCount}`} />
        </View>
      </View>
    </View>
  );
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.heroMetric}>
      <Text style={styles.heroMetricValue}>{value}</Text>
      <Text style={styles.heroMetricLabel}>{label}</Text>
    </View>
  );
}

function RouteCard({
  copied,
  entry,
  isCompact,
  moduleId,
  onCopy,
}: {
  copied: boolean;
  entry: ShowcaseEntry;
  isCompact: boolean;
  moduleId: ShowcaseModuleId;
  onCopy: () => void;
}) {
  const visual = pageVisuals[entry.id] ?? { image: moduleVisuals[entry.module].image, fit: moduleVisuals[entry.module].fit };
  const isPlanned = entry.status === 'planned' || !entry.href;
  const imageFit = visual.fit ?? 'cover';

  return (
    <Panel style={[styles.routeCard, isCompact ? styles.routeCardCompact : null, isPlanned ? styles.routeCardPlanned : null]}>
      <View style={[styles.routeThumb, isCompact ? styles.routeThumbCompact : null]}>
        <Image resizeMode={imageFit} source={visual.image} style={[styles.routeImage, imageFit === 'contain' ? styles.routeImageContain : null, isCompact ? styles.routeImageCompact : null]} />
        <LinearGradient colors={['rgba(7,29,73,0)', 'rgba(7,29,73,0.62)']} style={styles.routeThumbScrim} />
        <View style={styles.routeThumbBadges}>
          <StatusChip status={entry.status} />
          <AuthChip auth={entry.auth} />
        </View>
      </View>

      <View style={styles.routeCopy}>
        <Text style={styles.routePath}>{entry.path}</Text>
        <Text style={styles.routeTitle}>{entry.label_th}</Text>
        <Text style={styles.routeBody}>{entry.description_th}</Text>
        {entry.sharedWithModule ? <Text style={styles.sharedNote}>ใช้ร่วมกับหมวด {entry.sharedWithModule}</Text> : null}
      </View>

      <View style={[styles.routeActions, isCompact ? styles.routeActionsCompact : null]}>
        {entry.href ? <LinkButton href={withTourHref(entry.href, moduleId)} label="เปิดหน้า" /> : <View style={styles.disabledButton}><Text style={styles.disabledButtonText}>ยังไม่เปิด</Text></View>}
        <Pressable disabled={isPlanned} onPress={onCopy} style={[styles.copyButton, isPlanned ? styles.copyButtonDisabled : null]}>
          <Text style={styles.copyButtonText}>{copied ? 'คัดลอกแล้ว' : 'คัดลอก URL'}</Text>
        </Pressable>
      </View>
    </Panel>
  );
}

function buildTourUrl(path: string, moduleId: ShowcaseModuleId) {
  const tourPath = `${path}${path.includes('?') ? '&' : '?'}tour=${moduleId}`;

  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    const basePath = window.location.pathname.startsWith('/showcase') ? '/showcase' : '';

    return `${window.location.origin}${basePath}${tourPath}`;
  }

  return tourPath;
}

const styles = StyleSheet.create({
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: MiraDesign.space.lg,
    justifyContent: 'space-between',
  },
  topBarCompact: {
    alignItems: 'flex-start',
    flexDirection: 'column-reverse',
    gap: MiraDesign.space.md,
  },
  logo: {
    height: 40,
    width: 160,
  },
  hero: {
    alignItems: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: MiraDesign.space.lg,
    width: '100%',
  },
  heroCompact: {
    gap: MiraDesign.space.md,
  },
  heroVisual: {
    borderColor: '#C6E0FA',
    borderRadius: MiraDesign.radius.sm,
    borderWidth: 1,
    flexBasis: 520,
    flexGrow: 1,
    minHeight: 370,
    minWidth: 300,
    overflow: 'hidden',
  },
  heroVisualCompact: {
    flexBasis: 'auto',
    minHeight: 280,
    minWidth: 0,
    width: '100%',
  },
  heroImage: {
    height: '100%',
    opacity: 0.96,
    position: 'absolute',
    width: '100%',
  },
  heroImageCompact: {
    opacity: 0.42,
  },
  heroImageContain: {
    height: '136%',
    right: -42,
    top: -58,
    width: '70%',
  },
  heroScrim: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  heroVisualTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: MiraDesign.space.lg,
  },
  iconBadge: {
    alignItems: 'center',
    borderRadius: MiraDesign.radius.sm,
    height: 54,
    justifyContent: 'center',
    width: 54,
  },
  moduleNumber: {
    color: MiraDesign.color.surface,
    fontSize: 14,
    fontWeight: '900',
  },
  heroVisualBottom: {
    bottom: 0,
    gap: MiraDesign.space.sm,
    left: 0,
    padding: MiraDesign.space.lg,
    position: 'absolute',
    right: 0,
  },
  heroEyebrow: {
    color: 'rgba(249,253,255,0.72)',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  heroTitle: {
    color: MiraDesign.color.surface,
    fontSize: 36,
    fontWeight: '900',
    lineHeight: 42,
  },
  heroTitleCompact: {
    fontSize: 33,
    lineHeight: 38,
  },
  heroCopyPanel: {
    backgroundColor: MiraDesign.color.showcaseSurface,
    borderColor: '#C6E0FA',
    borderRadius: MiraDesign.radius.sm,
    borderWidth: 1,
    flexBasis: 340,
    flexGrow: 1,
    gap: MiraDesign.space.lg,
    justifyContent: 'space-between',
    minWidth: 280,
    padding: MiraDesign.space.lg,
  },
  heroCopyPanelCompact: {
    flexBasis: 'auto',
    minWidth: 0,
    padding: MiraDesign.space.md,
    width: '100%',
  },
  storyText: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 28,
  },
  heroStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: MiraDesign.space.sm,
  },
  heroMetric: {
    backgroundColor: MiraDesign.color.showcaseBlueSoft,
    borderColor: '#BBD8F8',
    borderRadius: MiraDesign.radius.sm,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 120,
    padding: MiraDesign.space.md,
  },
  heroMetricValue: {
    color: MiraDesign.color.showcaseBlueDeep,
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 28,
  },
  heroMetricLabel: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 11,
    fontWeight: '900',
    marginTop: 3,
    textTransform: 'uppercase',
  },
  scriptPanel: {
    backgroundColor: MiraDesign.color.showcaseSurface,
  },
  scriptPanelCompact: {
    padding: MiraDesign.space.md,
  },
  panelHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  panelHeadCompact: {
    alignItems: 'flex-start',
    gap: MiraDesign.space.sm,
  },
  panelKicker: {
    color: MiraDesign.color.showcaseBlue,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  panelTitle: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 21,
    fontWeight: '900',
    marginTop: 3,
  },
  panelMeta: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 12,
    fontWeight: '900',
  },
  scriptList: {
    gap: MiraDesign.space.sm,
  },
  scriptRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: MiraDesign.space.md,
  },
  scriptIndex: {
    borderRadius: MiraDesign.radius.sm,
    color: MiraDesign.color.showcaseNavy,
    fontSize: 12,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  scriptText: {
    color: MiraDesign.color.showcaseNavy,
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 22,
  },
  routeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: MiraDesign.space.lg,
    width: '100%',
  },
  routeGridCompact: {
    gap: MiraDesign.space.md,
  },
  routeCard: {
    flexBasis: 340,
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 392,
    minWidth: 300,
    padding: 0,
  },
  routeCardCompact: {
    flexBasis: 'auto',
    minHeight: 0,
    minWidth: 0,
    width: '100%',
  },
  routeCardPlanned: {
    opacity: 0.64,
  },
  routeThumb: {
    backgroundColor: MiraDesign.color.showcaseCanvas,
    height: 162,
    overflow: 'hidden',
  },
  routeThumbCompact: {
    height: 112,
  },
  routeImage: {
    height: '100%',
    position: 'absolute',
    width: '100%',
  },
  routeImageContain: {
    height: '150%',
    right: -32,
    top: -40,
    width: '70%',
  },
  routeImageCompact: {
    opacity: 0.72,
  },
  routeThumbScrim: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  routeThumbBadges: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: MiraDesign.space.sm,
    padding: MiraDesign.space.md,
  },
  routeCopy: {
    flex: 1,
    gap: MiraDesign.space.sm,
    padding: MiraDesign.space.lg,
  },
  routePath: {
    color: MiraDesign.color.showcaseBlue,
    fontSize: 12,
    fontWeight: '900',
  },
  routeTitle: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 24,
  },
  routeBody: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 13,
    lineHeight: 20,
  },
  sharedNote: {
    color: MiraDesign.color.showcaseBlueDeep,
    fontSize: 12,
    fontWeight: '900',
  },
  routeActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: MiraDesign.space.sm,
    padding: MiraDesign.space.lg,
    paddingTop: 0,
  },
  routeActionsCompact: {
    alignItems: 'stretch',
    flexDirection: 'column',
    padding: MiraDesign.space.md,
    paddingTop: 0,
  },
  copyButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.showcaseSurface,
    borderColor: '#BBD8F8',
    borderRadius: MiraDesign.radius.sm,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: MiraDesign.space.lg,
  },
  copyButtonDisabled: {
    opacity: 0.55,
  },
  copyButtonText: {
    color: MiraDesign.color.showcaseBlueDeep,
    fontSize: 13,
    fontWeight: '900',
  },
  disabledButton: {
    alignItems: 'center',
    backgroundColor: '#E9EFF5',
    borderRadius: MiraDesign.radius.sm,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: MiraDesign.space.lg,
  },
  disabledButtonText: {
    color: MiraDesign.color.inkSoft,
    fontSize: 13,
    fontWeight: '900',
  },
});
