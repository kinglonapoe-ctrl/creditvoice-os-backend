drop function if exists public.run_hardening_tests();

create or replace function public.cv_test_setup()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
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
$fn$;

create or replace function public.cv_test_admin(_action text, _id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
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

revoke all on function public.cv_test_setup() from public, anon, authenticated;
revoke all on function public.cv_test_admin(text, uuid) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
    execute 'grant execute on function public.cv_test_setup() to sandbox_exec';
    execute 'grant execute on function public.cv_test_admin(text, uuid) to sandbox_exec';
    execute 'grant authenticated to sandbox_exec';
  end if;
end $$;