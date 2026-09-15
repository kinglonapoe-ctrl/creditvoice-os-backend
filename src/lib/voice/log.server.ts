/**
 * Phase 2B — structured voice logging with hard redaction.
 *
 * Raw provider request bodies are never logged. Only the allow-listed fields
 * below can ever reach a log line, so digits, PINs, access codes, signatures
 * and tokens cannot leak through logging middleware.
 */
export interface VoiceLogFields {
  request_id?: string;
  call_sid?: string;
  session_id?: string | null;
  tenant_id?: string | null;
  event_type?: string;
  ivr_state?: string;
  result?: string;
  duration_ms?: number;
}

const ALLOWED: (keyof VoiceLogFields)[] = [
  "request_id",
  "call_sid",
  "session_id",
  "tenant_id",
  "event_type",
  "ivr_state",
  "result",
  "duration_ms",
];

export function voiceLog(fields: VoiceLogFields): void {
  const safe: Record<string, unknown> = { channel: "voice" };
  for (const key of ALLOWED) {
    const value = fields[key];
    if (value !== undefined && value !== null) safe[key] = value;
  }
  console.log(JSON.stringify(safe));
}
