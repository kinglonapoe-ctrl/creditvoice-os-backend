import { supabase } from "@/integrations/supabase/client";

export async function listCustomers(tenantId: string) {
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createCustomer(input: {
  tenant_id: string;
  full_name: string;
  phone: string;
  email?: string | null;
  customer_reference?: string | null;
}) {
  const { data, error } = await supabase.from("customers").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateCustomer(id: string, patch: Record<string, any>) {
  const { error } = await supabase.from("customers").update(patch as never).eq("id", id);
  if (error) throw error;
}

export async function listAccounts(tenantId: string) {
  const { data, error } = await supabase
    .from("customer_accounts")
    .select("*, customers(full_name, phone)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createAccount(input: {
  tenant_id: string;
  customer_id: string;
  currency_code: string;
  credit_limit: number;
}) {
  const { data, error } = await supabase.from("customer_accounts").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateAccount(id: string, patch: Record<string, any>) {
  const { error } = await supabase.from("customer_accounts").update(patch as never).eq("id", id);
  if (error) throw error;
}

export async function postCredit(input: {
  accountId: string;
  amount: number;
  type: "INITIAL_CREDIT" | "CREDIT_ADJUSTMENT" | "CREDIT_DEBIT" | "CREDIT_REPAYMENT";
  description?: string;
}) {
  const { error } = await supabase.rpc("post_credit", {
    _account_id: input.accountId,
    _amount: input.amount,
    _type: input.type,
    ...(input.description ? { _description: input.description } : {}),
  });
  if (error) throw error;
}

export async function executeTransfer(input: {
  senderAccountId: string;
  recipientAccountId: string;
  amount: number;
  description?: string;
}) {
  const { error } = await supabase.rpc("execute_transfer", {
    _sender_account_id: input.senderAccountId,
    _recipient_account_id: input.recipientAccountId,
    _amount: input.amount,
    ...(input.description ? { _description: input.description } : {}),
  });
  if (error) throw error;
}

export async function reverseTransfer(transferId: string, reason: string) {
  const { error } = await supabase.rpc("reverse_transfer", { _transfer_id: transferId, _reason: reason });
  if (error) throw error;
}

export async function listTransfers(tenantId: string) {
  const { data, error } = await supabase
    .from("transfers")
    .select("*, sender:sender_account_id(account_number), recipient:recipient_account_id(account_number)")
    .eq("tenant_id", tenantId)
    .order("initiated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listTransactions(tenantId: string) {
  const { data, error } = await supabase
    .from("transactions")
    .select("*, account:account_id(account_number), counterparty:counterparty_account_id(account_number)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function getCareSettings(tenantId: string) {
  const { data, error } = await supabase
    .from("customer_care_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveCareSettings(tenantId: string, patch: Record<string, any>) {
  const { error } = await supabase
    .from("customer_care_settings")
    .upsert({ tenant_id: tenantId, ...patch }, { onConflict: "tenant_id" });
  if (error) throw error;
}

export async function getIvrSettings(tenantId: string) {
  const { data, error } = await supabase.from("ivr_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveIvrSettings(tenantId: string, patch: Record<string, any>) {
  const { error } = await supabase
    .from("ivr_settings")
    .upsert({ tenant_id: tenantId, ...patch }, { onConflict: "tenant_id" });
  if (error) throw error;
}

export async function getTenantNumbers(tenantId: string) {
  const { data, error } = await supabase.from("phone_numbers").select("*").eq("tenant_id", tenantId);
  if (error) throw error;
  return data ?? [];
}

export async function organizationStats(tenantId: string) {
  const [customers, accounts, transfers] = await Promise.all([
    supabase.from("customers").select("status").eq("tenant_id", tenantId),
    supabase.from("customer_accounts").select("balance, credit_limit, status").eq("tenant_id", tenantId),
    supabase.from("transfers").select("amount, status, initiated_at").eq("tenant_id", tenantId),
  ]);
  const accountRows = accounts.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  return {
    customers: (customers.data ?? []).length,
    activeAccounts: accountRows.filter((a) => a.status === "ACTIVE").length,
    totalCredit: accountRows.reduce((s, a) => s + Number(a.balance ?? 0), 0),
    availableCredit: accountRows.reduce(
      (s, a) => s + Number(a.balance ?? 0) + Number(a.credit_limit ?? 0),
      0,
    ),
    transfersToday: (transfers.data ?? []).filter((t) => (t.initiated_at ?? "").slice(0, 10) === today).length,
  };
}
