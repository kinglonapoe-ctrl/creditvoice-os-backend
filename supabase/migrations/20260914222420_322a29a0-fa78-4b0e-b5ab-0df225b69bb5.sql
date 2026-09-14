-- =========================================================
-- CreditVoice OS — Phase 1 hardening
-- =========================================================

-- ---------- 1. GRANT LOCKDOWN ----------
revoke all on all tables in schema public from anon, authenticated;

-- Read-only reference data
grant select on public.currencies to anon, authenticated;
grant insert on public.tenant_applications to anon, authenticated;

-- Authenticated read surfaces (RLS still scopes rows)
grant select on public.tenants, public.tenant_applications, public.profiles,
  public.user_roles, public.customers, public.customer_accounts,
  public.ledger_accounts, public.ledger_entries, public.transactions,
  public.transfers, public.audit_logs, public.phone_numbers,
  public.customer_care_settings, public.ivr_settings, public.platform_settings
  to authenticated;

-- Narrow writes that remain client-side (RLS enforced, guarded by triggers)
grant insert, update on public.customers to authenticated;
grant insert, update on public.customer_accounts to authenticated;
grant insert, update on public.customer_care_settings to authenticated;
grant insert, update on public.ivr_settings to authenticated;
grant update on public.tenants to authenticated;
grant update on public.tenant_applications to authenticated;
grant update on public.profiles to authenticated;
grant insert, update on public.phone_numbers to authenticated;
grant update on public.currencies to authenticated;

-- Credentials, roles and ledger are never client-writable
grant all on all tables in schema public to service_role;

-- ---------- 2. CONCURRENCY-SAFE ACCOUNT NUMBERS ----------
create table if not exists public.tenant_account_sequences (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  next_number bigint not null default 10001,
  updated_at timestamptz not null default now()
);
grant all on public.tenant_account_sequences to service_role;
alter table public.tenant_account_sequences enable row level security;
create policy "sequences no client access" on public.tenant_account_sequences
  for all to anon, authenticated using (false) with check (false);

insert into public.tenant_account_sequences (tenant_id, next_number)
select t.id,
       coalesce(max(nullif(regexp_replace(a.account_number,'\D','','g'),'')::bigint), 10000) + 1
from public.tenants t
left join public.customer_accounts a on a.tenant_id = t.id
group by t.id
on conflict (tenant_id) do nothing;

create or replace function public.allocate_account_number(_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare n bigint;
begin
  insert into public.tenant_account_sequences (tenant_id, next_number)
  values (_tenant_id, 10001)
  on conflict (tenant_id) do nothing;

  update public.tenant_account_sequences
     set next_number = next_number + 1, updated_at = now()
   where tenant_id = _tenant_id
  returning next_number - 1 into n;

  return n::text;
end; $$;
revoke all on function public.allocate_account_number(uuid) from public, anon, authenticated;

create or replace function public.assign_account_number()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.account_number is null or new.account_number = '' then
    new.account_number := public.allocate_account_number(new.tenant_id);
  elsif public.current_user_role() is distinct from 'SUPER_ADMIN' then
    -- clients may not choose their own numbers
    new.account_number := public.allocate_account_number(new.tenant_id);
  end if;
  return new;
end; $$;

-- ---------- 3. IDEMPOTENCY ----------
create table if not exists public.financial_idempotency (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  idempotency_key text not null,
  operation text not null,
  result_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, idempotency_key)
);
grant all on public.financial_idempotency to service_role;
alter table public.financial_idempotency enable row level security;
create policy "idempotency no client access" on public.financial_idempotency
  for all to anon, authenticated using (false) with check (false);

-- ---------- 4. SCHEMA ADDITIONS ----------
alter table public.transactions
  add column if not exists idempotency_key text,
  add column if not exists reversal_of_transaction_id uuid references public.transactions(id);

alter table public.transfers
  add column if not exists idempotency_key text,
  add column if not exists reversed_by uuid,
  add column if not exists reversed_at timestamptz,
  add column if not exists reversal_reason text;

alter table public.customer_pins
  add column if not exists failed_attempts integer not null default 0,
  add column if not exists locked_until timestamptz;

alter table public.tenant_access_codes
  add column if not exists failed_attempts integer not null default 0,
  add column if not exists locked_until timestamptz,
  add column if not exists retired_at timestamptz;

-- ---------- 5. IMMUTABILITY & GUARDS ----------
create or replace function public.guard_transfer_mutation()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if current_setting('app.ledger_posting', true) is distinct from 'on' then
    raise exception 'Transfers can only be changed by the credit engine';
  end if;
  if old.status in ('COMPLETED','REVERSED')
     and new.status = old.status then
    raise exception 'Settled transfers are immutable';
  end if;
  if new.id <> old.id or new.tenant_id <> old.tenant_id
     or new.sender_account_id <> old.sender_account_id
     or new.recipient_account_id <> old.recipient_account_id
     or new.amount <> old.amount
     or new.currency_code <> old.currency_code
     or new.reference <> old.reference then
    raise exception 'Transfer history cannot be rewritten';
  end if;
  return new;
end; $$;

drop trigger if exists t_transfer_guard on public.transfers;
create trigger t_transfer_guard before update on public.transfers
  for each row execute function public.guard_transfer_mutation();

drop trigger if exists t_transfer_no_delete on public.transfers;
create trigger t_transfer_no_delete before delete on public.transfers
  for each row execute function public.block_mutation();

-- Accounts: only the credit engine may move money or change identity fields
create or replace function public.guard_account_balance()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if current_setting('app.ledger_posting', true) is distinct from 'on' then
    if new.balance is distinct from old.balance then
      raise exception 'Balances can only change through ledger postings';
    end if;
    if new.tenant_id is distinct from old.tenant_id
       or new.customer_id is distinct from old.customer_id
       or new.account_number is distinct from old.account_number
       or new.currency_code is distinct from old.currency_code then
      raise exception 'Account identity and currency are immutable';
    end if;
    if new.credit_limit < 0 then
      raise exception 'Credit limit cannot be negative';
    end if;
  end if;
  return new;
end; $$;

-- New records may only be created inside an operational organization
create or replace function public.guard_tenant_operational()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare t public.tenants%rowtype;
begin
  select * into t from public.tenants where id = new.tenant_id;
  if not found then raise exception 'Unknown organization'; end if;
  if t.status in ('SUSPENDED','CLOSED') then
    raise exception 'Organization is % and cannot be modified', t.status;
  end if;
  if tg_table_name = 'customer_accounts' then
    if not t.currency_approved then
      raise exception 'The operating currency must be approved before accounts can be opened';
    end if;
    if new.currency_code is distinct from t.currency_code then
      raise exception 'Accounts must use the approved organization currency';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists t_customers_tenant_guard on public.customers;
create trigger t_customers_tenant_guard before insert on public.customers
  for each row execute function public.guard_tenant_operational();

drop trigger if exists t_accounts_tenant_guard on public.customer_accounts;
create trigger t_accounts_tenant_guard before insert on public.customer_accounts
  for each row execute function public.guard_tenant_operational();

-- ---------- 6. CREDIT ENGINE ----------
create or replace function public.assert_tenant_operational(_tenant_id uuid)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare t public.tenants%rowtype;
begin
  select * into t from public.tenants where id = _tenant_id;
  if not found then raise exception 'Unknown organization'; end if;
  if t.status <> 'ACTIVE' then
    raise exception 'Financial operations require an ACTIVE organization (currently %)', t.status;
  end if;
  if not t.currency_approved then
    raise exception 'The operating currency has not been approved';
  end if;
end; $$;
revoke all on function public.assert_tenant_operational(uuid) from public, anon, authenticated;

create or replace function public.claim_idempotency(_tenant_id uuid, _key text, _operation text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare existing uuid; found_row boolean;
begin
  if _key is null or _key = '' then return null; end if;
  select result_id, true into existing, found_row
    from public.financial_idempotency
   where tenant_id = _tenant_id and idempotency_key = _key;
  if found_row then return existing; end if;
  insert into public.financial_idempotency (tenant_id, idempotency_key, operation)
  values (_tenant_id, _key, _operation);
  return null;
end; $$;
revoke all on function public.claim_idempotency(uuid, text, text) from public, anon, authenticated;

create or replace function public.post_credit(
  _account_id uuid, _amount numeric, _type transaction_type,
  _description text default null, _idempotency_key text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare a public.customer_accounts%rowtype; lid uuid; txid uuid; newbal numeric;
        dir public.ledger_direction; prior uuid;
begin
  if _amount is null or _amount <= 0 then raise exception 'Amount must be positive'; end if;
  if _type not in ('INITIAL_CREDIT','CREDIT_ADJUSTMENT','CREDIT_DEBIT','CREDIT_REPAYMENT') then
    raise exception 'Unsupported credit operation';
  end if;

  select * into a from public.customer_accounts where id = _account_id for update;
  if not found then raise exception 'Account not found'; end if;

  if not (a.tenant_id = public.current_user_tenant_id()
          and public.current_user_role() = 'TENANT_ADMIN') then
    raise exception 'Not authorised for this account';
  end if;
  perform public.assert_tenant_operational(a.tenant_id);
  if a.status <> 'ACTIVE' then raise exception 'Account is not active'; end if;

  prior := public.claim_idempotency(a.tenant_id, _idempotency_key, 'post_credit');
  if prior is not null then return prior; end if;

  dir := case when _type in ('CREDIT_DEBIT') then 'DEBIT' else 'CREDIT' end;
  newbal := case when dir = 'CREDIT' then a.balance + _amount else a.balance - _amount end;
  if newbal < 0 then raise exception 'Insufficient available credit'; end if;

  lid := public.ensure_ledger_account(_account_id);
  insert into public.transactions (tenant_id, type, status, amount, currency_code, reference,
                                   description, account_id, created_by, idempotency_key)
  values (a.tenant_id, _type, 'COMPLETED', _amount, a.currency_code,
          'TX-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),
          _description, a.id, auth.uid(), _idempotency_key)
  returning id into txid;

  insert into public.ledger_entries (tenant_id, transaction_id, ledger_account_id, direction,
                                     amount, currency_code, balance_after)
  values (a.tenant_id, txid, lid, dir, _amount, a.currency_code, newbal);

  perform set_config('app.ledger_posting','on', true);
  update public.customer_accounts set balance = newbal where id = a.id;
  update public.ledger_accounts set balance = newbal where id = lid;
  perform set_config('app.ledger_posting','off', true);

  if _idempotency_key is not null and _idempotency_key <> '' then
    update public.financial_idempotency set result_id = txid
      where tenant_id = a.tenant_id and idempotency_key = _idempotency_key;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, metadata)
  values (a.tenant_id, auth.uid(), public.current_user_role(),
          case when _type = 'INITIAL_CREDIT' then 'CREDIT_ADDED' else 'CREDIT_ADJUSTED' end,
          'customer_account', a.id, jsonb_build_object('amount', _amount, 'type', _type, 'transaction_id', txid));
  return txid;
end; $$;

create or replace function public.execute_transfer(
  _sender_account_id uuid, _recipient_account_id uuid, _amount numeric,
  _description text default null, _idempotency_key text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare s public.customer_accounts%rowtype; r public.customer_accounts%rowtype;
        first_id uuid; second_id uuid;
        sl uuid; rl uuid; txid uuid; trid uuid; sbal numeric; rbal numeric; ref text; prior uuid;
begin
  if _amount is null or _amount <= 0 then raise exception 'Amount must be positive'; end if;
  if _sender_account_id = _recipient_account_id then raise exception 'Cannot transfer to the same account'; end if;

  -- deterministic lock order prevents deadlocks; locked rows are the values we use
  first_id := least(_sender_account_id, _recipient_account_id);
  second_id := greatest(_sender_account_id, _recipient_account_id);
  perform 1 from public.customer_accounts where id = first_id for update;
  perform 1 from public.customer_accounts where id = second_id for update;
  select * into s from public.customer_accounts where id = _sender_account_id;
  select * into r from public.customer_accounts where id = _recipient_account_id;
  if s.id is null or r.id is null then raise exception 'Account not found'; end if;
  if s.tenant_id <> r.tenant_id then raise exception 'Cross-organization transfers are not allowed'; end if;

  if not (s.tenant_id = public.current_user_tenant_id()
          and public.current_user_role() in ('TENANT_ADMIN','CUSTOMER')) then
    raise exception 'Not authorised for this organization';
  end if;
  perform public.assert_tenant_operational(s.tenant_id);
  if s.currency_code <> r.currency_code then raise exception 'Currency mismatch'; end if;
  if s.status <> 'ACTIVE' or r.status <> 'ACTIVE' then raise exception 'Both accounts must be active'; end if;
  if s.balance < _amount then raise exception 'Insufficient available credit'; end if;

  prior := public.claim_idempotency(s.tenant_id, _idempotency_key, 'execute_transfer');
  if prior is not null then return prior; end if;

  ref := 'TRF-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
  perform set_config('app.ledger_posting','on', true);
  insert into public.transfers (tenant_id, sender_account_id, recipient_account_id, amount,
                                currency_code, status, reference, initiated_by, idempotency_key)
  values (s.tenant_id, s.id, r.id, _amount, s.currency_code, 'PROCESSING', ref, auth.uid(), _idempotency_key)
  returning id into trid;

  insert into public.audit_logs (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, metadata)
  values (s.tenant_id, auth.uid(), public.current_user_role(), 'TRANSFER_INITIATED','transfer',trid,
          jsonb_build_object('amount',_amount,'reference',ref));

  sl := public.ensure_ledger_account(s.id);
  rl := public.ensure_ledger_account(r.id);
  sbal := s.balance - _amount;
  rbal := r.balance + _amount;

  insert into public.transactions (tenant_id, type, status, amount, currency_code, reference, description,
                                   account_id, counterparty_account_id, created_by, idempotency_key)
  values (s.tenant_id, 'TRANSFER','COMPLETED', _amount, s.currency_code, 'TX-' || substr(ref,5),
          _description, s.id, r.id, auth.uid(), _idempotency_key)
  returning id into txid;

  insert into public.ledger_entries (tenant_id, transaction_id, ledger_account_id, direction, amount, currency_code, balance_after)
  values (s.tenant_id, txid, sl, 'DEBIT', _amount, s.currency_code, sbal),
         (s.tenant_id, txid, rl, 'CREDIT', _amount, s.currency_code, rbal);

  update public.customer_accounts set balance = sbal where id = s.id;
  update public.customer_accounts set balance = rbal where id = r.id;
  update public.ledger_accounts set balance = sbal where id = sl;
  update public.ledger_accounts set balance = rbal where id = rl;
  update public.transfers set status = 'COMPLETED', transaction_id = txid, completed_at = now() where id = trid;
  perform set_config('app.ledger_posting','off', true);

  if _idempotency_key is not null and _idempotency_key <> '' then
    update public.financial_idempotency set result_id = trid
      where tenant_id = s.tenant_id and idempotency_key = _idempotency_key;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, metadata)
  values (s.tenant_id, auth.uid(), public.current_user_role(), 'TRANSFER_COMPLETED','transfer',trid,
          jsonb_build_object('amount',_amount,'reference',ref,'transaction_id',txid));
  return trid;
end; $$;

create or replace function public.reverse_transfer(_transfer_id uuid, _reason text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare t public.transfers%rowtype; s public.customer_accounts%rowtype; r public.customer_accounts%rowtype;
        first_id uuid; second_id uuid; sl uuid; rl uuid; txid uuid; sbal numeric; rbal numeric;
begin
  select * into t from public.transfers where id = _transfer_id for update;
  if not found then raise exception 'Transfer not found'; end if;
  if t.status <> 'COMPLETED' then raise exception 'Only completed transfers can be reversed'; end if;
  if not (t.tenant_id = public.current_user_tenant_id()
          and public.current_user_role() = 'TENANT_ADMIN') then
    raise exception 'Not authorised';
  end if;
  perform public.assert_tenant_operational(t.tenant_id);

  first_id := least(t.sender_account_id, t.recipient_account_id);
  second_id := greatest(t.sender_account_id, t.recipient_account_id);
  perform 1 from public.customer_accounts where id = first_id for update;
  perform 1 from public.customer_accounts where id = second_id for update;
  select * into s from public.customer_accounts where id = t.sender_account_id;
  select * into r from public.customer_accounts where id = t.recipient_account_id;
  if r.balance < t.amount then raise exception 'Recipient has insufficient credit to reverse'; end if;

  sl := public.ensure_ledger_account(s.id); rl := public.ensure_ledger_account(r.id);
  sbal := s.balance + t.amount; rbal := r.balance - t.amount;

  insert into public.transactions (tenant_id, type, status, amount, currency_code, reference, description,
                                   account_id, counterparty_account_id, created_by, reversal_of_transaction_id)
  values (t.tenant_id, 'TRANSFER_REVERSAL','COMPLETED', t.amount, t.currency_code,
          'REV-' || substr(t.reference,5), _reason, r.id, s.id, auth.uid(), t.transaction_id)
  returning id into txid;

  insert into public.ledger_entries (tenant_id, transaction_id, ledger_account_id, direction, amount, currency_code, balance_after)
  values (t.tenant_id, txid, rl, 'DEBIT', t.amount, t.currency_code, rbal),
         (t.tenant_id, txid, sl, 'CREDIT', t.amount, t.currency_code, sbal);

  perform set_config('app.ledger_posting','on', true);
  update public.customer_accounts set balance = sbal where id = s.id;
  update public.customer_accounts set balance = rbal where id = r.id;
  update public.ledger_accounts set balance = sbal where id = sl;
  update public.ledger_accounts set balance = rbal where id = rl;
  update public.transfers
     set status = 'REVERSED', reversed_by = auth.uid(), reversed_at = now(), reversal_reason = _reason
   where id = t.id;
  perform set_config('app.ledger_posting','off', true);

  insert into public.audit_logs (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, metadata)
  values (t.tenant_id, auth.uid(), public.current_user_role(), 'TRANSFER_REVERSED','transfer',t.id,
          jsonb_build_object('reason',_reason,'reversal_transaction_id',txid,'original_transaction_id',t.transaction_id));
  return txid;
end; $$;

-- Old 4-argument signatures are superseded by the defaulted versions above
drop function if exists public.post_credit(uuid, numeric, transaction_type, text);
drop function if exists public.execute_transfer(uuid, uuid, numeric, text);

revoke all on function public.post_credit(uuid, numeric, transaction_type, text, text) from public, anon;
revoke all on function public.execute_transfer(uuid, uuid, numeric, text, text) from public, anon;
revoke all on function public.reverse_transfer(uuid, text) from public, anon;
grant execute on function public.post_credit(uuid, numeric, transaction_type, text, text) to authenticated;
grant execute on function public.execute_transfer(uuid, uuid, numeric, text, text) to authenticated;
grant execute on function public.reverse_transfer(uuid, text) to authenticated;

-- ---------- 7. RECONCILIATION ----------
create or replace function public.reconcile_account_balances(_tenant_id uuid)
returns table(account_id uuid, account_number text, cached_balance numeric, ledger_balance numeric, drift numeric)
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.id, a.account_number, a.balance,
         coalesce(sum(case when e.direction = 'CREDIT' then e.amount else -e.amount end), 0),
         a.balance - coalesce(sum(case when e.direction = 'CREDIT' then e.amount else -e.amount end), 0)
  from public.customer_accounts a
  left join public.ledger_accounts la on la.account_id = a.id
  left join public.ledger_entries e on e.ledger_account_id = la.id
  where a.tenant_id = _tenant_id
    and (public.is_super_admin() or _tenant_id = public.current_user_tenant_id())
  group by a.id, a.account_number, a.balance;
$$;
revoke all on function public.reconcile_account_balances(uuid) from public, anon;
grant execute on function public.reconcile_account_balances(uuid) to authenticated;

-- ---------- 8. CREDENTIAL VERIFICATION HOOKS (service role only) ----------
create or replace function public.register_credential_failure(_kind text, _id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare attempts integer;
begin
  if _kind = 'PIN' then
    update public.customer_pins
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 3 then now() + interval '15 minutes' else locked_until end
     where customer_id = _id
    returning failed_attempts into attempts;
  else
    update public.tenant_access_codes
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end
     where tenant_id = _id and is_active
    returning failed_attempts into attempts;
  end if;
  return coalesce(attempts, 0);
end; $$;
revoke all on function public.register_credential_failure(text, uuid) from public, anon, authenticated;

-- ---------- 9. INDEXES ----------
create index if not exists idx_accounts_customer on public.customer_accounts(customer_id);
create index if not exists idx_accounts_tenant_status on public.customer_accounts(tenant_id, status);
create index if not exists idx_customers_tenant_status on public.customers(tenant_id, status);
create index if not exists idx_customers_phone on public.customers(tenant_id, phone);
create index if not exists idx_tx_tenant_created on public.transactions(tenant_id, created_at desc);
create index if not exists idx_tx_account on public.transactions(account_id);
create index if not exists idx_transfers_tenant_created on public.transfers(tenant_id, initiated_at desc);
create index if not exists idx_transfers_sender on public.transfers(sender_account_id);
create index if not exists idx_transfers_recipient on public.transfers(recipient_account_id);
create index if not exists idx_ledger_entries_account on public.ledger_entries(ledger_account_id, created_at desc);
create index if not exists idx_ledger_entries_tx on public.ledger_entries(transaction_id);
create index if not exists idx_ledger_accounts_account on public.ledger_accounts(account_id);
create index if not exists idx_audit_tenant_created on public.audit_logs(tenant_id, created_at desc);
create index if not exists idx_phone_numbers_tenant on public.phone_numbers(tenant_id);
create index if not exists idx_user_roles_user on public.user_roles(user_id);
create unique index if not exists uq_ledger_accounts_account on public.ledger_accounts(account_id);

-- ---------- 10. CONSTRAINTS ----------
alter table public.customer_accounts
  add constraint chk_credit_limit_non_negative check (credit_limit >= 0) not valid;
alter table public.transactions
  add constraint chk_tx_amount_positive check (amount > 0) not valid;
alter table public.transfers
  add constraint chk_transfer_amount_positive check (amount > 0) not valid;
alter table public.ledger_entries
  add constraint chk_entry_amount_positive check (amount > 0) not valid;
