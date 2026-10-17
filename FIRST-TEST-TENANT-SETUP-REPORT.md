# First isolated test tenant — inspection and blockers

Inspection date: 2026-10-17 UTC. Requested organization: CreditVoice Test Cooperative, Nigeria, NGN, non-production onboarding and tenant-isolation testing.

## Result

**BLOCKED — no requested-tenant or existing-pilot organization, customer, account, credential or financial record was created or changed.** No existing record was reused incorrectly; no phone number was reassigned. No setup transfer was attempted. Gate D status was not changed. Automated IVR regressions use isolated QA fixtures, not these organizations.

## Actual state verified

| Item | Result and evidence |
| --- | --- |
| Organization ID/status | Not created: database count for the exact requested organization name is 0. |
| Existing application | Exact-name application count is 0. |
| Tenant administrator | Not provisioned. Existing supported onboarding requires administrator name, email and phone, which were not supplied. No password generated or disclosed. |
| Currency | NGN exists, enabled (`is_active = true`), precision 2 decimal places. Organization-level approval is performed by application approval; there is no target tenant to approve yet. |
| Telephone mapping | The sole inventory number, masked `…1691`, is TWILIO, voice-capable, ACTIVE, primary, and belongs to CreditVoice Pilot (`7965a5cb-1144-4fc1-9150-db68e40dbe4c`). Inventory ID: `ebb38472-95d1-4cf3-9304-3811cb837b62`. Available/unassigned voice-number count: 0. |
| Test accounts | Not created. Intended A/B opening amounts remain NGN 10,000 and NGN 1,000; neither is a verified balance. |
| Opening ledger credit | Not posted. `post_credit` requires a tenant administrator for the same tenant and calls `assert_tenant_operational`, which rejects any tenant not ACTIVE. |
| Access-code/PIN issuance | Supported mechanisms exist, but nothing was issued for the requested tenant. No hashes or secret values were retrieved or written to this report. |
| Customer care | Supported settings include VOICEMAIL and disabled routing. No target settings created; no external number selected. Voicemail must also respect the recording restriction. |
| IVR/activation | Not configured or activated. Activation requires organization currency approval, ACTIVE access-code status and an assigned number. None was bypassed. |
| Tenant-admin isolation | Not executed for the new tenant because its identity does not exist. Source inspection is not a substitute for an authenticated isolation test. |
| Live resolution | Cannot resolve the requested tenant in its current nonexistent/unmapped state. Database `cv_resolve_tenant` selects the tenant from an ACTIVE destination-number mapping with an ACTIVE, currency-approved tenant. An access code does not select an alternative tenant on the same number. |

## Supported path inspected

1. Public `/` application form → `submitApplication` → platform `/admin/applications` → `approveApplication` creates CONFIGURATION tenant, provisions/links administrator, approves currency and seeds care/IVR settings.
2. `/admin/tenants/$tenantId` → existing number assignment, `issueAccessCode`, `setTenantStatus` activation.
3. Tenant-admin `/org/customers` and `/org/accounts` → customer and account creation; `setCustomerPin` → hashed PIN issuance.
4. `/org/credit` → `post_credit` for initial credit, only after activation.
5. `/org/customer-care` and `/org/ivr` → supported settings forms.

No separate supported platform-admin tenant creation path was found outside application approval. No missing workflow was bypassed.

## Tests and evidence

- Authenticated Playwright inspection using the requesting platform administrator: `/admin/tenants` showed the two existing tenants, neither matching the requested name.
- Authenticated `/admin/phone-numbers` showed exactly one mapped number and no available number. Screenshot was masked before capture; no Release action was used.
- Published `https://creditvoice.lovable.app/` loaded and displayed the supported application fields, including required administrator name/email/phone and legal/business name. No form was submitted.
- Actual database read queries confirmed organization/application counts, enabled NGN, sole number ownership and absence of unassigned voice numbers.
- Actual deployed database definitions confirmed `post_credit`'s tenant-admin authorization, ACTIVE-tenant prerequisite and destination-number-only voice resolution.
- No new-tenant end-to-end, ledger reconciliation, credential issuance or isolation test is claimed: those require completing supported provisioning first.
- Existing automated credential, Twilio signature, IVR and simulated-call regression suite: 63 passed, 0 failed, 104 assertions across `phase2a-hash.test.ts`, `phase2b-unit.test.ts` and `phase2b-e2e.test.ts`. These are automated tests, not live-call evidence or new-tenant verification.

## Operator actions required

1. Supply the intended test administrator's name, email and phone, plus legal/business name (or explicitly confirm using the organization name). Do not supply passwords, PINs or access codes in chat.
2. Decide whether to authorize reassignment of `…1691` from CreditVoice Pilot. Reassignment will prevent new calls on that number from resolving the current pilot tenant; it must not occur silently or interrupt an active call.
3. If reassignment is not approved, the requested tenant can remain in CONFIGURATION, but activation, opening credits and live resolution remain blocked under the existing rules. This report does not recommend purchasing a number or weakening these rules.

After the decisions, proceed through the supported application, approval and setup screens, verify every write in the database, and perform authenticated cross-tenant read checks. Do not post extra movements or transfers during setup.