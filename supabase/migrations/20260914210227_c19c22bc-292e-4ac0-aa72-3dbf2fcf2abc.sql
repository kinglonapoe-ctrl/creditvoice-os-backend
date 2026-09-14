do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname in ('current_user_role','current_user_tenant_id','is_super_admin',
                     'post_credit','execute_transfer','reverse_transfer') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;