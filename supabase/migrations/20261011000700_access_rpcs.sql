-- ============================================================================
-- Access RPCs
--
-- Every privileged change goes through these functions. Each one checks the
-- caller's own roles in the database (never anything sent by the client),
-- requires a reason, and is recorded in audit_log by the table triggers.
--
-- Error codes the app maps to messages:
--   42501 insufficient_privilege · 22023 invalid_parameter_value · P0002 no_data_found
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The caller's own effective access (roles, permissions, account status)
-- ---------------------------------------------------------------------------
create or replace function public.get_my_access()
returns table (
  user_id uuid,
  roles public.app_role[],
  permissions public.app_permission[],
  status public.account_status
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    coalesce((select array_agg(ur.role order by ur.role) from public.user_roles ur where ur.user_id = p.id),
             '{}'::public.app_role[]),
    case
      when p.status <> 'active' then '{}'::public.app_permission[]
      when exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = 'admin')
        then enum_range(null::public.app_permission)
      when exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = 'staff')
        then coalesce((select array_agg(sp.permission order by sp.permission)
                       from public.staff_permissions sp where sp.user_id = p.id),
                      '{}'::public.app_permission[])
      else '{}'::public.app_permission[]
    end,
    p.status
  from public.profiles p
  where p.id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Shared guards
-- ---------------------------------------------------------------------------
create or replace function private.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Only administrators can do this.' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.require_reason(_reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if _reason is null or char_length(btrim(_reason)) < 3 then
    raise exception 'Give a short reason for this change.' using errcode = '22023';
  end if;
  return left(btrim(_reason), 300);
end;
$$;

create or replace function private.require_profile(_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = _user_id) then
    raise exception 'That member was not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function private.require_admin(), private.require_reason(text), private.require_profile(uuid) from public;
grant execute on function private.require_admin(), private.require_reason(text), private.require_profile(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Member directory for admins (includes sign-in email from auth.users)
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_members(
  _search text default null,
  _limit int default 50,
  _offset int default 0
)
returns table (
  id uuid,
  full_name text,
  email text,
  phone text,
  roles public.app_role[],
  permissions public.app_permission[],
  status public.account_status,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _pattern text := '%' || replace(replace(replace(coalesce(btrim(_search), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  perform private.require_admin();
  return query
  select
    p.id,
    p.full_name,
    u.email::text,
    p.phone,
    coalesce((select array_agg(ur.role order by ur.role) from public.user_roles ur where ur.user_id = p.id),
             '{}'::public.app_role[]),
    coalesce((select array_agg(sp.permission order by sp.permission) from public.staff_permissions sp
              where sp.user_id = p.id), '{}'::public.app_permission[]),
    p.status,
    p.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where coalesce(btrim(_search), '') = ''
     or p.full_name ilike _pattern
     or u.email ilike _pattern
     or p.phone ilike _pattern
  order by p.full_name
  limit least(greatest(coalesce(_limit, 50), 1), 200)
  offset greatest(coalesce(_offset, 0), 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grant / revoke roles
-- ---------------------------------------------------------------------------
create or replace function public.admin_grant_role(_user_id uuid, _role public.app_role, _reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _why text;
begin
  perform private.require_admin();
  _why := private.require_reason(_reason);
  perform private.require_profile(_user_id);
  if _role is null then
    raise exception 'Choose a role.' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', _why, true);
  insert into public.user_roles (user_id, role, granted_by)
  values (_user_id, _role, auth.uid())
  on conflict (user_id, role) do nothing;
end;
$$;

create or replace function public.admin_revoke_role(_user_id uuid, _role public.app_role, _reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _why text;
begin
  perform private.require_admin();
  _why := private.require_reason(_reason);
  perform private.require_profile(_user_id);
  if _role = 'player' then
    raise exception 'Every member keeps the player role.' using errcode = '22023';
  end if;

  -- Serialise admin changes so two admins cannot remove each other at once.
  perform pg_advisory_xact_lock(hashtext('dd.admin_roles'));

  if _role = 'admin'
     and exists (select 1 from public.user_roles where user_id = _user_id and role = 'admin')
     and (select count(*) from public.user_roles ur join public.profiles p on p.id = ur.user_id
          where ur.role = 'admin' and p.status = 'active') <= 1 then
    raise exception 'At least one administrator must remain.' using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', _why, true);
  delete from public.user_roles where user_id = _user_id and role = _role;
  if _role = 'staff' then
    delete from public.staff_permissions where user_id = _user_id;
  end if;
end;
$$;

-- Replace a staff member's permission set.
create or replace function public.admin_set_staff_permissions(
  _user_id uuid,
  _permissions public.app_permission[],
  _reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _why text;
  _wanted public.app_permission[] := coalesce(_permissions, '{}');
begin
  perform private.require_admin();
  _why := private.require_reason(_reason);
  perform private.require_profile(_user_id);
  if cardinality(_wanted) > 0
     and not exists (select 1 from public.user_roles where user_id = _user_id and role = 'staff') then
    raise exception 'Give this member the staff role before adding permissions.' using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', _why, true);
  delete from public.staff_permissions
  where user_id = _user_id and not (permission = any (_wanted));
  insert into public.staff_permissions (user_id, permission, granted_by)
  select _user_id, p, auth.uid() from unnest(_wanted) as p
  on conflict (user_id, permission) do nothing;
end;
$$;

-- Suspend or reactivate an account.
create or replace function public.admin_set_account_status(
  _user_id uuid,
  _status public.account_status,
  _reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _why text;
begin
  perform private.require_admin();
  _why := private.require_reason(_reason);
  perform private.require_profile(_user_id);
  if _user_id = auth.uid() and _status = 'suspended' then
    raise exception 'You cannot suspend your own account.' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', _why, true);
  update public.profiles set status = _status where id = _user_id;
end;
$$;

-- Confirm a player's level (drives open play pools).
create or replace function public.staff_set_player_level(
  _user_id uuid,
  _level public.player_level,
  _reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _why text;
begin
  if not private.has_permission('players.manage') then
    raise exception 'You do not have permission to change player levels.' using errcode = '42501';
  end if;
  _why := private.require_reason(_reason);
  perform private.require_profile(_user_id);
  perform set_config('app.audit_reason', _why, true);
  update public.profiles set level = _level where id = _user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- First administrator. Run once from the Supabase SQL editor (as postgres):
--   select private.bootstrap_first_admin('owner@example.com');
-- Not callable through the API, and refuses once any admin exists.
-- ---------------------------------------------------------------------------
create or replace function private.bootstrap_first_admin(_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _user_id uuid;
begin
  if exists (select 1 from public.user_roles where role = 'admin') then
    raise exception 'An administrator already exists. Use admin_grant_role instead.' using errcode = '42501';
  end if;
  select id into _user_id from auth.users where lower(email) = lower(btrim(_email));
  if _user_id is null then
    raise exception 'No account uses %. Sign up in the app first, then run this again.', _email
      using errcode = 'P0002';
  end if;
  perform set_config('app.audit_reason', 'Initial administrator provisioning', true);
  insert into public.user_roles (user_id, role) values (_user_id, 'admin') on conflict do nothing;
  return _user_id;
end;
$$;

revoke all on function private.bootstrap_first_admin(text) from public, anon, authenticated, service_role;
