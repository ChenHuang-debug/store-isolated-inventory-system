alter table public.products
  drop constraint products_carton_spec_valid;

alter table public.products
  add constraint products_carton_spec_valid check (
    (carton_spec_status = 'pending' and (units_per_carton is null or units_per_carton > 0))
    or (carton_spec_status = 'confirmed' and units_per_carton > 0)
  );

comment on column public.products.units_per_carton is
  '每箱件数；pending 时仅为未确认临时值且禁止正式按箱业务，confirmed 时才可使用';

do $$
declare
  v_actor uuid;
begin
  select id into strict v_actor
  from public.app_users
  where email = 'system-bootstrap@local.invalid';

  perform set_config('app.user_id', v_actor::text, true);
  perform set_config('app.is_admin', 'true', true);

  update public.products p
  set units_per_carton = 60,
      carton_spec_status = 'pending',
      updated_by = v_actor
  from public.stores s
  where s.id = p.store_id
    and s.code = 'STORE_A'
    and p.carton_spec_status = 'pending';

  insert into public.suppliers(
    store_id, code, name, notes, created_by, updated_by
  )
  select s.id, s.code || '-PENDING', '待确认供应商',
    'L9 店铺独立占位记录；仅允许在本店内补充或更正。', v_actor, v_actor
  from public.stores s
  where s.code in ('STORE_A', 'STORE_B', 'STORE_C', 'STORE_D')
    and not exists (
      select 1 from public.suppliers existing
      where existing.store_id = s.id
        and existing.code = s.code || '-PENDING'
    );
end
$$;

create function public.prevent_supplier_store_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.store_id is distinct from old.store_id then
    raise exception 'supplier_store_immutable' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger suppliers_store_immutable
before update of store_id on public.suppliers
for each row execute function public.prevent_supplier_store_change();

create function public.set_demo_initial_temporary_carton_spec()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.carton_spec_status = 'pending'
    and new.units_per_carton is null
    and exists (
      select 1
      from public.stores s
      join public.app_users u on u.email = 'system-bootstrap@local.invalid'
      where s.id = new.store_id
        and s.code = 'STORE_A'
        and u.id = new.created_by
    )
  then
    new.units_per_carton := 60;
  end if;
  return new;
end
$$;

create trigger products_demo_initial_temporary_carton_spec
before insert on public.products
for each row execute function public.set_demo_initial_temporary_carton_spec();

comment on function public.prevent_supplier_store_change() is
  '供应商创建后不得迁移到其他店铺；跨店场景必须使用独立记录';
comment on function public.set_demo_initial_temporary_carton_spec() is
  '受控 STORE_A 期初导入使用临时 60，但保持 pending 并继续受按箱业务门禁';
