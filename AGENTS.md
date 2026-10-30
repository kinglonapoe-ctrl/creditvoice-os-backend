<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Administrator onboarding uses native Auth recovery tokens with durable request/session binding and an atomic completion claim; do not implement custom OTPs or expose passwords, because token verification and password changes must remain on the existing auth boundary.
- Administrator setup email dispatch is fail-closed until the managed recovery template and canonical HTTPS destination are verified; token hashes belong in URL fragments to keep them out of application request URLs.
- Account-number rules live in `tenant_account_number_settings` and are enforced by the `assign_account_number` trigger and `account_number_matches_rules`; UI/IVR checks only mirror them, because the database must stay authoritative for every insert path. Settings change only through the audited `set_account_numbering_settings` RPC.
- QA teardown helpers must explicitly remove the selected QA tenant's numbering settings before its tenant row; their replication-mode bypass disables the existing FK cascade, so both normal and voice teardown require this dependency step. Run account/financial regression fixtures only in a disposable isolated database.
- Phone-webhook test suites must call `requireIsolatedDatabase()` from `supabase/tests/isolated-db-guard.ts` before importing the handler; the handler writes via SUPABASE_URL, so only a positively marked isolated DB is safe.
- Currency changes use the authenticated change_organization_currency RPC and a stable transaction-scoped tenant advisory lock shared by account creation and financial postings; zero-value accounts may be updated only atomically with their tenant when no financial history exists, preserving immutable history and mandatory audit.
