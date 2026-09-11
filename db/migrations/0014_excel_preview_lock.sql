create function public.lock_upload_preview(
  p_token_hash text,
  p_store_id uuid,
  p_upload_id uuid
) returns table (
  operation_type public.operation_type,
  preview_data jsonb
)
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_operation_type public.operation_type;
  v_preview_data jsonb;
  v_permission text;
  v_auth record;
begin
  select uploaded.operation_type, uploaded.preview_data
  into v_operation_type, v_preview_data
  from public.uploaded_files uploaded
  where uploaded.id = p_upload_id
    and uploaded.store_id = p_store_id
    and uploaded.status = 'previewed'
  for update;

  if not found then
    raise exception 'upload_not_previewed' using errcode = '23514';
  end if;

  v_permission := case v_operation_type
    when 'arrival' then 'record_arrival'
    when 'outbound' then 'ship_inventory'
    else null
  end;
  select * into v_auth
  from public.auth_token_has_permission(p_token_hash, p_store_id, v_permission);
  if v_permission is null or v_auth.actor_user_id is null or not v_auth.allowed then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  return query select v_operation_type, v_preview_data;
end
$$;

revoke all on function public.lock_upload_preview(text, uuid, uuid) from public;
grant execute on function public.lock_upload_preview(text, uuid, uuid) to inventory_runtime;

comment on function public.lock_upload_preview(text, uuid, uuid) is
  '在 Excel 原子入账事务中校验权限并锁定待处理预览；运行账号仍无权直接更新上传记录';
