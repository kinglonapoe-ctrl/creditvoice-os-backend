import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireTenantAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("tenant_id")
    .eq("user_id", context.userId)
    .eq("role", "TENANT_ADMIN")
    .maybeSingle();
  if (error || !data?.tenant_id) throw new Error("Organization administrator access required.");
  return data.tenant_id as string;
}

/** Tenant admin rotates the organization access code. Plaintext shown once, never stored. */
export const changeAccessCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { newCode: string }) => {
    if (!/^\d{6,12}$/.test(input.newCode)) {
      throw new Error("The access code must be between 6 and 12 digits.");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { hashSecret } = await import("@/lib/secure-hash.server");

    await supabaseAdmin
      .from("tenant_access_codes")
      .update({ is_active: false })
      .eq("tenant_id", tenantId)
      .eq("is_active", true);
    await supabaseAdmin
      .from("tenant_access_codes")
      .insert({ tenant_id: tenantId, code_hash: await hashSecret(data.newCode) });
    await supabaseAdmin
      .from("tenants")
      .update({ access_code_status: "ACTIVE", access_code_last_changed_at: new Date().toISOString() })
      .eq("id", tenantId);
    await supabaseAdmin.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: context.userId,
      actor_role: "TENANT_ADMIN",
      event_type: "ACCESS_CODE_CHANGED",
      entity_type: "tenant",
      entity_id: tenantId,
      metadata: {},
    });
    return { ok: true };
  });

/** Sets or resets a customer's telephone PIN. The PIN is hashed and never readable afterwards. */
export const setCustomerPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { customerId: string; pin: string }) => {
    if (!/^\d{4,6}$/.test(input.pin)) throw new Error("The PIN must be 4 to 6 digits.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { hashSecret } = await import("@/lib/secure-hash.server");

    const { data: customer } = await supabaseAdmin
      .from("customers")
      .select("id, tenant_id")
      .eq("id", data.customerId)
      .maybeSingle();
    if (!customer || customer.tenant_id !== tenantId) throw new Error("Customer not found.");

    await supabaseAdmin.from("customer_pins").upsert({
      customer_id: customer.id,
      tenant_id: tenantId,
      pin_hash: await hashSecret(data.pin),
      updated_at: new Date().toISOString(),
    });
    await supabaseAdmin.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: context.userId,
      actor_role: "TENANT_ADMIN",
      event_type: "CUSTOMER_PIN_SET",
      entity_type: "customer",
      entity_id: customer.id,
      metadata: {},
    });
    return { ok: true };
  });
