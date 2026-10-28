# Tenant-Controlled Account Numbering — Completion Report (2026-10-28)

Implements the plan in `ACCOUNT-NUMBERING-AUDIT.md`. No activation, opening credit, transfer or financial posting performed.

## Database (migration `tenant_account_numbering`)
- New `tenant_account_number_settings` (mode MANUAL|AUTOMATIC, min/max 1..20, format DIGITS, optional pad_length; CHECK constraints). RLS: read own tenant / platform admin; no client writes.
- Backfill: every existing tenant → AUTOMATIC, 5..5 (current behaviour). Trigger `t_tenant_numbering_defaults` gives new tenants MANUAL (5..10 default).
- `account_number_matches_rules(tenant, number)` — shared rule check (service-only).
- `allocate_account_number` — same row-locked sequence; now skips numbers already taken (incl. manual), honours padding/min length, errors when range exhausted.
- `assign_account_number` — never replaces an entered number; validates it; requires a number for tenant admins in MANUAL mode; rejects customers from another tenant. System/test inserts without a number still auto-allocate.
- `set_account_numbering_settings` — tenant admin of own tenant or platform admin only; server-side validation; rejects rules that existing numbers would not fit; writes `ACCOUNT_NUMBERING_UPDATED` audit row.
- `cv_ivr_config` exposes min/max length; `cv_identify_account` and `cv_prepare_transfer` check format before lookup with unchanged generic responses and attempt counting.
- Unchanged: unique (tenant_id, account_number), text storage, immutability guard, execute_transfer/post_credit/reversal/ledger.

Rollback: restore previous definitions of the five replaced functions (in earlier migrations) and drop the trigger `t_tenant_numbering_defaults`; the settings table can stay unused. No account rows were modified, so no data rollback is needed.

## App
- `src/lib/account-numbering.ts` (rule mirror, IVR digit limit), `src/lib/services/organization.ts`, `src/routes/_authenticated/org/accounts.tsx` (number field), `src/routes/_authenticated/org/settings.tsx` (Account numbering card), `src/lib/voice/ivr/engine.server.ts` (numDigits = tenant max; `#` kept).

## Tests actually run
| Suite | Result |
|---|---|
| `supabase/tests/account-numbering.sql` | 27/27 pass |
| `supabase/tests/account-numbering.test.ts` | 5/5 pass |
| `supabase/tests/account-numbering-concurrency.sh` | 2/2 pass (20 parallel auto → 20 distinct, manual skipped; 10 parallel same manual → 1 stored) |
| hardening.sql | 40/40 |
| phase2a.sql | 65/65 |
| phase2b.sql | 56/56 |
| unit + e2e + hash | 63/63 |
| concurrency.sh, phase2a/2b concurrency | all PASS |
| build | OK |

## Production data
Fingerprints of all account numbers/balances (5 accounts), ledger entries (3), tenant states and sequences were identical before and after. Pilot and Test Cooperative numbers 10001/10002 unchanged.

## Remaining
- Screens not yet exercised signed in as a real organization admin.
- Changing an organization's rules is blocked if existing numbers would no longer fit (prevents unreachable accounts by phone).
