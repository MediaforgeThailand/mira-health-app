import { Link, Redirect, useLocalSearchParams } from 'expo-router';
import type { Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import type { ImageSourcePropType } from 'react-native';
import { Image, ImageBackground, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MiraDesign } from '@/constants/Design';
import { findShowcaseModule, type ShowcaseModuleId, type ShowcasePage } from '@/lib/showcase/registry';

const logo = require('@/assets/images/mira-care-logo.png');

const moduleImages: Record<ShowcaseModuleId, ImageSourcePropType> = {
  admin: require('@/assets/images/product-preview-longevity.png'),
  'ai-chat': require('@/assets/images/product-preview-heart.png'),
  health: require('@/assets/images/mockup-body-overview.png'),
  referral: require('@/assets/images/mira-care-mark.png'),
};

const moduleIcons = {
  admin: { android: 'admin_panel_settings', ios: 'slider.horizontal.3', web: 'admin_panel_settings' },
  'ai-chat': { android: 'chat', ios: 'message.and.waveform.fill', web: 'chat' },
  health: { android: 'monitor_heart', ios: 'heart.text.square.fill', web: 'monitor_heart' },
  referral: { android: 'link', ios: 'link', web: 'link' },
} as const;

const pageImages: Record<string, ImageSourcePropType> = {
  'admin-branches': require('@/assets/images/product-preview-cancer.png'),
  'admin-catalog': require('@/assets/images/product-preview-longevity.png'),
  'admin-orders': require('@/assets/images/product-preview-blood.png'),
  'admin-referrers-shared': require('@/assets/images/mira-care-mark.png'),
  'ai-chat-orders': require('@/assets/images/product-preview-heart.png'),
  'ai-chat-package-detail': require('@/assets/images/product-preview-blood.png'),
  'ai-chat-prototype': require('@/assets/images/mira-care-app-icon.png'),
  'health-body-overview': require('@/assets/images/mockup-body-overview.png'),
  'health-lab-results': require('@/assets/images/mockup-health-check-results.png'),
  'health-overview-tab': require('@/assets/images/mockup-body-overview.png'),
  'health-user-profile': require('@/assets/images/mira-care-app-icon.png'),
  'health-wearable': require('@/assets/images/mockup-wearable-health.png'),
  'referral-admin-referrers': require('@/assets/images/mira-care-mark.png'),
  'referral-partner-workspace': require('@/assets/images/product-preview-longevity.png'),
  'referral-public-entry': require('@/assets/images/mira-care-mark.png'),
};

export default function ShowcaseDirectoryScreen() {
  const params = useLocalSearchParams<{ module?: string }>();
  const module = findShowcaseModule(params.module);
  const { width } = useWindowDimensions();
  const isWide = width >= 920;
  const isCompact = width < 640;

  if (!module) {
    return <Redirect href="/" />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={[styles.container, isWide ? styles.containerWide : null]} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <Link href="/" asChild>
            <Pressable style={styles.backButton}>
              <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={18} tintColor={MiraDesign.color.ink} />
              <Text style={styles.backText}>กลับ</Text>
            </Pressable>
          </Link>
          <Image resizeMode="contain" source={logo} style={styles.logo} />
        </View>

        <View style={[styles.hero, !isWide ? styles.heroStack : null]}>
          <ImageBackground imageStyle={styles.heroImage} resizeMode="cover" source={moduleImages[module.id]} style={styles.heroVisual}>
            <LinearGradient colors={['rgba(7, 17, 15, 0.02)', 'rgba(7, 17, 15, 0.78)']} style={styles.heroOverlay}>
              <View style={[styles.moduleIcon, { backgroundColor: module.accent }]}>
                <SymbolView name={moduleIcons[module.id]} size={28} tintColor={MiraDesign.color.ink} />
              </View>
              <View style={styles.heroTitleBlock}>
                <Text style={[styles.heroTitle, isCompact ? styles.heroTitleCompact : null]}>{module.title}</Text>
                <View style={styles.heroMetaRow}>
                  <View style={styles.metaPill}>
                    <Text style={styles.metaText}>{module.pages.length} หน้า</Text>
                  </View>
                  <View style={styles.metaPill}>
                    <Text style={styles.metaText}>ไม่ต้องล็อกอิน</Text>
                  </View>
                </View>
              </View>
            </LinearGradient>
          </ImageBackground>

          <View style={[styles.launchPanel, !isWide ? styles.launchPanelStacked : null]}>
            <Text style={styles.panelKicker}>เลือกหน้า</Text>
            <Text style={styles.panelTitle}>กด tile เพื่อเปิดทันที</Text>
            <View style={styles.routeDots}>
              {module.pages.map((page, index) => (
                <View key={page.id} style={[styles.routeDot, { backgroundColor: index === 0 ? module.accent : MiraDesign.color.line }]} />
              ))}
            </View>
          </View>
        </View>

        <View style={styles.routeGrid}>
          {module.pages.map((page, index) => (
            <RouteTile key={page.id} accent={module.accent} index={index} isWide={isWide} page={page} />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function RouteTile({ accent, index, isWide, page }: { accent: string; index: number; isWide: boolean; page: ShowcasePage }) {
  const image = pageImages[page.id] ?? moduleImages[page.module];

  return (
    <Link href={page.href as Href} asChild>
      <Pressable style={StyleSheet.flatten([styles.routeTile, isWide ? styles.routeTileWide : styles.routeTileStacked])}>
        <ImageBackground imageStyle={styles.routeImage} resizeMode="cover" source={image} style={styles.routeImageWrap}>
          <LinearGradient colors={['rgba(7, 17, 15, 0.03)', 'rgba(7, 17, 15, 0.80)']} style={styles.routeOverlay}>
            <View style={styles.routeTop}>
              <Text style={styles.routeIndex}>{String(index + 1).padStart(2, '0')}</Text>
              <View style={[styles.statusBadge, { backgroundColor: accent }]}>
                <Text style={styles.statusText}>{page.badge}</Text>
              </View>
            </View>

            <View style={styles.routeBottom}>
              <Text numberOfLines={2} style={styles.routeTitle}>
                {page.label}
              </Text>
              <View style={styles.routeActionRow}>
                <Text numberOfLines={1} style={styles.routePath}>
                  {page.path}
                </Text>
                <View style={styles.openIcon}>
                  <SymbolView name={{ ios: 'arrow.up.right', android: 'open_in_new', web: 'open_in_new' }} size={18} tintColor={MiraDesign.color.surface} />
                </View>
              </View>
            </View>
          </LinearGradient>
        </ImageBackground>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: MiraDesign.color.canvas,
    flex: 1,
  },
  container: {
    gap: MiraDesign.space.xl,
    padding: MiraDesign.space.xl,
    paddingBottom: 44,
  },
  containerWide: {
    alignSelf: 'center',
    maxWidth: 1180,
    width: '100%',
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: MiraDesign.radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: MiraDesign.space.sm,
    minHeight: 42,
    paddingHorizontal: MiraDesign.space.md,
  },
  backText: {
    color: MiraDesign.color.ink,
    fontSize: 13,
    fontWeight: '900',
  },
  logo: {
    height: 42,
    width: 160,
  },
  hero: {
    flexDirection: 'row',
    gap: MiraDesign.space.lg,
  },
  heroStack: {
    flexDirection: 'column',
  },
  heroVisual: {
    borderRadius: MiraDesign.radius.sm,
    flex: 1,
    minHeight: 330,
    overflow: 'hidden',
  },
  heroImage: {
    borderRadius: MiraDesign.radius.sm,
  },
  heroOverlay: {
    flex: 1,
    justifyContent: 'space-between',
    padding: MiraDesign.space.lg,
  },
  moduleIcon: {
    alignItems: 'center',
    borderRadius: MiraDesign.radius.sm,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  heroTitleBlock: {
    gap: MiraDesign.space.md,
  },
  heroTitle: {
    color: MiraDesign.color.surface,
    fontSize: 46,
    fontWeight: '900',
    lineHeight: 52,
  },
  heroTitleCompact: {
    fontSize: 34,
    lineHeight: 40,
  },
  heroMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: MiraDesign.space.sm,
  },
  metaPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderColor: 'rgba(255, 255, 255, 0.26)',
    borderRadius: MiraDesign.radius.sm,
    borderWidth: 1,
    paddingHorizontal: MiraDesign.space.md,
    paddingVertical: MiraDesign.space.sm,
  },
  metaText: {
    color: MiraDesign.color.surface,
    fontSize: 12,
    fontWeight: '900',
  },
  launchPanel: {
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: MiraDesign.radius.sm,
    borderWidth: 1,
    gap: MiraDesign.space.md,
    justifyContent: 'space-between',
    minHeight: 180,
    padding: MiraDesign.space.lg,
    width: 260,
  },
  launchPanelStacked: {
    width: '100%',
  },
  panelKicker: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  panelTitle: {
    color: MiraDesign.color.ink,
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 34,
  },
  routeDots: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: MiraDesign.space.sm,
  },
  routeDot: {
    borderRadius: MiraDesign.radius.pill,
    height: 10,
    width: 28,
  },
  routeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: MiraDesign.space.lg,
  },
  routeTile: {
    borderRadius: MiraDesign.radius.sm,
    minHeight: 238,
    overflow: 'hidden',
  },
  routeTileWide: {
    width: '31.9%',
  },
  routeTileStacked: {
    width: '100%',
  },
  routeImageWrap: {
    flex: 1,
    minHeight: 238,
  },
  routeImage: {
    borderRadius: MiraDesign.radius.sm,
  },
  routeOverlay: {
    flex: 1,
    justifyContent: 'space-between',
    padding: MiraDesign.space.md,
  },
  routeTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  routeIndex: {
    color: MiraDesign.color.surface,
    fontSize: 13,
    fontWeight: '900',
  },
  statusBadge: {
    borderRadius: MiraDesign.radius.sm,
    paddingHorizontal: MiraDesign.space.sm,
    paddingVertical: MiraDesign.space.xs,
  },
  statusText: {
    color: MiraDesign.color.ink,
    fontSize: 10,
    fontWeight: '900',
  },
  routeBottom: {
    gap: MiraDesign.space.md,
  },
  routeTitle: {
    color: MiraDesign.color.surface,
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 29,
  },
  routeActionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: MiraDesign.space.sm,
    justifyContent: 'space-between',
  },
  routePath: {
    color: 'rgba(255, 255, 255, 0.78)',
    flex: 1,
    fontSize: 12,
    fontWeight: '800',
  },
  openIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderColor: 'rgba(255, 255, 255, 0.28)',
    borderRadius: MiraDesign.radius.sm,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
});
