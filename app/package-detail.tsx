import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { ActionButton, BrandHeader, Card, Pill, Screen, SectionHeader } from '@/components/MiraUI';
import { MiraDesign } from '@/constants/Design';
import {
  getProductCategoryLabel,
  loadActiveHospitalProducts,
  type HospitalProduct,
} from '@/lib/marketplace/hospitalProducts';
import { showcaseDemoProducts } from '@/lib/showcase/demoFixtures';
import { useTenantConfig } from '@/lib/tenant/useTenantConfig';

function resolveParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatMoney(amount: number) {
  return `${amount.toLocaleString('th-TH')} THB`;
}

export default function PackageDetailScreen() {
  const params = useLocalSearchParams();
  const vocab = useTenantConfig().config.vocabulary;
  const productId = resolveParam(params.productId);
  const catalogKey = resolveParam(params.catalogKey);
  const [products, setProducts] = useState<HospitalProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const product = useMemo(
    () => products.find((item) => item.id === productId || item.catalogKey === catalogKey) ?? products[0] ?? null,
    [catalogKey, productId, products],
  );

  useEffect(() => {
    let isMounted = true;

    loadActiveHospitalProducts(80)
      .then((items) => {
        if (isMounted) {
          setProducts(items.length ? items : showcaseDemoProducts);
        }
      })
      .catch(() => {
        if (isMounted) {
          setProducts(showcaseDemoProducts);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (isLoading) {
    return (
      <Screen>
        <BrandHeader eyebrow={`รายละเอียด${vocab.productTerm}`} title={`กำลังโหลด${vocab.productTerm}`} compact />
      </Screen>
    );
  }

  if (!product) {
    return (
      <Screen>
        <BrandHeader eyebrow={`รายละเอียด${vocab.productTerm}`} title={`ยังไม่พบ${vocab.productTerm}`} subtitle={`${vocab.productTerm}นี้ยังไม่เปิดใช้งานในแค็ตตาล็อกของ tenant`} compact />
        <Link href="/" asChild>
          <ActionButton label="กลับหน้าโมดูล" variant="secondary" />
        </Link>
      </Screen>
    );
  }

  const includes = product.includes.length ? product.includes : [product.description];

  return (
    <Screen>
      <BrandHeader
        eyebrow={`รายละเอียด${vocab.productTerm}`}
        title={product.title}
        subtitle={`${product.hospitalName} - ${product.hospitalAddress ?? product.location ?? `ยืนยันกับ${vocab.providerTerm}`}`}
        compact
      />

      {product.imageUrl ? <Image source={{ uri: product.imageUrl }} resizeMode="cover" style={styles.productImage} /> : null}

      <Card>
        <View style={styles.priceRow}>
          <Text style={styles.price}>{formatMoney(product.priceAmount)}</Text>
          <Pill label={getProductCategoryLabel(product.category)} />
        </View>
        <Text style={styles.body}>{product.description}</Text>
      </Card>

      <Card>
        <Text style={styles.cardTitle}>รายละเอียดในแค็ตตาล็อก</Text>
        <View style={styles.detailGrid}>
          <Detail label="รหัสแค็ตตาล็อก" value={product.catalogKey} />
          <Detail label="การจอง" value={product.requiresAppointment ? 'ต้องนัดหมาย' : 'Walk-in ได้'} />
          <Detail label={vocab.branchTerm} value={product.hospitalAddress ?? product.location ?? `ยืนยันกับ${vocab.providerTerm}`} />
        </View>
      </Card>

      <SectionHeader title={`รายการที่รวมใน${vocab.productTerm}`} meta={`${includes.length} รายการ`} />
      {includes.map((item, index) => (
        <View key={`${item}-${index}`} style={styles.includeRow}>
          <Text style={styles.includeNumber}>{index + 1}</Text>
          <Text style={styles.includeText}>{item}</Text>
        </View>
      ))}

      <Link href="/user-profile" asChild>
        <ActionButton label="ดูคำสั่งซื้อของฉัน" />
      </Link>
      <Link href="/" asChild>
        <ActionButton label="กลับหน้าโมดูล" variant="secondary" />
      </Link>
    </Screen>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailCell}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text numberOfLines={2} style={styles.detailValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  productImage: {
    backgroundColor: MiraDesign.color.showcaseBlueSoft,
    borderRadius: MiraDesign.radius.md,
    height: 190,
    width: '100%',
  },
  priceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  price: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 28,
    fontWeight: '900',
  },
  body: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 14,
    lineHeight: 21,
  },
  cardTitle: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 18,
    fontWeight: '900',
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: MiraDesign.space.sm,
  },
  detailCell: {
    backgroundColor: MiraDesign.color.showcaseSurface,
    borderColor: MiraDesign.color.showcaseLine,
    borderRadius: MiraDesign.radius.md,
    borderWidth: 1,
    flexBasis: '31%',
    flexGrow: 1,
    gap: MiraDesign.space.xs,
    padding: MiraDesign.space.md,
  },
  detailLabel: {
    color: MiraDesign.color.showcaseNavySoft,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  detailValue: {
    color: MiraDesign.color.showcaseNavy,
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 19,
  },
  includeRow: {
    alignItems: 'center',
    backgroundColor: MiraDesign.color.showcaseSurface,
    borderColor: '#E6F1FA',
    borderRadius: MiraDesign.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: MiraDesign.space.md,
    minHeight: 64,
    paddingHorizontal: MiraDesign.space.lg,
  },
  includeNumber: {
    backgroundColor: MiraDesign.color.showcaseBlue,
    borderRadius: MiraDesign.radius.pill,
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    height: 30,
    lineHeight: 30,
    textAlign: 'center',
    width: 30,
  },
  includeText: {
    color: MiraDesign.color.showcaseNavy,
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
  },
});
