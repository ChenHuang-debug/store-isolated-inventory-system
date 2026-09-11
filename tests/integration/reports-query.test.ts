import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

function readEnv(name: string) {
  const text = process.env[name] ? "" : fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
  const value = process.env[name] ?? text.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim();
  if (!value) throw new Error(`${name} 未配置`);
  return value;
}

const owner = new Client({ connectionString: readEnv("MIGRATION_DATABASE_URL") });

describe.sequential("统计看板数据库查询", () => {
  beforeAll(() => owner.connect());
  afterAll(() => owner.end());

  it("供应商和差异原因聚合可在 PostgreSQL 执行", async () => {
    const store = await owner.query<{ id: string }>("select id from public.stores where code='STORE_A'");
    const storeId = store.rows[0].id;
    const suppliers = await owner.query(
      `select s.code,s.name,coalesce((select sum(i.quantity) from public.operation_batches b join public.operation_batch_items i on i.batch_id=b.id where b.supplier_id=s.id and b.operation_type='arrival' and b.status='posted'),0)::text arrival_qty,coalesce((select sum(l.delta_available) from public.inventory_ledger l join public.pending_receipts pr on pr.id=l.pending_receipt_id where pr.supplier_id=s.id and l.business_type='receipt'),0)::text receipt_qty from public.suppliers s where s.store_id=$1 order by coalesce((select sum(i.quantity) from public.operation_batches b join public.operation_batch_items i on i.batch_id=b.id where b.supplier_id=s.id and b.operation_type='arrival' and b.status='posted'),0) desc,s.code`,
      [storeId],
    );
    const reasons = await owner.query(
      `select coalesce(l.reason_code,'none') reason_code,coalesce(l.reason_label,'无差异') reason_label,count(*)::text occurrences,coalesce(sum(case when l.business_type='receipt' then abs(l.before_pending-l.delta_available) when l.business_type='adjustment' then abs(l.delta_available) else abs(l.delta_available)+abs(l.delta_pending) end),0)::text absolute_qty from public.inventory_ledger l where l.store_id=$1 and l.reason_code is not null group by l.reason_code,l.reason_label order by coalesce(sum(case when l.business_type='receipt' then abs(l.before_pending-l.delta_available) when l.business_type='adjustment' then abs(l.delta_available) else abs(l.delta_available)+abs(l.delta_pending) end),0) desc`,
      [storeId],
    );
    expect(Array.isArray(suppliers.rows)).toBe(true);
    expect(Array.isArray(reasons.rows)).toBe(true);
  });
});
