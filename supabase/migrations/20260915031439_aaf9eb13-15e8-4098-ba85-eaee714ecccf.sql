create or replace function public.cv_test_set_tenant_status(_tenant_id uuid, _status public.tenant_status)
returns void language plpgsql security definer set search_path to 'public' as $$
declare nm text;
begin
  if session_user <> 'sandbox_exec' then
    raise exception 'Test helper is not available';
  end if;
  select name into nm from public.tenants where id = _tenant_id;
  if nm is null or nm not like 'QA %' then
    raise exception 'Refusing to modify a non-test organization';
  end if;
  set local session_replication_role = 'replica';
  update public.tenants set status = _status where id = _tenant_id;
  set local session_replication_role = 'origin';
end; $$;
revoke all on function public.cv_test_set_tenant_status(uuid, public.tenant_status) from public, anon, authenticated;
grant execute on function public.cv_test_set_tenant_status(uuid, public.tenant_status) to sandbox_exec;