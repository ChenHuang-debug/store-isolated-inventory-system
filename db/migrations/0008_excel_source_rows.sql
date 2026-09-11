create function public.set_batch_item_source_row()
returns trigger language plpgsql set search_path=public,pg_temp
as $$
begin
  if new.source_row is null and new.raw_data ? 'sourceRow' then
    new.source_row:=nullif(new.raw_data->>'sourceRow','')::integer;
  end if;
  if new.source_row is not null and new.source_row<1 then
    raise exception 'source_row_invalid' using errcode='23514';
  end if;
  return new;
end $$;
create trigger operation_batch_items_source_row before insert on public.operation_batch_items
for each row execute function public.set_batch_item_source_row();

create or replace function public.mark_upload_posted(p_token_hash text,p_store_id uuid,p_upload_id uuid,p_batch_id uuid)
returns void language plpgsql volatile security definer set search_path=public,pg_temp
as $$
declare v_actor uuid;v_permission text;
begin
  select case operation_type when 'arrival' then 'record_arrival' when 'outbound' then 'ship_inventory' end
  into v_permission from public.uploaded_files where id=p_upload_id and store_id=p_store_id and status='previewed' for update;
  if v_permission is null then raise exception 'upload_not_previewed' using errcode='23514';end if;
  select actor_user_id into v_actor from public.auth_token_has_permission(p_token_hash,p_store_id,v_permission) where allowed;
  if v_actor is null then raise exception 'permission_denied' using errcode='42501';end if;
  update public.uploaded_files set status='posted',batch_id=p_batch_id,posted_at=now()
  where id=p_upload_id and store_id=p_store_id and status='previewed';
  if not found then raise exception 'upload_not_previewed' using errcode='23514';end if;
end $$;
