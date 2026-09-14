create or replace function public.cv_test_admin(_action text, _id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if session_user <> 'sandbox_exec' then
    raise exception 'Test helper is not available';
  end if;
  if _action = 'suspend_account' then
    perform set_config('app.ledger_posting','on', true);
    update public.customer_accounts set status = 'SUSPENDED' where id = _id;
    perform set_config('app.ledger_posting','off', true);
  elsif _action = 'activate_account' then
    perform set_config('app.ledger_posting','on', true);
    update public.customer_accounts set status = 'ACTIVE' where id = _id;
    perform set_config('app.ledger_posting','off', true);
  elsif _action = 'suspend_tenant' then
    update public.tenants set status = 'SUSPENDED' where id = _id;
  else
    raise exception 'Unknown test action %', _action;
  end if;
end;
$fn$;

revoke all on function public.cv_test_admin(text, uuid) from public, anon;
grant execute on function public.cv_test_admin(text, uuid) to authenticated;