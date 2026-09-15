-- CreditVoice OS — development-only test fixtures (Phase 2B.5, Gate A).
--
-- These helpers are NOT part of the production schema and are NOT a migration.
-- They are installed into a disposable `cv_test` schema immediately before a
-- test suite runs and dropped again immediately afterwards
-- (supabase/tests/_helpers_drop.sql). Nothing in the application can reach
-- them: PostgREST only exposes `public`, and only `sandbox_exec` is granted
-- usage on this schema. Every helper additionally refuses any session whose
-- session_user is not `sandbox_exec`, and refuses non-'QA %' organizations.
--
-- Never install this file against a production database.

create schema if not exists cv_test;
revoke all on schema cv_test from public;
grant usage on schema cv_test to current_user;

CREATE OR REPLACE FUNCTION cv_test.cv_test_add_account(_tenant_id uuid, _name text, _currency text DEFAULT 'NGN'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cid uuid; aid uuid;
begin
  if session_user <> 'sandbox_exec' then raise exception 'Test helper is not available'; end if;
  if not exists (select 1 from public.tenants where id = _tenant_id and name like 'QA %') then
    raise exception 'Test helper refuses non-QA data';
  end if;
  insert into public.customers (tenant_id, full_name, phone, status)
  values (_tenant_id, _name, '+2349' || lpad((floor(random()*1e9))::bigint::text, 9, '0'), 'ACTIVE')
  returning id into cid;
  insert into public.customer_accounts (tenant_id, customer_id, currency_code, credit_limit, status)
  values (_tenant_id, cid, _currency, 0, 'ACTIVE') returning id into aid;
  return jsonb_build_object('customer_id', cid, 'account_id', aid,
    'account_number', (select account_number from public.customer_accounts where id = aid));
end; $function$
;

CREATE OR REPLACE FUNCTION cv_test.cv_test_admin(_action text, _id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION cv_test.cv_test_cleanup(_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  delete from public.tenants where id = _tenant_id;
  set local session_replication_role = 'origin';
end;
$function$
;

CREATE OR REPLACE FUNCTION cv_test.cv_test_credential_state(_kind text, _id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r jsonb;
begin
  if session_user <> 'sandbox_exec' then raise exception 'Test helper is not available'; end if;
  if _kind = 'PIN' then
    select jsonb_build_object('failed_attempts', failed_attempts, 'locked', locked_until is not null and locked_until > now())
      into r from public.customer_pins where customer_id = _id;
  elsif _kind = 'ACCESS_CODE_BY_ID' then
    select jsonb_build_object('failed_attempts', failed_attempts, 'locked', locked_until is not null and locked_until > now(),
                              'is_active', is_active)
      into r from public.tenant_access_codes where id = _id;
  else
    select jsonb_build_object('active_codes', count(*)) into r
      from public.tenant_access_codes where tenant_id = _id and is_active and retired_at is null;
  end if;
  return coalesce(r, '{}'::jsonb);
end; $function$
;

CREATE OR REPLACE FUNCTION cv_test.cv_test_fund_account(_account_id uuid, _amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if session_user <> 'sandbox_exec' then raise exception 'Test helper is not available'; end if;
  if not exists (select 1 from public.customer_accounts a join public.tenants t on t.id = a.tenant_id
                  where a.id = _account_id and t.name like 'QA %') then
    raise exception 'Test helper refuses non-QA data';
  end if;
  perform set_config('app.ledger_posting','on', true);
  update public.customer_accounts set balance = _amount where id = _account_id;
  perform set_config('app.ledger_posting','off', true);
end; $function$
;

CREATE OR REPLACE FUNCTION cv_test.cv_test_rotate_access_code(_tenant_id uuid, _new_hash text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare nm text; nid uuid;
begin
  if session_user <> 'sandbox_exec' then raise exception 'Test helper is not available'; end if;
  select name into nm from public.tenants where id = _tenant_id;
  if nm is null or nm not like 'QA %' then raise exception 'Refusing to modify a non-test organization'; end if;
  update public.tenant_access_codes set is_active = false, retired_at = now()
   where tenant_id = _tenant_id and is_active;
  insert into public.tenant_access_codes (tenant_id, code_hash) values (_tenant_id, _new_hash) returning id into nid;
  return nid;
end; $function$
;

CREATE OR REPLACE FUNCTION cv_test.cv_test_seed_caller_failures(_from_number text, _count integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if session_user <> 'sandbox_exec' then raise exception 'Test helper is not available'; end if;
  insert into public.call_auth_failures (from_number, stage, reason)
  select _from_number, 'PIN', 'INVALID_CREDENTIAL' from generate_series(1, greatest(_count, 0));
end; $function$
;

CREATE OR REPLACE FUNCTION cv_test.cv_test_set_care(_tenant_id uuid, _settings jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if session_user <> 'sandbox_exec' then raise exception 'Test helper is not available'; end if;
  if not exists (select 1 from public.tenants where id = _tenant_id and name like 'QA %') then
    raise exception 'Test helper refuses non-QA data';
  end if;
  insert into public.customer_care_settings (tenant_id) values (_tenant_id)
  on conflict (tenant_id) do nothing;
  update public.customer_care_settings set
    enabled = coalesce((_settings->>'enabled')::boolean, enabled),
    primary_number = coalesce(_settings->>'primary_number', primary_number),
    backup_number = coalesce(_settings->>'backup_number', backup_number),
    routing_mode = coalesce((_settings->>'routing_mode')::routing_mode, routing_mode),
    after_hours_mode = coalesce((_settings->>'after_hours_mode')::routing_mode, after_hours_mode),
    business_hours_start = coalesce((_settings->>'business_hours_start')::time, business_hours_start),
    business_hours_end = coalesce((_settings->>'business_hours_end')::time, business_hours_end),
    timezone = coalesce(_settings->>'timezone', timezone),
    voicemail_enabled = coalesce((_settings->>'voicemail_enabled')::boolean, voicemail_enabled)
  where tenant_id = _tenant_id;
end; $function$
;

CREATE OR REPLACE FUNCTION cv_test.cv_test_set_tenant_status(_tenant_id uuid, _status tenant_status)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare nm text;
begin
  if session_user <> 'sandbox_exec' then
    raise exception 'Test helper is not available';
  end if;
  select name into nm from public.tenants where id = _tenant_id;
  if nm is null or nm not like 'QA %' then
    raise exception 'Refusing to modify a non-test organization';
  end if;
  set local session_replication_role = 'replica';
  update public.tenants set status = _status where id = _tenant_id;
  set local session_replication_role = 'origin';
end; $function$
;

CREATE OR REPLACE FUNCTION cv_test.cv_test_setup()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ta uuid := gen_random_uuid(); tb uuid := gen_random_uuid();
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  ca uuid; cb uuid; aa1 uuid; aa2 uuid; ab1 uuid;
begin
  insert into public.tenants (id, name, legal_name, country, currency_code, currency_approved, status)
  values (ta, 'QA Alpha', 'QA Alpha Ltd', 'NG', 'NGN', true, 'ACTIVE'),
         (tb, 'QA Beta',  'QA Beta Ltd',  'NG', 'NGN', true, 'ACTIVE');
  insert into public.user_roles (user_id, role, tenant_id)
  values (ua, 'TENANT_ADMIN', ta), (ub, 'TENANT_ADMIN', tb);
  insert into public.customers (tenant_id, full_name, phone, status)
  values (ta, 'QA Ada', '+2340000000001', 'ACTIVE') returning id into ca;
  insert into public.customers (tenant_id, full_name, phone, status)
  values (tb, 'QA Bello', '+2340000000002', 'ACTIVE') returning id into cb;
  insert into public.customer_accounts (tenant_id, customer_id, currency_code, credit_limit, status)
  values (ta, ca, 'NGN', 0, 'ACTIVE') returning id into aa1;
  insert into public.customer_accounts (tenant_id, customer_id, currency_code, credit_limit, status)
  values (ta, ca, 'NGN', 0, 'ACTIVE') returning id into aa2;
  insert into public.customer_accounts (tenant_id, customer_id, currency_code, credit_limit, status)
  values (tb, cb, 'NGN', 0, 'ACTIVE') returning id into ab1;

  return jsonb_build_object('ta',ta,'tb',tb,'ua',ua,'ub',ub,'ca',ca,'cb',cb,
                            'aa1',aa1,'aa2',aa2,'ab1',ab1);
end;
$function$
;

CREATE OR REPLACE FUNCTION cv_test.cv_test_voice_cleanup(_tenant_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end; $function$
;

CREATE OR REPLACE FUNCTION cv_test.cv_test_voice_setup(_access_hash text, _pin_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end; $function$
;

-- Only the sandbox test role may execute the fixtures.
do $grant$
declare f record;
begin
  for f in select p.oid::regprocedure::text as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'cv_test'
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('grant execute on function %s to %I', f.sig, current_user);
  end loop;
end $grant$;
