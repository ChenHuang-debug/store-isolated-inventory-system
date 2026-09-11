create type public.operation_type as enum ('arrival', 'outbound', 'receipt', 'adjustment', 'initial_import');
create type public.operation_status as enum ('draft', 'awaiting_confirmation', 'posting', 'posted', 'posting_failed', 'cancelled');
create type public.pending_receipt_status as enum ('pending', 'partially_received', 'received', 'cancelled');

create table public.inventory_balances (
  store_id uuid not null,
  product_id uuid not null,
  available_qty bigint not null default 0 check (available_qty >= 0),
  pending_qty bigint not null default 0 check (pending_qty >= 0),
  version bigint not null default 0 check (version >= 0),
  updated_at timestamptz not null default now(),
  primary key (store_id, product_id),
  foreign key (product_id, store_id) references public.products(id, store_id) on delete restrict
);

create table public.operation_batches (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  operation_type public.operation_type not null,
  status public.operation_status not null,
  supplier_id uuid,
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  business_date date not null,
  note text not null default '',
  total_lines integer not null default 0 check (total_lines >= 0),
  total_qty bigint not null default 0 check (total_qty >= 0),
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  created_by uuid not null references public.app_users(id),
  unique (store_id, operation_type, idempotency_key),
  unique (id, store_id),
  foreign key (supplier_id, store_id) references public.suppliers(id, store_id) on delete restrict
);

create index operation_batches_store_time_idx
  on public.operation_batches(store_id, created_at desc, status);

create table public.operation_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  store_id uuid not null,
  product_id uuid not null,
  quantity bigint not null check (quantity > 0),
  cartons integer not null default 0 check (cartons >= 0),
  loose_units integer not null default 0 check (loose_units >= 0),
  units_per_carton_snapshot integer not null check (units_per_carton_snapshot > 0),
  source_row integer,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (batch_id, product_id),
  unique (id, store_id),
  foreign key (batch_id, store_id) references public.operation_batches(id, store_id) on delete restrict,
  foreign key (product_id, store_id) references public.products(id, store_id) on delete restrict,
  check (loose_units < units_per_carton_snapshot),
  check (quantity = cartons::bigint * units_per_carton_snapshot::bigint + loose_units::bigint)
);

create table public.pending_receipts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  source_item_id uuid not null unique,
  product_id uuid not null,
  supplier_id uuid not null,
  expected_qty bigint not null check (expected_qty > 0),
  remaining_qty bigint not null check (remaining_qty >= 0 and remaining_qty <= expected_qty),
  expected_cartons integer not null check (expected_cartons >= 0),
  expected_loose_units integer not null check (expected_loose_units >= 0),
  units_per_carton_snapshot integer not null check (units_per_carton_snapshot > 0),
  status public.pending_receipt_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, store_id),
  foreign key (source_item_id, store_id) references public.operation_batch_items(id, store_id) on delete restrict,
  foreign key (product_id, store_id) references public.products(id, store_id) on delete restrict,
  foreign key (supplier_id, store_id) references public.suppliers(id, store_id) on delete restrict,
  check (expected_loose_units < units_per_carton_snapshot)
);

create index pending_receipts_active_idx
  on public.pending_receipts(store_id, created_at desc)
  where status in ('pending', 'partially_received');

create table public.inventory_ledger (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  product_id uuid not null,
  batch_id uuid not null,
  pending_receipt_id uuid,
  business_type public.operation_type not null,
  delta_available bigint not null,
  delta_pending bigint not null,
  before_available bigint not null check (before_available >= 0),
  after_available bigint not null check (after_available >= 0),
  before_pending bigint not null check (before_pending >= 0),
  after_pending bigint not null check (after_pending >= 0),
  reason_code text,
  reason_label text,
  note text not null default '',
  actor_user_id uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  foreign key (product_id, store_id) references public.products(id, store_id) on delete restrict,
  foreign key (batch_id, store_id) references public.operation_batches(id, store_id) on delete restrict,
  foreign key (pending_receipt_id, store_id) references public.pending_receipts(id, store_id) on delete restrict,
  check (after_available = before_available + delta_available),
  check (after_pending = before_pending + delta_pending)
);

create index inventory_ledger_store_time_idx on public.inventory_ledger(store_id, created_at desc);
create index inventory_ledger_product_time_idx on public.inventory_ledger(store_id, product_id, created_at desc);

create table public.idempotency_records (
  scope text not null,
  idempotency_key text not null,
  request_hash text not null check (length(request_hash) = 64),
  status text not null check (status in ('processing', 'completed', 'failed')),
  response_data jsonb,
  actor_user_id uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (scope, idempotency_key)
);

alter table public.inventory_balances enable row level security;
alter table public.operation_batches enable row level security;
alter table public.operation_batch_items enable row level security;
alter table public.pending_receipts enable row level security;
alter table public.inventory_ledger enable row level security;

create policy balances_select_store on public.inventory_balances for select using (public.app_has_store_access(store_id));
create policy batches_select_store on public.operation_batches for select using (public.app_has_store_access(store_id));
create policy batch_items_select_store on public.operation_batch_items for select using (public.app_has_store_access(store_id));
create policy pending_select_store on public.pending_receipts for select using (public.app_has_store_access(store_id));
create policy ledger_select_store on public.inventory_ledger for select using (public.app_has_store_access(store_id));

grant select on public.inventory_balances, public.operation_batches,
  public.operation_batch_items, public.pending_receipts, public.inventory_ledger
  to inventory_runtime;

create function public.prevent_inventory_history_mutation()
returns trigger language plpgsql
as $$ begin raise exception '% is immutable', tg_table_name; end $$;

create trigger inventory_ledger_immutable before update or delete on public.inventory_ledger
for each row execute function public.prevent_inventory_history_mutation();
create trigger operation_batch_items_immutable before update or delete on public.operation_batch_items
for each row execute function public.prevent_inventory_history_mutation();

create function public.auth_token_has_permission(
  p_token_hash text,
  p_store_id uuid,
  p_permission text
) returns table (actor_user_id uuid, allowed boolean)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select actor.user_id,
    actor.is_system_admin or exists (
      select 1 from public.user_store_permissions usp
      join public.user_store_memberships m
        on m.user_id = usp.user_id and m.store_id = usp.store_id
      join public.stores s on s.id = usp.store_id and s.is_active
      where usp.user_id = actor.user_id
        and usp.store_id = p_store_id
        and usp.permission_code = p_permission
    ) allowed
  from public.auth_actor(p_token_hash) actor
$$;

create function public.post_arrival(
  p_token_hash text,
  p_store_id uuid,
  p_idempotency_key text,
  p_supplier_id uuid,
  p_business_date date,
  p_note text,
  p_items jsonb
) returns table (batch_id uuid, replayed boolean)
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_auth record;
  v_scope text := p_store_id::text || ':arrival';
  v_hash text;
  v_existing record;
  v_batch_id uuid;
  v_item jsonb;
  v_product record;
  v_balance record;
  v_item_id uuid;
  v_pending_id uuid;
  v_product_id uuid;
  v_cartons integer;
  v_loose integer;
  v_qty bigint;
  v_total_qty bigint := 0;
  v_total_lines integer;
begin
  select * into v_auth from public.auth_token_has_permission(p_token_hash, p_store_id, 'record_arrival');
  if v_auth.actor_user_id is null or not v_auth.allowed then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.stores where id = p_store_id and is_active) then
    raise exception 'store_inactive' using errcode = '23514';
  end if;
  if not exists (select 1 from public.suppliers where id = p_supplier_id and store_id = p_store_id and is_active) then
    raise exception 'invalid_supplier' using errcode = '23514';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 2000 then
    raise exception 'items_count_invalid' using errcode = '22023';
  end if;
  select count(*) into v_total_lines from jsonb_array_elements(p_items);
  if (select count(distinct value->>'productId') from jsonb_array_elements(p_items)) <> v_total_lines then
    raise exception 'duplicate_product' using errcode = '22023';
  end if;
  if length(p_idempotency_key) < 8 then raise exception 'idempotency_key_invalid' using errcode = '22023'; end if;

  v_hash := encode(digest(convert_to(jsonb_build_object(
    'storeId', p_store_id, 'supplierId', p_supplier_id, 'businessDate', p_business_date,
    'note', coalesce(p_note, ''), 'items', p_items
  )::text, 'utf8'), 'sha256'), 'hex');

  insert into public.idempotency_records(scope, idempotency_key, request_hash, status, actor_user_id)
  values (v_scope, p_idempotency_key, v_hash, 'processing', v_auth.actor_user_id)
  on conflict do nothing;
  if not found then
    select request_hash, status, response_data into strict v_existing
    from public.idempotency_records where scope = v_scope and idempotency_key = p_idempotency_key;
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_conflict' using errcode = '23505'; end if;
    if v_existing.status = 'completed' then
      return query select (v_existing.response_data->>'batchId')::uuid, true;
      return;
    end if;
    raise exception 'idempotency_in_progress' using errcode = '55P03';
  end if;

  insert into public.inventory_balances(store_id, product_id)
  select p_store_id, (value->>'productId')::uuid from jsonb_array_elements(p_items)
  on conflict do nothing;
  perform 1 from public.inventory_balances b
  where b.store_id = p_store_id
    and b.product_id in (select (value->>'productId')::uuid from jsonb_array_elements(p_items))
  order by b.product_id for update;

  insert into public.operation_batches(
    store_id, operation_type, status, supplier_id, idempotency_key,
    business_date, note, total_lines, created_by
  ) values (
    p_store_id, 'arrival', 'posting', p_supplier_id, p_idempotency_key,
    p_business_date, coalesce(p_note, ''), v_total_lines, v_auth.actor_user_id
  ) returning id into v_batch_id;

  for v_item in select value from jsonb_array_elements(p_items) order by value->>'productId'
  loop
    v_product_id := (v_item->>'productId')::uuid;
    v_cartons := (v_item->>'cartons')::integer;
    v_loose := (v_item->>'loose')::integer;
    if v_cartons < 0 or v_loose < 0 then raise exception 'quantity_negative' using errcode = '22023'; end if;

    select id, units_per_carton, carton_spec_status into v_product
    from public.products
    where id = v_product_id and store_id = p_store_id and is_active;
    if v_product.id is null then raise exception 'invalid_product:%', v_product_id using errcode = '23514'; end if;
    if v_product.carton_spec_status <> 'confirmed' or v_product.units_per_carton is null then
      raise exception 'carton_spec_pending:%', v_product_id using errcode = '23514';
    end if;
    if v_loose >= v_product.units_per_carton then raise exception 'loose_units_invalid:%', v_product_id using errcode = '23514'; end if;
    v_qty := v_cartons::bigint * v_product.units_per_carton::bigint + v_loose::bigint;
    if v_qty <= 0 then raise exception 'quantity_zero:%', v_product_id using errcode = '23514'; end if;

    select available_qty, pending_qty into strict v_balance
    from public.inventory_balances where store_id = p_store_id and product_id = v_product_id;

    insert into public.operation_batch_items(
      batch_id, store_id, product_id, quantity, cartons, loose_units,
      units_per_carton_snapshot, raw_data
    ) values (
      v_batch_id, p_store_id, v_product_id, v_qty, v_cartons, v_loose,
      v_product.units_per_carton, v_item
    ) returning id into v_item_id;

    insert into public.pending_receipts(
      store_id, source_item_id, product_id, supplier_id, expected_qty, remaining_qty,
      expected_cartons, expected_loose_units, units_per_carton_snapshot
    ) values (
      p_store_id, v_item_id, v_product_id, p_supplier_id, v_qty, v_qty,
      v_cartons, v_loose, v_product.units_per_carton
    ) returning id into v_pending_id;

    update public.inventory_balances set pending_qty = pending_qty + v_qty,
      version = version + 1, updated_at = now()
    where store_id = p_store_id and product_id = v_product_id;

    insert into public.inventory_ledger(
      store_id, product_id, batch_id, pending_receipt_id, business_type,
      delta_available, delta_pending, before_available, after_available,
      before_pending, after_pending, actor_user_id, note
    ) values (
      p_store_id, v_product_id, v_batch_id, v_pending_id, 'arrival',
      0, v_qty, v_balance.available_qty, v_balance.available_qty,
      v_balance.pending_qty, v_balance.pending_qty + v_qty, v_auth.actor_user_id, coalesce(p_note, '')
    );
    v_total_qty := v_total_qty + v_qty;
  end loop;

  update public.operation_batches set status = 'posted', total_qty = v_total_qty, posted_at = now()
  where id = v_batch_id;
  update public.idempotency_records set status = 'completed', completed_at = now(),
    response_data = jsonb_build_object('batchId', v_batch_id, 'totalQty', v_total_qty)
  where scope = v_scope and idempotency_key = p_idempotency_key;
  insert into public.audit_events(actor_user_id, store_id, action, object_type, object_id, after_data)
  values (v_auth.actor_user_id, p_store_id, 'arrival.posted', 'operation_batch', v_batch_id::text,
    jsonb_build_object('supplierId', p_supplier_id, 'totalLines', v_total_lines, 'totalQty', v_total_qty));

  return query select v_batch_id, false;
end
$$;

revoke all on function public.auth_token_has_permission(text, uuid, text) from public;
revoke all on function public.post_arrival(text, uuid, text, uuid, date, text, jsonb) from public;
grant execute on function public.post_arrival(text, uuid, text, uuid, date, text, jsonb) to inventory_runtime;
