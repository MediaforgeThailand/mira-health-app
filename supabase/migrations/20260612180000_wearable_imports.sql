create table if not exists public.wearable_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  customer_id uuid not null references public.customers (id),
  source text not null check (source in ('apple_export', 'healthkit', 'manual')),
  filename text,
  file_path text,
  metric_count int not null default 0 check (metric_count >= 0),
  imported_at timestamptz not null default now()
);

alter table public.wearable_metrics
  add column if not exists import_id uuid references public.wearable_imports (id);

create index if not exists wearable_imports_customer_imported_idx
  on public.wearable_imports (customer_id, imported_at desc);

create index if not exists wearable_imports_tenant_imported_idx
  on public.wearable_imports (tenant_id, imported_at desc);

create index if not exists wearable_imports_customer_source_file_idx
  on public.wearable_imports (customer_id, source, file_path);

create index if not exists wearable_metrics_import_idx
  on public.wearable_metrics (import_id);

alter table public.wearable_imports enable row level security;

drop policy if exists wearable_imports_customer_read on public.wearable_imports;
drop policy if exists wearable_imports_staff_all on public.wearable_imports;

create policy wearable_imports_customer_read
  on public.wearable_imports
  for select
  to authenticated
  using (
    customer_id in (
      select c.id
      from public.customers c
      where c.auth_user_id = auth.uid()
    )
  );

create policy wearable_imports_staff_all
  on public.wearable_imports
  for all
  to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_admin(tenant_id));
