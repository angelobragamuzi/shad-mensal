alter table public.organization_settings
  add column if not exists pix_payment_enabled boolean not null default false,
  add column if not exists pix_key text not null default '',
  add column if not exists pix_merchant_name text not null default 'Shad Manager',
  add column if not exists pix_merchant_city text not null default 'Sao Paulo',
  add column if not exists pix_description text not null default '',
  add column if not exists pix_txid text not null default 'SHADMENSAL',
  add column if not exists pix_saved_payload text not null default '',
  add column if not exists pix_saved_qr_image_data_url text not null default '';
