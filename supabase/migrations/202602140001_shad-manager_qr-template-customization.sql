alter table public.organization_settings
  add column if not exists qr_template_logo_url text not null default '';
