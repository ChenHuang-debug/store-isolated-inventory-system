"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireCurrentStore, can } from "@/lib/stores/current-store";

export type ArrivalState = { error?: string; success?: string; batchId?: string };
const itemSchema = z.object({
  productId: z.string().uuid(),
  cartons: z.number().int().nonnegative(),
  loose: z.number().int().nonnegative(),
});
const schema = z.object({
  supplierId: z.string().uuid(),
  businessDate: z.string().date(),
  idempotencyKey: z.string().min(8).max(200),
  note: z.string().trim().max(1000),
  items: z.array(itemSchema).min(1).max(2000),
});

export async function postArrivalAction(_previous: ArrivalState, formData: FormData): Promise<ArrivalState> {
  const { session, store } = await requireCurrentStore();
  if (!can(store, "record_arrival")) return { error: "当前账号没有到仓登记权限。" };
  let items: unknown;
  try { items = JSON.parse(String(formData.get("itemsJson") ?? "")); }
  catch { return { error: "商品明细格式无效。" }; }
  const parsed = schema.safeParse({
    supplierId: formData.get("supplierId"), businessDate: formData.get("businessDate"),
    idempotencyKey: formData.get("idempotencyKey"), note: formData.get("note") ?? "", items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (new Set(parsed.data.items.map((item) => item.productId)).size !== parsed.data.items.length) {
    return { error: "同一个商品 SKU 不能重复出现。" };
  }

  try {
    const result = await db.query<{ batch_id: string; replayed: boolean }>(
      "select * from public.post_arrival($1,$2,$3,$4,$5,$6,$7)",
      [session.tokenHash, store.id, parsed.data.idempotencyKey, parsed.data.supplierId,
        parsed.data.businessDate, parsed.data.note, JSON.stringify(parsed.data.items)],
    );
    revalidatePath("/inventory/arrivals");
    revalidatePath("/operations");
    return {
      success: result.rows[0].replayed ? "该请求已经入账，已返回原批次。" : "到仓待入已登记。",
      batchId: result.rows[0].batch_id,
    };
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes("carton_spec_pending")) return { error: "存在箱规待确认商品，请先维护每箱件数。" };
    if (message.includes("loose_units_invalid")) return { error: "尾数必须小于该商品每箱件数。" };
    if (message.includes("idempotency_conflict")) return { error: "同一请求编号不能提交不同内容，请刷新后重试。" };
    if (message.includes("invalid_supplier")) return { error: "供应商无效或不属于当前店铺。" };
    return { error: "到仓登记失败，所有明细均未入账。" };
  }
}
