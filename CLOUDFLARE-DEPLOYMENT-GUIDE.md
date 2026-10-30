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
