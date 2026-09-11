import { createCipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createInterface } from "node:readline/promises";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const envText = fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
const read = (key) => process.env[key] ?? envText.match(new RegExp("^" + key + "=(.+)$", "m"))?.[1]?.trim();
const databaseUrl = read("MIGRATION_DATABASE_URL");
const sessionSecret = read("SESSION_SECRET");
const email = (process.argv[2] ?? "").trim().toLowerCase();

if (!databaseUrl || !sessionSecret || sessionSecret.length < 32) throw new Error("数据库或会话密钥配置无效。");
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("用法：npm run mfa:enroll -- user@example.com");

function base32(input) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function encrypt(secret) {
  const key = createHash("sha256").update(sessionSecret + ":inventory_demo-mfa-v1").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decodeBase32(input) {
  let bits = 0;
  let value = 0;
  const output = [];
  for (const character of input) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new Error("验证器密钥格式无效。");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function totp(secret, now) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const value = ((((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16)
    | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255)) % 1000000);
  return value.toString().padStart(6, "0");
}

function verifyCode(secret, code) {
  if (code.length !== 6) return false;
  const candidate = Buffer.from(code);
  return [-30000, 0, 30000].some((offset) => {
    const expected = Buffer.from(totp(secret, Date.now() + offset));
    return timingSafeEqual(candidate, expected);
  });
}

const secret = base32(randomBytes(20));
console.log("请把下面的密钥手动添加到验证器。此密钥只显示一次，不要截图或发送给别人：");
console.log(secret.match(/.{1,4}/g).join(" "));
const prompt = createInterface({ input: process.stdin, output: process.stdout });
const code = (await prompt.question("输入验证器当前显示的 6 位数字以确认绑定：")).trim();
prompt.close();
if (!verifyCode(secret, code)) throw new Error("验证码不正确，未保存任何变更。");
const encrypted = encrypt(secret);
const { Client } = pg;
const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();
  await client.query("begin");
  const result = await client.query(
    "update public.app_users set mfa_secret_encrypted=$2,mfa_enrolled_at=now(),session_version=session_version+1,updated_at=now() where email=$1 and status='active' returning id,email",
    [email, encrypted],
  );
  if (result.rowCount !== 1) throw new Error("未找到正常状态的账号。");
  await client.query("update public.app_sessions set revoked_at=coalesce(revoked_at,now()) where user_id=$1", [result.rows[0].id]);
  await client.query(
    "insert into public.audit_events(actor_user_id,action,object_type,object_id,metadata) values ($1::uuid,'user.mfa_enrolled','user',$1::uuid::text,jsonb_build_object('method','totp'))",
    [result.rows[0].id],
  );
  await client.query("commit");
  console.log("添加完成后，使用验证器生成的 6 位数字登录。旧登录已失效。");
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
