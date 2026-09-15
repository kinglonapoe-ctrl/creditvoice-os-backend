create or replace function public.cv_test_rotate_access_code(_tenant_id uuid, _new_hash text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare nm text; nid uuid;
begin
  if session_user <> 'sandbox_exec' then raise exception 'Test helper is not available'; end if;
  select name into nm from public.tenants where id = _tenant_id;
  if nm is null or nm not like 'QA %' then raise exception 'Refusing to modify a non-test organization'; end if;
  update public.tenant_access_codes set is_active = false, retired_at = now()
   where tenant_id = _tenant_id and is_active;
  insert into public.tenant_access_codes (tenant_id, code_hash) values (_tenant_id, _new_hash) returning id into nid;
  return nid;
end; $$;

create or replace function public.cv_test_seed_caller_failures(_from_number text, _count integer)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if session_user <> 'sandbox_exec' then raise exception 'Test helper is not available'; end if;
  insert into public.call_auth_failures (from_number, stage, reason)
  select _from_number, 'PIN', 'INVALID_CREDENTIAL' from generate_series(1, greatest(_count, 0));
end; $$;

-- Reports attempt/lockout state only. Never returns a stored credential.
create or replace function public.cv_test_credential_state(_kind text, _id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r jsonb;
begin
  if session_user <> 'sandbox_exec' then raise exception 'Test helper is not available'; end if;
  if _kind = 'PIN' then
    select jsonb_build_object('failed_attempts', failed_attempts, 'locked', locked_until is not null and locked_until > now())
      into r from public.customer_pins where customer_id = _id;
  elsif _kind = 'ACCESS_CODE_BY_ID' then
    select jsonb_build_object('failed_attempts', failed_attempts, 'locked', locked_until is not null and locked_until > now(),
                              'is_active', is_active)
      into r from public.tenant_access_codes where id = _id;
  else
    select jsonb_build_object('active_codes', count(*)) into r
      from public.tenant_access_codes where tenant_id = _id and is_active and retired_at is null;
  end if;
  return coalesce(r, '{}'::jsonb);
end; $$;

revoke all on function public.cv_test_rotate_access_code(uuid, text) from public, anon, authenticated;
revoke all on function public.cv_test_seed_caller_failures(text, integer) from public, anon, authenticated;
revoke all on function public.cv_test_credential_state(text, uuid) from public, anon, authenticated;
grant execute on function public.cv_test_rotate_access_code(uuid, text) to sandbox_exec;
grant execute on function public.cv_test_seed_caller_failures(text, integer) to sandbox_exec;
grant execute on function public.cv_test_credential_state(text, uuid) to sandbox_exec;