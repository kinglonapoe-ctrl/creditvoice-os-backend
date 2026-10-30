# CreditVoice OS — roadmap

## Currency change safeguards
- [x] Enforce Super Admin currency changes with atomic dependency checks, shared creation/posting locks and permanent audit.
- [x] Run unauthorized/history/zero-account/concurrency/audit regressions only in a disposable database.
- [x] Verify eligibility and preserve financial, phone, numbering and historical-audit fingerprints; later operator approval superseded the original no-currency-change restriction.
- [x] Execute the newly approved NGN-to-USD change for Test Cooperative and its two eligible zero-history accounts only; audit verified, no activation or money movement.

## Automated numbering test cleanup — Step 1 only
- [x] Fix both shared QA teardown helpers to remove only the selected temporary tenant's numbering settings; add EXIT traps to legacy concurrency scripts.
- [x] Add settings-only cleanup regression; before-fix failure/after-fix success proven, requested SQL/concurrency suites run in isolation.
- [x] Verify real operational data and all 15 orphan settings unchanged; evidence in ACCOUNT-NUMBERING-CLEANUP-REPORT.md.
- Test-boundary deviation: an additional managed-environment IVR fixture run left 10 tenant-less audit events and one ended simulated unknown-destination call; disclosed in report, not cleaned up.
- Existing orphan-row cleanup is excluded and not authorized by this step.

## First isolated test organization — blocked on operator decisions

- [x] Verify operator-provided US number +13185451559 and assign through the supported administrator workflow to Test Cooperative only; provider ownership/voice POST confirmed, Pilot and ledger balances preserved (2026-10-28).
- [x] Implement secure tenant-admin setup/recovery controls, audit and abuse protection; remove temporary-password disclosure.
- [ ] Accept secure onboarding end-to-end — blocked on managed recovery template/redirect configuration, delivery verification and authorized service-only database tests.
- [ ] Complete administrator email configuration — sender domain `notify.creditvoice.securecloudweb.net` registered and DNS verifying; managed auth templates scaffolded with the fragment-token recovery link. Remaining: DNS verification, publish, callback allowlist check, readiness settings, real delivery tests.
- [x] Investigate uploaded onboarding blockers: no eligible number, missing secure recovery/setup workflow, expanded read-only isolation verified; approvals documented without changing mappings or money.
- [x] Inspect existing workflows, deployed state and current number ownership.
- [x] Create CreditVoice Test Cooperative and tenant administrator through supported workflows.
- [x] Create two test customers/accounts, issue hashed credentials and save safe disabled customer care.
- [x] Verify tenant-admin isolation, zero ledger balances and rejection of activation without a number.
- [ ] Activate Test Cooperative — separate authorization needed; new US number is ASSIGNED, tenant remains CONFIGURATION.
- [ ] Post requested opening credits — separate explicit money-movement authorization and operational tenant required; both accounts remain zero.
- [ ] Secure administrator credential handoff — implemented dispatch remains disabled pending secure email configuration and actual delivery/setup verification.
- [x] Report verified evidence and blockers in FIRST-TEST-TENANT-SETUP-REPORT.md.

## Phase 1 — foundation and hardening — complete
## Phase 2A — secure voice authentication — complete
## Phase 2B — Twilio adapter, signed webhook, deterministic IVR — complete

- [x] Database layer (IVR settings, call session IVR fields, failure events, voice grants)
- [x] Twilio provider implementing the existing telephony contract
- [x] TwiML builder, signature verification, DTMF amount parsing
- [x] Deterministic IVR engine over the Phase 2A session
- [x] Public signed webhook route (POST only)
- [x] Tests: 53 database, 27 unit, 29 end-to-end, 3 concurrency proofs
- [x] Platform-admin Voice Operations view
- [x] `.env.example`, README update, `PHASE-2B-TWILIO-IVR-REPORT.md`

## Phase 2B.5 — production readiness gates — NOT YET PASSED (Gate D outstanding)

- [x] Gate A — test helpers moved out of the application schema into `cv_test`
- [x] Gate B — backup taken, restored into an isolated database, verified; one
      orphaned-row defect found and fixed
- [x] Gate C — load harness (`bun run test:load`), 913 turns, integrity held
- [ ] Gate D — one real inbound Twilio call (blocked: no Twilio account, no
      published HTTPS endpoint, no telephone line)

## Open before real customers (see PHASE-2B.5-PRODUCTION-READINESS-REPORT.md)

- [ ] Live Twilio call verification (blocking)
- [ ] Dashboard financial failure auditing
- [ ] Scheduled reconciliation with operator alerting
- [ ] Secure first-administrator password delivery
- [ ] Recording retention, consent and access-audit policy
- [ ] Purge the 21 tenant-less simulated call sessions before the pilot
- [ ] Add `.env` to `.gitignore` (it holds no secret today)

## Tenant-controlled account numbering — implemented
- [x] Per-organization manual/automatic mode, length range, zero-padding (existing orgs kept automatic 5-digit)
- [x] Account number field on Open account; Account numbering card on Organization settings
- [x] Phone menu uses organization length; format checked before lookup
- [x] Tests: numbering suite 27/27, unit 5/5, concurrency 2/2, existing suites unchanged
- [ ] Signed-in check of the new form/settings screens as a real organization admin (not yet run)

## E2E test isolation (see E2E-TEST-ISOLATION-REPORT.md)
- [x] Fail-closed isolated-database guard on phone end-to-end and load suites
- [x] Run-tagged QA call IDs, reserved synthetic numbers, run-scoped cleanup
- [x] 930 original activity records re-verified against baseline
- [ ] Run full end-to-end suite on a disposable isolated stack (blocked: none available here)
- [ ] Handle the 12 incident records (awaiting approval; annotation recommended)
