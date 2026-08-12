-- White-label phase 1: per-tenant vocabulary / branding / vertical config.
-- Additive only. Ships RLS in the same migration (AGENTS.md tenancy rule).

create table if not exists public.tenant_settings (
  tenant_id uuid primary key references public.tenants (id),
  vertical text not null default 'general',
  vocabulary jsonb not null default '{}'::jsonb,
  branding jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.tenant_settings enable row level security;

drop policy if exists tenant_settings_customer_read on public.tenant_settings;
drop policy if exists tenant_settings_staff_read on public.tenant_settings;
drop policy if exists tenant_settings_admin_write on public.tenant_settings;

-- Customers of the tenant may read the vocabulary/branding so the customer UI
-- renders the right words. No row is sensitive; it is presentation config.
create policy tenant_settings_customer_read
  on public.tenant_settings
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.customers c
      where c.tenant_id = tenant_settings.tenant_id
        and c.auth_user_id = auth.uid()
    )
  );

create policy tenant_settings_staff_read
  on public.tenant_settings
  for select
  to authenticated
  using (public.is_tenant_member(tenant_id));

create policy tenant_settings_admin_write
  on public.tenant_settings
  for all
  to authenticated
  using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

-- Seed a generic-default settings row for every existing tenant so logged-in
-- admins immediately read neutral copy ("จัดการสินค้า / ผู้ให้บริการ").
-- Owners can later switch a tenant to a vertical (e.g. 'hospital', 'beauty_clinic')
-- or override individual terms from the admin UI.
insert into public.tenant_settings (tenant_id)
select t.id
from public.tenants t
on conflict (tenant_id) do nothing;
