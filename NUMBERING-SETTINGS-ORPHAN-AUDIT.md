# Unexpected Organization Numbering Settings — Forensic Audit (read-only)

Date: 2026-10-28. No data, settings, or configuration was changed.

## Finding
`tenant_account_number_settings` holds 18 rows, but only 3 organizations exist
(CreditVoice Pilot, pair ltd, CreditVoice Test Cooperative). The other **15 rows
belong to no organization at all**: their `tenant_id` has no row in `tenants`.
There is no display name to report, because the organizations were deleted.

| tenant_id | mode | length | created (UTC) |
|---|---|---|---|
| c1b80331-b0be-4b69-bf90-f2b14db874de | MANUAL | 5–10 | 10:59:42 |
| 4be7cd60-178f-4c6a-a288-51f186b0080e | AUTOMATIC | 5–8 | 10:59:42 (updated_by 322ac79f…, user no longer exists) |
| 3d9d60e4-5116-4de3-9510-f3692ca96bcb | MANUAL | 5–10 | 10:59:55 |
| 69e0562e-146e-44b9-8780-d6dcca013cf6 | MANUAL | 5–10 | 10:59:55 |
| b59cc085-4874-47a5-9380-99e8ca3f187d | MANUAL | 5–10 | 10:59:55 |
| 297e1079-29fe-4e49-8a26-00babdf377d5 | MANUAL | 5–10 | 11:00:25 |
| f45b1d47-76b3-4b39-869f-78f8cf9a567b | MANUAL | 5–10 | 11:00:25 |
| cd26845e-7545-4033-8b35-d7ee156f17c2 | MANUAL | 5–10 | 11:00:26 |
| b73f2477-0634-4233-afbf-d0cd687da00f | MANUAL | 5–10 | 11:00:26 |
| e69868a8-cbaa-4d53-8eff-88158f76014b | MANUAL | 5–10 | 11:00:38 |
| 6365d940-447a-49b8-a6f9-34e3c3b95ae1 | MANUAL | 5–10 | 11:00:38 |
| aec06759-1477-43c6-9b31-88422de452ce | MANUAL | 5–10 | 11:00:38 |
| 6f7729f1-7162-4368-aff5-84d878d759e4 | MANUAL | 5–10 | 11:00:42 |
| eb17b53a-2058-499a-82b2-631ea0b67a0c | MANUAL | 5–10 | 11:00:42 |
| 33b6ce6e-fa74-48c9-bba0-f09422d3bdcd | MANUAL | 5–10 | 11:00:42 |

All created 2026-10-28 between 10:59:42 and 11:00:42, ~3 minutes after the
numbering migration backfill (10:56:12), in pairs/triples sharing one transaction timestamp.

## Root cause (confirmed)
- Test helper `cv_test.cv_test_setup()` creates "QA …" organizations; new orgs get
  default settings (MANUAL 5–10) from the `create_default_numbering_settings` trigger.
- `cv_test.cv_test_cleanup()` deletes the organization with
  `session_replication_role = 'replica'`, which **disables the ON DELETE CASCADE**
  foreign key, and it predates the new settings table so never deletes it explicitly.
- `4be7cd60…` shows AUTOMATIC 5–8, exactly what `account-numbering-concurrency.sh`
  sets; the others match plain setup defaults from the other suites run that minute.

Classification: **confirmed test artifacts** (by mechanism, timing and values, not by name).

## Linked data
For all 15: 0 accounts, customers, sequences, user roles, phone numbers, audit
records, transactions, ledger entries. No other table has orphaned tenant references.

## Impact
- Tenant isolation: none — the rows match no real organization or user.
- Numbering: none — settings are read only by tenant_id of a real org.
- Phone routing / reporting / admin screens: none — those list organizations, not settings rows.
- Integrity: the orphans exist despite a foreign key; a future FK revalidation or
  restore with constraint checks could fail on them.

## Recommendations (not done — needs approval)
1. Update `cv_test_cleanup` to delete `tenant_account_number_settings` (and any
   future tenant-scoped tables) before the org.
2. Remove the 15 orphan rows through a reviewed migration.

## Activity log visibility
Signed in as the Test Cooperative administrator, Organization → Security showed both
"Account Numbering Updated" entries (Oct 28, 01:51 PM). **PASS.** No settings changed.
