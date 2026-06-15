import { Link } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MiraDesign } from '@/constants/Design';

const heroMotion = require('@/assets/motion/mira-landing-motion.gif');

const landingColor = {
  blueBright: '#3F8EFC',
  canvasDark: '#07110F',
  canvasDeep: '#0F2825',
  coralSoft: '#F8A0A0',
  gold: '#E9B44C',
  mintBright: '#7DE3C3',
  onDark: '#F7FFFC',
  onDarkSoft: '#B8D5CF',
} as const;

const processSteps = [
  ['01', 'ต่อข้อมูลขององค์กร', 'นำสินค้า ราคา สาขา เงื่อนไขบริการ และชุดข้อมูลที่ทีมคุณใช้จริงมาเป็นฐานให้ Mira ทำงาน'],
  ['02', 'AI Chat แนะนำและปิดการขาย', 'คุยกับลูกค้าทีละขั้น ตอบข้อสงสัย แนะนำสินค้าที่เหมาะ และพาไปจองหรือชำระเงินใน flow เดียว'],
  ['03', 'Referral พาลูกค้าเข้าแชท', 'ลิงก์ของพาร์ทเนอร์หรือผู้แนะนำถูกผูก attribution ตั้งแต่ต้นทาง และให้ AI Chat ช่วยปิดการขายต่อ'],
  ['04', 'หลังบ้านจัดการได้เอง', 'ทีมคุณเพิ่มลบสินค้า ปรับแคมเปญ ดูออเดอร์ และตั้งค่าส่วนแบ่งของ referral ได้ตลอด'],
] as const;

const capabilityCards = [
  {
    accent: landingColor.mintBright,
    icon: { android: 'chat', ios: 'message.and.waveform.fill', web: 'chat' },
    title: 'AI Sales Chat',
    body: 'ปรับให้ตอบตามข้อมูลและ tone ขององค์กรคุณ เพื่อให้คำแนะนำที่ตรงกับสินค้าและบริการจริง',
  },
  {
    accent: landingColor.gold,
    icon: { android: 'link', ios: 'link', web: 'link' },
    title: 'Referral Engine',
    body: 'สร้างแคมเปญ referral ได้ง่าย ติดตามที่มา และคำนวณส่วนแบ่งตามเงื่อนไขที่องค์กรกำหนด',
  },
  {
    accent: landingColor.blueBright,
    icon: { android: 'admin_panel_settings', ios: 'slider.horizontal.3', web: 'admin_panel_settings' },
    title: 'Admin Console',
    body: 'ระบบหลังบ้านสำหรับ catalog, orders, branches, referrers และการดูสถานะงานขายแบบรวมศูนย์',
  },
] as const;

const suites = [
  {
    accent: landingColor.mintBright,
    label: 'MiraCare',
    title: 'สำหรับโรงพยาบาล',
    body: 'ตัวหลักคือ AI Chat + Referral ที่ปรับให้เหมาะกับโรงพยาบาล ทั้งภาษา flow การ consult และ CI ขององค์กร พร้อม Health Dashboard เป็น option เสริมสำหรับผลแลบ wearable และข้อมูลสุขภาพส่วนบุคคล',
  },
  {
    accent: landingColor.coralSoft,
    label: 'MiraBeauty',
    title: 'สำหรับคลินิกความงาม',
    body: 'แกนเดียวกันคือเพิ่มยอดขายผ่าน AI Chat และ Referral แต่ปรับสินค้า flow และภาพลักษณ์ให้เหมาะกับคลินิก พร้อมแนวทาง face scan สำหรับ consult ว่าลูกค้าควรทำ treatment ใดเพิ่ม',
  },
] as const;

export default function MiraLandingPage() {
  const { height, width } = useWindowDimensions();
  const isWide = width >= 900;
  const isCompact = width < 680;
  const heroHeight = Math.max(isCompact ? 660 : 620, Math.min(isCompact ? 760 : 720, height * 0.88));

  function openContact() {
    void Linking.openURL('mailto:hello@mira.com?subject=Mira%20demo%20request');
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <ScrollView bounces={false} showsVerticalScrollIndicator={false} style={styles.screen}>
        <View style={[styles.hero, { minHeight: heroHeight }]}>
          <Image resizeMode="cover" source={heroMotion} style={styles.heroMotion} />
          <LinearGradient
            colors={isWide ? ['rgba(7, 17, 15, 0.98)', 'rgba(7, 17, 15, 0.62)', 'rgba(7, 17, 15, 0.02)'] : ['rgba(7, 17, 15, 0.98)', 'rgba(7, 17, 15, 0.82)', 'rgba(7, 17, 15, 0.46)']}
            end={{ x: 1, y: 0.5 }}
            start={{ x: 0, y: 0.5 }}
            style={styles.heroOverlay}
          />

          <View style={[styles.heroInner, isWide ? styles.heroInnerWide : styles.heroInnerCompact, !isWide ? { maxWidth: width } : null]}>
            <View style={styles.nav}>
              <View style={styles.brandLockup}>
                <View style={styles.brandDot} />
                <Text style={styles.brandText}>Mira</Text>
              </View>
              {!isCompact ? (
                <Link href={{ pathname: '/tour/[module]', params: { module: 'ai-chat' } }} asChild>
                  <Pressable style={styles.navPill}>
                    <Text style={styles.navPillText}>Product Tour</Text>
                  </Pressable>
                </Link>
              ) : null}
            </View>

            <View style={[styles.heroCopy, isCompact ? { maxWidth: Math.max(280, width - 80) } : null]}>
              <Text style={styles.heroKicker}>AI Chat + Referral Sales System</Text>
              <Text style={[styles.heroTitle, isCompact ? styles.heroTitleCompact : null]}>Mira</Text>
              <Text style={[styles.heroSubtitle, isCompact ? styles.heroSubtitleCompact : null]}>
                ระบบที่ช่วยให้ลูกค้าคุยกับ AI, ได้คำแนะนำที่เหมาะกับข้อมูลขององค์กรคุณ, และถูกพาไปจนปิดการขายได้ในตัว
              </Text>
              <Text style={styles.heroBody}>
                คุณควบคุมสินค้า ราคา แคมเปญ referral และข้อมูลหลังบ้านได้เอง Mira ปรับให้เข้ากับโรงพยาบาล คลินิก หรือองค์กรสุขภาพของคุณได้ทั้ง PWA, App และ LINE OA
              </Text>

              <View style={styles.heroButtons}>
                <Pressable onPress={openContact} style={styles.primaryButton}>
                  <Text style={styles.primaryButtonText}>ขอดูเดโม</Text>
                  <SymbolView name={{ android: 'arrow_forward', ios: 'arrow.right', web: 'arrow_forward' }} size={18} tintColor={landingColor.canvasDark} />
                </Pressable>
                <Link href={{ pathname: '/tour/[module]', params: { module: 'referral' } }} asChild>
                  <Pressable style={styles.secondaryButton}>
                    <Text style={styles.secondaryButtonText}>ดู Referral Flow</Text>
                  </Pressable>
                </Link>
              </View>
            </View>

            <View style={[styles.heroProofRow, isCompact ? [styles.heroProofRowCompact, { maxWidth: Math.max(280, width - 40) }] : null]}>
              <HeroProof compact={isCompact} value="AI Chat" label="ให้คำแนะนำและ soft close จากข้อมูลจริง" />
              <HeroProof compact={isCompact} value="Referral" label="ผูก attribution และส่วนแบ่งอัตโนมัติ" />
              <HeroProof compact={isCompact} value="Admin" label="เพิ่มลบสินค้าและดูออเดอร์ได้เอง" />
            </View>
          </View>
        </View>

        <View style={styles.content}>
          <SectionIntro
            eyebrow="How Mira Works"
            title="แชทกับแคมเปญขายต้องทำงานด้วยกัน"
            body="หัวใจของ Mira ไม่ใช่แค่ chatbot แต่เป็นระบบขายที่เชื่อมข้อมูลสินค้า AI Chat, Referral Program และหลังบ้านเข้าด้วยกัน"
          />

          <View style={styles.processGrid}>
            {processSteps.map(([kicker, title, body]) => (
              <ProcessCard key={kicker} body={body} kicker={kicker} title={title} />
            ))}
          </View>

          <View style={[styles.band, styles.darkBand]}>
            <SectionIntro
              dark
              eyebrow="Core System"
              title="ปรับให้เข้ากับองค์กรของคุณ ไม่ใช่บังคับให้ทีมคุณเปลี่ยนวิธีขาย"
              body="Mira ออกแบบเป็น vendor platform: เราติดตั้ง ปรับข้อมูล ปรับ flow และเชื่อม surface ให้เหมาะกับบริบทของแต่ละองค์กร"
            />
            <View style={styles.capabilityGrid}>
              {capabilityCards.map((card) => (
                <CapabilityCard key={card.title} {...card} />
              ))}
            </View>
          </View>

          <View style={styles.channelBand}>
            <View style={styles.channelCopy}>
              <Text style={styles.sectionEyebrow}>Deployment</Text>
              <Text style={styles.channelTitle}>พร้อมไปได้หลายช่องทาง</Text>
              <Text style={styles.channelBody}>
                เริ่มจาก PWA เพื่อเปิดใช้เร็ว ขยายเป็น App เมื่ออยากมี experience เต็ม และต่อ LINE OA สำหรับตลาดไทยที่ลูกค้าเริ่มคุยจากแชทอยู่แล้ว
              </Text>
            </View>
            <View style={styles.channelPills}>
              {(['PWA', 'App', 'LINE OA'] as const).map((channel) => (
                <View key={channel} style={styles.channelPill}>
                  <Text style={styles.channelPillText}>{channel}</Text>
                </View>
              ))}
            </View>
          </View>

          <SectionIntro
            eyebrow="Solutions"
            title="เริ่มจากแกนเดียว แล้วปรับให้เหมาะกับอุตสาหกรรม"
            body="MiraCare และ MiraBeauty ใช้หัวใจเดียวกัน: AI Chat ทำงานร่วมกับ Referral เพื่อเพิ่มยอดขาย แต่คนละ context, คนละข้อมูล, คนละ flow"
          />

          <View style={styles.suiteGrid}>
            {suites.map((suite) => (
              <SuiteCard key={suite.label} {...suite} />
            ))}
          </View>

          <View style={styles.finalCta}>
            <Text style={styles.finalEyebrow}>Build Your Mira</Text>
            <Text style={styles.finalTitle}>ให้ระบบขายของคุณเริ่มจากบทสนทนาที่ปิดการขายได้จริง</Text>
            <Pressable onPress={openContact} style={styles.finalButton}>
              <Text style={styles.finalButtonText}>คุยเรื่องการปรับใช้กับองค์กรคุณ</Text>
              <SymbolView name={{ android: 'north_east', ios: 'arrow.up.right', web: 'north_east' }} size={18} tintColor={landingColor.onDark} />
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function HeroProof({ compact = false, label, value }: { compact?: boolean; label: string; value: string }) {
  return (
    <View style={[styles.heroProof, compact ? styles.heroProofCompact : null]}>
      <Text style={styles.heroProofValue}>{value}</Text>
      <Text style={styles.heroProofLabel}>{label}</Text>
    </View>
  );
}

function SectionIntro({ body, dark = false, eyebrow, title }: { body: string; dark?: boolean; eyebrow: string; title: string }) {
  return (
    <View style={styles.sectionIntro}>
      <Text style={[styles.sectionEyebrow, dark ? styles.sectionEyebrowDark : null]}>{eyebrow}</Text>
      <Text style={[styles.sectionTitle, dark ? styles.sectionTitleDark : null]}>{title}</Text>
      <Text style={[styles.sectionBody, dark ? styles.sectionBodyDark : null]}>{body}</Text>
    </View>
  );
}

function ProcessCard({ body, kicker, title }: { body: string; kicker: string; title: string }) {
  return (
    <View style={styles.processCard}>
      <Text style={styles.processKicker}>{kicker}</Text>
      <Text style={styles.processTitle}>{title}</Text>
      <Text style={styles.processBody}>{body}</Text>
    </View>
  );
}

function CapabilityCard({ accent, body, icon, title }: { accent: string; body: string; icon: ComponentProps<typeof SymbolView>['name']; title: string }) {
  return (
    <View style={styles.capabilityCard}>
      <View style={[styles.capabilityIcon, { backgroundColor: accent }]}>
        <SymbolView name={icon} size={24} tintColor={landingColor.canvasDark} />
      </View>
      <Text style={styles.capabilityTitle}>{title}</Text>
      <Text style={styles.capabilityBody}>{body}</Text>
    </View>
  );
}

function SuiteCard({ accent, body, label, title }: { accent: string; body: string; label: string; title: string }) {
  return (
    <View style={styles.suiteCard}>
      <View style={[styles.suiteAccent, { backgroundColor: accent }]} />
      <Text style={styles.suiteLabel}>{label}</Text>
      <Text style={styles.suiteTitle}>{title}</Text>
      <Text style={styles.suiteBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: landingColor.canvasDark, flex: 1 },
  screen: { backgroundColor: MiraDesign.color.canvas, flex: 1 },
  hero: { backgroundColor: landingColor.canvasDark, overflow: 'hidden', position: 'relative' },
  heroMotion: { bottom: 0, height: '100%', left: 0, opacity: 1, position: 'absolute', right: 0, top: 0, width: '100%' },
  heroOverlay: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  heroInner: { flex: 1, gap: MiraDesign.space.xl, justifyContent: 'space-between', padding: MiraDesign.space.xl, position: 'relative', width: '100%', zIndex: 2 },
  heroInnerCompact: { overflow: 'hidden' },
  heroInnerWide: { alignSelf: 'center', maxWidth: 1180, width: '100%' },
  nav: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  brandLockup: { alignItems: 'center', flexDirection: 'row', gap: MiraDesign.space.sm },
  brandDot: { backgroundColor: landingColor.mintBright, borderRadius: MiraDesign.radius.pill, height: 18, width: 18 },
  brandText: { color: landingColor.onDark, fontSize: 28, fontWeight: '900' },
  navPill: { alignItems: 'center', borderColor: 'rgba(247, 255, 252, 0.24)', borderRadius: MiraDesign.radius.sm, borderWidth: 1, minHeight: 40, paddingHorizontal: MiraDesign.space.md },
  navPillText: { color: landingColor.onDark, fontSize: 13, fontWeight: '900', lineHeight: 38 },
  heroCopy: { maxWidth: 650, width: '100%' },
  heroKicker: { color: landingColor.mintBright, fontSize: 12, fontWeight: '900', marginBottom: MiraDesign.space.md, textTransform: 'uppercase' },
  heroTitle: { color: landingColor.onDark, fontSize: 78, fontWeight: '900', lineHeight: 84 },
  heroTitleCompact: { fontSize: 56, lineHeight: 62 },
  heroSubtitle: { color: landingColor.onDark, fontSize: 25, fontWeight: '900', lineHeight: 34, marginTop: MiraDesign.space.lg, maxWidth: 620 },
  heroSubtitleCompact: { fontSize: 21, lineHeight: 29 },
  heroBody: { color: landingColor.onDarkSoft, fontSize: 15, fontWeight: '700', lineHeight: 23, marginTop: MiraDesign.space.md, maxWidth: 590 },
  heroButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: MiraDesign.space.sm, marginTop: MiraDesign.space.xl },
  primaryButton: { alignItems: 'center', backgroundColor: landingColor.mintBright, borderRadius: MiraDesign.radius.sm, flexDirection: 'row', gap: MiraDesign.space.sm, minHeight: 48, paddingHorizontal: MiraDesign.space.lg },
  primaryButtonText: { color: landingColor.canvasDark, fontSize: 15, fontWeight: '900' },
  secondaryButton: { alignItems: 'center', borderColor: 'rgba(247, 255, 252, 0.24)', borderRadius: MiraDesign.radius.sm, borderWidth: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: MiraDesign.space.lg },
  secondaryButtonText: { color: landingColor.onDark, fontSize: 15, fontWeight: '900' },
  heroProofRow: { flexDirection: 'row', flexWrap: 'wrap', gap: MiraDesign.space.sm },
  heroProofRowCompact: { flexDirection: 'column' },
  heroProof: { backgroundColor: 'rgba(247, 255, 252, 0.10)', borderColor: 'rgba(247, 255, 252, 0.16)', borderRadius: MiraDesign.radius.sm, borderWidth: 1, flexGrow: 1, maxWidth: 320, minWidth: 145, padding: MiraDesign.space.md },
  heroProofCompact: { maxWidth: '100%', minWidth: 0, width: '100%' },
  heroProofValue: { color: landingColor.onDark, fontSize: 16, fontWeight: '900' },
  heroProofLabel: { color: landingColor.onDarkSoft, fontSize: 12, fontWeight: '700', lineHeight: 18, marginTop: MiraDesign.space.xs },
  content: { alignSelf: 'center', gap: MiraDesign.space.xxl, maxWidth: 1180, padding: MiraDesign.space.xl, paddingBottom: 68, width: '100%' },
  sectionIntro: { gap: MiraDesign.space.sm, maxWidth: 760 },
  sectionEyebrow: { color: MiraDesign.color.primaryDeep, fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  sectionEyebrowDark: { color: landingColor.mintBright },
  sectionTitle: { color: MiraDesign.color.ink, fontSize: 34, fontWeight: '900', lineHeight: 41 },
  sectionTitleDark: { color: landingColor.onDark },
  sectionBody: { color: MiraDesign.color.inkSoft, fontSize: 15, fontWeight: '700', lineHeight: 23 },
  sectionBodyDark: { color: landingColor.onDarkSoft },
  processGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: MiraDesign.space.md },
  processCard: { backgroundColor: MiraDesign.color.surface, borderColor: MiraDesign.color.line, borderRadius: MiraDesign.radius.sm, borderWidth: 1, flexGrow: 1, gap: MiraDesign.space.sm, minHeight: 188, minWidth: 250, padding: MiraDesign.space.lg, width: '23%' },
  processKicker: { color: MiraDesign.color.primaryDeep, fontSize: 13, fontWeight: '900' },
  processTitle: { color: MiraDesign.color.ink, fontSize: 18, fontWeight: '900', lineHeight: 24 },
  processBody: { color: MiraDesign.color.inkSoft, fontSize: 13, fontWeight: '700', lineHeight: 20 },
  band: { borderRadius: MiraDesign.radius.sm, gap: MiraDesign.space.xl, padding: MiraDesign.space.xl },
  darkBand: { backgroundColor: landingColor.canvasDark },
  capabilityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: MiraDesign.space.md },
  capabilityCard: { backgroundColor: 'rgba(247, 255, 252, 0.09)', borderColor: 'rgba(247, 255, 252, 0.14)', borderRadius: MiraDesign.radius.sm, borderWidth: 1, flexGrow: 1, gap: MiraDesign.space.md, minHeight: 210, minWidth: 260, padding: MiraDesign.space.lg, width: '31%' },
  capabilityIcon: { alignItems: 'center', borderRadius: MiraDesign.radius.sm, height: 48, justifyContent: 'center', width: 48 },
  capabilityTitle: { color: landingColor.onDark, fontSize: 20, fontWeight: '900' },
  capabilityBody: { color: landingColor.onDarkSoft, fontSize: 13, fontWeight: '700', lineHeight: 20 },
  channelBand: { alignItems: 'center', backgroundColor: MiraDesign.color.surfaceTint, borderColor: MiraDesign.color.line, borderRadius: MiraDesign.radius.sm, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: MiraDesign.space.xl, justifyContent: 'space-between', padding: MiraDesign.space.xl },
  channelCopy: { flex: 1, gap: MiraDesign.space.sm, minWidth: 260 },
  channelTitle: { color: MiraDesign.color.ink, fontSize: 28, fontWeight: '900', lineHeight: 34 },
  channelBody: { color: MiraDesign.color.inkSoft, fontSize: 14, fontWeight: '700', lineHeight: 22 },
  channelPills: { flexDirection: 'row', flexWrap: 'wrap', gap: MiraDesign.space.sm },
  channelPill: { alignItems: 'center', backgroundColor: MiraDesign.color.surface, borderColor: MiraDesign.color.line, borderRadius: MiraDesign.radius.sm, borderWidth: 1, minHeight: 54, minWidth: 112, paddingHorizontal: MiraDesign.space.lg },
  channelPillText: { color: MiraDesign.color.primaryDeep, fontSize: 16, fontWeight: '900', lineHeight: 52 },
  suiteGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: MiraDesign.space.md },
  suiteCard: { backgroundColor: MiraDesign.color.surface, borderColor: MiraDesign.color.line, borderRadius: MiraDesign.radius.sm, borderWidth: 1, flexGrow: 1, gap: MiraDesign.space.sm, minHeight: 238, minWidth: 290, overflow: 'hidden', padding: MiraDesign.space.lg, width: '48%' },
  suiteAccent: { borderRadius: MiraDesign.radius.pill, height: 8, width: 72 },
  suiteLabel: { color: MiraDesign.color.primaryDeep, fontSize: 13, fontWeight: '900' },
  suiteTitle: { color: MiraDesign.color.ink, fontSize: 25, fontWeight: '900', lineHeight: 31 },
  suiteBody: { color: MiraDesign.color.inkSoft, fontSize: 14, fontWeight: '700', lineHeight: 22 },
  finalCta: { backgroundColor: landingColor.canvasDeep, borderRadius: MiraDesign.radius.sm, gap: MiraDesign.space.md, padding: MiraDesign.space.xl },
  finalEyebrow: { color: landingColor.gold, fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  finalTitle: { color: landingColor.onDark, fontSize: 32, fontWeight: '900', lineHeight: 39, maxWidth: 760 },
  finalButton: { alignItems: 'center', alignSelf: 'flex-start', borderColor: 'rgba(247, 255, 252, 0.22)', borderRadius: MiraDesign.radius.sm, borderWidth: 1, flexDirection: 'row', gap: MiraDesign.space.sm, minHeight: 50, paddingHorizontal: MiraDesign.space.lg },
  finalButtonText: { color: landingColor.onDark, fontSize: 15, fontWeight: '900' },
});
