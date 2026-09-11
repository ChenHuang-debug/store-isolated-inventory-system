import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? readDatabaseUrl();

function readDatabaseUrl() {
  try {
    const source = requireEnvFile();
    const match = source.match(/^MIGRATION_DATABASE_URL=(.+)$/m);
    if (!match) throw new Error("MIGRATION_DATABASE_URL 未配置");
    return match[1].trim();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function requireEnvFile() {
  const file = path.resolve(process.cwd(), ".env.local");
  return fsSync.readFileSync(file, "utf8");
}

const migrationsDir = path.resolve(process.cwd(), "db/migrations");
const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();
  await client.query("select pg_advisory_lock($1)", [823741]);
  await client.query(`
    create table if not exists public.schema_migrations (
      version text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);

  const files = (await fs.readdir(migrationsDir))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  const applied = await client.query(
    "select version, checksum from public.schema_migrations order by version",
  );
  const checksums = new Map(applied.rows.map((row) => [row.version, row.checksum]));

  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    const existing = checksums.get(file);
    if (existing && existing !== checksum) {
      throw new Error(`已应用迁移被修改：${file}`);
    }
    if (existing) continue;

    console.log(`应用迁移 ${file}`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query(
        "insert into public.schema_migrations(version, checksum) values ($1, $2)",
        [file, checksum],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }

  console.log(`数据库迁移完成，共发现 ${files.length} 个迁移文件。`);
} finally {
  try {
    await client.query("select pg_advisory_unlock($1)", [823741]);
  } catch {
    // Connection may not have reached the lock step.
  }
  await client.end();
}
