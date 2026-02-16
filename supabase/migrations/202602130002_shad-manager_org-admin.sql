-- Shad Manager - Org onboarding and member management

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
    raise exception 'forbidden' using errcode = '42501';W
  end if;
EW
  return query
  select m.user_id, u.email, m.role, m.created_at
  from public.organization_members m
  join auth.users u on u.id = m.user_id
  where m.organization_id = p_org_id
  order by m.created_at asc;
end;
$$;

create or replace function public.add_org_member_by_email(
  p_org_id uuid,
  p_email text,
  p_role public.app_role default 'staff'
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_email text := lower(trim(p_email));
begin
  if not public.has_org_role(p_org_id, array['owner','admin']::public.app_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = v_email
  limit 1;

  if v_user_id is null then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (p_org_id, v_user_id, p_role)
  on conflict (organization_id, user_id)
  do update set role = excluded.role;

  return v_user_id;
end;
$$;

create or replace function public.update_org_member_role(
  p_org_id uuid,
  p_user_id uuid,
  p_role public.app_role
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_role public.app_role;
  v_owner_count integer;
begin
  if not public.has_org_role(p_org_id, array['owner','admin']::public.app_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select role into v_current_role
  from public.organization_members
  where organization_id = p_org_id
    and user_id = p_user_id;

  if v_current_role is null then
    raise exception 'member not found' using errcode = 'P0002';
  end if;

  if v_current_role = 'owner' and p_role <> 'owner' then
    select count(*) into v_owner_count
    from public.organization_members
    where organization_id = p_org_id
      and role = 'owner';

    if v_owner_count <= 1 then
      raise exception 'cannot remove last owner' using errcode = 'P0001';
    end if;
  end if;

  update public.organization_members
  set role = p_role
  where organization_id = p_org_id
    and user_id = p_user_id;
end;
$$;

create or replace function public.remove_org_member(
  p_org_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_owner_count integer;
  v_is_admin boolean;
begin
  v_is_admin := public.has_org_role(p_org_id, array['owner','admin']::public.app_role[]);
  if not v_is_admin and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select role into v_role
  from public.organization_members
  where organization_id = p_org_id
    and user_id = p_user_id;

  if v_role is null then
    raise exception 'member not found' using errcode = 'P0002';
  end if;

  if v_role = 'owner' then
    select count(*) into v_owner_count
    from public.organization_members
    where organization_id = p_org_id
      and role = 'owner';

    if v_owner_count <= 1 then
      raise exception 'cannot remove last owner' using errcode = 'P0001';
    end if;
  end if;

  delete from public.organization_members
  where organization_id = p_org_id
    and user_id = p_user_id;
end;
$$;

revoke all on function public.get_org_members(uuid) from public;
revoke all on function public.add_org_member_by_email(uuid, text, public.app_role) from public;
revoke all on function public.update_org_member_role(uuid, uuid, public.app_role) from public;
revoke all on function public.remove_org_member(uuid, uuid) from public;

grant execute on function public.get_org_members(uuid) to authenticated, service_role;
grant execute on function public.add_org_member_by_email(uuid, text, public.app_role) to authenticated, service_role;
grant execute on function public.update_org_member_role(uuid, uuid, public.app_role) to authenticated, service_role;
grant execute on function public.remove_org_member(uuid, uuid) to authenticated, service_role;

commit;
