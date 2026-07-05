-- Seed: demo-protein tenant (clear protein water persona for the /showcase AI-chat playground)
--
-- Applied to the sandbox project (xwixdxmemwcuoamcloty) on 2026-07-05 via REST.
-- Kept here so the demo persona can be re-created after a database reset.
-- Idempotent: safe to re-run (existence-checked inserts keyed on slug/catalog_key).

with tenant_row as (
  insert into tenants (slug, display_name, logo_url, promptpay_id, attribution_window_days, commission_hold_days, features)
  select 'demo-protein', 'ClearPro น้ำโปรตีนใส', null, '0812345678', 30, 21, '{"line": false, "dashboard": true}'::jsonb
  where not exists (select 1 from tenants where slug = 'demo-protein')
  returning id
),
tenant_id as (
  select id from tenant_row
  union all
  select id from tenants where slug = 'demo-protein'
  limit 1
),
category_seed as (
  insert into product_categories (tenant_id, key, label_th, icon, image_url, sort, active)
  select t.id, c.key, c.label_th, c.icon, null, c.sort, true
  from tenant_id t
  cross join (values
    ('protein', 'น้ำโปรตีนใส', '🥤', 10),
    ('bundle', 'แพ็กสุดคุ้ม', '📦', 20)
  ) as c(key, label_th, icon, sort)
  where not exists (
    select 1 from product_categories pc where pc.tenant_id = t.id and pc.key = c.key
  )
  returning key
)
insert into products (tenant_id, catalog_key, name, description, price_baht, category, image_url, branch_info, requires_appointment, active, commission_mode, commission_value)
select t.id, p.catalog_key, p.name, p.description, p.price_baht, p.category, null,
       'จัดส่งทั่วประเทศ สั่งผ่านแชทได้เลย', false, true, 'percent', 10
from tenant_id t
cross join (values
  ('pw-lychee', 'ClearPro รสลิ้นจี่', 'น้ำโปรตีนใสรสลิ้นจี่ โปรตีน 20 กรัมต่อขวด ไม่มีน้ำตาล 60 แคลอรี่ ดื่มง่าย ใส ไม่ขุ่น ไม่คาว', 89, 'protein'),
  ('pw-yuzu', 'ClearPro รสส้มยูซุ', 'น้ำโปรตีนใสรสส้มยูซุ โปรตีน 20 กรัมต่อขวด ไม่มีน้ำตาล 60 แคลอรี่ สดชื่น เปรี้ยวหอมกำลังดี', 89, 'protein'),
  ('pw-peach', 'ClearPro รสพีช', 'น้ำโปรตีนใสรสพีช โปรตีน 20 กรัมต่อขวด ไม่มีน้ำตาล 60 แคลอรี่ หอมหวานธรรมชาติ ไม่เลี่ยน', 89, 'protein'),
  ('pw-pack12', 'ClearPro แพ็ก 12 ขวด (คละรสได้)', 'แพ็กสุดคุ้ม 12 ขวด เลือกคละรสได้ทุกรส เฉลี่ยขวดละ 75 บาท ส่งฟรีทั่วประเทศ', 899, 'bundle')
) as p(catalog_key, name, description, price_baht, category)
where not exists (
  select 1 from products pr where pr.tenant_id = t.id and pr.catalog_key = p.catalog_key
);
