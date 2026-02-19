-- Shad Manager - Cobrança completa
-- Adds recurring invoice generation and collection action history.

begin;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'collection_contact_channel') THEN
    CREATE TYPE public.collection_contact_channel AS ENUM ('whatsapp', 'email', 'phone', 'manual');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'collection_template_kind') THEN
    CREATE TYPE public.collection_template_kind AS ENUM ('reminder', 'overdue', 'custom');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'collection_event_outcome') THEN
    CREATE TYPE public.collection_event_outcome AS ENUM ('sent', 'failed', 'no_reply', 'promised', 'paid', 'other');
  END IF;
END
$$;

create table if not exists public.collection_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null,
  student_id uuid not null,
  channel public.collection_contact_channel not null,
  template_kind public.collection_template_kind not null default 'custom',
  outcome public.collection_event_outcome not null default 'sent',
  message text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint collection_events_invoice_fk
    foreign key (invoice_id, organization_id)
    references public.invoices(id, organization_id)
    on delete cascade,
  constraint collection_events_student_fk
    foreign key (student_id, organization_id)
    references public.students(id, organization_id)
    on delete cascade
);

create index if not exists idx_collection_events_org_created_at
  on public.collection_events(organization_id, created_at desc);
create index if not exists idx_collection_events_org_invoice
  on public.collection_events(organization_id, invoice_id);
create index if not exists idx_collection_events_org_student
  on public.collection_events(organization_id, student_id);

create or replace function public.generate_invoices_for_period(
  p_org_id uuid,
  p_reference_date date default current_date
)
returns table (
  created_count integer,
  skipped_count integer,
  period_start date,
  period_end date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_start date;
  v_period_end date;
  v_due_date date;
  v_last_day integer;
  v_created integer := 0;
  v_skipped integer := 0;
  r_student record;
begin
  if not public.has_org_role(p_org_id, array['owner','admin','staff']::public.app_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_period_start := date_trunc('month', p_reference_date)::date;
  v_period_end := (v_period_start + interval '1 month - 1 day')::date;
  v_last_day := extract(day from v_period_end)::integer;

  for r_student in
    select s.id, s.amount_cents, s.due_day
    from public.students s
    where s.organization_id = p_org_id
      and s.status = 'active'
  loop
    v_due_date := (
      date_trunc('month', v_period_start)::date
      + make_interval(days => greatest(least(r_student.due_day, v_last_day), 1) - 1)
    )::date;

    insert into public.invoices (
      organization_id,
      student_id,
      reference_period_start,
      reference_period_end,
      due_date,
      amount_cents,
      created_by
    )
    values (
      p_org_id,
      r_student.id,
      v_period_start,
      v_period_end,
      v_due_date,
      r_student.amount_cents,
      auth.uid()
    )
    on conflict (organization_id, student_id, reference_period_start)
    do nothing;

    if found then
      v_created := v_created + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  return query
  select v_created, v_skipped, v_period_start, v_period_end;
end;
$$;

create or replace function public.log_collection_event(
  p_org_id uuid,
  p_invoice_id uuid,
  p_channel public.collection_contact_channel,
  p_template_kind public.collection_template_kind default 'custom',
  p_outcome public.collection_event_outcome default 'sent',
  p_message text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice record;
  v_event_id uuid;
begin
  if not public.has_org_role(p_org_id, array['owner','admin','staff']::public.app_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select i.id, i.student_id
    into v_invoice
  from public.invoices i
  where i.organization_id = p_org_id
    and i.id = p_invoice_id;

  if v_invoice.id is null then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;

  insert into public.collection_events (
    organization_id,
    invoice_id,
    student_id,
    channel,
    template_kind,
    outcome,
    message,
    notes,
    created_by
  )
  values (
    p_org_id,
    v_invoice.id,
    v_invoice.student_id,
    p_channel,
    p_template_kind,
    p_outcome,
    nullif(trim(coalesce(p_message, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid()
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

grant select, insert, update, delete
  on table public.collection_events
  to authenticated, service_role;

revoke all on function public.generate_invoices_for_period(uuid, date) from public;
revoke all on function public.log_collection_event(
  uuid,
  uuid,
  public.collection_contact_channel,
  public.collection_template_kind,
  public.collection_event_outcome,
  text,
  text
) from public;

grant execute on function public.generate_invoices_for_period(uuid, date)
  to authenticated, service_role;
grant execute on function public.log_collection_event(
  uuid,
  uuid,
  public.collection_contact_channel,
  public.collection_template_kind,
  public.collection_event_outcome,
  text,
  text
)
  to authenticated, service_role;

alter table public.collection_events enable row level security;

DROP POLICY IF EXISTS collection_events_select_member ON public.collection_events;
CREATE POLICY collection_events_select_member
on public.collection_events
for select
to authenticated
using (public.is_org_member(organization_id));

DROP POLICY IF EXISTS collection_events_insert_staff_or_above ON public.collection_events;
CREATE POLICY collection_events_insert_staff_or_above
on public.collection_events
for insert
to authenticated
with check (public.has_org_role(organization_id, array['owner','admin','staff']::public.app_role[]));

DROP POLICY IF EXISTS collection_events_update_staff_or_above ON public.collection_events;
CREATE POLICY collection_events_update_staff_or_above
on public.collection_events
for update
to authenticated
using (public.has_org_role(organization_id, array['owner','admin','staff']::public.app_role[]))
with check (public.has_org_role(organization_id, array['owner','admin','staff']::public.app_role[]));

DROP POLICY IF EXISTS collection_events_delete_admin_owner ON public.collection_events;
CREATE POLICY collection_events_delete_admin_owner
on public.collection_events
for delete
to authenticated
using (public.has_org_role(organization_id, array['owner','admin']::public.app_role[]));

commit;
