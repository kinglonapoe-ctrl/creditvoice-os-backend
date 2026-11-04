import { PROMPTS } from "@/lib/voice/ivr/prompts";

/** Exactly what a caller hears right after a correct PIN (mirrors the IVR engine). */
export function authenticatedGreetingScript(name: string | null | undefined, menuMessage?: string | null): string {
  const clean = (name ?? "").replace(/[<>&]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const lead = clean ? `Welcome, ${clean}. ${PROMPTS.authenticated}` : PROMPTS.authenticated;
  return `${lead} ${menuMessage?.trim() || PROMPTS.menu}`;
}
