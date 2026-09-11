"use server";

import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticateWithPassword } from "@/lib/auth/login";
import { getEnv } from "@/lib/env";

export type LoginState = { error?: string };

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(256),
  mfaCode: z.string().trim().regex(/^\d{6}$/).or(z.literal("")),
});

export async function loginAction(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    mfaCode: formData.get("mfaCode") ?? "",
  });
  if (!parsed.success) return { error: "请输入有效的邮箱、密码和 6 位验证码。" };

  const headerStore = await headers();
  const forwarded = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim();
  const result = await authenticateWithPassword({
    ...parsed.data,
    ip: forwarded || headerStore.get("x-real-ip") || "local",
    userAgent: headerStore.get("user-agent") || "unknown",
  });

  if (!result.ok) {
    if (result.reason === "rate_limited") return { error: "尝试次数过多，请 15 分钟后再试。" };
    if (result.reason === "mfa_required") return { error: "请输入验证器中的 6 位数字。" };
    if (result.reason === "mfa_not_enrolled") return { error: "此账号尚未开通双重验证，请联系管理员。" };
    return { error: "邮箱、密码或验证码不正确。" };
  }

  const env = getEnv();
  const cookieStore = await cookies();
  cookieStore.set(env.SESSION_COOKIE_NAME, result.token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: result.absoluteExpiresAt,
    priority: "high",
  });
  redirect("/operations");
}
