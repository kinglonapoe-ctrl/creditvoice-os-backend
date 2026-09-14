create or replace function public.assign_account_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.account_number is null or new.account_number = '' then
    select (coalesce(max(nullif(regexp_replace(account_number,'\D','','g'),'')::bigint), 10000) + 1)::text
      into new.account_number from public.customer_accounts where tenant_id = new.tenant_id;
  end if;
  return new;
end; $$;
revoke all on function public.assign_account_number() from public;
alter table public.customer_accounts alter column account_number drop not null;
create trigger t_assign_account_number before insert on public.customer_accounts
  for each row execute function public.assign_account_number();

create or replace function public.audit_customer_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, metadata)
    values (new.tenant_id, auth.uid(), public.current_user_role(), 'CUSTOMER_CREATED','customer',new.id,
            jsonb_build_object('full_name', new.full_name));
  elsif new.status is distinct from old.status then
    insert into public.audit_logs (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, metadata)
    values (new.tenant_id, auth.uid(), public.current_user_role(),
            'CUSTOMER_' || new.status::text, 'customer', new.id, jsonb_build_object('from', old.status));
  end if;
  return new;
end; $$;
revoke all on function public.audit_customer_event() from public;
create trigger t_audit_customer after insert or update on public.customers
  for each row execute function public.audit_customer_event();

create or replace function public.audit_account_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, metadata)
  values (new.tenant_id, auth.uid(), public.current_user_role(), 'ACCOUNT_CREATED','customer_account',new.id,
          jsonb_build_object('account_number', new.account_number, 'currency', new.currency_code));
  return new;
end; $$;
revoke all on function public.audit_account_event() from public;
create trigger t_audit_account after insert on public.customer_accounts
  for each row execute function public.audit_account_event();

create or replace function public.audit_tenant_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into public.audit_logs (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, metadata)
    values (new.id, auth.uid(), public.current_user_role(), 'TENANT_' || new.status::text, 'tenant', new.id, '{}'::jsonb);
  end if;
  if new.currency_approved is distinct from old.currency_approved and new.currency_approved then
    insert into public.audit_logs (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, metadata)
    values (new.id, auth.uid(), public.current_user_role(), 'CURRENCY_APPROVED','tenant', new.id,
            jsonb_build_object('currency', new.currency_code));
  end if;
  return new;
end; $$;
revoke all on function public.audit_tenant_event() from public;
create trigger t_audit_tenant after update on public.tenants
  for each row execute function public.audit_tenant_event();