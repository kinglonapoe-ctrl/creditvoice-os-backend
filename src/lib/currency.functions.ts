import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const changeOrganizationCurrency = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ tenantId: z.string().uuid(), currency: z.string().regex(/^[A-Z]{3}$/), reason: z.string().trim().min(1).max(1000) }))
  .handler(async ({ data, context }) => {
    const { data: allowed, error: roleError } = await context.supabase.rpc("is_super_admin");
    if (roleError || !allowed) throw new Error("Super Admin approval is required.");
    const { data: result, error } = await context.supabase.rpc("change_organization_currency", {
      _tenant_id: data.tenantId, _currency: data.currency, _reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return result;
  });