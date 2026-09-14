create or replace function public.cv_test_cleanup(_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare nm text;
begin
  if session_user <> 'sandbox_exec' then
    raise exception 'Test helper is not available';
  end if;
  select name into nm from public.tenants where id = _tenant_id;
  if nm is null then return; end if;
  if nm not like 'QA %' then
    raise exception 'Refusing to remove a non-test organization';
  end if;
  if exists (select 1 from public.transactions where tenant_id = _tenant_id) then
    raise exception 'Organization has financial history and cannot be removed';
  end if;
  set local session_replication_role = 'replica';
  delete from public.financial_idempotency where tenant_id = _tenant_id;
  delete from public.ledger_accounts where tenant_id = _tenant_id;
  delete from public.customer_accounts where tenant_id = _tenant_id;
  delete from public.customer_pins where tenant_id = _tenant_id;
  delete from public.customers where tenant_id = _tenant_id;
  delete from public.user_roles where tenant_id = _tenant_id;
  delete from public.tenant_account_sequences where tenant_id = _tenant_id;
  delete from public.audit_logs where tenant_id = _tenant_id;
  delete from public.tenants where id = _tenant_id;
  set local session_replication_role = 'origin';
end;
$fn$;