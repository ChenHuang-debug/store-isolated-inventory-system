import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hash } from "@node-rs/argon2";
import { Client } from "pg";

function readEnv(name: string): string {
  if (process.env[name]) return process.env[name]!;
  const text = fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
  const value = text.match(new RegExp("^" + name + "=(.+)$", "m"))?.[1]?.trim();
  if (!value) throw new Error(name + " 未配置");
  return value;
}

const owner = new Client({ connectionString: readEnv("MIGRATION_DATABASE_URL") });
const runtime = new Client({ connectionString: readEnv("DATABASE_URL") });
const email = "mfa-" + randomUUID() + "@example.test";
let userId = "";

describe.sequential("双重验证数据库保护", () => {
  beforeAll(async () => {
    await owner.connect();
    await runtime.connect();
    const passwordHash = await hash("Mfa-test-password-123", {
      memoryCost: 8_192,
      timeCost: 1,
      parallelism: 1,
    });
    const result = await owner.query<{ id: string }>(
      "insert into public.app_users(email,display_name,password_hash,status) values ($1,'MFA测试',$2,'active') returning id",
      [email, passwordHash],
    );
    userId = result.rows[0].id;
  });

  afterAll(async () => {
    if (userId) await owner.query("delete from public.app_users where id=$1", [userId]);
    await runtime.end();
    await owner.end();
  });

  it("密钥和开通时间必须同时存在", async () => {
    await expect(owner.query(
      "update public.app_users set mfa_secret_encrypted=$2 where id=$1",
      [userId, "v1." + "a".repeat(60)],
    )).rejects.toMatchObject({ code: "23514" });
  });

  it("运行账号只能通过受控登录函数取得加密值", async () => {
    const encrypted = "v1." + "a".repeat(60);
    await owner.query(
      "update public.app_users set mfa_secret_encrypted=$2,mfa_enrolled_at=now() where id=$1",
      [userId, encrypted],
    );
    const lookup = await runtime.query<{
      id: string;
      mfa_secret_encrypted: string;
      mfa_enrolled_at: Date;
    }>("select id,mfa_secret_encrypted,mfa_enrolled_at from public.auth_lookup_user($1)", [email]);
    expect(lookup.rows[0]).toEqual(expect.objectContaining({
      id: userId,
      mfa_secret_encrypted: encrypted,
      mfa_enrolled_at: expect.any(Date),
    }));
    await expect(runtime.query(
      "select mfa_secret_encrypted from public.app_users where id=$1",
      [userId],
    )).resolves.toMatchObject({ rows: [] });
  });

  it("绑定审计复用用户 ID 时保持 UUID 参数类型一致", async () => {
    await owner.query("begin");
    try {
      const result = await owner.query<{ object_id: string }>(
        "insert into public.audit_events(actor_user_id,action,object_type,object_id,metadata) values ($1::uuid,'user.mfa_enrolled','user',$1::uuid::text,jsonb_build_object('method','totp')) returning object_id",
        [userId],
      );
      expect(result.rows[0].object_id).toBe(userId);
    } finally {
      await owner.query("rollback");
    }
  });
});
