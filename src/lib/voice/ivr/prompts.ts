/**
 * Phase 2B — voice prompts and safe customer-facing error messages.
 *
 * Prompts are short: one instruction at a time. Nothing here reveals whether
 * an organization, account or credential exists.
 */

export const PROMPTS = {
  welcome: "Welcome to CreditVoice.",
  accessCode: "Please enter your access code followed by the pound key.",
  accountNumber: "Please enter your account number followed by the pound key.",
  pin: "Please enter your PIN.",
  retry: "That was not accepted. Please try again.",
  noInput: "Sorry, I did not get that.",
  menu:
    "Press 1 for your balance. " +
    "Press 2 for account information. " +
    "Press 3 to transfer credit. " +
    "Press 0 for customer care. " +
    "Press 9 to end the call.",
  authenticated: "Authentication successful.",
  transferRecipient: "Please enter the recipient's account number followed by the pound key.",
  transferAmount: "Please enter the amount, then press the pound key.",
  transferConfirmSuffix: "Press 1 to confirm, or 2 to cancel.",
  transferCancelled: "That transfer was cancelled.",
  transferSuccess: "Your transfer was successful.",
  goodbye: "Thank you for calling. Goodbye.",
  voicemail: "Please leave a message after the tone, then hang up.",
  careConnecting: "Connecting you to customer care.",
} as const;

export type VoiceErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_TWILIO_SIGNATURE"
  | "REPLAY_DETECTED"
  | "TENANT_UNAVAILABLE"
  | "AUTHENTICATION_FAILED"
  | "ACCOUNT_UNAVAILABLE"
  | "RECIPIENT_UNAVAILABLE"
  | "CURRENCY_MISMATCH"
  | "PIN_LOCKED"
  | "SESSION_EXPIRED"
  | "ACTION_NOT_AUTHORIZED"
  | "INSUFFICIENT_CREDIT"
  | "TRANSFER_FAILED"
  | "INVALID_AMOUNT"
  | "TOO_MANY_DECIMALS"
  | "CUSTOMER_CARE_UNAVAILABLE"
  | "PROVIDER_ERROR"
  | "INTERNAL_ERROR";

const MESSAGES: Record<VoiceErrorCode, string> = {
  INVALID_REQUEST: "We're sorry. We're unable to complete your request right now. Please try again later.",
  INVALID_TWILIO_SIGNATURE: "We're sorry. We're unable to complete your request right now.",
  REPLAY_DETECTED: "We're sorry. We're unable to complete your request right now.",
  TENANT_UNAVAILABLE: "We're sorry. This number is not currently available. Please try again later.",
  AUTHENTICATION_FAILED: "We could not verify your details. Goodbye.",
  ACCOUNT_UNAVAILABLE: "That account is not available.",
  RECIPIENT_UNAVAILABLE: "That recipient account is not available.",
  CURRENCY_MISMATCH: "That transfer is not available.",
  PIN_LOCKED: "For security reasons your access has been locked. Please contact your organization.",
  SESSION_EXPIRED: "You have been disconnected for security reasons. Please call again.",
  ACTION_NOT_AUTHORIZED: "That option is not available.",
  INSUFFICIENT_CREDIT: "You do not have enough available credit to complete this transfer.",
  TRANSFER_FAILED: "We could not complete that transfer.",
  INVALID_AMOUNT: "That amount was not accepted.",
  TOO_MANY_DECIMALS: "That amount was not accepted.",
  CUSTOMER_CARE_UNAVAILABLE: "Customer care is not available right now.",
  PROVIDER_ERROR: "We're sorry. We're unable to complete your request right now. Please try again later.",
  INTERNAL_ERROR: "We're sorry. We're unable to complete your request right now. Please try again later.",
};

export function voiceMessage(code: VoiceErrorCode): string {
  return MESSAGES[code] ?? MESSAGES.INTERNAL_ERROR;
}
