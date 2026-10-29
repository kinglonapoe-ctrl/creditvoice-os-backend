# CreditVoice OS — E2E Test Isolation and Audit Baseline Reconciliation

Date: 2026-10-29. No real account, balance, ledger entry, transaction, transfer,
organization, phone assignment, credential or existing audit record was changed.
None of the 12 incident records was deleted, annotated or modified. The 15
orphaned numbering settings were not touched.

## Root cause of the live write

`phase2b-e2e.test.ts` (and `phase2b-load.ts`) checked only `SUPABASE_DB_URL` for
their own psql fixtures, but the webhook handler they drive writes through the
server admin client, which reads `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.
In the managed environment both point to the live application database, so
the suite wrote to production regardless of which psql URL was supplied.

## A. Fail-closed guard (`supabase/tests/isolated-db-guard.ts`)

Runs at module top level, before any setup, request or handler import:

1. Requires `CV_E2E_ISOLATED=1` plus dedicated `CV_TEST_DB_URL`,
   `CV_TEST_SUPABASE_URL`, `CV_TEST_SERVICE_ROLE_KEY`. No fallback to
   `SUPABASE_URL`/`SUPABASE_DB_URL`.
2. Refuses URLs naming the live project, the live API/DB hosts or `PGHOST`, and
   a service key equal to the live key.
3. Positive identity: the database must report
   `creditvoice.isolated_test = on` (set once on the isolated DB with
   `ALTER DATABASE … SET creditvoice.isolated_test = 'on'`; never set live) and
   must contain neither live organization ID.
4. Only then pins `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` to the isolated
   stack and removes `SUPABASE_DB_URL` from the process.

## B. Identifiable, run-scoped test records

- Every simulated CallSid is `CA-QA-e2e-<runId>-<case>` (`CV_QA_RUN_ID` or random).
- Caller `+15005550006`, unknown destination `+15005550001` (Twilio reserved
  test numbers) replace the Nigerian-format placeholders.
- `afterAll` runs `runCleanupSql(RUN)`, which deletes only sessions whose
  `provider_call_id` starts with the current run prefix, and their audit rows
  (`entity_type = 'call_session'`), auth failures, events, grants and failure
  events. It rejects any prefix not matching `^CA-QA-[a-z0-9-]+$`, so wildcards
  cannot widen it. Tenant fixtures are still removed by the existing
  `cv_test_voice_cleanup` (QA-named organizations only).

## Tests executed

| Test | Result |
|---|---|
| `isolated-db-guard.test.ts` (opt-in, no fallback, live ref, live host, live key, accept isolated, cleanup scoping) | PASS 7/7 |
| E2E suite with no opt-in | ABORTED before setup: "CV_E2E_ISOLATED=1 is not set" |
| E2E suite deliberately given live credentials as CV_TEST_* | ABORTED: "a test URL names the live project" |
| Load harness with no opt-in | ABORTED before setup |
| Live counts around those runs (call sessions / audit rows) | 43/940 before, 43/940 after — no writes |
| Full E2E + cleanup against an isolated stack | **NOT TESTED** — this environment has no isolated database with its own API endpoint; the handler requires one. Must be run on a disposable stack before the guard is considered end-to-end verified. |

## C. Audit baseline reconciliation — VERIFIED

The baseline (`d6a57853ade5a6a0ca2bff99b3b4d2ee`, 930 rows created before
06:40 UTC) was reproduced exactly today with
`md5(string_agg(to_jsonb(t)::text, '' ORDER BY id))`.

The mismatching value seen in the post-test audit
(`538d65dd1f497e321cc5b181a996d566`) used `row_to_json(t)::text`. That method
serializes differently (keeps column order and original spacing; `jsonb`
normalizes key order and whitespace), so the two hashes can never be equal for
the same data. The discrepancy is a method difference, not a data change.

Result: all 930 pre-existing activity records are identical to the baseline,
compared over complete row contents in stable ID order. Limitation: the
baseline is an aggregate hash, so it proves "all unchanged" but could not
localize a change to a single record had one occurred.

## D. Proposed cleanup plan (NOT executed — awaiting approval)

| Records | Recommendation |
|---|---|
| 10 activity-log entries (all `call_session` entities, 06:43 UTC run) | **Preserve.** Activity log is append-only (`t_audit_immutable`). Add a new, separate append-only `QA_ARTIFACT_ANNOTATED` audit entry listing the 10 IDs, the run, and the reason; no edit to the originals. |
| 1 failed-sign-in record for session `80bfc0f0-1cc9-409c-abaf-c314b1bba73b` | Preserve alongside the annotation (security evidence), or delete in one reviewed change that verifies the exact ID, tenant-less, `UNRESOLVED_DESTINATION`. |
| 1 simulated call session `80bfc0f0-1cc9-409c-abaf-c314b1bba73b` (`CA-unknown`) | Same as above; deleting it would orphan the preserved audit entity references, so preservation + annotation is recommended. |

Any approved operation should check exact IDs, counts and the before/after
fingerprints of every operational table, using the `to_jsonb` method above.

## Files changed

- `supabase/tests/isolated-db-guard.ts` (new)
- `supabase/tests/isolated-db-guard.test.ts` (new)
- `supabase/tests/phase2b-e2e.test.ts` (guard, run-scoped IDs, synthetic numbers, cleanup)
- `supabase/tests/phase2b-load.ts` (guard)
- `E2E-TEST-ISOLATION-REPORT.md`, `roadmap.md`, `AGENTS.md`
