/**
 * Phase 2B — DTMF amount parsing.
 *
 * No floating point is used anywhere. Digits are converted to an integer
 * number of minor units (BigInt) and handed to the database, which divides by
 * the currency's decimal places using exact numeric arithmetic.
 *
 * Input grammar: digits, optionally one `*` acting as the decimal separator.
 *   "5000"    -> 5000.00 (2dp)
 *   "50*25"   -> 50.25
 *   "50*255"  -> rejected when the currency allows 2 decimals
 */

export type AmountError =
  | "EMPTY"
  | "NON_NUMERIC"
  | "TOO_MANY_DECIMALS"
  | "NOT_POSITIVE"
  | "TOO_LARGE";

export interface ParsedAmount {
  minorUnits: bigint;
  /** Display form, e.g. "50.25". Built by string assembly, not arithmetic. */
  display: string;
}

const MAX_MINOR_UNITS = 10n ** 15n;

export function parseDtmfAmount(
  raw: string,
  decimalPlaces: number,
): { ok: true; value: ParsedAmount } | { ok: false; error: AmountError } {
  const input = (raw ?? "").trim();
  if (!input) return { ok: false, error: "EMPTY" };
  if (!/^[0-9]*\*?[0-9]*$/.test(input)) return { ok: false, error: "NON_NUMERIC" };

  const [wholeRaw = "", fractionRaw = ""] = input.split("*");
  if (!wholeRaw && !fractionRaw) return { ok: false, error: "NON_NUMERIC" };
  if (fractionRaw.length > decimalPlaces) return { ok: false, error: "TOO_MANY_DECIMALS" };

  const whole = wholeRaw === "" ? "0" : wholeRaw;
  const fraction = fractionRaw.padEnd(decimalPlaces, "0");
  const minorUnits = BigInt(whole + fraction);

  if (minorUnits <= 0n) return { ok: false, error: "NOT_POSITIVE" };
  if (minorUnits >= MAX_MINOR_UNITS) return { ok: false, error: "TOO_LARGE" };

  // Normalized display: strip leading zeros from the whole part only.
  const normalizedWhole = String(BigInt(whole));
  const display = decimalPlaces > 0 ? `${normalizedWhole}.${fraction}` : normalizedWhole;
  return { ok: true, value: { minorUnits, display } };
}

/** Spoken form, e.g. "50.25 naira" -> "50 point 2 5 naira" is avoided; keep it plain. */
export function spokenAmount(display: string, currencyCode: string): string {
  return `${display} ${currencyCode}`;
}
