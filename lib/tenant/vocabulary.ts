// White-label vocabulary layer.
//
// Every admin/catalog/customer-facing noun routes through this module so the
// platform can be sold to any business (hospital, beauty clinic, wellness,
// retail, ...) without hardcoding "โรงพยาบาล / ตรวจสุขภาพ / วัคซีน".
//
// Defaults are deliberately GENERIC ("สินค้า / สาขา / ผู้ให้บริการ"). A tenant
// can pick a `vertical` preset and/or override individual terms via
// `tenant_settings.vocabulary`. See docs/miracare-white-label-vocab-plan.md.

export type TenantVocabulary = {
  appointmentSupported: boolean;
  appointmentTerm: string;
  branchTerm: string;
  categoryTerm: string;
  customerTerm: string;
  orderTerm: string;
  productTerm: string;
  productTermPlural: string;
  providerTerm: string;
};

export type TenantBranding = {
  brandName: string | null;
  logoUrl: string | null;
};

export type TenantVertical = 'beauty_clinic' | 'general' | 'hospital' | 'retail' | 'wellness' | (string & {});

export type TenantConfig = {
  branding: TenantBranding;
  vertical: TenantVertical;
  vocabulary: TenantVocabulary;
};

// Raw, partially-populated config as stored in tenant_settings (jsonb is opaque
// to SQL, so we keep camelCase keys to avoid a mapping layer).
export type RawTenantConfig = {
  branding?: Partial<TenantBranding> | null;
  vertical?: string | null;
  vocabulary?: Partial<TenantVocabulary> | null;
};

export const GENERIC_VOCABULARY: TenantVocabulary = {
  appointmentSupported: true,
  appointmentTerm: 'นัดหมาย',
  branchTerm: 'สาขา',
  categoryTerm: 'หมวดหมู่',
  customerTerm: 'ลูกค้า',
  orderTerm: 'คำสั่งซื้อ',
  productTerm: 'สินค้า',
  productTermPlural: 'สินค้า',
  providerTerm: 'ผู้ให้บริการ',
};

// Per-vertical convenience presets. A tenant that picks a vertical gets sensible
// wording without configuring every term; explicit overrides still win.
export const VERTICAL_VOCABULARY_PRESETS: Record<string, Partial<TenantVocabulary>> = {
  beauty_clinic: {
    customerTerm: 'สมาชิก',
    orderTerm: 'การจอง',
    productTerm: 'คอร์ส',
    productTermPlural: 'คอร์ส',
    providerTerm: 'คลินิก',
  },
  general: {},
  hospital: {
    orderTerm: 'คำสั่งซื้อ',
    productTerm: 'แพ็กเกจ',
    productTermPlural: 'แพ็กเกจ',
    providerTerm: 'โรงพยาบาล',
  },
  retail: {
    appointmentSupported: false,
    productTerm: 'สินค้า',
    productTermPlural: 'สินค้า',
    providerTerm: 'ร้านค้า',
  },
  wellness: {
    productTerm: 'บริการ',
    productTermPlural: 'บริการ',
    providerTerm: 'ศูนย์สุขภาพ',
  },
};

export const GENERIC_BRANDING: TenantBranding = {
  brandName: null,
  logoUrl: null,
};

export const GENERIC_TENANT_CONFIG: TenantConfig = {
  branding: GENERIC_BRANDING,
  vertical: 'general',
  vocabulary: GENERIC_VOCABULARY,
};

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function mergeVocabulary(...layers: (Partial<TenantVocabulary> | null | undefined)[]): TenantVocabulary {
  const merged: TenantVocabulary = { ...GENERIC_VOCABULARY };

  for (const layer of layers) {
    if (!layer) {
      continue;
    }

    for (const term of [
      'appointmentTerm',
      'branchTerm',
      'categoryTerm',
      'customerTerm',
      'orderTerm',
      'productTerm',
      'productTermPlural',
      'providerTerm',
    ] as const) {
      const next = pickString(layer[term]);

      if (next) {
        merged[term] = next;
      }
    }

    if (typeof layer.appointmentSupported === 'boolean') {
      merged.appointmentSupported = layer.appointmentSupported;
    }
  }

  // If only the singular term was overridden, keep the plural in step.
  if (merged.productTermPlural === GENERIC_VOCABULARY.productTermPlural && merged.productTerm !== GENERIC_VOCABULARY.productTerm) {
    merged.productTermPlural = merged.productTerm;
  }

  return merged;
}

export function resolveTenantConfig(
  raw: RawTenantConfig | null | undefined,
  fallbackBranding: Partial<TenantBranding> = {},
): TenantConfig {
  const vertical = pickString(raw?.vertical) ?? 'general';
  const preset = VERTICAL_VOCABULARY_PRESETS[vertical] ?? {};

  return {
    branding: {
      brandName: pickString(raw?.branding?.brandName) ?? pickString(fallbackBranding.brandName) ?? null,
      logoUrl: pickString(raw?.branding?.logoUrl) ?? pickString(fallbackBranding.logoUrl) ?? null,
    },
    vertical,
    vocabulary: mergeVocabulary(preset, raw?.vocabulary),
  };
}

export function configForVertical(vertical: string | null | undefined): TenantConfig {
  return resolveTenantConfig({ vertical: vertical ?? 'general' });
}

// Centralized derived copy so the same wording is reused across screens and the
// only thing a screen interpolates is the resolved term.
export function catalogScreenCopy(vocabulary: TenantVocabulary) {
  return {
    addProduct: `เพิ่ม${vocabulary.productTerm}`,
    editProduct: `แก้ไข${vocabulary.productTerm}`,
    emptyBody: `เพิ่ม${vocabulary.productTerm}เพื่อใช้ใน mobile catalog, chat checkout, RAG answers และ referral workflow`,
    emptyTitle: `ยังไม่มี${vocabulary.productTerm}ใน catalog`,
    eyebrow: `หลังบ้าน · คลัง${vocabulary.productTerm}`,
    inventoryTitle: `รายการ${vocabulary.productTerm}`,
    nameField: `ชื่อ${vocabulary.productTerm}`,
    imageField: `รูป${vocabulary.productTerm}`,
    saveProduct: `บันทึก${vocabulary.productTerm}`,
    createProduct: `สร้าง${vocabulary.productTerm}`,
    searchPlaceholder: `ค้นหาชื่อ${vocabulary.productTerm} ${vocabulary.providerTerm} ${vocabulary.categoryTerm} ${vocabulary.branchTerm} หรือ tag`,
    title: `จัดการ${vocabulary.productTerm}`,
    totalLabel: `${vocabulary.productTerm}ทั้งหมด`,
  };
}
