alter table public.app_users
  add column mfa_secret_encrypted text,
  add column mfa_enrolled_at timestamptz,
  add constraint app_users_mfa_pair_check check (
    (mfa_secret_encrypted is null and mfa_enrolled_at is null)
    or
    (mfa_secret_encrypted is not null and mfa_enrolled_at is not null
      and length(mfa_secret_encrypted) between 40 and 1000)
  );

drop function public.auth_lookup_user(citext);

create function public.auth_lookup_user(p_email citext)
returns table (
  id uuid,
  email citext,
  display_name text,
  password_hash text,
  status public.account_status,
  is_system_admin boolean,
  session_version integer,
  mfa_secret_encrypted text,
  mfa_enrolled_at timestamptz
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select u.id, u.email, u.display_name, u.password_hash, u.status,
         u.is_system_admin, u.session_version,
         u.mfa_secret_encrypted, u.mfa_enrolled_at
  from public.app_users u
  where u.email = p_email
$$;

revoke all on function public.auth_lookup_user(citext) from public;
grant execute on function public.auth_lookup_user(citext) to inventory_runtime;
