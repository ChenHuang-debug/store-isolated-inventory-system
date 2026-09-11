"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withSessionContext } from "@/lib/auth/session";
import { requireCurrentStore, can } from "@/lib/stores/current-store";

export type SupplierState = { error?: string; success?: string };
const schema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(150),
  origin: z.string().trim().max(150),
  contactName: z.string().trim().max(100),
  contactPhone: z.string().trim().max(50),
  notes: z.string().trim().max(1000),
});

export async function saveSupplierAction(_previous: SupplierState, formData: FormData): Promise<SupplierState> {
  const { session, store } = await requireCurrentStore();
  if (!can(store, "manage_suppliers")) return { error: "当前账号没有供应商管理权限。" };
  const parsed = schema.safeParse({
    code: formData.get("code"), name: formData.get("name"), origin: formData.get("origin") ?? "",
    contactName: formData.get("contactName") ?? "", contactPhone: formData.get("contactPhone") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await withSessionContext(session, (client) => client.query(`
      insert into public.suppliers(
        store_id, code, name, origin, contact_name, contact_phone, notes, created_by, updated_by
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$8)
    `, [store.id, parsed.data.code, parsed.data.name, parsed.data.origin,
      parsed.data.contactName, parsed.data.contactPhone, parsed.data.notes, session.userId]));
    revalidatePath("/suppliers");
    return { success: "供应商已创建。" };
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return { error: "当前店铺已存在相同供应商代码。" };
    return { error: "保存失败，请检查数据后重试。" };
  }
}

export async function setSupplierActiveAction(formData: FormData) {
  const { session, store } = await requireCurrentStore();
  if (!can(store, "manage_suppliers")) throw new Error("权限不足");
  const input = z.object({ supplierId: z.string().uuid(), active: z.enum(["true", "false"]) })
    .parse({ supplierId: formData.get("supplierId"), active: formData.get("active") });
  await withSessionContext(session, (client) => client.query(
    "update public.suppliers set is_active=$1, updated_by=$2 where id=$3 and store_id=$4",
    [input.active === "true", session.userId, input.supplierId, store.id],
  ));
  revalidatePath("/suppliers");
}
