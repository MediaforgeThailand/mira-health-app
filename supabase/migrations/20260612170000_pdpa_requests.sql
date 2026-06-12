create table if not exists public.pdpa_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  customer_id uuid not null,
  kind text not null check (kind in ('export', 'delete')),
  requested_by text not null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists pdpa_requests_tenant_requested_idx
  on public.pdpa_requests (tenant_id, requested_at desc);

create index if not exists pdpa_requests_customer_requested_idx
  on public.pdpa_requests (customer_id, requested_at desc);

alter table public.pdpa_requests enable row level security;

drop policy if exists pdpa_requests_staff_read on public.pdpa_requests;

create policy pdpa_requests_staff_read
  on public.pdpa_requests
  for select
  to authenticated
  using (public.is_tenant_member(tenant_id));
