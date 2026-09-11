import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { hash } from "@node-rs/argon2";

function readEnv(name: string): string {
  if (process.env[name]) return process.env[name]!;
  const text = fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
  const value = text.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim();
  if (!value) throw new Error(`${name} 未配置`);
  return value;
}

const owner = new Client({ connectionString: readEnv("MIGRATION_DATABASE_URL") });
const runtime = new Client({ connectionString: readEnv("DATABASE_URL") });
const email = `rls-${randomUUID()}@example.test`;
const token = `rls-${randomUUID()}`;
const tokenHash = createHash("sha256").update(token).digest("hex");
let userId: string;
let storeAId: string;
let storeBId: string;
let confirmedProductId: string;
let pendingProductId: string;
let supplierId: string;

describe.sequential("数据库店铺隔离", () => {
  beforeAll(async () => {
    await owner.connect();
    await runtime.connect();
    const passwordHash = await hash("Integration-test-123", {
      memoryCost: 8_192,
      timeCost: 1,
      parallelism: 1,
    });
    const user = await owner.query<{ id: string }>(`
      insert into public.app_users(email, display_name, password_hash, status)
      values ($1, 'RLS 测试用户', $2, 'active') returning id
    `, [email, passwordHash]);
    userId = user.rows[0].id;
    const stores = await owner.query<{ id: string; code: string }>(
      "select id, code from public.stores where code in ('STORE_A', 'STORE_B')",
    );
    storeAId = stores.rows.find((row) => row.code === "STORE_A")!.id;
    storeBId = stores.rows.find((row) => row.code === "STORE_B")!.id;
    await owner.query("set session_replication_role = replica");
    try {
      const confirmed = await owner.query<{ id: string }>(`
        insert into public.products(
          store_id, sku, model, name_zh, units_per_carton, carton_spec_status, created_by, updated_by
        ) values ($1, $2, 'ARRIVAL-80', '到仓测试商品', 80, 'confirmed', $3, $3) returning id
      `, [storeAId, `ARRIVAL-${randomUUID()}`, userId]);
      confirmedProductId = confirmed.rows[0].id;
      const pending = await owner.query<{ id: string }>(`
        insert into public.products(store_id, sku, model, name_zh, created_by, updated_by)
        values ($1, $2, 'PENDING-CARTON', '待确认箱规商品', $3, $3) returning id
      `, [storeAId, `PENDING-${randomUUID()}`, userId]);
      pendingProductId = pending.rows[0].id;
      const supplier = await owner.query<{ id: string }>(`
        insert into public.suppliers(store_id, code, name, origin, created_by, updated_by)
        values ($1, $2, '到仓测试供应商', '测试货源地', $3, $3) returning id
      `, [storeAId, `ARR-SUP-${randomUUID()}`, userId]);
      supplierId = supplier.rows[0].id;
    } finally {
      await owner.query("set session_replication_role = origin");
    }
    await owner.query(`
      insert into public.user_store_memberships(user_id, store_id, role)
      values ($1, $2, 'operator')
    `, [userId, storeAId]);
    await owner.query(`
      insert into public.user_store_permissions(user_id, store_id, permission_code)
      values ($1, $2, 'record_arrival'),
             ($1, $2, 'manage_products'),
             ($1, $2, 'manage_suppliers'),
             ($1, $2, 'confirm_receipt'),
             ($1, $2, 'ship_inventory'),
             ($1, $2, 'adjust_inventory')
    `, [userId, storeAId]);
    await owner.query(`
      insert into public.app_sessions(
        user_id, token_hash, session_version, idle_expires_at, absolute_expires_at
      ) values ($1, $2, 1, now() + interval '8 hours', now() + interval '7 days')
    `, [userId, tokenHash]);
  });

  afterAll(async () => {
    if (supplierId) await owner.query("delete from public.suppliers where id = $1", [supplierId]);
    if (confirmedProductId || pendingProductId) await owner.query("delete from public.products where id = any($1::uuid[])", [[confirmedProductId, pendingProductId].filter(Boolean)]);
    if (userId) {
      await owner.query("delete from public.user_store_memberships where user_id = $1", [userId]);
      await owner.query("delete from public.app_users where id = $1", [userId]);
    }
    await runtime.end();
    await owner.end();
  });

  it("没有会话上下文时看不到任何店铺", async () => {
    const result = await runtime.query("select code from public.stores order by code");
    expect(result.rows).toEqual([]);
  });

  it("有效会话只看到授权的 STORE_A 店铺", async () => {
    await runtime.query("begin");
    try {
      await runtime.query("select public.app_set_session_context($1)", [tokenHash]);
      const result = await runtime.query<{ code: string }>("select code from public.stores order by code");
      expect(result.rows.map((row) => row.code)).toEqual(["STORE_A"]);
    } finally {
      await runtime.query("rollback");
    }
  });

  it("细粒度权限不会跨店铺继承", async () => {
    await runtime.query("begin");
    try {
      await runtime.query("select public.app_set_session_context($1)", [tokenHash]);
      const result = await runtime.query<{ store_a: boolean; store_b: boolean }>(`
        select public.app_has_permission($1, 'record_arrival') store_a,
               public.app_has_permission($2, 'record_arrival') store_b
      `, [storeAId, storeBId]);
      expect(result.rows[0]).toEqual({ store_a: true, store_b: false });
    } finally {
      await runtime.query("rollback");
    }
  });

  it("运行时账号不能直接写用户表", async () => {
    await expect(runtime.query(`
      insert into public.app_users(email, display_name, password_hash, status)
      values ('forbidden@example.test', '禁止写入', 'x', 'active')
    `)).rejects.toThrow(/permission denied/i);
  });

  it("会话返回的店铺与权限由数据库生成", async () => {
    const result = await runtime.query<{ stores: Array<{ code: string; permissions: string[] }> }>(
      "select stores from public.auth_get_session($1)",
      [tokenHash],
    );
    expect(result.rows[0].stores).toEqual([
      expect.objectContaining({ code: "STORE_A", permissions: ["manage_products", "manage_suppliers", "record_arrival", "confirm_receipt", "ship_inventory", "adjust_inventory"] }),
    ]);
  });

  it("停用用户后旧会话立即失效", async () => {
    await owner.query("update public.app_users set status = 'disabled' where id = $1", [userId]);
    const result = await runtime.query("select * from public.auth_get_session($1)", [tokenHash]);
    expect(result.rowCount).toBe(0);
    await owner.query("update public.app_users set status = 'active' where id = $1", [userId]);
  });

  it("商品写入受当前店铺和权限约束", async () => {
    await runtime.query("begin");
    try {
      await runtime.query("select public.app_set_session_context($1)", [tokenHash]);
      const inserted = await runtime.query<{ sku: string }>(`
        insert into public.products(
          store_id, sku, model, name_zh, created_by, updated_by
        ) values ($1, $2, 'MODEL-1', '测试商品', $3, $3) returning sku
      `, [storeAId, `TEST-${randomUUID()}`, userId]);
      expect(inserted.rows[0].sku).toMatch(/^TEST-/);
      await expect(runtime.query(`
        insert into public.products(
          store_id, sku, model, name_zh, created_by, updated_by
        ) values ($1, $2, 'MODEL-STORE_B', '越权商品', $3, $3)
      `, [storeBId, `TEST-${randomUUID()}`, userId])).rejects.toThrow(/row-level security/i);
    } finally {
      await runtime.query("rollback");
    }
  });

  it("SKU 全局唯一且临时箱规不等于已确认", async () => {
    await owner.query("begin");
    try {
      const sku = `GLOBAL-${randomUUID()}`;
      await owner.query(`
        insert into public.products(store_id, sku, model, name_zh, created_by, updated_by)
        values ($1, $2, 'M1', '全局唯一测试', $3, $3)
      `, [storeAId, sku, userId]);
      await expect(owner.query(`
        insert into public.products(store_id, sku, model, name_zh, created_by, updated_by)
        values ($1, $2, 'M2', '重复 SKU', $3, $3)
      `, [storeBId, sku, userId])).rejects.toMatchObject({ code: "23505" });
      await owner.query("rollback");

      await owner.query("begin");
      const temporary = await owner.query<{ units_per_carton: number; carton_spec_status: string }>(`
        insert into public.products(
          store_id, sku, model, name_zh, units_per_carton, carton_spec_status, created_by, updated_by
        ) values ($1, $2, 'M3', '临时箱规', 80, 'pending', $3, $3)
        returning units_per_carton, carton_spec_status
      `, [storeAId, `CARTON-${randomUUID()}`, userId]);
      expect(temporary.rows[0]).toEqual({ units_per_carton: 80, carton_spec_status: "pending" });
      await expect(owner.query(`
        insert into public.products(
          store_id, sku, model, name_zh, carton_spec_status, created_by, updated_by
        ) values ($1, $2, 'M4', '缺失确认箱规', 'confirmed', $3, $3)
      `, [storeAId, `CONFIRMED-${randomUUID()}`, userId])).rejects.toMatchObject({ code: "23514" });
    } finally {
      await owner.query("rollback");
    }
  });

  it("商品不能关联另一个店铺的供应商", async () => {
    await owner.query("begin");
    try {
      const product = await owner.query<{ id: string }>(`
        insert into public.products(store_id, sku, model, name_zh, created_by, updated_by)
        values ($1, $2, 'LINK-M', '关联测试商品', $3, $3) returning id
      `, [storeAId, `LINK-${randomUUID()}`, userId]);
      const supplier = await owner.query<{ id: string }>(`
        insert into public.suppliers(store_id, code, name, created_by, updated_by)
        values ($1, $2, 'STORE_B 测试供应商', $3, $3) returning id
      `, [storeBId, `SUP-${randomUUID()}`, userId]);
      await expect(owner.query(`
        insert into public.product_supplier_links(store_id, product_id, supplier_id, created_by)
        values ($1, $2, $3, $4)
      `, [storeAId, product.rows[0].id, supplier.rows[0].id, userId])).rejects.toMatchObject({ code: "23503" });
    } finally {
      await owner.query("rollback");
    }
  });

  it("8 箱加 30 尾数原子登记为 670 件待入库", async () => {
    await runtime.query("begin");
    try {
      const key = `arrival-${randomUUID()}`;
      const items = [{ productId: confirmedProductId, cartons: 8, loose: 30 }];
      const first = await runtime.query<{ batch_id: string; replayed: boolean }>(
        "select * from public.post_arrival($1,$2,$3,$4,$5,$6,$7)",
        [tokenHash, storeAId, key, supplierId, "2026-08-07", "到仓测试", JSON.stringify(items)],
      );
      expect(first.rows[0].replayed).toBe(false);
      const second = await runtime.query<{ batch_id: string; replayed: boolean }>(
        "select * from public.post_arrival($1,$2,$3,$4,$5,$6,$7)",
        [tokenHash, storeAId, key, supplierId, "2026-08-07", "到仓测试", JSON.stringify(items)],
      );
      expect(second.rows[0]).toEqual({ batch_id: first.rows[0].batch_id, replayed: true });
      await runtime.query("select public.app_set_session_context($1)", [tokenHash]);
      const balance = await runtime.query<{ available_qty: string; pending_qty: string }>(
        "select available_qty, pending_qty from public.inventory_balances where product_id=$1",
        [confirmedProductId],
      );
      expect(balance.rows[0]).toEqual({ available_qty: "0", pending_qty: "670" });
      const pending = await runtime.query<{ expected_qty: string; expected_cartons: number; expected_loose_units: number }>(
        "select expected_qty, expected_cartons, expected_loose_units from public.pending_receipts where product_id=$1",
        [confirmedProductId],
      );
      expect(pending.rows[0]).toEqual({ expected_qty: "670", expected_cartons: 8, expected_loose_units: 30 });
    } finally {
      await runtime.query("rollback");
    }
  });

  it("同一幂等键换内容会拒绝", async () => {
    await runtime.query("begin");
    try {
      const key = `arrival-conflict-${randomUUID()}`;
      await runtime.query("select * from public.post_arrival($1,$2,$3,$4,$5,$6,$7)",
        [tokenHash, storeAId, key, supplierId, "2026-08-07", "", JSON.stringify([{ productId: confirmedProductId, cartons: 1, loose: 0 }])]);
      await expect(runtime.query("select * from public.post_arrival($1,$2,$3,$4,$5,$6,$7)",
        [tokenHash, storeAId, key, supplierId, "2026-08-07", "", JSON.stringify([{ productId: confirmedProductId, cartons: 2, loose: 0 }])])).rejects.toThrow(/idempotency_conflict/);
    } finally {
      await runtime.query("rollback");
    }
  });

  it("箱规待确认时禁止按箱登记到仓", async () => {
    await runtime.query("begin");
    try {
      await expect(runtime.query("select * from public.post_arrival($1,$2,$3,$4,$5,$6,$7)",
        [tokenHash, storeAId, `arrival-pending-${randomUUID()}`, supplierId, "2026-08-07", "",
          JSON.stringify([{ productId: pendingProductId, cartons: 1, loose: 0 }])])).rejects.toThrow(/carton_spec_pending/);
    } finally {
      await runtime.query("rollback");
    }
  });

  it("到仓函数拒绝跨店铺调用", async () => {
    await runtime.query("begin");
    try {
      await expect(runtime.query("select * from public.post_arrival($1,$2,$3,$4,$5,$6,$7)",
        [tokenHash, storeBId, `arrival-store_b-${randomUUID()}`, supplierId, "2026-08-07", "",
          JSON.stringify([{ productId: confirmedProductId, cartons: 1, loose: 0 }])])).rejects.toThrow(/permission_denied/);
    } finally {
      await runtime.query("rollback");
    }
  });

  it("少收后保留剩余待入，并可带原因取消", async () => {
    await runtime.query("begin");
    try {
      const arrival = await runtime.query<{ batch_id: string }>("select * from public.post_arrival($1,$2,$3,$4,$5,$6,$7)",
        [tokenHash,storeAId,`l4-arr-${randomUUID()}`,supplierId,"2026-08-07","",JSON.stringify([{productId:confirmedProductId,cartons:8,loose:30}])]);
      expect(arrival.rows[0].batch_id).toBeTruthy();
      await runtime.query("select public.app_set_session_context($1)",[tokenHash]);
      const pending=await runtime.query<{id:string}>("select id from public.pending_receipts where product_id=$1 and status='pending'",[confirmedProductId]);
      await runtime.query("select * from public.confirm_pending_receipts($1,$2,$3,$4,$5,$6)",[
        tokenHash,storeAId,`l4-rec-${randomUUID()}`,"2026-08-07","",
        JSON.stringify([{pendingReceiptId:pending.rows[0].id,cartons:8,loose:20,reasonCode:"supplier_short",note:"少到 10 件"}]),
      ]);
      await runtime.query("select public.app_set_session_context($1)",[tokenHash]);
      const partial=await runtime.query<{available_qty:string;pending_qty:string;remaining_qty:string;status:string}>(`
        select b.available_qty,b.pending_qty,pr.remaining_qty,pr.status from public.inventory_balances b
        join public.pending_receipts pr on pr.product_id=b.product_id and pr.store_id=b.store_id
        where pr.id=$1`,[pending.rows[0].id]);
      expect(partial.rows[0]).toEqual({available_qty:"660",pending_qty:"10",remaining_qty:"10",status:"partially_received"});
      await runtime.query("select * from public.cancel_pending_receipts($1,$2,$3,$4,$5,$6)",[
        tokenHash,storeAId,`l4-can-${randomUUID()}`,"2026-08-07","",
        JSON.stringify([{pendingReceiptId:pending.rows[0].id,reasonCode:"supplier_short",note:"确认不再补发"}]),
      ]);
      await runtime.query("select public.app_set_session_context($1)",[tokenHash]);
      const final=await runtime.query<{available_qty:string;pending_qty:string}>("select available_qty,pending_qty from public.inventory_balances where product_id=$1",[confirmedProductId]);
      expect(final.rows[0]).toEqual({available_qty:"660",pending_qty:"0"});
    } finally { await runtime.query("rollback"); }
  });

  it("允许多收并把待入归零", async () => {
    await runtime.query("begin");
    try {
      await runtime.query("select * from public.post_arrival($1,$2,$3,$4,$5,$6,$7)",[tokenHash,storeAId,`over-arr-${randomUUID()}`,supplierId,"2026-08-07","",JSON.stringify([{productId:confirmedProductId,cartons:8,loose:30}])]);
      await runtime.query("select public.app_set_session_context($1)",[tokenHash]);
      const pending=await runtime.query<{id:string}>("select id from public.pending_receipts where product_id=$1 and status='pending'",[confirmedProductId]);
      await runtime.query("select * from public.confirm_pending_receipts($1,$2,$3,$4,$5,$6)",[tokenHash,storeAId,`over-rec-${randomUUID()}`,"2026-08-07","",JSON.stringify([{pendingReceiptId:pending.rows[0].id,cartons:8,loose:60,reasonCode:"supplier_over"}])]);
      await runtime.query("select public.app_set_session_context($1)",[tokenHash]);
      const result=await runtime.query<{available_qty:string;pending_qty:string}>("select available_qty,pending_qty from public.inventory_balances where product_id=$1",[confirmedProductId]);
      expect(result.rows[0]).toEqual({available_qty:"700",pending_qty:"0"});
    } finally { await runtime.query("rollback"); }
  });

  it("出库幂等且库存不足时整批回滚", async () => {
    await runtime.query("begin");
    try {
      await runtime.query("select * from public.post_arrival($1,$2,$3,$4,$5,$6,$7)",[tokenHash,storeAId,`out-arr-${randomUUID()}`,supplierId,"2026-08-07","",JSON.stringify([{productId:confirmedProductId,cartons:2,loose:0}])]);
      await runtime.query("select public.app_set_session_context($1)",[tokenHash]);
      const pending=await runtime.query<{id:string}>("select id from public.pending_receipts where product_id=$1 and status='pending'",[confirmedProductId]);
      await runtime.query("select * from public.confirm_pending_receipts($1,$2,$3,$4,$5,$6)",[tokenHash,storeAId,`out-rec-${randomUUID()}`,"2026-08-07","",JSON.stringify([{pendingReceiptId:pending.rows[0].id,cartons:2,loose:0}])]);
      const key=`out-${randomUUID()}`;const items=JSON.stringify([{productId:confirmedProductId,quantity:60}]);
      const first=await runtime.query<{batch_id:string;replayed:boolean}>("select * from public.post_outbound($1,$2,$3,$4,$5,$6)",[tokenHash,storeAId,key,"2026-08-07","",items]);
      const replay=await runtime.query<{batch_id:string;replayed:boolean}>("select * from public.post_outbound($1,$2,$3,$4,$5,$6)",[tokenHash,storeAId,key,"2026-08-07","",items]);
      expect(replay.rows[0]).toEqual({batch_id:first.rows[0].batch_id,replayed:true});
      await runtime.query("select public.app_set_session_context($1)",[tokenHash]);
      const balance=await runtime.query<{available_qty:string}>("select available_qty from public.inventory_balances where product_id=$1",[confirmedProductId]);
      expect(balance.rows[0].available_qty).toBe("100");
      await expect(runtime.query("select * from public.post_outbound($1,$2,$3,$4,$5,$6)",[tokenHash,storeAId,`out-fail-${randomUUID()}`,"2026-08-07","",JSON.stringify([{productId:confirmedProductId,quantity:101}])])).rejects.toThrow(/insufficient_inventory/);
    } finally { await runtime.query("rollback"); }
  });

  it("库存纠错写入目标数量和差异原因", async () => {
    await runtime.query("begin");
    try {
      await runtime.query("select * from public.post_arrival($1,$2,$3,$4,$5,$6,$7)",[tokenHash,storeAId,`adj-arr-${randomUUID()}`,supplierId,"2026-08-07","",JSON.stringify([{productId:confirmedProductId,cartons:1,loose:0}])]);
      await runtime.query("select public.app_set_session_context($1)",[tokenHash]);
      const pending=await runtime.query<{id:string}>("select id from public.pending_receipts where product_id=$1 and status='pending'",[confirmedProductId]);
      await runtime.query("select * from public.confirm_pending_receipts($1,$2,$3,$4,$5,$6)",[tokenHash,storeAId,`adj-rec-${randomUUID()}`,"2026-08-07","",JSON.stringify([{pendingReceiptId:pending.rows[0].id,cartons:1,loose:0}])]);
      await runtime.query("select * from public.adjust_inventory($1,$2,$3,$4,$5,$6)",[tokenHash,storeAId,`adj-${randomUUID()}`,"2026-08-07","盘点",JSON.stringify([{productId:confirmedProductId,targetQty:75,reasonCode:"count_error",note:"实盘少 5 件"}])]);
      await runtime.query("select public.app_set_session_context($1)",[tokenHash]);
      const result=await runtime.query<{available_qty:string;reason_code:string;delta_available:string}>(`select b.available_qty,l.reason_code,l.delta_available from public.inventory_balances b join public.inventory_ledger l on l.product_id=b.product_id and l.business_type='adjustment' where b.product_id=$1`,[confirmedProductId]);
      expect(result.rows[0]).toEqual({available_qty:"75",reason_code:"count_error",delta_available:"-5"});
    } finally { await runtime.query("rollback"); }
  });
});
