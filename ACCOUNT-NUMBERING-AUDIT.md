# Tenant-Controlled Account Numbering — Audit (read-only)

Date: 2026-10-28. No code, schema, data, balances or configuration were changed.

## Findings (verified against live database and source)

| # | Question | Finding | Status |
|---|---|---|---|
| 1 | Generation | `t_assign_account_number` (BEFORE INSERT) calls `allocate_account_number(tenant)`, an atomic `UPDATE … RETURNING` on `tenant_account_sequences` (row lock, starts 10001). Returns `n::text`, no padding. | Works, auto-only |
| 2 | Manual entry | Trigger **overwrites** any supplied number unless caller is SUPER_ADMIN ("clients may not choose their own numbers"). Org Accounts form (`src/routes/_authenticated/org/accounts.tsx`) has no account-number field; `createAccount` inserts without one. | GAP |
| 3 | Hardcoded length | DB: no length/format CHECK. Generator: implicit 5 digits from 10001 seed. UI: none. Imports: no import feature exists. IVR: `numDigits: 20` with `#` terminator for account and recipient (`engine.server.ts`). | Mostly flexible; generator fixed |
| 4 | Uniqueness | `UNIQUE (tenant_id, account_number)`; no global uniqueness. Same `10001` exists in Pilot, pair ltd and Test Cooperative. | OK |
| 5 | Storage | `text` column. Values compared as text, so `00123` ≠ `123`. Leading zeros preserved if stored; generator never emits them. | OK |
| 6 | IVR rules | Collects up to 20 digits, exact text match within session tenant (`cv_identify_account`). No tenant-specific length/pattern; wrong-length input simply counts as a failed attempt. | GAP (minor) |
| 7 | Transfer scope | `cv_prepare_transfer` resolves recipient `where tenant_id = s.tenant_id`; `execute_transfer` rejects cross-tenant pairs. | OK |
| 8 | Existing numbers | Update guard forbids changing `account_number`. Pilot 10001/10002, Test Cooperative 10001/10002, pair ltd 10001 can remain untouched. | OK |
| 9 | Optional auto-numbering | Allocator is independent of the trigger branch; making it conditional keeps the same row-locked sequence. Manual numbers race safely via the unique constraint (second insert fails, no partial state). | Safe |

Additional risk: sequence and manual numbers can collide (manual `10005`, sequence later yields `10005`) → insert error, not corruption. Plan below handles it.

## Gaps
1. Tenants cannot assign numbers (trigger overwrites; no form field).
2. No per-tenant length/format configuration.
3. Generator ignores length/padding.
4. IVR does not use tenant length (works, but no early rejection / `numDigits` hint).

## Minimal backward-compatible plan (not implemented)
1. **Settings (additive):** new table `tenant_account_number_settings(tenant_id pk, mode text default 'MANUAL' check in ('MANUAL','AUTO'), min_length int, max_length int, pattern text default '^[0-9]+$', pad_length int null)`. Backfill existing tenants as `AUTO`, min/max 5 so current behaviour is unchanged. New tenants default to `MANUAL`.
2. **Trigger:** replace `assign_account_number` so: empty + AUTO → allocator (pad with `lpad` when `pad_length` set, loop skip if number already taken); empty + MANUAL → reject; supplied → validate against length/pattern for tenant admins of that tenant (still tenant-scoped by existing RLS/guard). Keep immutability guard.
3. **Allocator:** unchanged locking; add collision skip.
4. **UI:** optional/required "Account number" input on the Accounts form per mode; settings card on org Settings page; client validation mirrors DB (DB stays authoritative).
5. **IVR:** pass tenant `max_length` from `cv_ivr_config` into `numDigits` (fallback 20); keep `#`; text match unchanged.
6. **Tests:** per-tenant length accept/reject, leading-zero round trip, duplicate within tenant rejected, same number across tenants allowed, concurrent AUTO inserts unique, existing Pilot/Test Cooperative numbers unchanged.

No renumbering, activation, opening credit or ledger change is required.
