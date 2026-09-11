import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getEnv } from "@/lib/env";
import { verifyTotpCode } from "@/lib/auth/totp";

function encryptionKey(): Buffer {
  return createHash("sha256")
    .update(getEnv().SESSION_SECRET + ":inventory_demo-mfa-v1")
    .digest();
}

export function encryptMfaSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptMfaSecret(value: string): string {
  const [version, ivText, tagText, encryptedText] = value.split(".");
  if (version !== "v1" || !ivText || !tagText || !encryptedText) {
    throw new Error("双重验证密钥格式无效");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function verifyEncryptedMfaCode(encryptedSecret: string, code: string): boolean {
  try {
    return verifyTotpCode(decryptMfaSecret(encryptedSecret), code);
  } catch {
    return false;
  }
}
