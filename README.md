<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# CreditVoice OS

A multi-organization platform for running customer credit accounts, built so
that every organization is fully walled off from every other one, every balance
is the result of an immutable ledger, and every account can eventually be
reached over an ordinary phone call.

Phase 1 (platform foundation) is complete and hardened. Phase 2 (telephony and
IVR) has not started.

---

## Product specification

### What it is
Organizations — lenders, cooperatives, distributors, agent networks — sign up
to the platform, are approved by the platform operator, and receive their own
private workspace: their own customers, their own account numbers, their own
operating currency, their own telephone line and their own access code.

### Core capabilities

**Platform operations**
- Organization applications with a full review lifecycle
- Currency registry (NGN, USD, GBP, EUR, GHS, KES, ZAR, CAD, AUD) and per-organization currency approval
- Telephone number inventory with assignment and release
- Guided organization activation: approved → currency → number → access code → live
- Platform-wide transaction view, customer care overview, audit trail, settings

**Organization operations**
- Customers: create, activate, suspend, search; telephone PIN issuance
- Accounts: per-organization account numbers, credit limits, suspension
- Credit: post opening credit, adjustments, debits and repayments
- Transfers: customer to customer inside the organization, with reversal
- Transactions and reports
- Customer care routing configuration and IVR settings
- Security: rotate the organization access code, review the audit trail

**Guarantees enforced by the database, not the screens**
- Account numbers are unique per organization, so two organizations may both have 10001
- Balances change only through ledger postings; nothing can set a balance directly
- Posted entries and completed transactions cannot be edited or deleted — only reversed
- Transfers are same-organization, same-currency, atomic and serialised
- Access codes and PINs are stored only as salted hashes and can never be read back
- The audit trail is append-only

### Not in Phase 1
Live calls, Twilio, SIP, voice AI, currency conversion, and the customer-facing
interface.

---

## Investor brief

**The problem.** Across emerging markets, credit is extended by thousands of
small organizations whose customers do not have reliable data connections. The
credit itself is tracked in notebooks and spreadsheets: no ledger, no audit
trail, no way for a customer to check a balance without visiting a branch.

**The product.** CreditVoice OS gives each organization a bank-grade credit
ledger and a dedicated telephone line. Their customers call that number, enter
an account number and a PIN, and check a balance or send credit to another
customer — on any phone, with no app and no internet.

**Why it can be trusted.** The financial core is built like a payments system,
not a CRM: double-entry ledger, immutable history, reversals instead of edits,
atomic transfers with double-spend protection, per-organization isolation
enforced inside the database, and a complete audit trail. This has been
independently exercised by an automated suite of 42 security and integrity
tests, all passing.

**Where we are.** Phase 1 — the multi-organization platform, credit engine and
both administration interfaces — is complete and production-hardened. The
engine is deliberately channel-agnostic: voice is an adapter on top, not a
rewrite.

**What is next.** Phase 2 connects real telephony: an inbound call reaches an
organization's number, the caller authenticates with the organization access
code plus their PIN, and the same credit engine serves the request.

**Model.** Per-organization subscription plus a per-line fee, with room for
transaction pricing as volume grows. Each organization onboarded brings its
whole customer base onto the platform.

---

## Platform administrator brief (SUPER_ADMIN)

You operate the platform; you do not operate anybody's money.

You can: review and approve or reject organization applications; create the
organization and issue its administrator's first password (shown once);
approve the operating currency; add telephone numbers to inventory and assign
them; issue the first organization access code (shown once); activate, suspend
or close organizations; manage the currency registry and platform settings;
read every transaction and the full audit trail.

You cannot: see any customer PIN; see any organization access code, including
ones you issued; change an organization's access code; post credit; move money;
edit or delete anything in the financial history.

Activation checklist, enforced by the system: currency approved, access code
issued, at least one voice number assigned — only then can an organization go
live.

---

## Organization administrator brief (TENANT_ADMIN)

You run one organization and see nothing outside it.

You can: create and manage customers; open accounts (numbers are assigned
automatically) and set credit limits; issue and reset customer telephone PINs;
post credit, adjustments, debits and repayments; send transfers between your
customers and reverse them with a reason; read your transactions, reports and
audit trail; configure customer care routing and IVR behaviour; rotate your
organization access code.

You cannot: change your approved currency or your organization's status; edit
a balance directly; edit or delete any completed transaction; read a PIN or
your existing access code (rotate it instead); see any other organization.

Rotating the access code invalidates the previous one immediately and is
recorded in your audit trail. The new code is shown once.

---

## Customer brief (Phase 2)

Your organization gives you an account number and a PIN. You call your
organization's number, identify yourself, and the system tells you your
available credit or sends credit to another customer in the same organization.
Your PIN is never visible to anybody — not to your organization, not to the
platform. Repeated wrong attempts lock the line temporarily.

The customer interface is not built yet; the accounts, PINs and rules it needs
already exist.

---

## Phase 2A — secure voice authentication (complete)

The secure boundary between a future telephone call and the credit engine is
built and tested. No telephony provider, SIP or voice AI is present.

- Call sessions are persistent records walking a strict state machine: dialled
  number to organization, organization access code, account number, customer
  PIN, authenticated.
- Identity is always resolved server-side from the session; nothing the caller
  claims is believed.
- Access-code and PIN attempts are counted atomically, lock out on the
  configured thresholds, and are recorded even when the attempt is rejected.
- Repeated provider events are accepted exactly once; sessions expire on time
  alone.
- Money still moves only through `post_credit`, `execute_transfer` and
  `reverse_transfer`.

Full detail: [`PHASE-2A-SECURE-AUTH-REPORT.md`](./PHASE-2A-SECURE-AUTH-REPORT.md).

## Launch blockers

These must be closed before real money or real customers:

1. **Failure auditing** — rejected transfers and credits currently roll back
   their own audit row; record them outside the transaction. (Authentication
   failures are already recorded durably.)
2. **Remove the development test helpers** (`cv_test_*`) from the production
   database.
3. **Scheduled reconciliation with alerting** — run the ledger-versus-balance
   check automatically and raise an alarm on any drift.
4. **Administrator password delivery** — the first organization password is
   shown once on screen; it needs a real delivery and forced-reset flow.
5. **Backup and restore drill** — proven point-in-time recovery of the ledger.
6. **Per-currency rounding enforced on input** before amounts are spoken aloud.

*Closed in Phase 2A: the credential verification service, call-session records,
organization-level rate limiting, and security events in the audit vocabulary.*

## Must-haves (before Phase 2B ships)

- Signed, replay-protected webhook route for the voice provider
- Twilio implementation of the existing `TelephonyProvider` interface
- IVR conversation engine driving the Phase 2A session service only
- Move customer and account creation behind server functions rather than direct
  table writes
- Load testing of the authentication path


## Good to have

- Customer self-service web and mobile views
- Multiple telephone numbers per organization, and number pooling
- Statements and scheduled reports by email
- Bulk customer import
- Currency conversion between organizations
- WhatsApp and USSD adapters reusing the same engine
- Fine-grained organization staff roles (teller, supervisor, auditor)
- Anomaly detection on transfer patterns

---

## Technical notes

Stack: React 19, TypeScript, TanStack Start (Router + server functions), Vite,
Tailwind v4, shadcn/ui, TanStack Query, Supabase/PostgreSQL.

- Business logic lives in `src/lib/services` (client-side reads) and
  `src/lib/*.functions.ts` (server functions); never in components.
- Money moves only through the database functions `post_credit`,
  `execute_transfer` and `reverse_transfer`.
- Telephony is abstracted behind `src/lib/telephony/provider.ts`; no provider is
  implemented yet.
- All schema changes are migrations in `supabase/migrations`.

### Tests

```bash
bun run test:db            # 40 isolation, integrity and immutability assertions
bun run test:concurrency   # account-number and double-spend concurrency proofs
```

Both require `SUPABASE_DB_URL` and are safe to re-run: the first rolls back
entirely, the second removes its fixtures.

A full audit of the hardening work is in
[`PRE-TELEPHONY-HARDENING-REPORT.md`](./PRE-TELEPHONY-HARDENING-REPORT.md).
