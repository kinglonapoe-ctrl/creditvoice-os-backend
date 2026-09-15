/**
 * Phase 2B — Twilio webhook handler (server only).
 *
 * Security boundary for this public channel:
 *   1. Twilio request signature (first operation, before anything else)
 *   2. Phase 2A provider-event replay protection
 *   3. Phase 2A credential throttling, lockout and session rules
 *
 * No Supabase user session exists here and none is trusted. No identity is
 * ever taken from the request body: the organization is resolved from the
 * dialled number, the customer from the authenticated call session.
 */
import { readTelephonyConfig } from "@/lib/voice/config.server";
import { handleVoiceTurn } from "@/lib/voice/ivr/engine.server";
import { voiceLog } from "@/lib/voice/log.server";
import { voiceMessage } from "@/lib/voice/ivr/prompts";
import { canonicalWebhookUrl, verifyTwilioSignature } from "@/lib/voice/twilio-signature.server";
import { sayAndHangup, TWIML_CONTENT_TYPE } from "@/lib/voice/twiml/builder";

const MAX_BODY_BYTES = 64 * 1024;
export const WEBHOOK_PATH = "/api/public/voice/twilio";

function twiml(xml: string, status = 200): Response {
  return new Response(xml, { status, headers: { "content-type": TWIML_CONTENT_TYPE } });
}

export async function handleTwilioWebhook(request: Request): Promise<Response> {
  const started = Date.now();

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
  }

  let authToken: string | undefined;
  let baseUrl: string | undefined;
  try {
    const config = readTelephonyConfig();
    authToken = config.authToken;
    baseUrl = config.webhookBaseUrl;
  } catch {
    // Configuration problems are never described to the caller.
    return new Response("Forbidden", { status: 403 });
  }
  if (!authToken || !baseUrl) return new Response("Forbidden", { status: 403 });

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return new Response("Bad Request", { status: 400 });

  let params: Record<string, string>;
  try {
    params = Object.fromEntries(new URLSearchParams(raw).entries());
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // ---- 1. signature, before any database work -------------------------
  const url = canonicalWebhookUrl(baseUrl, request.url);
  const valid = await verifyTwilioSignature({
    authToken,
    url,
    params,
    signature: request.headers.get("x-twilio-signature"),
  });
  if (!valid) {
    voiceLog({ event_type: "TWILIO_SIGNATURE_REJECTED", result: "403" });
    return new Response("Forbidden", { status: 403 });
  }

  // ---- 2. request shape ------------------------------------------------
  const callSid = params["CallSid"] ?? "";
  const to = params["To"] ?? params["Called"] ?? "";
  const from = params["From"] ?? params["Caller"] ?? "";
  if (!callSid || !to) return new Response("Bad Request", { status: 400 });

  const step = new URL(request.url).searchParams.get("step") ?? "start";
  const digits = params["Digits"] ?? "";

  try {
    const xml = await handleVoiceTurn({
      callSid,
      from,
      to,
      digits,
      step,
      basePath: WEBHOOK_PATH,
      provider: "TWILIO",
    });
    voiceLog({
      call_sid: callSid,
      event_type: "TWILIO_CALL_RECEIVED",
      ivr_state: step,
      result: "OK",
      duration_ms: Date.now() - started,
    });
    return twiml(xml);
  } catch (error) {
    // Never return a stack trace, a database message or a secret.
    console.error("[voice] unhandled webhook failure", (error as Error)?.name ?? "Error");
    voiceLog({ call_sid: callSid, event_type: "CALL_FAILED", result: "INTERNAL_ERROR" });
    return twiml(sayAndHangup(voiceMessage("INTERNAL_ERROR")), 500);
  }
}
