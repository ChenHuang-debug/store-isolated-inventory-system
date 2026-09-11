alter table public.products
  drop constraint products_carton_spec_valid;

alter table public.products
  add constraint products_carton_spec_valid check (
    (
      carton_spec_status = 'pending'
      and (units_per_carton is null or units_per_carton > 0)
    )
    or (
      carton_spec_status = 'confirmed'
      and units_per_carton is not null
      and units_per_carton > 0
    )
  );

create or replace function public.set_demo_initial_temporary_carton_spec()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.carton_spec_status = 'pending'
    and new.units_per_carton is null
    and exists (
      select 1
      from public.stores s
      join public.app_users u on u.email::text = 'system-bootstrap@local.invalid'
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

do $$
declare
  v_actor uuid;
begin
  select id into strict v_actor
  from public.app_users
  where email::text = 'system-bootstrap@local.invalid';

  perform set_config('app.user_id', v_actor::text, true);
  perform set_config('app.is_admin', 'true', true);

  update public.products p
  set units_per_carton = 60,
      carton_spec_status = 'pending',
      updated_by = v_actor
  from public.stores s
  where s.id = p.store_id
    and s.code = 'STORE_A';
end
$$;

comment on function public.set_demo_initial_temporary_carton_spec() is
  '受控 STORE_A 期初导入使用临时 60；security definer 仅为读取固定系统账号与店铺，不接受调用者参数';
