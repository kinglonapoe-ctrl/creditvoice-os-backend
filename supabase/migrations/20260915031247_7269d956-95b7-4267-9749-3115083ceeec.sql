-- Sandbox-only fixtures for the Phase 2A voice authentication suite.
create or replace function public.cv_test_voice_setup(_access_hash text, _pin_hash text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  ta uuid := gen_random_uuid(); tb uuid := gen_random_uuid(); tsus uuid := gen_random_uuid();
  ca uuid; cb uuid; cinact uuid; aa1 uuid; ab1 uuid; asus uuid; ainact uuid;
begin
  if session_user <> 'sandbox_exec' then
    raise exception 'Test helper is not available';
  end if;

  insert into public.tenants (id, name, legal_name, country, currency_code, currency_approved, status)
  values (ta,  'QA Voice A', 'QA Voice A Ltd', 'NG', 'NGN', true, 'ACTIVE'),
         (tb,  'QA Voice B', 'QA Voice B Ltd', 'NG', 'NGN', true, 'ACTIVE'),
         (tsus,'QA Voice S', 'QA Voice S Ltd', 'NG', 'NGN', true, 'ACTIVE');

  insert into public.phone_numbers (country, country_calling_code, phone_number, provider, voice_capable, sms_capable, status, tenant_id, is_primary)
  values ('NG','+234','+234900000001','NONE', true, false, 'ACTIVE',    ta,   true),
         ('NG','+234','+234900000002','NONE', true, false, 'ACTIVE',    tb,   true),
         ('NG','+234','+234900000003','NONE', true, false, 'AVAILABLE', null, false),
         ('NG','+234','+234900000004','NONE', true, false, 'ACTIVE',    tsus, true),
         ('NG','+234','+234900000005','NONE', false,true,  'ACTIVE',    ta,   false),
         ('NG','+234','+234900000006','NONE', true, false, 'ASSIGNED',  ta,   false);

  insert into public.customers (tenant_id, full_name, phone, status)
  values (ta, 'QA Caller A', '+2349100000001', 'ACTIVE') returning id into ca;
  insert into public.customers (tenant_id, full_name, phone, status)
  values (tb, 'QA Caller B', '+2349100000002', 'ACTIVE') returning id into cb;
  insert into public.customers (tenant_id, full_name, phone, status)
  values (ta, 'QA Caller Inactive', '+2349100000003', 'SUSPENDED') returning id into cinact;

  insert into public.customer_accounts (tenant_id, customer_id, currency_code, credit_limit, status)
  values (ta, ca, 'NGN', 0, 'ACTIVE') returning id into aa1;
  insert into public.customer_accounts (tenant_id, customer_id, currency_code, credit_limit, status)
  values (tb, cb, 'NGN', 0, 'ACTIVE') returning id into ab1;
  insert into public.customer_accounts (tenant_id, customer_id, currency_code, credit_limit, status)
  values (ta, ca, 'NGN', 0, 'ACTIVE') returning id into asus;
  insert into public.customer_accounts (tenant_id, customer_id, currency_code, credit_limit, status)
  values (ta, cinact, 'NGN', 0, 'ACTIVE') returning id into ainact;

  perform set_config('app.ledger_posting','on', true);
  update public.customer_accounts set status = 'SUSPENDED' where id = asus;
  perform set_config('app.ledger_posting','off', true);

  insert into public.tenant_access_codes (tenant_id, code_hash) values (ta, _access_hash), (tb, _access_hash), (tsus, _access_hash);
  insert into public.customer_pins (customer_id, tenant_id, pin_hash) values (ca, ta, _pin_hash), (cb, tb, _pin_hash), (cinact, ta, _pin_hash);

  return jsonb_build_object(
    'ta', ta, 'tb', tb, 'tsus', tsus,
    'ca', ca, 'cb', cb, 'cinact', cinact,
    'aa1', aa1, 'ab1', ab1, 'asus', asus, 'ainact', ainact,
    'num_a', '+234900000001', 'num_b', '+234900000002',
    'num_unassigned', '+234900000003', 'num_suspended_tenant', '+234900000004',
    'num_not_voice', '+234900000005', 'num_not_active', '+234900000006',
    'acct_a', (select account_number from public.customer_accounts where id = aa1),
    'acct_b', (select account_number from public.customer_accounts where id = ab1),
    'acct_suspended', (select account_number from public.customer_accounts where id = asus),
    'acct_inactive_customer', (select account_number from public.customer_accounts where id = ainact)
  );
end; $$;

create or replace function public.cv_test_voice_cleanup(_tenant_ids uuid[])
returns void language plpgsql security definer set search_path to 'public' as $$
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
end; $$;

revoke all on function public.cv_test_voice_setup(text, text) from public, anon, authenticated;
revoke all on function public.cv_test_voice_cleanup(uuid[]) from public, anon, authenticated;
grant execute on function public.cv_test_voice_setup(text, text) to sandbox_exec;
grant execute on function public.cv_test_voice_cleanup(uuid[]) to sandbox_exec;

do $$
declare f text;
begin
  for f in
    select 'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'cv\_%' and p.proname not like 'cv\_test%'
  loop
    execute format('grant execute on function %s to sandbox_exec', f);
  end loop;
end $$;