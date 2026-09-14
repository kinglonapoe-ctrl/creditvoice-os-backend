/**
 * Telephony abstraction.
 *
 * Phase 1 ships NO telephony implementation. This module only defines the
 * contract that a future provider (Twilio, SIP trunk, other carriers) must
 * satisfy, plus a registry so the credit engine never imports a provider
 * directly. Nothing here places, receives or simulates a call.
 */

export type TelephonyProviderId = "NONE" | "TWILIO" | "SIP";

export interface CallContext {
  callId: string;
  fromNumber: string;
  toNumber: string;
  tenantId?: string;
}

export interface GatherOptions {
  prompt: string;
  numDigits: number;
  timeoutSeconds?: number;
}

export interface TelephonyProvider {
  readonly id: TelephonyProviderId;
  answerCall(ctx: CallContext): Promise<void>;
  speak(ctx: CallContext, text: string): Promise<void>;
  gatherDigits(ctx: CallContext, options: GatherOptions): Promise<string>;
  transferCall(ctx: CallContext, destination: string): Promise<void>;
  hangup(ctx: CallContext): Promise<void>;
}

class NotConfiguredProvider implements TelephonyProvider {
  readonly id: TelephonyProviderId = "NONE";
  private fail(): never {
    throw new Error("No telephony provider is configured for this platform.");
  }
  async answerCall() {
    this.fail();
  }
  async speak() {
    this.fail();
  }
  async gatherDigits(): Promise<string> {
    this.fail();
  }
  async transferCall() {
    this.fail();
  }
  async hangup() {
    this.fail();
  }
}

const registry = new Map<TelephonyProviderId, TelephonyProvider>([
  ["NONE", new NotConfiguredProvider()],
]);

export function registerTelephonyProvider(provider: TelephonyProvider) {
  registry.set(provider.id, provider);
}

export function getTelephonyProvider(id: TelephonyProviderId = "NONE"): TelephonyProvider {
  return registry.get(id) ?? registry.get("NONE")!;
}

export const TELEPHONY_PROVIDERS: { id: TelephonyProviderId; name: string; status: string }[] = [
  { id: "NONE", name: "Not configured", status: "ACTIVE" },
  { id: "TWILIO", name: "Twilio Programmable Voice", status: "PLANNED" },
  { id: "SIP", name: "SIP Trunk", status: "PLANNED" },
];
