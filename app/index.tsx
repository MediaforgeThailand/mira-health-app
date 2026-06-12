import { Link } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import type { ImageSourcePropType } from 'react-native';
import { Image, ImageBackground, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MiraDesign } from '@/constants/Design';
import { showcaseModules, type ShowcaseModule, type ShowcaseModuleId } from '@/lib/showcase/registry';

const logo = require('@/assets/images/mira-care-logo.png');

const moduleImages: Record<ShowcaseModuleId, ImageSourcePropType> = {
  admin: require('@/assets/images/product-preview-longevity.png'),
  'ai-chat': require('@/assets/images/product-preview-heart.png'),
  health: require('@/assets/images/mockup-health-check-results.png'),
  referral: require('@/assets/images/mira-care-mark.png'),
};

const moduleIcons = {
  admin: { android: 'admin_panel_settings', ios: 'slider.horizontal.3', web: 'admin_panel_settings' },
  'ai-chat': { android: 'chat', ios: 'message.and.waveform.fill', web: 'chat' },
  health: { android: 'monitor_heart', ios: 'heart.text.square.fill', web: 'monitor_heart' },
  referral: { android: 'link', ios: 'link', web: 'link' },
} as const;

const totalPages = showcaseModules.reduce((sum, module) => sum + module.pages.length, 0);

export default function ProductOverviewScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= 860;
  const isCompact = width < 620;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={[styles.container, isWide ? styles.containerWide : null]} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <Image resizeMode="contain" source={logo} style={styles.logo} />
          <View style={styles.deckBadge}>
            <SymbolView name={{ ios: 'play.rectangle.fill', android: 'play_circle', web: 'play_circle' }} size={18} tintColor={MiraDesign.color.primaryDeep} />
            <Text style={styles.deckBadgeText}>Presenter</Text>
          </View>
        </View>

        <View style={[styles.hero, !isWide ? styles.heroStack : null]}>
          <View style={styles.heroCopy}>
            <Text style={styles.kicker}>SHOWCASE</Text>
            <Text style={[styles.title, isCompact ? styles.titleCompact : null]}>เลือกฉากที่จะเปิด</Text>
          </View>
          <View style={styles.statsRail}>
            <StatBlock value={showcaseModules.length} label="หมวด" />
            <StatBlock value={totalPages} label="หน้า" />
            <StatBlock value="0" label="login" />
          </View>
        </View>

        <View style={styles.moduleGrid}>
          {showcaseModules.map((module, index) => (
            <ModuleTile key={module.id} index={index} isWide={isWide} module={module} />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatBlock({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.statBlock}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ModuleTile({ index, isWide, module }: { index: number; isWide: boolean; module: ShowcaseModule }) {
  const previewPages = module.pages.slice(0, 3);

  return (
    <Link href={{ pathname: '/showcase/[module]', params: { module: module.id } }} asChild>
      <Pressable style={StyleSheet.flatten([styles.moduleTile, isWide ? styles.moduleTileWide : styles.moduleTileStacked])}>
        <ImageBackground imageStyle={styles.tileImage} resizeMode="cover" source={moduleImages[module.id]} style={styles.tileImageWrap}>
          <LinearGradient colors={['rgba(7, 17, 15, 0.02)', 'rgba(7, 17, 15, 0.82)']} style={styles.tileOverlay}>
            <View style={styles.tileTop}>
              <View style={[styles.moduleIcon, { backgroundColor: module.accent }]}>
                <SymbolView name={moduleIcons[module.id]} size={26} tintColor={MiraDesign.color.ink} />
              </View>
              <View style={styles.tileIndex}>
                <Text style={styles.tileIndexText}>{String(index + 1).padStart(2, '0')}</Text>
              </View>
            </View>

            <View style={styles.tileBottom}>
              <View style={styles.tileTitleLine}>
                <Text numberOfLines={1} style={styles.moduleTitle}>
                  {module.title}
                </Text>
                <View style={[styles.routeCount, { backgroundColor: module.accent }]}>
                  <Text style={styles.routeCountText}>{module.pages.length}</Text>
                </View>
              </View>

              <View style={styles.previewStrip}>
                {previewPages.map((page) => (
                  <View key={page.id} style={styles.previewChip}>
                    <Text numberOfLines={1} style={styles.previewChipText}>
                      {page.label}
                    </Text>
                  </View>
                ))}
              </View>

              <View style={styles.openRow}>
                <Text style={[styles.openText, { color: module.accent }]}>เปิดหมวด</Text>
                <SymbolView name={{ ios: 'arrow.up.right', android: 'open_in_new', web: 'open_in_new' }} size={18} tintColor={module.accent} />
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
  logo: {
    height: 42,
    width: 168,
  },
  deckBadge: {
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
  deckBadgeText: {
    color: MiraDesign.color.ink,
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  hero: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: MiraDesign.space.lg,
    justifyContent: 'space-between',
  },
  heroStack: {
    alignItems: 'stretch',
    flexDirection: 'column',
  },
  heroCopy: {
    gap: MiraDesign.space.xs,
  },
  kicker: {
    color: MiraDesign.color.primaryDeep,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  title: {
    color: MiraDesign.color.ink,
    fontSize: 44,
    fontWeight: '900',
    lineHeight: 50,
  },
  titleCompact: {
    fontSize: 34,
    lineHeight: 40,
  },
  statsRail: {
    flexDirection: 'row',
    gap: MiraDesign.space.sm,
  },
  statBlock: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.surface,
    borderColor: MiraDesign.color.line,
    borderRadius: MiraDesign.radius.sm,
    borderWidth: 1,
    minWidth: 78,
    paddingHorizontal: MiraDesign.space.md,
    paddingVertical: MiraDesign.space.sm,
  },
  statValue: {
    color: MiraDesign.color.ink,
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 28,
  },
  statLabel: {
    color: MiraDesign.color.inkSoft,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  moduleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: MiraDesign.space.lg,
  },
  moduleTile: {
    borderRadius: MiraDesign.radius.sm,
    minHeight: 330,
    overflow: 'hidden',
  },
  moduleTileWide: {
    width: '48.6%',
  },
  moduleTileStacked: {
    width: '100%',
  },
  tileImageWrap: {
    flex: 1,
    minHeight: 330,
  },
  tileImage: {
    borderRadius: MiraDesign.radius.sm,
  },
  tileOverlay: {
    flex: 1,
    justifyContent: 'space-between',
    padding: MiraDesign.space.lg,
  },
  tileTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  moduleIcon: {
    alignItems: 'center',
    borderRadius: MiraDesign.radius.sm,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  tileIndex: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderColor: 'rgba(255, 255, 255, 0.34)',
    borderRadius: MiraDesign.radius.sm,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 50,
  },
  tileIndexText: {
    color: MiraDesign.color.surface,
    fontSize: 13,
    fontWeight: '900',
  },
  tileBottom: {
    gap: MiraDesign.space.md,
  },
  tileTitleLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: MiraDesign.space.sm,
    justifyContent: 'space-between',
  },
  moduleTitle: {
    color: MiraDesign.color.surface,
    flex: 1,
    fontSize: 30,
    fontWeight: '900',
    lineHeight: 36,
  },
  routeCount: {
    alignItems: 'center',
    borderRadius: MiraDesign.radius.sm,
    height: 38,
    justifyContent: 'center',
    width: 42,
  },
  routeCountText: {
    color: MiraDesign.color.ink,
    fontSize: 14,
    fontWeight: '900',
  },
  previewStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: MiraDesign.space.sm,
  },
  previewChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderColor: 'rgba(255, 255, 255, 0.26)',
    borderRadius: MiraDesign.radius.sm,
    borderWidth: 1,
    maxWidth: 176,
    paddingHorizontal: MiraDesign.space.sm,
    paddingVertical: MiraDesign.space.xs,
  },
  previewChipText: {
    color: MiraDesign.color.surface,
    fontSize: 12,
    fontWeight: '800',
  },
  openRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: MiraDesign.space.sm,
  },
  openText: {
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
});
