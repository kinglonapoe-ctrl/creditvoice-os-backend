# CreditVoice OS — roadmap

## First isolated test organization — blocked on operator decisions

- [x] Investigate uploaded onboarding blockers: no eligible number, missing secure recovery/setup workflow, expanded read-only isolation verified; approvals documented without changing mappings or money.
- [x] Inspect existing workflows, deployed state and current number ownership.
- [x] Create CreditVoice Test Cooperative and tenant administrator through supported workflows.
- [x] Create two test customers/accounts, issue hashed credentials and save safe disabled customer care.
- [x] Verify tenant-admin isolation, zero ledger balances and rejection of activation without a number.
- [ ] Post requested opening credits and activate — no unmapped voice number; operator explicitly kept CreditVoice Pilot mapping.
- [ ] Secure administrator credential handoff — invitation/password-setup/recovery workflow absent; needs explicit implementation authorization and verified email delivery.
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
