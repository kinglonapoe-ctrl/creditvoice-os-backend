-- =====================================================================
-- CreditVoice OS — Phase 2B: Twilio voice adapter support layer
-- New migration only. No existing migration is rewritten.
-- =====================================================================

-- 1. Voice / IVR configuration (data only, never executed as code) -----
alter table public.ivr_settings
  add column if not exists voice text not null default 'alice',
  add column if not exists max_input_retries integer not null default 3,
  add column if not exists gather_timeout_seconds integer not null default 6,
  add column if not exists menu_message text,
  add column if not exists recording_enabled boolean not null default false;

alter table public.ivr_settings
  add constraint ivr_settings_retries_ck check (max_input_retries between 1 and 5),
  add constraint ivr_settings_timeout_ck check (gather_timeout_seconds between 3 and 30);

-- 2. IVR position + pending transfer on the existing call session ------
alter table public.call_sessions
  add column if not exists ivr_state text not null default 'WELCOME',
  add column if not exists ivr_retries integer not null default 0,
  add column if not exists pending_recipient_account_id uuid references public.customer_accounts(id),
  add column if not exists pending_amount numeric(20,4),
  add column if not exists pending_transfer_key text;

create index if not exists idx_call_sessions_provider_call
  on public.call_sessions (provider, provider_call_id, created_at desc);

-- 3. Financial failure events (survive the rolled-back operation) ------
create table if not exists public.financial_failure_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id),
  session_id uuid references public.call_sessions(id),
  operation text not null,
  account_id uuid,
  counterparty_account_id uuid,
  amount numeric(20,4),
  currency_code text,
  reason_category text not null,
  channel text not null default 'VOICE',
  idempotency_key text,
  created_at timestamptz not null default now()
);

create index if not exists idx_fin_failures_tenant on public.financial_failure_events (tenant_id, created_at desc);

grant select on public.financial_failure_events to authenticated;
grant all on public.financial_failure_events to service_role;
alter table public.financial_failure_events enable row level security;

create policy "platform admins read financial failures"
  on public.financial_failure_events for select to authenticated
  using (public.is_super_admin());

create policy "organization admins read own financial failures"
  on public.financial_failure_events for select to authenticated
  using (tenant_id = public.current_user_tenant_id());

-- 4. Short lived transfer grant: the only way a voice call reaches the
--    existing engine. No client role can read or write this table.
create table if not exists public.call_transfer_grants (
  nonce text primary key,
  session_id uuid not null references public.call_sessions(id),
  account_id uuid not null references public.customer_accounts(id),
  created_at timestamptz not null default now()
);
revoke all on public.call_transfer_grants from public, anon, authenticated;
grant all on public.call_transfer_grants to service_role;
alter table public.call_transfer_grants enable row level security;

create or replace function public.cv_voice_grant_valid(_account_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare n text;
begin
  n := current_setting('app.voice_grant', true);
  if n is null or n = '' then return false; end if;
  return exists (
    select 1 from public.call_transfer_grants g
     where g.nonce = n and g.account_id = _account_id
       and g.created_at > now() - interval '2 minutes'
  );
end; $$;
revoke all on function public.cv_voice_grant_valid(uuid) from public, anon, authenticated;
grant execute on function public.cv_voice_grant_valid(uuid) to service_role;

-- 5. Financial engine: accept a verified voice caller as an authorised
--    principal for their OWN account. The engine keeps every other rule.
create or replace function public.execute_transfer(
  _sender_account_id uuid, _recipient_account_id uuid, _amount numeric,
  _description text default null, _idempotency_key text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare s public.customer_accounts%rowtype; r public.customer_accounts%rowtype;
        first_id uuid; second_id uuid;
        sl uuid; rl uuid; txid uuid; trid uuid; sbal numeric; rbal numeric; ref text; prior uuid;
begin
  if _amount is null or _amount <= 0 then raise exception 'Amount must be positive'; end if;
  if _sender_account_id = _recipient_account_id then raise exception 'Cannot transfer to the same account'; end if;

  first_id := least(_sender_account_id, _recipient_account_id);
  second_id := greatest(_sender_account_id, _recipient_account_id);
  perform 1 from public.customer_accounts where id = first_id for update;
  perform 1 from public.customer_accounts where id = second_id for update;
  select * into s from public.customer_accounts where id = _sender_account_id;
  select * into r from public.customer_accounts where id = _recipient_account_id;
  if s.id is null or r.id is null then raise exception 'Account not found'; end if;
  if s.tenant_id <> r.tenant_id then raise exception 'Cross-organization transfers are not allowed'; end if;

  if not (
       (s.tenant_id = public.current_user_tenant_id()
        and public.current_user_role() in ('TENANT_ADMIN','CUSTOMER'))
    or public.cv_voice_grant_valid(_sender_account_id)
  ) then
    raise exception 'Not authorised for this organization';
  end if;
  perform public.assert_tenant_operational(s.tenant_id);
  if s.currency_code <> r.currency_code then raise exception 'Currency mismatch'; end if;
  if s.status <> 'ACTIVE' or r.status <> 'ACTIVE' then raise exception 'Both accounts must be active'; end if;
  if s.balance < _amount then raise exception 'Insufficient available credit'; end if;

  prior := public.claim_idempotency(s.tenant_id, _idempotency_key, 'execute_transfer');
  if prior is not null then return prior; end if;

  ref := 'TRF-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
  perform set_config('app.ledger_posting','on', true);
  insert into public.transfers (tenant_id, sender_account_id, recipient_account_id, amount,
                                currency_code, status, reference, initiated_by, idempotency_key)
  values (s.tenant_id, s.id, r.id, _amount, s.currency_code, 'PROCESSING', ref, auth.uid(), _idempotency_key)
  returning id into trid;

  insert into public.audit_logs (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, metadata)
  values (s.tenant_id, auth.uid(), public.current_user_role(), 'TRANSFER_INITIATED','transfer',trid,
          jsonb_build_object('amount',_amount,'reference',ref));

  sl := public.ensure_ledger_account(s.id);
  rl := public.ensure_ledger_account(r.id);
  sbal := s.balance - _amount;
  rbal := r.balance + _amount;

  insert into public.transactions (tenant_id, type, status, amount, currency_code, reference, description,
                                   account_id, counterparty_account_id, created_by, idempotency_key)
  values (s.tenant_id, 'TRANSFER','COMPLETED', _amount, s.currency_code, 'TX-' || substr(ref,5),
          _description, s.id, r.id, auth.uid(), _idempotency_key)
  returning id into txid;

  insert into public.ledger_entries (tenant_id, transaction_id, ledger_account_id, direction, amount, currency_code, balance_after)
  values (s.tenant_id, txid, sl, 'DEBIT', _amount, s.currency_code, sbal),
         (s.tenant_id, txid, rl, 'CREDIT', _amount, s.currency_code, rbal);

  update public.customer_accounts set balance = sbal where id = s.id;
  update public.customer_accounts set balance = rbal where id = r.id;
  update public.ledger_accounts set balance = sbal where id = sl;
  update public.ledger_accounts set balance = rbal where id = rl;
  update public.transfers set status = 'COMPLETED', transaction_id = txid, completed_at = now() where id = trid;
  perform set_config('app.ledger_posting','off', true);

  if _idempotency_key is not null and _idempotency_key <> '' then
    update public.financial_idempotency set result_id = trid
      where tenant_id = s.tenant_id and idempotency_key = _idempotency_key;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, metadata)
  values (s.tenant_id, auth.uid(), public.current_user_role(), 'TRANSFER_COMPLETED','transfer',trid,
          jsonb_build_object('amount',_amount,'reference',ref,'transaction_id',txid));
  return trid;
end; $$;

-- 6. IVR position ------------------------------------------------------
create or replace function public.cv_ivr_state(_session_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.call_sessions%rowtype;
begin
  s := public.cv_load_live_session(_session_id);
  return jsonb_build_object(
    'session_id', s.id, 'state', s.state::text, 'stage', s.authentication_stage::text,
    'ivr_state', s.ivr_state, 'ivr_retries', s.ivr_retries,
    'tenant_id', s.tenant_id, 'account_id', s.account_id,
    'pending_recipient_account_id', s.pending_recipient_account_id,
    'pending_amount', s.pending_amount, 'pending_transfer_key', s.pending_transfer_key
  );
end; $$;

create or replace function public.cv_ivr_set_state(_session_id uuid, _ivr_state text, _retries integer default 0)
returns void language plpgsql security definer set search_path = public as $$
begin
  if _ivr_state is null or length(_ivr_state) > 40 then raise exception 'Invalid IVR state'; end if;
  update public.call_sessions
     set ivr_state = _ivr_state, ivr_retries = greatest(coalesce(_retries,0),0), last_activity_at = now()
   where id = _session_id;
end; $$;

create or replace function public.cv_find_call_session(_provider text, _provider_call_id text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.call_sessions
   where provider = _provider and provider_call_id = _provider_call_id
     and state not in ('ENDED','COMPLETED')
   order by created_at desc limit 1;
$$;

create or replace function public.cv_ivr_config(_tenant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare i public.ivr_settings%rowtype; t public.tenants%rowtype;
begin
  select * into t from public.tenants where id = _tenant_id;
  select * into i from public.ivr_settings where tenant_id = _tenant_id;
  return jsonb_build_object(
    'organization_name', coalesce(t.name, 'CreditVoice'),
    'currency_code', t.currency_code,
    'language', coalesce(i.language, 'en-US'),
    'voice', coalesce(i.voice, 'alice'),
    'max_input_retries', coalesce(i.max_input_retries, 3),
    'gather_timeout_seconds', coalesce(i.gather_timeout_seconds, 6),
    'welcome_message', i.welcome_message,
    'menu_message', i.menu_message,
    'transfers_enabled', coalesce(i.transfers_enabled, true),
    'balance_enquiry_enabled', coalesce(i.balance_enquiry_enabled, true),
    'recording_enabled', coalesce(i.recording_enabled, false)
  );
end; $$;

-- 7. Transfer preparation: recipient + amount validated before anything
create or replace function public.cv_prepare_transfer(
  _session_id uuid, _recipient_account_number text, _amount_minor bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.call_sessions%rowtype; src public.customer_accounts%rowtype;
        r public.customer_accounts%rowtype; c public.customers%rowtype; dp integer; amt numeric;
begin
  s := public.cv_load_live_session(_session_id);
  if s.state <> 'AUTHENTICATED' then
    return jsonb_build_object('ok', false, 'reason', 'SESSION_EXPIRED');
  end if;
  select * into src from public.customer_accounts where id = s.account_id;
  if src.id is null or src.status <> 'ACTIVE' then
    return jsonb_build_object('ok', false, 'reason', 'ACCOUNT_UNAVAILABLE');
  end if;

  select * into r from public.customer_accounts
   where tenant_id = s.tenant_id and account_number = trim(coalesce(_recipient_account_number,''));
  if r.id is null or r.status <> 'ACTIVE' or r.id = src.id then
    return jsonb_build_object('ok', false, 'reason', 'RECIPIENT_UNAVAILABLE');
  end if;
  select * into c from public.customers where id = r.customer_id;
  if c.id is null or c.status <> 'ACTIVE' then
    return jsonb_build_object('ok', false, 'reason', 'RECIPIENT_UNAVAILABLE');
  end if;
  if r.currency_code <> src.currency_code then
    return jsonb_build_object('ok', false, 'reason', 'CURRENCY_MISMATCH');
  end if;

  select decimal_places into dp from public.currencies where code = src.currency_code;
  if dp is null then return jsonb_build_object('ok', false, 'reason', 'CURRENCY_UNAVAILABLE'); end if;
  if _amount_minor is null or _amount_minor <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'INVALID_AMOUNT');
  end if;
  amt := _amount_minor::numeric / power(10::numeric, dp);

  update public.call_sessions
     set pending_recipient_account_id = r.id,
         pending_amount = amt,
         pending_transfer_key = gen_random_uuid()::text,
         last_activity_at = now()
   where id = s.id;

  perform public.cv_audit(s.tenant_id, 'TRANSFER_REQUESTED', s.id,
    jsonb_build_object('amount', amt, 'currency', src.currency_code,
                       'recipient_reference', right(r.account_number, 4)));

  return jsonb_build_object('ok', true, 'amount', amt, 'currency_code', src.currency_code,
                            'decimal_places', dp, 'recipient_reference', right(r.account_number, 4));
end; $$;

create or replace function public.cv_cancel_transfer(_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.call_sessions%rowtype;
begin
  select * into s from public.call_sessions where id = _session_id;
  if not found then return; end if;
  update public.call_sessions
     set pending_recipient_account_id = null, pending_amount = null, pending_transfer_key = null,
         last_activity_at = now()
   where id = _session_id;
  perform public.cv_audit(s.tenant_id, 'TRANSFER_CANCELLED', s.id, '{}'::jsonb);
end; $$;

-- 8. Execute through the EXISTING engine; record failures durably ------
create or replace function public.cv_execute_voice_transfer(_session_id uuid, _idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.call_sessions%rowtype; src public.customer_accounts%rowtype; nonce text; trid uuid; cat text;
begin
  s := public.cv_load_live_session(_session_id);
  if s.state <> 'AUTHENTICATED' then
    return jsonb_build_object('ok', false, 'reason', 'SESSION_EXPIRED');
  end if;
  if s.pending_recipient_account_id is null or s.pending_amount is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_PENDING_TRANSFER');
  end if;
  if _idempotency_key is null or _idempotency_key = '' then
    return jsonb_build_object('ok', false, 'reason', 'INVALID_REQUEST');
  end if;
  select * into src from public.customer_accounts where id = s.account_id;

  nonce := gen_random_uuid()::text;
  insert into public.call_transfer_grants (nonce, session_id, account_id) values (nonce, s.id, s.account_id);
  perform set_config('app.voice_grant', nonce, true);

  begin
    trid := public.execute_transfer(s.account_id, s.pending_recipient_account_id,
                                    s.pending_amount, 'Voice transfer', _idempotency_key);
  exception when others then
    cat := case
      when sqlerrm ilike '%insufficient%' then 'INSUFFICIENT_CREDIT'
      when sqlerrm ilike '%currency%'     then 'CURRENCY_MISMATCH'
      when sqlerrm ilike '%active%'       then 'ACCOUNT_UNAVAILABLE'
      when sqlerrm ilike '%authoris%'     then 'NOT_AUTHORIZED'
      else 'TRANSFER_FAILED' end;
    insert into public.financial_failure_events
      (tenant_id, session_id, operation, account_id, counterparty_account_id, amount,
       currency_code, reason_category, channel, idempotency_key)
    values (s.tenant_id, s.id, 'execute_transfer', s.account_id, s.pending_recipient_account_id,
            s.pending_amount, src.currency_code, cat, 'VOICE', _idempotency_key);
    perform public.cv_audit(s.tenant_id, 'TRANSFER_FAILED', s.id, jsonb_build_object('reason', cat));
    update public.call_sessions
       set pending_recipient_account_id = null, pending_amount = null, pending_transfer_key = null,
           last_activity_at = now()
     where id = s.id;
    return jsonb_build_object('ok', false, 'reason', cat);
  end;

  delete from public.call_transfer_grants where nonce = nonce;
  perform public.cv_audit(s.tenant_id, 'TRANSFER_CONFIRMED', s.id,
    jsonb_build_object('transfer_id', trid, 'amount', s.pending_amount));
  update public.call_sessions
     set pending_recipient_account_id = null, pending_amount = null, pending_transfer_key = null,
         last_activity_at = now()
   where id = s.id;
  return jsonb_build_object('ok', true, 'transfer_id', trid);
end; $$;

-- 9. Customer care routing -------------------------------------------
create or replace function public.cv_customer_care_route(_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.call_sessions%rowtype; cc public.customer_care_settings%rowtype;
        local_now time; in_hours boolean; mode text; dest text;
begin
  select * into s from public.call_sessions where id = _session_id;
  if not found or s.tenant_id is null then
    return jsonb_build_object('available', false, 'reason', 'CUSTOMER_CARE_UNAVAILABLE');
  end if;
  select * into cc from public.customer_care_settings where tenant_id = s.tenant_id;
  if cc.tenant_id is null or not cc.enabled then
    return jsonb_build_object('available', false, 'reason', 'CUSTOMER_CARE_UNAVAILABLE');
  end if;

  begin
    local_now := (now() at time zone coalesce(cc.timezone, 'UTC'))::time;
  exception when others then
    local_now := (now() at time zone 'UTC')::time;
  end;

  if cc.business_hours_start <= cc.business_hours_end then
    in_hours := local_now >= cc.business_hours_start and local_now < cc.business_hours_end;
  else
    in_hours := local_now >= cc.business_hours_start or local_now < cc.business_hours_end;
  end if;

  mode := case when in_hours then cc.routing_mode::text else cc.after_hours_mode::text end;
  dest := coalesce(cc.primary_number, cc.backup_number);

  if mode = 'VOICEMAIL' or mode = 'QUEUE' then
    if not coalesce(cc.voicemail_enabled, false) then
      return jsonb_build_object('available', false, 'reason', 'CUSTOMER_CARE_UNAVAILABLE',
                                'in_hours', in_hours);
    end if;
    return jsonb_build_object('available', true, 'action', 'VOICEMAIL', 'in_hours', in_hours, 'mode', mode);
  end if;

  if dest is null then
    if coalesce(cc.voicemail_enabled, false) then
      return jsonb_build_object('available', true, 'action', 'VOICEMAIL', 'in_hours', in_hours, 'mode', mode);
    end if;
    return jsonb_build_object('available', false, 'reason', 'CUSTOMER_CARE_UNAVAILABLE', 'in_hours', in_hours);
  end if;

  return jsonb_build_object('available', true, 'action', 'DIAL', 'destination', dest,
                            'backup', cc.backup_number, 'in_hours', in_hours, 'mode', mode);
end; $$;

-- 10. Grants for all new engine functions -----------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('cv_ivr_state','cv_ivr_set_state','cv_find_call_session','cv_ivr_config',
                         'cv_prepare_transfer','cv_cancel_transfer','cv_execute_voice_transfer',
                         'cv_customer_care_route')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
    execute format('grant execute on function %s to sandbox_exec', f.sig);
  end loop;
end $$;

-- 11. Sandbox-only test helpers ---------------------------------------
create or replace function public.cv_test_fund_account(_account_id uuid, _amount numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if session_user <> 'sandbox_exec' then raise exception 'Test helper is not available'; end if;
  if not exists (select 1 from public.customer_accounts a join public.tenants t on t.id = a.tenant_id
                  where a.id = _account_id and t.name like 'QA %') then
    raise exception 'Test helper refuses non-QA data';
  end if;
  perform set_config('app.ledger_posting','on', true);
  update public.customer_accounts set balance = _amount where id = _account_id;
  perform set_config('app.ledger_posting','off', true);
end; $$;

create or replace function public.cv_test_add_account(_tenant_id uuid, _name text, _currency text default 'NGN')
returns jsonb language plpgsql security definer set search_path = public as $$
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
end; $$;

create or replace function public.cv_test_set_care(_tenant_id uuid, _settings jsonb)
returns void language plpgsql security definer set search_path = public as $$
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
end; $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('cv_test_fund_account','cv_test_add_account','cv_test_set_care')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to sandbox_exec', f.sig);
  end loop;
end $$;

grant select on public.financial_failure_events to sandbox_exec;
grant select on public.call_transfer_grants to sandbox_exec;
