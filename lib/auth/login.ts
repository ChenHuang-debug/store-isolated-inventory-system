import "server-only";

import { db } from "@/lib/db";
import {
  DUMMY_PASSWORD_HASH,
  createSessionToken,
  privacyHash,
  sha256,
  verifyPassword,
} from "@/lib/auth/crypto";
import { getEnv } from "@/lib/env";
import { verifyEncryptedMfaCode } from "@/lib/auth/mfa";

type LoginUserRow = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  status: "invited" | "active" | "disabled";
  is_system_admin: boolean;
  session_version: number;
  mfa_secret_encrypted: string | null;
  mfa_enrolled_at: Date | null;
};

type LoginFailureReason = "invalid" | "rate_limited" | "mfa_required" | "mfa_not_enrolled";

export type LoginResult =
  | { ok: true; token: string; absoluteExpiresAt: Date }
  | { ok: false; reason: LoginFailureReason };

export async function authenticateWithPassword(input: {
  email: string;
  password: string;
  mfaCode?: string;
  ip: string;
  userAgent: string;
}): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();
  const emailHash = sha256(email);
  const ipHash = privacyHash(input.ip);
  const allowed = await db.query<{ allowed: boolean }>(
    "select public.auth_can_attempt($1, $2) allowed",
    [emailHash, ipHash],
  );
  if (!allowed.rows[0]?.allowed) return { ok: false, reason: "rate_limited" };

  const lookup = await db.query<LoginUserRow>("select * from public.auth_lookup_user($1)", [email]);
  const user = lookup.rows[0];
  const passwordValid = await verifyPassword(user?.password_hash ?? DUMMY_PASSWORD_HASH, input.password)
    .catch(() => false);
  const accountValid = Boolean(user && user.status === "active" && passwordValid);

  let failureReason: LoginFailureReason | null = accountValid ? null : "invalid";
  if (accountValid && user) {
    if (!user.mfa_secret_encrypted && getEnv().MFA_ENFORCED) {
      failureReason = "mfa_not_enrolled";
    } else if (user.mfa_secret_encrypted && !input.mfaCode) {
      failureReason = "mfa_required";
    } else if (
      user.mfa_secret_encrypted
      && !verifyEncryptedMfaCode(user.mfa_secret_encrypted, input.mfaCode ?? "")
    ) {
      failureReason = "invalid";
    }
  }

  const succeeded = failureReason === null;
  await db.query("select public.auth_record_attempt($1, $2, $3, $4, $5)", [
    emailHash,
    ipHash,
    succeeded,
    succeeded && user ? user.id : null,
    input.userAgent,
  ]);

  if (!succeeded || !user) return { ok: false, reason: failureReason ?? "invalid" };

  const token = createSessionToken();
  const now = Date.now();
  const idleExpiresAt = new Date(now + 8 * 60 * 60 * 1000);
  const absoluteExpiresAt = new Date(now + 7 * 24 * 60 * 60 * 1000);
  await db.query("select public.auth_create_session($1, $2, $3, $4, $5, $6)", [
    user.id,
    sha256(token),
    idleExpiresAt,
    absoluteExpiresAt,
    input.userAgent,
    ipHash,
  ]);

  return { ok: true, token, absoluteExpiresAt };
}
