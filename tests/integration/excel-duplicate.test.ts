import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { hash } from "@node-rs/argon2";

function env(name: string) {
  const value = process.env[name] ?? fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8")
    .match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim();
  if (!value) throw new Error(`${name} 未配置`);
  return value;
}

const owner = new Client({ connectionString: env("MIGRATION_DATABASE_URL") });
const runtime = new Client({ connectionString: env("DATABASE_URL") });
let userId = "";
let storeId = "";
let batchId = "";
const tokenHash = createHash("sha256").update(`excel-${randomUUID()}`).digest("hex");
const fileHash = createHash("sha256").update("same-excel-content").digest("hex");

describe.sequential("Excel 重复导入保护", () => {
  beforeAll(async () => {
    await owner.connect();
    await runtime.connect();
    storeId = (await owner.query<{ id: string }>("select id from public.stores where code='STORE_A'")).rows[0].id;
    const passwordHash = await hash("Integration-test-123", { memoryCost: 8192, timeCost: 1, parallelism: 1 });
    const user = await owner.query<{ id: string }>(
      "insert into public.app_users(email,display_name,password_hash,status) values($1,'Excel测试',$2,'active') returning id",
      [`excel-${randomUUID()}@example.test`, passwordHash],
    );
    userId = user.rows[0].id;
    await owner.query("insert into public.user_store_memberships(user_id,store_id,role) values($1,$2,'operator')", [userId, storeId]);
    await owner.query("insert into public.user_store_permissions(user_id,store_id,permission_code) values($1,$2,'record_arrival')", [userId, storeId]);
    await owner.query("insert into public.app_sessions(user_id,token_hash,session_version,idle_expires_at,absolute_expires_at) values($1,$2,1,now()+interval '8 hours',now()+interval '7 days')", [userId, tokenHash]);
    batchId = (await owner.query<{ id: string }>("insert into public.operation_batches(store_id,operation_type,status,idempotency_key,business_date,total_lines,total_qty,created_by) values($1,'arrival','posted',$2,current_date,0,0,$3) returning id", [storeId, `dup-${randomUUID()}`, userId])).rows[0].id;
  });

  afterAll(async () => {
    if (userId) {
      await owner.query("delete from public.uploaded_files where created_by=$1", [userId]);
      await owner.query("delete from public.operation_batches where created_by=$1", [userId]);
      await owner.query("set session_replication_role=replica");
      try { await owner.query("delete from public.audit_events where actor_user_id=$1", [userId]); }
      finally { await owner.query("set session_replication_role=origin"); }
      await owner.query("delete from public.user_store_permissions where user_id=$1", [userId]);
      await owner.query("delete from public.user_store_memberships where user_id=$1", [userId]);
      await owner.query("delete from public.app_sessions where user_id=$1", [userId]);
      await owner.query("delete from public.app_users where id=$1", [userId]);
    }
    await runtime.end();
    await owner.end();
  });

  it("同店铺同业务已入账文件不能再次创建预览", async () => {
    const preview = JSON.stringify({ rows: [], errors: [] });
    const first = await runtime.query<{ create_upload_preview: string }>(
      "select public.create_upload_preview($1,$2,'arrival',$3,$4,$5,100,'1.0',$6)",
      [tokenHash, storeId, "首次.xlsx", `${storeId}/${randomUUID()}.xlsx`, fileHash, preview],
    );
    await runtime.query("select public.mark_upload_posted($1,$2,$3,$4)", [tokenHash, storeId, first.rows[0].create_upload_preview, batchId]);
    await expect(runtime.query(
      "select public.create_upload_preview($1,$2,'arrival',$3,$4,$5,100,'1.0',$6)",
      [tokenHash, storeId, "重复.xlsx", `${storeId}/${randomUUID()}.xlsx`, fileHash, preview],
    )).rejects.toThrow(/duplicate_file/);
  });
});
