-- Add CEP and address number to students
begin;

alter table public.students
  add column if not exists postal_code text,
  add column if not exists address_number text;

commit;
