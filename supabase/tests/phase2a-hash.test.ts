/**
 * Credential hashing proof for the voice authentication layer.
 * Run with: bun test supabase/tests/phase2a-hash.test.ts
 */
import { expect, test } from "bun:test";

import { generateNumericCode, hashSecret, verifySecret } from "../../src/lib/secure-hash.server";

test("a stored credential never contains the plaintext", async () => {
  const stored = await hashSecret("481902");
  expect(stored).not.toContain("481902");
  expect(stored.startsWith("pbkdf2$150000$")).toBe(true);
});

test("the correct credential verifies", async () => {
  const stored = await hashSecret("481902");
  expect(await verifySecret("481902", stored)).toBe(true);
});

test("an incorrect credential does not verify", async () => {
  const stored = await hashSecret("481902");
  expect(await verifySecret("481903", stored)).toBe(false);
  expect(await verifySecret("", stored)).toBe(false);
});

test("the same credential hashes differently each time (per-secret salt)", async () => {
  expect(await hashSecret("1234")).not.toBe(await hashSecret("1234"));
});

test("issued codes are numeric and of the requested length", () => {
  const code = generateNumericCode(8);
  expect(code).toMatch(/^\d{8}$/);
});
