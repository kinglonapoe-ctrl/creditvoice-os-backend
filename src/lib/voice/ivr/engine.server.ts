/**
 * Phase 2B — deterministic IVR engine (server only).
 *
 * The engine orchestrates the conversation and nothing else:
 *  - every credential decision is made by the Phase 2A services
 *  - every identity comes from the Phase 2A session, never from the caller
 *  - every money movement goes through the existing financial engine
 *
 * It holds no second authentication state: the authoritative call state is the
 * Phase 2A `call_sessions` row.
 */
import {
  claimProviderEvent,
  createCallSession,
  endCallSession,
  identifyAccount,
  resolveTenant,
  verifyCustomerPin,
  verifyTenantAccessCode,
} from "@/lib/voice/call-session.server";
import { getCallAccountSummary, requireCallContext } from "@/lib/voice/actions.server";
import { voiceRpc } from "@/lib/voice/db.server";
import { parseDtmfAmount } from "@/lib/voice/money";
import { PROMPTS, voiceMessage, type VoiceErrorCode } from "./prompts";
import { DEFAULT_VOICE_STYLE, TwiMLResponse, type VoiceStyle } from "@/lib/voice/twiml/builder";

export const PROVIDER = "TWILIO";

export type IvrState =
  | "WELCOME"
  | "ACCESS_CODE"
  | "ACCOUNT_NUMBER"
  | "PIN"
  | "MENU"
  | "TRANSFER_RECIPIENT"
  | "TRANSFER_AMOUNT"
  | "TRANSFER_CONFIRM"
  | "VOICEMAIL"
  | "ENDED";

export interface VoiceTurnInput {
  callSid: string;
  from: string;
  to: string;
  digits: string;
  step: string;
  basePath: string;
  provider?: string;
}

interface IvrSnapshot {
  session_id: string;
  state: string;
  ivr_state: string;
  ivr_retries: number;
  tenant_id: string | null;
  account_id: string | null;
  pending_amount: string | number | null;
  pending_transfer_key: string | null;
  pending_recipient_input: string | null;
}

interface IvrConfig {
  organization_name: string;
  currency_code: string;
  language: string;
  voice: string;
  max_input_retries: number;
  gather_timeout_seconds: number;
  welcome_message: string | null;
  menu_message: string | null;
  transfers_enabled: boolean;
  balance_enquiry_enabled: boolean;
  recording_enabled: boolean;
}

const FALLBACK_CONFIG: IvrConfig = {
  organization_name: "CreditVoice",
  currency_code: "",
  language: "en-US",
  voice: "alice",
  max_input_retries: 3,
  gather_timeout_seconds: 6,
  welcome_message: null,
  menu_message: null,
  transfers_enabled: true,
  balance_enquiry_enabled: true,
  recording_enabled: false,
};

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function styleOf(config: IvrConfig): VoiceStyle {
  return { voice: config.voice || DEFAULT_VOICE_STYLE.voice, language: config.language || DEFAULT_VOICE_STYLE.language };
}

function action(basePath: string, step: string): string {
  return `${basePath}?step=${encodeURIComponent(step)}`;
}

async function loadConfig(tenantId: string | null): Promise<IvrConfig> {
  if (!tenantId) return FALLBACK_CONFIG;
  try {
    const data = await voiceRpc<IvrConfig>("cv_ivr_config", { _tenant_id: tenantId });
    return { ...FALLBACK_CONFIG, ...(data ?? {}) };
  } catch {
    return FALLBACK_CONFIG;
  }
}

async function setState(sessionId: string, state: IvrState, retries = 0) {
  await voiceRpc("cv_ivr_set_state", { _session_id: sessionId, _ivr_state: state, _retries: retries });
}

function terminal(message: string, config: IvrConfig): string {
  return new TwiMLResponse(styleOf(config)).say(message).hangup().toXml();
}

function promptFor(state: IvrState, input: VoiceTurnInput, config: IvrConfig, lead?: string): string {
  const doc = new TwiMLResponse(styleOf(config));
  if (lead) doc.say(lead);
  const timeout = config.gather_timeout_seconds;

  switch (state) {
    case "ACCESS_CODE":
      doc.gather({
        action: action(input.basePath, "access_code"),
        prompt: config.welcome_message?.trim() || PROMPTS.accessCode,
        finishOnKey: "#",
        numDigits: 16,
        timeoutSeconds: timeout,
      });
      break;
    case "ACCOUNT_NUMBER":
      doc.gather({
        action: action(input.basePath, "account"),
        prompt: PROMPTS.accountNumber,
        finishOnKey: "#",
        numDigits: 20,
        timeoutSeconds: timeout,
      });
      break;
    case "PIN":
      doc.gather({
        action: action(input.basePath, "pin"),
        prompt: PROMPTS.pin,
        numDigits: 4,
        timeoutSeconds: timeout,
      });
      break;
    case "MENU":
      doc.gather({
        action: action(input.basePath, "menu"),
        prompt: config.menu_message?.trim() || PROMPTS.menu,
        numDigits: 1,
        timeoutSeconds: timeout,
      });
      break;
    case "TRANSFER_RECIPIENT":
      doc.gather({
        action: action(input.basePath, "transfer_recipient"),
        prompt: PROMPTS.transferRecipient,
        finishOnKey: "#",
        numDigits: 20,
        timeoutSeconds: timeout,
      });
      break;
    case "TRANSFER_AMOUNT":
      doc.gather({
        action: action(input.basePath, "transfer_amount"),
        prompt: PROMPTS.transferAmount,
        finishOnKey: "#",
        numDigits: 16,
        timeoutSeconds: timeout,
      });
      break;
    case "TRANSFER_CONFIRM":
      doc.gather({
        action: action(input.basePath, "transfer_confirm"),
        prompt: PROMPTS.transferConfirmSuffix,
        numDigits: 1,
        timeoutSeconds: timeout,
      });
      break;
    default:
      doc.say(PROMPTS.goodbye).hangup();
  }
  return doc.toXml();
}

async function fail(sessionId: string | null, code: VoiceErrorCode, config: IvrConfig): Promise<string> {
  if (sessionId) {
    await setState(sessionId, "ENDED").catch(() => undefined);
    await endCallSession(sessionId, code).catch(() => undefined);
  }
  return terminal(voiceMessage(code), config);
}

/** Retry the same step, or end the call once the configured allowance is spent. */
async function retryOrEnd(
  snapshot: IvrSnapshot,
  state: IvrState,
  input: VoiceTurnInput,
  config: IvrConfig,
  code: VoiceErrorCode,
): Promise<string> {
  const retries = (snapshot.ivr_retries ?? 0) + 1;
  if (retries >= config.max_input_retries) {
    return fail(snapshot.session_id, code, config);
  }
  await setState(snapshot.session_id, state, retries);
  return promptFor(state, input, config, PROMPTS.retry);
}

async function renderMenu(sessionId: string, input: VoiceTurnInput, config: IvrConfig, lead?: string) {
  await setState(sessionId, "MENU");
  return promptFor("MENU", input, config, lead);
}

/**
 * Answers one Twilio callback. The caller (the webhook route) has already
 * verified the provider signature.
 */
export async function handleVoiceTurn(input: VoiceTurnInput): Promise<string> {
  const provider = input.provider ?? PROVIDER;

  // ---- locate or open the call session -------------------------------
  let sessionId = await voiceRpc<string | null>("cv_find_call_session", {
    _provider: provider,
    _provider_call_id: input.callSid,
  });

  if (!sessionId) {
    const created = await createCallSession({
      fromNumber: input.from,
      toNumber: input.to,
      provider,
      providerCallId: input.callSid,
      providerEventId: `${input.callSid}:start`,
    });
    sessionId = created.sessionId;

    const resolved = await resolveTenant(sessionId);
    const snapshot0 = await voiceRpc<IvrSnapshot>("cv_ivr_state", { _session_id: sessionId });
    const cfg0 = await loadConfig(snapshot0.tenant_id);

    if (!resolved.ok) {
      await voiceRpc("cv_audit", {
        _tenant_id: null,
        _event: "TWILIO_CALL_RECEIVED",
        _entity_id: sessionId,
        _metadata: { result: "TENANT_UNAVAILABLE" },
      }).catch(() => undefined);
      return fail(sessionId, resolved.status === "LOCKED" ? "TENANT_UNAVAILABLE" : "TENANT_UNAVAILABLE", cfg0);
    }

    const snapshot = await voiceRpc<IvrSnapshot>("cv_ivr_state", { _session_id: sessionId });
    const config = await loadConfig(snapshot.tenant_id);
    await voiceRpc("cv_audit", {
      _tenant_id: snapshot.tenant_id,
      _event: "IVR_STARTED",
      _entity_id: sessionId,
      _metadata: { provider },
    }).catch(() => undefined);
    await setState(sessionId, "ACCESS_CODE");
    return promptFor("ACCESS_CODE", input, config, PROMPTS.welcome);
  }

  // ---- load current position -----------------------------------------
  let snapshot: IvrSnapshot;
  try {
    snapshot = await voiceRpc<IvrSnapshot>("cv_ivr_state", { _session_id: sessionId });
  } catch {
    return terminal(voiceMessage("SESSION_EXPIRED"), FALLBACK_CONFIG);
  }
  const config = await loadConfig(snapshot.tenant_id);

  if (["EXPIRED", "ENDED", "FAILED", "LOCKED", "COMPLETED"].includes(snapshot.state)) {
    const code: VoiceErrorCode = snapshot.state === "LOCKED" ? "PIN_LOCKED" : "SESSION_EXPIRED";
    return terminal(voiceMessage(code), config);
  }

  const state = (snapshot.ivr_state || "ACCESS_CODE") as IvrState;
  const digits = (input.digits ?? "").trim();

  // ---- replay protection ----------------------------------------------
  const eventId = await sha256Hex(
    `${provider}|${input.callSid}|${state}|${snapshot.ivr_retries}|${digits}`,
  );
  const claimed = await claimProviderEvent({
    sessionId,
    provider,
    providerEventId: eventId,
    eventType: `IVR_${state}`,
    payload: { step: input.step },
  });
  if (!claimed) {
    // A duplicate callback re-renders the current prompt and changes nothing.
    return promptFor(state, input, config);
  }

  // ---- state machine ---------------------------------------------------
  switch (state) {
    case "ACCESS_CODE": {
      if (!digits) return retryOrEnd(snapshot, "ACCESS_CODE", input, config, "AUTHENTICATION_FAILED");
      const result = await verifyTenantAccessCode(sessionId, digits);
      if (!result.ok) {
        if (result.status === "LOCKED") return fail(sessionId, "PIN_LOCKED", config);
        return retryOrEnd(snapshot, "ACCESS_CODE", input, config, "AUTHENTICATION_FAILED");
      }
      await setState(sessionId, "ACCOUNT_NUMBER");
      return promptFor("ACCOUNT_NUMBER", input, config);
    }

    case "ACCOUNT_NUMBER": {
      if (!digits) return retryOrEnd(snapshot, "ACCOUNT_NUMBER", input, config, "AUTHENTICATION_FAILED");
      const result = await identifyAccount(sessionId, digits);
      if (!result.ok) {
        if (result.status === "LOCKED") return fail(sessionId, "PIN_LOCKED", config);
        return retryOrEnd(snapshot, "ACCOUNT_NUMBER", input, config, "AUTHENTICATION_FAILED");
      }
      await setState(sessionId, "PIN");
      return promptFor("PIN", input, config);
    }

    case "PIN": {
      if (!digits) return retryOrEnd(snapshot, "PIN", input, config, "AUTHENTICATION_FAILED");
      const result = await verifyCustomerPin(sessionId, digits);
      if (!result.ok) {
        if (result.status === "LOCKED") return fail(sessionId, "PIN_LOCKED", config);
        return retryOrEnd(snapshot, "PIN", input, config, "AUTHENTICATION_FAILED");
      }
      await voiceRpc("cv_audit", {
        _tenant_id: snapshot.tenant_id,
        _event: "IVR_MENU_SHOWN",
        _entity_id: sessionId,
        _metadata: {},
      }).catch(() => undefined);
      return renderMenu(sessionId, input, config, PROMPTS.authenticated);
    }

    case "MENU":
      return handleMenu(sessionId, snapshot, digits, input, config);

    case "TRANSFER_RECIPIENT": {
      if (!digits) return retryOrEnd(snapshot, "TRANSFER_RECIPIENT", input, config, "RECIPIENT_UNAVAILABLE");
      await voiceRpc("cv_ivr_set_state", {
        _session_id: sessionId,
        _ivr_state: "TRANSFER_AMOUNT",
        _retries: 0,
      });
      // The recipient is validated together with the amount, so an attacker
      // cannot use this step to probe which account numbers exist.
      await voiceRpc("cv_audit", {
        _tenant_id: snapshot.tenant_id,
        _event: "TRANSFER_REQUESTED",
        _entity_id: sessionId,
        _metadata: { stage: "RECIPIENT_ENTERED" },
      }).catch(() => undefined);
      await voiceRpc("cv_ivr_set_recipient", { _session_id: sessionId, _recipient: digits });
      return promptFor("TRANSFER_AMOUNT", input, config);
    }

    case "TRANSFER_AMOUNT":
      return handleAmount(sessionId, snapshot, digits, input, config);

    case "TRANSFER_CONFIRM":
      return handleConfirm(sessionId, snapshot, digits, input, config);

    default:
      return renderMenu(sessionId, input, config);
  }
}

async function handleMenu(
  sessionId: string,
  snapshot: IvrSnapshot,
  digits: string,
  input: VoiceTurnInput,
  config: IvrConfig,
): Promise<string> {
  switch (digits) {
    case "1": {
      if (!config.balance_enquiry_enabled) return renderMenu(sessionId, input, config, voiceMessage("ACTION_NOT_AUTHORIZED"));
      try {
        const summary = await getCallAccountSummary(sessionId);
        await voiceRpc("cv_audit", {
          _tenant_id: snapshot.tenant_id,
          _event: "BALANCE_ENQUIRY",
          _entity_id: sessionId,
          _metadata: {},
        }).catch(() => undefined);
        return renderMenu(
          sessionId,
          input,
          config,
          `Your available credit is ${summary.balance} ${summary.currencyCode}.`,
        );
      } catch {
        return renderMenu(sessionId, input, config, voiceMessage("ACCOUNT_UNAVAILABLE"));
      }
    }

    case "2": {
      try {
        const summary = await getCallAccountSummary(sessionId);
        await voiceRpc("cv_audit", {
          _tenant_id: snapshot.tenant_id,
          _event: "ACCOUNT_INFO_REQUESTED",
          _entity_id: sessionId,
          _metadata: {},
        }).catch(() => undefined);
        return renderMenu(
          sessionId,
          input,
          config,
          `Your account ending in ${summary.accountReference} is active. ` +
            `Available credit ${summary.balance} ${summary.currencyCode}. ` +
            `Credit limit ${summary.creditLimit} ${summary.currencyCode}.`,
        );
      } catch {
        return renderMenu(sessionId, input, config, voiceMessage("ACCOUNT_UNAVAILABLE"));
      }
    }

    case "3": {
      if (!config.transfers_enabled) {
        return renderMenu(sessionId, input, config, voiceMessage("ACTION_NOT_AUTHORIZED"));
      }
      try {
        await requireCallContext(sessionId, "TRANSFER_CREDIT");
      } catch {
        return fail(sessionId, "ACTION_NOT_AUTHORIZED", config);
      }
      await setState(sessionId, "TRANSFER_RECIPIENT");
      return promptFor("TRANSFER_RECIPIENT", input, config);
    }

    case "0":
      return handleCustomerCare(sessionId, snapshot, input, config);

    case "9": {
      await voiceRpc("cv_audit", {
        _tenant_id: snapshot.tenant_id,
        _event: "CALL_COMPLETED",
        _entity_id: sessionId,
        _metadata: {},
      }).catch(() => undefined);
      await setState(sessionId, "ENDED");
      await endCallSession(sessionId, "CALLER_ENDED").catch(() => undefined);
      return terminal(PROMPTS.goodbye, config);
    }

    default:
      return retryOrEnd(snapshot, "MENU", input, config, "ACTION_NOT_AUTHORIZED");
  }
}

async function handleAmount(
  sessionId: string,
  snapshot: IvrSnapshot,
  digits: string,
  input: VoiceTurnInput,
  config: IvrConfig,
): Promise<string> {
  const recipient = snapshot.pending_recipient_input;
  if (!recipient) {
    await setState(sessionId, "TRANSFER_RECIPIENT");
    return promptFor("TRANSFER_RECIPIENT", input, config);
  }

  const decimals = await currencyDecimals(config.currency_code);
  const parsed = parseDtmfAmount(digits, decimals);
  if (!parsed.ok) {
    return retryOrEnd(
      snapshot,
      "TRANSFER_AMOUNT",
      input,
      config,
      parsed.error === "TOO_MANY_DECIMALS" ? "TOO_MANY_DECIMALS" : "INVALID_AMOUNT",
    );
  }

  const prepared = await voiceRpc<{
    ok: boolean;
    reason?: string;
    amount?: number;
    currency_code?: string;
    recipient_reference?: string;
  }>("cv_prepare_transfer", {
    _session_id: sessionId,
    _recipient_account_number: recipient,
    _amount_minor: Number(parsed.value.minorUnits),
  });

  if (!prepared?.ok) {
    const reason = prepared?.reason;
    if (reason === "SESSION_EXPIRED") return fail(sessionId, "SESSION_EXPIRED", config);
    await voiceRpc("cv_cancel_transfer", { _session_id: sessionId }).catch(() => undefined);
    return renderMenu(sessionId, input, config, voiceMessage("RECIPIENT_UNAVAILABLE"));
  }

  await setState(sessionId, "TRANSFER_CONFIRM");
  return promptFor(
    "TRANSFER_CONFIRM",
    input,
    config,
    `You are transferring ${parsed.value.display} ${prepared.currency_code} to the account ending in ${prepared.recipient_reference}.`,
  );
}

async function handleConfirm(
  sessionId: string,
  snapshot: IvrSnapshot,
  digits: string,
  input: VoiceTurnInput,
  config: IvrConfig,
): Promise<string> {
  if (digits !== "1") {
    await voiceRpc("cv_cancel_transfer", { _session_id: sessionId }).catch(() => undefined);
    return renderMenu(sessionId, input, config, PROMPTS.transferCancelled);
  }

  // Deterministic per-transfer key: a provider retry resolves to the original
  // posting, two intentional transfers never share a key.
  const idempotencyKey = await sha256Hex(`${input.callSid}|${snapshot.pending_transfer_key ?? ""}`);

  const result = await voiceRpc<{ ok: boolean; reason?: string }>("cv_execute_voice_transfer", {
    _session_id: sessionId,
    _idempotency_key: idempotencyKey,
  });

  if (!result?.ok) {
    const reason = result?.reason;
    if (reason === "SESSION_EXPIRED") return fail(sessionId, "SESSION_EXPIRED", config);
    const code: VoiceErrorCode = reason === "INSUFFICIENT_CREDIT" ? "INSUFFICIENT_CREDIT" : "TRANSFER_FAILED";
    return renderMenu(sessionId, input, config, voiceMessage(code));
  }

  return renderMenu(sessionId, input, config, PROMPTS.transferSuccess);
}

async function handleCustomerCare(
  sessionId: string,
  snapshot: IvrSnapshot,
  input: VoiceTurnInput,
  config: IvrConfig,
): Promise<string> {
  const route = await voiceRpc<{
    available: boolean;
    action?: "DIAL" | "VOICEMAIL";
    destination?: string;
  }>("cv_customer_care_route", { _session_id: sessionId });

  await voiceRpc("cv_audit", {
    _tenant_id: snapshot.tenant_id,
    _event: "CUSTOMER_CARE_REQUESTED",
    _entity_id: sessionId,
    _metadata: { available: Boolean(route?.available), action: route?.action ?? null },
  }).catch(() => undefined);

  if (!route?.available) {
    return renderMenu(sessionId, input, config, voiceMessage("CUSTOMER_CARE_UNAVAILABLE"));
  }

  if (route.action === "VOICEMAIL") {
    await setState(sessionId, "VOICEMAIL");
    return new TwiMLResponse(styleOf(config))
      .say(PROMPTS.voicemail)
      .record({ action: action(input.basePath, "voicemail_done"), maxLengthSeconds: 120 })
      .hangup()
      .toXml();
  }

  await voiceRpc("cv_audit", {
    _tenant_id: snapshot.tenant_id,
    _event: "CALL_TRANSFERRED",
    _entity_id: sessionId,
    _metadata: {},
  }).catch(() => undefined);

  const { ensureTwilioProviderRegistered } = await import("@/lib/telephony/twilio-provider.server");
  const provider = ensureTwilioProviderRegistered();
  provider.beginTurn(input.callSid, { style: styleOf(config) });
  await provider.speak({ callId: input.callSid, fromNumber: input.from, toNumber: input.to }, PROMPTS.careConnecting);
  await provider.transferCall(
    { callId: input.callSid, fromNumber: input.from, toNumber: input.to },
    route.destination!,
  );
  await provider.hangup({ callId: input.callSid, fromNumber: input.from, toNumber: input.to });
  await setState(sessionId, "ENDED");
  return provider.endTurn(input.callSid);
}

async function currencyDecimals(code: string): Promise<number> {
  if (!code) return 2;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("currencies")
      .select("decimal_places")
      .eq("code", code)
      .maybeSingle();
    return data?.decimal_places ?? 2;
  } catch {
    return 2;
  }
}
