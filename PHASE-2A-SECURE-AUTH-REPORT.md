# CreditVoice OS — Phase 2A: Secure Voice Authentication & Call Session Layer

The secure boundary between a future telephone call and the existing credit
engine. No telephony provider, no SIP, no IVR and no voice AI is introduced.

---

## 1. Executive summary

Phase 2A adds a persistent, telephony-neutral authentication and session
subsystem. A call is now a first-class database record that must walk a strict
state machine — destination number to organization, organization access code,
account number, customer PIN — before any identity exists at all. Every step is
resolved from trusted database state; nothing the caller asserts is ever
believed.

Credential hashes are read only by the trusted server, compared in memory and
discarded. Failed attempts are counted atomically under row locks, lock out at
the configured thresholds, and are written to a security log that survives the
rejection. Duplicate provider events are rejected exactly once. Sessions expire
on time alone, with no dependency on a background worker.

The financial engine was not touched. `post_credit`, `execute_transfer` and
`reverse_transfer` remain the only money-moving authority; voice is simply
another channel that will call them with a server-derived identity.

**Test results: Phase 1 — 40 database assertions + 2 concurrency proofs, all
passing. Phase 2A — 65 database assertions + 3 concurrency proofs + 5 credential
hashing tests, all passing. Executed against the live database.**

---

## 2. Existing architecture reviewed

Read before any change: `README.md`, `PRE-TELEPHONY-HARDENING-REPORT.md`, all 16
existing migrations, every table, function, trigger, policy and grant, plus
`src/lib/`, `src/lib/services/`, `src/lib/*.functions.ts`, `src/lib/telephony/`,
`src/lib/secure-hash.server.ts`, the auth middleware and every route.

Already present and reused unchanged:

| Mechanism | Reused as |
|---|---|
| `tenant_access_codes` (PBKDF2-SHA256, `failed_attempts`, `locked_until`, `retired_at`) | organization credential store |
| `customer_pins` (PBKDF2-SHA256, `failed_attempts`, `locked_until`) | customer credential store |
| `secure-hash.server.ts` (`hashSecret` / `verifySecret`, 150,000 iterations) | the only comparison routine |
| `phone_numbers` lifecycle and `tenants.status` / `currency_approved` | organization resolution and operational gate |
| `audit_logs` (append-only) | security event trail |
| `financial_idempotency` | left strictly for financial operations |
| `TelephonyProvider` contract | untouched; still `NONE` |

Nothing was duplicated, redesigned or rewritten; every change is a new
migration.

---

## 3. New call-session architecture

```
Telephony adapter (Phase 2B)      ← the only place a provider will ever appear
        │  numbers, digits, provider event id
        ▼
src/lib/voice/call-session.server.ts      ← trusted server service
        │  session id only
        ▼
cv_* database functions (SECURITY DEFINER, service_role only)
        │
        ├── call_sessions          state machine + resolved identity
        ├── call_session_events    one row per provider event (replay guard)
        ├── call_auth_failures     durable security failure log
        └── audit_logs             security event trail
        │
        ▼
AuthenticatedCallContext  →  existing credit engine  →  immutable ledger
```

### Tables

- **`call_sessions`** — provider, provider call/event id, from/to numbers,
  resolved `tenant_id` / `customer_id` / `account_id`, `state`,
  `authentication_stage`, `attempt_count`, `access_code_attempts`,
  `pin_attempts`, `last_activity_at`, `authenticated_at`, `ended_at`,
  `failure_reason`, `metadata`, timestamps. No credential material is ever
  written, including into `metadata`.
- **`call_session_events`** — unique `(provider, provider_event_id)`.
- **`call_auth_failures`** — session, organization, numbers, stage, reason
  category, attempt number, timestamp. No credentials.

### Service interface (`src/lib/voice/`)

`createCallSession`, `resolveTenant` (alias `resolveTenantFromPhoneNumber`),
`verifyTenantAccessCode`, `identifyAccount` (alias `resolveCustomerAccount`),
`verifyCustomerPin`, `getAuthenticatedSession`, `authorizeAction`,
`endCallSession`, `expireCallSessions`, `claimProviderEvent`, plus
`requireCallContext` and `getCallAccountSummary`. No provider type appears in
any signature; the engine runs with `provider = "NONE"`.

---

## 4. Authentication state machine

```
NEW → TENANT_RESOLVED → ACCESS_CODE_VERIFIED → ACCOUNT_IDENTIFIED
    → PIN_VERIFIED → AUTHENTICATED → PROCESSING → COMPLETED → ENDED
```

Any live state may also go to `FAILED`, `LOCKED`, `EXPIRED` or `ENDED`;
terminal states may only go to `ENDED`. Transitions are validated by
`cv_transition_allowed` and applied by `cv_apply_transition`, which takes a row
lock and raises on any illegal move. `NEW → AUTHENTICATED` is impossible, and
each step function refuses to run unless the session is in the exact preceding
state. Stages (`TENANT_RESOLUTION`, `ACCESS_CODE`, `ACCOUNT_IDENTIFICATION`,
`PIN`, `AUTHENTICATED`, `CLOSED`) and actions
(`CHECK_BALANCE`, `VIEW_ACCOUNT`, `TRANSFER_CREDIT`, `END_SESSION`) are database
enums, not loose strings.

---

## 5. Organization resolution

`cv_resolve_tenant(session_id)` uses the dialled number only. The number must
exist, be voice-capable, be `ACTIVE`, be assigned to an organization, and that
organization must be `ACTIVE` with an approved currency. A caller can never
supply an organization id.

Every failure — unknown number, unassigned, inactive, non-voice, suspended or
closed organization — returns the identical generic result, records
`TENANT_RESOLUTION_FAILED` with no organization attached, writes a failure row,
and fails the session.

---

## 6. Access-code verification

1. `cv_begin_access_code_attempt` locks the active, non-retired code row,
   refuses if the session or credential is locked, audits `ACCESS_CODE_ATTEMPT`
   and returns the stored hash **to the trusted server only**.
2. The server compares with the existing PBKDF2-SHA256 routine and drops the
   hash.
3. `cv_finish_access_code_attempt` applies the result atomically: success resets
   the counter, clears the lock and advances the session; failure increments
   `failed_attempts` in a single statement, locks for 15 minutes at the
   threshold (default 5), writes the failure row and audits
   `ACCESS_CODE_REJECTED` / `ACCESS_CODE_LOCKED`.

Rotation retires the old record, so a previous code can never be selected again,
and the fresh record starts unlocked. No message distinguishes unknown
organization, retired code, wrong code or locked code.

---

## 7. Account resolution

`cv_identify_account(session_id, account_number)` runs only after the access code
is verified and is scoped by `tenant_id = session.tenant_id` — an unscoped lookup
is structurally impossible because the number never leaves the function.
The account must be `ACTIVE` and its customer must be `ACTIVE`. Failures are
generic, counted, audited as `ACCOUNT_IDENTIFICATION_FAILED`, and lock the call
at the session allowance. Because account numbers are unique per organization
and not globally, the same number in another organization resolves nothing here.

---

## 8. PIN verification

Same two-phase shape as the access code: `cv_begin_pin_attempt` locks the PIN row
for the customer already bound to the session, refuses when locked, and hands the
hash to the trusted server; `cv_finish_pin_attempt` applies the outcome
atomically. Success resets the counter and moves the session
`PIN_VERIFIED → AUTHENTICATED` with `authenticated_at` set; failure increments,
locks for 15 minutes at the threshold (default 3), logs and audits.

The PIN is never stored in the session, never returned, never logged and never
placed in audit metadata — a test asserts the audit trail contains no PIN or hash
text.

---

## 9. Lockout and rate limiting

Four persisted layers, all in PostgreSQL — restarting the server resets nothing:

| Layer | Control |
|---|---|
| Credential | `failed_attempts` + `locked_until` on `tenant_access_codes` and `customer_pins` |
| Session (per credential) | `access_code_attempts`, `pin_attempts` |
| Session (total) | `attempt_count` against `call_max_session_attempts` |
| Caller | failures from the same originating number within a rolling window lock a new call immediately |

Thresholds live in `platform_settings`: `call_session_ttl_seconds` (180),
`call_max_access_code_attempts` (5), `call_max_pin_attempts` (3),
`call_max_session_attempts` (9), `call_caller_failure_window_minutes` (15),
`call_caller_failure_limit` (12).

---

## 10. Replay protection

`cv_claim_session_event` inserts into `call_session_events` and relies on the
unique `(provider, provider_event_id)` index. A duplicate raises
`unique_violation`, which is caught and returned as `false` after auditing
`CALL_SESSION_REPLAY_REJECTED`. The financial idempotency table is untouched and
remains reserved for money movement, exactly as instructed.

---

## 11. Session lifecycle

Every entry point loads the session through `cv_load_live_session`, which takes a
row lock and expires the session in place when `last_activity_at` is older than
the configured lifetime. Expiry is therefore correct on timestamps alone;
`cv_expire_call_sessions()` is a convenience sweep, not a correctness
requirement. Expired, ended, failed and locked sessions can perform no action.
Indexes `(state, last_activity_at)`, `(tenant_id, created_at)` and
`(from_number, created_at)` support live lookups.

---

## 12. Security model

```
dialled number ─► phone_numbers + tenants (active, voice, approved) ─► tenant_id
tenant_id      ─► active access code hash ─► PBKDF2 compare ─► ACCESS_CODE_VERIFIED
tenant_id + account number ─► customer_accounts (tenant-scoped, active)
                               + customers (active) ─► account_id, customer_id
customer_id    ─► PIN hash ─► PBKDF2 compare ─► AUTHENTICATED
session_id     ─► AuthenticatedCallContext {tenant, customer, account}
```

`AuthenticatedCallContext` carries only server-derived identity plus the last
four digits of the account number; it contains no PIN, access code, password or
hash. `cv_authorize_action` re-checks, on every action, that the session is
authenticated and unexpired, that the target account is the session's own
account, that the organization is `ACTIVE` with an approved currency and that
both account and customer are still active. Session existence alone authorises
nothing, and a caller-supplied tenant, customer or account id is either ignored
or rejected as `ACCOUNT_NOT_IN_SESSION`.

---

## 13. Audit and failure recording

New events: `CALL_SESSION_CREATED`, `TENANT_RESOLUTION_FAILED`,
`ACCESS_CODE_ATTEMPT`, `ACCESS_CODE_VERIFIED`, `ACCESS_CODE_REJECTED`,
`ACCESS_CODE_LOCKED`, `ACCOUNT_IDENTIFIED`, `ACCOUNT_IDENTIFICATION_FAILED`,
`PIN_ATTEMPT`, `PIN_VERIFIED`, `PIN_REJECTED`, `PIN_LOCKED`,
`CALL_SESSION_AUTHENTICATED`, `CALL_SESSION_EXPIRED`, `CALL_SESSION_ENDED`,
`CALL_SESSION_REPLAY_REJECTED`.

Metadata carries only attempt numbers and reason categories such as
`INVALID_CREDENTIAL`, `CREDENTIAL_UNAVAILABLE`, `ACCOUNT_UNAVAILABLE`,
`SESSION_ATTEMPTS_EXCEEDED`, `CALLER_RATE_LIMITED`.

**Failure auditing survives.** Authentication rejections return a status instead
of raising, so the audit row and the `call_auth_failures` row commit with the
attempt counter. The Phase 1 weakness therefore no longer applies to the
authentication path. Financial failure auditing is unchanged and remains an open
launch blocker rather than being patched unsafely.

---

## 14. RLS and grants

- `call_sessions`: `SELECT` to `authenticated` under RLS — platform admins see
  all, organization admins see their own organization only. No insert, update or
  delete privilege for any client role.
- `call_session_events`: `SELECT` to `authenticated`, platform admins only.
- `call_auth_failures`: no client grant at all; platform-admin policy only.
- `service_role` holds full table access and is the only role with `EXECUTE` on
  the `cv_*` engine functions.

Every new `SECURITY DEFINER` function sets `search_path = public`, validates its
inputs, derives all identity from the session row, returns no credential to any
client-reachable path, and was explicitly revoked from `public`, `anon` and
`authenticated` before being granted to `service_role`. The database linter
reports the same eight pre-existing intentional warnings as after Phase 1 — no
new function is callable by signed-in users, and the broad
`GRANT ALL TO authenticated` problem was not reintroduced.

Sandbox-only fixtures (`cv_test_voice_setup`, `cv_test_voice_cleanup`,
`cv_test_set_tenant_status`, `cv_test_rotate_access_code`,
`cv_test_seed_caller_failures`, `cv_test_credential_state`) refuse to run unless
`session_user = 'sandbox_exec'`, refuse to touch non-`QA %` organizations, and
never return a stored credential.

---

## 15. Tests

`supabase/tests/phase2a.sql` — **65 assertions, 65 passed, 0 failed**, executed
against the live schema and rolled back.

- Tenant resolution: valid, unknown, unassigned, inactive, non-voice, suspended,
  closed; no organization leaked on failure.
- Access code: correct, incorrect, atomic counting, lockout, persisted lock,
  locked credential blocks a new call, rotation invalidates the old code and
  clears the lock, retired code never reselected, counter reset on success.
- Account: valid, unknown, suspended account, inactive customer, tenant scoping,
  cross-organization account unreachable.
- PIN: correct, incorrect, atomic counting, lockout persisted, counter reset,
  no PIN or hash anywhere in the audit trail.
- Session: ordered transitions enforced, `NEW → AUTHENTICATED` refused, illegal
  transition raises, stage prerequisites enforced, expiry on next use, expired
  and ended and locked sessions cannot act, bulk sweep.
- Replay: first event accepted, duplicate rejected, audited, stored once.
- Identity and authorization: server-derived identity returned, minimal fields
  only, another account refused, suspended own account refused, suspended
  organization refused, caller throttle.
- Privileges: signed-in users see no sessions, cannot insert sessions, cannot
  execute the engine, cannot read credential material, cannot read the failure
  log.

`supabase/tests/phase2a-concurrency.sh` — **3 proofs, all passed** (real
parallel sessions):

1. Eight simultaneous invalid PIN attempts → session `LOCKED`, counted attempts
   exactly 3 (the allowance).
2. Ten simultaneous submissions of one provider event → accepted once, stored
   once.
3. Simultaneous success and failure on one session → one consistent final state
   (`AUTHENTICATED`) with exactly one authentication event.

`supabase/tests/phase2a-hash.test.ts` — **5 tests passed**: plaintext never
present in the stored value, correct credential verifies, incorrect and empty do
not, per-secret salt, issued codes well formed.

Phase 1 suites re-run unchanged: **40 assertions passed**, **2 concurrency
proofs passed**.

```bash
bun run test:db              # Phase 1 — 40 assertions
bun run test:concurrency     # Phase 1 — 2 concurrency proofs
bun run test:voice           # Phase 2A — 65 assertions
bun run test:voice:concurrency  # Phase 2A — 3 concurrency proofs
bun run test:hash            # Phase 2A — 5 credential hashing tests
```

---

## 16. Remaining risks

- **Financial failure auditing is still open.** A rejected transfer or credit
  still rolls back its own audit row. Deliberately not patched here.
- **No signed webhook yet.** Replay protection exists, but nothing verifies a
  provider signature because no provider exists; that arrives in Phase 2B.
- **Caller-number throttling can be defeated by spoofing.** It is a speed bump,
  not a boundary; the credential and session limits are the real controls.
- **Lockout windows are fixed at 15 minutes** in the credential update
  statements, while the attempt thresholds are configurable.
- **Sandbox test helpers exist in the database** and must be dropped before a
  production cutover — now six more of them.
- **No IP or geography signal** is available until a provider supplies one; the
  `ip_address` audit column stays empty for calls.
- **Per-currency rounding is still unenforced** on input, which matters once
  amounts are spoken aloud.
- **Session lifetime of 180 seconds is a guess** and should be tuned against real
  IVR timings.
- **No load testing** of the authentication path beyond the concurrency proofs.

---

## 17. Requirements for Phase 2B

**CreditVoice OS — Phase 2B: Twilio Voice Adapter + Signed Webhook + IVR Engine**

1. **Signed webhook route** at `src/routes/api/public/voice/twilio` verifying the
   Twilio signature before anything else, rejecting unsigned or stale requests,
   and mapping the provider event id through `claimProviderEvent` on every
   callback.
2. **Twilio implementation of `TelephonyProvider`** (`answerCall`, `speak`,
   `gatherDigits`, `transferCall`, `hangup`), selected by configuration, with
   `NONE` kept for tests. Credentials as secrets, never in source.
3. **IVR conversation engine** driving the existing state machine only: welcome,
   access code, account number, PIN, menu. It must call the Phase 2A service and
   add no authentication logic of its own.
4. **Customer actions on the authenticated context** — balance enquiry, account
   details, then transfers calling `execute_transfer` with the provider event id
   as the idempotency key. No new financial function.
5. **Per-currency rounding and amount validation** enforced in the engine before
   any amount is spoken or accepted.
6. **Customer care routing** honouring the existing `customer_care_settings`
   (mode, business hours, timezone, after-hours, voicemail).
7. **Resumption and timeouts** using `last_activity_at`, plus call recording and
   transcript policy decisions.
8. **Operational readiness**: financial failure auditing, scheduled
   reconciliation with alerting, removal of the sandbox test helpers, and a
   load test of the authentication path.

Phase 2B must not alter the credit engine or the Phase 2A authentication
contract.
