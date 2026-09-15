/**
 * Phase 2A — authorized customer actions for an authenticated call.
 *
 * This is a thin bridge only. It performs no arithmetic, holds no balance and
 * duplicates no financial logic: money movement stays with the existing
 * post_credit / execute_transfer / reverse_transfer engine, and amount and
 * currency validation stay inside that engine.
 */
import { authorizeAction, endCallSession, getAuthenticatedSession } from "./call-session.server";
import type { AuthenticatedCallContext, CallAction } from "./types";

export const PERMITTED_CALL_ACTIONS: CallAction[] = [
  "CHECK_BALANCE",
  "VIEW_ACCOUNT",
  "TRANSFER_CREDIT",
  "END_SESSION",
];

export class CallActionDenied extends Error {
  constructor(public reason: string) {
    super("This action is not available.");
  }
}

/** Resolves the trusted context or refuses. Never accepts caller-supplied identity. */
export async function requireCallContext(
  sessionId: string,
  action: CallAction,
  targetAccountId?: string,
): Promise<AuthenticatedCallContext> {
  const result = await authorizeAction(sessionId, action, targetAccountId);
  if (!result.allowed || !result.context) throw new CallActionDenied(result.reason ?? "NOT_AUTHORIZED");
  return result.context;
}

/** Read-only account view for the authenticated caller's own account. */
export async function getCallAccountSummary(sessionId: string) {
  const ctx = await requireCallContext(sessionId, "CHECK_BALANCE");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("customer_accounts")
    .select("balance, credit_limit, currency_code, status")
    .eq("id", ctx.accountId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (!data) throw new CallActionDenied("ACCOUNT_NOT_AVAILABLE");
  return {
    accountReference: ctx.accountReference,
    currencyCode: data.currency_code,
    balance: data.balance,
    creditLimit: data.credit_limit,
  };
}

export async function closeCall(sessionId: string, reason?: string) {
  await getAuthenticatedSession(sessionId).catch(() => null);
  await endCallSession(sessionId, reason ?? "CALLER_ENDED");
}
