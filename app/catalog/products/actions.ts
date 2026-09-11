"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withSessionContext } from "@/lib/auth/session";
import { requireCurrentStore, can } from "@/lib/stores/current-store";

export type ProductState = { error?: string; success?: string };

const schema = z.object({
  productId: z.string().uuid().optional(),
  sku: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(100),
  styleNumber: z.string().trim().max(100),
  nameZh: z.string().trim().min(1).max(200),
  color: z.string().trim().max(100),
  size: z.string().trim().max(100),
  unit: z.string().trim().min(1).max(20),
  warningQty: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  unitsPerCarton: z.union([z.literal(""), z.coerce.number().int().positive().max(1_000_000)]),
  cartonSpecStatus: z.enum(["pending", "confirmed"]),
}).superRefine((value, context) => {
  if (value.cartonSpecStatus === "confirmed" && value.unitsPerCarton === "") {
    context.addIssue({ code: "custom", path: ["unitsPerCarton"], message: "确认箱规前必须填写每箱件数。" });
  }
});

export async function saveProductAction(
  _previous: ProductState,
  formData: FormData,
): Promise<ProductState> {
  const { session, store } = await requireCurrentStore();
  if (!can(store, "manage_products")) return { error: "当前账号没有商品管理权限。" };
  const productId = String(formData.get("productId") ?? "") || undefined;
  const parsed = schema.safeParse({
    productId,
    sku: formData.get("sku"), model: formData.get("model"),
    styleNumber: formData.get("styleNumber") ?? "", nameZh: formData.get("nameZh"),
    color: formData.get("color") ?? "", size: formData.get("size") ?? "",
    unit: formData.get("unit") ?? "件", warningQty: formData.get("warningQty") ?? "0",
    unitsPerCarton: formData.get("unitsPerCarton") ?? "",
    cartonSpecStatus: formData.get("cartonSpecStatus") ?? "pending",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const cartonStatus = parsed.data.cartonSpecStatus;
  const cartonQty = parsed.data.unitsPerCarton === "" ? null : parsed.data.unitsPerCarton;

  try {
    await withSessionContext(session, async (client) => {
      if (parsed.data.productId) {
        const result = await client.query(`
          update public.products set sku=$1, model=$2, style_number=$3, name_zh=$4,
            color=$5, size=$6, unit=$7, warning_qty=$8, units_per_carton=$9,
            carton_spec_status=$10, updated_by=$11
          where id=$12 and store_id=$13
        `, [parsed.data.sku, parsed.data.model, parsed.data.styleNumber, parsed.data.nameZh,
          parsed.data.color, parsed.data.size, parsed.data.unit, parsed.data.warningQty,
          cartonQty, cartonStatus, session.userId, parsed.data.productId, store.id]);
        if (result.rowCount !== 1) throw new Error("not_found");
      } else {
        await client.query(`
          insert into public.products(
            store_id, sku, model, style_number, name_zh, color, size, unit,
            warning_qty, units_per_carton, carton_spec_status, created_by, updated_by
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
        `, [store.id, parsed.data.sku, parsed.data.model, parsed.data.styleNumber,
          parsed.data.nameZh, parsed.data.color, parsed.data.size, parsed.data.unit,
          parsed.data.warningQty, cartonQty, cartonStatus, session.userId]);
      }
    });
    revalidatePath("/catalog/products");
    return { success: parsed.data.productId ? "商品已更新。" : "商品已创建。" };
  } catch (error) {
    const code = (error as { code?: string }).code;
    const constraint = (error as { constraint?: string }).constraint;
    if (code === "23505" && constraint?.includes("sku")) return { error: "该商品 SKU 已存在；SKU 在所有店铺中必须唯一。" };
    if (code === "23505") return { error: "当前店铺已存在相同型号、款号、颜色和尺码。" };
    return { error: "保存失败，请检查数据后重试。" };
  }
}

export async function setProductActiveAction(formData: FormData) {
  const { session, store } = await requireCurrentStore();
  if (!can(store, "manage_products")) throw new Error("权限不足");
  const input = z.object({ productId: z.string().uuid(), active: z.enum(["true", "false"]) })
    .parse({ productId: formData.get("productId"), active: formData.get("active") });
  await withSessionContext(session, async (client) => {
    await client.query("update public.products set is_active=$1, updated_by=$2 where id=$3 and store_id=$4", [
      input.active === "true", session.userId, input.productId, store.id,
    ]);
  });
  revalidatePath("/catalog/products");
}
