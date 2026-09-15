alter table public.call_sessions
  add column if not exists pending_recipient_input text;

create or replace function public.cv_ivr_set_recipient(_session_id uuid, _recipient text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if _recipient is null or length(_recipient) > 40 then raise exception 'Invalid recipient input'; end if;
  update public.call_sessions
     set pending_recipient_input = _recipient, last_activity_at = now()
   where id = _session_id;
end; $$;

create or replace function public.cv_ivr_state(_session_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.call_sessions%rowtype;
begin
  s := public.cv_load_live_session(_session_id);
  return jsonb_build_object(
    'session_id', s.id, 'state', s.state::text, 'stage', s.authentication_stage::text,
    'ivr_state', s.ivr_state, 'ivr_retries', s.ivr_retries,
    'tenant_id', s.tenant_id, 'account_id', s.account_id,
    'pending_recipient_input', s.pending_recipient_input,
    'pending_recipient_account_id', s.pending_recipient_account_id,
    'pending_amount', s.pending_amount, 'pending_transfer_key', s.pending_transfer_key
  );
end; $$;

create or replace function public.cv_cancel_transfer(_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.call_sessions%rowtype;
begin
  select * into s from public.call_sessions where id = _session_id;
  if not found then return; end if;
  update public.call_sessions
     set pending_recipient_account_id = null, pending_amount = null, pending_transfer_key = null,
         pending_recipient_input = null, last_activity_at = now()
   where id = _session_id;
  perform public.cv_audit(s.tenant_id, 'TRANSFER_CANCELLED', s.id, '{}'::jsonb);
end; $$;

create or replace function public.cv_execute_voice_transfer(_session_id uuid, _idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.call_sessions%rowtype; src public.customer_accounts%rowtype;
        v_nonce text; trid uuid; cat text;
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

  v_nonce := gen_random_uuid()::text;
  insert into public.call_transfer_grants (nonce, session_id, account_id) values (v_nonce, s.id, s.account_id);
  perform set_config('app.voice_grant', v_nonce, true);

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
           pending_recipient_input = null, last_activity_at = now()
     where id = s.id;
    return jsonb_build_object('ok', false, 'reason', cat);
  end;

  delete from public.call_transfer_grants g where g.nonce = v_nonce;
  perform public.cv_audit(s.tenant_id, 'TRANSFER_CONFIRMED', s.id,
    jsonb_build_object('transfer_id', trid, 'amount', s.pending_amount));
  update public.call_sessions
     set pending_recipient_account_id = null, pending_amount = null, pending_transfer_key = null,
         pending_recipient_input = null, last_activity_at = now()
   where id = s.id;
  return jsonb_build_object('ok', true, 'transfer_id', trid);
end; $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('cv_ivr_state','cv_cancel_transfer','cv_execute_voice_transfer','cv_ivr_set_recipient')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
    execute format('grant execute on function %s to sandbox_exec', f.sig);
  end loop;
end $$;

-- Explicit deny-all so the table is policed, not merely unpoliced.
drop policy if exists "no client access to transfer grants" on public.call_transfer_grants;
create policy "no client access to transfer grants"
  on public.call_transfer_grants for select to authenticated using (false);
