/**
 * Server-only hashing for organization access codes and customer PINs.
 * Plaintext values are never stored or logged.
 */
const ITERATIONS = 150_000;

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return `pbkdf2$${ITERATIONS}$${toHex(salt.buffer)}$${toHex(bits)}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [scheme, iterations, saltHex, hashHex] = stored.split("$");
  if (scheme !== "pbkdf2" || !saltHex || !hashHex) return false;
  const salt = new Uint8Array((saltHex.match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: Number(iterations), hash: "SHA-256" },
    key,
    256,
  );
  return toHex(bits) === hashHex;
}

export function generateNumericCode(length = 8): string {
  const digits = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(digits)
    .map((d) => (d % 10).toString())
    .join("");
}
