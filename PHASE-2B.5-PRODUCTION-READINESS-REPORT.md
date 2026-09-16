# CreditVoice OS — Phase 2B.5 Production Readiness & Pilot Gate

**Date of execution:** 15–16 September 2026 (UTC)
**Scope:** close and verify the four outstanding production-readiness blockers
left by the Phase 2B forensic audit. No product features were added, no
architecture was changed, and Phase 2C was not started.

---

## 1. Executive summary

**FINAL DECISION: NO-GO for a controlled pilot — one gate could not be executed.**

| Gate | Outcome |
|------|---------|
| A — Development test helpers removed from the production area | **PASS** |
| B — Backup and restore drill | **PASS WITH LIMITATIONS** (one real defect found and fixed) |
| C — Load testing | **PASS** (bottleneck not reached within safe infrastructure) |
| D — Controlled live Twilio telephone call | **NOT EXECUTED — BLOCKED** |

Three of the four gates passed on measured evidence. Gate D is an automatic
NO-GO condition under rule 11 ("live Twilio call cannot reach the application"
— here it could not even be attempted): the environment has no Twilio
connection, no Twilio credentials, no published HTTPS hostname and no
telephone. Nothing about the software is known to be wrong; the evidence for
live telephony simply does not exist, and this report will not fabricate it.

The drill also found a genuine defect that would have made a real restore fail
(section 3.2). It is fixed, with the fixture that caused it corrected.

**Everything required for a GO except Gate D is now in place.** Once a real
signed inbound call is completed against a deployed environment, the remaining
decision is a one-gate re-run, not a re-audit.

---

## 2. Gate A — remove development test helpers

### What was found

12 `SECURITY DEFINER` helpers existed in the `public` schema, the schema
exposed through the data API: `cv_test_add_account`, `cv_test_admin`,
`cv_test_cleanup`, `cv_test_credential_state`, `cv_test_fund_account`,
`cv_test_rotate_access_code`, `cv_test_seed_caller_failures`,
`cv_test_set_care`, `cv_test_set_tenant_status`, `cv_test_setup`,
`cv_test_voice_cleanup`, `cv_test_voice_setup`. Every one is referenced by the
test suites (`hardening.sql`, `phase2a.sql`, `phase2b.sql`, the three
concurrency scripts, and the end-to-end suite), so deletion alone would have
destroyed the regression matrix.

### What was done

A migration created a dedicated `cv_test` schema, relocated all 12 functions
into it owned by `postgres`, revoked every privilege from `anon`,
`authenticated` and `service_role` on the schema and on each function, granted
`USAGE`/`EXECUTE` only to the sandbox test role, and dropped every
`cv_test_*` function from `public`. The helpers additionally keep their own
internal guard (`session_user <> 'sandbox_exec'` raises). Test infrastructure
is therefore separated from the production schema rather than hidden.

### Verification

```
functions named cv_test_* in public            : 0
functions in schema cv_test                    : 12 (owner postgres, ACL sandbox_exec=X/postgres)
schema usage for anon/authenticated/service_role: none
bun run test:db      : 40/40 passed
bun run test:voice   : 65/65 passed
bun run test:ivr     : 56/56 passed
```

**Status: PASS.** Residual note: the helpers still exist in the same physical
database, in an unreachable schema. Removing the `cv_test` schema entirely is
possible the moment the test suites are pointed at a separate database; that is
recorded as an open item, not a blocker, because no application role can reach
it.

---

## 3. Gate B — backup and restore drill

### 3.1 Method

- **Representative dataset** seeded through the relocated fixtures into
  clearly-marked QA organizations: 3 organizations, 4 customers, 5 accounts
  with per-organization account numbers and credit limits, 5 transactions
  (2 opening credits, 2 transfers, 1 reversal), 8 ledger entries, 2 transfers,
  1 reversal, 4 idempotency records, 277 audit records, 19 call sessions,
  10 call authentication failures. All credentials are PBKDF2 hashes; no real
  customer data and no production credential was used.
- **Backup:** `pg_dump -n public -n cv_test -Fc` — 255,090 bytes, 5.37 s.
- **Integrity:** `pg_restore -l` read the archive table of contents cleanly.
- **Restore target:** an isolated PostgreSQL 17.9 instance created inside the
  sandbox with `initdb` under an unprivileged account, listening on a private
  socket. Production was never written to destructively at any point.
- **Restore:** 0.25 s, into a fresh database with the four Supabase roles and
  `pgcrypto` recreated, plus `auth.uid`/`auth.role`/`auth.jwt` stubs (the
  policies reference them; the `auth` schema is outside the application's
  backup scope).

### 3.2 Defect found by the drill (fixed)

The first restore **failed**: two foreign keys on `financial_failure_events`
could not be recreated because 4 rows referenced organizations and call
sessions that no longer existed. Root cause: the development cleanup fixture
deletes with `session_replication_role = 'replica'`, which disables foreign-key
enforcement, and it did not delete voice failure records or transfer grants
before deleting the calls and organizations they belonged to. The live database
therefore held rows that violated its own constraints — invisible during normal
operation, fatal on restore.

Fix (smallest safe change, one migration): the 4 orphaned rows were deleted,
and the fixture now removes transfer grants and financial failure records
before the sessions and organization. A whole-database orphan scan across all
42 foreign keys now reports zero orphans. **This defect is exactly the kind of
problem an un-restored backup hides, and is the main value delivered by this
gate.**

### 3.3 Post-fix verification — restored vs source

Both databases were measured with the identical 23-point query. Every value
matched exactly:

| Check | Source | Restored |
|---|---|---|
| tables / functions / RLS policies / RLS-enabled tables | 25 / 54 / 41 / 25 | 25 / 54 / 41 / 25 |
| organizations / customers / accounts | 3 / 4 / 5 | 3 / 4 / 5 |
| transactions / transfers / reversals / ledger entries | 5 / 2 / 1 / 8 | 5 / 2 / 1 / 8 |
| idempotency records / audit records | 4 / 277 | 4 / 277 |
| call sessions / auth failures / financial failure records | 19 / 10 / 0 | 19 / 10 / 0 |
| accounts whose balance differs from the ledger | 0 | 0 |
| duplicate account numbers within an organization | 0 | 0 |
| cross-organization transfers | 0 | 0 |
| transfers with a currency mismatch | 0 | 0 |
| `cv_test_*` functions in `public` | 0 | 0 |
| credentials stored other than as a PBKDF2 hash | 0 | 0 |

Reconciliation on the restored data reports no drift: every stored balance
equals its ledger-derived balance. Transfers and reversals are strictly
double-entry (2 entries, debit = credit). Credit issuance posts a single
customer-side entry with no platform contra account — unchanged existing
behaviour, identical in source and restore, recorded here as an accounting
observation, not a discrepancy.

### 3.4 Measurements and limitations

| Metric | Value |
|---|---|
| Backup duration | 5.37 s |
| Backup size | 255,090 bytes (small dataset) |
| Restore duration | 0.25 s |
| Restore result | Success (only the benign "schema public already exists") |
| Data verification | Identical on all 23 checks |
| Reconciliation on restored data | No drift |
| Observed RTO (this dataset, this environment) | < 10 s end to end |
| Observed RPO | **NOT MEASURED** |

**RPO is deliberately not stated.** A logical dump gives a point-in-time of
"when the dump ran". The managed platform's continuous/point-in-time recovery
was not exercised from here and its retention and recovery window were not
verifiable in this environment. The RTO above is for a 255 KB dataset and must
not be extrapolated to production volumes.

**Status: PASS WITH LIMITATIONS** — a real backup was really restored and
really verified; platform-level PITR and RPO remain unproven.

---

## 4. Gate C — load testing

### 4.1 Harness

`supabase/tests/phase2b-load.ts` (`bun run test:load`) drives the real signed
webhook handler — signature verification, session state machine, Phase 2A
credential checks, IVR engine and `execute_transfer` all included — against the
real database, using QA organizations created by the development fixtures.
Transfers are 1.00 NGN between two QA accounts inside one QA organization; no
production organization, customer or money was involved, and all fixtures are
removed at the end. This is an application-level load test, not a test of
Twilio's network.

### 4.2 Results (concurrency 5, 20, 50)

Every scenario, every level: **zero failed requests, zero 5xx, zero database
errors, zero timeouts.**

| Scenario | c=5 p50 / p95 | c=20 p50 / p95 | c=50 p50 / p95 / max | c=50 throughput |
|---|---|---|---|---|
| A inbound call + session creation | 1021 / 1165 ms | 695 / 839 ms | 1215 / 1339 / 1403 ms | 35.6 req/s |
| B authentication (4 turns) | 478 / 625 ms | 564 / 675 ms | 1053 / 1298 / 1537 ms | 42.1 req/s |
| C balance enquiry | 548 / 787 ms | 684 / 780 ms | 1232 / 1345 / 1404 ms | 35.6 req/s |
| D concurrent transfers | 489 / 513 ms | 616 / 699 ms | 1088 / 1225 / 1281 ms | 39.0 req/s |
| E duplicate/retried callbacks | 214 / 378 ms | 271 / 440 ms | 468 / 549 / 1087 ms | 46.0 req/s |
| F mixed traffic | 497 / 636 ms | 567 / 681 ms | 1023 / 1246 / 1879 ms | 45.6 req/s |

Totals across the run: 913 webhook turns, 913 successful, 0 rejected.

### 4.3 Financial integrity under load — mandatory check

After the full run (78 concurrent voice transfers executed):

```
PASS  transfers created                78 (expected 78)
PASS  non-completed transfers          0
PASS  ledger entries per transfer      2  (no single-sided or duplicate entries)
PASS  idempotency records              78
PASS  reconciliation drift             none
PASS  cross-organization transfers     0
PASS  duplicate provider events stored 0
```

Scenario E is the decisive one: at each level, 5 / 20 / 50 simultaneous
identical "confirm transfer" callbacks for one customer action produced
**exactly one** transfer every time.

### 4.4 What was and was not measured

Measured: per-request latency (p50/p95/p99/max), throughput, success and
rejection counts, HTTP status distribution, database errors, transfer
correctness, duplicate-transfer correctness, reconciliation.

Not measured: server CPU and memory (the harness runs in-process in the
sandbox, so host metrics are not attributable), database connection-pool
saturation behaviour under a real deployed topology, sustained soak duration,
and behaviour beyond 50 concurrent callers. Latency here is dominated by
network round trips to the managed database from the sandbox and is **not** a
production latency figure.

**No maximum capacity is claimed.** No bottleneck or error boundary appeared up
to 50 concurrent callers; latency grew roughly linearly with concurrency, which
is the expected shape. Higher levels were not run because that would have meant
uncontrolled load against the shared managed database.

**Status: PASS** on correctness and on the levels actually measured.

---

## 5. Gate D — controlled live Twilio call

**NOT EXECUTED. This is the blocking gate.**

Verified prerequisites and their actual state:

| Prerequisite | State |
|---|---|
| Public HTTPS deployment with a stable hostname | **Absent** — the project has never been published |
| `TELEPHONY_PROVIDER=TWILIO` with valid credentials | **Absent** — `TELEPHONY_PROVIDER` defaults to `NONE`; no `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` are configured |
| Twilio account / connection | **Absent** — no Twilio connection exists in this workspace |
| Twilio voice-capable number on an active organization | **Absent** — the number inventory holds no real number |
| A telephone able to place the call | **Not available to an automated agent** |

Consequently none of tests 1–11 (inbound call, tenant resolution, access code,
account identification, PIN, balance, account information, controlled transfer,
duplicate/retry safety, customer care, hangup) were performed against the real
telephone network, and neither were the live failure-handling scenarios.

Every one of those behaviours *is* exercised against the real webhook handler
with correctly computed Twilio signatures in `bun run test:voice:e2e`
(29 tests) and in the Gate C harness. That is strong evidence about the
software and **no evidence at all** about carrier audio, DTMF delivery,
Twilio's real signature over a real proxied URL, or real network latency. The
distinction is preserved deliberately.

**To close Gate D:** publish the application, connect Twilio, set
`TWILIO_WEBHOOK_BASE_URL` to the published origin, point a voice-capable
Twilio number's voice webhook at `POST /api/public/voice/twilio`, assign that
number to a dedicated pilot organization with an approved currency, an access
code and a funded test customer, then place one real call and record CallSid,
timestamps, webhook statuses, IVR progression and the resulting single transfer.

---

## 6. Secret and configuration audit

| Check | Result |
|---|---|
| `.env.example` contains credential values | **No** — names only, all values empty |
| Twilio account SID / auth token / API key patterns in the repository | **None found** |
| Private keys, passwords, connection strings with passwords, JWT-shaped secrets | **None found** |
| Service-role key or Twilio token in the browser bundle | **None** — the only match in `dist/client` is the literal provider label `"TWILIO"` |
| Secrets read server-side only | **Yes** — `src/lib/voice/config.server.ts` reads `process.env` inside server-only code; the webhook returns a bare 403 when configuration is missing, describing nothing to the caller |
| `NONE` provider keeps development and tests working | **Yes** — the suites set a throwaway token in-process; no Twilio account is needed |
| Test tokens | `phase2b_test_token` / `phase2b_load_token`, throwaway values in test files only, never valid anywhere |
| `.env` in version control | **Tracked, and not ignored.** It contains only the Supabase URL, project id and the *publishable* key — no secret. Recommendation: add `.env` to `.gitignore` before the pilot so a future secret cannot be committed by habit. No rotation is required for what is currently in it. |

No previously exposed real secret was found, so no rotation is recommended.

---

## 7. Full regression matrix

All commands run on 16 September 2026 against the live database.

| Command | Result |
|---|---|
| `bun run test:db` | **PASS** — 40 assertions, 0 failed |
| `bun run test:concurrency` | **PASS** — 30 distinct account numbers under 30 concurrent allocations; double spend blocked |
| `bun run test:voice` | **PASS** — 65 assertions |
| `bun run test:voice:concurrency` | **PASS** — credential lock, replay, transition races |
| `bun run test:hash` | **PASS** — 5 tests |
| `bun run test:twilio` | **PASS** — 27 tests (signature, TwiML, amount validation) |
| `bun run test:ivr` | **PASS** — 56 assertions |
| `bun run test:voice:e2e` | **PASS** — 29 tests |
| `bun run test:ivr:concurrency` | **PASS** — 3 concurrency proofs |
| `bun run test:load` (new, Gate C) | **PASS** — 913 turns, 0 failures, integrity held |
| `bun run build` | **PASS** — built, Nitro output generated |
| `bun run lint` | **FAIL (pre-existing, non-functional)** — 1865 errors: 1819 formatting-only (`prettier/prettier`), 46 style (`no-explicit-any`, `prefer-const`). Unchanged from before this phase; `bun run format` fixes the formatting class. |
| `bun run typecheck` | **DOES NOT EXIST** — the project has no typecheck script; type errors surface through `bun run build`, which passes. |

Nothing in Phase 1 financial integrity, Phase 1 tenant isolation, Phase 2A
authentication or concurrency, Phase 2B IVR, signatures, amount validation,
replay protection or transfer idempotency regressed.

---

## 8. Production-readiness scorecard

| Gate | Requirement | Result | Evidence | Status |
|---|---|---|---|---|
| A | Test helpers absent from the production area | 0 `cv_test_*` in `public`; 12 in a locked `cv_test` schema | schema/ACL query; suites still green | **PASS** |
| B | Backup created and integrity checked | 255,090 bytes in 5.37 s; TOC readable | `pg_dump` / `pg_restore -l` | **PASS** |
| B | Restore into an isolated environment | Restored in 0.25 s into a private PostgreSQL 17.9 | restore log, 1 benign notice | **PASS** |
| B | Reconciliation on restored data | No drift; 23/23 checks identical to source | comparison query | **PASS** |
| C | Meaningful load testing | 913 turns at 5/20/50 concurrency, 0 failures | `bun run test:load` | **PASS** |
| C | Financial integrity under load | 78 transfers, 78 expected, 2 entries each, no drift | invariant block | **PASS** |
| D | Live Twilio call | Not attempted — no credentials, no deployment, no line | section 5 | **BLOCKED** |
| D | Real authentication over the telephone | Not attempted | section 5 | **BLOCKED** |
| D | Real balance enquiry | Not attempted | section 5 | **BLOCKED** |
| D | Real controlled transfer | Not attempted | section 5 | **BLOCKED** |
| D | Replay protection in the real environment | Proven in simulation only | Gate C scenario E; e2e replay test | **PARTIAL** |
| D | Customer-care routing on a real call | Proven in simulation only | `test:ivr`, `test:voice:e2e` | **PARTIAL** |
| — | Secrets | No secret in repository, reports or browser bundle | section 6 | **PASS** |
| — | Regression suite | 10 suites green | section 7 | **PASS** |
| — | Production build | Succeeds | `bun run build` | **PASS** |

---

## 9. Financial integrity and security verification

- `execute_transfer` remains the sole money-moving authority; no alternative
  path was added in this phase.
- 78 concurrent voice transfers produced exactly 78 transfers, 156 ledger
  entries (2 per transfer), 78 idempotency records and zero balance drift.
- 50 simultaneous duplicate confirmations of one action produced one transfer.
- Balances in both the live and restored databases equal their ledger-derived
  values.
- No cross-organization transfer, no currency mismatch, no duplicate
  provider event, no duplicate account number within an organization.
- No credential is stored other than as a PBKDF2 hash, in either database.
- The two changes made in this phase were a schema relocation of test helpers
  and a data-hygiene fix. No RLS policy was weakened, no grant broadened, no
  financial function altered.

---

## 10. Known limitations and remaining risks

1. **No live telephony evidence** (blocking). Nothing is known about real
   carrier behaviour, DTMF delivery, or Twilio's signature over a real proxied
   request.
2. **Platform RPO/PITR unproven.** A logical dump was proven restorable; the
   managed platform's point-in-time recovery was not exercised.
3. **Load figures are environment-bound.** 35–46 requests/second here reflects
   sandbox-to-managed-database round trips, not a deployed topology. No
   capacity ceiling was found or is claimed.
4. **`cv_test` schema still exists** in the same database, unreachable by
   application roles. Remove it once the suites run against a separate
   database.
5. **7 `SECURITY DEFINER` functions remain callable by signed-in users**
   (`execute_transfer`, `post_credit`, `reverse_transfer`,
   `reconcile_account_balances`, `is_super_admin`, `current_user_role`,
   `current_user_tenant_id`). They enforce role, organization and status checks
   internally. Unchanged, previously accepted as MEDIUM.
6. **Scheduled reconciliation with alerting is still not implemented.**
   Reconciliation is manual.
7. **First administrator password delivery** is still "shown once on screen",
   with no forced reset.
8. **Recording policy** (retention, consent announcement, access auditing) is
   still undecided; recording remains off by default.
9. **Lint debt**: 1865 non-functional lint errors, mostly formatting.
10. **21 tenant-less call-session rows** remain from simulated test calls.
    Harmless and unreferenced; purge before the pilot for a clean audit trail.
11. **Dashboard-path failure auditing**: a rejected dashboard credit still
    rolls back its own audit row (voice-path failures are durably recorded).
12. **`.env` is tracked in version control** (currently contains no secret).

---

## 11. Pilot restrictions — to apply when Gate D closes

These are operating conditions, not features:

- One pilot organization only, onboarded and monitored by the operator.
- A small number of consenting early customers, individually briefed.
- Conservative per-transfer and per-day limits, set low and not raised
  automatically.
- Call recording stays disabled until the recording policy exists.
- Controlled operating hours at first, with customer care staffed.
- An operator watching the voice operations view during those hours.
- A written incident-response procedure, including who can suspend an
  organization and how.
- Manual reconciliation at least daily throughout the pilot.
- A documented rollback: unassign the Twilio number or set
  `TELEPHONY_PROVIDER=NONE` to take the line down without touching the ledger.
- No expansion of limits, customers or organizations without a written review.

---

## 12. Commands executed

```bash
# Gate A
psql "$SUPABASE_DB_URL" -Atc "select proname, pronamespace::regnamespace from pg_proc where proname like 'cv\_test\_%'"
# migration: create schema cv_test; alter function ... set schema cv_test; revoke ...; drop ... from public
bun run test:db && bun run test:voice && bun run test:ivr

# Gate B
psql "$SUPABASE_DB_URL" -f /tmp/p25/seed.sql
pg_dump "$SUPABASE_DB_URL" -n public -n cv_test -Fc -f cv_backup2.dump
pg_restore -l cv_backup2.dump
initdb -U postgres -D /tmp/p25/pgdata           # as an unprivileged user
pg_ctl -D /tmp/p25/pgdata -o "-p 55432 -k /tmp/p25" start
pg_restore -d "<isolated>" --no-owner cv_backup2.dump
psql "<isolated>" -f verify.sql ; psql "$SUPABASE_DB_URL" -f verify.sql
# 42-foreign-key orphan scan (source database)
# migration: delete orphaned financial_failure_events; fix cv_test_voice_cleanup

# Gate C
LOAD_LEVELS=5 bun run test:load
LOAD_LEVELS=5,20,50 bun run test:load

# Gate D
# not executed — no Twilio connection, no published hostname, no telephone line

# Secrets and regression
rg -n 'AC[0-9a-f]{32}|SK[0-9a-f]{32}|sb_secret_|BEGIN .*PRIVATE KEY|postgres://.*:.*@|eyJhbGciOi' .
rg -l 'TWILIO|service_role|cv_test_|pbkdf2' dist/client
bun run test:db test:concurrency test:voice test:voice:concurrency test:hash \
        test:twilio test:ivr test:voice:e2e test:ivr:concurrency
bun run build ; bun run lint
```

---

## 13. Final decision

**NO-GO — pending Gate D only.**

Gates A, B and C passed on measured evidence, a real restore defect was found
and fixed, and financial integrity held under every concurrency level tested.
The single reason for NO-GO is that CreditVoice OS has still never received a
real telephone call: the environment provides no Twilio account, no published
HTTPS endpoint and no telephone line, so the evidence cannot be produced here
and will not be invented.

Recommended next step: publish the application, connect Twilio, complete the
eleven live-call tests in section 5 against a dedicated pilot organization, and
re-run this gate. With that evidence, and with the pilot restrictions in
section 11 applied, the recommendation becomes GO for a controlled pilot —
never for unrestricted production scale.
