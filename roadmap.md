# CreditVoice OS — Phase 2B roadmap

- [ ] Migration: IVR/voice config columns, IVR state on call sessions, transfer grants, financial failure events, cv_ivr_* / cv_prepare_transfer / cv_execute_voice_transfer / cv_customer_care_route, sandbox helpers
- [ ] Twilio signature verification (HMAC-SHA1, canonical URL)
- [ ] TwiML builder + Twilio provider adapter implementing TelephonyProvider
- [ ] Deterministic IVR engine (welcome → access code → account → PIN → menu → actions)
- [ ] Amount parsing with per-currency decimal precision (no floats)
- [ ] Public webhook route /api/public/voice/twilio (POST only)
- [ ] Customer care routing with organization timezone and business hours
- [ ] Tests: signature, TwiML, amount, IVR e2e, security, concurrency
- [ ] .env.example, README, PHASE-2B-TWILIO-IVR-REPORT.md
- [ ] Minimal platform-admin voice operations view
