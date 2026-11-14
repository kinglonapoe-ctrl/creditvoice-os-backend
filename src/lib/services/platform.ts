import { supabase } from "@/integrations/supabase/client";

export async function listApplications() {
  const { data, error } = await supabase
    .from("tenant_applications")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function submitApplication(input: {
  organization_name: string;
  legal_name: string;
  admin_full_name: string;
  admin_email: string;
  admin_phone: string;
  country: string;
  address: string;
  business_type: string;
  requested_currency: string;
  description: string;
}) {
  const { error } = await supabase.from("tenant_applications").insert({ ...input, status: "PENDING" });
  if (error) throw error;
}

export async function listTenants() {
  const { data, error } = await supabase
    .from("tenants")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getTenant(tenantId: string) {
  const { data, error } = await supabase.from("tenants").select("*").eq("id", tenantId).single();
  if (error) throw error;
  return data;
}

export async function listCurrencies() {
  const { data, error } = await supabase.from("currencies").select("*").order("code");
  if (error) throw error;
  return data ?? [];
}

export async function listPhoneNumbers() {
  const { data, error } = await supabase
    .from("phone_numbers")
    .select("*, tenants(name)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listAuditLogs(tenantId?: string) {
  let query = supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(200);
  if (tenantId) query = query.eq("tenant_id", tenantId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function listPlatformSettings() {
  const { data, error } = await supabase.from("platform_settings").select("*").order("key");
  if (error) throw error;
  return data ?? [];
}

export async function platformStats() {
  const [tenants, applications, customers, accounts, numbers, transfers] = await Promise.all([
    supabase.from("tenants").select("status"),
    supabase.from("tenant_applications").select("status"),
    supabase.from("customers").select("status"),
    supabase.from("customer_accounts").select("balance, currency_code, status"),
    supabase.from("phone_numbers").select("status"),
    supabase.from("transfers").select("amount, status"),
  ]);

  const accountRows = accounts.data ?? [];
  return {
    activeTenants: (tenants.data ?? []).filter((t) => t.status === "ACTIVE").length,
    totalTenants: (tenants.data ?? []).length,
    pendingApplications: (applications.data ?? []).filter((a) => a.status === "PENDING" || a.status === "UNDER_REVIEW")
      .length,
    activeCustomers: (customers.data ?? []).filter((c) => c.status === "ACTIVE").length,
    totalAccounts: accountRows.length,
    creditVolume: accountRows.reduce((sum, a) => sum + Number(a.balance ?? 0), 0),
    transferVolume: (transfers.data ?? [])
      .filter((t) => t.status === "COMPLETED")
      .reduce((sum, t) => sum + Number(t.amount ?? 0), 0),
    activeNumbers: (numbers.data ?? []).filter((n) => n.status === "ACTIVE" || n.status === "ASSIGNED").length,
  };
}

export async function listAllTransactions() {
  const { data, error } = await supabase
    .from("transactions")
    .select("*, tenants(name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function listCareSettings() {
  const { data, error } = await supabase.from("customer_care_settings").select("*, tenants(name)");
  if (error) throw error;
  return data ?? [];
}

export async function listPlatformUsers() {
  const [profiles, roles, tenants] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, phone, created_at").order("created_at", { ascending: false }),
    supabase.from("user_roles").select("user_id, role, tenant_id"),
    supabase.from("tenants").select("id, name"),
  ]);
  if (profiles.error) throw profiles.error;
  if (roles.error) throw roles.error;
  const tenantName = new Map((tenants.data ?? []).map((t) => [t.id, t.name]));
  return (profiles.data ?? []).map((p) => {
    const r = (roles.data ?? []).filter((x) => x.user_id === p.id);
    return {
      ...p,
      roles: r.map((x) => ({ role: x.role as string, tenant: x.tenant_id ? tenantName.get(x.tenant_id) ?? null : null })),
    };
  });
}
