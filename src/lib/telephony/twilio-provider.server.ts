/**
 * Phase 2B — Twilio implementation of the existing TelephonyProvider contract.
 *
 * Twilio Programmable Voice is webhook driven: the platform does not "push"
 * speech at a call, it answers each HTTP callback with TwiML. This adapter
 * therefore accumulates provider instructions into a TwiML document for the
 * request currently being answered, and that document is returned by the
 * webhook route.
 *
 * Nothing here makes an authentication, authorization or financial decision,
 * and the credit engine never imports this module.
 */
import { DEFAULT_VOICE_STYLE, TwiMLResponse, type VoiceStyle } from "@/lib/voice/twiml/builder";

import {
  registerTelephonyProvider,
  type CallContext,
  type GatherOptions,
  type TelephonyProvider,
  type TelephonyProviderId,
} from "./provider";

interface TurnState {
  doc: TwiMLResponse;
  /** Digits Twilio delivered with the callback currently being answered. */
  inboundDigits: string;
  actionUrl: string;
}

export class TwilioVoiceProvider implements TelephonyProvider {
  readonly id: TelephonyProviderId = "TWILIO";
  private turns = new Map<string, TurnState>();

  /** Opens the document for the callback being answered. */
  beginTurn(callId: string, options: { style?: VoiceStyle; inboundDigits?: string; actionUrl?: string } = {}) {
    this.turns.set(callId, {
      doc: new TwiMLResponse(options.style ?? DEFAULT_VOICE_STYLE),
      inboundDigits: options.inboundDigits ?? "",
      actionUrl: options.actionUrl ?? "",
    });
  }

  /** Renders and closes the document for this callback. */
  endTurn(callId: string): string {
    const turn = this.require(callId);
    const xml = turn.doc.toXml();
    this.turns.delete(callId);
    return xml;
  }

  document(callId: string): TwiMLResponse {
    return this.require(callId).doc;
  }

  private require(callId: string): TurnState {
    const turn = this.turns.get(callId);
    if (!turn) throw new Error("No active Twilio turn for this call.");
    return turn;
  }

  async answerCall(ctx: CallContext): Promise<void> {
    // Twilio has already answered by the time the webhook fires; the document
    // opened for this turn is the answer.
    if (!this.turns.has(ctx.callId)) this.beginTurn(ctx.callId);
  }

  async speak(ctx: CallContext, text: string): Promise<void> {
    this.require(ctx.callId).doc.say(text);
  }

  /**
   * Appends the gather and returns the digits Twilio delivered with the
   * current callback ("" on the first turn). Digits for this prompt arrive on
   * the next callback, which is how Twilio's model works.
   */
  async gatherDigits(ctx: CallContext, options: GatherOptions): Promise<string> {
    const turn = this.require(ctx.callId);
    turn.doc.gather({
      action: turn.actionUrl,
      prompt: options.prompt,
      numDigits: options.numDigits,
      timeoutSeconds: options.timeoutSeconds ?? 6,
    });
    return turn.inboundDigits;
  }

  async transferCall(ctx: CallContext, destination: string): Promise<void> {
    this.require(ctx.callId).doc.dial(destination, { callerId: ctx.toNumber });
  }

  async hangup(ctx: CallContext): Promise<void> {
    this.require(ctx.callId).doc.hangup();
  }
}

let registered: TwilioVoiceProvider | undefined;

/** Registers the adapter once, so selection stays driven by configuration. */
export function ensureTwilioProviderRegistered(): TwilioVoiceProvider {
  if (!registered) {
    registered = new TwilioVoiceProvider();
    registerTelephonyProvider(registered);
  }
  return registered;
}
