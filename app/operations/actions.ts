"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getCurrentSession } from "@/lib/auth/session";

export async function logoutAction() {
  const session = await getCurrentSession();
  if (session) await db.query("select public.auth_revoke_session($1)", [session.tokenHash]);
  const cookieStore = await cookies();
  cookieStore.delete(getEnv().SESSION_COOKIE_NAME);
  cookieStore.delete("inventory_demo_current_store");
  redirect("/login");
}

export async function switchStoreAction(formData: FormData) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  const storeId = String(formData.get("storeId") ?? "");
  if (!session.stores.some((store) => store.id === storeId)) throw new Error("无权访问该店铺");
  const cookieStore = await cookies();
  cookieStore.set("inventory_demo_current_store", storeId, {
    httpOnly: true,
    secure: getEnv().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  redirect("/operations");
}
