create table public.initial_import_sources(
 id uuid primary key default gen_random_uuid(),store_id uuid not null references public.stores(id) on delete restrict,
 inventory_filename text not null,inventory_storage_key text not null unique,inventory_sha256 text not null check(length(inventory_sha256)=64),
 mapping_filename text not null,mapping_storage_key text not null unique,mapping_sha256 text not null check(length(mapping_sha256)=64),
 business_date date not null,batch_id uuid not null,created_by uuid not null references public.app_users(id),created_at timestamptz not null default now(),
 unique(store_id),foreign key(batch_id,store_id) references public.operation_batches(id,store_id) on delete restrict
);
alter table public.initial_import_sources enable row level security;
create policy initial_sources_select_store on public.initial_import_sources for select using(public.app_has_store_access(store_id));
grant select on public.initial_import_sources to inventory_runtime;

insert into public.app_users(email,display_name,password_hash,status,is_system_admin)
values('system-bootstrap@local.invalid','系统初始化','!disabled-system-account!','disabled',false)
on conflict(email)do nothing;

create function public.import_demo_initial_inventory(
 p_inventory_filename text,p_inventory_storage_key text,p_inventory_sha256 text,
 p_mapping_filename text,p_mapping_storage_key text,p_mapping_sha256 text,
 p_business_date date,p_products jsonb
)returns uuid language plpgsql volatile security definer set search_path=public,pg_temp
as $$
declare v_store uuid;v_actor uuid;v_batch uuid;v_total bigint;v_count integer;
begin
 select id into strict v_store from public.stores where code='STORE_A' and is_active for update;
 select id into strict v_actor from public.app_users where email='system-bootstrap@local.invalid';
 perform set_config('app.user_id',v_actor::text,true);perform set_config('app.is_admin','true',true);
 if exists(select 1 from public.products where store_id=v_store) then raise exception 'store_catalog_not_empty' using errcode='23514';end if;
 if jsonb_typeof(p_products)<>'array' then raise exception 'products_invalid' using errcode='22023';end if;
 select count(*),coalesce(sum(quantity),0) into v_count,v_total from jsonb_to_recordset(p_products) as x(quantity bigint);
 if v_count<1 or v_total<0 then raise exception 'reconciliation_failed:%:%',v_count,v_total using errcode='23514';end if;
 if exists(select 1 from jsonb_to_recordset(p_products)as x(sku text,name_zh text,model text,quantity bigint) where nullif(btrim(sku),'')is null or nullif(btrim(name_zh),'')is null or nullif(btrim(model),'')is null or quantity<0)then raise exception 'product_fields_invalid' using errcode='23514';end if;
 if(select count(distinct sku)from jsonb_to_recordset(p_products)as x(sku text))<>v_count then raise exception 'duplicate_sku' using errcode='23505';end if;
 insert into public.operation_batches(store_id,operation_type,status,idempotency_key,business_date,note,total_lines,total_qty,posted_at,created_by)
 values(v_store,'initial_import','posted','initial-'||left(p_inventory_sha256,40),p_business_date,'示例店铺期初库存（受控导入）',v_count,v_total,now(),v_actor)returning id into v_batch;
 insert into public.products(store_id,sku,model,style_number,name_zh,color,size,unit,warning_qty,carton_spec_status,created_by,updated_by)
 select v_store,x.sku,x.model,coalesce(x.style_number,''),x.name_zh,coalesce(x.color,''),coalesce(x.size,''),'件',0,'pending',v_actor,v_actor
 from jsonb_to_recordset(p_products)as x(sku text,model text,style_number text,name_zh text,color text,size text,quantity bigint);
 insert into public.inventory_balances(store_id,product_id,available_qty,pending_qty)
 select v_store,p.id,x.quantity,0 from jsonb_to_recordset(p_products)as x(sku text,quantity bigint)join public.products p on p.store_id=v_store and p.sku=x.sku;
 insert into public.operation_batch_items(batch_id,store_id,product_id,quantity,cartons,loose_units,units_per_carton_snapshot,source_row,raw_data)
 select v_batch,v_store,p.id,x.quantity,x.quantity::integer,0,1,x.source_row,jsonb_build_object('sourceSheet',x.source_sheet,'sourceRow',x.source_row,'mappingRow',x.mapping_row,'cartonSpec','待确认')
 from jsonb_to_recordset(p_products)as x(sku text,quantity bigint,source_sheet text,source_row integer,mapping_row integer)join public.products p on p.store_id=v_store and p.sku=x.sku where x.quantity>0;
 insert into public.inventory_ledger(store_id,product_id,batch_id,business_type,delta_available,delta_pending,before_available,after_available,before_pending,after_pending,note,actor_user_id)
 select v_store,p.id,v_batch,'initial_import',x.quantity,0,0,x.quantity,0,0,'示例期初库存',v_actor
 from jsonb_to_recordset(p_products)as x(sku text,quantity bigint)join public.products p on p.store_id=v_store and p.sku=x.sku where x.quantity>0;
 insert into public.initial_import_sources(store_id,inventory_filename,inventory_storage_key,inventory_sha256,mapping_filename,mapping_storage_key,mapping_sha256,business_date,batch_id,created_by)
 values(v_store,p_inventory_filename,p_inventory_storage_key,p_inventory_sha256,p_mapping_filename,p_mapping_storage_key,p_mapping_sha256,p_business_date,v_batch,v_actor);
 insert into public.audit_events(actor_user_id,store_id,action,object_type,object_id,after_data)values(v_actor,v_store,'initial_inventory.imported','operation_batch',v_batch::text,jsonb_build_object('skuCount',v_count,'totalQty',v_total,'inventorySha256',p_inventory_sha256,'mappingSha256',p_mapping_sha256));
 return v_batch;
end $$;
revoke all on function public.import_demo_initial_inventory(text,text,text,text,text,text,date,jsonb)from public;
