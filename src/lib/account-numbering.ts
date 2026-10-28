/**
 * Mirrors the database rule `account_number_matches_rules`. The database stays
 * authoritative; this only gives early feedback in forms and the phone menu.
 */
export interface NumberingRules {
  mode: "MANUAL" | "AUTOMATIC";
  min_length: number;
  max_length: number;
  pad_length?: number | null;
}

export const LEGACY_RULES: NumberingRules = { mode: "AUTOMATIC", min_length: 1, max_length: 20 };

export function accountNumberMatches(value: string, rules: Pick<NumberingRules, "min_length" | "max_length">): boolean {
  return /^[0-9]+$/.test(value) && value.length >= rules.min_length && value.length <= rules.max_length;
}

export function validateRules(input: { mode: string; min_length: number; max_length: number; pad_length?: number | null }): string | null {
  if (input.mode !== "MANUAL" && input.mode !== "AUTOMATIC") return "Choose manual or automatic numbering.";
  const { min_length: min, max_length: max, pad_length: pad } = input;
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max > 20 || min > max) {
    return "Lengths must be whole numbers with 1 ≤ minimum ≤ maximum ≤ 20.";
  }
  if (pad != null && (!Number.isInteger(pad) || pad < min || pad > max)) {
    return "Zero-padding length must be between the minimum and maximum.";
  }
  return null;
}

/** Tenant maximum account-number length for phone entry, clamped to the IVR's 20-digit ceiling. */
export function accountDigitLimit(config: { account_number_max_length?: number | null }): number {
  const n = Number(config.account_number_max_length);
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : 20;
}
