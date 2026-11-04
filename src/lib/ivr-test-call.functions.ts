import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { authenticatedGreetingScript } from "@/lib/voice/test-call-script";
import { findVoice } from "@/lib/voice/voices";

/**
 * Org admin places a one-off outbound test call that only speaks the
 * post-authentication greeting and menu, then hangs up. No call session,
 * no credentials and no account data are involved.
 */
export const placeIvrTestCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { toPhone: string; name: string }) => {
    const toPhone = (input.toPhone ?? "").replace(/[\s()-]/g, "");
    if (!/^\+[1-9]\d{7,14}$/.test(toPhone)) throw new Error("Enter your phone in international format, e.g. +15551234567.");
    const name = String(input.name ?? "").slice(0, 80);
    return { toPhone, name };
  })
  .handler(async ({ data, context }) => {
    const { data: role } = await context.supabase
      .from("user_roles")
      .select("tenant_id")
      .eq("user_id", context.userId)
      .eq("role", "TENANT_ADMIN")
      .maybeSingle();
    const tenantId = role?.tenant_id as string | undefined;
    if (!tenantId) throw new Error("Organization administrator access required.");

    const [{ data: numbers }, { data: settings }] = await Promise.all([
      context.supabase.from("phone_numbers").select("phone_number").eq("tenant_id", tenantId).limit(1),
      context.supabase.from("ivr_settings").select("*").eq("tenant_id", tenantId).maybeSingle(),
    ]);
    const from = numbers?.[0]?.phone_number as string | undefined;
    if (!from) throw new Error("Your organization has no phone number assigned yet.");

    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) throw new Error("Phone service is not configured.");

    const s = (settings ?? {}) as { voice?: string; menu_message?: string };
    const voice = findVoice(s.voice) ?? findVoice("alice")!;
    const script = authenticatedGreetingScript(data.name, s.menu_message);
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const twiml =
      `<Response><Say voice="${voice.value}" language="${voice.language}">This is a test call.</Say><Pause length="1"/>` +
      `<Say voice="${voice.value}" language="${voice.language}">${esc(script)}</Say><Hangup/></Response>`;

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: data.toPhone, From: from, Twiml: twiml }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      console.error("[ivr-test-call] Twilio rejected", res.status);
      throw new Error(`The phone service refused the call: ${body.message ?? res.status}`);
    }
    await context.supabase.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: context.userId,
      actor_role: "TENANT_ADMIN",
      event_type: "IVR_TEST_CALL_PLACED",
      entity_type: "tenant",
      entity_id: tenantId,
      metadata: { to_last4: data.toPhone.slice(-4) },
    }).then(() => undefined, () => undefined);
    return { ok: true };
  });
