/**
 * Phase 2B — telephony configuration (server only).
 *
 * Secrets are read inside handlers, never at module scope, and never returned
 * to any caller. With TELEPHONY_PROVIDER=NONE the application boots and all
 * tests run without any Twilio credential.
 */
import type { TelephonyProviderId } from "@/lib/telephony/provider";

export interface TelephonyConfig {
  provider: TelephonyProviderId;
  accountSid?: string;
  authToken?: string;
  webhookBaseUrl?: string;
}

export class TelephonyConfigError extends Error {}

export function readTelephonyConfig(env: Record<string, string | undefined> = process.env): TelephonyConfig {
  const raw = (env["TELEPHONY_PROVIDER"] ?? "NONE").toUpperCase();
  const provider: TelephonyProviderId = raw === "TWILIO" ? "TWILIO" : raw === "SIP" ? "SIP" : "NONE";

  const config: TelephonyConfig = { provider };
  const sid = env["TWILIO_ACCOUNT_SID"];
  const token = env["TWILIO_AUTH_TOKEN"];
  const base = env["TWILIO_WEBHOOK_BASE_URL"];
  if (sid) config.accountSid = sid;
  if (token) config.authToken = token;
  if (base) config.webhookBaseUrl = base;

  if (provider === "TWILIO") {
    const missing = [
      ...(sid ? [] : ["TWILIO_ACCOUNT_SID"]),
      ...(token ? [] : ["TWILIO_AUTH_TOKEN"]),
      ...(base ? [] : ["TWILIO_WEBHOOK_BASE_URL"]),
    ];
    if (missing.length) {
      // Names only. The value of a secret is never included in an error.
      throw new TelephonyConfigError(`Telephony provider TWILIO is selected but not configured: ${missing.join(", ")}`);
    }
  }
  return config;
}
