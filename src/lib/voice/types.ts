/**
 * Phase 2A — secure voice authentication types.
 *
 * Provider neutral: nothing here knows about Twilio, SIP or any carrier.
 * Provider specific data belongs in the adapter that will be built in Phase 2B.
 */

export type CallSessionState =
  | "NEW"
  | "TENANT_RESOLVED"
  | "ACCESS_CODE_VERIFIED"
  | "ACCOUNT_IDENTIFIED"
  | "PIN_VERIFIED"
  | "AUTHENTICATED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "LOCKED"
  | "EXPIRED"
  | "ENDED";

export type CallAuthStage =
  | "TENANT_RESOLUTION"
  | "ACCESS_CODE"
  | "ACCOUNT_IDENTIFICATION"
  | "PIN"
  | "AUTHENTICATED"
  | "CLOSED";

export type CallAction = "CHECK_BALANCE" | "VIEW_ACCOUNT" | "TRANSFER_CREDIT" | "END_SESSION";

/** Single external outcome vocabulary. Never reveals *why* a credential failed. */
export type CallStepOutcome =
  | { ok: true; status: CallSessionState }
  | { ok: false; status: "REJECTED" | "LOCKED" | "FAILED" | "EXPIRED" | "ENDED" | "UNAVAILABLE" };

/**
 * The only identity object the rest of the system may trust. Every field is
 * derived server-side from the authenticated session — never from the caller.
 * It deliberately carries no credential material of any kind.
 */
export interface AuthenticatedCallContext {
  sessionId: string;
  tenantId: string;
  customerId: string;
  accountId: string;
  currencyCode: string;
  /** Last four digits only — for spoken confirmation. */
  accountReference: string;
  authenticatedAt: string;
}

export const GENERIC_AUTH_FAILURE = "Authentication failed.";
