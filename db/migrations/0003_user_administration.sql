create function public.auth_actor(p_token_hash text)
returns table (user_id uuid, is_system_admin boolean)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select u.id, u.is_system_admin
  from public.app_sessions se
  join public.app_users u on u.id = se.user_id
  where se.token_hash = p_token_hash
    and se.revoked_at is null
    and se.idle_expires_at > now()
    and se.absolute_expires_at > now()
    and se.session_version = u.session_version
    and u.status = 'active'
$$;

create function public.admin_list_users(p_token_hash text)
returns table (
  id uuid,
  email citext,
  display_name text,
  status public.account_status,
  is_system_admin boolean,
  last_login_at timestamptz,
  created_at timestamptz,
  store_access jsonb
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_actor record;
begin
  select * into v_actor from public.auth_actor(p_token_hash);
  if v_actor.user_id is null or not v_actor.is_system_admin then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  return query
  select u.id, u.email, u.display_name, u.status, u.is_system_admin,
         u.last_login_at, u.created_at,
         coalesce(jsonb_agg(jsonb_build_object(
           'storeId', s.id, 'storeCode', s.code, 'storeName', s.name,
           'role', m.role,
           'permissions', coalesce((
             select jsonb_agg(usp.permission_code order by p.sort_order)
             from public.user_store_permissions usp
             join public.permissions p on p.code = usp.permission_code
             where usp.user_id = u.id and usp.store_id = s.id
           ), '[]'::jsonb)
         ) order by s.code) filter (where s.id is not null), '[]'::jsonb)
  from public.app_users u
  left join public.user_store_memberships m on m.user_id = u.id
  left join public.stores s on s.id = m.store_id
  group by u.id
  order by u.created_at, u.email;
end
$$;

create function public.admin_create_user(
  p_token_hash text,
  p_email citext,
  p_display_name text,
  p_password_hash text,
  p_store_id uuid,
  p_role public.store_member_role,
  p_permissions text[]
) returns uuid
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_actor record;
  v_user_id uuid;
  v_unknown text;
begin
  select * into v_actor from public.auth_actor(p_token_hash);
  if v_actor.user_id is null or not v_actor.is_system_admin then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.stores where id = p_store_id and is_active) then
    raise exception 'invalid_store' using errcode = '23514';
  end if;
  select x into v_unknown from unnest(p_permissions) x
    where not exists (select 1 from public.permissions p where p.code = x) limit 1;
  if v_unknown is not null then raise exception 'invalid_permission:%', v_unknown using errcode = '23514'; end if;

  insert into public.app_users(
    email, display_name, password_hash, status, is_system_admin, created_by, updated_by
  ) values (
    lower(btrim(p_email::text))::citext, btrim(p_display_name), p_password_hash,
    'active', false, v_actor.user_id, v_actor.user_id
  ) returning id into v_user_id;

  insert into public.user_store_memberships(user_id, store_id, role, created_by)
  values (v_user_id, p_store_id, p_role, v_actor.user_id);
  insert into public.user_store_permissions(user_id, store_id, permission_code, granted_by)
  select v_user_id, p_store_id, distinct_codes.code, v_actor.user_id
  from (select distinct unnest(p_permissions) code) distinct_codes;

  insert into public.audit_events(actor_user_id, store_id, action, object_type, object_id, after_data)
  values (v_actor.user_id, p_store_id, 'user.created', 'user', v_user_id::text,
    jsonb_build_object('email', p_email, 'displayName', p_display_name, 'role', p_role, 'permissions', p_permissions));
  return v_user_id;
end
$$;

create function public.admin_set_store_access(
  p_token_hash text,
  p_target_user_id uuid,
  p_store_id uuid,
  p_role public.store_member_role,
  p_permissions text[],
  p_revoke boolean default false
) returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_actor record;
  v_target public.app_users%rowtype;
  v_unknown text;
begin
  select * into v_actor from public.auth_actor(p_token_hash);
  if v_actor.user_id is null or not v_actor.is_system_admin then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  select * into strict v_target from public.app_users where id = p_target_user_id for update;
  if v_target.is_system_admin then raise exception 'admin_access_is_global' using errcode = '23514'; end if;

  if p_revoke then
    if (select count(*) from public.user_store_memberships where user_id = p_target_user_id) <= 1 then
      raise exception 'user_requires_one_store' using errcode = '23514';
    end if;
    delete from public.user_store_memberships where user_id = p_target_user_id and store_id = p_store_id;
    insert into public.audit_events(actor_user_id, store_id, action, object_type, object_id)
    values (v_actor.user_id, p_store_id, 'user.store_access_revoked', 'user', p_target_user_id::text);
    return;
  end if;

  if not exists (select 1 from public.stores where id = p_store_id and is_active) then
    raise exception 'invalid_store' using errcode = '23514';
  end if;
  select x into v_unknown from unnest(p_permissions) x
    where not exists (select 1 from public.permissions p where p.code = x) limit 1;
  if v_unknown is not null then raise exception 'invalid_permission:%', v_unknown using errcode = '23514'; end if;

  insert into public.user_store_memberships(user_id, store_id, role, created_by)
  values (p_target_user_id, p_store_id, p_role, v_actor.user_id)
  on conflict (user_id, store_id) do update set role = excluded.role;
  delete from public.user_store_permissions where user_id = p_target_user_id and store_id = p_store_id;
  insert into public.user_store_permissions(user_id, store_id, permission_code, granted_by)
  select p_target_user_id, p_store_id, distinct_codes.code, v_actor.user_id
  from (select distinct unnest(p_permissions) code) distinct_codes;
  update public.app_users set session_version = session_version + 1, updated_at = now(), updated_by = v_actor.user_id
  where id = p_target_user_id;
  update public.app_sessions set revoked_at = coalesce(revoked_at, now()) where user_id = p_target_user_id;

  insert into public.audit_events(actor_user_id, store_id, action, object_type, object_id, after_data)
  values (v_actor.user_id, p_store_id, 'user.store_access_changed', 'user', p_target_user_id::text,
    jsonb_build_object('role', p_role, 'permissions', p_permissions));
end
$$;

create function public.admin_set_user_status(
  p_token_hash text,
  p_target_user_id uuid,
  p_status public.account_status
) returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_actor record;
  v_before public.account_status;
begin
  select * into v_actor from public.auth_actor(p_token_hash);
  if v_actor.user_id is null or not v_actor.is_system_admin then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_target_user_id = v_actor.user_id and p_status <> 'active' then
    raise exception 'cannot_disable_self' using errcode = '23514';
  end if;
  select status into strict v_before from public.app_users where id = p_target_user_id for update;
  update public.app_users set status = p_status, session_version = session_version + 1,
    updated_at = now(), updated_by = v_actor.user_id where id = p_target_user_id;
  update public.app_sessions set revoked_at = coalesce(revoked_at, now()) where user_id = p_target_user_id;
  insert into public.audit_events(actor_user_id, action, object_type, object_id, before_data, after_data)
  values (v_actor.user_id, 'user.status_changed', 'user', p_target_user_id::text,
    jsonb_build_object('status', v_before), jsonb_build_object('status', p_status));
end
$$;

revoke all on function public.auth_actor(text) from public;
revoke all on function public.admin_list_users(text) from public;
revoke all on function public.admin_create_user(text, citext, text, text, uuid, public.store_member_role, text[]) from public;
revoke all on function public.admin_set_store_access(text, uuid, uuid, public.store_member_role, text[], boolean) from public;
revoke all on function public.admin_set_user_status(text, uuid, public.account_status) from public;
grant execute on function public.admin_list_users(text),
  public.admin_create_user(text, citext, text, text, uuid, public.store_member_role, text[]),
  public.admin_set_store_access(text, uuid, uuid, public.store_member_role, text[], boolean),
  public.admin_set_user_status(text, uuid, public.account_status)
  to inventory_runtime;
