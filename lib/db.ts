import "server-only";

import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { getEnv } from "@/lib/env";

const globalForDb = globalThis as unknown as { inventory_demoPool?: Pool };

export const db =
  globalForDb.inventory_demoPool ??
  new Pool({
    connectionString: getEnv().DATABASE_URL,
    max: process.env.NODE_ENV === "production" ? 20 : 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "store-isolated-inventory-system",
  });

if (process.env.NODE_ENV !== "production") globalForDb.inventory_demoPool = db;

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export type { QueryResultRow };
