create or replace function public.auth_get_session(p_token_hash text)
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
           u.is_system_admin, se.absolute_expires_at session_absolute_expires_at
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
         v.is_system_admin, v.session_absolute_expires_at, a.stores
  from valid v join access a on a.user_id = v.user_id;

  update public.app_sessions se
  set last_seen_at = now(),
      idle_expires_at = least(now() + interval '8 hours', se.absolute_expires_at)
  where se.token_hash = p_token_hash and se.revoked_at is null;
end
$$;

revoke all on function public.auth_get_session(text) from public;
grant execute on function public.auth_get_session(text) to inventory_runtime;
