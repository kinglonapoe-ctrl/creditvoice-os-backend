/**
 * Phase 2B — centralized TwiML generation.
 *
 * All voice XML is produced here. Route handlers and the IVR engine never
 * assemble XML strings themselves. Every value that reaches the document is
 * escaped: organization-configured prompts are data, never markup and never
 * code.
 */

export const TWIML_CONTENT_TYPE = "application/xml; charset=utf-8";

function escapeXml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // strip control characters that are illegal in XML
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function attrs(map: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(map)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`)
    .join("");
}

export interface VoiceStyle {
  voice: string;
  language: string;
}

export const DEFAULT_VOICE_STYLE: VoiceStyle = { voice: "alice", language: "en-US" };

export interface GatherOptions {
  action: string;
  numDigits?: number;
  finishOnKey?: string;
  timeoutSeconds?: number;
  prompt: string;
}

/** Small, safe TwiML document builder. */
export class TwiMLResponse {
  private parts: string[] = [];

  constructor(private style: VoiceStyle = DEFAULT_VOICE_STYLE) {}

  say(text: string): this {
    this.parts.push(
      `<Say${attrs({ voice: this.style.voice, language: this.style.language })}>${escapeXml(text)}</Say>`,
    );
    return this;
  }

  pause(seconds = 1): this {
    this.parts.push(`<Pause${attrs({ length: seconds })}/>`);
    return this;
  }

  gather(options: GatherOptions): this {
    const inner = `<Say${attrs({ voice: this.style.voice, language: this.style.language })}>${escapeXml(
      options.prompt,
    )}</Say>`;
    this.parts.push(
      `<Gather${attrs({
        input: "dtmf",
        action: options.action,
        method: "POST",
        numDigits: options.numDigits,
        finishOnKey: options.finishOnKey,
        timeout: options.timeoutSeconds ?? 6,
        actionOnEmptyResult: true,
      })}>${inner}</Gather>`,
    );
    return this;
  }

  dial(destination: string, options: { callerId?: string; timeoutSeconds?: number; action?: string } = {}): this {
    this.parts.push(
      `<Dial${attrs({
        callerId: options.callerId,
        timeout: options.timeoutSeconds ?? 25,
        action: options.action,
        method: options.action ? "POST" : undefined,
      })}>${escapeXml(destination)}</Dial>`,
    );
    return this;
  }

  record(options: { action: string; maxLengthSeconds?: number; playBeep?: boolean }): this {
    this.parts.push(
      `<Record${attrs({
        action: options.action,
        method: "POST",
        maxLength: options.maxLengthSeconds ?? 120,
        playBeep: options.playBeep ?? true,
        trim: "trim-silence",
      })}/>`,
    );
    return this;
  }

  redirect(url: string): this {
    this.parts.push(`<Redirect${attrs({ method: "POST" })}>${escapeXml(url)}</Redirect>`);
    return this;
  }

  hangup(): this {
    this.parts.push("<Hangup/>");
    return this;
  }

  toXml(): string {
    return `<?xml version="1.0" encoding="UTF-8"?><Response>${this.parts.join("")}</Response>`;
  }
}

/** A terminal response that says one line and hangs up. */
export function sayAndHangup(text: string, style: VoiceStyle = DEFAULT_VOICE_STYLE): string {
  return new TwiMLResponse(style).say(text).hangup().toXml();
}
