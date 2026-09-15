-- ============================================================
-- CreditVoice OS — Phase 2A: secure voice authentication and
-- call session layer. Additive only; no existing object is
-- redefined except by explicit extension.
-- ============================================================

-- ---------- 1. ENUMS ----------
create type public.call_session_state as enum (
  'NEW','TENANT_RESOLVED','ACCESS_CODE_VERIFIED','ACCOUNT_IDENTIFIED','PIN_VERIFIED',
  'AUTHENTICATED','PROCESSING','COMPLETED','FAILED','LOCKED','EXPIRED','ENDED'
);

create type public.call_auth_stage as enum (
  'TENANT_RESOLUTION','ACCESS_CODE','ACCOUNT_IDENTIFICATION','PIN','AUTHENTICATED','CLOSED'
);

create type public.call_action as enum (
  'CHECK_BALANCE','VIEW_ACCOUNT','TRANSFER_CREDIT','END_SESSION'
);

-- ---------- 2. TABLES ----------
create table public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'NONE',
  provider_call_id text,
  provider_event_id text,
  from_number text not null,
  to_number text not null,
  tenant_id uuid references public.tenants(id),
  customer_id uuid references public.customers(id),
  account_id uuid references public.customer_accounts(id),
  state public.call_session_state not null default 'NEW',
  authentication_stage public.call_auth_stage not null default 'TENANT_RESOLUTION',
  attempt_count integer not null default 0,
  access_code_attempts integer not null default 0,
  pin_attempts integer not null default 0,
  last_activity_at timestamptz not null default now(),
  authenticated_at timestamptz,
  ended_at timestamptz,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.call_sessions to authenticated;
grant all on public.call_sessions to service_role;
alter table public.call_sessions enable row level security;

create policy "Platform admins read all call sessions"
  on public.call_sessions for select to authenticated
  using (public.is_super_admin());
create policy "Organization admins read their call sessions"
  on public.call_sessions for select to authenticated
  using (tenant_id is not null and tenant_id = public.current_user_tenant_id());

create table public.call_session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.call_sessions(id) on delete cascade,
  provider text not null default 'NONE',
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index uq_call_session_events_provider_event
  on public.call_session_events(provider, provider_event_id);

grant select on public.call_session_events to authenticated;
grant all on public.call_session_events to service_role;
alter table public.call_session_events enable row level security;

create policy "Platform admins read call events"
  on public.call_session_events for select to authenticated
  using (public.is_super_admin());

create table public.call_auth_failures (
  id uuid primary key default gen_random_uuid(),
  session_id uuid,
  tenant_id uuid,
  from_number text,
  to_number text,
  stage public.call_auth_stage not null,
  reason text not null,
  attempt integer not null default 0,
  created_at timestamptz not null default now()
);

grant all on public.call_auth_failures to service_role;
alter table public.call_auth_failures enable row level security;
create policy "Platform admins read auth failures"
  on public.call_auth_failures for select to authenticated
  using (public.is_super_admin());

create index idx_call_sessions_live on public.call_sessions(state, last_activity_at);
create index idx_call_sessions_tenant on public.call_sessions(tenant_id, created_at desc);
create index idx_call_sessions_from on public.call_sessions(from_number, created_at desc);
create index idx_call_events_session on public.call_session_events(session_id, created_at desc);
create index idx_call_failures_from on public.call_auth_failures(from_number, created_at desc);
create index idx_call_failures_tenant on public.call_auth_failures(tenant_id, created_at desc);

create trigger t_call_sessions_updated
  before update on public.call_sessions
  for each row execute function public.update_updated_at_column();

-- ---------- 3. CONFIGURATION ----------
insert into public.platform_settings (key, value)
values ('call_session_ttl_seconds', '180'::jsonb),
       ('call_max_access_code_attempts', '5'::jsonb),
       ('call_max_pin_attempts', '3'::jsonb),
       ('call_max_session_attempts', '9'::jsonb),
       ('call_caller_failure_window_minutes', '15'::jsonb),
       ('call_caller_failure_limit', '12'::jsonb)
on conflict (key) do nothing;

create or replace function public.cv_setting_int(_key text, _default integer)
returns integer language sql stable security definer set search_path to 'public' as $$
  select coalesce((select (value #>> '{}')::integer from public.platform_settings where key = _key), _default);
$$;
revoke all on function public.cv_setting_int(text, integer) from public, anon, authenticated;

-- ---------- 4. STATE MACHINE ----------
create or replace function public.cv_transition_allowed(
  _from public.call_session_state, _to public.call_session_state
) returns boolean language sql immutable set search_path to 'public' as $$
  select case
    when _from in ('FAILED','LOCKED','EXPIRED') then _to = 'ENDED'
    when _from in ('COMPLETED') then _to = 'ENDED'
    when _from = 'ENDED' then false
    when _from = 'NEW' then _to in ('TENANT_RESOLVED','FAILED','LOCKED','EXPIRED','ENDED')
    when _from = 'TENANT_RESOLVED' then _to in ('ACCESS_CODE_VERIFIED','FAILED','LOCKED','EXPIRED','ENDED')
    when _from = 'ACCESS_CODE_VERIFIED' then _to in ('ACCOUNT_IDENTIFIED','FAILED','LOCKED','EXPIRED','ENDED')
    when _from = 'ACCOUNT_IDENTIFIED' then _to in ('PIN_VERIFIED','FAILED','LOCKED','EXPIRED','ENDED')
    when _from = 'PIN_VERIFIED' then _to in ('AUTHENTICATED','FAILED','LOCKED','EXPIRED','ENDED')
    when _from = 'AUTHENTICATED' then _to in ('PROCESSING','COMPLETED','FAILED','EXPIRED','ENDED')
    when _from = 'PROCESSING' then _to in ('AUTHENTICATED','COMPLETED','FAILED','EXPIRED','ENDED')
    else false
  end;
$$;

create or replace function public.cv_audit(
  _tenant_id uuid, _event text, _entity_id uuid, _metadata jsonb
) returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.audit_logs (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, metadata)
  values (_tenant_id, null, null, _event, 'call_session', _entity_id, coalesce(_metadata, '{}'::jsonb));
end; $$;
revoke all on function public.cv_audit(uuid, text, uuid, jsonb) from public, anon, authenticated;

-- Locks the session row, applies expiry, and validates the transition.
create or replace function public.cv_apply_transition(
  _session_id uuid,
  _to public.call_session_state,
  _stage public.call_auth_stage default null,
  _failure_reason text default null
) returns public.call_sessions language plpgsql security definer set search_path to 'public' as $$
declare s public.call_sessions%rowtype;
begin
  select * into s from public.call_sessions where id = _session_id for update;
  if not found then raise exception 'Call session not found'; end if;
  if not public.cv_transition_allowed(s.state, _to) then
    raise exception 'Invalid call session transition % -> %', s.state, _to;
  end if;
  update public.call_sessions
     set state = _to,
         authentication_stage = coalesce(_stage, authentication_stage),
         failure_reason = coalesce(_failure_reason, failure_reason),
         last_activity_at = now(),
         authenticated_at = case when _to = 'AUTHENTICATED' then now() else authenticated_at end,
         ended_at = case when _to in ('ENDED','EXPIRED','COMPLETED','FAILED','LOCKED') then now() else ended_at end
   where id = _session_id
  returning * into s;
  return s;
end; $$;
revoke all on function public.cv_apply_transition(uuid, public.call_session_state, public.call_auth_stage, text)
  from public, anon, authenticated;

-- Loads a session, expiring it first when idle beyond the configured lifetime.
create or replace function public.cv_load_live_session(_session_id uuid)
returns public.call_sessions language plpgsql security definer set search_path to 'public' as $$
declare s public.call_sessions%rowtype; ttl integer;
begin
  ttl := public.cv_setting_int('call_session_ttl_seconds', 180);
  select * into s from public.call_sessions where id = _session_id for update;
  if not found then raise exception 'Call session not found'; end if;
  if s.state in ('NEW','TENANT_RESOLVED','ACCESS_CODE_VERIFIED','ACCOUNT_IDENTIFIED','PIN_VERIFIED','AUTHENTICATED','PROCESSING')
     and s.last_activity_at < now() - make_interval(secs => ttl) then
    update public.call_sessions
       set state = 'EXPIRED', authentication_stage = 'CLOSED', ended_at = now(),
           failure_reason = coalesce(failure_reason, 'SESSION_EXPIRED')
     where id = _session_id returning * into s;
    perform public.cv_audit(s.tenant_id, 'CALL_SESSION_EXPIRED', s.id, jsonb_build_object('stage', s.authentication_stage));
  end if;
  return s;
end; $$;
revoke all on function public.cv_load_live_session(uuid) from public, anon, authenticated;

create or replace function public.cv_record_failure(
  _session public.call_sessions, _stage public.call_auth_stage, _reason text, _attempt integer
) returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.call_auth_failures (session_id, tenant_id, from_number, to_number, stage, reason, attempt)
  values (_session.id, _session.tenant_id, _session.from_number, _session.to_number, _stage, _reason, coalesce(_attempt,0));
end; $$;
revoke all on function public.cv_record_failure(public.call_sessions, public.call_auth_stage, text, integer)
  from public, anon, authenticated;

-- ---------- 5. SESSION CREATION ----------
create or replace function public.cv_create_call_session(
  _from_number text, _to_number text, _provider text default 'NONE',
  _provider_call_id text default null, _provider_event_id text default null
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare sid uuid; win integer; lim integer; recent integer;
begin
  if _from_number is null or _from_number = '' or _to_number is null or _to_number = '' then
    raise exception 'Both caller and destination numbers are required';
  end if;

  win := public.cv_setting_int('call_caller_failure_window_minutes', 15);
  lim := public.cv_setting_int('call_caller_failure_limit', 12);
  select count(*) into recent from public.call_auth_failures
   where from_number = _from_number and created_at > now() - make_interval(mins => win);

  insert into public.call_sessions (provider, provider_call_id, provider_event_id, from_number, to_number)
  values (coalesce(_provider,'NONE'), _provider_call_id, _provider_event_id, _from_number, _to_number)
  returning id into sid;

  perform public.cv_audit(null, 'CALL_SESSION_CREATED', sid, jsonb_build_object('provider', coalesce(_provider,'NONE')));

  if recent >= lim then
    update public.call_sessions
       set state = 'LOCKED', authentication_stage = 'CLOSED', failure_reason = 'CALLER_RATE_LIMITED', ended_at = now()
     where id = sid;
    perform public.cv_audit(null, 'ACCESS_CODE_LOCKED', sid, jsonb_build_object('reason','CALLER_RATE_LIMITED'));
  end if;
  return sid;
end; $$;
revoke all on function public.cv_create_call_session(text, text, text, text, text) from public, anon, authenticated;

-- ---------- 6. TENANT RESOLUTION ----------
create or replace function public.cv_resolve_tenant(_session_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare s public.call_sessions%rowtype; t_id uuid;
begin
  s := public.cv_load_live_session(_session_id);
  if s.state <> 'NEW' then return jsonb_build_object('ok', false, 'status', s.state::text); end if;

  select pn.tenant_id into t_id
    from public.phone_numbers pn
    join public.tenants t on t.id = pn.tenant_id
   where pn.phone_number = s.to_number
     and pn.voice_capable
     and pn.status = 'ACTIVE'
     and t.status = 'ACTIVE'
     and t.currency_approved
   limit 1;

  if t_id is null then
    perform public.cv_record_failure(s, 'TENANT_RESOLUTION', 'UNRESOLVED_DESTINATION', 0);
    perform public.cv_audit(null, 'TENANT_RESOLUTION_FAILED', s.id, jsonb_build_object('reason','UNRESOLVED_DESTINATION'));
    perform public.cv_apply_transition(s.id, 'FAILED', 'CLOSED', 'AUTHENTICATION_FAILED');
    return jsonb_build_object('ok', false, 'status', 'FAILED');
  end if;

  update public.call_sessions set tenant_id = t_id where id = s.id;
  perform public.cv_apply_transition(s.id, 'TENANT_RESOLVED', 'ACCESS_CODE');
  return jsonb_build_object('ok', true, 'status', 'TENANT_RESOLVED');
end; $$;
revoke all on function public.cv_resolve_tenant(uuid) from public, anon, authenticated;

-- ---------- 7. ACCESS CODE ----------
-- Returns the stored hash to the trusted server only; never reachable by app roles.
create or replace function public.cv_begin_access_code_attempt(_session_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare s public.call_sessions%rowtype; c public.tenant_access_codes%rowtype; maxa integer; maxs integer;
begin
  s := public.cv_load_live_session(_session_id);
  if s.state <> 'TENANT_RESOLVED' then
    return jsonb_build_object('ok', false, 'status', s.state::text);
  end if;
  maxa := public.cv_setting_int('call_max_access_code_attempts', 5);
  maxs := public.cv_setting_int('call_max_session_attempts', 9);
  if s.access_code_attempts >= maxa or s.attempt_count >= maxs then
    perform public.cv_record_failure(s, 'ACCESS_CODE', 'SESSION_ATTEMPTS_EXCEEDED', s.access_code_attempts);
    perform public.cv_audit(s.tenant_id, 'ACCESS_CODE_LOCKED', s.id, jsonb_build_object('reason','SESSION_ATTEMPTS_EXCEEDED'));
    perform public.cv_apply_transition(s.id, 'LOCKED', 'CLOSED', 'AUTHENTICATION_FAILED');
    return jsonb_build_object('ok', false, 'status', 'LOCKED');
  end if;

  select * into c from public.tenant_access_codes
   where tenant_id = s.tenant_id and is_active and retired_at is null
   for update;

  if not found or (c.locked_until is not null and c.locked_until > now()) then
    perform public.cv_record_failure(s, 'ACCESS_CODE', 'CREDENTIAL_UNAVAILABLE', s.access_code_attempts);
    perform public.cv_audit(s.tenant_id, 'ACCESS_CODE_LOCKED', s.id, jsonb_build_object('reason','CREDENTIAL_UNAVAILABLE'));
    perform public.cv_apply_transition(s.id, 'LOCKED', 'CLOSED', 'AUTHENTICATION_FAILED');
    return jsonb_build_object('ok', false, 'status', 'LOCKED');
  end if;

  perform public.cv_audit(s.tenant_id, 'ACCESS_CODE_ATTEMPT', s.id,
    jsonb_build_object('attempt', s.access_code_attempts + 1));
  return jsonb_build_object('ok', true, 'code_id', c.id, 'code_hash', c.code_hash);
end; $$;
revoke all on function public.cv_begin_access_code_attempt(uuid) from public, anon, authenticated;

create or replace function public.cv_finish_access_code_attempt(
  _session_id uuid, _code_id uuid, _verified boolean
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare s public.call_sessions%rowtype; attempts integer; maxa integer;
begin
  s := public.cv_load_live_session(_session_id);
  if s.state <> 'TENANT_RESOLVED' then return jsonb_build_object('ok', false, 'status', s.state::text); end if;
  maxa := public.cv_setting_int('call_max_access_code_attempts', 5);

  if _verified then
    update public.tenant_access_codes
       set failed_attempts = 0, locked_until = null
     where id = _code_id;
    update public.call_sessions set attempt_count = attempt_count + 1 where id = s.id;
    perform public.cv_apply_transition(s.id, 'ACCESS_CODE_VERIFIED', 'ACCOUNT_IDENTIFICATION');
    perform public.cv_audit(s.tenant_id, 'ACCESS_CODE_VERIFIED', s.id, '{}'::jsonb);
    return jsonb_build_object('ok', true, 'status', 'ACCESS_CODE_VERIFIED');
  end if;

  update public.tenant_access_codes
     set failed_attempts = failed_attempts + 1,
         locked_until = case when failed_attempts + 1 >= maxa then now() + interval '15 minutes' else locked_until end
   where id = _code_id
  returning failed_attempts into attempts;

  update public.call_sessions
     set access_code_attempts = access_code_attempts + 1,
         attempt_count = attempt_count + 1,
         last_activity_at = now()
   where id = s.id
  returning * into s;

  perform public.cv_record_failure(s, 'ACCESS_CODE', 'INVALID_CREDENTIAL', s.access_code_attempts);
  perform public.cv_audit(s.tenant_id, 'ACCESS_CODE_REJECTED', s.id,
    jsonb_build_object('attempt', s.access_code_attempts, 'reason', 'INVALID_CREDENTIAL'));

  if coalesce(attempts,0) >= maxa or s.access_code_attempts >= maxa then
    perform public.cv_audit(s.tenant_id, 'ACCESS_CODE_LOCKED', s.id, jsonb_build_object('attempt', s.access_code_attempts));
    perform public.cv_apply_transition(s.id, 'LOCKED', 'CLOSED', 'AUTHENTICATION_FAILED');
    return jsonb_build_object('ok', false, 'status', 'LOCKED');
  end if;
  return jsonb_build_object('ok', false, 'status', 'REJECTED');
end; $$;
revoke all on function public.cv_finish_access_code_attempt(uuid, uuid, boolean) from public, anon, authenticated;

-- ---------- 8. ACCOUNT IDENTIFICATION ----------
create or replace function public.cv_identify_account(_session_id uuid, _account_number text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare s public.call_sessions%rowtype; a public.customer_accounts%rowtype; cust public.customers%rowtype; maxs integer;
begin
  s := public.cv_load_live_session(_session_id);
  if s.state <> 'ACCESS_CODE_VERIFIED' then return jsonb_build_object('ok', false, 'status', s.state::text); end if;
  maxs := public.cv_setting_int('call_max_session_attempts', 9);

  select * into a from public.customer_accounts
   where tenant_id = s.tenant_id and account_number = _account_number and status = 'ACTIVE';

  if found then
    select * into cust from public.customers where id = a.customer_id and status = 'ACTIVE';
  end if;

  if not found or cust.id is null then
    update public.call_sessions set attempt_count = attempt_count + 1, last_activity_at = now()
     where id = s.id returning * into s;
    perform public.cv_record_failure(s, 'ACCOUNT_IDENTIFICATION', 'ACCOUNT_UNAVAILABLE', s.attempt_count);
    perform public.cv_audit(s.tenant_id, 'ACCOUNT_IDENTIFICATION_FAILED', s.id,
      jsonb_build_object('attempt', s.attempt_count, 'reason', 'ACCOUNT_UNAVAILABLE'));
    if s.attempt_count >= maxs then
      perform public.cv_apply_transition(s.id, 'LOCKED', 'CLOSED', 'AUTHENTICATION_FAILED');
      return jsonb_build_object('ok', false, 'status', 'LOCKED');
    end if;
    return jsonb_build_object('ok', false, 'status', 'REJECTED');
  end if;

  update public.call_sessions
     set account_id = a.id, customer_id = cust.id, attempt_count = attempt_count + 1
   where id = s.id;
  perform public.cv_apply_transition(s.id, 'ACCOUNT_IDENTIFIED', 'PIN');
  perform public.cv_audit(s.tenant_id, 'ACCOUNT_IDENTIFIED', s.id, jsonb_build_object('account_id', a.id));
  return jsonb_build_object('ok', true, 'status', 'ACCOUNT_IDENTIFIED');
end; $$;
revoke all on function public.cv_identify_account(uuid, text) from public, anon, authenticated;

-- ---------- 9. PIN ----------
create or replace function public.cv_begin_pin_attempt(_session_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare s public.call_sessions%rowtype; p public.customer_pins%rowtype; maxp integer;
begin
  s := public.cv_load_live_session(_session_id);
  if s.state <> 'ACCOUNT_IDENTIFIED' then return jsonb_build_object('ok', false, 'status', s.state::text); end if;
  maxp := public.cv_setting_int('call_max_pin_attempts', 3);
  if s.pin_attempts >= maxp then
    perform public.cv_audit(s.tenant_id, 'PIN_LOCKED', s.id, jsonb_build_object('reason','SESSION_ATTEMPTS_EXCEEDED'));
    perform public.cv_apply_transition(s.id, 'LOCKED', 'CLOSED', 'AUTHENTICATION_FAILED');
    return jsonb_build_object('ok', false, 'status', 'LOCKED');
  end if;

  select * into p from public.customer_pins
   where customer_id = s.customer_id and tenant_id = s.tenant_id for update;

  if not found or (p.locked_until is not null and p.locked_until > now()) then
    perform public.cv_record_failure(s, 'PIN', 'CREDENTIAL_UNAVAILABLE', s.pin_attempts);
    perform public.cv_audit(s.tenant_id, 'PIN_LOCKED', s.id, jsonb_build_object('reason','CREDENTIAL_UNAVAILABLE'));
    perform public.cv_apply_transition(s.id, 'LOCKED', 'CLOSED', 'AUTHENTICATION_FAILED');
    return jsonb_build_object('ok', false, 'status', 'LOCKED');
  end if;

  perform public.cv_audit(s.tenant_id, 'PIN_ATTEMPT', s.id, jsonb_build_object('attempt', s.pin_attempts + 1));
  return jsonb_build_object('ok', true, 'customer_id', p.customer_id, 'pin_hash', p.pin_hash);
end; $$;
revoke all on function public.cv_begin_pin_attempt(uuid) from public, anon, authenticated;

create or replace function public.cv_finish_pin_attempt(_session_id uuid, _verified boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare s public.call_sessions%rowtype; attempts integer; maxp integer;
begin
  s := public.cv_load_live_session(_session_id);
  if s.state <> 'ACCOUNT_IDENTIFIED' then return jsonb_build_object('ok', false, 'status', s.state::text); end if;
  maxp := public.cv_setting_int('call_max_pin_attempts', 3);

  if _verified then
    update public.customer_pins set failed_attempts = 0, locked_until = null
     where customer_id = s.customer_id and tenant_id = s.tenant_id;
    update public.call_sessions set attempt_count = attempt_count + 1 where id = s.id;
    perform public.cv_apply_transition(s.id, 'PIN_VERIFIED', 'PIN');
    perform public.cv_audit(s.tenant_id, 'PIN_VERIFIED', s.id, '{}'::jsonb);
    perform public.cv_apply_transition(s.id, 'AUTHENTICATED', 'AUTHENTICATED');
    perform public.cv_audit(s.tenant_id, 'CALL_SESSION_AUTHENTICATED', s.id, '{}'::jsonb);
    return jsonb_build_object('ok', true, 'status', 'AUTHENTICATED');
  end if;

  update public.customer_pins
     set failed_attempts = failed_attempts + 1,
         locked_until = case when failed_attempts + 1 >= maxp then now() + interval '15 minutes' else locked_until end
   where customer_id = s.customer_id and tenant_id = s.tenant_id
  returning failed_attempts into attempts;

  update public.call_sessions
     set pin_attempts = pin_attempts + 1, attempt_count = attempt_count + 1, last_activity_at = now()
   where id = s.id returning * into s;

  perform public.cv_record_failure(s, 'PIN', 'INVALID_CREDENTIAL', s.pin_attempts);
  perform public.cv_audit(s.tenant_id, 'PIN_REJECTED', s.id,
    jsonb_build_object('attempt', s.pin_attempts, 'reason', 'INVALID_CREDENTIAL'));

  if coalesce(attempts,0) >= maxp or s.pin_attempts >= maxp then
    perform public.cv_audit(s.tenant_id, 'PIN_LOCKED', s.id, jsonb_build_object('attempt', s.pin_attempts));
    perform public.cv_apply_transition(s.id, 'LOCKED', 'CLOSED', 'AUTHENTICATION_FAILED');
    return jsonb_build_object('ok', false, 'status', 'LOCKED');
  end if;
  return jsonb_build_object('ok', false, 'status', 'REJECTED');
end; $$;
revoke all on function public.cv_finish_pin_attempt(uuid, boolean) from public, anon, authenticated;

-- ---------- 10. AUTHENTICATED CONTEXT AND ACTIONS ----------
create or replace function public.cv_get_authenticated_session(_session_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare s public.call_sessions%rowtype; a public.customer_accounts%rowtype;
begin
  s := public.cv_load_live_session(_session_id);
  if s.state not in ('AUTHENTICATED','PROCESSING') then
    return jsonb_build_object('authenticated', false, 'status', s.state::text);
  end if;
  update public.call_sessions set last_activity_at = now() where id = s.id;
  select * into a from public.customer_accounts where id = s.account_id;
  return jsonb_build_object(
    'authenticated', true,
    'session_id', s.id,
    'tenant_id', s.tenant_id,
    'customer_id', s.customer_id,
    'account_id', s.account_id,
    'account_reference', right(coalesce(a.account_number,''), 4),
    'currency_code', a.currency_code,
    'authenticated_at', s.authenticated_at
  );
end; $$;
revoke all on function public.cv_get_authenticated_session(uuid) from public, anon, authenticated;

create or replace function public.cv_authorize_action(
  _session_id uuid, _action public.call_action, _target_account_id uuid default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare s public.call_sessions%rowtype; a public.customer_accounts%rowtype; c public.customers%rowtype; t public.tenants%rowtype;
begin
  s := public.cv_load_live_session(_session_id);
  if s.state not in ('AUTHENTICATED','PROCESSING') then
    return jsonb_build_object('allowed', false, 'reason', 'SESSION_NOT_AUTHENTICATED');
  end if;
  if _action = 'END_SESSION' then
    return jsonb_build_object('allowed', true, 'session_id', s.id, 'tenant_id', s.tenant_id);
  end if;
  if _target_account_id is not null and _target_account_id <> s.account_id then
    return jsonb_build_object('allowed', false, 'reason', 'ACCOUNT_NOT_IN_SESSION');
  end if;

  select * into t from public.tenants where id = s.tenant_id;
  select * into a from public.customer_accounts where id = s.account_id;
  select * into c from public.customers where id = s.customer_id;
  if t.status <> 'ACTIVE' or not t.currency_approved then
    return jsonb_build_object('allowed', false, 'reason', 'ORGANIZATION_NOT_OPERATIONAL');
  end if;
  if a.id is null or a.tenant_id <> s.tenant_id or a.status <> 'ACTIVE' then
    return jsonb_build_object('allowed', false, 'reason', 'ACCOUNT_NOT_AVAILABLE');
  end if;
  if c.id is null or c.status <> 'ACTIVE' then
    return jsonb_build_object('allowed', false, 'reason', 'CUSTOMER_NOT_AVAILABLE');
  end if;

  return jsonb_build_object(
    'allowed', true, 'session_id', s.id, 'tenant_id', s.tenant_id,
    'customer_id', s.customer_id, 'account_id', s.account_id,
    'currency_code', a.currency_code
  );
end; $$;
revoke all on function public.cv_authorize_action(uuid, public.call_action, uuid) from public, anon, authenticated;

-- ---------- 11. LIFECYCLE ----------
create or replace function public.cv_end_call_session(_session_id uuid, _reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare s public.call_sessions%rowtype;
begin
  select * into s from public.call_sessions where id = _session_id for update;
  if not found then raise exception 'Call session not found'; end if;
  if s.state = 'ENDED' then return jsonb_build_object('ok', true, 'status', 'ENDED'); end if;
  if s.state in ('AUTHENTICATED','PROCESSING') then
    perform public.cv_apply_transition(s.id, 'COMPLETED', 'CLOSED', _reason);
  end if;
  perform public.cv_apply_transition(s.id, 'ENDED', 'CLOSED', _reason);
  perform public.cv_audit(s.tenant_id, 'CALL_SESSION_ENDED', s.id, jsonb_build_object('reason', coalesce(_reason,'CALLER_ENDED')));
  return jsonb_build_object('ok', true, 'status', 'ENDED');
end; $$;
revoke all on function public.cv_end_call_session(uuid, text) from public, anon, authenticated;

create or replace function public.cv_expire_call_sessions()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare ttl integer; n integer;
begin
  ttl := public.cv_setting_int('call_session_ttl_seconds', 180);
  with expired as (
    update public.call_sessions
       set state = 'EXPIRED', authentication_stage = 'CLOSED', ended_at = now(),
           failure_reason = coalesce(failure_reason, 'SESSION_EXPIRED')
     where state in ('NEW','TENANT_RESOLVED','ACCESS_CODE_VERIFIED','ACCOUNT_IDENTIFIED','PIN_VERIFIED','AUTHENTICATED','PROCESSING')
       and last_activity_at < now() - make_interval(secs => ttl)
    returning id, tenant_id
  )
  select count(*) into n from expired;
  return coalesce(n, 0);
end; $$;
revoke all on function public.cv_expire_call_sessions() from public, anon, authenticated;

-- ---------- 12. PROVIDER EVENT REPLAY PROTECTION ----------
create or replace function public.cv_claim_session_event(
  _session_id uuid, _provider text, _provider_event_id text, _event_type text, _payload jsonb default '{}'::jsonb
) returns boolean language plpgsql security definer set search_path to 'public' as $$
begin
  if _provider_event_id is null or _provider_event_id = '' then return true; end if;
  begin
    insert into public.call_session_events (session_id, provider, provider_event_id, event_type, payload)
    values (_session_id, coalesce(_provider,'NONE'), _provider_event_id, _event_type, coalesce(_payload,'{}'::jsonb));
  exception when unique_violation then
    perform public.cv_audit(null, 'CALL_SESSION_REPLAY_REJECTED', _session_id,
      jsonb_build_object('event_type', _event_type));
    return false;
  end;
  return true;
end; $$;
revoke all on function public.cv_claim_session_event(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- ---------- 13. SERVER-SIDE GRANTS ----------
grant execute on function public.cv_setting_int(text, integer) to service_role;
grant execute on function public.cv_audit(uuid, text, uuid, jsonb) to service_role;
grant execute on function public.cv_apply_transition(uuid, public.call_session_state, public.call_auth_stage, text) to service_role;
grant execute on function public.cv_load_live_session(uuid) to service_role;
grant execute on function public.cv_record_failure(public.call_sessions, public.call_auth_stage, text, integer) to service_role;
grant execute on function public.cv_create_call_session(text, text, text, text, text) to service_role;
grant execute on function public.cv_resolve_tenant(uuid) to service_role;
grant execute on function public.cv_begin_access_code_attempt(uuid) to service_role;
grant execute on function public.cv_finish_access_code_attempt(uuid, uuid, boolean) to service_role;
grant execute on function public.cv_identify_account(uuid, text) to service_role;
grant execute on function public.cv_begin_pin_attempt(uuid) to service_role;
grant execute on function public.cv_finish_pin_attempt(uuid, boolean) to service_role;
grant execute on function public.cv_get_authenticated_session(uuid) to service_role;
grant execute on function public.cv_authorize_action(uuid, public.call_action, uuid) to service_role;
grant execute on function public.cv_end_call_session(uuid, text) to service_role;
grant execute on function public.cv_expire_call_sessions() to service_role;
grant execute on function public.cv_claim_session_event(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.cv_transition_allowed(public.call_session_state, public.call_session_state) to service_role;