create or replace function public.run_hardening_tests()
returns table(name text, passed boolean, detail text)
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  ta uuid := gen_random_uuid();
  tb uuid := gen_random_uuid();
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  ca uuid; cb uuid; aa1 uuid; aa2 uuid; ab1 uuid;
  trid uuid; txid uuid;
  n integer; ok boolean; msg text; bal numeric;
  claims_a text := json_build_object('sub', ua, 'role','authenticated')::text;
  claims_b text := json_build_object('sub', ub, 'role','authenticated')::text;
begin
  create temporary table if not exists _cv_results(t_name text, t_passed boolean, t_detail text) on commit drop;
  delete from _cv_results;

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

  select count(distinct account_number) into n from public.customer_accounts where tenant_id = ta;
  insert into _cv_results values ('account numbers unique within an organization', n = 2, 'distinct=' || n);

  -- ---------- isolation ----------
  set local role authenticated;
  perform set_config('request.jwt.claims', claims_b, true);

  select count(*) into n from public.customers where tenant_id = ta;
  insert into _cv_results values ('Test A: organization B cannot read organization A customers', n = 0, 'rows=' || n);
  select count(*) into n from public.customer_accounts where tenant_id = ta;
  insert into _cv_results values ('organization B cannot read organization A accounts', n = 0, 'rows=' || n);
  select count(*) into n from public.audit_logs where tenant_id = ta;
  insert into _cv_results values ('organization B cannot read organization A audit trail', n = 0, 'rows=' || n);

  update public.customers set full_name = 'HIJACKED' where id = ca;
  get diagnostics n = row_count;
  insert into _cv_results values ('Test B: organization B cannot update organization A customer', n = 0, 'rows=' || n);

  begin
    insert into public.customer_accounts (tenant_id, customer_id, currency_code, credit_limit)
    values (ta, ca, 'NGN', 0);
    ok := false; msg := 'insert succeeded';
  exception when others then ok := true; msg := sqlerrm; end;
  insert into _cv_results values ('Test C: organization B cannot open an account under organization A', ok, msg);

  begin
    select count(*) into n from public.customer_pins; ok := (n = 0); msg := 'rows=' || n;
  exception when others then ok := true; msg := sqlerrm; end;
  insert into _cv_results values ('customer PIN hashes unreadable by clients', ok, msg);

  begin
    select count(*) into n from public.tenant_access_codes; ok := (n = 0); msg := 'rows=' || n;
  exception when others then ok := true; msg := sqlerrm; end;
  insert into _cv_results values ('access code hashes unreadable by clients', ok, msg);

  begin
    insert into public.user_roles (user_id, role) values (ub, 'SUPER_ADMIN');
    ok := false; msg := 'escalation succeeded';
  exception when others then ok := true; msg := sqlerrm; end;
  insert into _cv_results values ('role escalation through user_roles rejected', ok, msg);

  -- ---------- balances & currency ----------
  perform set_config('request.jwt.claims', claims_a, true);
  begin
    update public.customer_accounts set balance = 1000000 where id = aa1;
    ok := false; msg := 'balance write succeeded';
  exception when others then ok := true; msg := sqlerrm; end;
  insert into _cv_results values ('direct balance manipulation rejected', ok, msg);

  begin
    update public.customer_accounts set currency_code = 'USD' where id = aa1;
    ok := false; msg := 'currency change succeeded';
  exception when others then ok := true; msg := sqlerrm; end;
  insert into _cv_results values ('account currency is immutable', ok, msg);

  begin
    update public.tenants set currency_code = 'USD' where id = ta;
    ok := false; msg := 'currency change succeeded';
  exception when others then ok := true; msg := sqlerrm; end;
  insert into _cv_results values ('organization admin cannot change approved currency', ok, msg);

  begin
    update public.tenants set status = 'SUSPENDED' where id = ta;
    ok := false; msg := 'status change succeeded';
  exception when others then ok := true; msg := sqlerrm; end;
  insert into _cv_results values ('organization admin cannot change organization status', ok, msg);

  -- ---------- credit ----------
  txid := public.post_credit(aa1, 10000, 'INITIAL_CREDIT', 'opening credit');
  select balance into bal from public.customer_accounts where id = aa1;
  insert into _cv_results values ('credit posting moves balance through the ledger', bal = 10000, 'balance=' || bal);

  select count(*) into n from public.audit_logs where tenant_id = ta and event_type = 'CREDIT_ADDED';
  insert into _cv_results values ('credit posting writes an audit event', n = 1, 'events=' || n);

  begin
    perform public.post_credit(ab1, 500, 'INITIAL_CREDIT', null);
    ok := false; msg := 'cross-organization credit succeeded';
  exception when others then ok := true; msg := sqlerrm; end;
  insert into _cv_results values ('credit posting into another organization rejected', ok, msg);

  begin
    perform public.post_credit(aa1, -50, 'CREDIT_ADJUSTMENT', null);
    ok := false; msg := 'negative credit succeeded';
  exception when others then ok := true; msg := sqlerrm; end;
  insert into _cv_results values ('negative credit rejected', ok, msg);

  perform public.post_credit(aa1, 1000, 'CREDIT_ADJUSTMENT', null, 'idem-credit-1');
  perform public.post_credit(aa1, 1000, 'CREDIT_ADJUSTMENT', null, 'idem-credit-1');
  select balance into bal from public.customer_accounts where id = aa1;
  insert into _cv_results values ('repeated credit with the same key posts once', bal = 11000, 'balance=' || bal);

  -- ---------- transfers ----------
  trid := public.execute_transfer(aa1, aa2, 4000, 'test transfer');
  select balance into bal from public.customer_accounts where id = aa1;
  insert into _cv_results values ('transfer debits the sender', bal = 7000, 'balance=' || bal);
  select balance into bal from public.customer_accounts where id = aa2;
  insert into _cv_results values ('transfer credits the recipient', bal = 4000, 'balance=' || bal);

  select count(*) into n from public.ledger_entries le
    join public.transactions tx on tx.id = le.transaction_id
   where tx.type = 'TRANSFER' and tx.tenant_id = ta;
  insert into _cv_results values ('transfer writes balanced double-entry lines', n = 2, 'entries=' || n);

  select count(*) into n from public.audit_logs
   where tenant_id = ta and event_type in ('TRANSFER_INITIATED','TRANSFER_COMPLETED');
  insert into _cv_results values ('transfer writes initiated and completed audit events', n = 2, 'events=' || n);

  begin
    perform public.execute_transfer(aa1, aa2, 999999, null);
    ok := false; msg := 'overdraft succeeded';
  exception when others then ok := true; msg := sqlerrm; end;
  insert into _cv_results values ('insufficient credit rejected', ok, msg);

  begin
    perform public.execute_transfer(aa1, ab1, 100, null);
    ok := false; msg := 'cross-organization transfer succeeded';
  exception when others then ok := true; msg := sqlerrm; end;
  insert into _cv_results values ('Test D: cross-organization transfer rejected', ok, msg);

  begin
    perform public.execute_transfer(aa1, aa1, 100, null);
    ok := false; msg := 'self transfer succeeded';
  exception when others then ok := true; msg := sqlerrm; end;
  insert into _cv_results values ('self transfer rejected', ok, msg);

  set local role none;
  update public.customer_accounts set status = 'SUSPENDED' where id = aa2;
  set local role authenticated;
  perform set_config('request.jwt.claims', claims_a, true);
  begin
    perform public.execute_transfer(aa1, aa2, 100, null);
    ok := false; msg := 'transfer to suspended account succeeded';
  exception when others then ok := true; msg := sqlerrm; end;
  insert into _cv_results values ('transfer to an inactive account rejected', ok, msg);
  set local role none;
  update public.customer_accounts set status = 'ACTIVE' where id = aa2;
  set local role authenticated;
  perform set_config('request.jwt.claims', claims_a, true);

  perform public.execute_transfer(aa1, aa2, 500, null, 'idem-transfer-1');
  perform public.execute_transfer(aa1, aa2, 500, null, 'idem-transfer-1');
  select balance into bal from public.customer_accounts where id = aa1;
  insert into _cv_results values ('repeated transfer with the same key posts once', bal = 6500, 'balance=' || bal);

  -- ---------- immutability ----------
  begin
    update public.transactions set amount = 1 where tenant_id = ta;
    ok := false; msg := 'transaction edit succeeded';
  exception when others then ok := true; msg := sqlerrm; end;
  insert into _cv_results values ('completed transactions are immutable', ok, msg);

  begin
    delete from public.ledger_entries where tenant_id = ta;
    ok := false; msg := 'ledger delete succeeded';
  exception when others then ok := true; msg := sqlerrm; end;
  insert into _cv_results values ('ledger entries cannot be deleted', ok, msg);

  begin
    update public.transfers set amount = 1 where id = trid;
    ok := false; msg := 'transfer edit succeeded';
  exception when others then ok := true; msg := sqlerrm; end;
  insert into _cv_results values ('settled transfers are immutable', ok, msg);

  begin
    update public.audit_logs set event_type = 'FAKE' where tenant_id = ta;
    ok := false; msg := 'audit edit succeeded';
  exception when others then ok := true; msg := sqlerrm; end;
  insert into _cv_results values ('audit trail is append-only', ok, msg);

  -- ---------- reversal ----------
  txid := public.reverse_transfer(trid, 'customer dispute');
  select balance into bal from public.customer_accounts where id = aa1;
  insert into _cv_results values ('reversal restores the sender balance', bal = 10500, 'balance=' || bal);

  select count(*) into n from public.transactions
   where reversal_of_transaction_id is not null and tenant_id = ta;
  insert into _cv_results values ('reversal links back to the original transaction', n = 1, 'rows=' || n);

  select count(*) into n from public.transfers where id = trid and status = 'REVERSED'
     and reversed_by is not null and reversal_reason = 'customer dispute';
  insert into _cv_results values ('reversal records who reversed it and why', n = 1, 'rows=' || n);

  begin
    perform public.reverse_transfer(trid, 'again');
    ok := false; msg := 'double reversal succeeded';
  exception when others then ok := true; msg := sqlerrm; end;
  insert into _cv_results values ('double reversal rejected', ok, msg);

  select count(*) into n from public.transactions where type = 'TRANSFER' and tenant_id = ta;
  insert into _cv_results values ('original transaction retained after reversal', n >= 1, 'rows=' || n);

  select count(*) into n from public.reconcile_account_balances(ta) where drift <> 0;
  insert into _cv_results values ('cached balances reconcile with the ledger', n = 0, 'drifting accounts=' || n);

  -- ---------- suspended organization ----------
  set local role none;
  update public.tenants set status = 'SUSPENDED' where id = ta;
  set local role authenticated;
  perform set_config('request.jwt.claims', claims_a, true);
  begin
    perform public.post_credit(aa1, 100, 'CREDIT_ADJUSTMENT', null);
    ok := false; msg := 'credit under a suspended organization succeeded';
  exception when others then ok := true; msg := sqlerrm; end;
  insert into _cv_results values ('suspended organization cannot move money', ok, msg);

  set local role none;
  perform set_config('request.jwt.claims', '', true);
  return query select t_name, t_passed, t_detail from _cv_results;
end;
$fn$;

revoke all on function public.run_hardening_tests() from public, anon, authenticated;
comment on function public.run_hardening_tests() is
  'Development-only harness. Writes throwaway rows; the caller MUST roll back the surrounding transaction.';
