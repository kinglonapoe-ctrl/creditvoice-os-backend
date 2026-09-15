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
    delete from public.call_transfer_grants g where g.nonce = v_nonce;
    perform set_config('app.voice_grant', '', true);
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
  perform set_config('app.voice_grant', '', true);
  perform public.cv_audit(s.tenant_id, 'TRANSFER_CONFIRMED', s.id,
    jsonb_build_object('transfer_id', trid, 'amount', s.pending_amount));
  update public.call_sessions
     set pending_recipient_account_id = null, pending_amount = null, pending_transfer_key = null,
         pending_recipient_input = null, last_activity_at = now()
   where id = s.id;
  return jsonb_build_object('ok', true, 'transfer_id', trid);
end; $$;

revoke all on function public.cv_execute_voice_transfer(uuid, text) from public, anon, authenticated;
grant execute on function public.cv_execute_voice_transfer(uuid, text) to service_role;
grant execute on function public.cv_execute_voice_transfer(uuid, text) to sandbox_exec;