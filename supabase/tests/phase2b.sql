-- =====================================================================
-- CreditVoice OS — Phase 2B voice transfer, currency and customer-care suite
--
-- Exercises the real Phase 2B functions against the live schema, on top of
-- the existing Phase 2A authentication path. The financial engine is the
-- unmodified execute_transfer(). The whole run is rolled back.
-- =====================================================================
\set ON_ERROR_STOP on
begin;

create temporary table cv3_results(name text, passed boolean, detail text) on commit drop;
grant all on cv3_results to authenticated;

do $suite$
declare
  ids jsonb; extra jsonb; ta uuid; tb uuid; tsus uuid;
  sid uuid; code_id uuid; r jsonb; n integer; before_bal numeric; after_bal numeric;
  rec_acct text; rec_id uuid; src_id uuid; trid1 uuid; key1 text; nowt time;
begin
  ids := public.cv_test_voice_setup('pbkdf2$1$00$aa', 'pbkdf2$1$00$bb');
  ta := (ids->>'ta')::uuid; tb := (ids->>'tb')::uuid; tsus := (ids->>'tsus')::uuid;
  src_id := (ids->>'aa1')::uuid;

  extra := public.cv_test_add_account(ta, 'QA Recipient');
  rec_acct := extra->>'account_number';
  rec_id := (extra->>'account_id')::uuid;

  perform public.cv_test_fund_account(src_id, 100000);

  -- authenticate a call exactly as Phase 2A does -----------------------
  sid := public.cv_create_call_session('+2348123456789', ids->>'num_a', 'TWILIO', 'CA-TEST-1', null);
  perform public.cv_resolve_tenant(sid);
  code_id := (public.cv_begin_access_code_attempt(sid))->>'code_id';
  perform public.cv_finish_access_code_attempt(sid, code_id, true);
  perform public.cv_identify_account(sid, ids->>'acct_a');
  perform public.cv_begin_pin_attempt(sid);
  perform public.cv_finish_pin_attempt(sid, true);

  insert into cv3_results values ('call reaches AUTHENTICATED through Phase 2A',
    (select state from public.call_sessions where id = sid) = 'AUTHENTICATED', 'authenticated');

  -- ============ CALL CORRELATION ============
  insert into cv3_results values ('live call is found again by provider call id',
    public.cv_find_call_session('TWILIO','CA-TEST-1') = sid, 'correlated');
  insert into cv3_results values ('unknown provider call id correlates to nothing',
    public.cv_find_call_session('TWILIO','CA-DOES-NOT-EXIST') is null, 'null');

  -- ============ IVR POSITION ============
  perform public.cv_ivr_set_state(sid, 'MENU', 0);
  insert into cv3_results values ('IVR position is stored on the session',
    (public.cv_ivr_state(sid))->>'ivr_state' = 'MENU', 'MENU');
  begin
    perform public.cv_ivr_set_state(sid, repeat('x', 80), 0);
    insert into cv3_results values ('over-long IVR state rejected', false, 'accepted');
  exception when others then
    insert into cv3_results values ('over-long IVR state rejected', true, 'rejected');
  end;

  -- ============ CONFIGURATION IS DATA ============
  r := public.cv_ivr_config(ta);
  insert into cv3_results values ('IVR configuration exposes no credentials',
    r ? 'voice' and r ? 'language' and not (r::text ilike '%hash%'), r::text);

  -- ============ TRANSFER PREPARATION ============
  r := public.cv_prepare_transfer(sid, rec_acct, 5000);
  insert into cv3_results values ('valid recipient and amount accepted', (r->>'ok')::boolean, r::text);
  insert into cv3_results values ('amount uses currency decimal places',
    (r->>'amount')::numeric = 50.00, r->>'amount');
  insert into cv3_results values ('only the last four digits of the recipient are returned',
    length(r->>'recipient_reference') = 4, r->>'recipient_reference');

  r := public.cv_prepare_transfer(sid, ids->>'acct_b', 5000);
  insert into cv3_results values ('cross-organization recipient rejected',
    (r->>'ok')::boolean = false and r->>'reason' = 'RECIPIENT_UNAVAILABLE', r::text);

  r := public.cv_prepare_transfer(sid, ids->>'acct_suspended', 5000);
  insert into cv3_results values ('suspended recipient rejected', (r->>'ok')::boolean = false, r::text);

  r := public.cv_prepare_transfer(sid, ids->>'acct_inactive_customer', 5000);
  insert into cv3_results values ('recipient with an inactive customer rejected', (r->>'ok')::boolean = false, r::text);

  r := public.cv_prepare_transfer(sid, ids->>'acct_a', 5000);
  insert into cv3_results values ('the caller cannot transfer to their own account',
    (r->>'ok')::boolean = false, r::text);

  r := public.cv_prepare_transfer(sid, '99999999', 5000);
  insert into cv3_results values ('unknown recipient rejected generically',
    (r->>'ok')::boolean = false and r->>'reason' = 'RECIPIENT_UNAVAILABLE', r::text);

  r := public.cv_prepare_transfer(sid, rec_acct, 0);
  insert into cv3_results values ('zero amount rejected', (r->>'ok')::boolean = false, r::text);
  r := public.cv_prepare_transfer(sid, rec_acct, -100);
  insert into cv3_results values ('negative amount rejected', (r->>'ok')::boolean = false, r::text);

  -- ============ EXECUTION THROUGH THE EXISTING ENGINE ============
  before_bal := (select balance from public.customer_accounts where id = src_id);
  r := public.cv_prepare_transfer(sid, rec_acct, 5000);
  key1 := 'voice-key-1';
  r := public.cv_execute_voice_transfer(sid, key1);
  insert into cv3_results values ('voice transfer completes', (r->>'ok')::boolean, r::text);
  trid1 := (r->>'transfer_id')::uuid;

  after_bal := (select balance from public.customer_accounts where id = src_id);
  insert into cv3_results values ('sender is debited exactly once',
    after_bal = before_bal - 50, after_bal::text);
  insert into cv3_results values ('recipient is credited exactly once',
    (select balance from public.customer_accounts where id = rec_id) = 50, 'credited');

  select count(*) into n from public.transfers where id = trid1 and status = 'COMPLETED';
  insert into cv3_results values ('exactly one completed transfer row', n = 1, n::text);
  select count(*) into n from public.ledger_entries le
    join public.transactions t on t.id = le.transaction_id
   where t.id = (select transaction_id from public.transfers where id = trid1);
  insert into cv3_results values ('two immutable ledger entries were written', n = 2, n::text);
  select count(*) into n from public.financial_idempotency
   where tenant_id = ta and idempotency_key = key1;
  insert into cv3_results values ('idempotency record written', n = 1, n::text);
  select count(*) into n from public.audit_logs
   where entity_id = trid1 and event_type = 'TRANSFER_COMPLETED';
  insert into cv3_results values ('completion is audited', n = 1, n::text);

  insert into cv3_results values ('the transfer grant is consumed',
    (select count(*) from public.call_transfer_grants where session_id = sid) = 0, 'consumed');
  insert into cv3_results values ('pending transfer is cleared after execution',
    (select pending_amount from public.call_sessions where id = sid) is null, 'cleared');

  -- ============ IDEMPOTENCY: THE SAME EVENT AGAIN ============
  r := public.cv_prepare_transfer(sid, rec_acct, 5000);
  r := public.cv_execute_voice_transfer(sid, key1);
  insert into cv3_results values ('repeating the same idempotency key returns the original transfer',
    (r->>'ok')::boolean and (r->>'transfer_id')::uuid = trid1, r::text);
  select count(*) into n from public.transfers where sender_account_id = src_id;
  insert into cv3_results values ('a repeated event moves no extra money', n = 1, n::text);
  insert into cv3_results values ('balance unchanged by the repeated event',
    (select balance from public.customer_accounts where id = src_id) = after_bal, 'unchanged');

  -- ============ FAILURE AUDITING SURVIVES THE ROLLBACK ============
  r := public.cv_prepare_transfer(sid, rec_acct, 99999900000);
  r := public.cv_execute_voice_transfer(sid, 'voice-key-too-big');
  insert into cv3_results values ('transfer beyond available credit is refused',
    (r->>'ok')::boolean = false and r->>'reason' = 'INSUFFICIENT_CREDIT', r::text);
  select count(*) into n from public.financial_failure_events
   where session_id = sid and reason_category = 'INSUFFICIENT_CREDIT';
  insert into cv3_results values ('the rejected operation is recorded durably', n = 1, n::text);
  select count(*) into n from public.audit_logs where entity_id = sid and event_type = 'TRANSFER_FAILED';
  insert into cv3_results values ('the rejected operation is audited', n >= 1, n::text);
  select count(*) into n from public.transfers where sender_account_id = src_id;
  insert into cv3_results values ('a refused transfer moves no money', n = 1, n::text);
  insert into cv3_results values ('failure record carries no credential material',
    not exists (select 1 from public.financial_failure_events
                 where session_id = sid and (idempotency_key ilike '%pin%' or reason_category ilike '%hash%')),
    'clean');

  -- ============ EXECUTION PRECONDITIONS ============
  r := public.cv_execute_voice_transfer(sid, 'voice-key-none');
  insert into cv3_results values ('execution without a prepared transfer is refused',
    (r->>'ok')::boolean = false and r->>'reason' = 'NO_PENDING_TRANSFER', r::text);
  r := public.cv_prepare_transfer(sid, rec_acct, 100);
  r := public.cv_execute_voice_transfer(sid, '');
  insert into cv3_results values ('execution without an idempotency key is refused',
    (r->>'ok')::boolean = false, r::text);

  perform public.cv_cancel_transfer(sid);
  insert into cv3_results values ('cancelling clears the pending transfer',
    (select pending_amount from public.call_sessions where id = sid) is null, 'cancelled');
  select count(*) into n from public.audit_logs where entity_id = sid and event_type = 'TRANSFER_CANCELLED';
  insert into cv3_results values ('cancellation is audited', n >= 1, n::text);

  -- ============ ENDED SESSION CANNOT MOVE MONEY ============
  perform public.cv_end_call_session(sid, 'CALLER_ENDED');
  r := public.cv_prepare_transfer(sid, rec_acct, 100);
  insert into cv3_results values ('an ended call cannot prepare a transfer',
    (r->>'ok')::boolean = false, r::text);
  r := public.cv_execute_voice_transfer(sid, 'voice-key-after-end');
  insert into cv3_results values ('an ended call cannot execute a transfer',
    (r->>'ok')::boolean = false, r::text);

  -- ============ VOICE GRANT ============
  insert into cv3_results values ('no transfer grant means no voice authority',
    public.cv_voice_grant_valid(src_id) = false, 'no grant');

  -- ============ CUSTOMER CARE ROUTING ============
  sid := public.cv_create_call_session('+2348123456780', ids->>'num_a', 'TWILIO', 'CA-TEST-2', null);
  perform public.cv_resolve_tenant(sid);

  perform public.cv_test_set_care(ta, jsonb_build_object('enabled', false));
  r := public.cv_customer_care_route(sid);
  insert into cv3_results values ('customer care disabled is unavailable',
    (r->>'available')::boolean = false, r::text);

  nowt := (now() at time zone 'UTC')::time;
  perform public.cv_test_set_care(ta, jsonb_build_object(
    'enabled', true, 'timezone', 'UTC', 'routing_mode', 'LIVE_AGENT', 'after_hours_mode', 'VOICEMAIL',
    'primary_number', '+2348000000001', 'voicemail_enabled', true,
    'business_hours_start', (nowt - interval '1 hour')::time::text,
    'business_hours_end', (nowt + interval '1 hour')::time::text));
  r := public.cv_customer_care_route(sid);
  insert into cv3_results values ('inside business hours the call is transferred',
    (r->>'available')::boolean and r->>'action' = 'DIAL' and r->>'destination' = '+2348000000001', r::text);
  insert into cv3_results values ('business hours are evaluated in the organization timezone',
    (r->>'in_hours')::boolean, r::text);

  perform public.cv_test_set_care(ta, jsonb_build_object(
    'business_hours_start', (nowt + interval '2 hours')::time::text,
    'business_hours_end', (nowt + interval '3 hours')::time::text));
  r := public.cv_customer_care_route(sid);
  insert into cv3_results values ('outside business hours the after-hours mode applies',
    (r->>'available')::boolean and r->>'action' = 'VOICEMAIL' and (r->>'in_hours')::boolean = false, r::text);

  perform public.cv_test_set_care(ta, jsonb_build_object('after_hours_mode', 'VOICEMAIL', 'voicemail_enabled', false));
  r := public.cv_customer_care_route(sid);
  insert into cv3_results values ('after-hours with voicemail disabled is unavailable',
    (r->>'available')::boolean = false, r::text);

  perform public.cv_test_set_care(ta, jsonb_build_object(
    'timezone', 'Pacific/Kiritimati', 'routing_mode', 'LIVE_AGENT', 'after_hours_mode', 'LIVE_AGENT',
    'voicemail_enabled', true,
    'business_hours_start', (nowt - interval '1 hour')::time::text,
    'business_hours_end', (nowt + interval '1 hour')::time::text));
  r := public.cv_customer_care_route(sid);
  insert into cv3_results values ('a different timezone changes the business-hours answer',
    (r->>'in_hours')::boolean = false, r::text);

  perform public.cv_test_voice_cleanup(array[ta, tb, tsus]);
end $suite$;

-- ============ PRIVILEGES ============
do $priv$
declare blocked boolean; n integer;
begin
  set local role authenticated;

  begin
    perform public.cv_prepare_transfer(gen_random_uuid(), '1', 1); blocked := false;
  exception when insufficient_privilege then blocked := true; when others then blocked := false; end;
  insert into cv3_results values ('signed-in users cannot prepare a voice transfer', blocked, 'blocked');

  begin
    perform public.cv_execute_voice_transfer(gen_random_uuid(), 'k'); blocked := false;
  exception when insufficient_privilege then blocked := true; when others then blocked := false; end;
  insert into cv3_results values ('signed-in users cannot execute a voice transfer', blocked, 'blocked');

  begin
    perform public.cv_ivr_set_state(gen_random_uuid(), 'MENU', 0); blocked := false;
  exception when insufficient_privilege then blocked := true; when others then blocked := false; end;
  insert into cv3_results values ('signed-in users cannot move the IVR', blocked, 'blocked');

  begin
    perform public.cv_voice_grant_valid(gen_random_uuid()); blocked := false;
  exception when insufficient_privilege then blocked := true; when others then blocked := false; end;
  insert into cv3_results values ('signed-in users cannot evaluate the voice grant', blocked, 'blocked');

  begin
    select count(*) into n from public.call_transfer_grants; blocked := (n = 0);
  exception when others then blocked := true; end;
  insert into cv3_results values ('signed-in users cannot read transfer grants', blocked, 'blocked');

  begin
    insert into public.call_transfer_grants (nonce, session_id, account_id)
    values ('x', gen_random_uuid(), gen_random_uuid());
    blocked := false;
  exception when others then blocked := true; end;
  insert into cv3_results values ('signed-in users cannot mint a transfer grant', blocked, 'blocked');

  begin
    select count(*) into n from public.financial_failure_events; blocked := (n = 0);
  exception when others then blocked := true; end;
  insert into cv3_results values ('signed-in users see no other organization''s failures', blocked, 'blocked');

  reset role;

  -- Regression (forensic audit): RLS does not restrict TRUNCATE, so signed-in
  -- users must not hold write/TRUNCATE privileges on call or financial
  -- bookkeeping tables.
  select count(*) into n
  from information_schema.role_table_grants
  where table_schema = 'public'
    and grantee in ('anon', 'authenticated')
    and privilege_type <> 'SELECT'
    and table_name in ('call_sessions', 'call_session_events', 'call_auth_failures',
                       'financial_failure_events', 'financial_idempotency',
                       'tenant_account_sequences');
  insert into cv3_results values ('no write or truncate grants on voice/financial tables', n = 0, 'grants=' || n);

  select count(*) into n
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'anon'
    and table_name in ('call_sessions', 'financial_idempotency', 'call_transfer_grants');
  insert into cv3_results values ('anonymous role has no access to voice/financial tables', n = 0, 'grants=' || n);

  select count(*) into n
  from information_schema.routine_privileges
  where specific_schema = 'public' and grantee in ('anon', 'authenticated')
    and routine_name like 'cv_test_%';
  insert into cv3_results values ('development test helpers are not exposed to clients', n = 0, 'grants=' || n);

end $priv$;

\pset border 2
select case when passed then 'PASS' else 'FAIL' end as result, name, detail from cv3_results order by ctid;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from cv3_results;

do $$
declare f integer;
begin
  select count(*) into f from cv3_results where not passed;
  if f > 0 then raise exception '% Phase 2B assertion(s) failed', f; end if;
end $$;

rollback;
