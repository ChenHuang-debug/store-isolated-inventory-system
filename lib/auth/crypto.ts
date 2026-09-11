import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";
import { hash, verify, type Algorithm } from "@node-rs/argon2";
import { getEnv } from "@/lib/env";

const passwordOptions = {
  algorithm: 2 as Algorithm,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
} as const;

export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,t=3,p=1$Dm3ZLAzwdZrBYPwnwOQ9vQ$OTdRo0hCiWpCaTIEqPLKGIQpHJlewWgfbHDh7zqXkpY";

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function privacyHash(value: string): string {
  return createHmac("sha256", getEnv().SESSION_SECRET).update(value || "unknown").digest("hex");
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, passwordOptions);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password, passwordOptions);
}
