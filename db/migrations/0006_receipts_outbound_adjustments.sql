create table public.discrepancy_reasons (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{2,63}$'),
  label text not null,
  category text not null check (category in ('receipt', 'adjustment', 'both')),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

insert into public.discrepancy_reasons(code,label,category,sort_order) values
 ('supplier_over','供应商多发','receipt',10),
 ('supplier_short','供应商少发','receipt',20),
 ('carton_mismatch','装箱数量不符','receipt',30),
 ('transit_damage','运输破损或丢失','receipt',40),
 ('count_error','仓库清点误差','both',50),
 ('system_error','系统历史数据错误','adjustment',60),
 ('damage_loss','破损或丢失','adjustment',70),
 ('other','其他','both',999);

alter table public.inventory_ledger
  add constraint inventory_ledger_reason_fk foreign key (reason_code)
  references public.discrepancy_reasons(code) on delete restrict;

grant select on public.discrepancy_reasons to inventory_runtime;

create function public.reason_label(p_code text, p_category text)
returns text language sql stable security definer set search_path=public,pg_temp
as $$ select label from public.discrepancy_reasons where code=p_code and is_active and (category=p_category or category='both') $$;

create function public.confirm_pending_receipts(
 p_token_hash text,p_store_id uuid,p_idempotency_key text,p_business_date date,p_note text,p_items jsonb
) returns table(batch_id uuid,replayed boolean)
language plpgsql volatile security definer set search_path=public,pg_temp
as $$
declare
 v_auth record;v_scope text:=p_store_id::text||':receipt';v_hash text;v_existing record;v_batch uuid;
 v_item jsonb;v_pr record;v_bal record;v_item_id uuid;v_actual bigint;v_cartons integer;v_loose integer;
 v_decrease bigint;v_reason text;v_reason_label text;v_total bigint:=0;v_lines integer;
begin
 select * into v_auth from public.auth_token_has_permission(p_token_hash,p_store_id,'confirm_receipt');
 if v_auth.actor_user_id is null or not v_auth.allowed then raise exception 'permission_denied' using errcode='42501';end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>2000 then raise exception 'items_count_invalid' using errcode='22023';end if;
 select count(*) into v_lines from jsonb_array_elements(p_items);
 if (select count(distinct value->>'pendingReceiptId') from jsonb_array_elements(p_items))<>v_lines then raise exception 'duplicate_pending_receipt' using errcode='22023';end if;
 v_hash:=encode(digest(convert_to(jsonb_build_object('storeId',p_store_id,'date',p_business_date,'note',coalesce(p_note,''),'items',p_items)::text,'utf8'),'sha256'),'hex');
 insert into public.idempotency_records(scope,idempotency_key,request_hash,status,actor_user_id) values(v_scope,p_idempotency_key,v_hash,'processing',v_auth.actor_user_id) on conflict do nothing;
 if not found then
  select request_hash,status,response_data into strict v_existing from public.idempotency_records where scope=v_scope and idempotency_key=p_idempotency_key;
  if v_existing.request_hash<>v_hash then raise exception 'idempotency_conflict' using errcode='23505';end if;
  if v_existing.status='completed' then return query select (v_existing.response_data->>'batchId')::uuid,true;return;end if;
  raise exception 'idempotency_in_progress' using errcode='55P03';
 end if;
 perform 1 from public.pending_receipts pr where pr.store_id=p_store_id and pr.id in(select (value->>'pendingReceiptId')::uuid from jsonb_array_elements(p_items)) order by pr.product_id for update;
 perform 1 from public.inventory_balances b where b.store_id=p_store_id and b.product_id in(select pr.product_id from public.pending_receipts pr where pr.id in(select (value->>'pendingReceiptId')::uuid from jsonb_array_elements(p_items))) order by b.product_id for update;
 insert into public.operation_batches(store_id,operation_type,status,idempotency_key,business_date,note,total_lines,created_by) values(p_store_id,'receipt','posting',p_idempotency_key,p_business_date,coalesce(p_note,''),v_lines,v_auth.actor_user_id) returning id into v_batch;
 for v_item in select value from jsonb_array_elements(p_items) order by value->>'pendingReceiptId' loop
  select pr.*,p.sku into v_pr from public.pending_receipts pr join public.products p on p.id=pr.product_id where pr.id=(v_item->>'pendingReceiptId')::uuid and pr.store_id=p_store_id and pr.status in('pending','partially_received');
  if v_pr.id is null then raise exception 'invalid_pending_receipt' using errcode='23514';end if;
  v_cartons:=(v_item->>'cartons')::integer;v_loose:=(v_item->>'loose')::integer;
  if v_cartons<0 or v_loose<0 or v_loose>=v_pr.units_per_carton_snapshot then raise exception 'receipt_quantity_invalid' using errcode='23514';end if;
  v_actual:=v_cartons::bigint*v_pr.units_per_carton_snapshot::bigint+v_loose::bigint;
  if v_actual<=0 then raise exception 'receipt_quantity_zero' using errcode='23514';end if;
  v_reason:=nullif(v_item->>'reasonCode','');v_reason_label:=null;
  if v_actual<>v_pr.remaining_qty then
   v_reason_label:=public.reason_label(v_reason,'receipt');
   if v_reason_label is null then raise exception 'discrepancy_reason_required' using errcode='23514';end if;
  elsif v_reason is not null then
   v_reason_label:=public.reason_label(v_reason,'receipt');
   if v_reason_label is null then raise exception 'invalid_discrepancy_reason' using errcode='23514';end if;
  end if;
  v_decrease:=least(v_actual,v_pr.remaining_qty);
  select available_qty,pending_qty into strict v_bal from public.inventory_balances where store_id=p_store_id and product_id=v_pr.product_id;
  insert into public.operation_batch_items(batch_id,store_id,product_id,quantity,cartons,loose_units,units_per_carton_snapshot,raw_data) values(v_batch,p_store_id,v_pr.product_id,v_actual,v_cartons,v_loose,v_pr.units_per_carton_snapshot,v_item) returning id into v_item_id;
  update public.inventory_balances set available_qty=available_qty+v_actual,pending_qty=pending_qty-v_decrease,version=version+1,updated_at=now() where store_id=p_store_id and product_id=v_pr.product_id;
  update public.pending_receipts set remaining_qty=remaining_qty-v_decrease,status=case when remaining_qty-v_decrease=0 then 'received'::public.pending_receipt_status else 'partially_received'::public.pending_receipt_status end,updated_at=now() where id=v_pr.id;
  insert into public.inventory_ledger(store_id,product_id,batch_id,pending_receipt_id,business_type,delta_available,delta_pending,before_available,after_available,before_pending,after_pending,reason_code,reason_label,note,actor_user_id) values(p_store_id,v_pr.product_id,v_batch,v_pr.id,'receipt',v_actual,-v_decrease,v_bal.available_qty,v_bal.available_qty+v_actual,v_bal.pending_qty,v_bal.pending_qty-v_decrease,v_reason,v_reason_label,coalesce(v_item->>'note',p_note,''),v_auth.actor_user_id);
  v_total:=v_total+v_actual;
 end loop;
 update public.operation_batches set status='posted',total_qty=v_total,posted_at=now() where id=v_batch;
 update public.idempotency_records set status='completed',completed_at=now(),response_data=jsonb_build_object('batchId',v_batch,'totalQty',v_total) where scope=v_scope and idempotency_key=p_idempotency_key;
 insert into public.audit_events(actor_user_id,store_id,action,object_type,object_id,after_data) values(v_auth.actor_user_id,p_store_id,'receipt.posted','operation_batch',v_batch::text,jsonb_build_object('totalLines',v_lines,'totalQty',v_total));
 return query select v_batch,false;
end $$;

create function public.cancel_pending_receipts(
 p_token_hash text,p_store_id uuid,p_idempotency_key text,p_business_date date,p_note text,p_items jsonb
) returns table(batch_id uuid,replayed boolean)
language plpgsql volatile security definer set search_path=public,pg_temp
as $$
declare
 v_auth record;v_scope text:=p_store_id::text||':cancel_pending';v_hash text;v_existing record;v_batch uuid;v_item jsonb;v_pr record;v_bal record;v_reason text;v_label text;v_total bigint:=0;v_lines integer;
begin
 select * into v_auth from public.auth_token_has_permission(p_token_hash,p_store_id,'confirm_receipt');
 if v_auth.actor_user_id is null or not v_auth.allowed then raise exception 'permission_denied' using errcode='42501';end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 then raise exception 'items_count_invalid' using errcode='22023';end if;
 select count(*) into v_lines from jsonb_array_elements(p_items);
 v_hash:=encode(digest(convert_to(jsonb_build_object('storeId',p_store_id,'date',p_business_date,'note',coalesce(p_note,''),'items',p_items)::text,'utf8'),'sha256'),'hex');
 insert into public.idempotency_records(scope,idempotency_key,request_hash,status,actor_user_id) values(v_scope,p_idempotency_key,v_hash,'processing',v_auth.actor_user_id) on conflict do nothing;
 if not found then select request_hash,status,response_data into strict v_existing from public.idempotency_records where scope=v_scope and idempotency_key=p_idempotency_key;if v_existing.request_hash<>v_hash then raise exception 'idempotency_conflict' using errcode='23505';end if;if v_existing.status='completed' then return query select(v_existing.response_data->>'batchId')::uuid,true;return;end if;raise exception 'idempotency_in_progress' using errcode='55P03';end if;
 perform 1 from public.pending_receipts pr where pr.store_id=p_store_id and pr.id in(select(value->>'pendingReceiptId')::uuid from jsonb_array_elements(p_items)) order by pr.product_id for update;
 perform 1 from public.inventory_balances b where b.store_id=p_store_id and b.product_id in(select pr.product_id from public.pending_receipts pr where pr.id in(select(value->>'pendingReceiptId')::uuid from jsonb_array_elements(p_items))) order by b.product_id for update;
 insert into public.operation_batches(store_id,operation_type,status,idempotency_key,business_date,note,total_lines,created_by) values(p_store_id,'receipt','posting',p_idempotency_key,p_business_date,coalesce(p_note,''),v_lines,v_auth.actor_user_id) returning id into v_batch;
 for v_item in select value from jsonb_array_elements(p_items) order by value->>'pendingReceiptId' loop
  select * into v_pr from public.pending_receipts where id=(v_item->>'pendingReceiptId')::uuid and store_id=p_store_id and status in('pending','partially_received');if v_pr.id is null then raise exception 'invalid_pending_receipt' using errcode='23514';end if;
  v_reason:=nullif(v_item->>'reasonCode','');v_label:=public.reason_label(v_reason,'receipt');if v_label is null then raise exception 'discrepancy_reason_required' using errcode='23514';end if;
  select available_qty,pending_qty into strict v_bal from public.inventory_balances where store_id=p_store_id and product_id=v_pr.product_id;
  update public.inventory_balances set pending_qty=pending_qty-v_pr.remaining_qty,version=version+1,updated_at=now() where store_id=p_store_id and product_id=v_pr.product_id;
  update public.pending_receipts set remaining_qty=0,status='cancelled',updated_at=now() where id=v_pr.id;
  insert into public.inventory_ledger(store_id,product_id,batch_id,pending_receipt_id,business_type,delta_available,delta_pending,before_available,after_available,before_pending,after_pending,reason_code,reason_label,note,actor_user_id) values(p_store_id,v_pr.product_id,v_batch,v_pr.id,'receipt',0,-v_pr.remaining_qty,v_bal.available_qty,v_bal.available_qty,v_bal.pending_qty,v_bal.pending_qty-v_pr.remaining_qty,v_reason,v_label,coalesce(v_item->>'note',p_note,''),v_auth.actor_user_id);
  v_total:=v_total+v_pr.remaining_qty;
 end loop;
 update public.operation_batches set status='posted',total_qty=v_total,posted_at=now() where id=v_batch;update public.idempotency_records set status='completed',completed_at=now(),response_data=jsonb_build_object('batchId',v_batch,'totalQty',v_total) where scope=v_scope and idempotency_key=p_idempotency_key;return query select v_batch,false;
end $$;

create function public.post_outbound(
 p_token_hash text,p_store_id uuid,p_idempotency_key text,p_business_date date,p_note text,p_items jsonb
) returns table(batch_id uuid,replayed boolean)
language plpgsql volatile security definer set search_path=public,pg_temp
as $$
declare
 v_auth record;v_scope text:=p_store_id::text||':outbound';v_hash text;v_existing record;v_batch uuid;v_item jsonb;v_product uuid;v_qty bigint;v_bal record;v_total bigint:=0;v_lines integer;
begin
 select * into v_auth from public.auth_token_has_permission(p_token_hash,p_store_id,'ship_inventory');if v_auth.actor_user_id is null or not v_auth.allowed then raise exception 'permission_denied' using errcode='42501';end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>2000 then raise exception 'items_count_invalid' using errcode='22023';end if;select count(*) into v_lines from jsonb_array_elements(p_items);if(select count(distinct value->>'productId') from jsonb_array_elements(p_items))<>v_lines then raise exception 'duplicate_product' using errcode='22023';end if;
 v_hash:=encode(digest(convert_to(jsonb_build_object('storeId',p_store_id,'date',p_business_date,'note',coalesce(p_note,''),'items',p_items)::text,'utf8'),'sha256'),'hex');insert into public.idempotency_records(scope,idempotency_key,request_hash,status,actor_user_id) values(v_scope,p_idempotency_key,v_hash,'processing',v_auth.actor_user_id) on conflict do nothing;
 if not found then select request_hash,status,response_data into strict v_existing from public.idempotency_records where scope=v_scope and idempotency_key=p_idempotency_key;if v_existing.request_hash<>v_hash then raise exception 'idempotency_conflict' using errcode='23505';end if;if v_existing.status='completed' then return query select(v_existing.response_data->>'batchId')::uuid,true;return;end if;raise exception 'idempotency_in_progress' using errcode='55P03';end if;
 perform 1 from public.inventory_balances b where b.store_id=p_store_id and b.product_id in(select(value->>'productId')::uuid from jsonb_array_elements(p_items)) order by b.product_id for update;
 insert into public.operation_batches(store_id,operation_type,status,idempotency_key,business_date,note,total_lines,created_by) values(p_store_id,'outbound','posting',p_idempotency_key,p_business_date,coalesce(p_note,''),v_lines,v_auth.actor_user_id) returning id into v_batch;
 for v_item in select value from jsonb_array_elements(p_items) order by value->>'productId' loop
  v_product:=(v_item->>'productId')::uuid;v_qty:=(v_item->>'quantity')::bigint;if v_qty<=0 or v_qty>2147483647 then raise exception 'outbound_quantity_invalid' using errcode='23514';end if;
  if not exists(select 1 from public.products where id=v_product and store_id=p_store_id and is_active) then raise exception 'invalid_product' using errcode='23514';end if;
  select available_qty,pending_qty into v_bal from public.inventory_balances where store_id=p_store_id and product_id=v_product;if v_bal.available_qty is null or v_bal.available_qty<v_qty then raise exception 'insufficient_inventory:%',v_product using errcode='23514';end if;
  insert into public.operation_batch_items(batch_id,store_id,product_id,quantity,cartons,loose_units,units_per_carton_snapshot,raw_data) values(v_batch,p_store_id,v_product,v_qty,v_qty::integer,0,1,v_item);
  update public.inventory_balances set available_qty=available_qty-v_qty,version=version+1,updated_at=now() where store_id=p_store_id and product_id=v_product;
  insert into public.inventory_ledger(store_id,product_id,batch_id,business_type,delta_available,delta_pending,before_available,after_available,before_pending,after_pending,note,actor_user_id) values(p_store_id,v_product,v_batch,'outbound',-v_qty,0,v_bal.available_qty,v_bal.available_qty-v_qty,v_bal.pending_qty,v_bal.pending_qty,coalesce(v_item->>'note',p_note,''),v_auth.actor_user_id);v_total:=v_total+v_qty;
 end loop;
 update public.operation_batches set status='posted',total_qty=v_total,posted_at=now() where id=v_batch;update public.idempotency_records set status='completed',completed_at=now(),response_data=jsonb_build_object('batchId',v_batch,'totalQty',v_total) where scope=v_scope and idempotency_key=p_idempotency_key;insert into public.audit_events(actor_user_id,store_id,action,object_type,object_id,after_data) values(v_auth.actor_user_id,p_store_id,'outbound.posted','operation_batch',v_batch::text,jsonb_build_object('totalLines',v_lines,'totalQty',v_total));return query select v_batch,false;
end $$;

create function public.adjust_inventory(
 p_token_hash text,p_store_id uuid,p_idempotency_key text,p_business_date date,p_note text,p_items jsonb
) returns table(batch_id uuid,replayed boolean)
language plpgsql volatile security definer set search_path=public,pg_temp
as $$
declare
 v_auth record;v_scope text:=p_store_id::text||':adjustment';v_hash text;v_existing record;v_batch uuid;v_item jsonb;v_product uuid;v_target bigint;v_delta bigint;v_bal record;v_reason text;v_label text;v_total bigint:=0;v_lines integer;
begin
 select * into v_auth from public.auth_token_has_permission(p_token_hash,p_store_id,'adjust_inventory');if v_auth.actor_user_id is null or not v_auth.allowed then raise exception 'permission_denied' using errcode='42501';end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 then raise exception 'items_count_invalid' using errcode='22023';end if;select count(*) into v_lines from jsonb_array_elements(p_items);
 v_hash:=encode(digest(convert_to(jsonb_build_object('storeId',p_store_id,'date',p_business_date,'note',coalesce(p_note,''),'items',p_items)::text,'utf8'),'sha256'),'hex');insert into public.idempotency_records(scope,idempotency_key,request_hash,status,actor_user_id) values(v_scope,p_idempotency_key,v_hash,'processing',v_auth.actor_user_id) on conflict do nothing;
 if not found then select request_hash,status,response_data into strict v_existing from public.idempotency_records where scope=v_scope and idempotency_key=p_idempotency_key;if v_existing.request_hash<>v_hash then raise exception 'idempotency_conflict' using errcode='23505';end if;if v_existing.status='completed' then return query select(v_existing.response_data->>'batchId')::uuid,true;return;end if;raise exception 'idempotency_in_progress' using errcode='55P03';end if;
 perform 1 from public.inventory_balances b where b.store_id=p_store_id and b.product_id in(select(value->>'productId')::uuid from jsonb_array_elements(p_items)) order by b.product_id for update;
 insert into public.operation_batches(store_id,operation_type,status,idempotency_key,business_date,note,total_lines,created_by) values(p_store_id,'adjustment','posting',p_idempotency_key,p_business_date,coalesce(p_note,''),v_lines,v_auth.actor_user_id) returning id into v_batch;
 for v_item in select value from jsonb_array_elements(p_items) order by value->>'productId' loop
  v_product:=(v_item->>'productId')::uuid;v_target:=(v_item->>'targetQty')::bigint;if v_target<0 then raise exception 'target_quantity_invalid' using errcode='23514';end if;v_reason:=nullif(v_item->>'reasonCode','');v_label:=public.reason_label(v_reason,'adjustment');if v_label is null then raise exception 'discrepancy_reason_required' using errcode='23514';end if;
  select available_qty,pending_qty into v_bal from public.inventory_balances where store_id=p_store_id and product_id=v_product;if v_bal.available_qty is null then raise exception 'invalid_product' using errcode='23514';end if;v_delta:=v_target-v_bal.available_qty;if v_delta=0 then raise exception 'adjustment_no_change' using errcode='23514';end if;if abs(v_delta)>2147483647 then raise exception 'adjustment_too_large' using errcode='23514';end if;
  insert into public.operation_batch_items(batch_id,store_id,product_id,quantity,cartons,loose_units,units_per_carton_snapshot,raw_data) values(v_batch,p_store_id,v_product,abs(v_delta),abs(v_delta)::integer,0,1,v_item);
  update public.inventory_balances set available_qty=v_target,version=version+1,updated_at=now() where store_id=p_store_id and product_id=v_product;
  insert into public.inventory_ledger(store_id,product_id,batch_id,business_type,delta_available,delta_pending,before_available,after_available,before_pending,after_pending,reason_code,reason_label,note,actor_user_id) values(p_store_id,v_product,v_batch,'adjustment',v_delta,0,v_bal.available_qty,v_target,v_bal.pending_qty,v_bal.pending_qty,v_reason,v_label,coalesce(v_item->>'note',p_note,''),v_auth.actor_user_id);v_total:=v_total+abs(v_delta);
 end loop;
 update public.operation_batches set status='posted',total_qty=v_total,posted_at=now() where id=v_batch;update public.idempotency_records set status='completed',completed_at=now(),response_data=jsonb_build_object('batchId',v_batch,'totalQty',v_total) where scope=v_scope and idempotency_key=p_idempotency_key;insert into public.audit_events(actor_user_id,store_id,action,object_type,object_id,after_data) values(v_auth.actor_user_id,p_store_id,'adjustment.posted','operation_batch',v_batch::text,jsonb_build_object('totalLines',v_lines,'absoluteDelta',v_total));return query select v_batch,false;
end $$;

revoke all on function public.reason_label(text,text),public.confirm_pending_receipts(text,uuid,text,date,text,jsonb),public.cancel_pending_receipts(text,uuid,text,date,text,jsonb),public.post_outbound(text,uuid,text,date,text,jsonb),public.adjust_inventory(text,uuid,text,date,text,jsonb) from public;
grant execute on function public.confirm_pending_receipts(text,uuid,text,date,text,jsonb),public.cancel_pending_receipts(text,uuid,text,date,text,jsonb),public.post_outbound(text,uuid,text,date,text,jsonb),public.adjust_inventory(text,uuid,text,date,text,jsonb) to inventory_runtime;
