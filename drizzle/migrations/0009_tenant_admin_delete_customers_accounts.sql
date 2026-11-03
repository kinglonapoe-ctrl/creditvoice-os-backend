create or replace function public.account_has_history(_account_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.transactions where account_id = _account_id or counterparty_account_id = _account_id)
      or exists (select 1 from public.transfers where sender_account_id = _account_id or recipient_account_id = _account_id)
      or exists (select 1 from public.ledger_entries le join public.ledger_accounts la on la.id = le.ledger_account_id where la.account_id = _account_id)
      or exists (select 1 from public.call_sessions where account_id = _account_id or pending_recipient_account_id = _account_id)
      or exists (select 1 from public.call_transfer_grants where account_id = _account_id)
      or exists (select 1 from public.customer_accounts where id = _account_id and balance <> 0);
$$;
revoke all on function public.account_has_history(uuid) from public, anon;

create or replace function public.delete_customer_account(_account_id uuid, _reason text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.customer_accounts;
begin
  select * into a from public.customer_accounts where id = _account_id for update;
  if a.id is null then raise exception 'Account not found'; end if;
  if public.current_user_role() is distinct from 'TENANT_ADMIN' or a.tenant_id is distinct from public.current_user_tenant_id() then
    raise exception 'Not authorized';
  end if;
  if coalesce(length(trim(_reason)),0) < 3 then raise exception 'A reason is required'; end if;
  perform public.lock_tenant_currency(a.tenant_id);
  if public.account_has_history(a.id) then
    raise exception 'This account has financial or call history and cannot be deleted. Close it instead.';
  end if;
  delete from public.ledger_accounts where account_id = a.id;
  delete from public.customer_accounts where id = a.id;
  insert into public.audit_logs (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, metadata)
  values (a.tenant_id, auth.uid(), 'TENANT_ADMIN', 'ACCOUNT_DELETED', 'customer_account', a.id,
    jsonb_build_object('account_number', a.account_number, 'customer_id', a.customer_id, 'reason', trim(_reason)));
end; $$;
revoke all on function public.delete_customer_account(uuid, text) from public, anon;
grant execute on function public.delete_customer_account(uuid, text) to authenticated;

create or replace function public.delete_customer(_customer_id uuid, _reason text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.customers; r record;
begin
  select * into c from public.customers where id = _customer_id for update;
  if c.id is null then raise exception 'Customer not found'; end if;
  if public.current_user_role() is distinct from 'TENANT_ADMIN' or c.tenant_id is distinct from public.current_user_tenant_id() then
    raise exception 'Not authorized';
  end if;
  if coalesce(length(trim(_reason)),0) < 3 then raise exception 'A reason is required'; end if;
  perform public.lock_tenant_currency(c.tenant_id);
  if exists (select 1 from public.call_sessions where customer_id = c.id) then
    raise exception 'This customer has call history and cannot be deleted. Suspend or close them instead.';
  end if;
  for r in select id from public.customer_accounts where customer_id = c.id for update loop
    if public.account_has_history(r.id) then
      raise exception 'This customer has an account with financial or call history and cannot be deleted. Close it instead.';
    end if;
  end loop;
  for r in select id, account_number from public.customer_accounts where customer_id = c.id loop
    delete from public.ledger_accounts where account_id = r.id;
    delete from public.customer_accounts where id = r.id;
    insert into public.audit_logs (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, metadata)
    values (c.tenant_id, auth.uid(), 'TENANT_ADMIN', 'ACCOUNT_DELETED', 'customer_account', r.id,
      jsonb_build_object('account_number', r.account_number, 'customer_id', c.id, 'reason', trim(_reason)));
  end loop;
  delete from public.customer_pins where customer_id = c.id and tenant_id = c.tenant_id;
  delete from public.customers where id = c.id;
  insert into public.audit_logs (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, metadata)
  values (c.tenant_id, auth.uid(), 'TENANT_ADMIN', 'CUSTOMER_DELETED', 'customer', c.id,
    jsonb_build_object('customer_reference', c.customer_reference, 'reason', trim(_reason)));
end; $$;
revoke all on function public.delete_customer(uuid, text) from public, anon;
grant execute on function public.delete_customer(uuid, text) to authenticated;