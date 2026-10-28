import { describe, expect, test } from "bun:test";
import { accountDigitLimit, accountNumberMatches, validateRules } from "../../src/lib/account-numbering";

describe("account number rules", () => {
  test("fixed length 6 accepts exactly 6 digits with leading zeros", () => {
    expect(accountNumberMatches("000123", { min_length: 6, max_length: 6 })).toBe(true);
    expect(accountNumberMatches("12345", { min_length: 6, max_length: 6 })).toBe(false);
    expect(accountNumberMatches("1234567", { min_length: 6, max_length: 6 })).toBe(false);
  });
  test("variable length 4..8", () => {
    expect(accountNumberMatches("1234", { min_length: 4, max_length: 8 })).toBe(true);
    expect(accountNumberMatches("12345678", { min_length: 4, max_length: 8 })).toBe(true);
    expect(accountNumberMatches("123", { min_length: 4, max_length: 8 })).toBe(false);
  });
  test("digits only", () => {
    expect(accountNumberMatches("12A45", { min_length: 1, max_length: 20 })).toBe(false);
  });
  test("settings validation", () => {
    expect(validateRules({ mode: "MANUAL", min_length: 5, max_length: 5 })).toBeNull();
    expect(validateRules({ mode: "MANUAL", min_length: 6, max_length: 5 })).not.toBeNull();
    expect(validateRules({ mode: "MANUAL", min_length: 1, max_length: 21 })).not.toBeNull();
    expect(validateRules({ mode: "AUTOMATIC", min_length: 4, max_length: 8, pad_length: 9 })).not.toBeNull();
    expect(validateRules({ mode: "OTHER", min_length: 4, max_length: 8 })).not.toBeNull();
  });
  test("IVR digit limit follows tenant max, clamped to 20", () => {
    expect(accountDigitLimit({ account_number_max_length: 6 })).toBe(6);
    expect(accountDigitLimit({ account_number_max_length: 99 })).toBe(20);
    expect(accountDigitLimit({})).toBe(20);
  });
});
