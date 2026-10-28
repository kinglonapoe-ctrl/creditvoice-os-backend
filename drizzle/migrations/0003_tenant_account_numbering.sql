-- Tenant-controlled account numbering (additive, backward compatible).
CREATE TABLE IF NOT EXISTS public.tenant_account_number_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'MANUAL',
  min_length integer NOT NULL DEFAULT 5,
  max_length integer NOT NULL DEFAULT 10,
  format text NOT NULL DEFAULT 'DIGITS',
  pad_length integer,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_numbering_mode CHECK (mode IN ('MANUAL','AUTOMATIC')),
  CONSTRAINT chk_numbering_format CHECK (format IN ('DIGITS')),
  CONSTRAINT chk_numbering_lengths CHECK (min_length BETWEEN 1 AND 20 AND max_length BETWEEN min_length AND 20),
  CONSTRAINT chk_numbering_pad CHECK (pad_length IS NULL OR pad_length BETWEEN min_length AND max_length)
);

GRANT SELECT ON public.tenant_account_number_settings TO authenticated;
GRANT ALL ON public.tenant_account_number_settings TO service_role;
ALTER TABLE public.tenant_account_number_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "numbering settings tenant read" ON public.tenant_account_number_settings
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR tenant_id = public.current_user_tenant_id());

-- Existing organizations keep automatic 5-digit numbering exactly as today.
INSERT INTO public.tenant_account_number_settings (tenant_id, mode, min_length, max_length)
SELECT id, 'AUTOMATIC', 5, 5 FROM public.tenants
ON CONFLICT (tenant_id) DO NOTHING;

-- New organizations default to manual assignment.
CREATE OR REPLACE FUNCTION public.create_default_numbering_settings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  insert into public.tenant_account_number_settings (tenant_id) values (new.id)
  on conflict (tenant_id) do nothing;
  return new;
end; $$;
REVOKE ALL ON FUNCTION public.create_default_numbering_settings() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER t_tenant_numbering_defaults AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.create_default_numbering_settings();

-- Shared rule check (missing settings row => permissive legacy 1..20 digits).
CREATE OR REPLACE FUNCTION public.account_number_matches_rules(_tenant_id uuid, _number text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
declare cfg public.tenant_account_number_settings%rowtype;
begin
  if _number is null then return false; end if;
  select * into cfg from public.tenant_account_number_settings where tenant_id = _tenant_id;
  if not found then return _number ~ '^[0-9]{1,20}$'; end if;
  return _number ~ '^[0-9]+$'
     and length(_number) between cfg.min_length and cfg.max_length;
end; $$;
REVOKE ALL ON FUNCTION public.account_number_matches_rules(uuid, text) FROM PUBLIC, anon, authenticated;

-- Allocator: same row-locked sequence; skips numbers already taken; honours length/padding.
CREATE OR REPLACE FUNCTION public.allocate_account_number(_tenant_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare n bigint; cand text; cfg public.tenant_account_number_settings%rowtype; tries int := 0;
begin
  select * into cfg from public.tenant_account_number_settings where tenant_id = _tenant_id;
  insert into public.tenant_account_sequences (tenant_id, next_number)
  values (_tenant_id, 10001) on conflict (tenant_id) do nothing;

  loop
    tries := tries + 1;
    if tries > 100000 then raise exception 'Unable to allocate an account number'; end if;
    update public.tenant_account_sequences
       set next_number = next_number + 1, updated_at = now()
     where tenant_id = _tenant_id
    returning next_number - 1 into n;

    cand := n::text;
    if found and cfg.tenant_id is not null then
      if cfg.pad_length is not null then
        cand := lpad(cand, cfg.pad_length, '0');
      elsif length(cand) < cfg.min_length then
        -- jump the sequence to the first number with the required length
        update public.tenant_account_sequences
           set next_number = (10::bigint ^ (cfg.min_length - 1))::bigint + 1
         where tenant_id = _tenant_id;
        cand := ((10::bigint ^ (cfg.min_length - 1))::bigint)::text;
      end if;
      if length(cand) > cfg.max_length then
        raise exception 'Automatic numbering range is exhausted for this organization';
      end if;
    end if;

    exit when not exists (select 1 from public.customer_accounts
                           where tenant_id = _tenant_id and account_number = cand);
  end loop;
  return cand;
end; $$;
REVOKE ALL ON FUNCTION public.allocate_account_number(uuid) FROM PUBLIC, anon, authenticated;

-- Assignment: never silently replace an entered number.
CREATE OR REPLACE FUNCTION public.assign_account_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare cfg public.tenant_account_number_settings%rowtype; caller_role public.app_role;
begin
  if not exists (select 1 from public.customers where id = new.customer_id and tenant_id = new.tenant_id) then
    raise exception 'Customer does not belong to this organization';
  end if;

  caller_role := public.current_user_role();
  select * into cfg from public.tenant_account_number_settings where tenant_id = new.tenant_id;
  new.account_number := nullif(trim(coalesce(new.account_number, '')), '');

  if new.account_number is null then
    if caller_role = 'TENANT_ADMIN' and coalesce(cfg.mode, 'AUTOMATIC') = 'MANUAL' then
      raise exception 'An account number is required for this organization';
    end if;
    new.account_number := public.allocate_account_number(new.tenant_id);
  else
    if not public.account_number_matches_rules(new.tenant_id, new.account_number) then
      raise exception 'Account number must be % to % digits', coalesce(cfg.min_length, 1), coalesce(cfg.max_length, 20);
    end if;
    if exists (select 1 from public.customer_accounts
                where tenant_id = new.tenant_id and account_number = new.account_number) then
      raise exception 'Account number is already in use in this organization';
    end if;
  end if;
  return new;
end; $$;
REVOKE ALL ON FUNCTION public.assign_account_number() FROM PUBLIC, anon, authenticated;

-- Authorized, audited settings change.
CREATE OR REPLACE FUNCTION public.set_account_numbering_settings(
  _tenant_id uuid, _mode text, _min_length integer, _max_length integer, _pad_length integer DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare r record; bad integer; old jsonb;
begin
  select role, tenant_id into r from public.current_user_role_tenant();
  if not (public.is_super_admin() or (r.role = 'TENANT_ADMIN' and r.tenant_id = _tenant_id)) then
    raise exception 'Not authorized to change numbering for this organization';
  end if;
  if _mode not in ('MANUAL','AUTOMATIC') then raise exception 'Invalid numbering mode'; end if;
  if _min_length is null or _max_length is null or _min_length < 1 or _max_length > 20 or _min_length > _max_length then
    raise exception 'Lengths must satisfy 1 <= minimum <= maximum <= 20';
  end if;
  if _pad_length is not null and (_pad_length < _min_length or _pad_length > _max_length) then
    raise exception 'Padding length must be between the minimum and maximum';
  end if;
  select count(*) into bad from public.customer_accounts
   where tenant_id = _tenant_id
     and not (account_number ~ '^[0-9]+$' and length(account_number) between _min_length and _max_length);
  if bad > 0 then
    raise exception '% existing account number(s) would not fit these rules', bad;
  end if;

  select to_jsonb(s) - 'updated_by' into old from public.tenant_account_number_settings s where tenant_id = _tenant_id;
  insert into public.tenant_account_number_settings (tenant_id, mode, min_length, max_length, pad_length, updated_by, updated_at)
  values (_tenant_id, _mode, _min_length, _max_length, _pad_length, auth.uid(), now())
  on conflict (tenant_id) do update
    set mode = excluded.mode, min_length = excluded.min_length, max_length = excluded.max_length,
        pad_length = excluded.pad_length, updated_by = excluded.updated_by, updated_at = now();

  insert into public.audit_logs (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, metadata)
  values (_tenant_id, auth.uid(), r.role, 'ACCOUNT_NUMBERING_UPDATED', 'tenant', _tenant_id,
          jsonb_build_object('before', old, 'after', jsonb_build_object('mode', _mode, 'min_length', _min_length,
            'max_length', _max_length, 'pad_length', _pad_length)));
end; $$;
REVOKE ALL ON FUNCTION public.set_account_numbering_settings(uuid, text, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_account_numbering_settings(uuid, text, integer, integer, integer) TO authenticated;

-- IVR: expose numbering rules to the voice engine.
CREATE OR REPLACE FUNCTION public.cv_ivr_config(_tenant_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare i public.ivr_settings%rowtype; t public.tenants%rowtype; n public.tenant_account_number_settings%rowtype;
begin
  select * into t from public.tenants where id = _tenant_id;
  select * into i from public.ivr_settings where tenant_id = _tenant_id;
  select * into n from public.tenant_account_number_settings where tenant_id = _tenant_id;
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
    'recording_enabled', coalesce(i.recording_enabled, false),
    'account_number_min_length', coalesce(n.min_length, 1),
    'account_number_max_length', coalesce(n.max_length, 20)
  );
end; $function$;

-- IVR account identification: format check before lookup, same failure path (attempt counted).
CREATE OR REPLACE FUNCTION public.cv_identify_account(_session_id uuid, _account_number text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare s public.call_sessions%rowtype; a public.customer_accounts%rowtype; cust public.customers%rowtype; maxs integer;
begin
  s := public.cv_load_live_session(_session_id);
  if s.state <> 'ACCESS_CODE_VERIFIED' then return jsonb_build_object('ok', false, 'status', s.state::text); end if;
  maxs := public.cv_setting_int('call_max_session_attempts', 9);

  if public.account_number_matches_rules(s.tenant_id, _account_number) then
    select * into a from public.customer_accounts
     where tenant_id = s.tenant_id and account_number = _account_number and status = 'ACTIVE';
    if found then
      select * into cust from public.customers where id = a.customer_id and status = 'ACTIVE';
    end if;
  end if;

  if a.id is null or cust.id is null then
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
end; $function$;

CREATE OR REPLACE FUNCTION public.cv_prepare_transfer(_session_id uuid, _recipient_account_number text, _amount_minor bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if not public.account_number_matches_rules(s.tenant_id, trim(coalesce(_recipient_account_number,''))) then
    return jsonb_build_object('ok', false, 'reason', 'RECIPIENT_UNAVAILABLE');
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
end; $function$;