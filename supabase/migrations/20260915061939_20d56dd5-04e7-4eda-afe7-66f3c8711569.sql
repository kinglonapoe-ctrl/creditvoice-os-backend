alter table public.call_sessions
  add column if not exists last_event_fingerprint text,
  add column if not exists last_response text,
  add column if not exists turn_no integer not null default 0;

create or replace function public.cv_ivr_claim_turn(_session_id uuid, _fingerprint text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.call_sessions%rowtype;
begin
  if _fingerprint is null or length(_fingerprint) > 200 then
    raise exception 'Invalid turn fingerprint';
  end if;
  s := public.cv_load_live_session(_session_id);

  if s.last_event_fingerprint is not null and s.last_event_fingerprint = _fingerprint then
    perform public.cv_audit(s.tenant_id, 'TWILIO_EVENT_REPLAY_REJECTED', s.id,
      jsonb_build_object('turn', s.turn_no));
    return jsonb_build_object('replay', true, 'cached', s.last_response, 'turn', s.turn_no);
  end if;

  update public.call_sessions
     set last_event_fingerprint = _fingerprint,
         last_response = null,
         turn_no = turn_no + 1,
         last_activity_at = now()
   where id = s.id
   returning turn_no into s.turn_no;

  return jsonb_build_object('replay', false, 'turn', s.turn_no);
end; $$;

create or replace function public.cv_ivr_store_response(_session_id uuid, _response text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if _response is null or length(_response) > 20000 then return; end if;
  update public.call_sessions set last_response = _response where id = _session_id;
end; $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('cv_ivr_claim_turn','cv_ivr_store_response')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
    execute format('grant execute on function %s to sandbox_exec', f.sig);
  end loop;
end $$;