# Secure tenant administrator onboarding

Date: 2026-10-17 UTC. Status: IMPLEMENTED, DISPATCH BLOCKED; NOT END-TO-END ACCEPTED.

## Changes

- `src/lib/onboarding/policy.ts`: single tenant-admin eligibility, password rules, expiry/attempt eligibility.
- `src/lib/onboarding.functions.ts`: platform-authorized setup email for an existing tenant admin, generic public recovery response, native Auth recovery-token verification, matching-user/session binding and atomic single-use completion. No roles are granted by these flows. Tokens/passwords are not logged or persisted. Session binding stores SHA-256 only.
- `src/routes/reset-password.tsx`: public setup/recovery page; reads token hash only from fragment, immediately clears URL, verifies before displaying password fields, clears password state and signs out after completion.
- `src/routes/auth.tsx`: Forgot password control and generic recovery response.
- `src/routes/_authenticated/admin/tenants.$tenantId.tsx`: Send administrator setup email control; server resolves the existing tenant administrator, not an arbitrary client-supplied recipient.
- `src/lib/platform.functions.ts` and applications screen: approval no longer returns/displays the generated temporary password; initial existing provisioning remains intact. Secure setup email is a separate explicit administrator action.
- `src/routes/__root.tsx`: error-boundary prop type aligned with current router; no authentication or voice behavior change.
- `AGENTS.md`, `roadmap.md`: boundary rules and dependency blockers.

## Database

Applied by managed migration tool: `drizzle/migrations/0001_administrator_onboarding_security.sql`. Types regenerated.

Follow-up applied: `drizzle/migrations/0002_restrict_admin_onboarding_table_grants.sql`, explicitly revoking automatic client grants on both service-only tables. RLS already denied rows, but final privileges are narrowed too.

Two RLS-enabled, service-only tables: `admin_onboarding_requests` (non-secret request IDs, tenant/user, status, one-hour outer expiry, session digest) and `admin_onboarding_rate_limits` (hashed buckets). No browser table grants or policies. Two service-only routines implement atomic hourly rate counting and completion claim. No existing financial schema or function was modified.

Limits: 3 email requests per normalized address/hour; global 30/hour. Verification 10/request/hour and global 100/hour; 5 failed native token attempts per request. Native Auth expiry/reuse rules apply independently; effective expiry is the earlier of native token expiry and one-hour request expiry. No custom OTP generator. Global limits are conservative and can cause denial of service under hostile saturation; production tuning and additional perimeter abuse protection remain advisable.

Audit events cover invitation/recovery requests, dispatch acceptance/failure, rate limits, native verification failure, invalid/rejected links, observed expiration, verification and completion outcomes. Expiration is recorded when an expired request is presented, not by a scheduled sweep. No secret-bearing metadata. Provider dispatch acceptance is NOT proof of inbox delivery.

## Delivery dependency — exact blocker

Email status tool reports no project email domain/setup (`not_started`). Built-in Auth default sender remains available; email/password already enabled (idempotent enable tool confirmed prod already enabled). No hosted native token lifetime, redirect allowlist or delivery-success setting was read successfully; these remain unverified.

This implementation intentionally does NOT send default links: the required managed recovery template must put `token_hash` in the URL fragment, preserve the request ID from `RedirectTo`, and use `type=recovery`. Standard links that directly auto-authenticate before our verification page are not supported by this new path. No template was hand-written, no custom mail provider installed, no setup token exposed and no email send claimed.

Required settings:

- Existing generated Cloud Auth server/browser configuration unchanged.
- `ADMIN_ONBOARDING_BASE_URL=https://creditvoice.lovable.app` (canonical destination, not caller Host).
- `ADMIN_ONBOARDING_EMAIL_READY=true` ONLY after managed recovery template, HTTPS callback and hosted redirect allowlist are verified. Neither setting was supplied/enabled by this task, so dispatch is fail-closed.
- No new private signing key or external email-provider credential required.

Secure next steps:

1. Configure an owned sender domain in Cloud → Emails if needed for managed template customization; complete domain verification and scaffold templates with the platform's supported tool. Do not invent a sender or expose links in chat.
2. Configure the managed recovery template's URL to the canonical `/reset-password?request=<non-secret request ID>#token_hash=<native token hash>&type=recovery`, preserving values provided by native Auth. Review URL encoding and fragment-only token handling. Keep all six auth template types intact.
3. In Cloud → Users → Auth settings, verify native token expiry, password rules, auth-email limits and permitted published callback URL. No auto-confirm/signup/global settings were changed.
4. Set the two readiness settings only after configuration is proven; publish on explicit operator instruction so the new page/functions are reachable.
5. Platform admin opens existing Test Cooperative setup and clicks Send administrator setup email. Existing recipient sets their password via the emailed link. No replacement identity or role assignment is necessary.
6. Verify actual inbox receipt, setup, sign-in, token expiration/reuse, wrong token, unauthorized caller and concurrent completion using an approved account. Do not mark accepted before these real native-provider checks pass.

## Tests

- 75 unit/simulated tests passed, 0 failed, 116 assertions across new `supabase/tests/admin-onboarding.test.ts` and existing credential/Twilio/IVR test files. Twelve new tests cover policy expiry, reuse status, invalid-attempt budget, role/tenant eligibility, password rules and exact limits. These do not exercise native provider token issuance or production dispatch.
- `supabase/tests/admin-onboarding.sql` retained: 9 transactional database regression checks for rate limits, wrong session/user, single-use atomic claim, expiration and grants. Execution STOPPED on first service-only routine because sandbox_exec lacks EXECUTE; no security grant widened to run it. SQL suite is UNVERIFIED, not passed. Rerun with authorized service test infrastructure, with rollback; it does not mutate tenant finances.
- Browser: Forgot password submits and displays generic response with dispatch disabled; missing-token reset page rejects and does not display password form. No real account reset occurred. Successful email-to-password-to-sign-in flow remains BLOCKED and unverified.
- Preview automatic build/typecheck: build OK at 2026-10-17T02:03:08Z after compatibility corrections. No manual build/typecheck run.

## Preservation

No phone acquisition/reassignment, tenant activation, credential issuance to caller, opening credit, transfer or direct balance/ledger write. Pilot voice implementation untouched. New SQL fixtures were rolled back after permission failure. Actual final read verifies test remains CONFIGURATION, accounts remain zero, sole number remains Pilot ACTIVE; no onboarding request rows were created while dispatch is disabled.

This is not a production-readiness PASS: managed template/redirect configuration, real delivery, successful native token flow, atomic DB regressions and adversarial end-to-end checks remain acceptance blockers. No Gate D change.

## Follow-up verification — 2026-10-17, after 02:08 UTC request

Outcome: BLOCKED; end-to-end administrator onboarding is NOT VERIFIED. No application code, auth setting, credential, mapping or financial record was changed in this follow-up.

### Supported configuration and manual prerequisite

The live email-status check again returned `not_started`: no sender domain configured. Built-in default Auth emails exist, but their default redirect format does not satisfy this application's fragment-token contract. Do not enable dispatch merely because default Auth email exists.

1. Open the supported email-domain setup dialog and supply a real domain you own. Follow the exact verification records shown in Cloud → Emails; no invented domain, sender address or DNS values. A Gmail recipient address cannot serve as an owned sender domain. Domain selection/verification is the immediate external blocker.
2. Once a domain is configured, use the platform-managed auth-template scaffolding. For this TanStack project the managed auth email handler deploys with the app; do not create an alternate email service or an Edge Function. Preserve the six template types: Confirm signup (`signup`), Invite (`invite`), Magic link (`magiclink`), Password reset (`recovery`), Email change (`email_change`), Reauthentication (`reauthentication`).
3. The existing administrator SETUP and RECOVERY actions both use native password-recovery emails for an already provisioned administrator. The required active template is Password reset (`recovery`), not a new-identity invitation API. Preserve Auth's `RedirectTo` request UUID and append native `token_hash` and `type=recovery` in the fragment. Destination shape: `https://creditvoice.lovable.app/reset-password?request=<request UUID>#token_hash=<native hash>&type=recovery`. These are symbolic placeholders, never real credentials.
4. In More → Cloud → Users → Auth settings, verify email/password is enabled, the published callback is permitted, and native token expiry/password/email-rate settings are appropriate. Native expiry remains unverified; application request expiry is one hour. Keep email confirmation and current security settings unchanged. Do not change auto-confirm or public signup merely to run tests.
5. Through supported project secret management, configure server-only `ADMIN_ONBOARDING_BASE_URL=https://creditvoice.lovable.app`; set server-only `ADMIN_ONBOARDING_EMAIL_READY=true` only after template and callback configuration are verified. Both names were absent from the current sandbox environment-name check. Existing generated Auth configuration remains untouched; managed sending uses the platform-injected `LOVABLE_API_KEY`, not a user-supplied provider credential. No private key belongs in client configuration.
6. Publish only on explicit operator instruction, then run the real email/setup/sign-in/recovery acceptance sequence with the intended administrator. Inspect managed delivery events and have the recipient confirm inbox receipt; an accepted send alone is not inbox-delivery evidence.

No template was scaffolded while the prerequisite domain was absent; no readiness variable was enabled, no email was sent and no password was changed.

### Tests actually run in this follow-up

- `bun test supabase/tests/admin-onboarding.test.ts`: 12 passed, 0 failed, 12 assertions. Policy-only evidence for expiry, reuse-state rejection, attempt budgets, tenant/role matching and password requirements; not native token or full-flow acceptance.
- Playwright at localhost `/reset-password` without a token: generic invalid/expired alert visible; zero password inputs. Screenshot retained under `/tmp/browser/onboarding-email-verification/invalid.png`.
- Read-only database check: test tenant remains CONFIGURATION; accounts 10001 and 10002 each have balance `0.0000`; test transaction count zero; sole voice-capable number remains ACTIVE for CreditVoice Pilot. Onboarding request count zero. Authenticated SELECT on request storage and EXECUTE on completion-claim routine both denied.
- Onboarding audit metadata with nonempty content: zero records. Source review found no explicit password/token logging in onboarding handlers and empty audit metadata. This does not prove absence of secrets across all production/provider logs; full live log review is blocked with the unperformed flow.

### Acceptance matrix

| Check | Current evidence |
| --- | --- |
| Setup request, actual email, correct redirect | BLOCKED: sender/template/callback configuration |
| Initial password setup and intended-admin sign-in | BLOCKED: no valid delivered link |
| Invalid/missing token | Missing-token browser rejection verified; native invalid-token test blocked |
| Expired/reused token | Policy tests pass; real native-provider tests blocked |
| Recovery request and successful recovery | BLOCKED: no configured delivery |
| Privilege escalation / cross-tenant access | Role/tenant policy tests and restricted storage grants verified; post-onboarding signed-in tenant-isolation flow blocked |
| Secret-free live logs and audit | Source/audit checks only; complete live-flow review unverified |
| Database atomic/concurrent claim regressions | Previously blocked by restricted test execution privileges; not rerun or bypassed |

Stop point: await owned sender-domain setup. Preserve pilot number, inactive test tenant and financial balances. No Gate D or production-readiness status change.