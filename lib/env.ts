import "server-only";

import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://127.0.0.1:3000"),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  SESSION_COOKIE_NAME: z.string().min(1).default("inventory_demo_session"),
  MFA_ENFORCED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  LOCAL_STORAGE_ROOT: z.string().min(1).default("./var/uploads"),
  MAIL_HOST: z.string().min(1).default("127.0.0.1"),
  MAIL_PORT: z.coerce.number().int().positive().default(58025),
  MAIL_FROM: z.string().email().default("inventory@example.test"),
  INITIAL_ADMIN_EMAIL: z.string().email().default("admin@example.test"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | undefined;

export function getEnv(): AppEnv {
  if (cachedEnv) return cachedEnv;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`环境变量校验失败：${details}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}
