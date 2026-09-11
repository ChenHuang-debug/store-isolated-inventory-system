import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const { Client } = pg;
const envPath = path.resolve(process.cwd(), ".env.local");
const text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const read = (key) => text.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim();
const migrationUrl = process.env.MIGRATION_DATABASE_URL ?? read("MIGRATION_DATABASE_URL");
const runtimeUrl = process.env.DATABASE_URL ?? read("DATABASE_URL");

if (!migrationUrl || !runtimeUrl) {
  console.error("缺少 MIGRATION_DATABASE_URL 或 DATABASE_URL。");
  process.exit(1);
}

const runtime = new URL(runtimeUrl);
if (decodeURIComponent(runtime.username) !== "inventory_runtime") {
  console.error("DATABASE_URL 必须使用 inventory_runtime 角色。");
  process.exit(1);
}

const password = decodeURIComponent(runtime.password);
if (password.length < 24 || password.includes("replace-with")) {
  console.error("运行时数据库密码必须是至少 24 位的随机值。");
  process.exit(1);
}

const escapedPassword = password.replaceAll("'", "''");
const client = new Client({ connectionString: migrationUrl });
try {
  await client.connect();
  await client.query(`alter role inventory_runtime login password '${escapedPassword}'`);
  console.log("数据库运行时角色已配置；密码未输出。");
} finally {
  await client.end();
}
