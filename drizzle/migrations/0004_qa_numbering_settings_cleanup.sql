-- QA-only teardown bypasses FK triggers for immutable test fixtures.
-- Mirror the existing narrow settings -> tenant CASCADE explicitly in both helpers.
-- No existing rows are changed and function ACLs are preserved by CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION cv_test.cv_test_cleanup(_tenant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare nm text;
begin
  if session_user <> 'sandbox_exec' then raise exception 'Test helper is not available'; end if;
  select name into nm from public.tenants where id = _tenant_id;
  if nm is null then return; end if;
  if nm not like 'QA %' then raise exception 'Refusing to remove a non-test organization'; end if;
  set local session_replication_role = 'replica';
  delete from public.financial_idempotency where tenant_id = _tenant_id;
  delete from public.ledger_entries where tenant_id = _tenant_id;
  delete from public.transfers where tenant_id = _tenant_id;
  delete from public.transactions where tenant_id = _tenant_id;
  delete from public.ledger_accounts where tenant_id = _tenant_id;
  delete from public.customer_accounts where tenant_id = _tenant_id;
  delete from public.customer_pins where tenant_id = _tenant_id;
  delete from public.customers where tenant_id = _tenant_id;
  delete from public.user_roles where tenant_id = _tenant_id;
  delete from public.tenant_account_sequences where tenant_id = _tenant_id;
  delete from public.audit_logs where tenant_id = _tenant_id;
  delete from public.tenant_account_number_settings where tenant_id = _tenant_id;
  delete from public.tenants where id = _tenant_id;
  set local session_replication_role = 'origin';
end;
$function$;
CREATE OR REPLACE FUNCTION cv_test.cv_test_voice_cleanup(_tenant_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare tid uuid; nm text;
begin
  if session_user <> 'sandbox_exec' then raise exception 'Test helper is not available'; end if;
  foreach tid in array _tenant_ids loop
    select name into nm from public.tenants where id = tid;
    continue when nm is null;
    if nm not like 'QA %' then raise exception 'Refusing to remove a non-test organization'; end if;
    set local session_replication_role = 'replica';
    delete from public.call_transfer_grants where session_id in (select id from public.call_sessions where tenant_id = tid);
    delete from public.financial_failure_events where tenant_id = tid or session_id in (select id from public.call_sessions where tenant_id = tid);
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
    delete from public.tenant_account_number_settings where tenant_id = tid;
    delete from public.tenants where id = tid;
    set local session_replication_role = 'origin';
  end loop;
  delete from public.phone_numbers where phone_number = '+234900000003' and tenant_id is null;
end;
$function$;