create type public.upload_status as enum ('previewed', 'posted', 'rejected');

create table public.uploaded_files (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  operation_type public.operation_type not null check (operation_type in ('arrival','outbound')),
  original_name text not null check (length(original_name) between 1 and 255),
  storage_key text not null unique,
  sha256 text not null check (length(sha256)=64),
  byte_size bigint not null check (byte_size between 1 and 10485760),
  template_version text not null,
  status public.upload_status not null default 'previewed',
  preview_data jsonb not null,
  batch_id uuid,
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  unique(id,store_id),
  foreign key(batch_id,store_id) references public.operation_batches(id,store_id) on delete restrict
);

create unique index uploaded_files_posted_hash_unique
  on public.uploaded_files(store_id,operation_type,sha256) where status='posted';
create index uploaded_files_store_time_idx on public.uploaded_files(store_id,created_at desc);

alter table public.uploaded_files enable row level security;
create policy uploaded_files_select_store on public.uploaded_files for select
  using (public.app_has_store_access(store_id));
grant select on public.uploaded_files to inventory_runtime;

create function public.create_upload_preview(
  p_token_hash text,p_store_id uuid,p_operation_type public.operation_type,
  p_original_name text,p_storage_key text,p_sha256 text,p_byte_size bigint,
  p_template_version text,p_preview_data jsonb
) returns uuid
language plpgsql volatile security definer set search_path=public,pg_temp
as $$
declare v_auth record;v_id uuid;v_permission text;
begin
  v_permission:=case p_operation_type when 'arrival' then 'record_arrival' when 'outbound' then 'ship_inventory' else null end;
  if v_permission is null then raise exception 'unsupported_import_type' using errcode='22023';end if;
  select * into v_auth from public.auth_token_has_permission(p_token_hash,p_store_id,v_permission);
  if v_auth.actor_user_id is null or not v_auth.allowed then raise exception 'permission_denied' using errcode='42501';end if;
  if exists(select 1 from public.uploaded_files where store_id=p_store_id and operation_type=p_operation_type and sha256=p_sha256 and status='posted') then
    raise exception 'duplicate_file' using errcode='23505';
  end if;
  insert into public.uploaded_files(store_id,operation_type,original_name,storage_key,sha256,byte_size,template_version,preview_data,created_by)
  values(p_store_id,p_operation_type,p_original_name,p_storage_key,p_sha256,p_byte_size,p_template_version,p_preview_data,v_auth.actor_user_id)
  returning id into v_id;
  insert into public.audit_events(actor_user_id,store_id,action,object_type,object_id,after_data)
  values(v_auth.actor_user_id,p_store_id,'excel.preview_created','uploaded_file',v_id::text,jsonb_build_object('sha256',p_sha256,'operationType',p_operation_type));
  return v_id;
end $$;

create function public.mark_upload_posted(p_token_hash text,p_store_id uuid,p_upload_id uuid,p_batch_id uuid)
returns void language plpgsql volatile security definer set search_path=public,pg_temp
as $$
declare v_actor uuid;
begin
  select actor_user_id into v_actor from public.auth_token_has_permission(p_token_hash,p_store_id,'view_inventory') where allowed;
  if v_actor is null then raise exception 'permission_denied' using errcode='42501';end if;
  update public.uploaded_files set status='posted',batch_id=p_batch_id,posted_at=now()
  where id=p_upload_id and store_id=p_store_id and status='previewed';
  if not found then raise exception 'upload_not_previewed' using errcode='23514';end if;
end $$;

revoke all on function public.create_upload_preview(text,uuid,public.operation_type,text,text,text,bigint,text,jsonb),public.mark_upload_posted(text,uuid,uuid,uuid) from public;
grant execute on function public.create_upload_preview(text,uuid,public.operation_type,text,text,text,bigint,text,jsonb),public.mark_upload_posted(text,uuid,uuid,uuid) to inventory_runtime;
