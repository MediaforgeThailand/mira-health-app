import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { ActionButton, BrandHeader, Card, Pill, Screen } from '@/components/MiraUI';
import { MiraDesign } from '@/constants/Design';
import {
  getProductCategoryLabel,
  loadActiveHospitalProducts,
  type HospitalProduct,
} from '@/lib/marketplace/hospitalProducts';

function resolveParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatMoney(amount: number) {
  return `${amount.toLocaleString('th-TH')} THB`;
}

export default function CheckoutScreen() {
  const params = useLocalSearchParams();
  const productId = resolveParam(params.productId);
  const [products, setProducts] = useState<HospitalProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const product = useMemo(() => products.find((item) => item.id === productId) ?? products[0] ?? null, [productId, products]);

  useEffect(() => {
    let isMounted = true;

    loadActiveHospitalProducts(20)
      .then((items) => {
        if (isMounted) {
          setProducts(items);
        }
      })
      .catch(() => {
        if (isMounted) {
          setProducts([]);
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

  return (
    <Screen>
      <BrandHeader
        eyebrow="Checkout"
        title="Order follow-up"
        subtitle="Customer orders now stay in the shared order workflow; use the order list, partner workspace, or admin queue to manage the next step."
        compact
      />

      {isLoading ? (
        <Card>
          <Text style={styles.body}>Loading active catalog...</Text>
        </Card>
      ) : null}

      {!isLoading && !product ? (
        <Card>
          <Text style={styles.cardTitle}>No active products</Text>
          <Text style={styles.body}>Publish a tenant product before starting checkout.</Text>
          <Link href="/" asChild>
            <ActionButton label="Back to overview" variant="secondary" />
          </Link>
        </Card>
      ) : null}

      {product ? (
        <Card>
          {product.imageUrl ? <Image source={{ uri: product.imageUrl }} resizeMode="cover" style={styles.productImage} /> : null}
          <View style={styles.productHeader}>
            <View style={styles.productCopy}>
              <Text style={styles.productTitle}>{product.title}</Text>
              <Text style={styles.productMeta}>{product.hospitalName}</Text>
            </View>
            <Text style={styles.price}>{formatMoney(product.priceAmount)}</Text>
          </View>
          <Text style={styles.body}>{product.description}</Text>
          <View style={styles.pillRow}>
            <Pill label={product.catalogKey} tone="blue" />
            <Pill label={getProductCategoryLabel(product.category)} tone="mint" />
          </View>
          <Link href="/orders" asChild>
            <ActionButton label="View orders" />
          </Link>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  productImage: {
    backgroundColor: MiraDesign.color.surfaceSoft,
    borderRadius: MiraDesign.radius.md,
    height: 180,
    width: '100%',
  },
  productHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: MiraDesign.space.md,
    justifyContent: 'space-between',
  },
  productCopy: {
    flex: 1,
    gap: MiraDesign.space.xs,
  },
  productTitle: {
    color: MiraDesign.color.ink,
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 25,
  },
  productMeta: {
    color: MiraDesign.color.inkSoft,
    fontSize: 13,
    fontWeight: '800',
  },
  price: {
    color: MiraDesign.color.ink,
    fontSize: 15,
    fontWeight: '900',
  },
  cardTitle: {
    color: MiraDesign.color.ink,
    fontSize: 18,
    fontWeight: '900',
  },
  body: {
    color: MiraDesign.color.inkSoft,
    fontSize: 14,
    lineHeight: 21,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: MiraDesign.space.sm,
  },
});
