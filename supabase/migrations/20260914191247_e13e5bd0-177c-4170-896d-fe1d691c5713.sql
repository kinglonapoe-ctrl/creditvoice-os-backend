-- ============ ENUMS ============
create type public.app_role as enum ('SUPER_ADMIN','TENANT_ADMIN','CUSTOMER');
create type public.application_status as enum ('PENDING','UNDER_REVIEW','APPROVED','REJECTED');
create type public.tenant_status as enum ('CONFIGURATION','ACTIVE','SUSPENDED','CLOSED');
create type public.phone_number_status as enum ('AVAILABLE','RESERVED','ASSIGNED','ACTIVE','SUSPENDED','RELEASED');
create type public.customer_status as enum ('PENDING','ACTIVE','SUSPENDED','CLOSED');
create type public.account_status as enum ('ACTIVE','SUSPENDED','CLOSED');
create type public.transaction_type as enum ('INITIAL_CREDIT','CREDIT_ADJUSTMENT','TRANSFER','TRANSFER_REVERSAL','CREDIT_DEBIT','CREDIT_REPAYMENT');
create type public.transaction_status as enum ('PENDING','COMPLETED','FAILED','REVERSED');
create type public.transfer_status as enum ('INITIATED','VALIDATING','AWAITING_CONFIRMATION','PROCESSING','COMPLETED','FAILED','REVERSED','CANCELLED');
create type public.routing_mode as enum ('LIVE_AGENT','SEQUENTIAL','SIMULTANEOUS','QUEUE','VOICEMAIL');
create type public.ledger_direction as enum ('DEBIT','CREDIT');

-- ============ SHARED ============
create or replace function public.update_updated_at_column()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

create or replace function public.block_mutation()
returns trigger language plpgsql set search_path = public as $$
begin raise exception 'Records in % are immutable', tg_table_name; end; $$;

-- ============ CURRENCIES ============
create table public.currencies (
  code text primary key,
  name text not null,
  symbol text not null,
  decimal_places int not null default 2,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.currencies to authenticated;
grant all on public.currencies to service_role;
alter table public.currencies enable row level security;

insert into public.currencies (code,name,symbol,decimal_places) values
('NGN','Nigerian Naira','₦',2),('USD','US Dollar','$',2),('GBP','Pound Sterling','£',2),
('EUR','Euro','€',2),('GHS','Ghanaian Cedi','₵',2),('KES','Kenyan Shilling','KSh',2),
('ZAR','South African Rand','R',2),('CAD','Canadian Dollar','C$',2),('AUD','Australian Dollar','A$',2);

-- ============ TENANTS ============
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text not null,
  country text not null,
  address text,
  business_type text,
  description text,
  currency_code text references public.currencies(code),
  currency_approved boolean not null default false,
  status public.tenant_status not null default 'CONFIGURATION',
  access_code_status text not null default 'NOT_ISSUED',
  access_code_last_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.tenants to authenticated;
grant all on public.tenants to service_role;
alter table public.tenants enable row level security;
create trigger t_tenants_updated before update on public.tenants for each row execute function public.update_updated_at_column();

-- ============ PROFILES + ROLES ============
create table public.profiles (
  id uuid primary key,
  full_name text,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create trigger t_profiles_updated before update on public.profiles for each row execute function public.update_updated_at_column();

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  tenant_id uuid references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, role, tenant_id)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
$$;

create or replace function public.current_user_role()
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.user_roles where user_id = auth.uid()
  order by case role when 'SUPER_ADMIN' then 1 when 'TENANT_ADMIN' then 2 else 3 end limit 1;
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'SUPER_ADMIN');
$$;

create or replace function public.current_user_tenant_id()
returns uuid language sql stable security definer set search_path = public as $$
  select tenant_id from public.user_roles
  where user_id = auth.uid() and tenant_id is not null limit 1;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email)
  on conflict (id) do nothing;
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- policies: profiles / roles / tenants / currencies
create policy "own profile read" on public.profiles for select to authenticated using (id = auth.uid() or public.is_super_admin());
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid());
create policy "own roles read" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_super_admin());
create policy "currencies readable" on public.currencies for select to authenticated using (true);
create policy "tenant read own" on public.tenants for select to authenticated using (public.is_super_admin() or id = public.current_user_tenant_id());
create policy "tenant super update" on public.tenants for update to authenticated using (public.is_super_admin());
create policy "tenant admin update profile" on public.tenants for update to authenticated
  using (id = public.current_user_tenant_id() and public.current_user_role() = 'TENANT_ADMIN')
  with check (id = public.current_user_tenant_id());

-- lock currency for tenant admins
create or replace function public.guard_tenant_currency()
returns trigger language plpgsql set search_path = public as $$
begin
  if not public.is_super_admin() then
    if new.currency_code is distinct from old.currency_code
       or new.currency_approved is distinct from old.currency_approved
       or new.status is distinct from old.status then
      raise exception 'Only platform administrators may change currency or status';
    end if;
  end if;
  return new;
end; $$;
create trigger t_tenant_currency_guard before update on public.tenants
  for each row execute function public.guard_tenant_currency();

-- ============ TENANT APPLICATIONS ============
create table public.tenant_applications (
  id uuid primary key default gen_random_uuid(),
  organization_name text not null,
  legal_name text not null,
  admin_full_name text not null,
  admin_email text not null,
  admin_phone text not null,
  country text not null,
  address text,
  business_type text,
  requested_currency text not null references public.currencies(code),
  description text,
  status public.application_status not null default 'PENDING',
  review_notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  tenant_id uuid references public.tenants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.tenant_applications to authenticated;
grant select, insert on public.tenant_applications to anon;
grant all on public.tenant_applications to service_role;
alter table public.tenant_applications enable row level security;
create trigger t_apps_updated before update on public.tenant_applications for each row execute function public.update_updated_at_column();
create policy "apps public submit" on public.tenant_applications for insert to anon, authenticated with check (status = 'PENDING');
create policy "apps super read" on public.tenant_applications for select to authenticated using (public.is_super_admin());
create policy "apps super update" on public.tenant_applications for update to authenticated using (public.is_super_admin());

-- ============ SECRETS (no authenticated access) ============
create table public.tenant_access_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
grant all on public.tenant_access_codes to service_role;
alter table public.tenant_access_codes enable row level security;

create table public.customer_pins (
  customer_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  pin_hash text not null,
  updated_at timestamptz not null default now()
);
grant all on public.customer_pins to service_role;
alter table public.customer_pins enable row level security;

-- ============ PHONE NUMBERS ============
create table public.phone_numbers (
  id uuid primary key default gen_random_uuid(),
  country text not null,
  country_calling_code text not null,
  phone_number text not null unique,
  provider text not null default 'UNASSIGNED',
  provider_number_id text,
  voice_capable boolean not null default true,
  sms_capable boolean not null default false,
  status public.phone_number_status not null default 'AVAILABLE',
  tenant_id uuid references public.tenants(id) on delete set null,
  is_primary boolean not null default false,
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.phone_numbers to authenticated;
grant all on public.phone_numbers to service_role;
alter table public.phone_numbers enable row level security;
create trigger t_numbers_updated before update on public.phone_numbers for each row execute function public.update_updated_at_column();
create policy "numbers super all" on public.phone_numbers for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
create policy "numbers tenant read" on public.phone_numbers for select to authenticated using (tenant_id = public.current_user_tenant_id());

-- ============ CUSTOMERS ============
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid,
  full_name text not null,
  phone text not null,
  email text,
  customer_reference text,
  status public.customer_status not null default 'PENDING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, customer_reference)
);
grant select, insert, update on public.customers to authenticated;
grant all on public.customers to service_role;
alter table public.customers enable row level security;
create trigger t_customers_updated before update on public.customers for each row execute function public.update_updated_at_column();
create policy "customers tenant read" on public.customers for select to authenticated
  using (public.is_super_admin() or tenant_id = public.current_user_tenant_id() or user_id = auth.uid());
create policy "customers tenant insert" on public.customers for insert to authenticated
  with check (tenant_id = public.current_user_tenant_id() and public.current_user_role() = 'TENANT_ADMIN');
create policy "customers tenant update" on public.customers for update to authenticated
  using (tenant_id = public.current_user_tenant_id() and public.current_user_role() = 'TENANT_ADMIN')
  with check (tenant_id = public.current_user_tenant_id());

-- ============ ACCOUNTS ============
create table public.customer_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  account_number text not null,
  currency_code text not null references public.currencies(code),
  status public.account_status not null default 'ACTIVE',
  credit_limit numeric(20,4) not null default 0,
  balance numeric(20,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, account_number)
);
grant select, insert, update on public.customer_accounts to authenticated;
grant all on public.customer_accounts to service_role;
alter table public.customer_accounts enable row level security;
create trigger t_accounts_updated before update on public.customer_accounts for each row execute function public.update_updated_at_column();
create policy "accounts tenant read" on public.customer_accounts for select to authenticated
  using (public.is_super_admin() or tenant_id = public.current_user_tenant_id()
    or customer_id in (select id from public.customers where user_id = auth.uid()));
create policy "accounts tenant insert" on public.customer_accounts for insert to authenticated
  with check (tenant_id = public.current_user_tenant_id() and public.current_user_role() = 'TENANT_ADMIN');
create policy "accounts tenant update" on public.customer_accounts for update to authenticated
  using (tenant_id = public.current_user_tenant_id() and public.current_user_role() = 'TENANT_ADMIN')
  with check (tenant_id = public.current_user_tenant_id());

-- balance is ledger-derived only
create or replace function public.guard_account_balance()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.balance is distinct from old.balance and current_setting('app.ledger_posting', true) is distinct from 'on' then
    raise exception 'Balances can only change through ledger postings';
  end if;
  return new;
end; $$;
create trigger t_account_balance_guard before update on public.customer_accounts
  for each row execute function public.guard_account_balance();

-- ============ LEDGER ============
create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  account_id uuid references public.customer_accounts(id) on delete cascade,
  kind text not null default 'CUSTOMER',
  currency_code text not null references public.currencies(code),
  balance numeric(20,4) not null default 0,
  created_at timestamptz not null default now()
);
grant select on public.ledger_accounts to authenticated;
grant all on public.ledger_accounts to service_role;
alter table public.ledger_accounts enable row level security;
create policy "ledger accounts read" on public.ledger_accounts for select to authenticated
  using (public.is_super_admin() or tenant_id = public.current_user_tenant_id());

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  type public.transaction_type not null,
  status public.transaction_status not null default 'COMPLETED',
  amount numeric(20,4) not null check (amount > 0),
  currency_code text not null references public.currencies(code),
  reference text not null unique,
  description text,
  account_id uuid references public.customer_accounts(id) on delete set null,
  counterparty_account_id uuid references public.customer_accounts(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now()
);
grant select on public.transactions to authenticated;
grant all on public.transactions to service_role;
alter table public.transactions enable row level security;
create policy "transactions read" on public.transactions for select to authenticated
  using (public.is_super_admin() or tenant_id = public.current_user_tenant_id()
    or account_id in (select a.id from public.customer_accounts a join public.customers c on c.id = a.customer_id where c.user_id = auth.uid()));
create trigger t_tx_immutable before update or delete on public.transactions
  for each row execute function public.block_mutation();

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete restrict,
  ledger_account_id uuid not null references public.ledger_accounts(id) on delete restrict,
  direction public.ledger_direction not null,
  amount numeric(20,4) not null check (amount > 0),
  currency_code text not null references public.currencies(code),
  balance_after numeric(20,4) not null,
  created_at timestamptz not null default now()
);
grant select on public.ledger_entries to authenticated;
grant all on public.ledger_entries to service_role;
alter table public.ledger_entries enable row level security;
create policy "ledger entries read" on public.ledger_entries for select to authenticated
  using (public.is_super_admin() or tenant_id = public.current_user_tenant_id());
create trigger t_ledger_immutable before update or delete on public.ledger_entries
  for each row execute function public.block_mutation();

create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sender_account_id uuid not null references public.customer_accounts(id) on delete restrict,
  recipient_account_id uuid not null references public.customer_accounts(id) on delete restrict,
  amount numeric(20,4) not null check (amount > 0),
  currency_code text not null references public.currencies(code),
  status public.transfer_status not null default 'INITIATED',
  reference text not null unique,
  transaction_id uuid references public.transactions(id) on delete set null,
  failure_reason text,
  initiated_by uuid,
  initiated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (sender_account_id <> recipient_account_id)
);
grant select on public.transfers to authenticated;
grant all on public.transfers to service_role;
alter table public.transfers enable row level security;
create policy "transfers read" on public.transfers for select to authenticated
  using (public.is_super_admin() or tenant_id = public.current_user_tenant_id());

-- ============ CUSTOMER CARE + IVR ============
create table public.customer_care_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null default false,
  primary_number text,
  backup_number text,
  routing_mode public.routing_mode not null default 'VOICEMAIL',
  business_hours_start time not null default '09:00',
  business_hours_end time not null default '17:00',
  timezone text not null default 'UTC',
  after_hours_mode public.routing_mode not null default 'VOICEMAIL',
  voicemail_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.customer_care_settings to authenticated;
grant all on public.customer_care_settings to service_role;
alter table public.customer_care_settings enable row level security;
create trigger t_care_updated before update on public.customer_care_settings for each row execute function public.update_updated_at_column();
create policy "care read" on public.customer_care_settings for select to authenticated
  using (public.is_super_admin() or tenant_id = public.current_user_tenant_id());
create policy "care write" on public.customer_care_settings for insert to authenticated
  with check (tenant_id = public.current_user_tenant_id());
create policy "care update" on public.customer_care_settings for update to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());

create table public.ivr_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  welcome_message text not null default 'Welcome. Please enter your organization access code.',
  language text not null default 'en-US',
  max_pin_attempts int not null default 3,
  session_timeout_seconds int not null default 120,
  transfers_enabled boolean not null default true,
  balance_enquiry_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.ivr_settings to authenticated;
grant all on public.ivr_settings to service_role;
alter table public.ivr_settings enable row level security;
create trigger t_ivr_updated before update on public.ivr_settings for each row execute function public.update_updated_at_column();
create policy "ivr read" on public.ivr_settings for select to authenticated
  using (public.is_super_admin() or tenant_id = public.current_user_tenant_id());
create policy "ivr write" on public.ivr_settings for insert to authenticated
  with check (tenant_id = public.current_user_tenant_id());
create policy "ivr update" on public.ivr_settings for update to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());

-- ============ AUDIT ============
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  actor_id uuid,
  actor_role public.app_role,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip_address text,
  created_at timestamptz not null default now()
);
grant select on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;
alter table public.audit_logs enable row level security;
create policy "audit read" on public.audit_logs for select to authenticated
  using (public.is_super_admin() or tenant_id = public.current_user_tenant_id());
create trigger t_audit_immutable before update or delete on public.audit_logs
  for each row execute function public.block_mutation();

create table public.platform_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
grant select on public.platform_settings to authenticated;
grant all on public.platform_settings to service_role;
alter table public.platform_settings enable row level security;
create policy "settings super" on public.platform_settings for select to authenticated using (public.is_super_admin());
insert into public.platform_settings (key, value) values
  ('platform_name', '"CreditVoice OS"'::jsonb),
  ('telephony_provider', '"NONE"'::jsonb),
  ('default_max_pin_attempts', '3'::jsonb);

-- ============ CREDIT ENGINE ============
create or replace function public.next_account_number(_tenant_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(_tenant_id::text, 0));
  select coalesce(max(nullif(regexp_replace(account_number,'\D','','g'),'')::bigint), 10000) + 1
    into n from public.customer_accounts where tenant_id = _tenant_id;
  return n::text;
end; $$;

create or replace function public.ensure_ledger_account(_account_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare lid uuid; a public.customer_accounts%rowtype;
begin
  select * into a from public.customer_accounts where id = _account_id;
  if not found then raise exception 'Account not found'; end if;
  select id into lid from public.ledger_accounts where account_id = _account_id;
  if lid is null then
    insert into public.ledger_accounts (tenant_id, account_id, kind, currency_code, balance)
    values (a.tenant_id, a.id, 'CUSTOMER', a.currency_code, a.balance) returning id into lid;
  end if;
  return lid;
end; $$;

create or replace function public.post_credit(
  _account_id uuid, _amount numeric, _type public.transaction_type, _description text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare a public.customer_accounts%rowtype; lid uuid; txid uuid; newbal numeric; dir public.ledger_direction;
begin
  if _amount is null or _amount <= 0 then raise exception 'Amount must be positive'; end if;
  select * into a from public.customer_accounts where id = _account_id for update;
  if not found then raise exception 'Account not found'; end if;
  if not (public.is_super_admin() or a.tenant_id = public.current_user_tenant_id()) then
    raise exception 'Not authorised for this account';
  end if;
  if a.status <> 'ACTIVE' then raise exception 'Account is not active'; end if;

  dir := case when _type in ('CREDIT_DEBIT') then 'DEBIT' else 'CREDIT' end;
  newbal := case when dir = 'CREDIT' then a.balance + _amount else a.balance - _amount end;
  if newbal < 0 then raise exception 'Insufficient available credit'; end if;

  lid := public.ensure_ledger_account(_account_id);
  insert into public.transactions (tenant_id, type, status, amount, currency_code, reference, description, account_id, created_by)
  values (a.tenant_id, _type, 'COMPLETED', _amount, a.currency_code,
          'TX-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)), _description, a.id, auth.uid())
  returning id into txid;

  insert into public.ledger_entries (tenant_id, transaction_id, ledger_account_id, direction, amount, currency_code, balance_after)
  values (a.tenant_id, txid, lid, dir, _amount, a.currency_code, newbal);

  perform set_config('app.ledger_posting','on', true);
  update public.customer_accounts set balance = newbal where id = a.id;
  update public.ledger_accounts set balance = newbal where id = lid;
  perform set_config('app.ledger_posting','off', true);

  insert into public.audit_logs (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, metadata)
  values (a.tenant_id, auth.uid(), public.current_user_role(),
          case when _type = 'INITIAL_CREDIT' then 'CREDIT_ADDED' else 'CREDIT_ADJUSTED' end,
          'customer_account', a.id, jsonb_build_object('amount', _amount, 'type', _type));
  return txid;
end; $$;

create or replace function public.execute_transfer(
  _sender_account_id uuid, _recipient_account_id uuid, _amount numeric, _description text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare s public.customer_accounts%rowtype; r public.customer_accounts%rowtype;
        sl uuid; rl uuid; txid uuid; trid uuid; sbal numeric; rbal numeric; ref text;
begin
  if _amount is null or _amount <= 0 then raise exception 'Amount must be positive'; end if;
  if _sender_account_id = _recipient_account_id then raise exception 'Cannot transfer to the same account'; end if;

  select * into s from public.customer_accounts where id = least(_sender_account_id,_recipient_account_id) for update;
  select * into r from public.customer_accounts where id = greatest(_sender_account_id,_recipient_account_id) for update;
  select * into s from public.customer_accounts where id = _sender_account_id;
  select * into r from public.customer_accounts where id = _recipient_account_id;
  if s.id is null or r.id is null then raise exception 'Account not found'; end if;
  if s.tenant_id <> r.tenant_id then raise exception 'Cross-organization transfers are not allowed'; end if;
  if not (public.is_super_admin() or s.tenant_id = public.current_user_tenant_id()) then
    raise exception 'Not authorised for this organization';
  end if;
  if s.currency_code <> r.currency_code then raise exception 'Currency mismatch'; end if;
  if s.status <> 'ACTIVE' or r.status <> 'ACTIVE' then raise exception 'Both accounts must be active'; end if;
  if s.balance < _amount then raise exception 'Insufficient available credit'; end if;

  ref := 'TRF-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
  insert into public.transfers (tenant_id, sender_account_id, recipient_account_id, amount, currency_code, status, reference, initiated_by)
  values (s.tenant_id, s.id, r.id, _amount, s.currency_code, 'PROCESSING', ref, auth.uid()) returning id into trid;

  insert into public.audit_logs (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, metadata)
  values (s.tenant_id, auth.uid(), public.current_user_role(), 'TRANSFER_INITIATED','transfer',trid, jsonb_build_object('amount',_amount,'reference',ref));

  sl := public.ensure_ledger_account(s.id);
  rl := public.ensure_ledger_account(r.id);
  sbal := s.balance - _amount;
  rbal := r.balance + _amount;

  insert into public.transactions (tenant_id, type, status, amount, currency_code, reference, description, account_id, counterparty_account_id, created_by)
  values (s.tenant_id, 'TRANSFER','COMPLETED', _amount, s.currency_code, 'TX-' || substr(ref,5), _description, s.id, r.id, auth.uid())
  returning id into txid;

  insert into public.ledger_entries (tenant_id, transaction_id, ledger_account_id, direction, amount, currency_code, balance_after)
  values (s.tenant_id, txid, sl, 'DEBIT', _amount, s.currency_code, sbal),
         (s.tenant_id, txid, rl, 'CREDIT', _amount, s.currency_code, rbal);

  perform set_config('app.ledger_posting','on', true);
  update public.customer_accounts set balance = sbal where id = s.id;
  update public.customer_accounts set balance = rbal where id = r.id;
  update public.ledger_accounts set balance = sbal where id = sl;
  update public.ledger_accounts set balance = rbal where id = rl;
  perform set_config('app.ledger_posting','off', true);

  update public.transfers set status = 'COMPLETED', transaction_id = txid, completed_at = now() where id = trid;

  insert into public.audit_logs (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, metadata)
  values (s.tenant_id, auth.uid(), public.current_user_role(), 'TRANSFER_COMPLETED','transfer',trid, jsonb_build_object('amount',_amount,'reference',ref));
  return trid;
end; $$;

create or replace function public.reverse_transfer(_transfer_id uuid, _reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare t public.transfers%rowtype; s public.customer_accounts%rowtype; r public.customer_accounts%rowtype;
        sl uuid; rl uuid; txid uuid; sbal numeric; rbal numeric;
begin
  select * into t from public.transfers where id = _transfer_id for update;
  if not found then raise exception 'Transfer not found'; end if;
  if t.status <> 'COMPLETED' then raise exception 'Only completed transfers can be reversed'; end if;
  if not (public.is_super_admin() or t.tenant_id = public.current_user_tenant_id()) then
    raise exception 'Not authorised'; end if;
  select * into s from public.customer_accounts where id = t.sender_account_id for update;
  select * into r from public.customer_accounts where id = t.recipient_account_id for update;
  if r.balance < t.amount then raise exception 'Recipient has insufficient credit to reverse'; end if;
  sl := public.ensure_ledger_account(s.id); rl := public.ensure_ledger_account(r.id);
  sbal := s.balance + t.amount; rbal := r.balance - t.amount;

  insert into public.transactions (tenant_id, type, status, amount, currency_code, reference, description, account_id, counterparty_account_id, created_by)
  values (t.tenant_id, 'TRANSFER_REVERSAL','COMPLETED', t.amount, t.currency_code,
          'REV-' || substr(t.reference,5), _reason, r.id, s.id, auth.uid()) returning id into txid;

  insert into public.ledger_entries (tenant_id, transaction_id, ledger_account_id, direction, amount, currency_code, balance_after)
  values (t.tenant_id, txid, rl, 'DEBIT', t.amount, t.currency_code, rbal),
         (t.tenant_id, txid, sl, 'CREDIT', t.amount, t.currency_code, sbal);

  perform set_config('app.ledger_posting','on', true);
  update public.customer_accounts set balance = sbal where id = s.id;
  update public.customer_accounts set balance = rbal where id = r.id;
  update public.ledger_accounts set balance = sbal where id = sl;
  update public.ledger_accounts set balance = rbal where id = rl;
  perform set_config('app.ledger_posting','off', true);

  update public.transfers set status = 'REVERSED' where id = t.id;
  insert into public.audit_logs (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, metadata)
  values (t.tenant_id, auth.uid(), public.current_user_role(), 'TRANSFER_REVERSED','transfer',t.id, jsonb_build_object('reason',_reason));
  return txid;
end; $$;

create index idx_customers_tenant on public.customers(tenant_id);
create index idx_accounts_tenant on public.customer_accounts(tenant_id);
create index idx_tx_tenant on public.transactions(tenant_id, created_at desc);
create index idx_audit_tenant on public.audit_logs(tenant_id, created_at desc);