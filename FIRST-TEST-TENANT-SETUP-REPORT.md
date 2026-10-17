# First isolated test tenant — inspection and blockers

Inspection date: 2026-10-17 UTC. Requested organization: CreditVoice Test Cooperative, Nigeria, NGN, non-production onboarding and tenant-isolation testing.

## Result

**PARTIALLY COMPLETE — organization, administrator, two customers/accounts and hashed credentials created through supported application workflows. Activation and opening credit remain BLOCKED.** Operator supplied administrator details and explicitly chose to keep the pilot number mapping. No application or financial-engine code changed; no direct tenant insert, balance update, ledger edit or transfer was performed. Gate D status was not changed.

## Actual state verified

| Item | Result and evidence |
| --- | --- |
| Organization ID/status | `3f3db4ed-37a1-4c10-befd-08e2b08f04c5`, CreditVoice Test Cooperative, CONFIGURATION. Exact-name count = 1. Legal/business name uses supplied `satphonix company`. |
| Application | `f42c04a8-aab0-4c18-a948-db0c6b93e469`, APPROVED, links to the same tenant. |
| Tenant administrator | `satphonix@gmail.com`, user ID `91f3c113-7c3c-43c3-a06a-f9306caefa93`, TENANT_ADMIN for this tenant only. Provisioned by supported approval; actual password sign-in succeeded. Password never disclosed or included in report. |
| Currency | NGN exists, enabled (`is_active = true`), precision 2 decimal places; tenant currency NGN, `currency_approved = true`. |
| Telephone mapping | The sole inventory number, masked `…1691`, is TWILIO, voice-capable, ACTIVE, primary, and belongs to CreditVoice Pilot (`7965a5cb-1144-4fc1-9150-db68e40dbe4c`). Inventory ID: `ebb38472-95d1-4cf3-9304-3811cb837b62`. Available/unassigned voice-number count: 0. |
| Test accounts | A: `10001`, account `3543f2ad-ad0e-4e89-b778-9c0e8d3e3090`, customer `796aba9b-5775-4878-9387-08ef063ae52a`. B: `10002`, account `95c034e3-52d5-40f2-acff-3a01654e4a21`, customer `1f9ea28f-9196-4505-9430-15d0ed21aaef`. Both customers/accounts ACTIVE, belong to this tenant, currency NGN, credit limit 0. Account numbers are tenant-local, not the existing pilot's accounts. |
| Opening ledger credit | Not posted. `post_credit` requires a tenant administrator for the same tenant and calls `assert_tenant_operational`, which rejects any tenant not ACTIVE. |
| Ledger-verified balances | A = NGN 0, B = NGN 0: actual cache values `0.0000`, ledger-derived signed sums 0, entry counts 0. Requested NGN 10,000/1,000 NOT posted and NOT claimed as achieved. Target transaction count 0; transfer count 0. |
| Access-code/PIN issuance | One active access-code row, tenant status ACTIVE for credential issuance; two PIN rows. Issued through `issueAccessCode` and `setCustomerPin`, never stored as plaintext or included here. Tenant-admin reads of both credential tables refused with `42501`. |
| Customer care | Saved through tenant-admin form: disabled, routing/after-hours VOICEMAIL, voicemail capture disabled, primary/backup destinations NULL. No arbitrary external destination or recording enabled. |
| IVR/activation | Approval seeded existing IVR defaults: en-US, session timeout 120 seconds, recording disabled. Activation attempted through supported button and rejected: `Assign a voice number before activation.` Tenant remains CONFIGURATION. |
| Tenant-admin isolation | Actual signed-in tenant-admin reads returned exactly one tenant, two customers and two accounts; explicit pilot account query returned 0 rows. Platform-admin page access redirected to `/org`. |
| Live resolution | Cannot resolve this unmapped, CONFIGURATION tenant. Database `cv_resolve_tenant` selects the tenant from an ACTIVE destination-number mapping with an ACTIVE, currency-approved tenant. An access code does not select an alternative tenant on the same number. |

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
- Published `https://creditvoice.lovable.app/` loaded and displayed the supported application fields. Setup writes were executed through the local application against the connected shared database, not claimed as a published-site onboarding test.
- Actual database read queries confirmed organization/application counts, enabled NGN, sole number ownership and absence of unassigned voice numbers.
- Actual deployed database definitions confirmed `post_credit`'s tenant-admin authorization, ACTIVE-tenant prerequisite and destination-number-only voice resolution.
- Supported application submission/approval and access-code issuance completed. Real tenant-admin password sign-in, customer activation, PIN issuance, account opening and safe care save completed through UI.
- Authenticated isolation queries: tenants 1, customers 2, accounts 2, ledger entries 0; pilot accounts 0; both credential tables denied (`42501`). Platform route access redirected to tenant workspace. No second-tenant reverse-direction session test is claimed.
- Direct database reconciliation of both new accounts: cache 0 and signed ledger sum 0, entry count 0. No initial-credit or transfer record exists for the target tenant.
- Supported activation test correctly refused missing number assignment. Final inventory read confirmed `…1691` remains ACTIVE under CreditVoice Pilot.
- Existing automated credential, Twilio signature, IVR and simulated-call regression suite: 63 passed, 0 failed, 104 assertions across `phase2a-hash.test.ts`, `phase2b-unit.test.ts` and `phase2b-e2e.test.ts`. These are automated tests, not live-call evidence or new-tenant verification.

## Remaining blockers and credential handoff

1. Operator chose **Keep pilot mapping**. No reassignment is authorized. With no available voice number, activation and opening credit cannot proceed under the existing rules. No number purchase or weakened rule is proposed.
2. Administrator password was generated by the existing once-only approval mechanism, privately used for verification and removed from temporary verification storage afterward. Secure operator password delivery remains unresolved; no password is provided in chat or this report. A supported secure reset/handoff is required before the operator can use that login independently.
3. Issued access code and PIN plaintext were intentionally not retained. They can only be replaced through existing secure issuance/rotation mechanisms for authorized operator use; issuance does not prove secure delivery.
4. Test customer names `Test Customer A/B` and synthetic phone identifiers ending `0201/0202` were chosen for isolated non-production records. They are not real customer contact details and must not be dialled. No invented business address or opening hours were provided; seeded defaults are not asserted as real hours.

The requested opening balances and live tenant resolution remain incomplete. Keeping the current number mapping preserves the working pilot. No overall setup PASS or Gate D PASS is claimed.