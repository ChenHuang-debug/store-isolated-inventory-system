create extension if not exists citext;
create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'inventory_runtime') then
    create role inventory_runtime nologin nosuperuser nocreatedb nocreaterole noinherit;
  end if;
end
$$;

create type public.account_status as enum ('invited', 'active', 'disabled');
create type public.store_member_role as enum ('operator', 'viewer');

create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  password_hash text not null,
  status public.account_status not null default 'invited',
  is_system_admin boolean not null default false,
  session_version integer not null default 1 check (session_version > 0),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id)
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z][A-Z0-9_-]{1,15}$'),
  name text not null check (length(btrim(name)) between 1 and 80),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id)
);

create table public.permissions (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{2,63}$'),
  name text not null,
  description text not null,
  sort_order integer not null default 0
);

create table public.user_store_memberships (
  user_id uuid not null references public.app_users(id) on delete restrict,
  store_id uuid not null references public.stores(id) on delete restrict,
  role public.store_member_role not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  primary key (user_id, store_id)
);

create table public.user_store_permissions (
  user_id uuid not null,
  store_id uuid not null,
  permission_code text not null references public.permissions(code) on delete restrict,
  granted_at timestamptz not null default now(),
  granted_by uuid references public.app_users(id),
  primary key (user_id, store_id, permission_code),
  foreign key (user_id, store_id)
    references public.user_store_memberships(user_id, store_id) on delete cascade
);

create table public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null unique check (length(token_hash) = 64),
  session_version integer not null,
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  user_agent text,
  ip_hash text,
  created_at timestamptz not null default now(),
  check (idle_expires_at <= absolute_expires_at)
);

create index app_sessions_user_active_idx
  on public.app_sessions(user_id, absolute_expires_at)
  where revoked_at is null;

create table public.login_attempts (
  id bigint generated always as identity primary key,
  email_hash text not null check (length(email_hash) = 64),
  ip_hash text,
  succeeded boolean not null,
  created_at timestamptz not null default now()
);

create index login_attempts_recent_idx
  on public.login_attempts(email_hash, created_at desc);

create table public.audit_events (
  id bigint generated always as identity primary key,
  request_id uuid not null default gen_random_uuid(),
  actor_user_id uuid references public.app_users(id),
  store_id uuid references public.stores(id),
  action text not null check (length(action) between 3 and 100),
  object_type text not null check (length(object_type) between 2 and 80),
  object_id text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index audit_events_actor_time_idx on public.audit_events(actor_user_id, created_at desc);
create index audit_events_store_time_idx on public.audit_events(store_id, created_at desc);

insert into public.stores(code, name) values
  ('STORE_A', 'STORE_A 店铺'),
  ('STORE_B', 'STORE_B 店铺'),
  ('STORE_C', 'STORE_C 店铺'),
  ('STORE_D', 'STORE_D 店铺');

insert into public.permissions(code, name, description, sort_order) values
  ('view_inventory', '查看库存', '查看授权店铺库存、批次与流水', 10),
  ('manage_products', '管理商品 SKU', '创建、修改和停用授权店铺商品', 20),
  ('manage_suppliers', '管理供应商', '创建、修改和停用授权店铺供应商', 30),
  ('record_arrival', '登记到仓待入', '上传或录入到仓待入批次', 40),
  ('confirm_receipt', '确认实点入库', '按箱数和尾数确认实际入库', 50),
  ('ship_inventory', '执行出库', '上传、校验并确认出库批次', 60),
  ('adjust_inventory', '库存纠错', '将账面库存纠正为实盘数量', 70),
  ('manage_users', '管理用户权限', '创建、停用用户并维护店铺授权', 80),
  ('manage_stores', '管理店铺', '新增、修改和停用店铺', 90),
  ('view_audit', '查看审计', '查看授权范围内审计记录', 100),
  ('view_cross_store_dashboard', '查看跨店汇总', '仅查看各授权店铺聚合数据', 110),
  ('import_initial_inventory', '导入期初库存', '执行受控的店铺期初库存导入', 120);

create function public.app_user_id()
returns uuid language sql stable parallel safe
as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create function public.app_is_admin()
returns boolean language sql stable parallel safe
as $$ select coalesce(nullif(current_setting('app.is_admin', true), '')::boolean, false) $$;

create function public.app_has_store_access(p_store_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.app_is_admin() or exists (
    select 1 from public.user_store_memberships m
    join public.app_users u on u.id = m.user_id
    join public.stores s on s.id = m.store_id
    where m.user_id = public.app_user_id()
      and m.store_id = p_store_id
      and u.status = 'active'
      and s.is_active
  )
$$;

create function public.app_has_permission(p_store_id uuid, p_permission text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.app_is_admin() or exists (
    select 1
    from public.user_store_permissions usp
    join public.app_users u on u.id = usp.user_id
    join public.stores s on s.id = usp.store_id
    where usp.user_id = public.app_user_id()
      and usp.store_id = p_store_id
      and usp.permission_code = p_permission
      and u.status = 'active'
      and s.is_active
  )
$$;

create function public.auth_can_attempt(p_email_hash text, p_ip_hash text)
returns boolean
language sql volatile security definer
set search_path = public, pg_temp
as $$
  select
    (select count(*) from public.login_attempts
      where email_hash = p_email_hash and not succeeded and created_at > now() - interval '15 minutes') < 8
    and
    (select count(*) from public.login_attempts
      where ip_hash = p_ip_hash and not succeeded and created_at > now() - interval '15 minutes') < 20
$$;

create function public.auth_lookup_user(p_email citext)
returns table (
  id uuid,
  email citext,
  display_name text,
  password_hash text,
  status public.account_status,
  is_system_admin boolean,
  session_version integer
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select u.id, u.email, u.display_name, u.password_hash, u.status,
         u.is_system_admin, u.session_version
  from public.app_users u
  where u.email = p_email
$$;

create function public.auth_record_attempt(
  p_email_hash text,
  p_ip_hash text,
  p_succeeded boolean,
  p_user_id uuid default null,
  p_user_agent text default null
) returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.login_attempts(email_hash, ip_hash, succeeded)
  values (p_email_hash, p_ip_hash, p_succeeded);
  insert into public.audit_events(actor_user_id, action, object_type, object_id, metadata, ip_hash, user_agent)
  values (
    case when p_succeeded then p_user_id else null end,
    case when p_succeeded then 'auth.login_succeeded' else 'auth.login_failed' end,
    'session', null, '{}'::jsonb, p_ip_hash, left(p_user_agent, 500)
  );
end
$$;

create function public.auth_create_session(
  p_user_id uuid,
  p_token_hash text,
  p_idle_expires_at timestamptz,
  p_absolute_expires_at timestamptz,
  p_user_agent text,
  p_ip_hash text
) returns uuid
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_session_id uuid;
  v_version integer;
begin
  select session_version into strict v_version
  from public.app_users where id = p_user_id and status = 'active';

  insert into public.app_sessions(
    user_id, token_hash, session_version, idle_expires_at,
    absolute_expires_at, user_agent, ip_hash
  ) values (
    p_user_id, p_token_hash, v_version, p_idle_expires_at,
    p_absolute_expires_at, left(p_user_agent, 500), p_ip_hash
  ) returning id into v_session_id;

  update public.app_users set last_login_at = now(), updated_at = now() where id = p_user_id;
  return v_session_id;
end
$$;

create function public.auth_get_session(p_token_hash text)
returns table (
  session_id uuid,
  user_id uuid,
  email citext,
  display_name text,
  is_system_admin boolean,
  absolute_expires_at timestamptz,
  stores jsonb
)
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with valid as (
    select se.id session_id, u.id user_id, u.email, u.display_name,
           u.is_system_admin, se.absolute_expires_at
    from public.app_sessions se
    join public.app_users u on u.id = se.user_id
    where se.token_hash = p_token_hash
      and se.revoked_at is null
      and se.idle_expires_at > now()
      and se.absolute_expires_at > now()
      and se.session_version = u.session_version
      and u.status = 'active'
  ), access as (
    select v.user_id, coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'code', s.code,
      'name', s.name,
      'permissions', case when v.is_system_admin then
        (select jsonb_agg(p.code order by p.sort_order) from public.permissions p)
      else
        coalesce((select jsonb_agg(usp.permission_code order by p.sort_order)
          from public.user_store_permissions usp
          join public.permissions p on p.code = usp.permission_code
          where usp.user_id = v.user_id and usp.store_id = s.id), '[]'::jsonb)
      end
    ) order by s.code) filter (where s.id is not null), '[]'::jsonb) stores
    from valid v
    left join public.stores s on s.is_active and (
      v.is_system_admin or exists (
        select 1 from public.user_store_memberships m
        where m.user_id = v.user_id and m.store_id = s.id
      )
    )
    group by v.user_id
  )
  select v.session_id, v.user_id, v.email, v.display_name,
         v.is_system_admin, v.absolute_expires_at, a.stores
  from valid v join access a on a.user_id = v.user_id;

  update public.app_sessions
  set last_seen_at = now(),
      idle_expires_at = least(now() + interval '8 hours', absolute_expires_at)
  where token_hash = p_token_hash and revoked_at is null;
end
$$;

create function public.app_set_session_context(p_token_hash text)
returns uuid
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_is_admin boolean;
begin
  select u.id, u.is_system_admin into v_user_id, v_is_admin
  from public.app_sessions se
  join public.app_users u on u.id = se.user_id
  where se.token_hash = p_token_hash
    and se.revoked_at is null
    and se.idle_expires_at > now()
    and se.absolute_expires_at > now()
    and se.session_version = u.session_version
    and u.status = 'active';

  if v_user_id is null then raise exception 'invalid_session' using errcode = '28000'; end if;
  perform set_config('app.user_id', v_user_id::text, true);
  perform set_config('app.is_admin', v_is_admin::text, true);
  return v_user_id;
end
$$;

create function public.auth_revoke_session(p_token_hash text)
returns void
language sql volatile security definer
set search_path = public, pg_temp
as $$
  update public.app_sessions set revoked_at = coalesce(revoked_at, now())
  where token_hash = p_token_hash
$$;

create function public.prevent_audit_mutation()
returns trigger language plpgsql
as $$ begin raise exception 'audit_events are append-only'; end $$;

create trigger audit_events_immutable
before update or delete on public.audit_events
for each row execute function public.prevent_audit_mutation();

alter table public.app_users enable row level security;
alter table public.stores enable row level security;
alter table public.user_store_memberships enable row level security;
alter table public.user_store_permissions enable row level security;
alter table public.audit_events enable row level security;

create policy app_users_read_self_or_admin on public.app_users for select
  using (id = public.app_user_id() or public.app_is_admin());
create policy stores_read_authorized on public.stores for select
  using (public.app_has_store_access(id));
create policy memberships_read_self_or_admin on public.user_store_memberships for select
  using (user_id = public.app_user_id() or public.app_is_admin());
create policy permissions_read_self_or_admin on public.user_store_permissions for select
  using (user_id = public.app_user_id() or public.app_is_admin());
create policy audit_read_authorized on public.audit_events for select
  using (public.app_is_admin() or (actor_user_id = public.app_user_id() and (store_id is null or public.app_has_store_access(store_id))));

revoke all on all tables in schema public from public;
revoke all on all sequences in schema public from public;
revoke all on all functions in schema public from public;
grant usage on schema public to inventory_runtime;
grant select on public.app_users, public.stores, public.permissions,
  public.user_store_memberships, public.user_store_permissions, public.audit_events
  to inventory_runtime;
grant usage, select on all sequences in schema public to inventory_runtime;
grant execute on function public.app_user_id(), public.app_is_admin(),
  public.app_has_store_access(uuid), public.app_has_permission(uuid, text),
  public.auth_can_attempt(text, text), public.auth_lookup_user(citext),
  public.auth_record_attempt(text, text, boolean, uuid, text),
  public.auth_create_session(uuid, text, timestamptz, timestamptz, text, text),
  public.auth_get_session(text), public.app_set_session_context(text),
  public.auth_revoke_session(text)
  to inventory_runtime;
