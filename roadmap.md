# CreditVoice OS — roadmap

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
