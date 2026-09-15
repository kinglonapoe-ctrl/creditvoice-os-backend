-- Phase 2B.5 Gate A — remove development test helpers from the production schema.
--
-- `public` is the production API surface (PostgREST exposes only `public`).
-- Every cv_test_* helper is relocated out of it into a dedicated `cv_test`
-- schema that the Data API does not expose, that carries no privileges for
-- anon/authenticated/service_role, and that only the sandbox test role may
-- execute. Each helper additionally refuses any session whose session_user is
-- not `sandbox_exec` and refuses non-'QA %' organizations. Rerunnable.

create schema if not exists cv_test;
revoke all on schema cv_test from public;

do $move$
declare f record;
begin
  for f in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'cv\_test\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
    execute format('alter function %s set schema cv_test', f.sig);
  end loop;
end $move$;

do $priv$
declare f record;
begin
  revoke all on schema cv_test from anon, authenticated, service_role;
  for f in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'cv_test'
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
  end loop;

  if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
    execute 'grant usage on schema cv_test to sandbox_exec';
    for f in
      select p.oid::regprocedure::text as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'cv_test'
    loop
      execute format('grant execute on function %s to sandbox_exec', f.sig);
    end loop;
  end if;
end $priv$;