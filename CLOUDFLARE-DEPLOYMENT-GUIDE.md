# CreditVoice OS — Cloudflare Workers Deployment & Rollback Guide

Status: **Prepared, not deployed.** No DNS, Twilio, database or tenant changes were made.

## Configuration
- `wrangler.jsonc` (root). No `nitro.config.ts` — the existing Vite config already builds the Cloudflare Worker.
- Build output: Worker `dist/server/index.mjs`, static files `dist/client` (binding `ASSETS`).
- `compatibility_date` `2025-09-01`, flag `nodejs_compat`.
- Webhook route unchanged: `POST /api/public/voice/twilio`.

## Variables
Public (build time, embedded in browser code — safe): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (export in the shell before `bun run build`).
Public runtime var (in `wrangler.jsonc`): `TELEPHONY_PROVIDER=TWILIO`.

Secrets (Worker runtime only, never committed):
```
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_PUBLISHABLE_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put TWILIO_ACCOUNT_SID
wrangler secret put TWILIO_AUTH_TOKEN
wrangler secret put TWILIO_WEBHOOK_BASE_URL   # exact public HTTPS origin, no trailing slash
```
`TWILIO_WEBHOOK_BASE_URL` must equal the origin Twilio is configured to call; signatures are computed from it, never from the Host header. Changing hostname without updating both = every call rejected (fail-closed).

Note: the service-role key is not retrievable from Lovable Cloud. Self-hosting the Worker against the current backend therefore requires a backend you control the keys for (or exported data into your own Postgres).

## Commands
```
bun install
bun run build
bunx wrangler@4 dev                # local test on the built Worker
bunx wrangler@4 deploy             # deploy (workers.dev); custom domain via Cloudflare dashboard
```

## Verification run (2026-10-30, local `wrangler dev` on the production build)
| Check | Result |
|---|---|
| Production build | PASS |
| Worker starts locally | PASS |
| SSR `/` | PASS (200) |
| Static assets | PASS for root; individual JS asset fetch not separately confirmed |
| Webhook GET | PASS (405) |
| Forged / unsigned webhook POST | PASS (403) |
| Secret names/values in client bundle | PASS (none; only the library's `sb_secret_` prefix check string) |
| Sign-in, tenant authorization, financial RPCs on Worker | NOT TESTED (needs runtime service key; unchanged code paths, RLS/RPCs enforced by the database) |
| Valid signed Twilio call on Cloudflare hostname | NOT TESTED (requires deploy + Twilio webhook change) |

## Cutover (when approved)
1. Deploy to a workers.dev URL; set secrets with that URL as `TWILIO_WEBHOOK_BASE_URL`.
2. Smoke test sign-in and pages.
3. Point the **Test Cooperative** number only to the new webhook; place a test call.
4. Only then move Pilot.

## Rollback
The Lovable deployment `https://creditvoice.lovable.app` stays live and untouched.
1. In Twilio, set the number's voice webhook back to `https://creditvoice.lovable.app/api/public/voice/twilio` (POST).
2. Revert any DNS change to the previous record.
3. Optionally `wrangler rollback` or delete the Worker.
No database rollback is needed: the Worker holds no data; the ledger lives only in the database.

---

# Final Cloudflare Preview Readiness Audit (2026-10-30, local only, nothing deployed)

## Verified configuration
- Entrypoint `dist/server/index.mjs` (built Worker, `no_bundle`), assets `dist/client` via `ASSETS` binding.
- `compatibility_date` 2025-09-01 + `nodejs_compat`: worker settings are copied into `process.env` (confirmed locally), which is how all server code reads them.

## Local results (`wrangler dev` on the production build)
| Check | Result |
|---|---|
| Individual JS files (4 sampled) | PASS 200 `text/javascript` |
| CSS (`styles-*.css`) | Present and referenced by SSR HTML; direct fetch NOT separately checked |
| Unknown asset | 404 (no SSR fallthrough) |
| SSR `/`, `/auth`, `/reset-password` | PASS 200 |
| Protected `/org`, `/admin` | Render 200 shell; access gate runs `beforeLoad` → redirect to `/auth` in browser. Data protection is server/RLS, not the shell |
| Settings binding access | PASS (Twilio values read; missing service key reported by name only) |
| Signed Twilio request (local token, canonical base `https://preview.example.test`) | Signature ACCEPTED; then failed safely (no service key) with generic TwiML 500 |
| Forged signature with spoofed Host | 403 — canonical URL ignores Host |
| Web Crypto HMAC-SHA1, PBKDF2 100,000 iterations | PASS locally |
| Logs | Structured, CallSid/event/result only; no token, key, PIN or digits printed |

Caveat: local workerd accepted 100,001 PBKDF2 iterations; production Cloudflare caps at 100,000 (seen in Attempt #1). The code's cap of 100,000 is the safe value; only a real preview proves it.

## Requires a real Cloudflare preview
Sign-in and session cookies on the preview hostname; service-role database access; tenant-scoped RPCs (account/settings reads as Test Cooperative admin, read-only); PBKDF2 under production limits; live signed Twilio call (needs a webhook change — Test Cooperative number only, and only with approval); auth email redirect allowlisting; Cloudflare log tail review.

## Exact settings required (values never shown here)
Build time (public): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`.
Worker var: `TELEPHONY_PROVIDER=TWILIO`.
Worker secrets: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WEBHOOK_BASE_URL` (= preview origin, e.g. `https://creditvoice-os.<subdomain>.workers.dev`), `ADMIN_ONBOARDING_BASE_URL`, `ADMIN_ONBOARDING_EMAIL_READY` (keep unset/false), `LOVABLE_API_KEY`, `LOVABLE_SEND_URL` (auth email), `LOVABLE_CRON_SECRET` (+ `_PREVIOUS` if rotating).

## Preview checklist
1. Obtain a backend service-role key (BLOCKER — not available from Lovable Cloud).
2. Obtain `LOVABLE_API_KEY`/send URL equivalents or leave auth email disabled on preview.
3. `bun run build` with public vars exported; `wrangler deploy` to workers.dev (no custom domain, no DNS).
4. Set secrets; `TWILIO_WEBHOOK_BASE_URL` = workers.dev origin.
5. Smoke: pages, CSS/JS, `/org` redirect, sign-in as Test Cooperative admin, read-only settings view, Pilot invisible.
6. Webhook: forged → 403, GET → 405; live call only after approval, Test Cooperative number only.
7. `wrangler tail` review for credential/customer data.
8. Rollback: delete/rollback Worker; Twilio + DNS untouched so creditvoice.lovable.app remains authoritative.

## Remaining blockers
- Service-role key / owned backend for the self-hosted Worker.
- Auth email sender key and redirect allowlist for the preview hostname.
- Approval for any Twilio webhook change.
- Pre-existing: email DNS verification, remaining Gate D live cases.
