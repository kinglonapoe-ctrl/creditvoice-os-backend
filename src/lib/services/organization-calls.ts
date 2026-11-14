import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export async function listOrganizationCalls(tenantId: string, page: number) {
  if (!tenantId) throw new Error("Organization is required.");
  const start = page * 50;
  const { data, error, count } = await supabase
    .from("call_sessions")
    .select("id, from_number, to_number, state, authentication_stage, created_at, ended_at, authenticated_at, customer:customers(full_name), account:customer_accounts!call_sessions_account_id_fkey(account_number)", { count: "exact" })
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(start, start + 49);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export const organizationCallsOptions = (tenantId: string, page: number) => queryOptions({
  queryKey: ["organization-calls", tenantId, page],
  queryFn: () => listOrganizationCalls(tenantId, page),
  refetchInterval: 20000,
});

export function maskCaller(value: string) {
  return value.length <= 4 ? "••••" : `••••${value.slice(-4)}`;
}