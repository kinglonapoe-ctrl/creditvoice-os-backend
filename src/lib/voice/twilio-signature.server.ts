/**
 * Phase 2B — Twilio request signature verification (server only).
 *
 * Twilio signs: base64( HMAC-SHA1( authToken, url + concat(sortedKey + value) ) )
 * where `url` is the exact URL Twilio was configured to call, including any
 * query string, and the parameters are the POST form fields.
 *
 * The URL is rebuilt from a configured canonical base, never from a
 * client-supplied Host header.
 */

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): Promise<string> {
  const payload =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

export async function verifyTwilioSignature(input: {
  authToken: string;
  url: string;
  params: Record<string, string>;
  signature: string | null;
}): Promise<boolean> {
  if (!input.signature || !input.authToken) return false;
  const expected = await computeTwilioSignature(input.authToken, input.url, input.params);
  return timingSafeEqual(expected, input.signature);
}

/**
 * The canonical URL Twilio signed against. Built from the configured public
 * base URL plus the request path and query — never from the Host header.
 */
export function canonicalWebhookUrl(baseUrl: string, requestUrl: string): string {
  const incoming = new URL(requestUrl);
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}${incoming.pathname}${incoming.search}`;
}
