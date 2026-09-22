# Phase 2B.6 — Live Twilio Telephony Verification (Gate D)

**Status: Gate D — NOT YET PASSED (live acceptance sequence incomplete).**
**Nigeria Local Number Readiness — PENDING** (separate provisioning/regulatory concern; not tested here).

## Environment

| Item | Value |
| --- | --- |
| Telephony provider | Twilio (existing US local number, from `TWILIO_VOICE_NUMBER`) |
| Webhook URL | `https://creditvoice.lovable.app/api/public/voice/twilio` (POST) |
| Signature verification | Enabled; canonical URL derived from `TWILIO_WEBHOOK_BASE_URL`, never the Host header |
| Recording / transcription | Disabled |
| Config variables | `TELEPHONY_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VOICE_NUMBER`, `TWILIO_WEBHOOK_BASE_URL` — all PRESENT |

## Test account (non-sensitive identifiers)

| Item | Value |
| --- | --- |
| Pilot organisation | CreditVoice Pilot (NG, NGN, ACTIVE) |
| Caller account number | 10001 (opening balance ₦10,000.00, credited via `post_credit`) |
| Recipient account number | 10002 |
| Access code / PINs | Not documented (secrets) |

---

## Live Attempt #1 — Access Code Failure

- **Date/time:** 2026-09-21 17:00:49Z (call 1) and 2026-09-21 17:41:30Z (call 2, same fault)
- **CallSid:** `CA512313f5299e21dac961721a625b11f5`, `CA3628bcf406f14820cfadaabf4b1a54d6`
- **Call sessions:** `56d2460f-f42b-4ef2-9c3d-9d8304df9f85`, `cac628bc-34f2-4767-a9ce-51c2876c7d7e`
- **Observed:** call answered, welcome prompt played, access code accepted by `<Gather>`; on submission the caller heard "This application has an error."

### Failure stage

Webhook step `?step=access_code` → IVR engine → `verifyAccessCode` (`src/lib/voice/call-session.server.ts:80`)
→ `verifySecret` (`src/lib/secure-hash.server.ts`).

Production worker log (verbatim):

```
[voice] unhandled webhook failure NotSupportedError
{"channel":"voice","call_sid":"CA3628bcf406f14820cfadaabf4b1a54d6","event_type":"CALL_FAILED","result":"INTERNAL_ERROR"}
POST /api/public/voice/twilio?step=access_code → 500
```

### Root cause

`hashSecret`/`verifySecret` used **150,000 PBKDF2 iterations**. The production edge runtime
(workerd) hard-rejects PBKDF2 derivations above **100,000 iterations** with a
`NotSupportedError` DOMException. Every access-code and PIN verification therefore threw in
production, while the same code passed locally on Node (no such cap). The generic TwiML error
response is the webhook's safe catch-all — it correctly hid the cause from the caller and logged
it server-side with the CallSid.

Everything upstream was proven working by this call: real phone → Twilio → signed webhook →
signature verification → call session creation → tenant resolution (state `TENANT_RESOLVED`,
stage `ACCESS_CODE`) → `<Gather>` DTMF collection. No financial code was reached.

### Evidence

- Call sessions exist with state `TENANT_RESOLVED`, stage `ACCESS_CODE`, `access_code_attempts = 0`
  (the attempt aborted before the counter was committed).
- Stored hashes carried the `pbkdf2$150000$...` prefix.
- workerd's 100,000-iteration cap: cloudflare/workerd issue #1346.

### Fix (minimal)

- `src/lib/secure-hash.server.ts`: exported `MAX_SUPPORTED_ITERATIONS = 100_000`; hashing now uses
  that value; `verifySecret` throws an explicit error (instead of silently returning `false`) for
  stored hashes above the cap, so an unverifiable credential can never read as a wrong credential.
- Pilot access code and PINs re-hashed at 100,000 iterations (same PBKDF2 scheme, same values,
  new salts). No plaintext stored, no schema change, no new table, no auth or financial change.

### Tests run

- `supabase/tests/phase2a-hash.test.ts` — 7/7 pass, including two new regressions:
  issued hashes stay within the runtime cap; an over-cap hash fails loudly.
- `supabase/tests/phase2b-unit.test.ts` + `phase2b-e2e.test.ts` — 56/56 pass.
- `bun run build` — OK. (No `typecheck` script exists in this repo; the build is the typecheck.)

---

## Live Attempt #2 — Post-fix live calls (2026-09-22)

After the PBKDF2 iteration fix, real calls progressed past the access code. Live sessions:

| CallSid | Session ID | Outcome |
| --- | --- | --- |
| `CA22d644eaad34a910ff7598287d99061a` | `a3bcccb2-57ff-49ed-9f65-0af8b064dc0b` | Access code → account → PIN → AUTHENTICATED → account information |
| `CAd7448992d38100a4cc419d6018d087be` | `e31c3814-8444-4f2a-abd2-f2ea1e051b88` | Authenticated → balance enquiry |
| `CA24961f25ff5266379a16a8b82d61478e` | `045da1d8-7912-4cd7-b901-f7272b93637f` | Transfer requested then CANCELLED by caller (keypad 2) |
| `CA625db0c3da035c72ebc4ac9916841ab9` | `39d93d58-162c-443e-828e-8d83fad148e7` | Transfer confirmed and executed |

---

## Live Financial Transaction Verification

All values below were read directly from the production database; none were created for this check.

| Item | Value |
| --- | --- |
| Live CallSid | `CA625db0c3da035c72ebc4ac9916841ab9` |
| Call session ID | `39d93d58-162c-443e-828e-8d83fad148e7` |
| Authenticated at | 2026-09-22 05:52:32.170026+00 (state AUTHENTICATED, stage AUTHENTICATED) |
| Transfer ID | `6061d9c2-ccf0-40de-a99c-153aa3e25be3` (reference `TRF-58A59F7EF814`, status COMPLETED) |
| Transaction ID | `8f0419ba-e087-4363-b1b5-a29f31477c48` (type TRANSFER, status COMPLETED) |
| Source account | 10001 (`8bf4f9e5-51d7-453b-8f42-7af557186225`) |
| Recipient account | 10002 (`bf83041e-9a4a-40bd-b377-de6b6595b667`) |
| Amount | 100.0000 NGN — stored as `numeric`, equality with `100::numeric` is true (no floating point) |
| Executed at | 2026-09-22 05:53:18.18566+00 |

### Transfer count

Exactly **1** row in `transfers`, exactly **1** `TRANSFER` row in `transactions`, across the whole
database. No second or partial transfer exists.

### Ledger verification (source of truth)

Exactly two entries for transaction `8f0419ba-e087-4363-b1b5-a29f31477c48`:

| Entry ID | Account | Direction | Amount | Balance after |
| --- | --- | --- | --- | --- |
| `0de31447-cbf5-4c7c-be99-1e223fed8145` | 10001 | DEBIT | 100.0000 | 9900.0000 |
| `bcb3dbb0-e023-480e-be19-188dcf9044cb` | 10002 | CREDIT | 100.0000 | 100.0000 |

Double entry balances exactly (debits = credits = 100.0000 NGN).

### Balance verification (ledger-derived vs cached)

| Account | Before | After (cached) | Ledger-derived | Drift |
| --- | --- | --- | --- | --- |
| 10001 | 10,000.0000 | 9,900.0000 | 9,900.0000 | 0 |
| 10002 | 0.0000 | 100.0000 | 100.0000 | 0 |

`ledger_accounts.balance` also reads 9900.0000 / 100.0000. Recomputing each balance from the raw
ledger entries reproduces the cached projection exactly — zero drift. Account 10001's history is
the ₦10,000 INITIAL_CREDIT (2026-09-21) minus this ₦100 debit.

### Idempotency verification

One `financial_idempotency` row: operation `execute_transfer`, key
`625ed718…4025ce8` (voice-derived fingerprint), `result_id` =
`6061d9c2-ccf0-40de-a99c-153aa3e25be3`. The same key is recorded on both the transfer and the
transaction row, so a replay resolves to this posting rather than creating a second one. No
duplicate keys, no second result id.

### Voice correlation

Audit chain for session `39d93d58-…`: CALL_SESSION_CREATED → IVR_STARTED → ACCESS_CODE_ATTEMPT
(attempt 1) → ACCESS_CODE_VERIFIED → ACCOUNT_IDENTIFIED → PIN_ATTEMPT (attempt 1) → PIN_VERIFIED →
CALL_SESSION_AUTHENTICATED → IVR_MENU_SHOWN → TRANSFER_REQUESTED (RECIPIENT_ENTERED) →
TRANSFER_REQUESTED (amount 100, NGN, recipient reference `0002`) → TRANSFER_INITIATED →
TRANSFER_CONFIRMED (transfer_id `6061d9c2-…`) → TRANSFER_COMPLETED → BALANCE_ENQUIRY →
CALL_COMPLETED → CALL_SESSION_ENDED. Nine `call_session_events` rows carry provider event ids
`CA625db0c3da035c72ebc4ac9916841ab9:1` … `:9`, linking the Twilio call to every IVR turn.

### Cancellation verification

Session `045da1d8-7912-4cd7-b901-f7272b93637f` (CallSid `CA24961f25ff5266379a16a8b82d61478e`)
recorded TRANSFER_REQUESTED (recipient) → TRANSFER_REQUESTED (amount 100 NGN, recipient `0002`) →
**TRANSFER_CANCELLED** at 05:43:49+00. No transfer, transaction, ledger entry or idempotency row
exists at or near that time — the only transfer in the database is the confirmed one ten minutes
later. Pressing 2 moved no money.

### Security verification

- No PIN, access code or DTMF digits in any stored record: every `call_session_events.payload` is
  `{"step": "<stage>"}` only; audit metadata carries attempt counters, account/transfer ids and
  amounts, never credentials.
- `call_transfer_grants` is empty — the one-shot transfer grant was consumed, not left reusable.
- `financial_failure_events` is empty for this period.
- Money moved solely through `execute_transfer`: the transfer, transaction, both ledger entries and
  the idempotency record share one timestamp and one reference set, which only that function emits.
- No direct balance or ledger mutation: `customer_accounts.updated_at` equals the transfer
  timestamp, ledger entries are append-only (INSERT/UPDATE/DELETE blocked by policy), and cached
  balances reconcile exactly with the ledger.

**LIVE FINANCIAL TRANSACTION — VERIFIED.**

---

## Gate Status

**Gate D — NOT YET PASSED.** The live path is now proven end to end for a single acceptance run:
REAL PHONE → TWILIO → SIGNED WEBHOOK → CALL SESSION → TENANT RESOLUTION → ACCESS CODE → ACCOUNT →
PIN → AUTHENTICATED SESSION → MENU → BALANCE → ACCOUNT INFORMATION → CONFIRMED TRANSFER →
`execute_transfer` → IMMUTABLE LEDGER, plus a live cancellation that moved no money.

Still unproven live, and therefore required before Gate D can be declared PASS:

- duplicate / replayed provider callback must not move money twice
- authentication failure (wrong PIN) attempt counter and lockout behaviour
- invalid input handling (bad menu choice, unknown account, unknown recipient, zero/negative/
  over-precise amount, insufficient funds)
- session expiry / TTL behaviour

The financial evidence above is sufficient to proceed to those remaining acceptance tests.

**Nigeria Local Number Readiness — PENDING.** Nigerian number provisioning, carrier availability
and regulatory approval are a separate deployment concern and are not addressed by this test.
