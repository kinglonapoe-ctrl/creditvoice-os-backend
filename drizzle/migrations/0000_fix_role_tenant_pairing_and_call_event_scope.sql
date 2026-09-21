-- 1. Resolve role and tenant from ONE user_roles row (prevents cross-tenant escalation)
create or replace function public.current_user_role_tenant()
returns table (role app_role, tenant_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $$
  select ur.role, ur.tenant_id
  from public.user_roles ur
  where ur.user_id = auth.uid()
  order by case ur.role
             when 'SUPER_ADMIN' then 1
             when 'TENANT_ADMIN' then 2
             else 3
           end,
           (ur.tenant_id is null),
           ur.created_at,
           ur.id
  limit 1;
$$;

create or replace function public.current_user_role()
returns app_role
language sql
stable
security definer
set search_path to 'public'
as $$
  select role from public.current_user_role_tenant();
$$;

create or replace function public.current_user_tenant_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select tenant_id from public.current_user_role_tenant();
$$;

-- 2. Tenant-scoped read access for call session events (fail-closed join on call_sessions)
drop policy if exists "Organization admins read their call events" on public.call_session_events;
create policy "Organization admins read their call events"
on public.call_session_events
for select
to authenticated
using (
  exists (
    select 1
    from public.call_sessions cs
    where cs.id = call_session_events.session_id
      and cs.tenant_id is not null
      and cs.tenant_id = public.current_user_tenant_id()
  )
);

-- 3. Tighten EXECUTE on SECURITY DEFINER functions
revoke execute on function public.current_user_role_tenant() from public, anon;
revoke execute on function public.current_user_role() from public, anon;
revoke execute on function public.current_user_tenant_id() from public, anon;
revoke execute on function public.is_super_admin() from public, anon;
revoke execute on function public.has_role(uuid, app_role) from public, anon;

grant execute on function public.current_user_role_tenant() to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_user_tenant_id() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.has_role(uuid, app_role) to authenticated;

-- Money-moving routines: never reachable anonymously; they enforce role checks internally
revoke execute on function public.post_credit(uuid, numeric, transaction_type, text, text) from public, anon;
revoke execute on function public.execute_transfer(uuid, uuid, numeric, text, text) from public, anon;
revoke execute on function public.reverse_transfer(uuid, text) from public, anon;
revoke execute on function public.reconcile_account_balances(uuid) from public, anon;