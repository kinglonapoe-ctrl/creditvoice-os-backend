import { PROMPTS } from "@/lib/voice/ivr/prompts";

/** Greeting selected only after the call's authenticated customer has been resolved. */
export function authenticatedGreetingLead(name: string | null | undefined, welcomeMessage?: string | null): string {
  const clean = (name ?? "").replace(/[<>&]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const welcome = (welcomeMessage ?? "").replace(/[<>&]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  const greeting = welcome || (clean ? `Welcome, ${clean}.` : "");
  return greeting ? `${greeting} ${PROMPTS.authenticated}` : PROMPTS.authenticated;
}

/** Exactly what a caller hears right after a correct PIN (mirrors the IVR engine). */
export function authenticatedGreetingScript(name: string | null | undefined, menuMessage?: string | null, welcomeMessage?: string | null): string {
  const lead = authenticatedGreetingLead(name, welcomeMessage);
  return `${lead} ${menuMessage?.trim() || PROMPTS.menu}`;
}

/** What a caller hears after pressing 3, when their customer record has transfer info (mirrors the IVR engine). */
export function transferNoticeScript(info: string | null | undefined): string | null {
  const text = (info ?? "").replace(/[<>&]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  return text ? `${text} ${PROMPTS.transferNoticeSuffix}` : null;
}
