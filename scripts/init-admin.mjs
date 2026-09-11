import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { hash, Algorithm } from "@node-rs/argon2";

const { Client } = pg;
const envText = fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
const read = (key) => envText.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim();
const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? read("MIGRATION_DATABASE_URL");
const email = (process.env.INITIAL_ADMIN_EMAIL ?? read("INITIAL_ADMIN_EMAIL") ?? "").toLowerCase();

function readHidden(label) {
  if (!process.stdin.isTTY) throw new Error("管理员密码必须在交互式终端中设置。");
  return new Promise((resolve, reject) => {
    process.stdout.write(label);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    let value = "";
    const onData = (key) => {
      if (key === "\u0003") { cleanup(); reject(new Error("已取消")); return; }
      if (key === "\r" || key === "\n") { cleanup(); process.stdout.write("\n"); resolve(value); return; }
      if (key === "\u007f" || key === "\b") { value = value.slice(0, -1); return; }
      if (key >= " ") value += key;
    };
    const cleanup = () => { process.stdin.off("data", onData); process.stdin.setRawMode(false); process.stdin.pause(); };
    process.stdin.on("data", onData);
  });
}

if (!databaseUrl || !email) throw new Error("缺少迁移连接或管理员邮箱配置。");
const password = await readHidden("设置管理员密码（至少 12 位）：");
const confirmation = await readHidden("再次输入管理员密码：");
if (password !== confirmation) throw new Error("两次密码不一致。");
if (password.length < 12 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
  throw new Error("密码至少 12 位，并同时包含字母和数字。");
}

const passwordHash = await hash(password, { algorithm: Algorithm.Argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 });
const client = new Client({ connectionString: databaseUrl });
try {
  await client.connect();
  await client.query("begin");
  const result = await client.query(`
    insert into public.app_users(email, display_name, password_hash, status, is_system_admin)
    values ($1, '系统管理员', $2, 'active', true)
    on conflict (email) do update set
      password_hash = excluded.password_hash,
      status = 'active', is_system_admin = true,
      session_version = public.app_users.session_version + 1,
      updated_at = now()
    returning id
  `, [email, passwordHash]);
  const userId = result.rows[0].id;
  await client.query(`
    insert into public.user_store_memberships(user_id, store_id, role, created_by)
    select $1, id, 'operator', $1 from public.stores
    on conflict (user_id, store_id) do nothing
  `, [userId]);
  await client.query(`
    insert into public.audit_events(actor_user_id, action, object_type, object_id, metadata)
    values ($1::uuid, 'user.admin_initialized', 'user', $1::uuid::text, jsonb_build_object('email', $2::text))
  `, [userId, email]);
  await client.query("commit");
  console.log(`管理员 ${email} 已初始化；旧会话已失效。`);
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
