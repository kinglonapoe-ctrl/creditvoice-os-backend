/**
 * CreditVoice OS — Phase 2B.5 Gate C load harness.
 *
 * Drives the real signed webhook handler against the real database with
 * increasing concurrency and measures latency, throughput and errors.
 * Everything runs against clearly marked QA test organizations created by the
 * development fixtures; no Twilio account and no real money is involved.
 *
 * Usage:  bun run test:load            (levels 5, 20, 50)
 *         LOAD_LEVELS=5,20,50,100 bun run test:load
 */
process.env["TELEPHONY_PROVIDER"] = "TWILIO";
process.env["TWILIO_ACCOUNT_SID"] = "ACtest";
process.env["TWILIO_AUTH_TOKEN"] = "phase2b_load_token";
process.env["TWILIO_WEBHOOK_BASE_URL"] = "https://voice.creditvoice.test";

const TOKEN = process.env["TWILIO_AUTH_TOKEN"]!;
const BASE = process.env["TWILIO_WEBHOOK_BASE_URL"]!;
const PATH = "/api/public/voice/twilio";
const DB = process.env["SUPABASE_DB_URL"];
if (!DB) throw new Error("SUPABASE_DB_URL is required");

const { hashSecret } = await import("../../src/lib/secure-hash.server");
const { computeTwilioSignature } = await import("../../src/lib/voice/twilio-signature.server");
const { handleTwilioWebhook } = await import("../../src/lib/voice/webhook.server");

const ACCESS_CODE = "24681357";
const PIN = "1357";
const LEVELS = (process.env["LOAD_LEVELS"] ?? "5,20,50").split(",").map((n) => Number(n.trim()));

function sql(statement: string): string {
  const out = Bun.spawnSync(["psql", DB!, "-Atc", statement]);
  if (out.exitCode !== 0) throw new Error(out.stderr.toString());
  return out.stdout.toString().trim();
}

interface Sample {
  ms: number;
  status: number;
  ok: boolean;
}

const results: Array<Record<string, unknown>> = [];

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[i]! * 100) / 100;
}

function report(scenario: string, level: number, samples: Sample[], wallMs: number, extra: Record<string, unknown> = {}) {
  const lat = samples.map((s) => s.ms).sort((a, b) => a - b);
  const ok = samples.filter((s) => s.ok).length;
  const row = {
    scenario,
    concurrency: level,
    requests: samples.length,
    successful: ok,
    rejected: samples.length - ok,
    http_5xx: samples.filter((s) => s.status >= 500).length,
    http_4xx: samples.filter((s) => s.status >= 400 && s.status < 500).length,
    p50_ms: pct(lat, 50),
    p95_ms: pct(lat, 95),
    p99_ms: pct(lat, 99),
    max_ms: Math.round((lat.at(-1) ?? 0) * 100) / 100,
    throughput_rps: Math.round((samples.length / (wallMs / 1000)) * 100) / 100,
    ...extra,
  };
  results.push(row);
  console.log(
    `${scenario.padEnd(34)} c=${String(level).padStart(3)}  n=${String(row.requests).padStart(4)}  ok=${String(
      row.successful,
    ).padStart(4)}  5xx=${row.http_5xx}  p50=${row.p50_ms}ms  p95=${row.p95_ms}ms  p99=${row.p99_ms}ms  max=${row.max_ms}ms  ${row.throughput_rps}/s`,
  );
  return row;
}

async function post(step: string, params: Record<string, string>): Promise<Sample> {
  const url = `${BASE}${PATH}?step=${encodeURIComponent(step)}`;
  const body = new URLSearchParams(params).toString();
  const signature = await computeTwilioSignature(TOKEN, url, params);
  const started = performance.now();
  let status = 0;
  let text = "";
  try {
    const res = await handleTwilioWebhook(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature },
        body,
      }),
    );
    status = res.status;
    text = await res.text();
  } catch {
    status = 599;
  }
  return { ms: performance.now() - started, status, ok: status === 200 && text.length > 0 };
}

// ---------------------------------------------------------------- fixtures
const accessHash = await hashSecret(ACCESS_CODE);
const pinHash = await hashSecret(PIN);
const ids = JSON.parse(sql(`select cv_test.cv_test_voice_setup('${accessHash}','${pinHash}')`)) as Record<string, string>;
const TA = ids["ta"]!;
const NUM_A = ids["num_a"]!;

const MAX_CALLERS = Math.max(...LEVELS);
const callers: Array<{ account: string }> = [];
for (let i = 0; i < MAX_CALLERS; i++) {
  const row = JSON.parse(sql(`select cv_test.cv_test_add_account('${TA}','QA Load Caller ${i}')`)) as {
    customer_id: string;
    account_number: string;
    account_id: string;
  };
  sql(
    `insert into public.customer_pins (customer_id, tenant_id, pin_hash) values ('${row.customer_id}','${TA}','${pinHash}')`,
  );
  sql(`select cv_test.cv_test_fund_account('${row.account_id}', 100000)`);
  callers.push({ account: row.account_number });
}
const recipient = JSON.parse(sql(`select cv_test.cv_test_add_account('${TA}','QA Load Recipient')`)) as {
  account_number: string;
  account_id: string;
};

function cleanup() {
  sql(`select cv_test.cv_test_voice_cleanup(array['${TA}','${ids["tb"]}','${ids["tsus"]}']::uuid[])`);
}
process.on("exit", () => {
  /* explicit cleanup below; this is only a safety net */
});

const call = (sid: string, extra: Record<string, string> = {}) => ({
  CallSid: sid,
  From: "+2348111222333",
  To: NUM_A,
  ...extra,
});

async function authenticateCall(sid: string, account: string): Promise<Sample[]> {
  const s: Sample[] = [];
  s.push(await post("start", call(sid)));
  s.push(await post("access_code", call(sid, { Digits: ACCESS_CODE })));
  s.push(await post("account", call(sid, { Digits: account })));
  s.push(await post("pin", call(sid, { Digits: PIN })));
  return s;
}

async function parallel<T>(n: number, fn: (i: number) => Promise<T>): Promise<T[]> {
  return Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
}

console.log(`\nCreditVoice OS — Gate C load harness (levels: ${LEVELS.join(", ")})\n`);

let run = 0;
const expectedTransfers: number[] = [];

for (const level of LEVELS) {
  console.log(`--- level ${level} ---`);

  // A. inbound call / session creation
  {
    const t0 = performance.now();
    const s = await parallel(level, (i) => post("start", call(`LOAD-A-${run}-${i}`)));
    report("A inbound call + session", level, s, performance.now() - t0);
  }

  // B. full authentication sequence
  {
    const t0 = performance.now();
    const s = (await parallel(level, (i) => authenticateCall(`LOAD-B-${run}-${i}`, callers[i]!.account))).flat();
    const authed = sql(
      `select count(*) from public.call_sessions where tenant_id='${TA}' and provider_call_id like 'LOAD-B-${run}-%' and state='AUTHENTICATED'`,
    );
    report("B authentication (4 turns)", level, s, performance.now() - t0, { authenticated_sessions: Number(authed) });
  }

  // C. balance enquiry by authenticated callers
  {
    const sids = await parallel(level, async (i) => {
      const sid = `LOAD-C-${run}-${i}`;
      await authenticateCall(sid, callers[i]!.account);
      return sid;
    });
    const t0 = performance.now();
    const s = await parallel(level, (i) => post("menu", call(sids[i]!, { Digits: "1" })));
    report("C balance enquiry", level, s, performance.now() - t0);
  }

  // D. concurrent legitimate transfers (100 minor units each)
  {
    const sids = await parallel(level, async (i) => {
      const sid = `LOAD-D-${run}-${i}`;
      await authenticateCall(sid, callers[i]!.account);
      await post("menu", call(sid, { Digits: "3" }));
      await post("transfer_recipient", call(sid, { Digits: recipient.account_number }));
      await post("transfer_amount", call(sid, { Digits: "100" }));
      return sid;
    });
    const t0 = performance.now();
    const s = await parallel(level, (i) => post("transfer_confirm", call(sids[i]!, { Digits: "1" })));
    const wall = performance.now() - t0;
    expectedTransfers.push(level);
    const done = sql(
      `select count(*) from public.transfers where tenant_id='${TA}' and status='COMPLETED' and amount=1.0000`,
    );
    report("D concurrent transfers", level, s, wall, { completed_transfers_running_total: Number(done) });
  }

  // E. duplicate / retried callbacks for one confirmed transfer
  {
    const sid = `LOAD-E-${run}`;
    await authenticateCall(sid, callers[0]!.account);
    await post("menu", call(sid, { Digits: "3" }));
    await post("transfer_recipient", call(sid, { Digits: recipient.account_number }));
    await post("transfer_amount", call(sid, { Digits: "200" }));
    const before = Number(sql(`select count(*) from public.transfers where tenant_id='${TA}'`));
    const t0 = performance.now();
    const s = await parallel(level, () => post("transfer_confirm", call(sid, { Digits: "1" })));
    const wall = performance.now() - t0;
    const after = Number(sql(`select count(*) from public.transfers where tenant_id='${TA}'`));
    report("E duplicate/retried callbacks", level, s, wall, {
      transfers_created_by_the_retries: after - before,
      duplicate_safe: after - before === 1,
    });
    expectedTransfers.push(1);
  }

  // F. mixed realistic traffic
  {
    const t0 = performance.now();
    const s = (
      await parallel(level, async (i) => {
        const sid = `LOAD-F-${run}-${i}`;
        const mine: Sample[] = await authenticateCall(sid, callers[i]!.account);
        const pick = i % 4;
        if (pick === 0) mine.push(await post("menu", call(sid, { Digits: "1" })));
        else if (pick === 1) mine.push(await post("menu", call(sid, { Digits: "2" })));
        else if (pick === 2) mine.push(await post("menu", call(sid, { Digits: "4" }))); // customer care
        else {
          mine.push(await post("menu", call(sid, { Digits: "7" }))); // invalid key, retry path
          mine.push(await post("menu", call(sid, { Digits: "9" })));
        }
        return mine;
      })
    ).flat();
    report("F mixed traffic", level, s, performance.now() - t0);
  }

  run += 1;
}

// -------------------------------------------------- financial invariants
console.log("\n--- financial integrity after load ---");
const expectedTotal = expectedTransfers.reduce((a, b) => a + b, 0);
const invariants: Array<[string, string, boolean]> = [];

const transfers = Number(sql(`select count(*) from public.transfers where tenant_id='${TA}'`));
invariants.push(["transfers created", `${transfers} (expected ${expectedTotal})`, transfers === expectedTotal]);

const failedTransfers = Number(
  sql(`select count(*) from public.transfers where tenant_id='${TA}' and status<>'COMPLETED'`),
);
invariants.push(["non-completed transfers", String(failedTransfers), failedTransfers === 0]);

const entriesPerTransfer = sql(
  `select coalesce(string_agg(distinct n::text, ','),'none') from (select count(*) n from public.ledger_entries e join public.transfers t on t.transaction_id=e.transaction_id where t.tenant_id='${TA}' group by e.transaction_id) x`,
);
invariants.push(["ledger entries per transfer", entriesPerTransfer, entriesPerTransfer === "2"]);

const idem = Number(sql(`select count(*) from public.financial_idempotency where tenant_id='${TA}'`));
invariants.push(["idempotency records", String(idem), idem >= transfers]);

const drift = sql(
  `select coalesce(string_agg(account_number||' drift '||drift, '; '),'none') from public.reconcile_account_balances('${TA}') where drift <> 0`,
);
invariants.push(["reconciliation drift", drift, drift === "none"]);

const crossTenant = Number(
  sql(
    `select count(*) from public.transfers t join public.customer_accounts s on s.id=t.sender_account_id join public.customer_accounts r on r.id=t.recipient_account_id where t.tenant_id='${TA}' and (s.tenant_id<>t.tenant_id or r.tenant_id<>t.tenant_id)`,
  ),
);
invariants.push(["cross-organization transfers", String(crossTenant), crossTenant === 0]);

const dupEvents = Number(
  sql(
    `select count(*) from (select provider, provider_event_id from public.call_session_events group by 1,2 having count(*)>1) d`,
  ),
);
invariants.push(["duplicate provider events stored", String(dupEvents), dupEvents === 0]);

let failures = 0;
for (const [name, value, ok] of invariants) {
  if (!ok) failures += 1;
  console.log(`   ${ok ? "PASS" : "FAIL"}  ${name.padEnd(32)} ${value}`);
}

const summary = { levels: LEVELS, rows: results, invariants: invariants.map(([n, v, ok]) => ({ n, v, ok })) };
await Bun.write("/tmp/p25/load-results.json", JSON.stringify(summary, null, 2));
console.log("\nresults written to /tmp/p25/load-results.json");

cleanup();
if (failures > 0) {
  console.log("\nGate C FAILED: financial integrity did not hold under load.");
  process.exit(1);
}
console.log("\nGate C load run complete: financial integrity held at every level.");
