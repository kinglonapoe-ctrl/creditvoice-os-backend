import { beforeEach, describe, expect, mock, test } from "bun:test";

const filters: [string, string][] = [];
let allowed = true;
let reads = 0;
mock.module("../../src/lib/voice/call-session.server", () => ({
  authorizeAction: async () => ({
    allowed,
    reason: "NOT_AUTHENTICATED",
    context: allowed ? { customerId: "authenticated-customer", tenantId: "authenticated-tenant" } : null,
  }),
  endCallSession: async () => undefined,
  getAuthenticatedSession: async () => undefined,
}));
const query = {
  select: () => query,
  eq: (column: string, value: string) => { filters.push([column, value]); return query; },
  maybeSingle: async () => ({ data: { full_name: "Sample Member", welcome_message: "Member welcome" }, error: null }),
};
mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => { reads++; return query; } },
}));
const { getCallCustomerGreeting } = await import("../../src/lib/voice/actions.server");

describe("customer welcome authorization", () => {
  beforeEach(() => { allowed = true; reads = 0; filters.length = 0; });
  test("reads only the authenticated customer's record within their organization", async () => {
    await getCallCustomerGreeting("verified-session");
    expect(reads).toBe(1);
    expect(filters).toEqual([["id", "authenticated-customer"], ["tenant_id", "authenticated-tenant"]]);
  });
  test("does not read personal messages before successful authentication", async () => {
    allowed = false;
    await expect(getCallCustomerGreeting("unverified-session")).rejects.toThrow("This action is not available.");
    expect(reads).toBe(0);
    expect(filters).toHaveLength(0);
  });
});