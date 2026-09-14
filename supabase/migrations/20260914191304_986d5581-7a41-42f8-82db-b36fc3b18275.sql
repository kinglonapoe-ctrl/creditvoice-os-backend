-- Secret tables: explicit deny-all for client roles (service_role bypasses RLS)
create policy "no client access" on public.tenant_access_codes for all to authenticated, anon using (false) with check (false);
create policy "no client access" on public.customer_pins for all to authenticated, anon using (false) with check (false);

-- Internal-only functions: not callable through the API
revoke all on function public.update_updated_at_column() from anon, authenticated;
revoke all on function public.block_mutation() from anon, authenticated;
revoke all on function public.guard_tenant_currency() from anon, authenticated;
revoke all on function public.guard_account_balance() from anon, authenticated;
revoke all on function public.handle_new_user() from anon, authenticated;
revoke all on function public.ensure_ledger_account(uuid) from anon, authenticated;
revoke all on function public.next_account_number(uuid) from anon, authenticated;
revoke all on function public.has_role(uuid, public.app_role) from anon, authenticated;

-- Policy helpers: signed-in only (needed for RLS evaluation)
revoke all on function public.current_user_role() from anon;
revoke all on function public.current_user_tenant_id() from anon;
revoke all on function public.is_super_admin() from anon;

-- Credit engine: signed-in only; each function authorises internally
revoke all on function public.post_credit(uuid, numeric, public.transaction_type, text) from anon;
revoke all on function public.execute_transfer(uuid, uuid, numeric, text) from anon;
revoke all on function public.reverse_transfer(uuid, text) from anon;