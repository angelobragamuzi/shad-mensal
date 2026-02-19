-- Shad Manager - Automated billing e-mail log

begin;

create table if not exists public.invoice_email_dispatch_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  recipient_email text not null,
  notification_key text not null,
  notification_kind text not null check (notification_kind in ('pre_due_3', 'due_today', 'overdue_followup')),
  due_date date not null,
  days_offset integer not null,
  status text not null check (status in ('sent', 'failed')),
  provider text,
  error_message text,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_invoice_email_dispatch_logs_org_sent_at
  on public.invoice_email_dispatch_logs(organization_id, sent_at desc);

create index if not exists idx_invoice_email_dispatch_logs_invoice
  on public.invoice_email_dispatch_logs(invoice_id);

create unique index if not exists idx_invoice_email_dispatch_logs_sent_unique
  on public.invoice_email_dispatch_logs(invoice_id, notification_key)
  where status = 'sent';

grant select on table public.invoice_email_dispatch_logs to authenticated, service_role;
grant insert on table public.invoice_email_dispatch_logs to service_role;

alter table public.invoice_email_dispatch_logs enable row level security;

drop policy if exists invoice_email_dispatch_logs_select_member on public.invoice_email_dispatch_logs;
create policy invoice_email_dispatch_logs_select_member
on public.invoice_email_dispatch_logs
for select
to authenticated
using (public.is_org_member(organization_id));

commit;
