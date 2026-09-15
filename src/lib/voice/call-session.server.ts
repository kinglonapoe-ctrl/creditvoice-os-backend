/**
 * Phase 2A — Secure voice authentication and call session service (server only).
 *
 * Boundary rules enforced here:
 *  - the caller supplies only: numbers dialled, credentials, provider event ids
 *  - tenant, customer and account identity are always resolved from trusted
 *    database state keyed by the session id
 *  - credential hashes never leave this module; they are compared in memory and
 *    discarded, and never returned, logged or audited
 *  - every failure returns the same generic outcome to prevent enumeration
 *
 * No telephony provider is imported. The engine runs with provider "NONE".
 */
import { verifySecret } from "@/lib/secure-hash.server";

import type { AuthenticatedCallContext, CallAction, CallStepOutcome } from "./types";

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

async function admin(): Promise<Admin> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
  const db = await admin();
  const { data, error } = await (db as any).rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

function outcome(result: { ok?: boolean; status?: string } | null): CallStepOutcome {
  if (result?.ok) return { ok: true, status: (result.status ?? "NEW") as never };
  const status = result?.status;
  if (status === "LOCKED" || status === "EXPIRED" || status === "ENDED" || status === "FAILED") {
    return { ok: false, status };
  }
  if (status === "REJECTED") return { ok: false, status: "REJECTED" };
  return { ok: false, status: "UNAVAILABLE" };
}

export interface CreateCallSessionInput {
  fromNumber: string;
  toNumber: string;
  provider?: string;
  providerCallId?: string;
  providerEventId?: string;
}

/** Opens a call session. No identity is accepted from the caller. */
export async function createCallSession(input: CreateCallSessionInput): Promise<{ sessionId: string }> {
  const sessionId = await rpc<string>("cv_create_call_session", {
    _from_number: input.fromNumber,
    _to_number: input.toNumber,
    _provider: input.provider ?? "NONE",
    _provider_call_id: input.providerCallId ?? null,
    _provider_event_id: input.providerEventId ?? null,
  });
  return { sessionId };
}

/** Resolves the organization from the dialled number only. */
export async function resolveTenant(sessionId: string): Promise<CallStepOutcome> {
  return outcome(await rpc("cv_resolve_tenant", { _session_id: sessionId }));
}

/** Alias matching the specification wording. */
export const resolveTenantFromPhoneNumber = resolveTenant;

/**
 * Verifies the organization access code. The stored PBKDF2 hash is read by the
 * trusted server, compared in memory and discarded.
 */
export async function verifyTenantAccessCode(sessionId: string, code: string): Promise<CallStepOutcome> {
  const begun = await rpc<any>("cv_begin_access_code_attempt", { _session_id: sessionId });
  if (!begun?.ok) return outcome(begun);

  let verified = false;
  try {
    verified = typeof code === "string" && code.length > 0 && (await verifySecret(code, begun.code_hash));
  } finally {
    begun.code_hash = null;
  }

  return outcome(
    await rpc("cv_finish_access_code_attempt", {
      _session_id: sessionId,
      _code_id: begun.code_id,
      _verified: verified,
    }),
  );
}

/** Resolves an account strictly within the organization already bound to the session. */
export async function identifyAccount(sessionId: string, accountNumber: string): Promise<CallStepOutcome> {
  return outcome(
    await rpc("cv_identify_account", { _session_id: sessionId, _account_number: String(accountNumber ?? "") }),
  );
}

export const resolveCustomerAccount = identifyAccount;

/** Verifies the customer PIN. The PIN and its hash are never stored or logged. */
export async function verifyCustomerPin(sessionId: string, pin: string): Promise<CallStepOutcome> {
  const begun = await rpc<any>("cv_begin_pin_attempt", { _session_id: sessionId });
  if (!begun?.ok) return outcome(begun);

  let verified = false;
  try {
    verified = typeof pin === "string" && pin.length > 0 && (await verifySecret(pin, begun.pin_hash));
  } finally {
    begun.pin_hash = null;
  }

  return outcome(await rpc("cv_finish_pin_attempt", { _session_id: sessionId, _verified: verified }));
}

/** Returns the trusted identity for an authenticated, unexpired session. */
export async function getAuthenticatedSession(sessionId: string): Promise<AuthenticatedCallContext | null> {
  const data = await rpc<any>("cv_get_authenticated_session", { _session_id: sessionId });
  if (!data?.authenticated) return null;
  return {
    sessionId: data.session_id,
    tenantId: data.tenant_id,
    customerId: data.customer_id,
    accountId: data.account_id,
    currencyCode: data.currency_code,
    accountReference: data.account_reference,
    authenticatedAt: data.authenticated_at,
  };
}

/**
 * Answers "is this authenticated caller allowed to perform this action on this
 * account within this organization?". Session existence alone is never enough.
 */
export async function authorizeAction(
  sessionId: string,
  action: CallAction,
  targetAccountId?: string,
): Promise<{ allowed: boolean; reason?: string; context?: AuthenticatedCallContext }> {
  const data = await rpc<any>("cv_authorize_action", {
    _session_id: sessionId,
    _action: action,
    _target_account_id: targetAccountId ?? null,
  });
  if (!data?.allowed) return { allowed: false, reason: data?.reason ?? "NOT_AUTHORIZED" };
  const context = await getAuthenticatedSession(sessionId);
  return context ? { allowed: true, context } : { allowed: false, reason: "SESSION_NOT_AUTHENTICATED" };
}

export async function endCallSession(sessionId: string, reason?: string): Promise<void> {
  await rpc("cv_end_call_session", { _session_id: sessionId, _reason: reason ?? null });
}

/** Sweeps idle sessions. Correctness does not depend on this running. */
export async function expireCallSessions(): Promise<number> {
  return rpc<number>("cv_expire_call_sessions", {});
}

/**
 * Replay protection. Returns false when this provider event was already
 * processed, so the caller must not repeat the transition or any operation.
 */
export async function claimProviderEvent(input: {
  sessionId?: string;
  provider?: string;
  providerEventId: string;
  eventType: string;
  payload?: Record<string, unknown>;
}): Promise<boolean> {
  return rpc<boolean>("cv_claim_session_event", {
    _session_id: input.sessionId ?? null,
    _provider: input.provider ?? "NONE",
    _provider_event_id: input.providerEventId,
    _event_type: input.eventType,
    _payload: input.payload ?? {},
  });
}
