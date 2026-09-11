import "server-only";

import { cookies } from "next/headers";
import { requireSession, resolveCurrentStore } from "@/lib/auth/session";

export async function requireCurrentStore() {
  const session = await requireSession();
  const cookieStore = await cookies();
  const store = resolveCurrentStore(session, cookieStore.get("inventory_demo_current_store")?.value);
  if (!store) throw new Error("当前账号没有可用店铺");
  return { session, store };
}

export function can(store: { permissions: string[] }, permission: string) {
  return store.permissions.includes(permission);
}
