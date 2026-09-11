create type public.carton_spec_status as enum ('pending', 'confirmed');

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  sku text not null unique check (length(btrim(sku)) between 1 and 100),
  model text not null check (length(btrim(model)) between 1 and 100),
  style_number text not null default '',
  name_zh text not null check (length(btrim(name_zh)) between 1 and 200),
  color text not null default '',
  size text not null default '',
  unit text not null default '件' check (length(btrim(unit)) between 1 and 20),
  warning_qty bigint not null default 0 check (warning_qty >= 0),
  units_per_carton integer,
  carton_spec_status public.carton_spec_status not null default 'pending',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.app_users(id),
  updated_by uuid not null references public.app_users(id),
  unique (id, store_id),
  constraint products_variant_unique unique (store_id, model, style_number, color, size),
  constraint products_carton_spec_valid check (
    (carton_spec_status = 'pending' and units_per_carton is null)
    or (carton_spec_status = 'confirmed' and units_per_carton > 0)
  )
);

create index products_store_active_idx
  on public.products(store_id, is_active, model, style_number);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  code text not null check (length(btrim(code)) between 1 and 50),
  name text not null check (length(btrim(name)) between 1 and 150),
  origin text not null default '',
  contact_name text not null default '',
  contact_phone text not null default '',
  notes text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.app_users(id),
  updated_by uuid not null references public.app_users(id),
  unique (id, store_id),
  unique (store_id, code)
);

create index suppliers_store_active_idx on public.suppliers(store_id, is_active, name);

create table public.product_supplier_links (
  store_id uuid not null,
  product_id uuid not null,
  supplier_id uuid not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.app_users(id),
  primary key (product_id, supplier_id),
  foreign key (product_id, store_id) references public.products(id, store_id) on delete cascade,
  foreign key (supplier_id, store_id) references public.suppliers(id, store_id) on delete restrict
);

create unique index product_supplier_one_primary_idx
  on public.product_supplier_links(product_id) where is_primary;

create function public.touch_updated_at()
returns trigger language plpgsql
as $$ begin new.updated_at = now(); return new; end $$;

create trigger products_touch_updated_at before update on public.products
for each row execute function public.touch_updated_at();
create trigger suppliers_touch_updated_at before update on public.suppliers
for each row execute function public.touch_updated_at();

alter table public.products enable row level security;
alter table public.suppliers enable row level security;
alter table public.product_supplier_links enable row level security;

create policy products_select_store on public.products for select
  using (public.app_has_store_access(store_id));
create policy products_insert_permission on public.products for insert
  with check (public.app_has_permission(store_id, 'manage_products'));
create policy products_update_permission on public.products for update
  using (public.app_has_permission(store_id, 'manage_products'))
  with check (public.app_has_permission(store_id, 'manage_products'));

create policy suppliers_select_store on public.suppliers for select
  using (public.app_has_store_access(store_id));
create policy suppliers_insert_permission on public.suppliers for insert
  with check (public.app_has_permission(store_id, 'manage_suppliers'));
create policy suppliers_update_permission on public.suppliers for update
  using (public.app_has_permission(store_id, 'manage_suppliers'))
  with check (public.app_has_permission(store_id, 'manage_suppliers'));

create policy product_supplier_select_store on public.product_supplier_links for select
  using (public.app_has_store_access(store_id));
create policy product_supplier_insert_permission on public.product_supplier_links for insert
  with check (public.app_has_permission(store_id, 'manage_products'));
create policy product_supplier_update_permission on public.product_supplier_links for update
  using (public.app_has_permission(store_id, 'manage_products'))
  with check (public.app_has_permission(store_id, 'manage_products'));
create policy product_supplier_delete_permission on public.product_supplier_links for delete
  using (public.app_has_permission(store_id, 'manage_products'));

create function public.audit_catalog_change()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.app_user_id();
  v_store uuid := coalesce(new.store_id, old.store_id);
  v_id text := coalesce(new.id, old.id)::text;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_events(actor_user_id, store_id, action, object_type, object_id, after_data)
    values (v_actor, v_store, lower(tg_table_name) || '.created', tg_table_name, v_id, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_events(actor_user_id, store_id, action, object_type, object_id, before_data, after_data)
    values (v_actor, v_store, lower(tg_table_name) || '.updated', tg_table_name, v_id, to_jsonb(old), to_jsonb(new));
    return new;
  end if;
  return old;
end
$$;

create trigger products_audit after insert or update on public.products
for each row execute function public.audit_catalog_change();
create trigger suppliers_audit after insert or update on public.suppliers
for each row execute function public.audit_catalog_change();

grant select, insert, update on public.products, public.suppliers to inventory_runtime;
grant select, insert, update, delete on public.product_supplier_links to inventory_runtime;

comment on table public.products is '店铺隔离的商品 SKU 主数据；SKU 全局唯一';
comment on column public.products.units_per_carton is '确认箱规后每箱件数；待确认时必须为空';
comment on table public.product_supplier_links is '商品与供应商同店铺关联，由复合外键强制';
