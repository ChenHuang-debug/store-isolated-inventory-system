import { describe, expect, it } from "vitest";
import { createTotpCode, decodeBase32, encodeBase32, verifyTotpCode } from "../lib/auth/totp";

describe("双重验证", () => {
  it("符合公开的 TOTP 校验样例", () => {
    const secret = encodeBase32(Buffer.from("12345678901234567890", "ascii"));
    expect(createTotpCode(secret, 59_000)).toBe("287082");
    expect(decodeBase32(secret).toString("ascii")).toBe("12345678901234567890");
  });

  it("允许相邻半分钟并拒绝错误验证码", () => {
    const secret = encodeBase32(Buffer.from("inventory_demo-mfa-test-key", "utf8"));
    const now = 1_786_089_000_000;
    expect(verifyTotpCode(secret, createTotpCode(secret, now), now)).toBe(true);
    expect(verifyTotpCode(secret, createTotpCode(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotpCode(secret, "000000", now)).toBe(false);
    expect(verifyTotpCode(secret, "12345", now)).toBe(false);
  });
});
