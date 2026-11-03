CREATE OR REPLACE FUNCTION public.close_customer_account(_account_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare a public.customer_accounts;
begin
  select * into a from public.customer_accounts where id = _account_id for update;
  if a.id is null then raise exception 'Account not found'; end if;
  if not (public.is_super_admin() or (public.current_user_role() = 'TENANT_ADMIN' and a.tenant_id = public.current_user_tenant_id())) then
    raise exception 'Not authorized';
  end if;
  if coalesce(length(trim(_reason)),0) < 3 then raise exception 'A reason is required'; end if;
  if a.status = 'CLOSED' then raise exception 'This account is already closed.'; end if;
  perform public.lock_tenant_currency(a.tenant_id);
  perform set_config('cv.allow_close', 'on', true);
  update public.customer_accounts set status = 'CLOSED', updated_at = now() where id = a.id;
  perform set_config('cv.allow_close', 'off', true);
  insert into public.audit_logs (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, metadata)
  values (a.tenant_id, auth.uid(), public.current_user_role(), 'ACCOUNT_CLOSED', 'customer_account', a.id,
    jsonb_build_object('account_number', a.account_number, 'customer_id', a.customer_id, 'previous_status', a.status,
      'balance_at_close', a.balance, 'reason', trim(_reason)));
end; $$;

REVOKE ALL ON FUNCTION public.close_customer_account(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_customer_account(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_account_closure()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
begin
  if old.status = 'CLOSED' and new.status is distinct from 'CLOSED' then
    raise exception 'Closed accounts cannot be reopened.';
  end if;
  if new.status = 'CLOSED' and old.status is distinct from 'CLOSED'
     and coalesce(current_setting('cv.allow_close', true), 'off') <> 'on' then
    raise exception 'Use the Close Account action to close an account.';
  end if;
  return new;
end; $$;

DROP TRIGGER IF EXISTS guard_account_closure ON public.customer_accounts;
CREATE TRIGGER guard_account_closure BEFORE UPDATE OF status ON public.customer_accounts
FOR EACH ROW EXECUTE FUNCTION public.guard_account_closure();