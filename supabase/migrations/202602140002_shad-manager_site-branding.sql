alter table public.organization_settings
  add column if not exists site_logo_url text not null default '',
  add column if not exists site_accent_color text not null default '#f07f1d';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'organization_settings_site_accent_color_check'
      and conrelid = 'public.organization_settings'::regclass
  ) then
    alter table public.organization_settings
      add constraint organization_settings_site_accent_color_check
      check (site_accent_color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end
$$;
