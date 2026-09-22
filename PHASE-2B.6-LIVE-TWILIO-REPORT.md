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

## Live Attempt #2

Not yet performed. This section will be completed only after another real telephone call.

Expected: WELCOME → ACCESS CODE accepted → ACCOUNT NUMBER prompt.

---

## Gate Status

**Gate D — FAIL (not yet passed).** The live path is proven only as far as
REAL PHONE → TWILIO → SIGNED WEBHOOK → CALL SESSION → TENANT RESOLUTION → IVR DTMF COLLECTION.
Access-code verification, PIN authentication, balance enquiry, account information, transfer with
explicit confirmation, duplicate/replay protection and ledger verification remain unproven live.

**Nigeria Local Number Readiness — PENDING.** Nigerian number provisioning, carrier availability
and regulatory approval are a separate deployment concern and are not addressed by this test.
