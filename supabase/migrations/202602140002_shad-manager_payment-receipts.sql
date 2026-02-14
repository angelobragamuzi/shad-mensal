alter table public.payments
  add column if not exists receipt_url text,
  add column if not exists receipt_file_name text;

