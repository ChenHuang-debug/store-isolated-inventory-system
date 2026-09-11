"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/crypto";
import { knownPermissions } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";

export type UserActionState = { error?: string; success?: string };

const createSchema = z.object({
  email: z.string().trim().email("邮箱格式不正确"),
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(12, "初始密码至少 12 位").max(256)
    .regex(/[A-Za-z]/, "密码必须包含字母")
    .regex(/\d/, "密码必须包含数字"),
  storeId: z.string().uuid(),
  role: z.enum(["operator", "viewer"]),
});

export async function createUserAction(
  _previous: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const session = await requireSession();
  if (!session.isSystemAdmin) return { error: "仅系统管理员可以创建用户。" };
  const parsed = createSchema.safeParse({
    email: formData.get("email"),
    displayName: formData.get("displayName"),
    password: formData.get("password"),
    storeId: formData.get("storeId"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!session.stores.some((store) => store.id === parsed.data.storeId)) {
    return { error: "店铺不在当前管理员授权范围内。" };
  }

  const requested = formData.getAll("permissions").map(String);
  if (requested.some((code) => !knownPermissions.has(code))) return { error: "包含未知权限。" };
  const permissions = parsed.data.role === "viewer"
    ? ["view_inventory"]
    : Array.from(new Set(["view_inventory", ...requested]));

  try {
    const passwordHash = await hashPassword(parsed.data.password);
    await db.query("select public.admin_create_user($1, $2, $3, $4, $5, $6, $7)", [
      session.tokenHash,
      parsed.data.email,
      parsed.data.displayName,
      passwordHash,
      parsed.data.storeId,
      parsed.data.role,
      permissions,
    ]);
    revalidatePath("/settings/users");
    return { success: "用户已创建并获得首个店铺权限。" };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") return { error: "该邮箱已经存在。" };
    return { error: "创建失败，请检查输入或稍后重试。" };
  }
}

export async function setUserStatusAction(formData: FormData) {
  const session = await requireSession();
  if (!session.isSystemAdmin) throw new Error("权限不足");
  const parsed = z.object({
    userId: z.string().uuid(),
    status: z.enum(["active", "disabled"]),
  }).parse({ userId: formData.get("userId"), status: formData.get("status") });
  await db.query("select public.admin_set_user_status($1, $2, $3)", [
    session.tokenHash,
    parsed.userId,
    parsed.status,
  ]);
  revalidatePath("/settings/users");
}
