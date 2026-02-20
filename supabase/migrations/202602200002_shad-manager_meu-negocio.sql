-- Shad Manager - Meu Negócio
-- Permite criar múltiplos negócios e vincular clientes como funcionários.

begin;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) >= 2),
  description text,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create table if not exists public.business_employees (
  business_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  student_id uuid not null,
  role_label text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (business_id, student_id),
  constraint business_employees_business_fk
    foreign key (business_id, organization_id)
    references public.businesses(id, organization_id)
    on delete cascade,
  constraint business_employees_student_fk
    foreign key (student_id, organization_id)
    references public.students(id, organization_id)
    on delete cascade
);

create index if not exists idx_businesses_org_created_at
  on public.businesses(organization_id, created_at desc);

create unique index if not exists idx_businesses_org_name_unique
  on public.businesses(organization_id, lower(trim(name)));

create index if not exists idx_business_employees_org_business
  on public.business_employees(organization_id, business_id);

create index if not exists idx_business_employees_org_student
  on public.business_employees(organization_id, student_id);

drop trigger if exists trg_businesses_updated_at on public.businesses;
create trigger trg_businesses_updated_at
before update on public.businesses
for each row
execute function public.set_updated_at();

grant select, insert, update, delete on table
  public.businesses,
  public.business_employees
to authenticated, service_role;

alter table public.businesses enable row level security;
alter table public.business_employees enable row level security;

drop policy if exists businesses_select_member on public.businesses;
create policy businesses_select_member
on public.businesses
for select
to authenticated
using (public.is_org_member(organization_id));

drop policy if exists businesses_insert_staff_or_above on public.businesses;
create policy businesses_insert_staff_or_above
on public.businesses
for insert
to authenticated
with check (public.has_org_role(organization_id, array['owner','admin','staff']::public.app_role[]));

drop policy if exists businesses_update_staff_or_above on public.businesses;
create policy businesses_update_staff_or_above
on public.businesses
for update
to authenticated
using (public.has_org_role(organization_id, array['owner','admin','staff']::public.app_role[]))
with check (public.has_org_role(organization_id, array['owner','admin','staff']::public.app_role[]));

drop policy if exists businesses_delete_staff_or_above on public.businesses;
create policy businesses_delete_staff_or_above
on public.businesses
for delete
to authenticated
using (public.has_org_role(organization_id, array['owner','admin','staff']::public.app_role[]));

drop policy if exists business_employees_select_member on public.business_employees;
create policy business_employees_select_member
on public.business_employees
for select
to authenticated
using (public.is_org_member(organization_id));

drop policy if exists business_employees_insert_staff_or_above on public.business_employees;
create policy business_employees_insert_staff_or_above
on public.business_employees
for insert
to authenticated
with check (public.has_org_role(organization_id, array['owner','admin','staff']::public.app_role[]));

drop policy if exists business_employees_update_staff_or_above on public.business_employees;
create policy business_employees_update_staff_or_above
on public.business_employees
for update
to authenticated
using (public.has_org_role(organization_id, array['owner','admin','staff']::public.app_role[]))
with check (public.has_org_role(organization_id, array['owner','admin','staff']::public.app_role[]));

drop policy if exists business_employees_delete_staff_or_above on public.business_employees;
create policy business_employees_delete_staff_or_above
on public.business_employees
for delete
to authenticated
using (public.has_org_role(organization_id, array['owner','admin','staff']::public.app_role[]));

commit;
