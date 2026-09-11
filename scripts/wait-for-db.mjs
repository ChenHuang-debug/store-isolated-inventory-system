import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const { Client } = pg;
const timeoutMs = 60_000;
const startedAt = Date.now();
const envText = fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
const databaseUrl = process.env.DATABASE_URL ?? envText.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();

if (!databaseUrl) {
  console.error("DATABASE_URL 未配置。");
  process.exit(1);
}

while (Date.now() - startedAt < timeoutMs) {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
  try {
    await client.connect();
    await client.query("select 1");
    await client.end();
    console.log("PostgreSQL 已就绪。");
    process.exit(0);
  } catch {
    await client.end().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

console.error("等待 PostgreSQL 超时，请检查 Docker Desktop 和容器日志。");
process.exit(1);
