import { invokeFunction } from '@/lib/api/client';
import { supabase, supabaseConfigStatus } from '@/lib/supabase';
import type {
  AdminStripeProductSyncRequest,
  AdminStripeProductSyncResponse,
  BranchRow,
  CatalogCategory,
  ProductCategoryRow,
  ProductSummary,
  TenantSummary,
} from '@/lib/types/api';

export type ProductCategory = CatalogCategory;

export type HospitalProductDraft = {
  branchInfo?: string;
  branchIds?: string[];
  category?: ProductCategory;
  commissionPercent?: string;
  description: string;
  hospitalAddress: string;
  hospitalLat?: number;
  hospitalLng?: number;
  hospitalMapQuery: string;
  hospitalName: string;
  imageUrl?: string;
  productImageFile?: File;
  productImageMimeType?: string;
  productImageName?: string;
  productImagePreviewUri?: string;
  productImageSize?: number;
  priceAmount: string;
  requiresAppointment?: boolean;
  title: string;
};

export type DescriptionRagSection = {
  confidence: number;
  content: string;
  key: 'booking' | 'included_items' | 'medical_preparation' | 'overview' | 'safety_review';
  label: string;
};

export type ProductDescriptionAnalysis = {
  bookingGuidance: string;
  extractedIncludes: string[];
  extractedPreparationNotes: string[];
  keywords: string[];
  ragSections: DescriptionRagSection[];
  suggestedTags: string[];
  summary: string;
  warnings: string[];
};

export type ProductClassification = {
  analysis: ProductDescriptionAnalysis;
  category: ProductCategory;
  confidence: number;
  keywords: string[];
  ragCategory: 'marketplace.product';
  riskLevel: 'low' | 'medium';
  tags: string[];
};

export type HospitalProduct = {
  bookingNote?: string | null;
  branchIds: string[];
  branches: BranchSummary[];
  catalogKey: string;
  category: ProductCategory;
  commissionRate: number;
  createdAt: string;
  description: string;
  duration?: string | null;
  hospitalAddress?: string | null;
  hospitalLat?: number | null;
  hospitalLng?: number | null;
  hospitalMapQuery?: string | null;
  hospitalName: string;
  id: string;
  includes: string[];
  imageUrl?: string | null;
  location?: string | null;
  preparationNotes?: string | null;
  priceAmount: number;
  productImageBucket?: string | null;
  productImageMimeType?: string | null;
  productImageName?: string | null;
  productImagePath?: string | null;
  productImagePreviewUri?: string | null;
  productImageSize?: number | null;
  ragChunkId?: string | null;
  ragEmbeddingDimensions?: number | null;
  ragEmbeddingError?: string | null;
  ragEmbeddingModel?: string | null;
  ragEmbeddingStatus: 'embedded' | 'error' | 'not_published' | 'pending' | 'skipped';
  ragEmbeddingUpdatedAt?: string | null;
  ragStatus: 'archived' | 'error' | 'not_published' | 'pending_review' | 'published' | 'rejected';
  requiresAppointment: boolean;
  reviewNote?: string | null;
  reviewStatus: 'approved' | 'archived' | 'draft' | 'pending_review' | 'rejected';
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  status: 'active' | 'archived' | 'draft' | 'pending_review' | 'rejected';
  stripePriceId?: string | null;
  stripeProductId?: string | null;
  tags: string[];
  tenantId: string;
  title: string;
  updatedAt?: string | null;
};

export type HospitalProductStatus = HospitalProduct['status'];

export type ProductImageUploadResult = {
  path: string;
  publicUrl: string;
};

export type BranchSummary = {
  active: boolean;
  address: string | null;
  district: string | null;
  id: string;
  imageUrl: string | null;
  mapUrl: string | null;
  name: string;
  phone: string | null;
  sort: number;
};

export type BranchDraft = {
  active?: boolean;
  address?: string;
  district?: string;
  imageUrl?: string;
  mapUrl?: string;
  name: string;
  phone?: string;
  sort?: string;
};

export type ProductCategoryOption = {
  active: boolean;
  icon: string | null;
  imageUrl: string | null;
  key: string;
  labelTh: string;
  sort: number;
};

export type ProductCategoryDraft = {
  active?: boolean;
  icon?: string;
  imageUrl?: string;
  key: string;
  labelTh: string;
  sort?: string;
};

export type TenantMemberContext = TenantSummary & {
  role: 'superadmin' | 'tenant_admin' | 'tenant_staff' | string;
};

export type SaveHospitalProductResult = {
  catalogKey: string;
  classification: ProductClassification;
  embedding: RagEmbeddingResult;
  product: HospitalProduct;
  ragChunkId: string;
};

export type RagEmbeddingResult = {
  dimensions?: number;
  message?: string;
  model?: string;
  status: 'embedded' | 'error' | 'skipped';
};

export type HospitalProductRagActionResult = {
  embedding: RagEmbeddingResult;
  product: HospitalProduct;
};

export type StripeProductSyncResult = {
  product: HospitalProduct;
  response: AdminStripeProductSyncResponse;
  summary: string;
};

type ProductRow = {
  active: boolean;
  branch_info: string | null;
  catalog_key: string;
  category: string;
  created_at: string;
  description: string;
  id: string;
  image_url: string | null;
  name: string;
  price_baht: number;
  requires_appointment: boolean;
  stripe_price_id: string | null;
  stripe_product_id: string | null;
  tenant_id: string;
  tenants?: Pick<TenantSummary, 'display_name'> | Pick<TenantSummary, 'display_name'>[] | null;
  updated_at: string;
};

type ProductBranchJoinRow = {
  branch_id: string;
  branches?: BranchRow | BranchRow[] | null;
  product_id: string;
};

type TenantRow = TenantSummary;

export const defaultTenantSlug = process.env.EXPO_PUBLIC_MIRA_TENANT_SLUG?.trim() || 'demo-hospital';

const categoryLabels: Record<string, string> = {
  checkup: 'ตรวจสุขภาพ',
  general: 'ทั่วไป',
  health_checkup: 'ตรวจสุขภาพ',
  imaging: 'เอกซเรย์/ภาพวินิจฉัย',
  lab_test: 'ตรวจแล็บ/ตรวจเลือด',
  other: 'อื่นๆ',
  procedure: 'หัตถการ',
  specialty_consult: 'ปรึกษาแพทย์',
  vaccine: 'วัคซีน',
  wellness: 'สุขภาพและไลฟ์สไตล์',
};

const productCategories = Object.keys(categoryLabels);

function compactText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function parsePriceBaht(value: string) {
  return Math.max(0, Math.round(Number(value.replace(/,/g, '')) || 0));
}

function splitList(value: string) {
  return value
    .split(/[\n,;]/)
    .map((item) => compactText(item))
    .filter(Boolean)
    .slice(0, 12);
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => compactText(value)).filter(Boolean))];
}

function asCategory(value: string): ProductCategory {
  return value.trim() || 'general';
}

function tenantNameFromJoin(value: ProductRow['tenants']) {
  if (Array.isArray(value)) {
    return value[0]?.display_name ?? 'Tenant catalog';
  }

  return value?.display_name ?? 'Tenant catalog';
}

function sanitizeStorageName(value: string) {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return sanitized || 'product-image';
}

function productSelectColumns() {
  return [
    'id',
    'tenant_id',
    'catalog_key',
    'name',
    'description',
    'price_baht',
    'category',
    'image_url',
    'branch_info',
    'requires_appointment',
    'active',
    'stripe_product_id',
    'stripe_price_id',
    'created_at',
    'updated_at',
    'tenants(display_name)',
  ].join(',');
}

function inferCategory(draft: HospitalProductDraft): ProductCategory {
  if (draft.category) {
    return draft.category;
  }

  const searchText = `${draft.title} ${draft.description}`.toLowerCase();

  if (searchText.includes('vaccine') || searchText.includes('vaccination')) {
    return 'vaccine';
  }

  if (searchText.includes('checkup') || searchText.includes('screening') || searchText.includes('blood') || searchText.includes('lab')) {
    return 'checkup';
  }

  return 'general';
}

function deriveIncludes(description: string) {
  return splitList(description)
    .filter((item) => item.length <= 80)
    .slice(0, 6);
}

function toHospitalProduct(row: ProductRow): HospitalProduct {
  const category = asCategory(row.category);
  const tags = unique([categoryLabels[category] ?? category, row.requires_appointment ? 'ต้องนัดหมาย' : 'Walk-in']);

  return {
    bookingNote: row.requires_appointment ? 'Requires appointment' : 'Walk-in allowed',
    branchIds: [],
    branches: [],
    catalogKey: row.catalog_key,
    category,
    commissionRate: 0.03,
    createdAt: row.created_at,
    description: row.description,
    duration: null,
    hospitalAddress: row.branch_info,
    hospitalLat: null,
    hospitalLng: null,
    hospitalMapQuery: row.branch_info,
    hospitalName: tenantNameFromJoin(row.tenants),
    id: row.id,
    includes: deriveIncludes(row.description),
    imageUrl: row.image_url,
    location: row.branch_info,
    preparationNotes: null,
    priceAmount: row.price_baht,
    productImageBucket: null,
    productImageMimeType: null,
    productImageName: null,
    productImagePath: null,
    productImagePreviewUri: row.image_url,
    productImageSize: null,
    ragChunkId: null,
    ragEmbeddingDimensions: null,
    ragEmbeddingError: null,
    ragEmbeddingModel: null,
    ragEmbeddingStatus: 'not_published',
    ragEmbeddingUpdatedAt: null,
    ragStatus: 'not_published',
    requiresAppointment: row.requires_appointment,
    reviewNote: null,
    reviewStatus: row.active ? 'approved' : 'archived',
    reviewedAt: null,
    reviewedBy: null,
    status: row.active ? 'active' : 'archived',
    stripePriceId: row.stripe_price_id,
    stripeProductId: row.stripe_product_id,
    tags,
    tenantId: row.tenant_id,
    title: row.name,
    updatedAt: row.updated_at,
  };
}
async function loadTenantBySlug(slug: string): Promise<TenantRow | null> {
  if (!supabaseConfigStatus.isConfigured) {
    return null;
  }

  const { data, error } = await supabase
    .from('tenants')
    .select('id,slug,display_name,logo_url')
    .eq('slug', slug)
    .maybeSingle();

  if (error) {
    return null;
  }

  return data as TenantRow | null;
}

export async function loadPrimaryTenant(slug = defaultTenantSlug): Promise<TenantRow | null> {
  if (!supabaseConfigStatus.isConfigured) {
    return null;
  }

  const configuredTenant = await loadTenantBySlug(slug);

  if (configuredTenant) {
    return configuredTenant;
  }

  const { data, error } = await supabase
    .from('tenants')
    .select('id,slug,display_name,logo_url')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    return null;
  }

  return data as TenantRow | null;
}

export async function resolvePrimaryTenantSlug(slug = defaultTenantSlug) {
  const tenant = await loadPrimaryTenant(slug);

  return tenant?.slug ?? slug;
}

async function loadTenant(slug = defaultTenantSlug): Promise<TenantRow | null> {
  return loadPrimaryTenant(slug);
}

async function requireTenant(slug = defaultTenantSlug): Promise<TenantRow> {
  const tenant = await loadTenant(slug);

  if (!tenant) {
    throw new Error(`Tenant "${slug}" is not available for this user.`);
  }

  return tenant;
}

async function requireAuthenticatedUser() {
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    throw new Error('Sign in with a tenant admin account to manage the catalog.');
  }

  return data.user;
}

export async function loadTenantMemberContext(slug = defaultTenantSlug): Promise<TenantMemberContext | null> {
  if (!supabaseConfigStatus.isConfigured) {
    return null;
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return null;
  }

  const tenant = await loadTenant(slug);

  if (!tenant) {
    throw new Error(`Tenant "${slug}" is not available for this user.`);
  }

  const { data: member, error: memberError } = await supabase
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenant.id)
    .eq('auth_user_id', userData.user.id)
    .maybeSingle();

  if (memberError || !member) {
    throw new Error('Your account is not a member of this tenant.');
  }

  return {
    ...tenant,
    role: String((member as { role: string }).role),
  };
}

export function canWriteTenantCatalog(context: TenantMemberContext | null) {
  return context?.role === 'superadmin' || context?.role === 'tenant_admin';
}

export function analyzeProductDescription(draft: HospitalProductDraft, category: ProductCategory = inferCategory(draft)): ProductDescriptionAnalysis {
  const description = compactText(draft.description);
  const extractedIncludes = deriveIncludes(description);
  const extractedPreparationNotes = splitList(description).filter((item) => /fast|prepare|appointment|งด|ยา|แพ้/.test(item.toLowerCase()));
  const summary = description.length > 180 ? `${description.slice(0, 177).trim()}...` : description;
  const categoryLabel = getProductCategoryLabel(category);
  const suggestedTags = unique([categoryLabel, ...extractedIncludes.slice(0, 4)]).slice(0, 8);
  const bookingGuidance = draft.requiresAppointment === false ? 'Walk-in allowed if the tenant confirms availability.' : 'Appointment is required before service.';
  const warnings = description.length < 60 ? ['Description is short; confirm medical and booking details before publishing.'] : [];
  const ragSections: DescriptionRagSection[] = [
    {
      confidence: description.length >= 60 ? 0.82 : 0.55,
      content: summary || draft.title,
      key: 'overview',
      label: 'Overview',
    },
    {
      confidence: extractedIncludes.length > 0 ? 0.72 : 0.4,
      content: extractedIncludes.length ? extractedIncludes.join(', ') : 'No included items were detected from the description.',
      key: 'included_items',
      label: 'Included items',
    },
    {
      confidence: 0.82,
      content: bookingGuidance,
      key: 'booking',
      label: 'Booking',
    },
  ];

  if (warnings.length > 0) {
    ragSections.push({
      confidence: 0.68,
      content: warnings.join(' '),
      key: 'safety_review',
      label: 'Review flag',
    });
  }

  return {
    bookingGuidance,
    extractedIncludes,
    extractedPreparationNotes,
    keywords: unique([draft.title, categoryLabel, ...suggestedTags, ...extractedIncludes]).slice(0, 16),
    ragSections,
    suggestedTags,
    summary,
    warnings,
  };
}

export function classifyHospitalProduct(draft: HospitalProductDraft): ProductClassification {
  const category = inferCategory(draft);
  const analysis = analyzeProductDescription(draft, category);

  return {
    analysis,
    category,
    confidence: draft.category ? 0.95 : category === 'general' ? 0.62 : 0.82,
    keywords: analysis.keywords,
    ragCategory: 'marketplace.product',
    riskLevel: analysis.warnings.length > 0 ? 'medium' : 'low',
    tags: analysis.suggestedTags,
  };
}

export function getProductCategoryLabel(category: ProductCategory) {
  return categoryLabels[category] ?? category;
}

export function getProductCategories() {
  return productCategories;
}

export function formatCommissionPercent(rate: number) {
  if (!Number.isFinite(rate)) {
    return '0%';
  }

  const percent = rate * 100;

  return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(1).replace(/\.0$/, '')}%`;
}

function toBranchSummary(row: BranchRow): BranchSummary {
  return {
    active: row.active,
    address: row.address,
    district: row.district,
    id: row.id,
    imageUrl: row.image_url,
    mapUrl: row.map_url,
    name: row.name,
    phone: row.phone,
    sort: row.sort,
  };
}

function toProductCategoryOption(row: ProductCategoryRow): ProductCategoryOption {
  return {
    active: row.active,
    icon: row.icon,
    imageUrl: row.image_url,
    key: row.key,
    labelTh: row.label_th,
    sort: row.sort,
  };
}

function normalizeCategoryKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function parseSort(value: string | undefined) {
  return Math.round(Number(value) || 0);
}

function compactOptional(value: string | undefined) {
  const compacted = compactText(value ?? '');

  return compacted || null;
}

function embeddedBranch(value: ProductBranchJoinRow['branches']) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

async function attachBranches(products: HospitalProduct[]) {
  if (products.length === 0) {
    return products;
  }

  const { data, error } = await supabase
    .from('product_branches')
    .select('product_id,branch_id,branches(id,tenant_id,name,address,district,phone,map_url,image_url,active,sort,created_at)')
    .in('product_id', products.map((product) => product.id));

  if (error || !data) {
    return products;
  }

  const branchesByProduct = new Map<string, BranchSummary[]>();
  const branchIdsByProduct = new Map<string, string[]>();

  for (const row of data as unknown as ProductBranchJoinRow[]) {
    const branch = embeddedBranch(row.branches);

    branchIdsByProduct.set(row.product_id, [...(branchIdsByProduct.get(row.product_id) ?? []), row.branch_id]);

    if (branch) {
      branchesByProduct.set(row.product_id, [...(branchesByProduct.get(row.product_id) ?? []), toBranchSummary(branch)]);
    }
  }

  return products.map((product) => ({
    ...product,
    branchIds: branchIdsByProduct.get(product.id) ?? [],
    branches: branchesByProduct.get(product.id) ?? [],
  }));
}

export function buildProductRagPreview(draft: HospitalProductDraft, classification = classifyHospitalProduct(draft)) {
  const price = parsePriceBaht(draft.priceAmount);
  const lines = [
    `${compactText(draft.title)} (${getProductCategoryLabel(classification.category)})`,
    `Price: ${price.toLocaleString('th-TH')} THB`,
    draft.branchInfo || draft.hospitalAddress ? `Branch: ${compactText(draft.branchInfo || draft.hospitalAddress)}` : '',
    classification.analysis.summary ? `Description: ${classification.analysis.summary}` : '',
  ];

  return lines.filter(Boolean).join('\n');
}

export async function loadActiveHospitalProducts(limit = 20): Promise<HospitalProduct[]> {
  const tenant = await loadTenant();

  if (!tenant) {
    return [];
  }

  const { data, error } = await supabase
    .from('products')
    .select(productSelectColumns())
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return attachBranches((data as unknown as ProductRow[]).map(toHospitalProduct));
}

export async function loadActiveHospitalProductById(productId: string): Promise<HospitalProduct | null> {
  const trimmedProductId = productId.trim();

  if (!trimmedProductId) {
    return null;
  }

  const products = await loadActiveHospitalProducts(100);

  return products.find((product) => product.id === trimmedProductId || product.catalogKey === trimmedProductId) ?? null;
}

export async function loadManagedHospitalProducts(limit = 80): Promise<HospitalProduct[]> {
  const tenant = await loadTenant();

  if (!tenant) {
    return [];
  }

  const { data, error } = await supabase
    .from('products')
    .select(productSelectColumns())
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return attachBranches((data as unknown as ProductRow[]).map(toHospitalProduct));
}

export async function loadBranches(includeInactive = true): Promise<BranchSummary[]> {
  const tenant = await requireTenant();
  let query = supabase
    .from('branches')
    .select('id,tenant_id,name,address,district,phone,map_url,image_url,active,sort,created_at')
    .eq('tenant_id', tenant.id)
    .order('sort', { ascending: true })
    .order('created_at', { ascending: true });

  if (!includeInactive) {
    query = query.eq('active', true);
  }

  const { data, error } = await query;

  if (error || !data) {
    throw new Error(error?.message ?? 'Unable to load branches.');
  }

  return (data as unknown as BranchRow[]).map(toBranchSummary);
}

export async function saveBranch(draft: BranchDraft, branchId?: string): Promise<BranchSummary> {
  await requireAuthenticatedUser();
  const tenant = await requireTenant();
  const payload = {
    active: draft.active ?? true,
    address: compactOptional(draft.address),
    district: compactOptional(draft.district),
    image_url: compactOptional(draft.imageUrl),
    map_url: compactOptional(draft.mapUrl),
    name: compactText(draft.name),
    phone: compactOptional(draft.phone),
    sort: parseSort(draft.sort),
    tenant_id: tenant.id,
  };

  if (!payload.name) {
    throw new Error('Branch name is required.');
  }

  const query = branchId
    ? supabase.from('branches').update(payload).eq('id', branchId).eq('tenant_id', tenant.id)
    : supabase.from('branches').insert(payload);
  const { data, error } = await query
    .select('id,tenant_id,name,address,district,phone,map_url,image_url,active,sort,created_at')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Unable to save branch.');
  }

  return toBranchSummary(data as unknown as BranchRow);
}

export async function loadProductCategories(includeInactive = true): Promise<ProductCategoryOption[]> {
  const tenant = await requireTenant();
  let query = supabase
    .from('product_categories')
    .select('tenant_id,key,label_th,icon,image_url,sort,active')
    .eq('tenant_id', tenant.id)
    .order('sort', { ascending: true })
    .order('key', { ascending: true });

  if (!includeInactive) {
    query = query.eq('active', true);
  }

  const { data, error } = await query;

  if (error || !data) {
    throw new Error(error?.message ?? 'Unable to load product categories.');
  }

  return (data as unknown as ProductCategoryRow[]).map(toProductCategoryOption);
}

export async function saveProductCategory(draft: ProductCategoryDraft): Promise<ProductCategoryOption> {
  await requireAuthenticatedUser();
  const tenant = await requireTenant();
  const key = normalizeCategoryKey(draft.key);

  if (!key) {
    throw new Error('Category key is required.');
  }

  const payload = {
    active: draft.active ?? true,
    icon: compactOptional(draft.icon),
    image_url: compactOptional(draft.imageUrl),
    key,
    label_th: compactText(draft.labelTh) || key,
    sort: parseSort(draft.sort),
    tenant_id: tenant.id,
  };
  const { data, error } = await supabase
    .from('product_categories')
    .upsert(payload, { onConflict: 'tenant_id,key' })
    .select('tenant_id,key,label_th,icon,image_url,sort,active')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Unable to save product category.');
  }

  return toProductCategoryOption(data as unknown as ProductCategoryRow);
}

export async function updateHospitalProductStatus(product: HospitalProduct, status: HospitalProductStatus): Promise<HospitalProduct> {
  await requireAuthenticatedUser();

  const { data, error } = await supabase
    .from('products')
    .update({
      active: status === 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', product.id)
    .select(productSelectColumns())
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Unable to update product status.');
  }

  const productWithStatus = toHospitalProduct(data as unknown as ProductRow);
  const [productWithBranches] = await attachBranches([productWithStatus]);

  return productWithBranches ?? productWithStatus;
}

export async function uploadProductImage(file: Blob & { name?: string; type?: string }, productId?: string): Promise<ProductImageUploadResult> {
  await requireAuthenticatedUser();
  const tenant = await requireTenant();
  const originalName = file.name || 'product-image';
  const extension = originalName.includes('.') ? originalName.split('.').pop() : file.type?.split('/').pop();
  const safeBase = sanitizeStorageName(originalName.replace(/\.[^.]+$/, ''));
  const safeExtension = sanitizeStorageName(extension || 'jpg');
  const path = `${tenant.slug}/${productId ?? 'drafts'}/${Date.now()}-${safeBase}.${safeExtension}`;

  const { error } = await supabase.storage.from('product-images').upload(path, file, {
    cacheControl: '3600',
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });

  if (error) {
    throw new Error(error.message || 'Unable to upload product image.');
  }

  const { data } = supabase.storage.from('product-images').getPublicUrl(path);

  if (!data.publicUrl) {
    throw new Error('Product image uploaded but no public URL was returned.');
  }

  return {
    path,
    publicUrl: data.publicUrl,
  };
}

export async function saveHospitalProductWithRag(draft: HospitalProductDraft, productId?: string): Promise<SaveHospitalProductResult> {
  await requireAuthenticatedUser();
  const tenant = await requireTenant();
  const classification = classifyHospitalProduct(draft);
  const branchInfo = compactText(draft.branchInfo || draft.hospitalAddress || draft.hospitalMapQuery || '');
  const imageUrl = compactText(draft.imageUrl || draft.productImagePreviewUri || '');
  const payload = {
    active: true,
    branch_info: branchInfo || null,
    category: classification.category,
    description: compactText(draft.description),
    image_url: imageUrl || null,
    name: compactText(draft.title),
    price_baht: parsePriceBaht(draft.priceAmount),
    requires_appointment: draft.requiresAppointment ?? true,
    tenant_id: tenant.id,
    updated_at: new Date().toISOString(),
  };
  const query = productId
    ? supabase.from('products').update(payload).eq('id', productId)
    : supabase.from('products').insert(payload);
  const { data, error } = await query.select(productSelectColumns()).single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Unable to save product.');
  }

  const product = toHospitalProduct(data as unknown as ProductRow);
  const branchIds = (draft.branchIds ?? []).filter(Boolean);

  if (draft.branchIds !== undefined) {
    await supabase.from('product_branches').delete().eq('product_id', product.id);

    if (branchIds.length > 0) {
      const { error: branchError } = await supabase.from('product_branches').insert(
        branchIds.map((branchId) => ({
          branch_id: branchId,
          product_id: product.id,
        })),
      );

      if (branchError) {
        throw new Error(branchError.message || 'Unable to save product branches.');
      }
    }
  }
  const [productWithBranches] = await attachBranches([product]);

  return {
    catalogKey: product.catalogKey,
    classification,
    embedding: {
      message: 'Phase 1 stores catalog rows only; chat/RAG integration moves to Phase 2.',
      status: 'skipped',
    },
    product: productWithBranches ?? product,
    ragChunkId: product.catalogKey,
  };
}

export async function saveCatalogProduct(draft: HospitalProductDraft, productId?: string) {
  return saveHospitalProductWithRag(draft, productId);
}

export async function syncCatalogProductToStripe(productId: string): Promise<AdminStripeProductSyncResponse> {
  await requireAuthenticatedUser();

  return invokeFunction<AdminStripeProductSyncRequest, AdminStripeProductSyncResponse>('admin-stripe-product-sync', {
    product_id: productId,
  });
}

export function hasStripeCatalogMapping(product: HospitalProduct) {
  return Boolean(product.stripeProductId && product.stripePriceId);
}

export function shouldSyncCatalogStatusToStripe(product: HospitalProduct, nextStatus: HospitalProductStatus) {
  return nextStatus === 'active' || Boolean(product.stripeProductId || product.stripePriceId);
}

export async function syncHospitalProductToStripe(product: HospitalProduct): Promise<StripeProductSyncResult> {
  const response = await syncCatalogProductToStripe(product.id);
  const syncedProduct = {
    ...product,
    stripePriceId: response.stripe_price_id,
    stripeProductId: response.stripe_product_id,
  };

  return {
    product: syncedProduct,
    response,
    summary: `Stripe ${response.product_action}; price ${response.price_action}`,
  };
}

export async function approveHospitalProductForPublication(product: HospitalProduct): Promise<HospitalProductRagActionResult> {
  const updatedProduct = await updateHospitalProductStatus(product, 'active');

  return {
    embedding: {
      message: 'Catalog product is active. Product RAG embedding is not wired in the main catalog schema yet.',
      status: 'skipped',
    },
    product: {
      ...updatedProduct,
      ragEmbeddingStatus: 'not_published',
      ragStatus: 'not_published',
      reviewStatus: 'approved',
    },
  };
}

export async function rejectHospitalProductRag(product: HospitalProduct, reviewNote = ''): Promise<HospitalProduct> {
  const archivedProduct = await updateHospitalProductStatus(product, 'archived');

  return {
    ...archivedProduct,
    ragStatus: 'rejected',
    reviewNote,
    reviewStatus: 'rejected',
    status: 'rejected',
  };
}

export async function retryHospitalProductEmbedding(product: HospitalProduct): Promise<HospitalProductRagActionResult> {
  return {
    embedding: {
      message: 'Product RAG embedding is not wired in the main catalog schema yet.',
      status: 'skipped',
    },
    product: {
      ...product,
      ragEmbeddingStatus: 'not_published',
      ragStatus: 'not_published',
    },
  };
}

export function toProductSummary(product: HospitalProduct): ProductSummary {
  return {
    active: product.status === 'active',
    branch_info: product.hospitalAddress ?? null,
    catalog_key: product.catalogKey,
    category: product.category,
    description: product.description,
    id: product.id,
    image_url: product.imageUrl ?? null,
    name: product.title,
    price_baht: product.priceAmount,
    requires_appointment: product.requiresAppointment,
    tenant_id: product.tenantId,
  };
}
