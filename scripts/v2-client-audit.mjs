import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();

const productionFiles = [
  'app/(tabs)/health.tsx',
  'app/(tabs)/more.tsx',
  'app/_layout.tsx',
  'app/admin/branches.tsx',
  'app/admin/catalog.tsx',
  'app/admin/orders.tsx',
  'app/admin/referrers.tsx',
  'app/ai-body-overview.tsx',
  'app/body-overview.tsx',
  'app/checkout.tsx',
  'app/health-check-results.tsx',
  'app/order-status.tsx',
  'app/orders.tsx',
  'app/package-detail.tsx',
  'app/partner.tsx',
  'app/prototype.tsx',
  'app/r/[ref_code].tsx',
  'app/user-profile.tsx',
  'app/wearable-health.tsx',
  'components/HealthInsightScreens.tsx',
  'components/admin/CatalogCrud.tsx',
  'components/admin/OrdersQueue.tsx',
  'components/admin/ReferrersAdmin.tsx',
  'components/chat/BranchOptionRow.tsx',
  'components/chat/ConsentSheet.tsx',
  'components/chat/BookingSheet.tsx',
  'components/chat/BranchPicker.tsx',
  'components/chat/CategoryGrid.tsx',
  'components/chat/MessageBubble.tsx',
  'components/chat/OrderPanel.tsx',
  'components/chat/OrderStatusCard.tsx',
  'components/chat/ProductCarousel.tsx',
  'components/chat/ProductGrid.tsx',
  'lib/ai/miraChat.ts',
  'lib/api/client.ts',
  'lib/health/labConfirm.ts',
  'lib/health/v2HealthDashboard.ts',
  'lib/marketplace/hospitalProducts.ts',
];

const forbidden = [
  'services/mockBackend',
  'mockBackend',
  'mock result',
  'featuredPackage',
  'healthPackages',
  'purchaseOrders',
  'packageRecommendations',
  'healthMetrics',
];

const removedRouteFiles = [
  'app/(tabs)/chatbot.tsx',
  'app/(tabs)/agent.tsx',
  'app/(tabs)/home.tsx',
  'app/(tabs)/packages.tsx',
  'app/admin-booking.tsx',
  'app/hospital-portal.tsx',
  'app/hospital-products.tsx',
  'app/modal.tsx',
];
const presentationalChatComponents = [
  'components/chat/BranchOptionRow.tsx',
  'components/chat/ConsentSheet.tsx',
  'components/chat/BookingSheet.tsx',
  'components/chat/BranchPicker.tsx',
  'components/chat/CategoryGrid.tsx',
  'components/chat/MessageBubble.tsx',
  'components/chat/OrderPanel.tsx',
  'components/chat/OrderStatusCard.tsx',
  'components/chat/ProductCarousel.tsx',
  'components/chat/ProductGrid.tsx',
];
const clientScanRoots = ['app', 'components', 'lib'];
const clientScanExtensions = new Set(['.js', '.mjs', '.ts', '.tsx']);
const skippedNames = new Set(['.expo', '.git', 'node_modules']);
const serviceRoleTerms = ['SUPABASE_SERVICE_ROLE', 'SERVICE_ROLE_KEY', 'service_role', 'serviceRoleKey'];

const violations = [];
const fileSources = new Map();

async function collectClientFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!skippedNames.has(entry.name)) {
        files.push(...await collectClientFiles(fullPath));
      }
      continue;
    }

    if (entry.isFile() && clientScanExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

for (const relativePath of removedRouteFiles) {
  const filePath = path.join(repoRoot, relativePath);
  const exists = await fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);

  if (exists) {
    violations.push(`${relativePath}: removed route file must stay removed`);
  }
}

for (const relativePath of productionFiles) {
  const filePath = path.join(repoRoot, relativePath);
  const source = await fs.readFile(filePath, 'utf8').catch(() => null);

  if (source === null) {
    violations.push(`${relativePath}: missing production file`);
    continue;
  }

  fileSources.set(relativePath, source);

  for (const term of forbidden) {
    if (source.includes(term)) {
      violations.push(`${relativePath}: contains forbidden legacy term "${term}"`);
    }
  }

  for (const removedRoute of ['/chatbot', '/admin-booking', '/hospital-portal', '/hospital-products']) {
    if (source.includes(removedRoute)) {
      violations.push(`${relativePath}: links to removed legacy route "${removedRoute}"`);
    }
  }

  if (relativePath !== 'app/prototype.tsx' && source.includes('PrototypeChatPanel')) {
    violations.push(`${relativePath}: production route imports PrototypeChatPanel`);
  }
}

const clientFiles = (await Promise.all(clientScanRoots.map((root) => collectClientFiles(path.join(repoRoot, root))))).flat();

for (const filePath of clientFiles) {
  const source = await fs.readFile(filePath, 'utf8');
  const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');

  for (const term of serviceRoleTerms) {
    if (source.includes(term)) {
      violations.push(`${relativePath}: client-facing code contains forbidden service-role term "${term}"`);
    }
  }
}

const requiredSnippets = [
  {
    relativePath: 'app/_layout.tsx',
    snippet: 'QueryClientProvider',
    message: 'root layout must provide the shared React Query client',
  },
  {
    relativePath: 'lib/api/client.ts',
    snippet: 'new QueryClient',
    message: 'typed API client must define the shared React Query client',
  },
  {
    relativePath: 'lib/ai/miraChat.ts',
    snippet: 'loadLatestChatHistoryPage',
    message: 'chat client must expose DB-backed latest history loading',
  },
  {
    relativePath: 'lib/ai/miraChat.ts',
    snippet: 'loadChatHistoryPage',
    message: 'chat client must expose cursor-paged history loading',
  },
  {
    relativePath: 'lib/ai/miraChat.ts',
    snippet: 'loadHealthDataConsent',
    message: 'chat client must expose latest health-data consent loading',
  },
  {
    relativePath: 'app/r/[ref_code].tsx',
    snippet: 'await storeReferralCode(refCode)',
    message: 'referral landing route must persist the normalized referral code before chat',
  },
  {
    relativePath: 'lib/ai/miraChat.ts',
    snippet: 'const refCode = await readStoredReferralCode();',
    message: 'chat orchestrator request must forward a stored referral code when present',
  },
  {
    relativePath: 'components/chat/MessageBubble.tsx',
    snippet: 'system_notice',
    message: 'message bubble must style persisted system notices distinctly',
  },
  {
    relativePath: 'components/chat/OrderPanel.tsx',
    snippet: "import type { OrderPanelState } from '@/lib/types/api'",
    message: 'order panel props must be typed from shared API types',
  },
  {
    relativePath: 'components/chat/ProductCarousel.tsx',
    snippet: "import type { ChatProduct } from '@/lib/types/api'",
    message: 'product carousel props must be typed from shared API types',
  },
  {
    relativePath: 'components/chat/ProductCarousel.tsx',
    snippet: 'products: ChatProduct[]',
    message: 'product carousel must receive API-shaped products from its container',
  },
  {
    relativePath: 'lib/ai/miraChat.ts',
    snippet: "responseRole: action?.type === 'order_form_submit' || action?.type === 'payment_done' ? 'system_notice' : 'assistant'",
    message: 'typed chat client must mark backend action responses that skip the model as system notices',
  },
  {
    relativePath: 'lib/ai/miraChat.ts',
    snippet: 'export async function refreshActiveOrderPanel',
    message: 'typed chat client must expose the no-message active order refresh action',
  },
  {
    relativePath: 'lib/ai/miraChat.ts',
    snippet: "type: 'refresh_order'",
    message: 'typed chat client must call chat-orchestrator refresh_order for persisted order-panel reload',
  },
  {
    relativePath: 'lib/ai/miraChat.ts',
    snippet: 'export async function requestPaymentSlipUpload',
    message: 'typed chat client must expose the service-role signed payment-slip upload request',
  },
  {
    relativePath: 'lib/ai/miraChat.ts',
    snippet: 'export async function uploadPaymentSlipFile',
    message: 'typed chat client must upload customer-selected slips only to a signed upload URL',
  },
  {
    relativePath: 'components/chat/BookingSheet.tsx',
    snippet: 'onSlipSelected',
    message: 'booking sheet must expose a slip picker callback without owning data access',
  },
  {
    relativePath: 'components/admin/OrdersQueue.tsx',
    snippet: "action: 'slip_url'",
    message: 'admin orders queue must request server-generated signed slip read URLs',
  },
  {
    relativePath: 'components/admin/CatalogCrud.tsx',
    snippet: 'canWriteTenantCatalog(tenantContext)',
    message: 'catalog admin screen must derive write access from tenant role context',
  },
  {
    relativePath: 'components/admin/CatalogCrud.tsx',
    snippet: 'Only tenant_admin or superadmin roles can create, upload, archive, or restore products.',
    message: 'catalog admin screen must expose read-only state for tenant_staff users',
  },
  {
    relativePath: 'components/admin/CatalogCrud.tsx',
    snippet: 'disabled={isUploadingImage || !canEditCatalog}',
    message: 'catalog image upload button must be disabled for read-only users',
  },
  {
    relativePath: 'lib/marketplace/hospitalProducts.ts',
    snippet: "context?.role === 'superadmin' || context?.role === 'tenant_admin'",
    message: 'catalog writes must be limited to superadmin or tenant_admin roles',
  },
  {
    relativePath: 'lib/marketplace/hospitalProducts.ts',
    snippet: "supabase.storage.from('product-images').upload",
    message: 'product images must upload to the product-images bucket',
  },
  {
    relativePath: 'lib/marketplace/hospitalProducts.ts',
    snippet: "supabase.storage.from('product-images').getPublicUrl",
    message: 'product images must resolve a public product-images URL',
  },
  {
    relativePath: 'app/health-check-results.tsx',
    snippet: 'HealthInsightScreen screen="results"',
    message: 'health results route must render the live v2 health dashboard screen',
  },
  {
    relativePath: 'app/body-overview.tsx',
    snippet: 'HealthInsightScreen screen="overview"',
    message: 'body overview route must render the live v2 health dashboard screen',
  },
  {
    relativePath: 'app/wearable-health.tsx',
    snippet: 'HealthInsightScreen screen="wearable"',
    message: 'wearable route must render the live v2 health dashboard screen',
  },
  {
    relativePath: 'components/HealthInsightScreens.tsx',
    snippet: 'loadHealthDashboardData',
    message: 'health dashboard screens must use the live v2 dashboard loader',
  },
  {
    relativePath: 'lib/health/v2HealthDashboard.ts',
    snippet: ".from('lab_reports')",
    message: 'health dashboard loader must read lab reports from Supabase',
  },
  {
    relativePath: 'lib/health/v2HealthDashboard.ts',
    snippet: ".from('wearable_metrics')",
    message: 'health dashboard loader must read wearable metrics from Supabase',
  },
  {
    relativePath: 'lib/health/v2HealthDashboard.ts',
    snippet: ".from('user_facts')",
    message: 'health dashboard loader must read user facts from Supabase',
  },
  {
    relativePath: 'lib/health/labConfirm.ts',
    snippet: "invokeFunction<LabConfirmRequest, LabConfirmResponse>('lab-confirm'",
    message: 'lab confirmation client must call the trusted lab-confirm edge function',
  },
  {
    relativePath: 'components/HealthInsightScreens.tsx',
    snippet: 'confirmLabResults',
    message: 'health results screen must wire low-confidence lab confirmation to the trusted endpoint',
  },
  {
    relativePath: 'components/HealthInsightScreens.tsx',
    snippet: 'LabConfirmationCard',
    message: 'health results screen must expose editable low-confidence lab confirmation rows',
  },
  {
    relativePath: 'components/admin/ReferrersAdmin.tsx',
    snippet: 'updateSelectedCommissionStatus',
    message: 'referrer admin must expose bulk commission status actions',
  },
  {
    relativePath: 'components/admin/ReferrersAdmin.tsx',
    snippet: ".eq('tenant_id', tenant.id)",
    message: 'bulk commission updates must remain tenant-scoped',
  },
  {
    relativePath: 'components/admin/ReferrersAdmin.tsx',
    snippet: 'Approve Selected',
    message: 'referrer admin must include a bulk approve action',
  },
  {
    relativePath: 'components/admin/ReferrersAdmin.tsx',
    snippet: 'Mark Paid',
    message: 'referrer admin must include a bulk paid action',
  },
  {
    relativePath: 'components/admin/ReferrersAdmin.tsx',
    snippet: "const allowedReferrerTypes",
    message: 'referrer admin must constrain referrer type choices to the schema enum',
  },
  {
    relativePath: 'components/admin/ReferrersAdmin.tsx',
    snippet: "['doctor', 'nurse', 'creator', 'staff']",
    message: 'referrer admin type choices must match the spec-defined enum',
  },
  {
    relativePath: 'components/admin/ReferrersAdmin.tsx',
    snippet: "value={editingId ? draft.refCode : 'Generated on save'}",
    message: 'referrer admin must show generated server-side ref codes as read-only',
  },
  {
    relativePath: 'components/admin/ReferrersAdmin.tsx',
    snippet: ": supabase.from('referrers').insert(payload)",
    message: 'referrer admin must let the database generate ref_code on create',
  },
  {
    relativePath: 'components/admin/ReferrersAdmin.tsx',
    snippet: ".update(payload).eq('id', editingId).eq('tenant_id', tenant.id)",
    message: 'referrer updates must be tenant-scoped and must not include ref_code in the editable payload',
  },
];

for (const { message, relativePath, snippet } of requiredSnippets) {
  const source = fileSources.get(relativePath) ?? '';

  if (!source.includes(snippet)) {
    violations.push(`${relativePath}: ${message}`);
  }
}

const marketplaceSource = fileSources.get('lib/marketplace/hospitalProducts.ts') ?? '';
const saveProductStart = marketplaceSource.indexOf('export async function saveHospitalProductWithRag');
const saveProductPayloadEnd = marketplaceSource.indexOf('const query = productId', saveProductStart);

if (saveProductStart < 0 || saveProductPayloadEnd < 0) {
  violations.push('lib/marketplace/hospitalProducts.ts: unable to locate saveHospitalProductWithRag payload for catalog_key audit');
} else {
  const saveProductPayloadSource = marketplaceSource.slice(saveProductStart, saveProductPayloadEnd);

  if (saveProductPayloadSource.includes('catalog_key')) {
    violations.push('lib/marketplace/hospitalProducts.ts: save payload must not write catalog_key; the database trigger owns catalog key generation and immutability');
  }
}

const prototypeRoute = await fs.readFile(path.join(repoRoot, 'app/prototype.tsx'), 'utf8').catch(() => '');

if (!prototypeRoute.includes('PrototypeChatPanel')) {
  violations.push('app/prototype.tsx: prototype route no longer owns PrototypeChatPanel usage');
}

const forbiddenChatComponentTerms = ['supabase', '.from(', 'invokeFunction', 'fetch(', 'useQuery'];

for (const relativePath of presentationalChatComponents) {
  const source = fileSources.get(relativePath) ?? '';

  for (const term of forbiddenChatComponentTerms) {
    if (source.includes(term)) {
      violations.push(`${relativePath}: presentational chat component must not fetch directly or own data access term "${term}"`);
    }
  }
}

const referrersAdminSource = fileSources.get('components/admin/ReferrersAdmin.tsx') ?? '';

if (referrersAdminSource.includes("'partner'")) {
  violations.push('components/admin/ReferrersAdmin.tsx: referrer type fallback must not use non-spec value "partner"');
}

const saveReferrerStart = referrersAdminSource.indexOf('async function saveReferrer()');
const saveReferrerEnd = referrersAdminSource.indexOf('async function updateCommissionStatus', saveReferrerStart);

if (saveReferrerStart < 0 || saveReferrerEnd < 0) {
  violations.push('components/admin/ReferrersAdmin.tsx: unable to locate saveReferrer for ref_code audit');
} else {
  const saveReferrerSource = referrersAdminSource.slice(saveReferrerStart, saveReferrerEnd);

  if (saveReferrerSource.includes('ref_code')) {
    violations.push('components/admin/ReferrersAdmin.tsx: referrer create/update payloads must not write ref_code; the database trigger owns generation and immutability');
  }
}

const ordersQueueSource = fileSources.get('components/admin/OrdersQueue.tsx') ?? '';

if (ordersQueueSource.includes("supabase.storage.from('payment-slips').createSignedUrl")) {
  violations.push('components/admin/OrdersQueue.tsx: payment-slip signed read URLs must be generated by admin-order-action, not the client');
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(violation);
  }
  process.exit(1);
}

console.log(
  `v2-client-audit: PASS (${productionFiles.length} production files scanned, ${removedRouteFiles.length} removed routes checked, ${clientFiles.length} client files secret-scanned)`,
);
