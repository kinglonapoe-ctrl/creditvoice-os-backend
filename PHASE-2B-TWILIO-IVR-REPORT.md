# CreditVoice OS — Phase 2B: Twilio Voice Adapter, Signed Webhook & Deterministic IVR

An ordinary telephone call now reaches the existing credit engine securely.
No AI, no speech recognition, no new money-moving code.

---

## 1. Executive summary

Phase 2B connects Twilio Programmable Voice to the platform through a single
signed public webhook and a deterministic DTMF IVR. Twilio carries audio and
digits; it makes no decision. Every credential check is the Phase 2A service,
every identity comes from the Phase 2A call session, and every naira moves
through the unmodified `execute_transfer`.

The webhook verifies the Twilio signature as its first operation against a
canonical URL taken from configuration — never from the request host — and
rejects anything unsigned or altered with HTTP 403 before a single database
statement runs. Each call turn is claimed against the session, so a retried
callback replays the identical spoken answer instead of advancing the call or
posting a second transfer. Transfers require an explicit confirmation key and
carry a deterministic idempotency key into the existing financial idempotency
table.

**Test results, all actually executed against the live database:
Phase 1 — 40 assertions + 2 concurrency proofs. Phase 2A — 65 assertions +
3 concurrency proofs + 5 hashing tests. Phase 2B — 53 database assertions +
27 signature/TwiML/amount tests + 29 end-to-end IVR tests + 3 concurrency
proofs. 0 failures.** No test required live Twilio credentials.

---

## 2. Architecture

```
Caller ──► Twilio Programmable Voice
             │ signed HTTP POST (form encoded)
             ▼
   /api/public/voice/twilio          ← public, POST only, no user session
             │ 1. Twilio signature (before anything else)
             ▼
   src/lib/voice/webhook.server.ts
             │ 2. turn claim (replay guard) + call_session_events
             ▼
   src/lib/voice/ivr/engine.server.ts   ← conversation only
             │ 3. Phase 2A services: resolveTenant, verifyTenantAccessCode,
             │    identifyAccount, verifyCustomerPin, requireCallContext
             ▼
   cv_prepare_transfer / cv_execute_voice_transfer
             │ 4. the unmodified financial engine
             ▼
   execute_transfer ──► immutable ledger ──► balance projection
```

New source files:

| File | Responsibility |
|---|---|
| `src/lib/telephony/twilio-provider.server.ts` | `TelephonyProvider` implementation for Twilio (turn-based TwiML) |
| `src/lib/voice/config.server.ts` | `TELEPHONY_PROVIDER` selection and fail-fast credential validation |
| `src/lib/voice/twilio-signature.server.ts` | signature computation, verification, canonical URL |
| `src/lib/voice/twiml/builder.ts` | the only place TwiML XML is produced |
| `src/lib/voice/money.ts` | DTMF → validated amount, BigInt minor units, no floats |
| `src/lib/voice/ivr/engine.server.ts` | deterministic IVR state machine |
| `src/lib/voice/ivr/prompts.ts` | prompts and the safe error-code vocabulary |
| `src/lib/voice/webhook.server.ts` | the webhook boundary |
| `src/lib/voice/log.server.ts` | allow-list structured logging |
| `src/routes/api/public/voice/twilio.ts` | thin route wiring |
| `src/routes/_authenticated/admin/voice-operations.tsx` | platform-admin call view |

---

## 3. Signature verification

`verifyTwilioSignature` follows Twilio's algorithm exactly: the canonical URL
followed by every POST parameter appended in sorted key order, HMAC-SHA1 with
the auth token, base64, compared in constant time. The URL is rebuilt as
`TWILIO_WEBHOOK_BASE_URL` + path + query, so a forged `Host` header, a proxy
rewrite or TLS termination cannot move the signed string. Missing, malformed,
altered-parameter, altered-URL and wrong-token cases all return **403** with no
diagnostics and no session created — proven by test, including an assertion
that the session count is unchanged after an unsigned request.

---

## 4. Replay protection and call correlation

Twilio sends many requests per call and retries when a response is lost.

- Calls correlate on `CallSid` through `cv_find_call_session`, so a second
  request never starts a second authentication.
- Each turn is claimed by `cv_ivr_claim_turn`, which locks the session row and
  compares a fingerprint of the request (call, step, IVR state, digits). An
  identical repeat returns the **cached TwiML of that turn**, audits
  `TWILIO_EVENT_REPLAY_REJECTED`, and changes nothing. A genuinely repeated
  keypress later in the call follows a different preceding turn and is
  processed normally.
- Every processed turn is also recorded in `call_session_events` under
  `(provider, provider_event_id)` uniqueness — the Phase 2A mechanism,
  untouched. `financial_idempotency` remains reserved for money.

Concurrency proof: 20 simultaneous identical callbacks → accepted once, stored
once. 6 simultaneous retries of one transfer → one transfer, correct balance.

---

## 5. IVR state machine

```
WELCOME ─► ACCESS_CODE ─► ACCOUNT_NUMBER ─► PIN ─► MENU
                                                   ├─ 1 balance ──────► MENU
                                                   ├─ 2 account info ─► MENU
                                                   ├─ 3 TRANSFER_RECIPIENT
                                                   │     └─► TRANSFER_AMOUNT
                                                   │           └─► TRANSFER_CONFIRM ─► MENU
                                                   ├─ 0 customer care ─► DIAL | VOICEMAIL
                                                   └─ 9 ENDED
```

Failure paths: wrong input retries up to the organization's configured
allowance, then the call ends; a locked credential, expired session or
unavailable organization ends the call with a generic message. The IVR keeps
**no** authentication state of its own — `call_sessions.state` decides whether
anything is permitted, and the position (`ivr_state`) is stored on the same
row.

Digit limits: access code 16 with `#`, account number 20 with `#`, PIN 4, menu
1, confirmation 1. Timeouts and retries come from `ivr_settings`.

---

## 6. Customer operations

- **Balance (1)** — read through the existing authenticated summary; the IVR
  never calculates a balance.
- **Account information (2)** — last four digits only, status, available
  credit, credit limit. No UUID, tenant id or ledger id is ever spoken.
- **Transfer (3)** — recipient, then amount, then an explicit confirmation
  that repeats amount, currency and the recipient's last four digits. Only
  key `1` executes; anything else cancels. The source account is always the
  session's own account; the caller cannot name it.
- **Customer care (0)** — `cv_customer_care_route` evaluates the
  organization's configured business hours in the organization's own timezone
  and returns either a transfer destination or voicemail per the configured
  after-hours mode. Nothing is hard-coded.

---

## 7. Money, currency and idempotency

Amounts are parsed from DTMF into **BigInt minor units** — no `parseFloat`,
no floating-point arithmetic anywhere in the voice layer. Allowed decimals
come from the currency registry (`currencies.decimal_places`); an amount with
too much precision is **rejected, never rounded**. Zero, negative, empty,
non-numeric, multiple separators and absurdly large values are all refused.

`cv_execute_voice_transfer` mints a single-use nonce grant, calls the existing
`execute_transfer` with a deterministic idempotency key, and deletes the grant
on both the success and failure paths. A repeated key returns the original
transfer: proven by assertion (one transfer row, one transaction, two ledger
entries, unchanged balance) and by the retry race.

**Financial failure auditing is now closed for the voice channel.** A refused
transfer rolls back its own ledger work, and the rejection is then written
durably to `financial_failure_events` plus a `TRANSFER_FAILED` audit row,
outside the rolled-back sub-transaction. Nothing about the financial model was
weakened: no fake ledger entries, no failed transfer marked complete. Dashboard
credit posting still lacks the same treatment — see remaining blockers.

---

## 8. Security posture

- Twilio credentials are read only inside server handlers; nothing Twilio-
  related is importable from browser code.
- The public route requires no Supabase user session and grants none; RLS was
  not weakened anywhere, and no generic admin query helper exists — the voice
  layer can only call named, hardened `cv_*` functions.
- `call_transfer_grants` has an explicit deny-all policy and no client grant.
- Logging is allow-listed: call id, session, tenant, event type, state,
  result, duration. Digits, PINs, access codes, signatures, tokens and raw
  bodies can never be logged. Tests assert no credential text appears in the
  audit trail or in the session row.
- Prompt and configuration text is data: it is XML-escaped, so an organization
  administrator cannot inject TwiML (asserted by test).
- Caller ID (`From`) is contextual only — used for throttling and audit, never
  for authentication.

---

## 9. Recording and transcription policy

**Recording is off by default and must be switched on explicitly per
organization** (`ivr_settings.recording_enabled`, default `false`). No
transcription is implemented. Voicemail recording happens only when the
organization enables voicemail, and only after credential entry is complete,
so credentials are never captured. Only recording identifiers and metadata
would be stored — never media in the database. Retention, access auditing and
per-jurisdiction consent announcements remain open decisions for Phase 2C, and
recording should stay disabled until they are made.

---

## 10. Database changes (new migrations only)

- `ivr_settings`: `voice`, `max_input_retries`, `gather_timeout_seconds`,
  `menu_message`, `recording_enabled` (default false).
- `call_sessions`: `ivr_state`, `ivr_retries`, `pending_recipient_input`,
  `pending_recipient_account_id`, `pending_amount`, `pending_transfer_key`,
  `last_event_fingerprint`, `last_response`, `turn_no`, plus an index on
  `(provider, provider_call_id, created_at desc)`.
- `financial_failure_events` — durable record of refused financial operations;
  platform admins read all, organization admins read their own.
- `call_transfer_grants` — single-use voice authority nonces; no client access.
- Functions: `cv_ivr_state`, `cv_ivr_set_state`, `cv_ivr_set_recipient`,
  `cv_ivr_claim_turn`, `cv_ivr_store_response`, `cv_find_call_session`,
  `cv_ivr_config`, `cv_prepare_transfer`, `cv_cancel_transfer`,
  `cv_execute_voice_transfer`, `cv_customer_care_route`, `cv_voice_grant_valid`
  — all `SECURITY DEFINER` with `search_path = public`, input validation,
  `EXECUTE` revoked from `public`/`anon`/`authenticated` and granted only to
  `service_role` (and the sandbox test role).

`execute_transfer` gained exactly one clause: it also accepts a valid
single-use voice grant for the session's own account. The ledger, locking,
numbering, idempotency and reversal models are unchanged.

Linter: the same 8 pre-existing intentional warnings as Phase 2A. No new ones.

---

## 11. Tests (exact results, all executed)

| Suite | Command | Result |
|---|---|---|
| Phase 1 database | `bun run test:db` | 40 assertions, 0 failed |
| Phase 1 concurrency | `bun run test:concurrency` | 2 proofs passed |
| Phase 2A database | `bun run test:voice` | 65 assertions, 0 failed |
| Phase 2A concurrency | `bun run test:voice:concurrency` | 3 proofs passed |
| Credential hashing | `bun run test:hash` | 5 tests passed |
| Phase 2B database | `bun run test:ivr` | 53 assertions, 0 failed |
| Signature / TwiML / amounts | `bun run test:twilio` | 27 tests passed |
| End-to-end IVR | `bun run test:voice:e2e` | 29 tests passed |
| Phase 2B concurrency | `bun run test:ivr:concurrency` | 3 proofs passed |

Coverage highlights: unsigned / invalid / tampered / wrong-token signatures
rejected with no session created; GET refused; malformed request refused;
unknown destination number answered generically; full call → access code →
account → PIN → menu → balance; masked account information; invalid key
recovery; transfer with confirmation producing exactly one transfer, one
transaction, two ledger entries, one idempotency record and a completion audit;
replayed confirmation moving no extra money; cancellation; cross-organization
recipient refused; insufficient credit refused and durably recorded; excess
precision refused; wrong access code and repeated wrong PINs ending the call;
unauthenticated caller unable to reach any action; no credential text in audit
or session data; tenant-scoped account lookup; customer care inside hours,
outside hours, voicemail disabled and a different timezone; privileges proving
signed-in users cannot call any voice function or read grants.

**NOT EXECUTED — requires live Twilio credentials:** a real inbound telephone
call, real Twilio-generated signatures, real audio playback and a real call
transfer to a customer-care number. Every one of these has a local equivalent:
signatures are produced with Twilio's own algorithm and a throwaway token, and
the whole IVR is driven through the real handler.

---

## 12. Production configuration

1. Deploy over HTTPS on a stable public host.
2. Set `TELEPHONY_PROVIDER=TWILIO`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
   and `TWILIO_WEBHOOK_BASE_URL` (origin only, no trailing slash) as server
   secrets. Missing values fail fast with a names-only error; `NONE` keeps
   development and tests working with no Twilio account at all.
3. In Twilio, point the voice number's **A CALL COMES IN** webhook to
   `https://<your-domain>/api/public/voice/twilio`, method **POST**. The URL
   must match `TWILIO_WEBHOOK_BASE_URL` exactly, or every signature fails.
4. Assign that number in Phone Numbers, mark it voice-capable and `ACTIVE`,
   and attach it to an `ACTIVE` organization with an approved currency.

**No Twilio number has been provisioned by this work.** Automated number
purchasing is deliberately not implemented.

---

## 13. Remaining launch blockers

1. **Dashboard financial failure auditing** — the voice channel now records
   refusals durably; a rejected dashboard `post_credit` still rolls back its own
   audit row.
2. **Sandbox test helpers still exist in the database** and must be dropped
   before a production cutover.
3. **Scheduled reconciliation with alerting** — `reconcile_account_balances()`
   is still on-demand. Production mechanism required: a scheduled call
   (pg_cron or an external scheduler) to a protected endpoint that raises an
   operator alert on non-zero drift. Not faked with a browser timer.
4. **First administrator password delivery** still has no secure route.
5. **Backup and restore drill** has not been performed.
6. **Recording retention, consent announcements and access auditing** are
   undecided; recording stays disabled until they are.
7. **Load testing** beyond the concurrency proofs has not been done.
8. **Number normalization** is assumed E.164 on entry; no migration
   normalizes historical numbers.
9. **Voicemail media handling** stores the provider recording reference only;
   playback, retention and deletion are not built.

---

## 14. Phase 2C recommendation

1. Operational hardening: scheduled reconciliation with alerting, dashboard
   failure auditing, removal of sandbox helpers, load testing.
2. Organization-facing call analytics and an organization voice-operations
   view (platform view shipped here).
3. Voicemail lifecycle: storage, retention, access audit, consent prompts.
4. Additional customer actions (statements, repayments) reusing the same
   authenticated context.
5. Only then, additional channels (WhatsApp, USSD, SMS) as further adapters on
   the same authentication and financial core — still no AI in the money path.
