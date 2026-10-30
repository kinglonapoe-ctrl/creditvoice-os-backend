# CreditVoice OS — Hybrid Cloudflare Architecture Investigation

Date: 2026-10-30. Investigation only — nothing deployed, no DNS/Twilio/backend/data changes.

## Key facts (verified in source)
- Browser-side operations use the publishable key + the signed-in user's token; RLS and `SECURITY DEFINER` RPCs enforce tenant/role rules. These work from any host.
- Signed-in server functions (`requireSupabaseAuth`) re-validate the user token and run **as the user** (RLS applies).
- Some server functions and the **entire phone system** use the service-role client (`supabaseAdmin`). Anonymous/authenticated execution of the `cv_*` call-session functions is revoked, so the phone system cannot run without the service-role key.
- The service-role key exists only inside the Lovable-hosted runtime; Lovable Cloud does not release it. No documented Lovable endpoint exists for a third-party host to perform privileged operations on its behalf.

## 1. Server-operation dependency matrix
| Operation | Class | Where it runs | DB access | Secret needed | Safe on Cloudflare (hybrid, no service key)? |
|---|---|---|---|---|---|
| Pages, assets, SSR | A | Worker | none | none | YES |
| Sign-in / session | B | Browser → Auth | publishable key | none | YES |
| Customer & account creation, number assignment (`assign_account_number` trigger) | C | Browser | RLS as tenant admin | none | YES |
| Numbering settings (`set_account_numbering_settings`) | C | Browser RPC | definer, role-checked | none | YES |
| Balance view, reconciliation (`reconcile_account_balances`) | B/C | Browser RPC | RLS / definer | none | YES (read) |
| Credit posting (`post_credit`), transfers (`execute_transfer`), reversals (`reverse_transfer`), ledger, idempotency | E | Browser RPC → database procedures | definer, role + tenant checked, atomic | none | YES technically (logic stays in DB) — but preview must not call them |
| Currency change (`change_organization_currency`) | D | Server fn as user | definer, Super Admin | publishable | YES |
| Change access code / set customer PIN | C/E | Server fn | **service role** (hash write + audit) | service key | NO |
| Claim platform ownership, approve/reject application, create admin user | D | Server fn | **service role** + Auth admin | service key | NO |
| Issue access code, phone number add/assign/release, tenant status, currency active | D | Server fn | **service role** | service key | NO |
| Admin onboarding (setup/recovery, rate limit, claim) | C/D | Server fn | **service role** + Auth | service key, email key | NO |
| Twilio webhook + IVR + call auth + voice transfer (`cv_*`, `cv_execute_voice_transfer`) | E | Server route | **service role** | service key, Twilio token | NO |
| Security/audit logging | E | DB triggers + service-role inserts | mixed | service key for app-side inserts | Partly (triggers yes) |
| Auth email webhook | A (signed) | Server route | none | Lovable API key | NO (key is platform-held) |
| Scheduled jobs (session expiry) | E | DB / cron route | definer | cron secret | Keep on Lovable |

## 2. Secure backend connectivity
- The existing Lovable deployment (`creditvoice.lovable.app`) already runs every privileged operation with the key protected, user re-validation, server-side tenant checks, signature verification and DB-level replay/idempotency.
- Its server functions are reachable over HTTPS, but their URLs are **internal build artefacts**, not a supported, versioned API. Calling them cross-origin from a Cloudflare app is undocumented and could break on any rebuild; it would also need CORS changes. Not recommended as-is.
- A supported route exists for external callers: server routes under `/api/public/*` (as used for Twilio). A dedicated, signed privileged API could be built there later — that is new work, not an existing endpoint.
- Twilio must not be proxied through Cloudflare: Twilio signs the URL it calls, and the handler verifies against the fixed Lovable base URL. Twilio → Lovable directly stays the correct path.

## 3. Options
| | A: Cloudflare app + Lovable DB (publishable key only) | B: Cloudflare frontend, privileged ops stay on Lovable | C: Staged hybrid → own backend later |
|---|---|---|---|
| Security | Good for classes A–C; privileged features broken (not bypassed) | Good if a proper signed API is built; poor if internal URLs are called | Best long-term; full key control |
| Complexity | Low | Medium–high (new API, CORS, two deploys) | Phased; highest total |
| Cost | Cloudflare + current | Cloudflare + current | + own backend plan |
| Limitations | No phone system, onboarding, PIN/access codes, platform admin | Two systems to keep in step | Data migration later |
| Effort | Config only (done) | New API layer | Migration project |

**Recommendation: C, starting now as A-for-preview with Lovable remaining production.**
- Production (web, phone, privileged ops) stays on `creditvoice.lovable.app`.
- Cloudflare preview hosts the app with publishable credentials only; privileged screens fail closed.
- Later: provision an independently controlled backend, migrate schema/data under a separate approved plan, then move the Worker and Twilio.

```text
Browser ──► Cloudflare Worker (preview: pages, SSR, sign-in)
   │              │ publishable key + user token (RLS)
   │              ▼
   └────────► Lovable Cloud database / auth / ledger  ◄── Lovable app (production)
                                                          ▲  service key (held by Lovable)
Twilio ──signed webhook──────────────────────────────────┘
```

## 4. Financial integrity
Unchanged in every option: all money moves inside existing database procedures (atomic, double-entry, serialized, idempotent, reversal-only, same tenant/currency). No financial logic moves to the browser; RLS is never bypassed. Preview tests must not call `post_credit`, `execute_transfer` or `reverse_transfer`.

## 5. Cloudflare preview plan
Testable without the service key (on a workers.dev preview):
1. Page/JS/CSS delivery and 404s.
2. Sign-in/sign-out, session refresh (preview hostname must be added to allowed auth redirect URLs — a backend Auth setting; needs approval).
3. Tenant isolation and read-only org views as Test Cooperative admin (Pilot not visible).
4. Protected `/org`, `/admin` redirect when signed out; admin-only pages refused to non-admins.
5. Privileged actions fail closed with a generic error (e.g. set PIN) — confirm no partial writes.
6. Secret leakage scan of the client bundle; `wrangler tail` log review.
Requires a supported privileged backend (not testable): PIN/access code changes, onboarding emails, platform admin, phone webhook/IVR, PBKDF2 under production limits *via the app*. Twilio signature logic can be tested with a preview-only test token against the preview URL (no live number change); with no service key it stops safely after the signature check.

## 6. Required settings (names only)
Cloudflare build vars (public): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`.
Cloudflare secrets (preview): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`; optional preview-only `TWILIO_AUTH_TOKEN` test value + `TWILIO_WEBHOOK_BASE_URL` = preview origin. Do **not** set `SUPABASE_SERVICE_ROLE_KEY` (unavailable) or the real Twilio token on the preview.
Lovable (unchanged, held by platform): service key, Twilio credentials, email key, cron secret.

## 7. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Preview writes real data (shared database) | Read-only test script; test admin only; no financial RPCs; record row counts before/after |
| Calling undocumented Lovable internals | Not used; future privileged API must be a signed `/api/public/*` route with caller verification |
| Auth redirect misuse | Allowlist only the exact preview origin |
| Secret leakage | Only publishable values on Cloudflare; bundle scan |
| Two hosts confuse users | Preview on workers.dev only, no DNS |
| Twilio misrouted | Twilio untouched; stays on Lovable |

## 8. Blockers and solutions
1. Service key not available → keep privileged ops on Lovable (now); own backend (Option C later).
2. Preview auth redirect allowlist → approve adding preview origin.
3. No supported privileged API → build a signed server route only if Option B is chosen.
4. Shared production database → strict read-only preview tests.

## 9. Rollback
- Cloudflare: `wrangler delete` / rollback; nothing depends on it.
- DNS: unchanged, nothing to revert.
- Twilio: unchanged, both numbers still point to `creditvoice.lovable.app/api/public/voice/twilio`.
- Backend: only possible change is the redirect allowlist entry — remove it.
