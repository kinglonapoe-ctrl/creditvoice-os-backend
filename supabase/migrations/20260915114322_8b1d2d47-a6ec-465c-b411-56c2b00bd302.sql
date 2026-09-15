-- Phase 2B.5 Gate B — remove orphaned rows that made a restore fail, and fix
-- the development fixture that created them.

delete from public.financial_failure_events f
where (f.tenant_id is not null and not exists (select 1 from public.tenants t where t.id = f.tenant_id))
   or (f.session_id is not null and not exists (select 1 from public.call_sessions s where s.id = f.session_id));

create or replace function cv_test.cv_test_voice_cleanup(_tenant_ids uuid[])
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare tid uuid; nm text;
begin
  if session_user <> 'sandbox_exec' then
    raise exception 'Test helper is not available';
  end if;
  foreach tid in array _tenant_ids loop
    select name into nm from public.tenants where id = tid;
    continue when nm is null;
    if nm not like 'QA %' then raise exception 'Refusing to remove a non-test organization'; end if;
    set local session_replication_role = 'replica';
    delete from public.call_transfer_grants where session_id in (select id from public.call_sessions where tenant_id = tid);
    delete from public.financial_failure_events where tenant_id = tid
       or session_id in (select id from public.call_sessions where tenant_id = tid);
    delete from public.call_session_events where session_id in (select id from public.call_sessions where tenant_id = tid);
    delete from public.call_auth_failures where tenant_id = tid;
    delete from public.call_sessions where tenant_id = tid;
    delete from public.financial_idempotency where tenant_id = tid;
    delete from public.ledger_entries where tenant_id = tid;
    delete from public.transfers where tenant_id = tid;
    delete from public.transactions where tenant_id = tid;
    delete from public.ledger_accounts where tenant_id = tid;
    delete from public.customer_accounts where tenant_id = tid;
    delete from public.customer_pins where tenant_id = tid;
    delete from public.customers where tenant_id = tid;
    delete from public.tenant_access_codes where tenant_id = tid;
    delete from public.phone_numbers where tenant_id = tid;
    delete from public.user_roles where tenant_id = tid;
    delete from public.tenant_account_sequences where tenant_id = tid;
    delete from public.audit_logs where tenant_id = tid;
    delete from public.tenants where id = tid;
    set local session_replication_role = 'origin';
  end loop;
  delete from public.phone_numbers where phone_number = '+234900000003' and tenant_id is null;
end; $function$;

revoke all on function cv_test.cv_test_voice_cleanup(uuid[]) from public, anon, authenticated, service_role;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
    execute 'grant execute on function cv_test.cv_test_voice_cleanup(uuid[]) to sandbox_exec';
  end if;
end $g$;