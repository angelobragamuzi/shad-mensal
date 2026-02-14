-- Fix get_org_members return types to avoid RPC mismatch

begin;

create or replace function public.get_org_members(p_org_id uuid)
returns table (
  user_id uuid,
  email text,
  role public.app_role,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.has_org_role(p_org_id, array['owner','admin']::public.app_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    m.user_id::uuid,
    u.email::text,
    m.role::public.app_role,
    m.created_at::timestamptz
  from public.organization_members m
  join auth.users u on u.id = m.user_id
  where m.organization_id = p_org_id
  order by m.created_at asc;
end;
$$;

revoke all on function public.get_org_members(uuid) from public;
grant execute on function public.get_org_members(uuid) to authenticated, service_role;

commit;
