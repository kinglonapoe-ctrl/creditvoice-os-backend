# CreditVoice OS — Phase 2B Forensic Audit Report

Independent verification of the actual repository, database and test suites.
Documentation, comments and previous reports were treated as claims, not
evidence. Every control below was checked against source code, migrations,
live database catalogue state, or an executed test.

## Executive verdict

**PHASE 2B — PASSED WITH NON-BLOCKING FINDINGS.**

One genuine security defect was found and fixed (over-broad table privileges
granted to signed-in users on call and financial bookkeeping tables, plus a
development helper function exposed to signed-in users). Three regression
assertions were added. No financial-integrity, authentication, telephony or
information-leakage defect was found. The remaining findings are operational
and documentation issues, not code defects.

## Scope

Traced and verified end to end:

Twilio → signed webhook → call session → tenant resolution → access code →
account identification → PIN → authenticated context → IVR → customer action →
transfer authorization → `execute_transfer` → idempotency → immutable ledger →
balance projection → audit.

Not in scope and not performed: a live Twilio call (no real Twilio account,
credentials or public inbound number exists in this environment).

## Architecture verified

- `src/routes/api/public/voice/twilio.ts` is a thin POST-only route; GET returns
  405. It performs no logic and dynamically imports the server-only handler.
- `src/lib/voice/webhook.server.ts` verifies the Twilio signature as its first
  database-free operation, then enforces body size (64 KB), form parsing, and
  presence of `CallSid` and `To`.
- `src/lib/voice/ivr/engine.server.ts` holds no authentication state of its own;
  the `call_sessions` row is authoritative.
- `src/lib/voice/call-session.server.ts` (Phase 2A) is the only credential
  verifier. The IVR calls it; it does not reimplement any check.
- Money moves only through `cv_execute_voice_transfer` → `execute_transfer`.
  No alternative money-moving path exists in the voice layer (verified by
  reading every `voiceRpc` call site).

## Security findings

### FIXED — HIGH: signed-in users held write and TRUNCATE privileges on call and financial tables

`authenticated` held `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER,
REFERENCES` on `call_sessions`, `call_session_events`, `call_auth_failures`,
`financial_failure_events`, `financial_idempotency` and
`tenant_account_sequences`. Row-level security blocked the DML, but **RLS does
not restrict TRUNCATE**. Wiping `financial_idempotency` would remove
duplicate-payment protection; wiping the call/failure tables would destroy
security evidence.

Fix (migration, least privilege only):
- revoked all privileges on those six tables from `anon` and `authenticated`;
- re-granted `SELECT` only where a read policy already exists
  (`call_sessions`, `call_session_events`, `call_auth_failures`,
  `financial_failure_events`);
- `financial_idempotency` and `tenant_account_sequences` keep no client grants
  (their policies were already deny-all);
- `service_role` retains full access.

### FIXED — MEDIUM: development helper callable by signed-in users

`cv_test_admin(text, uuid)` was `EXECUTE`-granted to `authenticated`. Its body
refuses any caller whose `session_user` is not the sandbox test role, so it was
not exploitable, but exposure was unnecessary. `EXECUTE` revoked from
`authenticated`, `anon` and `PUBLIC`. The Phase 1 hardening suite was updated to
switch to the test role around the three helper calls, rather than relying on
the helper being client-callable.

### Verified correct

- **Signature verification** — HMAC-SHA1 over `url + sorted(key+value)`,
  base64, compared with a constant-time comparison. Missing signature or
  missing auth token returns false.
- **Canonical URL / host header** — the signed URL is rebuilt from the
  configured `TWILIO_WEBHOOK_BASE_URL` plus the request path and query. The
  `Host` header is never used, so proxy or host-header manipulation cannot
  change the signed string.
- **POST-only** — GET returns 405; non-POST in the handler returns 405.
- **Malformed requests** — oversized bodies, unparsable forms and missing
  `CallSid`/`To` return 400 with no detail.
- **Replay protection** — two independent layers: a per-turn fingerprint
  (`provider|CallSid|step|ivr_state|digits`) claimed atomically by
  `cv_ivr_claim_turn`, which returns the cached TwiML instead of advancing; and
  Phase 2A `call_session_events` provider-event uniqueness.
- **CallSid correlation** — sessions are located by `(provider,
  provider_call_id)`; a forged CallSid is unreachable without a valid signature.
- **Credentials never reach the browser** — no `TWILIO_*` or auth-token
  reference exists outside `*.server.ts`; configuration is read inside handlers
  via `process.env`, never at module scope, never with a `VITE_` name.
- **No caller-supplied identity** — tenant comes from the dialled number,
  account from the session, customer from the account. Nothing in the request
  body sets identity.
- **Direct RPC invocation** — as `authenticated`, every `cv_*` voice function
  (`cv_create_call_session`, `cv_prepare_transfer`, `cv_execute_voice_transfer`,
  `cv_voice_grant_valid`, `cv_ivr_set_state`, …) returns `permission denied`.

## Financial-integrity findings

- `execute_transfer` remains the sole financial authority; the voice layer calls
  it only through `cv_execute_voice_transfer`.
- Source account is always read from the authenticated session; the recipient is
  resolved tenant-scoped inside `cv_prepare_transfer`.
- Explicit confirmation is required: anything other than key `1` cancels and
  clears the pending transfer.
- The idempotency key is deterministic per transfer
  (`sha256(CallSid|pending_transfer_key)`), so a provider retry resolves to the
  original posting while two intentional transfers differ.
- No floating-point arithmetic touches money: DTMF amounts are parsed to
  `BigInt` minor units, capped below 10^15 (well inside exact integer range),
  and divided by the currency's decimal places in the database using `numeric`.
  Excess precision is rejected, never rounded.
- Ledger entries, transactions and settled transfers are immutable (verified by
  live delete/update attempts in the hardening suite).
- Financial failure auditing is written outside the rolled-back financial work
  (`financial_failure_events`), and rejected voice transfers appear there.

## Database / RLS findings

- RLS is enabled on every table in `public` (zero tables without it).
- Every `SECURITY DEFINER` function in `public` sets an explicit `search_path`
  (zero exceptions).
- `anon` now holds no privilege on any application table.
- Remaining `SECURITY DEFINER` functions callable by signed-in users are the
  intended application API: `execute_transfer`, `post_credit`,
  `reverse_transfer`, `reconcile_account_balances`, `is_super_admin`,
  `current_user_role`, `current_user_tenant_id`. Each enforces role, tenant and
  status internally. Accepted, documented as MEDIUM with mitigation.
- Deny-all policies confirmed on `customer_pins`, `tenant_access_codes`,
  `call_transfer_grants`, `financial_idempotency`, `tenant_account_sequences`.

## Telephony findings

- The Twilio adapter implements only transport concerns (say, gather, dial,
  hangup) and makes no authentication or financial decision.
- The adapter's per-turn state lives only for the duration of one webhook
  request, so it is safe on a stateless worker.
- `TELEPHONY_PROVIDER=NONE` keeps the application and the whole test matrix
  working with no Twilio credential. With `TWILIO` selected and any of
  `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WEBHOOK_BASE_URL` missing,
  configuration throws with variable **names only**, and the webhook fails
  closed with `403` — it never runs unverified.

## IVR findings

- States: WELCOME → ACCESS_CODE → ACCOUNT_NUMBER → PIN → MENU →
  {balance, account info, TRANSFER_RECIPIENT → TRANSFER_AMOUNT →
  TRANSFER_CONFIRM, customer care, end}. Unknown or corrupt `ivr_state` falls
  back to the menu; an unknown step cannot skip authentication because each
  transition re-reads the authoritative session.
- Terminal session states (EXPIRED, ENDED, FAILED, LOCKED, COMPLETED) answer
  with a generic message and never resume.
- Retry allowance is per-state and configurable; exhausting it ends the call.
- Empty input (Twilio timeout) is treated as a failed attempt, not a skip.
- Concurrent and replayed callbacks were proven safe by the concurrency suite
  (20 duplicate callbacks advanced the call once).

## Information-leakage findings

- Logging is allow-listed (`src/lib/voice/log.server.ts`): only request id, call
  sid, session id, tenant id, event type, IVR state, result and duration can be
  emitted. Raw request bodies, digits, signatures and tokens cannot pass through.
- Unhandled errors log only the error *name*; the caller hears a generic message.
- TwiML escapes every interpolated value, including organization-configured
  prompts, so configured text cannot inject markup.
- Spoken account identity is the masked last-4 reference, never the full number.
- Credential hashes are read, compared in memory, then nulled; they are never
  returned, audited or logged.
- Audit metadata carries stage and result codes only — no digits, no amounts
  entered before validation, no credentials.
- No Twilio secret, PIN or access code is reachable from browser code.

## Recording and voicemail

- `recording_enabled` defaults to false and is tenant-scoped in `ivr_settings`.
- Recording is only ever used for the voicemail branch of customer care, after
  the menu, so credentials entered during authentication cannot be captured.
- No retention, consent-announcement or recording-access auditing exists. The
  README correctly states recording stays off until that policy is decided.

## Configuration

- `.env.example` contains variable names only, no credentials.
- Secrets are server-only and read inside handlers.
- `TWILIO_WEBHOOK_BASE_URL` is the sole source of the signed URL base.
- Production configuration fails closed (403), never open.

## Documentation accuracy

- README and the Phase 2B report describe controls that do exist. The one
  inaccuracy found: launch blocker 2 ("remove the development test helpers")
  was still genuinely open, and the report did not mention that the helpers
  were also grant-exposed to signed-in users. That exposure is now closed; the
  helpers themselves still exist in the database and remain an open blocker.
- "Complete" in the README means feature-complete for the phase, which matches
  the code. "Production-ready" is not claimed for the voice path; the launch
  blocker list is accurate.

## Test results (all executed in this audit)

| Suite | Command | Result |
| --- | --- | --- |
| Phase 1 database + hardening | `bun run test:db` | 40 passed, 0 failed |
| Phase 1 concurrency | `bun run test:concurrency` | all proofs passed |
| Phase 2A database | `bun run test:voice` | 65 passed, 0 failed |
| Phase 2A concurrency | `bun run test:voice:concurrency` | all proofs passed |
| Credential hashing | `bun run test:hash` | 5 passed, 0 failed |
| Phase 2B database (incl. 3 new regressions) | `bun run test:ivr` | 56 passed, 0 failed |
| Twilio / signature / TwiML / amounts | `bun run test:twilio` | 27 passed, 0 failed |
| End-to-end simulated IVR | `bun run test:voice:e2e` | 29 passed, 0 failed |
| Phase 2B concurrency | `bun run test:ivr:concurrency` | 3 proofs passed |
| Build | `bun run build` | success |
| Lint | `bun run lint` | fails: 1884 formatting errors (see below) |

Gaps in what the tests prove:
- The end-to-end suite signs its own requests with a local token and calls the
  real handler and real database. It proves the handler's signature logic and
  the full call path; it does **not** prove Twilio's own request format in
  production.
- No test exercises a real inbound PSTN call, real audio or real DTMF timing.

## Adversarial test results

| Attempt | Result |
| --- | --- |
| Forged / absent Twilio signature | Rejected 403 |
| Modified POST parameter after signing | Rejected 403 |
| Modified canonical URL / host header | Rejected (base URL is configured, not derived) |
| Replayed identical callback | Cached response replayed; call did not advance |
| 20 concurrent duplicate callbacks | Processed once |
| 6 concurrent duplicate transfer confirmations | Exactly one transfer posted |
| Manipulated CallSid | Unreachable without a valid signature |
| Manipulated dialled number / unassigned number | Generic failure, no enumeration |
| Cross-tenant recipient | Rejected; recipient lookup is tenant-scoped |
| Unauthenticated / expired session action | Refused, call ended generically |
| Reused or substituted voice grant | Refused (`cv_voice_grant_valid`, single-use nonce) |
| Excessive amount precision, zero, negative, overflow, malformed DTMF | All rejected, never rounded |
| Direct invocation of protected `cv_*` RPCs as a signed-in user | `permission denied` |
| `TRUNCATE` of call / idempotency tables as a signed-in user | `permission denied` (after fix) |
| Reading `customer_pins` / `tenant_access_codes` as a signed-in user | `permission denied` |
| Reading another organization's data | Blocked by RLS |

## Defects fixed

1. Over-broad `authenticated` privileges on six call/financial tables (HIGH).
2. `cv_test_admin` executable by `authenticated` (MEDIUM).

Regression coverage added to `supabase/tests/phase2b.sql`:
- no write or truncate grants on voice/financial tables;
- anonymous role has no access to voice/financial tables;
- development test helpers are not exposed to clients.

## Remaining risks

- **MEDIUM** — `cv_test_*` helpers still exist in the database. They refuse
  non-sandbox callers and are no longer client-granted, but they should be
  dropped before production.
- **MEDIUM** — The seven application `SECURITY DEFINER` functions callable by
  signed-in users are correct by internal checks rather than by grant. Any
  future weakening of those internal checks is directly exploitable.
- **MEDIUM** — No live Twilio verification has ever been performed.
- **LOW** — `bun run lint` reports 1884 pre-existing Prettier formatting errors
  across the repository. No logic or security rule failures; `bun run format`
  would clear them.
- **LOW** — Voice amount minor units cross a JSON boundary as a JavaScript
  number. The parser caps amounts below 10^15, inside exact integer range, so
  no precision is lost today; raising that cap would require a string transport.

## Production blockers

**CRITICAL:** none outstanding.

**HIGH:**
1. Live Twilio verification: signed inbound call, authentication, balance and a
   real transfer against a staging organization.
2. Load testing of the call and authentication path.
3. Backup and restore drill proving point-in-time recovery of the ledger.

**MEDIUM:**
4. Drop the `cv_test_*` helpers from the production database.
5. Scheduled reconciliation with operator alerting.
6. Administrator password delivery and forced reset.
7. Recording retention, consent and access-auditing policy (recording stays off).

**LOW:**
8. Repository formatting (`bun run format`).

### Reassessment of the Phase 2B launch blockers

| Original blocker | Status |
| --- | --- |
| Failure auditing for the dashboard path | Partially resolved — voice failures are durable; a rejected dashboard credit still rolls back its own audit row |
| Remove development test helpers | Still open — exposure reduced, helpers still present |
| Scheduled reconciliation with alerting | Still open |
| Administrator password delivery | Still open |
| Backup and restore drill | Still open |
| Recording policy | Still open, correctly classified |
| Load testing | Still open |

Nothing previously claimed as closed was found to be incorrectly classified.

## Exact commands executed

```
bun run test:db
bun run test:concurrency
bun run test:voice
bun run test:voice:concurrency
bun run test:hash
bun run test:twilio
bun run test:ivr
bun run test:voice:e2e
bun run test:ivr:concurrency
bun run build
bun run lint
psql -c "<catalogue queries: pg_proc security definer + search_path, information_schema.role_table_grants, information_schema.routine_privileges, pg_policies, pg_class relrowsecurity>"
psql -c "set role authenticated; <adversarial truncate / RPC / credential-table probes>"
rg -n "TWILIO_|authToken" src --glob '!*.server.ts'
```

## Final recommendation

**PHASE 2B — PASSED WITH NON-BLOCKING FINDINGS.**

The audited implementation matches its stated security model: Twilio is
transport only, Phase 2A is the sole authentication authority, and the existing
financial engine is the sole money authority. The one real defect found was a
privilege-surface defect, now fixed with least-privilege grants and regression
tests. Before real money and real customers, close the HIGH blockers above,
with live Twilio verification first.
