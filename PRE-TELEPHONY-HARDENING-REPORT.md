# CreditVoice OS — Pre-Telephony Hardening Report

Phase 1 production-readiness audit and remediation, completed before any
telephony, SIP or IVR work begins.

---

## 1. Executive summary

The existing foundation (multi-tenant schema, RLS, roles, ledger, credit
engine, audit triggers) was audited end to end: migrations, every table,
function, trigger and policy, all grants, the service layer, the server
functions and every route's data access.

The audit found one critical privilege problem (the whole schema was granted
full read/write to `anon` and `authenticated`, leaving RLS as the only
boundary), an unsafe account-number allocator, a mutable transfer record, two
independently writable balances with no reconciliation, no tenant-status or
currency gate on money movement, no idempotency, and a latent bug that made
organization activation fail outright.

All of these were fixed through new migrations. Nothing was rebuilt or
redesigned; no existing migration was rewritten. An automated suite of **40
database assertions plus 2 real concurrency proofs** now runs against the live
schema — all pass.

---

## 2. Existing architecture

```
React + TanStack Start (UI)
        │
        ├── browser Supabase client ──► PostgREST ──► RLS ──► Postgres
        │        (reads + narrow, guarded writes)
        │
        └── createServerFn (server, bearer-validated)
                 │
                 ├── requireSupabaseAuth → acts as the signed-in user
                 └── service-role client → platform-only operations
                          (approvals, credential issuance, phone numbers)

Money never moves through a table write. It moves through
post_credit() / execute_transfer() / reverse_transfer(),
which are SECURITY DEFINER functions that authorise the caller
themselves and write the immutable ledger.
```

Two administrative levels: **platform (SUPER_ADMIN)** and **organization
(TENANT_ADMIN)**, plus a **CUSTOMER** role reserved for Phase 2. Every
tenant-owned row carries `tenant_id`; isolation is enforced in Postgres.

---

## 3. Security findings

| # | Issue | Severity | Impact | Resolution |
|---|-------|----------|--------|------------|
| 1 | Every public table was granted `ALL` to `anon` and `authenticated` | **Critical** | Any gap or future mistake in a policy became a full read/write hole; ledger, roles and credential tables were one policy slip from exposure | Revoked all blanket grants; re-granted the minimum per table. Ledger, transactions, transfers, `user_roles`, `customer_pins`, `tenant_access_codes`, sequences and idempotency records are now unreachable for writes at the privilege level, before RLS is consulted |
| 2 | Organization status/currency changes were rejected for trusted backend operations | **Critical (functional)** | Approving and activating an organization failed — the platform flow was broken | `guard_tenant_currency()` now recognises the service role / database owner as the platform authority; app roles still require SUPER_ADMIN |
| 3 | Account numbers allocated with `MAX(...)+1` | **High** | Two simultaneous account creations could collide or fail | Per-organization counter table with an atomic `UPDATE ... RETURNING`; unique `(tenant_id, account_number)` retained as the final net; client-supplied numbers are ignored |
| 4 | `transfers` rows were freely updatable by any path with privileges | **High** | Settled transfer amounts, parties or references could be rewritten | `guard_transfer_mutation()` allows changes only from inside the credit engine, blocks re-settlement and rejects any change to amount, parties, currency or reference; deletes blocked |
| 5 | Account identity fields mutable | **High** | An account could be moved to another customer or re-denominated | Guard now freezes `tenant_id`, `customer_id`, `account_number` and `currency_code` outside ledger postings |
| 6 | No tenant-status or currency gate on money movement | **High** | A suspended or unapproved organization could still transact | `assert_tenant_operational()` is called by every financial function |
| 7 | No idempotency | **High** (blocking for Phase 2) | A retried webhook, network retry or double click would post twice | `financial_idempotency` table keyed `(tenant_id, key)`; repeated calls return the original result |
| 8 | `post_credit` accepted any transaction type and allowed platform admins to post | Medium | Wrong-type postings; unclear accountability | Type whitelist; only the owning organization's admin may post |
| 9 | Reversals had no link to the original record, no reason and no actor | Medium | Weak forensic trail | `reversal_of_transaction_id` on transactions; `reversed_by`, `reversed_at`, `reversal_reason` on transfers |
| 10 | No brute-force controls on credentials | Medium | Phase 2 IVR would be guessable | Attempt counters and lockout windows on `customer_pins` and `tenant_access_codes` plus a server-only `register_credential_failure()` |
| 11 | Unused `next_account_number()` left the unsafe allocator callable | Low | Redundant attack surface | Dropped |
| 12 | Internal trigger helper executable by `anon` | Low | Unnecessary exposure | Execute revoked |

No SQL-injection vectors were found (no dynamic SQL built from user input).
Every `SECURITY DEFINER` function sets `search_path = public`, validates its
inputs, and authorises the caller independently of the frontend.

---

## 4. Database findings (schema changes)

Added
- `tenant_account_sequences` — per-organization number counter (no client access)
- `financial_idempotency` — `(tenant_id, idempotency_key)` primary key
- `transactions.idempotency_key`, `transactions.reversal_of_transaction_id`
- `transfers.idempotency_key`, `reversed_by`, `reversed_at`, `reversal_reason`
- `customer_pins.failed_attempts`, `locked_until`
- `tenant_access_codes.failed_attempts`, `locked_until`, `retired_at`

Constraints
- `credit_limit >= 0`; positive-amount checks on transactions, transfers and
  ledger entries; unique ledger account per customer account

Indexes added (organization-scoped access paths only)
`customer_accounts(customer_id)`, `(tenant_id,status)`;
`customers(tenant_id,status)`, `(tenant_id,phone)`;
`transactions(tenant_id,created_at desc)`, `(account_id)`;
`transfers(tenant_id,initiated_at desc)`, `(sender_account_id)`, `(recipient_account_id)`;
`ledger_entries(ledger_account_id,created_at desc)`, `(transaction_id)`;
`ledger_accounts(account_id)` unique; `audit_logs(tenant_id,created_at desc)`;
`phone_numbers(tenant_id)`; `user_roles(user_id)`.

---

## 5. RLS findings

Every tenant-owned table was reviewed. Isolation now rests on two layers:
privileges first, policies second.

| Table | Read | Write |
|---|---|---|
| `tenants` | own organization or platform admin | platform authority only for status/currency; org admin may edit profile fields |
| `customers` | own organization, own customer record, platform admin | org admin of that organization only, insert blocked for non-operational organizations |
| `customer_accounts` | own organization, own customer record, platform admin | org admin only; balance, currency, owner and number frozen outside the engine |
| `ledger_accounts`, `ledger_entries`, `transactions`, `transfers` | own organization (customers see their own transactions) | **no client write privilege at all** |
| `audit_logs` | own organization or platform admin | append-only, no update or delete |
| `user_roles` | own rows or platform admin | **no client write privilege** — self-escalation impossible |
| `customer_pins`, `tenant_access_codes` | denied to all client roles | denied |
| `tenant_account_sequences`, `financial_idempotency` | denied to all client roles | denied |
| `phone_numbers` | assigned organization, platform admin | platform admin |
| `customer_care_settings`, `ivr_settings` | own organization, platform admin | own organization |
| `platform_settings` | platform admin | platform admin |

---

## 6. Financial integrity

**Source of truth.** The ledger is authoritative:

```
ledger_entries (immutable, double-entry)   ← authoritative history
        ↓ projected by the credit engine
ledger_accounts.balance   +   customer_accounts.balance   ← cached projections
        ↓
customer / admin display
```

`customer_accounts.balance` and `ledger_accounts.balance` are **caches**, not
independent records. They can only change inside a credit-engine function,
which sets an internal posting flag; any other write raises
`Balances can only change through ledger postings`.
`reconcile_account_balances(tenant_id)` recomputes each balance from the
entries and reports drift — it returns zero drift in the test run.

**Credits.** `post_credit()` locks the account, checks caller authority,
organization status, currency approval, account status, amount and type,
then writes one transaction, one ledger entry and the projection, and audits it.

**Transfers.** `execute_transfer()` locks both accounts in deterministic id
order (deadlock-free), then validates same organization, same currency, both
accounts active, positive amount, sufficient balance, caller authority and
organization status. Transfer record, transaction, both ledger lines, both
projections and both audit events are written in one database transaction —
all or nothing.

**Reversals.** `reverse_transfer()` never edits or deletes history. It creates
a compensating transaction linked by `reversal_of_transaction_id`, posts the
mirrored ledger lines, restores balances, marks the transfer `REVERSED` with
who and why, and audits it. A second reversal is rejected.

**Concurrency.** Balance reads happen only after `FOR UPDATE`, so two
simultaneous transfers are serialised. Measured: the second session waited
2.38 s for the lock and was then rejected for insufficient credit; the final
balance was exactly one transfer's worth.

**Idempotency.** Any financial call may carry an idempotency key. The first
call records it; a repeat returns the original identifier without posting
again. The web forms already send one per submission; Phase 2 webhooks will
reuse the provider's event id.

---

## 7. Authentication and authorisation

- Supabase Auth; server functions validate the bearer token before running.
- `SUPER_ADMIN` — platform-wide: applications, organizations, currencies,
  phone numbers, platform settings. Cannot post credit, cannot read any
  access code or PIN.
- `TENANT_ADMIN` — exactly one organization: customers, accounts, credit,
  transfers, configuration. Cannot change approved currency or organization
  status, cannot reach another organization, cannot read PINs.
- `CUSTOMER` — own customer record, own accounts and transactions (Phase 2 UI).
- Roles live in `user_roles` with no client write privilege; escalation
  attempts fail at the privilege layer.
- Access codes and PINs are stored only as PBKDF2-SHA256 hashes
  (150,000 iterations, per-secret salt). Nobody — platform or organization —
  can read them back. Rotation issues a new secret and retires the old one.
  Plaintext is shown exactly once, at issuance, and never written to audit
  metadata.

---

## 8. Auditability

`audit_logs` is append-only (update and delete blocked by trigger, no client
write privilege). Events currently produced: tenant created/approved/rejected,
tenant status changes, currency approved, admin created, customer created,
customer status changed, account created, credit added, credit adjusted,
transfer initiated/completed/reversed, phone number assigned/released, access
code issued, access code changed, customer PIN set, platform ownership
claimed. Each row carries organization, actor, actor role, event type, entity
type, entity id, JSON metadata and timestamp. Secrets are never included.

---

## 9. Tests

`supabase/tests/hardening.sql` — 40 assertions executed as the real
`authenticated` database role with a simulated signed-in user, inside a
transaction that is always rolled back. **40 passed, 0 failed.**

Coverage: cross-organization reads of customers, accounts, transactions and
audit logs (Test A); cross-organization update (Test B); cross-organization
account creation (Test C); cross-organization transfer (Test D); PIN and
access-code hash inaccessibility; role escalation; sequence-table
inaccessibility; account-number uniqueness; direct balance manipulation;
account currency immutability; currency and status control; credit posting,
audit event, cross-organization credit, negative credit, credit idempotency;
transfer debit/credit, double-entry lines, audit events, insufficient credit,
self transfer, inactive account, transfer idempotency; transaction, ledger,
transfer and audit immutability; reversal balances, linkage, actor and reason,
double reversal, history retention; ledger reconciliation; suspended
organization blocking money movement.

`supabase/tests/concurrency.sh` — real parallel sessions. **2 passed.**
1. 30 concurrent account-number allocations → 30 distinct numbers.
2. Two concurrent 8,000 transfers from a 10,000 balance → the second waited
   2.38 s on the row lock, was rejected, and the final balance was 2,000.

Run them with `bun run test:db` and `bun run test:concurrency`.

---

## 10. Remaining risks

- **Not yet verifiable:** the credential-verification path (access code, PIN)
  has storage, hashing, attempt counters and lockout fields in place, but no
  endpoint consumes them until Phase 2. Rate limiting is designed, not yet
  exercised.
- **Client-side writes remain for non-financial records** (customers, account
  opening, care and IVR configuration). They are guarded by RLS plus triggers,
  but they are still direct table writes; moving them behind server functions
  would tighten validation and audit richness.
- **No failure audit for rejected financial operations.** A rejected transfer
  raises and rolls back, which also rolls back any audit row, so
  `TRANSFER_FAILED` is not recorded. Capturing it needs an out-of-transaction
  writer.
- **Reconciliation is on demand**, not scheduled; no alert exists if drift ever
  appears.
- **Eight SECURITY DEFINER functions remain callable by signed-in users.** This
  is intentional: three are RLS policy helpers, three are the credit engine
  (which authorises its own callers), one is the reconciliation reader, and one
  is a sandbox test helper that refuses to run outside the development
  database.
- **Test helpers exist in the database** (`cv_test_setup`, `cv_test_admin`,
  `cv_test_cleanup`) restricted to the development sandbox account. They should
  be dropped before a production cutover.
- Ledger amounts use `numeric`; per-currency decimal places are stored but not
  yet enforced on input.
- No load testing beyond the concurrency proofs above.

---

## 11. Telephony readiness

The credit engine has no knowledge of any channel. It accepts an account, an
amount and an optional idempotency key, and it authorises the caller from the
database session — not from anything the caller asserts. A voice adapter is
therefore a pure translation layer.

Remaining before Twilio/IVR:

1. A credential verification service: verify access code → verify account
   number → verify PIN, using the existing hashes, consuming the attempt
   counters and lockout windows.
2. A call-session record (call id, organization, resolved customer, state,
   attempts) so an IVR flow can resume and be audited.
3. A signed webhook route under `src/routes/api/public/` with replay
   protection, mapping the provider's event id to the idempotency key.
4. Implementation of the existing `TelephonyProvider` interface for Twilio,
   selected by configuration, with the current `NONE` provider kept for tests.
5. Authentication and security audit events (code accepted/rejected, PIN
   accepted/rejected/locked) added to the audit vocabulary.
6. Decision on per-currency rounding before voice-quoted amounts are spoken.

The financial foundation is ready. Phase 2 should begin with items 1–3.
