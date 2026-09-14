create or replace function public.guard_tenant_currency()
returns trigger
language plpgsql
set search_path to 'public'
as $fn$
begin
  -- Trusted server-side contexts (service role / database owner) are the
  -- platform authority; signed-in app roles must be a platform administrator.
  if current_user in ('service_role','postgres','supabase_admin') then
    return new;
  end if;
  if not public.is_super_admin() then
    if new.currency_code is distinct from old.currency_code
       or new.currency_approved is distinct from old.currency_approved
       or new.status is distinct from old.status then
      raise exception 'Only platform administrators may change currency or status';
    end if;
  end if;
  return new;
end;
$fn$;