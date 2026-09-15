/**
 * CreditVoice OS — Phase 2B end-to-end IVR tests.
 *
 * Drives the real webhook handler with correctly signed requests against the
 * live database. No Twilio account, no credentials and no telephone call is
 * involved: the signature is produced locally with a throwaway token, exactly
 * as Twilio would produce it.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

process.env["TELEPHONY_PROVIDER"] = "TWILIO";
process.env["TWILIO_ACCOUNT_SID"] = "ACtest";
process.env["TWILIO_AUTH_TOKEN"] = "phase2b_test_token";
process.env["TWILIO_WEBHOOK_BASE_URL"] = "https://voice.creditvoice.test";

const TOKEN = process.env["TWILIO_AUTH_TOKEN"]!;
const BASE = process.env["TWILIO_WEBHOOK_BASE_URL"]!;
const PATH = "/api/public/voice/twilio";

const { hashSecret } = await import("../../src/lib/secure-hash.server");
const { computeTwilioSignature } = await import("../../src/lib/voice/twilio-signature.server");
const { handleTwilioWebhook } = await import("../../src/lib/voice/webhook.server");

const DB = process.env["SUPABASE_DB_URL"]!;
const ACCESS_CODE = "24681357";
const PIN = "1357";

function sql(statement: string): string {
  const out = Bun.spawnSync(["psql", DB, "-Atc", statement]);
  if (out.exitCode !== 0) throw new Error(out.stderr.toString());
  return out.stdout.toString().trim();
}

let ids: Record<string, string>;
let recipient: { account_number: string };

async function post(step: string, params: Record<string, string>, opts: { signature?: string | null } = {}) {
  const url = `${BASE}${PATH}?step=${encodeURIComponent(step)}`;
  const body = new URLSearchParams(params).toString();
  const signature =
    opts.signature === undefined ? await computeTwilioSignature(TOKEN, url, params) : opts.signature;
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (signature) headers["x-twilio-signature"] = signature;
  return handleTwilioWebhook(new Request(url, { method: "POST", headers, body }));
}

function call(callSid: string, extra: Record<string, string> = {}) {
  return { CallSid: callSid, From: "+2348111222333", To: ids["num_a"]!, ...extra };
}

beforeAll(async () => {
  const accessHash = await hashSecret(ACCESS_CODE);
  const pinHash = await hashSecret(PIN);
  ids = JSON.parse(
    sql(`select public.cv_test_voice_setup('${accessHash}','${pinHash}')`),
  ) as Record<string, string>;
  recipient = JSON.parse(sql(`select public.cv_test_add_account('${ids["ta"]}','QA E2E Recipient')`));
  sql(`select public.cv_test_fund_account('${ids["aa1"]}', 100000)`);
});

afterAll(() => {
  sql(
    `select public.cv_test_voice_cleanup(array['${ids["ta"]}','${ids["tb"]}','${ids["tsus"]}']::uuid[])`,
  );
});

describe("webhook security", () => {
  test("an unsigned request is rejected with 403 and never reaches the engine", async () => {
    const before = sql(`select count(*) from public.call_sessions`);
    const res = await post("start", call("CA-unsigned"), { signature: null });
    expect(res.status).toBe(403);
    expect(sql(`select count(*) from public.call_sessions`)).toBe(before);
  });

  test("an invalid signature is rejected with 403", async () => {
    const res = await post("start", call("CA-bad"), { signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAA=" });
    expect(res.status).toBe(403);
  });

  test("a modified signed request is rejected with 403", async () => {
    const url = `${BASE}${PATH}?step=start`;
    const params = call("CA-tamper");
    const signature = await computeTwilioSignature(TOKEN, url, params);
    const res = await handleTwilioWebhook(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature },
        body: new URLSearchParams({ ...params, To: ids["num_b"]! }).toString(),
      }),
    );
    expect(res.status).toBe(403);
  });

  test("a request shaped wrongly is rejected with 400", async () => {
    const res = await post("start", { CallSid: "", From: "+1", To: "" });
    expect(res.status).toBe(400);
  });

  test("GET is not allowed", async () => {
    const url = `${BASE}${PATH}`;
    const res = await handleTwilioWebhook(new Request(url, { method: "GET" }));
    expect(res.status).toBe(405);
  });
});

describe("tenant resolution", () => {
  test("an unknown destination number gets a generic message and no organization detail", async () => {
    const res = await post("start", { CallSid: "CA-unknown", From: "+2348111222333", To: "+234999888777" });
    const xml = await res.text();
    expect(res.status).toBe(200);
    expect(xml).toContain("not currently available");
    expect(xml).toContain("<Hangup/>");
    expect(xml.toLowerCase()).not.toContain("qa voice");
  });
});

describe("happy path: call to balance", () => {
  const sid = "CA-happy-1";

  test("the call is answered with the access code prompt", async () => {
    const xml = await (await post("start", call(sid))).text();
    expect(xml).toContain("Welcome to CreditVoice.");
    expect(xml).toContain("access code");
    expect(xml).toContain("<Gather");
  });

  test("the access code is accepted and the account number requested", async () => {
    const xml = await (await post("access_code", call(sid, { Digits: ACCESS_CODE }))).text();
    expect(xml).toContain("account number");
  });

  test("the account number is accepted and the PIN requested", async () => {
    const xml = await (await post("account", call(sid, { Digits: ids["acct_a"]! }))).text();
    expect(xml).toContain("PIN");
  });

  test("the PIN authenticates the caller and the menu is offered", async () => {
    const xml = await (await post("pin", call(sid, { Digits: PIN }))).text();
    expect(xml).toContain("Authentication successful.");
    expect(xml).toContain("Press 1 for your balance.");
    expect(sql(`select state from public.call_sessions where provider_call_id = '${sid}'`)).toBe("AUTHENTICATED");
  });

  test("option 1 speaks the available credit", async () => {
    const xml = await (await post("menu", call(sid, { Digits: "1" }))).text();
    expect(xml).toContain("available credit");
    expect(xml).toContain("NGN");
  });

  test("option 2 gives masked account information only", async () => {
    const xml = await (await post("menu", call(sid, { Digits: "2" }))).text();
    expect(xml).toContain("ending in");
    expect(xml).not.toContain(ids["acct_a"]!);
    expect(xml).not.toContain(ids["aa1"]!);
  });

  test("an invalid key is handled safely", async () => {
    const xml = await (await post("menu", call(sid, { Digits: "7" }))).text();
    expect(xml).toContain("<Gather");
  });

  test("option 9 ends the call", async () => {
    const xml = await (await post("menu", call(sid, { Digits: "9" }))).text();
    expect(xml).toContain("Goodbye");
    expect(xml).toContain("<Hangup/>");
  });
});

describe("transfer", () => {
  const sid = "CA-transfer-1";

  test("authenticate", async () => {
    await post("start", call(sid));
    await post("access_code", call(sid, { Digits: ACCESS_CODE }));
    await post("account", call(sid, { Digits: ids["acct_a"]! }));
    const xml = await (await post("pin", call(sid, { Digits: PIN }))).text();
    expect(xml).toContain("Authentication successful.");
  });

  test("option 3 asks for the recipient", async () => {
    const xml = await (await post("menu", call(sid, { Digits: "3" }))).text();
    expect(xml).toContain("recipient");
    expect(xml).toContain("step=transfer_recipient");
  });

  test("the amount is echoed back for explicit confirmation", async () => {
    await post("transfer_recipient", call(sid, { Digits: recipient.account_number }));
    const xml = await (await post("transfer_amount", call(sid, { Digits: "500" }))).text();
    expect(xml).toContain("5.00 NGN");
    expect(xml).toContain("Press 1 to confirm");
    expect(sql(`select count(*) from public.transfers where tenant_id = '${ids["ta"]}'`)).toBe("0");
  });

  test("confirming executes exactly one transfer through the existing engine", async () => {
    const xml = await (await post("transfer_confirm", call(sid, { Digits: "1" }))).text();
    expect(xml).toContain("transfer was successful");
    expect(sql(`select count(*) from public.transfers where tenant_id = '${ids["ta"]}'`)).toBe("1");
    expect(sql(`select status from public.transfers where tenant_id = '${ids["ta"]}'`)).toBe("COMPLETED");
    expect(sql(`select balance from public.customer_accounts where id = '${ids["aa1"]}'`)).toBe("99995.0000");
  });

  test("a replayed confirmation moves no additional money", async () => {
    await post("transfer_confirm", call(sid, { Digits: "1" }));
    expect(sql(`select count(*) from public.transfers where tenant_id = '${ids["ta"]}'`)).toBe("1");
    expect(sql(`select balance from public.customer_accounts where id = '${ids["aa1"]}'`)).toBe("99995.0000");
  });

  test("cancelling at the confirmation step moves no money", async () => {
    await post("menu", call(sid, { Digits: "3" }));
    await post("transfer_recipient", call(sid, { Digits: recipient.account_number }));
    await post("transfer_amount", call(sid, { Digits: "700" }));
    const xml = await (await post("transfer_confirm", call(sid, { Digits: "2" }))).text();
    expect(xml).toContain("cancelled");
    expect(sql(`select count(*) from public.transfers where tenant_id = '${ids["ta"]}'`)).toBe("1");
  });

  test("a recipient in another organization is refused", async () => {
    await post("menu", call(sid, { Digits: "3" }));
    await post("transfer_recipient", call(sid, { Digits: ids["acct_b"]! }));
    const xml = await (await post("transfer_amount", call(sid, { Digits: "100" }))).text();
    expect(xml).toContain("recipient account is not available");
    expect(sql(`select count(*) from public.transfers where tenant_id = '${ids["ta"]}'`)).toBe("1");
  });

  test("an amount beyond available credit is refused and recorded", async () => {
    await post("menu", call(sid, { Digits: "3" }));
    await post("transfer_recipient", call(sid, { Digits: recipient.account_number }));
    await post("transfer_amount", call(sid, { Digits: "99999999" }));
    const xml = await (await post("transfer_confirm", call(sid, { Digits: "1" }))).text();
    expect(xml).toContain("enough available credit");
    expect(sql(`select count(*) from public.transfers where tenant_id = '${ids["ta"]}'`)).toBe("1");
    expect(
      sql(
        `select count(*) from public.financial_failure_events where tenant_id = '${ids["ta"]}' and reason_category = 'INSUFFICIENT_CREDIT'`,
      ),
    ).toBe("1");
  });

  test("an amount with too much precision is refused", async () => {
    await post("menu", call(sid, { Digits: "3" }));
    await post("transfer_recipient", call(sid, { Digits: recipient.account_number }));
    const xml = await (await post("transfer_amount", call(sid, { Digits: "10*555" }))).text();
    expect(xml).toContain("<Gather");
    expect(sql(`select count(*) from public.transfers where tenant_id = '${ids["ta"]}'`)).toBe("1");
  });
});

describe("authentication failures", () => {
  test("a wrong access code is refused generically and never names the organization", async () => {
    const sid = "CA-badcode";
    await post("start", call(sid));
    const xml = await (await post("access_code", call(sid, { Digits: "00000000" }))).text();
    expect(xml).toContain("not accepted");
    expect(xml.toLowerCase()).not.toContain("organization access code is incorrect");
  });

  test("repeated wrong PINs end the call", async () => {
    const sid = "CA-badpin";
    await post("start", call(sid));
    await post("access_code", call(sid, { Digits: ACCESS_CODE }));
    await post("account", call(sid, { Digits: ids["acct_a"]! }));
    await post("pin", call(sid, { Digits: "0000" }));
    await post("pin", call(sid, { Digits: "0001" }));
    const xml = await (await post("pin", call(sid, { Digits: "0002" }))).text();
    expect(xml).toContain("<Hangup/>");
    const state = sql(`select state from public.call_sessions where provider_call_id = '${sid}'`);
    expect(["LOCKED", "FAILED", "ENDED"]).toContain(state);
  });

  test("account lookup never leaves the dialled organization", async () => {
    // Account numbers are unique per organization, not globally: the same
    // number exists in another organization. The lookup must stay scoped.
    const sid = "CA-crosstenant";
    await post("start", call(sid));
    await post("access_code", call(sid, { Digits: ACCESS_CODE }));
    await post("account", call(sid, { Digits: ids["acct_b"]! }));
    const bound = sql(`select account_id from public.call_sessions where provider_call_id = '${sid}'`);
    expect(bound).not.toBe(ids["ab1"]!);
    const tenantOfBound = bound
      ? sql(`select tenant_id from public.customer_accounts where id = '${bound}'`)
      : "";
    if (bound) expect(tenantOfBound).toBe(ids["ta"]!);
  });

  test("an unauthenticated caller cannot reach the menu actions", async () => {
    const sid = "CA-unauth";
    await post("start", call(sid));
    const xml = await (await post("menu", call(sid, { Digits: "1" }))).text();
    // Still at the access-code step: no balance is ever spoken.
    expect(xml).not.toContain("available credit");
  });
});

describe("credential hygiene", () => {
  test("no PIN, access code or hash reaches the audit trail", () => {
    const hits = sql(
      `select count(*) from public.audit_logs where tenant_id = '${ids["ta"]}' and (metadata::text like '%${PIN}%' or metadata::text like '%${ACCESS_CODE}%' or metadata::text ilike '%pbkdf2%')`,
    );
    expect(hits).toBe("0");
  });

  test("no credential is written into the call session", () => {
    const hits = sql(
      `select count(*) from public.call_sessions where metadata::text like '%${PIN}%' or metadata::text like '%${ACCESS_CODE}%'`,
    );
    expect(hits).toBe("0");
  });
});
