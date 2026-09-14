do $$
begin
  if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
    execute 'grant execute on function public.allocate_account_number(uuid) to sandbox_exec';
  end if;
end $$;