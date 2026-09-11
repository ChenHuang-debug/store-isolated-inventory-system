import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, withTransaction } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { sha256 } from "@/lib/auth/crypto";
import type { AuthSession, StoreAccess } from "@/lib/auth/types";

const storesSchema = z.array(z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  permissions: z.array(z.string()),
}));

type SessionRow = {
  session_id: string;
  user_id: string;
  email: string;
  display_name: string;
  is_system_admin: boolean;
  absolute_expires_at: Date;
  stores: unknown;
};

export const getCurrentSession = cache(async (): Promise<AuthSession | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(getEnv().SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const tokenHash = sha256(token);
  const result = await db.query<SessionRow>("select * from public.auth_get_session($1)", [tokenHash]);
  const row = result.rows[0];
  if (!row) return null;

  const parsedStores = storesSchema.safeParse(row.stores);
  if (!parsedStores.success) throw new Error("会话店铺权限数据无效");

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    isSystemAdmin: row.is_system_admin,
    absoluteExpiresAt: new Date(row.absolute_expires_at),
    stores: parsedStores.data as StoreAccess[],
    tokenHash,
  };
});

export async function requireSession(): Promise<AuthSession> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return session;
}

export async function withSessionContext<T>(
  session: AuthSession,
  callback: Parameters<typeof withTransaction<T>>[0],
): Promise<T> {
  return withTransaction(async (client) => {
    await client.query("select public.app_set_session_context($1)", [session.tokenHash]);
    return callback(client);
  });
}

export function resolveCurrentStore(
  session: AuthSession,
  storeId: string | undefined,
): StoreAccess | null {
  if (session.stores.length === 0) return null;
  return session.stores.find((store) => store.id === storeId) ?? session.stores[0];
}
