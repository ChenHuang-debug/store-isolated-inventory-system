import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encodeBase32(input: Buffer): string {
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

export function decodeBase32(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of normalized) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new Error("双重验证密钥格式无效");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function createTotpCode(secret: string, now = Date.now()): string {
  const counter = Math.floor(now / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const number = (
    ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  ) % 1_000_000;
  return number.toString().padStart(6, "0");
}

export function verifyTotpCode(secret: string, code: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const candidate = Buffer.from(code);
  for (const offset of [-30_000, 0, 30_000]) {
    const expected = Buffer.from(createTotpCode(secret, now + offset));
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return true;
  }
  return false;
}
