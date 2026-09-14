import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Ensures the caller is a platform (super) administrator. */
async function assertSuperAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "SUPER_ADMIN")
    .maybeSingle();
  if (error || !data) throw new Error("Platform administrator access required.");
}

async function writeAudit(
  admin: any,
  entry: {
    tenant_id?: string | null;
    actor_id: string;
    actor_role: string;
    event_type: string;
    entity_type?: string;
    entity_id?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await admin.from("audit_logs").insert({ metadata: {}, ...entry });
}

/**
 * Bootstrap: the very first signed-in user may claim platform ownership.
 * Once a platform administrator exists this becomes a no-op.
 */
export const claimPlatformOwnership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "SUPER_ADMIN");
    if ((count ?? 0) > 0) return { claimed: false as const };
    await supabaseAdmin.from("user_roles").insert({ user_id: context.userId, role: "SUPER_ADMIN" });
    await writeAudit(supabaseAdmin, {
      actor_id: context.userId,
      actor_role: "SUPER_ADMIN",
      event_type: "PLATFORM_OWNER_CLAIMED",
      entity_type: "user",
      entity_id: context.userId,
    });
    return { claimed: true as const };
  });

export const reviewApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { applicationId: string; notes?: string }) => input)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("tenant_applications")
      .update({
        status: "UNDER_REVIEW",
        review_notes: data.notes ?? null,
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.applicationId);
    return { ok: true };
  });

export const rejectApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { applicationId: string; reason: string }) => input)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("tenant_applications")
      .update({
        status: "REJECTED",
        review_notes: data.reason,
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.applicationId);
    await writeAudit(supabaseAdmin, {
      actor_id: context.userId,
      actor_role: "SUPER_ADMIN",
      event_type: "TENANT_REJECTED",
      entity_type: "tenant_application",
      entity_id: data.applicationId,
      metadata: { reason: data.reason },
    });
    return { ok: true };
  });

/**
 * Approves an application: creates the organization, its administrator login,
 * approves the requested currency and seeds default configuration.
 */
export const approveApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { applicationId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: app, error } = await supabaseAdmin
      .from("tenant_applications")
      .select("*")
      .eq("id", data.applicationId)
      .single();
    if (error || !app) throw new Error("Application not found.");
    if (app.status === "APPROVED") throw new Error("This application was already approved.");

    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from("tenants")
      .insert({
        name: app.organization_name,
        legal_name: app.legal_name,
        country: app.country,
        address: app.address,
        business_type: app.business_type,
        description: app.description,
        currency_code: app.requested_currency,
        currency_approved: true,
        status: "CONFIGURATION",
      })
      .select()
      .single();
    if (tenantError || !tenant) throw new Error(tenantError?.message ?? "Could not create organization.");

    const tempPassword = crypto.randomUUID().replace(/-/g, "").slice(0, 16) + "aA1!";
    let adminUserId: string | null = null;
    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: app.admin_email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: app.admin_full_name },
    });
    if (created?.user) {
      adminUserId = created.user.id;
    } else if (createError) {
      const { data: list } = await supabaseAdmin.auth.admin.listUsers();
      adminUserId = list?.users.find((u: any) => u.email === app.admin_email)?.id ?? null;
      if (!adminUserId) throw new Error(createError.message);
    }

    if (adminUserId) {
      await supabaseAdmin.from("profiles").upsert({
        id: adminUserId,
        full_name: app.admin_full_name,
        email: app.admin_email,
        phone: app.admin_phone,
      });
      await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: adminUserId, role: "TENANT_ADMIN", tenant_id: tenant.id });
    }

    await supabaseAdmin.from("customer_care_settings").insert({ tenant_id: tenant.id });
    await supabaseAdmin.from("ivr_settings").insert({ tenant_id: tenant.id });

    await supabaseAdmin
      .from("tenant_applications")
      .update({
        status: "APPROVED",
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
        tenant_id: tenant.id,
      })
      .eq("id", app.id);

    await writeAudit(supabaseAdmin, {
      tenant_id: tenant.id,
      actor_id: context.userId,
      actor_role: "SUPER_ADMIN",
      event_type: "TENANT_APPROVED",
      entity_type: "tenant",
      entity_id: tenant.id,
      metadata: { currency: app.requested_currency, admin_email: app.admin_email },
    });
    await writeAudit(supabaseAdmin, {
      tenant_id: tenant.id,
      actor_id: context.userId,
      actor_role: "SUPER_ADMIN",
      event_type: "CURRENCY_APPROVED",
      entity_type: "tenant",
      entity_id: tenant.id,
      metadata: { currency: app.requested_currency },
    });

    return {
      tenantId: tenant.id as string,
      adminEmail: app.admin_email as string,
      // Shown once during secure issuance so the organization can sign in.
      temporaryPassword: created?.user ? tempPassword : null,
    };
  });

export const assignPhoneNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { phoneNumberId: string; tenantId: string; isPrimary?: boolean }) => input)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("phone_numbers")
      .update({
        tenant_id: data.tenantId,
        status: "ASSIGNED",
        is_primary: data.isPrimary ?? true,
        assigned_at: new Date().toISOString(),
      })
      .eq("id", data.phoneNumberId)
      .in("status", ["AVAILABLE", "RESERVED"]);
    if (error) throw new Error(error.message);
    await writeAudit(supabaseAdmin, {
      tenant_id: data.tenantId,
      actor_id: context.userId,
      actor_role: "SUPER_ADMIN",
      event_type: "PHONE_NUMBER_ASSIGNED",
      entity_type: "phone_number",
      entity_id: data.phoneNumberId,
    });
    return { ok: true };
  });

export const releasePhoneNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { phoneNumberId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: number } = await supabaseAdmin
      .from("phone_numbers")
      .select("tenant_id")
      .eq("id", data.phoneNumberId)
      .maybeSingle();
    await supabaseAdmin
      .from("phone_numbers")
      .update({ tenant_id: null, status: "AVAILABLE", is_primary: false, assigned_at: null })
      .eq("id", data.phoneNumberId);
    await writeAudit(supabaseAdmin, {
      tenant_id: number?.tenant_id ?? null,
      actor_id: context.userId,
      actor_role: "SUPER_ADMIN",
      event_type: "PHONE_NUMBER_RELEASED",
      entity_type: "phone_number",
      entity_id: data.phoneNumberId,
    });
    return { ok: true };
  });

/** Issues the initial organization access code. Plaintext is returned once and never stored. */
export const issueAccessCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { hashSecret, generateNumericCode } = await import("@/lib/secure-hash.server");

    const { data: existing } = await supabaseAdmin
      .from("tenant_access_codes")
      .select("id")
      .eq("tenant_id", data.tenantId)
      .eq("is_active", true)
      .maybeSingle();
    if (existing) throw new Error("An access code has already been issued for this organization.");

    const code = generateNumericCode(8);
    const codeHash = await hashSecret(code);
    await supabaseAdmin.from("tenant_access_codes").insert({ tenant_id: data.tenantId, code_hash: codeHash });
    await supabaseAdmin
      .from("tenants")
      .update({ access_code_status: "ACTIVE", access_code_last_changed_at: new Date().toISOString() })
      .eq("id", data.tenantId);
    await writeAudit(supabaseAdmin, {
      tenant_id: data.tenantId,
      actor_id: context.userId,
      actor_role: "SUPER_ADMIN",
      event_type: "ACCESS_CODE_ISSUED",
      entity_type: "tenant",
      entity_id: data.tenantId,
    });
    return { code };
  });

export const setTenantStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId: string; status: "CONFIGURATION" | "ACTIVE" | "SUSPENDED" | "CLOSED" }) => input)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.status === "ACTIVE") {
      const { data: tenant } = await supabaseAdmin
        .from("tenants")
        .select("currency_approved, access_code_status")
        .eq("id", data.tenantId)
        .single();
      if (!tenant?.currency_approved) throw new Error("Approve the operating currency before activation.");
      if (tenant.access_code_status !== "ACTIVE")
        throw new Error("Issue the organization access code before activation.");
      const { count } = await supabaseAdmin
        .from("phone_numbers")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", data.tenantId);
      if ((count ?? 0) === 0) throw new Error("Assign a voice number before activation.");
    }

    await supabaseAdmin.from("tenants").update({ status: data.status }).eq("id", data.tenantId);
    if (data.status === "ACTIVE") {
      await supabaseAdmin
        .from("phone_numbers")
        .update({ status: "ACTIVE" })
        .eq("tenant_id", data.tenantId)
        .eq("status", "ASSIGNED");
    }
    await writeAudit(supabaseAdmin, {
      tenant_id: data.tenantId,
      actor_id: context.userId,
      actor_role: "SUPER_ADMIN",
      event_type: `TENANT_${data.status}`,
      entity_type: "tenant",
      entity_id: data.tenantId,
    });
    return { ok: true };
  });

export const addPhoneNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      country: string;
      countryCallingCode: string;
      phoneNumber: string;
      provider: string;
      voice: boolean;
      sms: boolean;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("phone_numbers").insert({
      country: data.country,
      country_calling_code: data.countryCallingCode,
      phone_number: data.phoneNumber,
      provider: data.provider,
      voice_capable: data.voice,
      sms_capable: data.sms,
      status: "AVAILABLE",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setCurrencyActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { code: string; isActive: boolean }) => input)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("currencies").update({ is_active: data.isActive }).eq("code", data.code);
    return { ok: true };
  });
