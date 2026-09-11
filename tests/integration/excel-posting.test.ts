import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { hash } from "@node-rs/argon2";

function readEnv(name: string) {
  if (process.env[name]) return process.env[name]!;
  const source = fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
  const value = source.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim();
  if (!value) throw new Error(`${name} 未配置`);
  return value;
}

type PreviewRow = {
  row: number;
  sku: string;
  name: string;
  unitsPerCarton?: number;
  cartons?: number;
  loose?: number;
  quantity: number;
  businessDate: string;
  supplierCode?: string;
  note: string;
};

const owner = new Client({ connectionString: readEnv("MIGRATION_DATABASE_URL") });
const runtime = new Client({ connectionString: readEnv("DATABASE_URL") });
const tokenHash = createHash("sha256").update(`excel-posting-${randomUUID()}`).digest("hex");
const sku = `EXCEL-${randomUUID()}`;
const supplierCode = `EX-${randomUUID()}`.slice(0, 40);
let userId = "";
let storeId = "";
let productId = "";
let supplierId = "";

async function createPreview(business: "arrival" | "outbound", rows: PreviewRow[]) {
  const preview = {
    version: "1.0",
    storeId,
    storeCode: "STORE_B",
    business,
    allowedSkus: [sku],
    rows,
    errors: [],
    totalQty: rows.reduce((sum, row) => sum + row.quantity, 0),
  };
  const fileHash = createHash("sha256")
    .update(`${business}-${randomUUID()}`)
    .digest("hex");
  const result = await runtime.query<{ create_upload_preview: string }>(
    "select public.create_upload_preview($1,$2,$3,$4,$5,$6,100,'1.0',$7)",
    [
      tokenHash,
      storeId,
      business,
      `${business}.xlsx`,
      `${storeId}/${randomUUID()}.xlsx`,
      fileHash,
      JSON.stringify(preview),
    ],
  );
  return result.rows[0].create_upload_preview;
}

async function confirmPreview(uploadId: string) {
  await runtime.query("begin");
  try {
    await runtime.query("select public.app_set_session_context($1)", [tokenHash]);
    const upload = await runtime.query<{
      operation_type: "arrival" | "outbound";
      preview_data: { business: "arrival" | "outbound"; rows: PreviewRow[]; errors: string[] };
    }>(
      "select operation_type,preview_data from public.lock_upload_preview($1,$2,$3)",
      [tokenHash, storeId, uploadId],
    );
    const preview = upload.rows[0].preview_data;
    const products = await runtime.query<{ id: string; sku: string }>(
      "select id,sku from public.products where store_id=$1 and is_active and sku=any($2::text[])",
      [storeId, preview.rows.map((row) => row.sku)],
    );
    const productMap = new Map(products.rows.map((row) => [row.sku, row.id]));
    let batchId: string;
    if (preview.business === "arrival") {
      const supplier = await runtime.query<{ id: string }>(
        "select id from public.suppliers where store_id=$1 and is_active and code=$2",
        [storeId, preview.rows[0].supplierCode],
      );
      batchId = (await runtime.query<{ batch_id: string }>(
        "select * from public.post_arrival($1,$2,$3,$4,$5,$6,$7)",
        [
          tokenHash,
          storeId,
          `excel-${uploadId}`,
          supplier.rows[0].id,
          preview.rows[0].businessDate,
          "Excel 集成测试",
          JSON.stringify(preview.rows.map((row) => ({
            productId: productMap.get(row.sku),
            cartons: row.cartons,
            loose: row.loose,
            note: row.note,
            sourceRow: row.row,
          }))),
        ],
      )).rows[0].batch_id;
    } else {
      batchId = (await runtime.query<{ batch_id: string }>(
        "select * from public.post_outbound($1,$2,$3,$4,$5,$6)",
        [
          tokenHash,
          storeId,
          `excel-${uploadId}`,
          preview.rows[0].businessDate,
          "Excel 集成测试",
          JSON.stringify(preview.rows.map((row) => ({
            productId: productMap.get(row.sku),
            quantity: row.quantity,
            note: row.note,
            sourceRow: row.row,
          }))),
        ],
      )).rows[0].batch_id;
    }
    await runtime.query(
      "select public.mark_upload_posted($1,$2,$3,$4)",
      [tokenHash, storeId, uploadId, batchId],
    );
    await runtime.query("commit");
    return batchId;
  } catch (error) {
    await runtime.query("rollback");
    throw error;
  }
}

describe.sequential("Excel 预览确认原子入账", () => {
  beforeAll(async () => {
    await owner.connect();
    await runtime.connect();
    storeId = (await owner.query<{ id: string }>(
      "select id from public.stores where code='STORE_B'",
    )).rows[0].id;
    userId = (await owner.query<{ id: string }>(
      "insert into public.app_users(email,display_name,password_hash,status) values($1,'Excel入账测试',$2,'active') returning id",
      [
        `excel-posting-${randomUUID()}@example.test`,
        await hash("Integration-test-123", { memoryCost: 8192, timeCost: 1, parallelism: 1 }),
      ],
    )).rows[0].id;
    await owner.query(
      "insert into public.user_store_memberships(user_id,store_id,role) values($1,$2,'operator')",
      [userId, storeId],
    );
    for (const permission of ["view_inventory", "record_arrival", "ship_inventory"]) {
      await owner.query(
        "insert into public.user_store_permissions(user_id,store_id,permission_code) values($1,$2,$3)",
        [userId, storeId, permission],
      );
    }
    await owner.query(
      "insert into public.app_sessions(user_id,token_hash,session_version,idle_expires_at,absolute_expires_at) values($1,$2,1,now()+interval '8 hours',now()+interval '7 days')",
      [userId, tokenHash],
    );
    await owner.query(
      "select set_config('app.user_id',$1,false),set_config('app.is_admin','true',false)",
      [userId],
    );
    productId = (await owner.query<{ id: string }>(
      "insert into public.products(store_id,sku,model,name_zh,units_per_carton,carton_spec_status,created_by,updated_by) values($1,$2,$2,'Excel测试商品',10,'confirmed',$3,$3) returning id",
      [storeId, sku, userId],
    )).rows[0].id;
    supplierId = (await owner.query<{ id: string }>(
      "insert into public.suppliers(store_id,code,name,created_by,updated_by) values($1,$2,'Excel测试供应商',$3,$3) returning id",
      [storeId, supplierCode, userId],
    )).rows[0].id;
    await owner.query(
      "insert into public.inventory_balances(store_id,product_id,available_qty) values($1,$2,100)",
      [storeId, productId],
    );
  });

  afterAll(async () => {
    if (userId) {
      await owner.query("set session_replication_role=replica");
      try {
        await owner.query("delete from public.uploaded_files where created_by=$1", [userId]);
        await owner.query("delete from public.inventory_ledger where actor_user_id=$1", [userId]);
        await owner.query(
          "delete from public.pending_receipts where store_id=$1 and product_id=$2",
          [storeId, productId],
        );
        await owner.query(
          "delete from public.operation_batch_items where store_id=$1 and product_id=$2",
          [storeId, productId],
        );
        await owner.query("delete from public.operation_batches where created_by=$1", [userId]);
        await owner.query("delete from public.idempotency_records where actor_user_id=$1", [userId]);
        await owner.query(
          "delete from public.inventory_balances where store_id=$1 and product_id=$2",
          [storeId, productId],
        );
        await owner.query("delete from public.suppliers where id=$1", [supplierId]);
        await owner.query("delete from public.products where id=$1", [productId]);
        await owner.query("delete from public.audit_events where actor_user_id=$1", [userId]);
      } finally {
        await owner.query("set session_replication_role=origin");
      }
      await owner.query("delete from public.user_store_permissions where user_id=$1", [userId]);
      await owner.query("delete from public.user_store_memberships where user_id=$1", [userId]);
      await owner.query("delete from public.app_sessions where user_id=$1", [userId]);
      await owner.query("delete from public.app_users where id=$1", [userId]);
    }
    await runtime.end();
    await owner.end();
  });

  it("运行账号不能直接锁定或修改上传记录", async () => {
    const uploadId = await createPreview("outbound", [{
      row: 6, sku, name: "Excel测试商品", quantity: 1,
      businessDate: "2026-08-07", note: "",
    }]);
    await expect(runtime.query(
      "select id from public.uploaded_files where id=$1 for update",
      [uploadId],
    )).rejects.toThrow(/permission denied/);
  });

  it("到仓待入可完成预览锁定、原子入账和文件标记", async () => {
    const uploadId = await createPreview("arrival", [{
      row: 6, sku, name: "Excel测试商品", unitsPerCarton: 10,
      cartons: 2, loose: 3, quantity: 23, businessDate: "2026-08-07",
      supplierCode, note: "到仓测试",
    }]);
    await expect(confirmPreview(uploadId)).resolves.toMatch(
      /^[0-9a-f]{8}-[0-9a-f-]{27}$/,
    );
    const state = (await owner.query<{
      status: string;
      pending_qty: string;
      available_qty: string;
    }>(
      "select u.status,b.pending_qty::text,b.available_qty::text from public.uploaded_files u join public.inventory_balances b on b.store_id=u.store_id and b.product_id=$2 where u.id=$1",
      [uploadId, productId],
    )).rows[0];
    expect(state).toEqual({ status: "posted", pending_qty: "23", available_qty: "100" });
  });

  it("出库可完成预览锁定、原子扣减和文件标记", async () => {
    const uploadId = await createPreview("outbound", [{
      row: 6, sku, name: "Excel测试商品", quantity: 25,
      businessDate: "2026-08-07", note: "出库测试",
    }]);
    await expect(confirmPreview(uploadId)).resolves.toMatch(
      /^[0-9a-f]{8}-[0-9a-f-]{27}$/,
    );
    const state = (await owner.query<{
      status: string;
      pending_qty: string;
      available_qty: string;
    }>(
      "select u.status,b.pending_qty::text,b.available_qty::text from public.uploaded_files u join public.inventory_balances b on b.store_id=u.store_id and b.product_id=$2 where u.id=$1",
      [uploadId, productId],
    )).rows[0];
    expect(state).toEqual({ status: "posted", pending_qty: "23", available_qty: "75" });
  });
});
