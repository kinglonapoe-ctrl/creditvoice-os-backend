-- =====================================================================
-- CreditVoice OS — tenant-controlled account numbering suite.
-- Runs against the live schema inside one transaction that is rolled back.
-- =====================================================================
\set ON_ERROR_STOP on
begin;

create temporary table cv_ids on commit drop as select cv_test.cv_test_setup() as ids;
create temporary table an_results(name text, passed boolean, detail text) on commit drop;
grant all on an_results to authenticated;
grant select on cv_ids to authenticated;

-- existing production fingerprint (non-QA tenants) before anything runs
create temporary table an_before on commit drop as
  select a.id, a.account_number, a.balance from public.customer_accounts a
   where a.tenant_id not in (select (ids->>'ta')::uuid from cv_ids union select (ids->>'tb')::uuid from cv_ids);

do $suite$
declare ids jsonb; ta uuid; tb uuid; ua uuid; ub uuid; ca uuid; cb uuid; ok boolean; msg text; v text; n int;
begin
  select cv_ids.ids into ids from cv_ids;
  ta := (ids->>'ta')::uuid; tb := (ids->>'tb')::uuid; ua := (ids->>'ua')::uuid; ub := (ids->>'ub')::uuid;
  ca := (ids->>'ca')::uuid; cb := (ids->>'cb')::uuid;

  insert into an_results values ('new organization defaults to MANUAL',
    (select mode from public.tenant_account_number_settings where tenant_id = ta) = 'MANUAL', '');
  insert into an_results values ('existing organizations kept AUTOMATIC 5..5',
    not exists (select 1 from public.tenant_account_number_settings s join public.tenants t on t.id = s.tenant_id
                 where t.id not in (ta, tb) and not (s.mode = 'AUTOMATIC' and s.min_length = 5 and s.max_length = 5)), '');

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);

  -- fixed length 6 manual
  perform public.set_account_numbering_settings(ta, 'MANUAL', 6, 6, null);
  insert into an_results values ('settings change audit-logged',
    exists (select 1 from public.audit_logs where tenant_id = ta and event_type = 'ACCOUNT_NUMBERING_UPDATED' and actor_id = ua), '');

  begin
    insert into public.customer_accounts (tenant_id, customer_id, currency_code, credit_limit) values (ta, ca, 'NGN', 0);
    ok := false; msg := 'inserted';
  exception when others then ok := sqlerrm like '%required%'; msg := sqlerrm; end;
  insert into an_results values ('manual mode: missing number rejected', ok, msg);

  insert into public.customer_accounts (tenant_id, customer_id, currency_code, credit_limit, account_number)
  values (ta, ca, 'NGN', 0, '000123') returning account_number into v;
  insert into an_results values ('manual: leading zeros preserved, not replaced', v = '000123', v);

  begin
    insert into public.customer_accounts (tenant_id, customer_id, currency_code, credit_limit, account_number) values (ta, ca, 'NGN', 0, '12345');
    ok := false; msg := 'inserted';
  exception when others then ok := true; msg := sqlerrm; end;
  insert into an_results values ('fixed length 6: 5 digits rejected', ok, msg);

  begin
    insert into public.customer_accounts (tenant_id, customer_id, currency_code, credit_limit, account_number) values (ta, ca, 'NGN', 0, '1234567');
    ok := false; msg := 'inserted';
  exception when others then ok := true; msg := sqlerrm; end;
  insert into an_results values ('fixed length 6: 7 digits rejected', ok, msg);

  begin
    insert into public.customer_accounts (tenant_id, customer_id, currency_code, credit_limit, account_number) values (ta, ca, 'NGN', 0, '12A456');
    ok := false; msg := 'inserted';
  exception when others then ok := true; msg := sqlerrm; end;
  insert into an_results values ('non-digit number rejected', ok, msg);

  begin
    insert into public.customer_accounts (tenant_id, customer_id, currency_code, credit_limit, account_number) values (ta, ca, 'NGN', 0, '000123');
    ok := false; msg := 'inserted';
  exception when others then ok := true; msg := sqlerrm; end;
  insert into an_results values ('duplicate within tenant rejected', ok, msg);

  -- variable length 4..8 automatic, with manual number in the sequence path
  perform public.set_account_numbering_settings(ta, 'AUTOMATIC', 4, 8, null);
  insert into public.customer_accounts (tenant_id, customer_id, currency_code, credit_limit, account_number)
  values (ta, ca, 'NGN', 0, '4321') returning account_number into v;
  insert into an_results values ('variable 4..8: 4 digits accepted', v = '4321', v);
  -- pre-claim the next sequence value manually
  select next_number::text into v from public.tenant_account_sequences where tenant_id = ta;
  insert into public.customer_accounts (tenant_id, customer_id, currency_code, credit_limit, account_number) values (ta, ca, 'NGN', 0, v);
  insert into public.customer_accounts (tenant_id, customer_id, currency_code, credit_limit) values (ta, ca, 'NGN', 0)
  returning account_number into msg;
  insert into an_results values ('automatic skips manually-assigned number', msg <> v and msg::bigint > v::bigint, v || ' -> ' || msg);

  begin
    perform public.set_account_numbering_settings(ta, 'AUTOMATIC', 6, 6, null);
    ok := false; msg := 'changed';
  exception when others then ok := sqlerrm like '%would not fit%'; msg := sqlerrm; end;
  insert into an_results values ('settings that orphan existing numbers rejected', ok, msg);

  begin
    update public.customer_accounts set account_number = '99999' where tenant_id = ta and account_number = '4321';
    ok := false; msg := 'updated';
  exception when others then ok := true; msg := sqlerrm; end;
  insert into an_results values ('existing number cannot be changed', ok, msg);

  begin
    insert into public.customer_accounts (tenant_id, customer_id, currency_code, credit_limit, account_number) values (ta, cb, 'NGN', 0, '55555');
    ok := false; msg := 'inserted';
  exception when others then ok := true; msg := sqlerrm; end;
  insert into an_results values ('cannot attach another organization''s customer', ok, msg);

  begin
    perform public.set_account_numbering_settings(tb, 'AUTOMATIC', 1, 20, null);
    ok := false; msg := 'changed';
  exception when others then ok := sqlerrm like '%Not authorized%'; msg := sqlerrm; end;
  insert into an_results values ('admin A cannot change organization B settings', ok, msg);

  begin
    update public.tenant_account_number_settings set mode = 'AUTOMATIC' where tenant_id = ta;
    get diagnostics n = row_count; ok := n = 0; msg := 'rows=' || n;
  exception when others then ok := true; msg := sqlerrm; end;
  insert into an_results values ('direct settings table write denied', ok, msg);

  select count(*) into n from public.tenant_account_number_settings where tenant_id = tb;
  insert into an_results values ('admin A cannot read organization B settings', n = 0, 'rows=' || n);

  -- organization B may use the same number
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  insert into public.customer_accounts (tenant_id, customer_id, currency_code, credit_limit, account_number)
  values (tb, cb, 'NGN', 0, '000123') returning account_number into v;
  insert into an_results values ('same number allowed in another tenant', v = '000123', v);

  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  -- padding
  update public.tenant_account_number_settings set mode = 'AUTOMATIC', min_length = 8, max_length = 8, pad_length = 8 where tenant_id = tb;
  v := public.allocate_account_number(tb);
  insert into an_results values ('zero-padding produces fixed-length number', v ~ '^0+[1-9][0-9]*$' and length(v) = 8, v);
  -- min length jump without padding
  update public.tenant_account_number_settings set min_length = 7, max_length = 9, pad_length = null where tenant_id = tb;
  v := public.allocate_account_number(tb);
  insert into an_results values ('automatic honours minimum length', length(v) between 7 and 9, v);

  -- rule function used by IVR
  update public.tenant_account_number_settings set min_length = 6, max_length = 6 where tenant_id = ta;
  insert into an_results values ('IVR rules: tenant A (6 digits) rejects 5 digits',
    not public.account_number_matches_rules(ta, '12345') and public.account_number_matches_rules(ta, '000123'), '');
  insert into an_results values ('IVR rules: tenant B (7..9) rejects 6 digits',
    not public.account_number_matches_rules(tb, '000123'), '');
  insert into an_results values ('IVR config exposes tenant lengths',
    (public.cv_ivr_config(ta)->>'account_number_max_length')::int = 6
    and (public.cv_ivr_config(tb)->>'account_number_max_length')::int = 9, '');
end $suite$;

-- IVR identification & transfer scoping through the voice session path
do $ivr$
declare v jsonb; ta uuid; tb uuid; sid uuid; code_id uuid; r jsonb; att int;
begin
  v := cv_test.cv_test_voice_setup('pbkdf2$1$00$aa', 'pbkdf2$1$00$bb');
  ta := (v->>'ta')::uuid; tb := (v->>'tb')::uuid;
  update public.tenant_account_number_settings set mode = 'AUTOMATIC', min_length = 5, max_length = 5 where tenant_id in (ta, tb);

  sid := public.cv_create_call_session('+2348123450000', v->>'num_a', 'TWILIO', 'CA-AN-1', null);
  perform public.cv_resolve_tenant(sid);
  code_id := (public.cv_begin_access_code_attempt(sid))->>'code_id';
  perform public.cv_finish_access_code_attempt(sid, code_id, true);

  r := public.cv_identify_account(sid, '123');
  select attempt_count into att from public.call_sessions where id = sid;
  insert into an_results values ('IVR: wrong-length account rejected and attempt counted',
    r->>'status' = 'REJECTED' and att >= 1, r::text);
  r := public.cv_identify_account(sid, v->>'acct_b');
  insert into an_results values ('IVR: other tenant account number rejected (same response)', r->>'status' = 'REJECTED', r::text);
  r := public.cv_identify_account(sid, v->>'acct_a');
  insert into an_results values ('IVR: valid own-tenant account identified', (r->>'ok')::boolean, r::text);
  perform public.cv_begin_pin_attempt(sid);
  perform public.cv_finish_pin_attempt(sid, true);

  r := public.cv_prepare_transfer(sid, v->>'acct_b', 100);
  insert into an_results values ('transfer to other-tenant number rejected',
    r->>'reason' = 'RECIPIENT_UNAVAILABLE', r::text);
  r := public.cv_prepare_transfer(sid, '12', 100);
  insert into an_results values ('transfer recipient wrong length rejected',
    r->>'reason' = 'RECIPIENT_UNAVAILABLE', r::text);
end $ivr$;

insert into an_results
select 'existing account numbers and balances unchanged',
       not exists (select 1 from an_before b left join public.customer_accounts a on a.id = b.id
                    where a.id is null or a.account_number <> b.account_number or a.balance <> b.balance), '';

select name, passed, left(detail, 90) detail from an_results order by passed, name;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from an_results;
do $$ begin if exists (select 1 from an_results where not passed) then raise exception 'account numbering suite failed'; end if; end $$;
rollback;
