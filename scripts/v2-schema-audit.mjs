import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();

const files = {
  phase1: 'supabase/migrations/20260611010000_miracare_v2_phase1_foundations.sql',
  phase2: 'supabase/migrations/20260611020000_miracare_v2_phase2_chat.sql',
  phase3: 'supabase/migrations/20260611030000_miracare_v2_phase3_orders.sql',
  phase4: 'supabase/migrations/20260611040000_miracare_v2_phase4_referrals.sql',
  phase5: 'supabase/migrations/20260611050000_miracare_v2_phase5_health_dashboard.sql',
  b8: 'supabase/migrations/20260611062000_b8_referrer_contract.sql',
  r5: 'supabase/migrations/20260612180000_wearable_imports.sql',
};

async function read(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), 'utf8');
}

const sourceEntries = await Promise.all(
  Object.entries(files).map(async ([key, relativePath]) => [key, await read(relativePath)]),
);
const sources = Object.fromEntries(sourceEntries);
const violations = [];
const migrationFileNames = (await fs.readdir(path.join(repoRoot, 'supabase/migrations')))
  .filter((name) => name.endsWith('.sql'))
  .sort();

function expect(name, condition, detail) {
  if (!condition) {
    violations.push(`${name}: ${detail}`);
  }
}

function includesAll(fileKey, snippets) {
  const source = sources[fileKey];
  return snippets.every((snippet) => source.includes(snippet));
}

const tableContracts = [
  {
    file: 'phase1',
    table: 'tenants',
    snippets: ['slug text not null unique', 'attribution_window_days int not null default 30', 'created_at timestamptz not null default now()'],
  },
  {
    file: 'phase1',
    table: 'customers',
    snippets: ['tenant_id uuid not null references public.tenants (id)', 'auth_user_id uuid references auth.users (id)', 'created_at timestamptz not null default now()'],
  },
  {
    file: 'phase1',
    table: 'tenant_members',
    snippets: ['tenant_id uuid not null references public.tenants (id)', 'auth_user_id uuid not null references auth.users (id)', "role text not null check (role in ('superadmin', 'tenant_admin', 'tenant_staff'))"],
  },
  {
    file: 'phase1',
    table: 'products',
    snippets: ['tenant_id uuid not null references public.tenants (id)', 'catalog_key text not null', 'updated_at timestamptz not null default now()', 'unique (tenant_id, catalog_key)'],
  },
  {
    file: 'phase1',
    table: 'fact_keys',
    snippets: ["value_kind text not null check (value_kind in ('number', 'text', 'text_list', 'date_fuzzy'))"],
  },
  {
    file: 'phase1',
    table: 'user_facts',
    snippets: ['tenant_id uuid not null references public.tenants (id)', 'customer_id uuid not null references public.customers (id)', 'key text not null references public.fact_keys (key)', 'superseded_by uuid references public.user_facts (id)', 'created_at timestamptz not null default now()'],
  },
  {
    file: 'phase1',
    table: 'consents',
    snippets: ['tenant_id uuid not null references public.tenants (id)', 'customer_id uuid not null references public.customers (id)', "kind text not null check (kind in ('health_data_collection'))", 'created_at timestamptz not null default now()'],
  },
  {
    file: 'phase2',
    table: 'chat_sessions',
    snippets: ['tenant_id uuid not null references public.tenants (id)', 'customer_id uuid not null references public.customers (id)', "channel text not null check (channel in ('app', 'pwa', 'line'))", 'created_at timestamptz not null default now()'],
  },
  {
    file: 'phase2',
    table: 'chat_messages',
    snippets: ['session_id uuid not null references public.chat_sessions (id)', "role text not null check (role in ('user', 'assistant', 'system_notice'))", "marker_product_ids text[] not null default '{}'", 'client_msg_id text', 'created_at timestamptz not null default now()', 'unique (session_id, client_msg_id)'],
  },
  {
    file: 'phase3',
    table: 'orders',
    snippets: ['tenant_id uuid not null references public.tenants (id)', 'product_id uuid not null references public.products (id)', "channel text not null check (channel in ('chat_app', 'chat_pwa', 'chat_line', 'referrer'))", 'updated_at timestamptz not null default now()'],
  },
  {
    file: 'phase3',
    table: 'order_events',
    snippets: ['order_id uuid not null references public.orders (id)', 'meta jsonb not null default', 'created_at timestamptz not null default now()'],
  },
  {
    file: 'phase4',
    table: 'referrers',
    snippets: ['tenant_id uuid not null references public.tenants (id)', 'ref_code text not null', "type text not null check (type in ('doctor', 'nurse', 'creator', 'staff'))", 'commission_scheme jsonb not null default', 'created_at timestamptz not null default now()'],
  },
  {
    file: 'phase4',
    table: 'commission_entries',
    snippets: ['tenant_id uuid not null references public.tenants (id)', 'referrer_id uuid not null references public.referrers (id)', 'order_id uuid not null references public.orders (id) unique', 'scheme_snapshot jsonb not null'],
  },
  {
    file: 'phase5',
    table: 'lab_reports',
    snippets: ['tenant_id uuid not null references public.tenants (id)', 'customer_id uuid not null references public.customers (id)', 'storage_path text not null', 'created_at timestamptz not null default now()'],
  },
  {
    file: 'phase5',
    table: 'lab_results',
    snippets: ['report_id uuid not null references public.lab_reports (id) on delete cascade', 'test_code text not null', 'confidence numeric not null check (confidence between 0 and 1)', 'unique (report_id, test_code)'],
  },
  {
    file: 'phase5',
    table: 'wearable_metrics',
    snippets: ['tenant_id uuid not null references public.tenants (id)', 'customer_id uuid not null references public.customers (id)', "source text not null check (source in ('apple_export', 'healthkit', 'manual'))", 'unique (customer_id, metric, day, source)'],
  },
  {
    file: 'r5',
    table: 'wearable_imports',
    snippets: ['tenant_id uuid not null references public.tenants (id)', 'customer_id uuid not null references public.customers (id)', "source text not null check (source in ('apple_export', 'healthkit', 'manual'))", 'metric_count int not null default 0', 'imported_at timestamptz not null default now()'],
  },
];

for (const { file, snippets, table } of tableContracts) {
  expect(`${table} schema`, sources[file].includes(`create table if not exists public.${table} (`), 'missing create table statement');
  expect(`${table} contract columns`, includesAll(file, snippets), 'missing one or more spec-required columns, constraints, or defaults');
  expect(`${table} rls`, sources[file].includes(`alter table public.${table} enable row level security;`), 'missing RLS enable statement');
}

const policySnippets = [
  ['phase1', 'tenants_member_read'],
  ['phase1', 'customers_customer_read'],
  ['phase1', 'customers_staff_all'],
  ['phase1', 'products_customer_active_read'],
  ['phase1', 'products_admin_write'],
  ['phase1', 'fact_keys_authenticated_read'],
  ['phase1', 'user_facts_customer_read'],
  ['phase1', 'user_facts_customer_insert'],
  ['phase1', 'user_facts_staff_all'],
  ['phase1', 'consents_customer_read'],
  ['phase1', 'consents_customer_insert'],
  ['phase1', 'consents_staff_all'],
  ['phase2', 'chat_sessions_customer_read'],
  ['phase2', 'chat_sessions_staff_all'],
  ['phase2', 'chat_messages_customer_read'],
  ['phase2', 'chat_messages_staff_all'],
  ['phase3', 'orders_customer_read'],
  ['phase3', 'orders_staff_all'],
  ['phase3', 'order_events_staff_read'],
  ['phase4', 'referrers_staff_read'],
  ['phase4', 'referrers_own_read'],
  ['phase4', 'referrers_admin_insert'],
  ['phase4', 'referrers_admin_update'],
  ['phase4', 'commission_entries_staff_read'],
  ['phase4', 'commission_entries_referrer_read'],
  ['phase4', 'commission_entries_admin_update'],
  ['phase5', 'lab_reports_customer_read'],
  ['phase5', 'lab_reports_staff_all'],
  ['phase5', 'lab_results_customer_read'],
  ['phase5', 'lab_results_staff_all'],
  ['phase5', 'wearable_metrics_customer_read'],
  ['phase5', 'wearable_metrics_staff_all'],
  ['r5', 'wearable_imports_customer_read'],
  ['r5', 'wearable_imports_staff_all'],
];

for (const [file, policy] of policySnippets) {
  expect(`${policy} policy`, sources[file].includes(`create policy ${policy}`), 'missing expected RLS policy');
}

const indexSnippets = [
  ['phase1', 'customers_tenant_idx on public.customers (tenant_id)'],
  ['phase1', 'customers_auth_user_idx on public.customers (auth_user_id)'],
  ['phase1', 'tenant_members_auth_user_idx on public.tenant_members (auth_user_id)'],
  ['phase1', 'products_tenant_active_category_idx on public.products (tenant_id, active, category)'],
  ['phase1', 'user_facts_tenant_idx on public.user_facts (tenant_id)'],
  ['phase1', 'user_facts_customer_idx on public.user_facts (customer_id)'],
  ['phase1', 'user_facts_key_idx on public.user_facts (key)'],
  ['phase1', 'user_facts_superseded_by_idx on public.user_facts (superseded_by)'],
  ['phase1', 'user_facts_dedupe on public.user_facts (customer_id, key, source, source_ref)'],
  ['phase1', 'consents_tenant_idx on public.consents (tenant_id)'],
  ['phase1', 'consents_customer_kind_created_idx on public.consents (customer_id, kind, created_at desc)'],
  ['phase2', 'chat_sessions_v2_tenant_last_message_idx'],
  ['phase2', 'chat_sessions_v2_customer_created_idx'],
  ['phase2', 'chat_messages_v2_session_created_idx'],
  ['phase3', 'orders_v2_tenant_status_created_idx'],
  ['phase3', 'orders_v2_customer_created_idx'],
  ['phase3', 'orders_v2_session_created_idx'],
  ['phase3', 'orders_v2_product_idx'],
  ['phase3', 'order_events_v2_order_created_idx'],
  ['phase4', 'referrers_v2_tenant_active_idx'],
  ['phase4', 'referrers_v2_auth_user_idx'],
  ['b8', 'referrers_tenant_ref_code_key'],
  ['phase4', 'commission_entries_v2_tenant_status_idx'],
  ['phase4', 'commission_entries_v2_referrer_created_idx'],
  ['phase4', 'customers_v2_referred_by_idx'],
  ['phase4', 'orders_v2_referrer_idx'],
  ['phase5', 'lab_reports_v2_customer_created_idx'],
  ['phase5', 'lab_reports_v2_tenant_status_idx'],
  ['phase5', 'lab_results_v2_code_idx'],
  ['phase5', 'wearable_metrics_v2_customer_metric_day_idx'],
  ['phase5', 'wearable_metrics_v2_tenant_day_idx'],
  ['r5', 'wearable_imports_customer_imported_idx'],
  ['r5', 'wearable_imports_tenant_imported_idx'],
  ['r5', 'wearable_imports_customer_source_file_idx'],
  ['r5', 'wearable_metrics_import_idx'],
];

for (const [file, snippet] of indexSnippets) {
  expect(`${snippet} index`, sources[file].includes(snippet), 'missing expected FK/query index');
}

const migrationTimestamps = new Set();

for (const fileName of migrationFileNames) {
  const match = fileName.match(/^(\d{14})_[a-z0-9][a-z0-9_]*\.sql$/);

  expect(
    `${fileName} migration name`,
    match !== null,
    'migration files must be numbered as 2026MMDDHHMMSS_*.sql with lowercase snake_case names',
  );

  if (match !== null) {
    expect(`${fileName} migration timestamp`, !migrationTimestamps.has(match[1]), 'migration timestamps must be unique');
    migrationTimestamps.add(match[1]);
  }
}

expect(
  'catalog key immutability',
  sources.phase1.includes('products_catalog_key_guard') && sources.phase1.includes("raise exception 'catalog_key is immutable'"),
  'products.catalog_key must be generated and immutable',
);

expect(
  'legacy catalog consolidation',
  sources.phase1.includes("to_regclass('public.hospital_products')") &&
    sources.phase1.includes('insert into public.products') &&
    sources.phase1.includes('drop table if exists public.hospital_products'),
  'Phase 1 must consolidate and remove legacy hospital_products',
);

expect(
  'storage bucket contract',
  sources.phase1.includes("('lab-reports', 'lab-reports', false)") &&
    sources.phase1.includes("('payment-slips', 'payment-slips', false)") &&
    sources.phase1.includes("('product-images', 'product-images', true)"),
  'Phase 1 must create private lab/payment buckets and public product images bucket',
);

expect(
  'wearable metric import link',
  sources.r5.includes('alter table public.wearable_metrics') &&
    sources.r5.includes('add column if not exists import_id uuid references public.wearable_imports (id)'),
  'R5 must link wearable_metrics rows to their wearable_imports row',
);

expect(
  'referral foreign keys',
  sources.phase4.includes('customers_referred_by_fkey') && sources.phase4.includes('orders_referrer_fkey'),
  'Phase 4 must attach referral foreign keys to customers and orders',
);

expect(
  'referrer code B8 contract',
  sources.b8.includes("v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ'") &&
    sources.b8.includes("ref_code ~ '^[0-9A-HJKMNP-TV-Z]{6}$'") &&
    sources.b8.includes('create unique index if not exists referrers_tenant_ref_code_key') &&
    sources.b8.includes('miracare_referrer_ref_code_guard') &&
    sources.b8.includes("raise exception 'ref_code is immutable'") &&
    sources.b8.includes('commission_scheme set default') &&
    sources.b8.includes('{"mode":"percent","default":10,"by_category":{}}'),
  'B8 must enforce generated immutable 6-character Crockford ref codes and the percent/10 default commission scheme',
);

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(violation);
  }
  process.exit(1);
}

console.log(`v2-schema-audit: PASS (${tableContracts.length} tables, ${policySnippets.length} policies, ${indexSnippets.length} indexes, ${migrationFileNames.length} migrations checked)`);
