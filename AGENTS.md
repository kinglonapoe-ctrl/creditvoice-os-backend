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
