-- White-label phase 2: vertical-neutral categories.
-- Additive only. Categories already live per-tenant in product_categories; this
-- migration (1) guarantees every tenant has a neutral "general" category to fall
-- back to, and (2) ships a reusable, idempotent per-vertical seeding function for
-- onboarding new tenants. It does NOT edit the old health seed migration.

-- 1. Ensure a neutral default category exists for every tenant.
insert into public.product_categories (tenant_id, key, label_th, icon, sort)
select t.id, 'general', 'ทั่วไป', '📦', 0
from public.tenants t
on conflict (tenant_id, key) do nothing;

-- 2. Per-vertical category template seeding. Idempotent: inserting an existing
--    (tenant_id, key) is a no-op, so this is safe to call repeatedly at onboarding.
create or replace function public.seed_category_template(p_tenant_id uuid, p_vertical text default 'general')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Always provide the neutral fallback.
  insert into public.product_categories (tenant_id, key, label_th, icon, sort)
  values (p_tenant_id, 'general', 'ทั่วไป', '📦', 0)
  on conflict (tenant_id, key) do nothing;

  if p_vertical = 'beauty_clinic' then
    insert into public.product_categories (tenant_id, key, label_th, icon, sort)
    values
      (p_tenant_id, 'facial', 'ทรีตเมนต์ผิวหน้า', '✨', 10),
      (p_tenant_id, 'body', 'ดูแลรูปร่าง', '💆', 20),
      (p_tenant_id, 'laser', 'เลเซอร์/ผิวพรรณ', '🔆', 30),
      (p_tenant_id, 'injection', 'ฉีด/ฟิลเลอร์', '💉', 40),
      (p_tenant_id, 'membership', 'แพ็กเกจสมาชิก', '🎟️', 50)
    on conflict (tenant_id, key) do nothing;
  elsif p_vertical = 'wellness' then
    insert into public.product_categories (tenant_id, key, label_th, icon, sort)
    values
      (p_tenant_id, 'massage', 'นวด/สปา', '💆', 10),
      (p_tenant_id, 'nutrition', 'โภชนาการ', '🥗', 20),
      (p_tenant_id, 'fitness', 'ฟิตเนส/คลาส', '🏋️', 30),
      (p_tenant_id, 'recovery', 'ฟื้นฟูร่างกาย', '🧖', 40)
    on conflict (tenant_id, key) do nothing;
  elsif p_vertical = 'hospital' then
    insert into public.product_categories (tenant_id, key, label_th, icon, sort)
    values
      (p_tenant_id, 'checkup', 'ตรวจสุขภาพ', '🩺', 10),
      (p_tenant_id, 'vaccine', 'วัคซีน', '💉', 20)
    on conflict (tenant_id, key) do nothing;
  elsif p_vertical = 'retail' then
    insert into public.product_categories (tenant_id, key, label_th, icon, sort)
    values
      (p_tenant_id, 'new', 'มาใหม่', '🆕', 10),
      (p_tenant_id, 'bestseller', 'ขายดี', '🔥', 20),
      (p_tenant_id, 'promotion', 'โปรโมชั่น', '🏷️', 30)
    on conflict (tenant_id, key) do nothing;
  end if;
end;
$$;

revoke all on function public.seed_category_template(uuid, text) from public;
revoke all on function public.seed_category_template(uuid, text) from anon;
revoke all on function public.seed_category_template(uuid, text) from authenticated;
