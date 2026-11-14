import { describe, expect, mock, test } from "bun:test";

const requests: { method: string; args: unknown[] }[] = [];
const result = { data: [{ id: "call-1" }], count: 1, error: null };
const builder = {
  select: (...args: unknown[]) => { requests.push({ method: "select", args }); return builder; },
  eq: (...args: unknown[]) => { requests.push({ method: "eq", args }); return builder; },
  order: (...args: unknown[]) => { requests.push({ method: "order", args }); return builder; },
  range: (...args: unknown[]) => { requests.push({ method: "range", args }); return Promise.resolve(result); },
};
mock.module("@/integrations/supabase/client", () => ({ supabase: { from: (...args: unknown[]) => { requests.push({ method: "from", args }); return builder; } } }));
const { listOrganizationCalls } = await import("../../src/lib/services/organization-calls");

describe("organization caller visibility", () => {
  test("restricts call reads to the selected organization", async () => {
    requests.length = 0;
    await listOrganizationCalls("organization-a", 0);
    expect(requests.find(r => r.method === "eq")?.args).toEqual(["tenant_id", "organization-a"]);
    expect(requests.find(r => r.method === "from")?.args).toEqual(["call_sessions"]);
  });
  test("refuses a missing organization before any read", async () => {
    requests.length = 0;
    await expect(listOrganizationCalls("", 0)).rejects.toThrow("Organization is required.");
    expect(requests).toHaveLength(0);
  });
  test("never selects sensitive session payloads or authentication inputs", async () => {
    requests.length = 0;
    await listOrganizationCalls("organization-a", 0);
    const columns = String(requests.find(r => r.method === "select")?.args[0]);
    expect(columns).not.toContain("*");
    expect(columns).not.toMatch(/metadata|last_response|pending_recipient_input|pin_hash|code_hash/);
    expect(columns).toContain("customers(full_name)");
  });
});