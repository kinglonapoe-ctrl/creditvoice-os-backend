-- =====================================================================
-- CreditVoice OS — Phase 2A voice authentication & call session suite
--
-- Exercises the real call-session functions against the live schema.
-- Credential hash comparison itself (PBKDF2-SHA256) is covered by
-- supabase/tests/phase2a-hash.test.ts; here the verification result is
-- supplied to the atomic attempt functions exactly as the server does.
-- The whole run is rolled back.
-- =====================================================================
\set ON_ERROR_STOP on
begin;

create temporary table cv2_results(name text, passed boolean, detail text) on commit drop;
grant all on cv2_results to authenticated;

do $suite$
declare
  ids jsonb; ta uuid; tb uuid; tsus uuid; sid uuid; sid2 uuid; other uuid;
  r jsonb; st text; n integer; ok boolean; locked_until timestamptz; code_id uuid;
begin
  ids := public.cv_test_voice_setup('pbkdf2$1$00$aa', 'pbkdf2$1$00$bb');
  ta := (ids->>'ta')::uuid; tb := (ids->>'tb')::uuid; tsus := (ids->>'tsus')::uuid;

  -- ============ TENANT RESOLUTION ============
  sid := public.cv_create_call_session('+2348111111111', ids->>'num_a');
  r := public.cv_resolve_tenant(sid);
  insert into cv2_results values ('valid active number resolves the organization', (r->>'ok')::boolean, r::text);
  insert into cv2_results values ('resolution binds the correct organization',
    (select tenant_id from public.call_sessions where id = sid) = ta, 'bound');

  sid2 := public.cv_create_call_session('+2348111111111', '+234999999999');
  r := public.cv_resolve_tenant(sid2);
  insert into cv2_results values ('unknown number fails generically',
    (r->>'ok')::boolean = false and r->>'status' = 'FAILED', r::text);
  insert into cv2_results values ('unknown number leaks no organization',
    (select tenant_id from public.call_sessions where id = sid2) is null, 'null tenant');

  sid2 := public.cv_create_call_session('+2348111111111', ids->>'num_unassigned');
  r := public.cv_resolve_tenant(sid2);
  insert into cv2_results values ('unassigned number rejected', (r->>'ok')::boolean = false, r::text);

  sid2 := public.cv_create_call_session('+2348111111111', ids->>'num_not_active');
  r := public.cv_resolve_tenant(sid2);
  insert into cv2_results values ('inactive number rejected', (r->>'ok')::boolean = false, r::text);

  sid2 := public.cv_create_call_session('+2348111111111', ids->>'num_not_voice');
  r := public.cv_resolve_tenant(sid2);
  insert into cv2_results values ('non voice-capable number rejected', (r->>'ok')::boolean = false, r::text);

  perform public.cv_test_set_tenant_status(tsus, 'SUSPENDED');
  sid2 := public.cv_create_call_session('+2348111111111', ids->>'num_suspended_tenant');
  r := public.cv_resolve_tenant(sid2);
  insert into cv2_results values ('suspended organization cannot receive calls', (r->>'ok')::boolean = false, r::text);
  perform public.cv_test_set_tenant_status(tsus, 'CLOSED');
  sid2 := public.cv_create_call_session('+2348111111111', ids->>'num_suspended_tenant');
  r := public.cv_resolve_tenant(sid2);
  insert into cv2_results values ('closed organization cannot receive calls', (r->>'ok')::boolean = false, r::text);

  -- ============ ACCESS CODE ============
  r := public.cv_begin_access_code_attempt(sid);
  insert into cv2_results values ('access code attempt returns the stored credential to the server only',
    (r->>'ok')::boolean and (r->>'code_hash') is not null, 'begun');
  code_id := (r->>'code_id')::uuid;

  r := public.cv_finish_access_code_attempt(sid, code_id, false);
  insert into cv2_results values ('incorrect access code rejected', r->>'status' = 'REJECTED', r::text);
  insert into cv2_results values ('access code failure counted atomically',
    (public.cv_test_credential_state('ACCESS_CODE_BY_ID', code_id)->>'failed_attempts')::int = 1, 'attempts=1');
  insert into cv2_results values ('access code failure survives as a security record',
    (select count(*) from public.call_auth_failures where session_id = sid and stage = 'ACCESS_CODE') = 1, 'logged');
  insert into cv2_results values ('access code rejection is audited without credentials',
    (select count(*) from public.audit_logs where entity_id = sid and event_type = 'ACCESS_CODE_REJECTED'
       and metadata::text not ilike '%hash%') = 1, 'audited');

  r := public.cv_finish_access_code_attempt(sid, code_id, true);
  insert into cv2_results values ('correct access code advances the session',
    (r->>'ok')::boolean and r->>'status' = 'ACCESS_CODE_VERIFIED', r::text);
  insert into cv2_results values ('successful verification resets the failure counter',
    (public.cv_test_credential_state('ACCESS_CODE_BY_ID', code_id)->>'failed_attempts')::int = 0, 'reset');

  -- repeated failures lock the credential
  sid2 := public.cv_create_call_session('+2348222222222', ids->>'num_a');
  perform public.cv_resolve_tenant(sid2);
  for n in 1..5 loop
    r := public.cv_begin_access_code_attempt(sid2);
    exit when not (r->>'ok')::boolean;
    r := public.cv_finish_access_code_attempt(sid2, (r->>'code_id')::uuid, false);
  end loop;
  insert into cv2_results values ('repeated access code failures lock the session', r->>'status' = 'LOCKED', r::text);
  insert into cv2_results values ('access code lockout persisted in the database',
    (public.cv_test_credential_state('ACCESS_CODE_BY_ID', code_id)->>'locked')::boolean, 'locked');

  -- a locked credential blocks a brand new call
  other := public.cv_create_call_session('+2348333333333', ids->>'num_a');
  perform public.cv_resolve_tenant(other);
  r := public.cv_begin_access_code_attempt(other);
  insert into cv2_results values ('locked credential blocks a new call', r->>'status' = 'LOCKED', r::text);

  -- rotation invalidates the previous credential
  perform public.cv_test_rotate_access_code(ta, 'pbkdf2$1$00$cc');
  other := public.cv_create_call_session('+2348444444444', ids->>'num_a');
  perform public.cv_resolve_tenant(other);
  r := public.cv_begin_access_code_attempt(other);
  insert into cv2_results values ('rotation issues a different credential and clears the lock',
    (r->>'ok')::boolean and (r->>'code_id')::uuid <> code_id, r->>'ok');
  perform public.cv_finish_access_code_attempt(other, (r->>'code_id')::uuid, true);
  insert into cv2_results values ('retired credential is never selected again',
    (public.cv_test_credential_state('ACTIVE_COUNT', ta)->>'active_codes')::int = 1, 'one active');

  -- ============ ACCOUNT IDENTIFICATION ============
  r := public.cv_identify_account(sid, 'ZZZZZZ');
  insert into cv2_results values ('unknown account rejected generically', r->>'status' = 'REJECTED', r::text);
  r := public.cv_identify_account(sid, ids->>'acct_suspended');
  insert into cv2_results values ('suspended account rejected', (r->>'ok')::boolean = false, r::text);
  r := public.cv_identify_account(sid, ids->>'acct_inactive_customer');
  insert into cv2_results values ('inactive customer rejected', (r->>'ok')::boolean = false, r::text);

  r := public.cv_identify_account(sid, ids->>'acct_a');
  insert into cv2_results values ('valid account identified', (r->>'ok')::boolean, r::text);
  insert into cv2_results values ('identification is scoped to the session organization',
    (select ca.tenant_id from public.customer_accounts ca
      join public.call_sessions cs on cs.account_id = ca.id where cs.id = sid) = ta, 'tenant scoped');
  insert into cv2_results values ('organization B account is never reachable from an organization A call',
    (select count(*) from public.call_sessions cs join public.customer_accounts ca on ca.id = cs.account_id
      where cs.id = sid and ca.tenant_id = tb) = 0, 'cross-tenant blocked');

  -- ============ PIN ============
  r := public.cv_begin_pin_attempt(sid);
  insert into cv2_results values ('PIN attempt is only possible after account identification', (r->>'ok')::boolean, r::text);
  r := public.cv_finish_pin_attempt(sid, false);
  insert into cv2_results values ('incorrect PIN rejected', r->>'status' = 'REJECTED', r::text);
  insert into cv2_results values ('PIN failure counted atomically',
    (public.cv_test_credential_state('PIN', (ids->>'ca')::uuid)->>'failed_attempts')::int = 1, 'attempts=1');
  insert into cv2_results values ('PIN never appears in the audit trail',
    (select count(*) from public.audit_logs where entity_id = sid and metadata::text ~* '(pin"\s*:\s*")|hash') = 0, 'clean');

  r := public.cv_begin_pin_attempt(sid);
  r := public.cv_finish_pin_attempt(sid, true);
  insert into cv2_results values ('correct PIN authenticates the session',
    (r->>'ok')::boolean and r->>'status' = 'AUTHENTICATED', r::text);
  insert into cv2_results values ('successful PIN resets the failure counter',
    (public.cv_test_credential_state('PIN', (ids->>'ca')::uuid)->>'failed_attempts')::int = 0, 'reset');

  -- PIN lockout on another call
  other := public.cv_create_call_session('+2348555555555', ids->>'num_b');
  perform public.cv_resolve_tenant(other);
  r := public.cv_begin_access_code_attempt(other);
  perform public.cv_finish_access_code_attempt(other, (r->>'code_id')::uuid, true);
  perform public.cv_identify_account(other, ids->>'acct_b');
  for n in 1..3 loop
    r := public.cv_begin_pin_attempt(other);
    exit when not (r->>'ok')::boolean;
    r := public.cv_finish_pin_attempt(other, false);
  end loop;
  insert into cv2_results values ('repeated PIN failures lock the call', r->>'status' = 'LOCKED', r::text);
  insert into cv2_results values ('PIN lockout persisted in the database',
    (public.cv_test_credential_state('PIN', (ids->>'cb')::uuid)->>'locked')::boolean, 'locked');
  r := public.cv_authorize_action(other, 'CHECK_BALANCE');
  insert into cv2_results values ('locked session cannot act', (r->>'allowed')::boolean = false, r::text);

  -- ============ AUTHENTICATED IDENTITY ============
  r := public.cv_get_authenticated_session(sid);
  insert into cv2_results values ('authenticated session returns server-derived identity',
    (r->>'authenticated')::boolean and (r->>'tenant_id')::uuid = ta and (r->>'account_id') is not null, 'identity');
  insert into cv2_results values ('authenticated response exposes no credential material',
    r::text !~* '(hash|pin|access_code)', 'minimal');
  insert into cv2_results values ('only the last four digits of the account are returned',
    length(r->>'account_reference') = 4, r->>'account_reference');

  r := public.cv_authorize_action(sid, 'CHECK_BALANCE');
  insert into cv2_results values ('authenticated caller may check their balance', (r->>'allowed')::boolean, r::text);
  r := public.cv_authorize_action(sid, 'TRANSFER_CREDIT', (ids->>'ab1')::uuid);
  insert into cv2_results values ('caller cannot act on another account',
    (r->>'allowed')::boolean = false and r->>'reason' = 'ACCOUNT_NOT_IN_SESSION', r::text);
  r := public.cv_authorize_action(sid, 'TRANSFER_CREDIT', (ids->>'asus')::uuid);
  insert into cv2_results values ('caller cannot act on a suspended account of the same customer',
    (r->>'allowed')::boolean = false, r::text);

  -- organization suspended mid-call
  perform public.cv_test_set_tenant_status(ta, 'SUSPENDED');
  r := public.cv_authorize_action(sid, 'CHECK_BALANCE');
  insert into cv2_results values ('suspended organization blocks authorized actions',
    (r->>'allowed')::boolean = false and r->>'reason' = 'ORGANIZATION_NOT_OPERATIONAL', r::text);
  perform public.cv_test_set_tenant_status(ta, 'ACTIVE');

  -- ============ STATE MACHINE ============
  insert into cv2_results values ('NEW cannot jump to AUTHENTICATED',
    public.cv_transition_allowed('NEW','AUTHENTICATED') = false, 'blocked');
  insert into cv2_results values ('ordered progression is allowed',
    public.cv_transition_allowed('ACCOUNT_IDENTIFIED','PIN_VERIFIED'), 'allowed');
  other := public.cv_create_call_session('+2348666666666', ids->>'num_a');
  begin
    perform public.cv_apply_transition(other, 'AUTHENTICATED');
    insert into cv2_results values ('invalid transition is refused', false, 'no error raised');
  exception when others then
    insert into cv2_results values ('invalid transition is refused', true, sqlerrm);
  end;
  r := public.cv_identify_account(other, ids->>'acct_a');
  insert into cv2_results values ('account identification requires a verified access code',
    (r->>'ok')::boolean = false, r::text);
  r := public.cv_begin_pin_attempt(other);
  insert into cv2_results values ('PIN requires an identified account', (r->>'ok')::boolean = false, r::text);

  -- ============ EXPIRY AND END ============
  update public.call_sessions set last_activity_at = now() - interval '1 hour' where id = sid;
  r := public.cv_get_authenticated_session(sid);
  insert into cv2_results values ('idle session expires on next use',
    (r->>'authenticated')::boolean = false and r->>'status' = 'EXPIRED', r::text);
  r := public.cv_authorize_action(sid, 'CHECK_BALANCE');
  insert into cv2_results values ('expired session cannot act', (r->>'allowed')::boolean = false, r::text);
  insert into cv2_results values ('expiry is audited',
    (select count(*) from public.audit_logs where entity_id = sid and event_type = 'CALL_SESSION_EXPIRED') >= 1, 'audited');

  other := public.cv_create_call_session('+2348777777777', ids->>'num_a');
  perform public.cv_end_call_session(other, 'CALLER_HUNG_UP');
  insert into cv2_results values ('session can be ended',
    (select state from public.call_sessions where id = other) = 'ENDED', 'ended');
  r := public.cv_authorize_action(other, 'CHECK_BALANCE');
  insert into cv2_results values ('ended session cannot act', (r->>'allowed')::boolean = false, r::text);

  update public.call_sessions set last_activity_at = now() - interval '1 hour', state = 'NEW', ended_at = null
   where id = other;
  n := public.cv_expire_call_sessions();
  insert into cv2_results values ('bulk expiry sweeps idle sessions', n >= 1, 'expired=' || n);

  -- ============ REPLAY PROTECTION ============
  other := public.cv_create_call_session('+2348888888888', ids->>'num_a');
  ok := public.cv_claim_session_event(other, 'NONE', 'evt-phase2a-1', 'CALL_STARTED', '{}'::jsonb);
  insert into cv2_results values ('first provider event accepted', ok, 'accepted');
  ok := public.cv_claim_session_event(other, 'NONE', 'evt-phase2a-1', 'CALL_STARTED', '{}'::jsonb);
  insert into cv2_results values ('duplicate provider event rejected', ok = false, 'rejected');
  insert into cv2_results values ('replay rejection is audited',
    (select count(*) from public.audit_logs where event_type = 'CALL_SESSION_REPLAY_REJECTED' and entity_id = other) = 1, 'audited');
  insert into cv2_results values ('duplicate event stored only once',
    (select count(*) from public.call_session_events where provider_event_id = 'evt-phase2a-1') = 1, 'one row');

  -- ============ CALLER THROTTLE ============
  perform public.cv_test_seed_caller_failures('+2349999999999', 12);
  other := public.cv_create_call_session('+2349999999999', ids->>'num_a');
  insert into cv2_results values ('repeated offender from the same number is locked out',
    (select state from public.call_sessions where id = other) = 'LOCKED', 'locked');
  r := public.cv_resolve_tenant(other);
  insert into cv2_results values ('locked caller cannot progress', (r->>'ok')::boolean = false, r::text);
end $suite$;

-- ============ CLIENT PRIVILEGE CHECKS ============
do $priv$
declare n integer; blocked boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role','authenticated')::text, true);

  select count(*) into n from public.call_sessions;
  insert into cv2_results values ('signed-in user with no role sees no call sessions', n = 0, 'rows=' || n);

  begin
    insert into public.call_sessions (from_number, to_number) values ('+1','+2');
    blocked := false;
  exception when others then blocked := true; end;
  insert into cv2_results values ('clients cannot create call sessions', blocked, 'blocked');

  begin
    perform public.cv_create_call_session('+1','+2');
    blocked := false;
  exception when others then blocked := true; end;
  insert into cv2_results values ('clients cannot execute the session engine', blocked, 'blocked');

  begin
    perform public.cv_begin_pin_attempt(gen_random_uuid());
    blocked := false;
  exception when others then blocked := true; end;
  insert into cv2_results values ('clients cannot read credential material', blocked, 'blocked');

  begin
    select count(*) into n from public.call_auth_failures;
    blocked := (n = 0);
  exception when others then blocked := true; end;
  insert into cv2_results values ('clients cannot read the security failure log', blocked, 'blocked');
  reset role;
end $priv$;

\pset border 2
select case when passed then 'PASS' else 'FAIL' end as result, name, detail from cv2_results order by ctid;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from cv2_results;

do $$
declare f integer;
begin
  select count(*) into f from cv2_results where not passed;
  if f > 0 then raise exception '% Phase 2A assertion(s) failed', f; end if;
end $$;

rollback;
