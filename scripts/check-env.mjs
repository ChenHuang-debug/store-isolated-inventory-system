import fs from "node:fs";
import path from "node:path";

const required = ["DATABASE_URL", "MIGRATION_DATABASE_URL", "SESSION_SECRET", "INITIAL_ADMIN_EMAIL"];
const envFile = path.resolve(process.cwd(), ".env.local");

if (!fs.existsSync(envFile)) {
  console.error("缺少 .env.local。请复制 .env.example 后填写本地配置。");
  process.exit(1);
}

const values = new Map();
for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const separator = trimmed.indexOf("=");
  if (separator < 1) continue;
  values.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
}

const getValue = (key) => process.env[key] ?? values.get(key);
const missing = required.filter((key) => !getValue(key));
if (missing.length > 0) {
  console.error(`环境变量缺失：${missing.join("、")}`);
  process.exit(1);
}

if (getValue("NODE_ENV") === "production" && getValue("MFA_ENFORCED") !== "true") {
  console.error("公网生产环境必须设置 MFA_ENFORCED=true。");
  process.exit(1);
}

const secret = getValue("SESSION_SECRET") ?? "";
if (secret.length < 32 || secret.includes("replace-with")) {
  console.error("SESSION_SECRET 必须是至少 32 位的随机值，不能使用示例占位符。");
  process.exit(1);
}

try {
  const databaseUrl = new URL(getValue("DATABASE_URL"));
  if (!databaseUrl.protocol.startsWith("postgres")) throw new Error();
} catch {
  console.error("DATABASE_URL 不是有效的 PostgreSQL 连接地址。");
  process.exit(1);
}

console.log("本地环境变量检查通过。敏感值未输出。");
