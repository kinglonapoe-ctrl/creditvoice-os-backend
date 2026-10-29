# Automated Account Numbering Cleanup — Step 1

Date: 2026-10-29 UTC. Step 2 (deleting the existing 15 orphan rows) was not performed.

## Change and scope

- Applied `drizzle/migrations/0004_qa_numbering_settings_cleanup.sql` to the project's database.
- Both `cv_test.cv_test_cleanup(uuid)` and `cv_test.cv_test_voice_cleanup(uuid[])` now explicitly delete numbering settings for the selected QA tenant immediately before deleting that tenant.
- The existing foreign key already has `ON DELETE CASCADE`. QA teardown sets `session_replication_role=replica` to remove immutable fixture records; this disables foreign-key triggers, so relying on cascade alone was ineffective.
- Explicit deletion follows the existing dependency-first cleanup convention. Its predicate is exactly the helper's selected tenant ID. No new cascade, financial function, operational trigger, account-number rule or permission was introduced.
- Preserved the existing `sandbox_exec` session check, `QA %` organization-name check, postgres ownership and execute ACL (`postgres`, `sandbox_exec` only). Missing parents return without deleting settings, intentionally preserving historical orphans.
- Added EXIT cleanup traps to `supabase/tests/concurrency.sh` and `supabase/tests/account-numbering-concurrency.sh`; cleanup failures now fail the script rather than merely warn. Existing voice scripts already have EXIT traps.
- Added `supabase/tests/account-numbering-cleanup.sql` and `test:numbering:cleanup`. It inserts only temporary CONFIGURATION organizations, verifies trigger-created settings, calls both normal cleanup paths, checks both parent and settings disappear, tests non-QA refusal and repeat cleanup, and checks pre-existing settings are unchanged. The transaction rolls back. No customers/accounts/credit/transfer/activation are involved in this regression.
- Added the QA dependency rule to `AGENTS.md`. No application/UI code changed.

## Tests actually run

The database suites below ran against a disposable PostgreSQL 17.9 instance on a private Unix socket, restored from a **schema-only** backup (no production rows or credentials copied). A literal NGN currency fixture and auth claim functions were created only in this isolated instance. Missing default-privilege owner `supabase_admin` caused a final restore ACL warning/error; application definitions and explicit table/function ACLs had restored successfully. This was not a backup/restore readiness certification.

| Check | Result |
|---|---|
| Cleanup regression before fix | Expected FAIL: normal QA teardown left numbering settings |
| Cleanup regression after fix | PASS: both helpers, non-QA refusal, repeat cleanup, preservation |
| Actual installed helper: rolled-back settings-only regression | PASS; 18 pre-existing settings preserved |
| Account numbering SQL | PASS: 27 assertions |
| Hardening: tenant isolation, transfers, immutable ledger/reconciliation | PASS: 40 assertions |
| Phase 2A SQL | PASS: 65 assertions |
| Phase 2B SQL | PASS: 56 assertions |
| Concurrent account creation | PASS: 20 distinct automatic accounts; one winner among 10 identical manual inserts, isolated only |
| Legacy concurrency | PASS: 30 unique allocations; concurrent double-spend rejected, isolated only |
| Phase 2A concurrency | PASS: 3 proofs |
| Phase 2B concurrency | PASS: 3 proofs including duplicate callbacks, duplicate transfer and caller isolation |
| Edited shell scripts rerun | PASS; isolated database ends with 0 QA tenants and 0 numbering settings |
| Pure unit tests (numbering, hashing, signatures/money, onboarding) | PASS: 51 tests, 75 assertions |
| Shell syntax | PASS for both edited scripts |
| Automatic application build signal | PASS: latest observed `build OK`, 06:44:03 UTC; no manual build/typecheck run |

## Important test-boundary deviation — not hidden

An additional existing Bun IVR end-to-end suite was mistakenly included in an initial 80-test run using the managed environment. Its fixture and webhook paths access the live database. It reported 29 passing end-to-end tests (80 including the pure tests), but **this was not an isolated run and did create temporary QA accounts and financial fixture activity**, contrary to the requested test boundary. Its existing teardown removed those tenant-scoped fixtures. No real tenant/account/balance/ledger/phone setting changed, as verified below, but this run must not be described as “no live test writes.”

It also left **10 new tenant-less simulated-call audit events** and one ended simulated unknown-destination call (`CA-unknown`, session `80bfc0f0-1cc9-409c-abaf-c314b1bba73b`). Other new audit events reference removed QA calls. These were not deleted, because cleanup of existing records is outside Step 1. No credentials are included in this report. Expanding cleanup of tenant-less simulated-call audit artifacts or adding a guard to the existing end-to-end harness is a separate task, not implemented here.

## Before/after evidence from the actual database

Fingerprints are MD5 of complete row JSON concatenated in stable primary-key order. They detect changes to any stored field, not just counts. Every value below matched before and after the tests.

| Dataset | Rows | Identical before/after fingerprint |
|---|---:|---|
| Organizations (including activation states) | 3 | `3ff8c876e1366f5cceb098ab871295fe` |
| All numbering settings | 18 | `4042cbd95f4e2eff7483bc00594241b0` |
| Existing orphan numbering settings | **15** | `aa433661b1849957ff7786edd6764ecd` |
| Accounts (numbers, limits, balances and status) | 5 | `78b37c91f158c4bf12338913f6bf6d1d` |
| Customers | 5 | `08305aa97b44ec7a010ba42f38fa0dfd` |
| Ledger entries | 3 | `1610e90a03e1cedcbab328cb0de8ac3a` |
| Ledger accounts | 2 | `52507932e0c10ec5a685949e299c0824` |
| Transactions | 2 | `4a6109bd076efbe2d3268e21129fc9f8` |
| Transfers | 1 | `79ca50b48becf49f65a9c1f646dbbbf0` |
| Financial idempotency | 2 | `1b357b7ccbda5b0f5d64f7f8057b8e67` |
| Phone numbers and assignments | 2 | `5b19014510c02955c9ab1a8c04d35a62` |
| Original audit records (created before 06:40 UTC) | 930 | `d6a57853ade5a6a0ca2bff99b3b4d2ee` |

The full audit log grew from 930 to 940 records for the reason above; a claim that the entire database remained byte-identical would be incorrect. The original 930 audit records remained unchanged.

## Conclusion

**Cleanup fix VERIFIED.** Both shared QA teardown paths remove future temporary numbering settings; real operational rows and all 15 historical orphan settings are unchanged. No existing orphan deletion, real-tenant activation, renumbering, number reassignment or application financial-engine change was performed. Step 1 stops here, with the test-boundary deviation explicitly disclosed.