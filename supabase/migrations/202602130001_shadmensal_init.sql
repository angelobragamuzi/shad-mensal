-- ShadMensal - Initial Supabase schema
-- Includes multi-tenant tables, RLS policies, and helper RPC functions.

begin;

create extension if not exists pgcrypto;

-- Enum types
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('owner', 'admin', 'staff');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_cycle') THEN
    CREATE TYPE public.billing_cycle AS ENUM ('monthly', 'weekly', 'quarterly');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'student_status') THEN
    CREATE TYPE public.student_status AS ENUM ('active', 'inactive');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_status') THEN
    CREATE TYPE public.invoice_status AS ENUM ('pending', 'partial', 'paid', 'overdue', 'canceled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method') THEN
    CREATE TYPE public.payment_method AS ENUM ('pix', 'cash', 'card', 'transfer', 'other');
  END IF;
END
$$;

-- Core tables
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) >= 2),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  timezone text not null default 'America/Sao_Paulo',
  currency_code text not null default 'BRL',
  whatsapp_template text not null default 'Ola {{student_name}}, sua mensalidade esta em aberto. Podemos regularizar hoje?',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) >= 2),
  phone text not null,
  billing_cycle public.billing_cycle not null default 'monthly',
  amount_cents integer not null check (amount_cents > 0),
  due_day smallint not null check (due_day between 1 and 31),
  status public.student_status not null default 'active',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  student_id uuid not null,
  reference_period_start date not null,
  reference_period_end date not null,
  due_date date not null,
  amount_cents integer not null check (amount_cents > 0),
  paid_amount_cents integer not null default 0 check (paid_amount_cents >= 0),
  status public.invoice_status not null default 'pending',
  paid_at timestamptz,
  canceled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_student_fk
    foreign key (student_id, organization_id)
    references public.students(id, organization_id)
    on delete cascade,
  constraint invoices_period_check check (reference_period_end >= reference_period_start),
  constraint invoices_paid_amount_check check (paid_amount_cents <= amount_cents),
  unique (id, organization_id),
  unique (organization_id, student_id, reference_period_start)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null,
  student_id uuid not null,
  amount_cents integer not null check (amount_cents > 0),
  method public.payment_method not null default 'pix',
  paid_at timestamptz not null default now(),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint payments_invoice_fk
    foreign key (invoice_id, organization_id)
    references public.invoices(id, organization_id)
    on delete cascade,
  constraint payments_student_fk
    foreign key (student_id, organization_id)
    references public.students(id, organization_id)
    on delete cascade
);

-- Indexes
create index if not exists idx_organization_members_user on public.organization_members(user_id);
create index if not exists idx_students_org_status on public.students(organization_id, status);
create index if not exists idx_students_org_due_day on public.students(organization_id, due_day);
create index if not exists idx_invoices_org_status_due on public.invoices(organization_id, status, due_date);
create index if not exists idx_invoices_org_paid_at on public.invoices(organization_id, paid_at);
create index if not exists idx_payments_org_paid_at on public.payments(organization_id, paid_at);
create index if not exists idx_payments_invoice on public.payments(invoice_id);

-- Updated-at trigger helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

DROP TRIGGER IF EXISTS trg_organizations_updated_at ON public.organizations;
CREATE TRIGGER trg_organizations_updated_at
before update on public.organizations
for each row
execute function public.set_updated_at();

DROP TRIGGER IF EXISTS trg_organization_settings_updated_at ON public.organization_settings;
CREATE TRIGGER trg_organization_settings_updated_at
before update on public.organization_settings
for each row
execute function public.set_updated_at();

DROP TRIGGER IF EXISTS trg_students_updated_at ON public.students;
CREATE TRIGGER trg_students_updated_at
before update on public.students
for each row
execute function public.set_updated_at();

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON public.invoices;
CREATE TRIGGER trg_invoices_updated_at
before update on public.invoices
for each row
execute function public.set_updated_at();

-- Membership helper functions used by RLS
create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_org_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(p_org_id uuid, p_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_org_id
      and m.user_id = auth.uid()
      and m.role = any(p_roles)
  );
$$;

-- Keep invoice payment totals in sync when a payment is inserted
create or replace function public.apply_payment_to_invoice()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.invoices i
  set
    paid_amount_cents = least(i.amount_cents, i.paid_amount_cents + new.amount_cents),
    status = case
      when i.paid_amount_cents + new.amount_cents >= i.amount_cents then 'paid'::public.invoice_status
      when i.paid_amount_cents + new.amount_cents > 0 then 'partial'::public.invoice_status
      else 'pending'::public.invoice_status
    end,
    paid_at = case
      when i.paid_amount_cents + new.amount_cents >= i.amount_cents then coalesce(i.paid_at, new.paid_at)
      else i.paid_at
    end,
    updated_at = now()
  where i.id = new.invoice_id
    and i.organization_id = new.organization_id;

  return new;
end;
$$;

DROP TRIGGER IF EXISTS trg_payments_apply_to_invoice ON public.payments;
CREATE TRIGGER trg_payments_apply_to_invoice
after insert on public.payments
for each row
execute function public.apply_payment_to_invoice();

-- RPC: create org + owner membership + default settings
create or replace function public.create_organization(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  insert into public.organizations (name, slug, created_by)
  values (trim(p_name), lower(trim(p_slug)), auth.uid())
  returning id into v_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org_id, auth.uid(), 'owner');

  insert into public.organization_settings (organization_id)
  values (v_org_id);

  return v_org_id;
end;
$$;

-- RPC: dashboard metric aggregator
create or replace function public.get_dashboard_metrics(
  p_org_id uuid,
  p_reference_date date default current_date
)
returns table (
  total_students bigint,
  total_to_receive_cents bigint,
  total_received_cents bigint,
  total_overdue_cents bigint
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_month_start date;
  v_next_month date;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_month_start := date_trunc('month', p_reference_date)::date;
  v_next_month := (v_month_start + interval '1 month')::date;

  return query
  select
    (
      select count(*)
      from public.students s
      where s.organization_id = p_org_id
        and s.status = 'active'
    )::bigint,
    coalesce(
      (
        select sum(i.amount_cents)
        from public.invoices i
        where i.organization_id = p_org_id
          and i.due_date >= v_month_start
          and i.due_date < v_next_month
          and i.status in ('pending', 'partial', 'overdue')
      ),
      0
    )::bigint,
    coalesce(
      (
        select sum(i.paid_amount_cents)
        from public.invoices i
        where i.organization_id = p_org_id
          and i.paid_at is not null
          and i.paid_at::date >= v_month_start
          and i.paid_at::date < v_next_month
      ),
      0
    )::bigint,
    coalesce(
      (
        select sum(i.amount_cents - i.paid_amount_cents)
        from public.invoices i
        where i.organization_id = p_org_id
          and i.status = 'overdue'
      ),
      0
    )::bigint;
end;
$$;

-- RPC: mark overdue invoices (for cron or manual admin action)
create or replace function public.mark_overdue_invoices(p_org_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
  v_claim_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if p_org_id is null then
    if v_claim_role <> 'service_role' then
      raise exception 'service role required when p_org_id is null' using errcode = '42501';
    end if;
  else
    if v_claim_role <> 'service_role'
       and not public.has_org_role(p_org_id, array['owner','admin']::public.app_role[]) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  update public.invoices i
  set
    status = 'overdue',
    updated_at = now()
  where i.status in ('pending', 'partial')
    and i.due_date < current_date
    and (p_org_id is null or i.organization_id = p_org_id);

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- Grants
grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on table
  public.organizations,
  public.organization_members,
  public.organization_settings,
  public.students,
  public.invoices,
  public.payments
to authenticated, service_role;

revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.has_org_role(uuid, public.app_role[]) from public;
revoke all on function public.create_organization(text, text) from public;
revoke all on function public.get_dashboard_metrics(uuid, date) from public;
revoke all on function public.mark_overdue_invoices(uuid) from public;

grant execute on function public.is_org_member(uuid) to authenticated, service_role;
grant execute on function public.has_org_role(uuid, public.app_role[]) to authenticated, service_role;
grant execute on function public.create_organization(text, text) to authenticated, service_role;
grant execute on function public.get_dashboard_metrics(uuid, date) to authenticated, service_role;
grant execute on function public.mark_overdue_invoices(uuid) to authenticated, service_role;

-- RLS
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_settings enable row level security;
alter table public.students enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;

-- organizations policies
DROP POLICY IF EXISTS organizations_select_member ON public.organizations;
CREATE POLICY organizations_select_member
on public.organizations
for select
to authenticated
using (public.is_org_member(id));

DROP POLICY IF EXISTS organizations_insert_creator ON public.organizations;
CREATE POLICY organizations_insert_creator
on public.organizations
for insert
to authenticated
with check (auth.uid() is not null and created_by = auth.uid());

DROP POLICY IF EXISTS organizations_update_admin_owner ON public.organizations;
CREATE POLICY organizations_update_admin_owner
on public.organizations
for update
to authenticated
using (public.has_org_role(id, array['owner','admin']::public.app_role[]))
with check (public.has_org_role(id, array['owner','admin']::public.app_role[]));

DROP POLICY IF EXISTS organizations_delete_owner ON public.organizations;
CREATE POLICY organizations_delete_owner
on public.organizations
for delete
to authenticated
using (public.has_org_role(id, array['owner']::public.app_role[]));

-- organization_members policies
DROP POLICY IF EXISTS organization_members_select_member ON public.organization_members;
CREATE POLICY organization_members_select_member
on public.organization_members
for select
to authenticated
using (public.is_org_member(organization_id));

DROP POLICY IF EXISTS organization_members_insert_admin_owner ON public.organization_members;
CREATE POLICY organization_members_insert_admin_owner
on public.organization_members
for insert
to authenticated
with check (public.has_org_role(organization_id, array['owner','admin']::public.app_role[]));

DROP POLICY IF EXISTS organization_members_update_admin_owner ON public.organization_members;
CREATE POLICY organization_members_update_admin_owner
on public.organization_members
for update
to authenticated
using (public.has_org_role(organization_id, array['owner','admin']::public.app_role[]))
with check (public.has_org_role(organization_id, array['owner','admin']::public.app_role[]));

DROP POLICY IF EXISTS organization_members_delete_admin_owner_or_self ON public.organization_members;
CREATE POLICY organization_members_delete_admin_owner_or_self
on public.organization_members
for delete
to authenticated
using (
  public.has_org_role(organization_id, array['owner','admin']::public.app_role[])
  or user_id = auth.uid()
);

-- organization_settings policies
DROP POLICY IF EXISTS organization_settings_select_member ON public.organization_settings;
CREATE POLICY organization_settings_select_member
on public.organization_settings
for select
to authenticated
using (public.is_org_member(organization_id));

DROP POLICY IF EXISTS organization_settings_insert_admin_owner ON public.organization_settings;
CREATE POLICY organization_settings_insert_admin_owner
on public.organization_settings
for insert
to authenticated
with check (public.has_org_role(organization_id, array['owner','admin']::public.app_role[]));

DROP POLICY IF EXISTS organization_settings_update_admin_owner ON public.organization_settings;
CREATE POLICY organization_settings_update_admin_owner
on public.organization_settings
for update
to authenticated
using (public.has_org_role(organization_id, array['owner','admin']::public.app_role[]))
with check (public.has_org_role(organization_id, array['owner','admin']::public.app_role[]));

DROP POLICY IF EXISTS organization_settings_delete_owner ON public.organization_settings;
CREATE POLICY organization_settings_delete_owner
on public.organization_settings
for delete
to authenticated
using (public.has_org_role(organization_id, array['owner']::public.app_role[]));

-- students policies
DROP POLICY IF EXISTS students_select_member ON public.students;
CREATE POLICY students_select_member
on public.students
for select
to authenticated
using (public.is_org_member(organization_id));

DROP POLICY IF EXISTS students_insert_staff_or_above ON public.students;
CREATE POLICY students_insert_staff_or_above
on public.students
for insert
to authenticated
with check (public.has_org_role(organization_id, array['owner','admin','staff']::public.app_role[]));

DROP POLICY IF EXISTS students_update_staff_or_above ON public.students;
CREATE POLICY students_update_staff_or_above
on public.students
for update
to authenticated
using (public.has_org_role(organization_id, array['owner','admin','staff']::public.app_role[]))
with check (public.has_org_role(organization_id, array['owner','admin','staff']::public.app_role[]));

DROP POLICY IF EXISTS students_delete_admin_owner ON public.students;
CREATE POLICY students_delete_admin_owner
on public.students
for delete
to authenticated
using (public.has_org_role(organization_id, array['owner','admin']::public.app_role[]));

-- invoices policies
DROP POLICY IF EXISTS invoices_select_member ON public.invoices;
CREATE POLICY invoices_select_member
on public.invoices
for select
to authenticated
using (public.is_org_member(organization_id));

DROP POLICY IF EXISTS invoices_insert_staff_or_above ON public.invoices;
CREATE POLICY invoices_insert_staff_or_above
on public.invoices
for insert
to authenticated
with check (public.has_org_role(organization_id, array['owner','admin','staff']::public.app_role[]));

DROP POLICY IF EXISTS invoices_update_staff_or_above ON public.invoices;
CREATE POLICY invoices_update_staff_or_above
on public.invoices
for update
to authenticated
using (public.has_org_role(organization_id, array['owner','admin','staff']::public.app_role[]))
with check (public.has_org_role(organization_id, array['owner','admin','staff']::public.app_role[]));

DROP POLICY IF EXISTS invoices_delete_admin_owner ON public.invoices;
CREATE POLICY invoices_delete_admin_owner
on public.invoices
for delete
to authenticated
using (public.has_org_role(organization_id, array['owner','admin']::public.app_role[]));

-- payments policies
DROP POLICY IF EXISTS payments_select_member ON public.payments;
CREATE POLICY payments_select_member
on public.payments
for select
to authenticated
using (public.is_org_member(organization_id));

DROP POLICY IF EXISTS payments_insert_staff_or_above ON public.payments;
CREATE POLICY payments_insert_staff_or_above
on public.payments
for insert
to authenticated
with check (public.has_org_role(organization_id, array['owner','admin','staff']::public.app_role[]));

DROP POLICY IF EXISTS payments_update_staff_or_above ON public.payments;
CREATE POLICY payments_update_staff_or_above
on public.payments
for update
to authenticated
using (public.has_org_role(organization_id, array['owner','admin','staff']::public.app_role[]))
with check (public.has_org_role(organization_id, array['owner','admin','staff']::public.app_role[]));

DROP POLICY IF EXISTS payments_delete_admin_owner ON public.payments;
CREATE POLICY payments_delete_admin_owner
on public.payments
for delete
to authenticated
using (public.has_org_role(organization_id, array['owner','admin']::public.app_role[]));

commit;
