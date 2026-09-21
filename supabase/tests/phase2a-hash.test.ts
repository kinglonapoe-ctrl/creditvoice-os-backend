/**
 * Credential hashing proof for the voice authentication layer.
 * Run with: bun test supabase/tests/phase2a-hash.test.ts
 */
import { expect, test } from "bun:test";

import {
  MAX_SUPPORTED_ITERATIONS,
  generateNumericCode,
  hashSecret,
  verifySecret,
} from "../../src/lib/secure-hash.server";

test("a stored credential never contains the plaintext", async () => {
  const stored = await hashSecret("481902");
  expect(stored).not.toContain("481902");
  expect(stored.startsWith(`pbkdf2$${MAX_SUPPORTED_ITERATIONS}$`)).toBe(true);
});

// Regression: workerd rejects PBKDF2 above 100,000 iterations with
// NotSupportedError, which took down live access-code verification.
test("issued hashes stay within the edge runtime iteration limit", async () => {
  const stored = await hashSecret("481902");
  expect(Number(stored.split("$")[1])).toBeLessThanOrEqual(100_000);
});

test("a hash above the runtime limit fails loudly instead of silently denying", async () => {
  const stored = await hashSecret("481902");
  const parts = stored.split("$");
  const unverifiable = `pbkdf2$150000$${parts[2]}$${parts[3]}`;
  expect(verifySecret("481902", unverifiable)).rejects.toThrow(/runtime limit/);
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
