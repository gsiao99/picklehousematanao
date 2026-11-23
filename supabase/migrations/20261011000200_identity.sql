-- ============================================================================
-- Identity: profiles, roles, staff permissions, sign-up trigger, access checks
--
-- Security model
--   * Roles and permissions live only in user_roles / staff_permissions.
--   * Nothing in auth.users metadata (user-editable) is ever trusted for access.
--   * Players cannot write either table; only admin RPCs can (see 0900).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 80),
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 40),
  -- Philippine mobile, stored as 09XXXXXXXXX
  phone text check (phone is null or phone ~ '^09[0-9]{9}$'),
  self_rated_level public.player_level,
  -- Level confirmed by staff; drives open play pools. Players cannot set it.
  level public.player_level,
  avatar_path text,
  leaderboard_opt_out boolean not null default false,
  status public.account_status not null default 'active',
  privacy_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_full_name_idx on public.profiles (lower(full_name));

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------------
-- user_roles / staff_permissions
-- ---------------------------------------------------------------------------
create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create index user_roles_role_idx on public.user_roles (role);

create table public.staff_permissions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  permission public.app_permission not null,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, permission)
);

alter table public.user_roles enable row level security;
alter table public.staff_permissions enable row level security;

create trigger user_roles_audit
after insert or update or delete on public.user_roles
for each row execute function private.write_audit();

create trigger staff_permissions_audit
after insert or update or delete on public.staff_permissions
for each row execute function private.write_audit();

create trigger profiles_audit
after update or delete on public.profiles
for each row execute function private.write_audit();

-- ---------------------------------------------------------------------------
-- Access helpers. SECURITY DEFINER so RLS policies can call them without
-- recursion; each reads only the caller's own rows (auth.uid()).
-- ---------------------------------------------------------------------------
create or replace function private.has_role(_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid()
      and ur.role = _role
      and p.status = 'active'
  );
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role('admin');
$$;

-- Staff or admin (front-desk level access).
create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role('staff') or private.has_role('admin');
$$;

-- Admins hold every permission; staff need an explicit grant.
create or replace function private.has_permission(_permission public.app_permission)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin()
      or (
        private.has_role('staff')
        and exists (
          select 1 from public.staff_permissions sp
          where sp.user_id = auth.uid() and sp.permission = _permission
        )
      );
$$;

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active');
$$;

revoke all on function private.has_role(public.app_role), private.is_admin(), private.is_staff(),
  private.has_permission(public.app_permission), private.is_active_user() from public;
grant execute on function private.has_role(public.app_role), private.is_admin(), private.is_staff(),
  private.has_permission(public.app_permission), private.is_active_user() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Sign-up: create the profile and the 'player' role.
-- Only name, phone, level and consent are read from user metadata, each
-- validated; any role or permission in the metadata is ignored.
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  _name text := btrim(coalesce(_meta ->> 'full_name', ''));
  _phone text := regexp_replace(coalesce(_meta ->> 'phone', ''), '[^0-9]', '', 'g');
  _level text := _meta ->> 'self_rated_level';
  _consent boolean := coalesce((_meta ->> 'privacy_consent')::boolean, false);
begin
  if char_length(_name) < 2 then
    _name := coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Player');
  end if;
  if char_length(_name) > 80 then
    _name := left(_name, 80);
  end if;
  if _phone ~ '^639[0-9]{9}$' then
    _phone := '0' || substr(_phone, 3);
  end if;
  if _phone !~ '^09[0-9]{9}$' then
    _phone := null;
  end if;
  if _level is not null and _level not in ('novice', 'low_intermediate', 'high_intermediate', 'advanced') then
    _level := null;
  end if;

  insert into public.profiles (id, full_name, phone, self_rated_level, privacy_consent_at)
  values (new.id, _name, _phone, _level::public.player_level, case when _consent then now() end);

  insert into public.user_roles (user_id, role) values (new.id, 'player');

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS: profiles
-- ---------------------------------------------------------------------------
create policy "Players read their own profile"
on public.profiles for select
to authenticated
using (id = (select auth.uid()));

create policy "Staff read all profiles"
on public.profiles for select
to authenticated
using ((select private.is_staff()));

-- Column grants (0700) limit which columns a player may change.
create policy "Active players update their own profile"
on public.profiles for update
to authenticated
using (id = (select auth.uid()) and (select private.is_active_user()))
with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- RLS: user_roles / staff_permissions — read only. No write policies exist,
-- so direct inserts, updates and deletes are refused for every API caller.
-- ---------------------------------------------------------------------------
create policy "Users read their own roles"
on public.user_roles for select
to authenticated
using (user_id = (select auth.uid()));

create policy "Admins read all roles"
on public.user_roles for select
to authenticated
using ((select private.is_admin()));

create policy "Users read their own permissions"
on public.staff_permissions for select
to authenticated
using (user_id = (select auth.uid()));

create policy "Admins read all permissions"
on public.staff_permissions for select
to authenticated
using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- RLS: audit_log — admins read; nobody writes through the API.
-- ---------------------------------------------------------------------------
create policy "Admins read the audit log"
on public.audit_log for select
to authenticated
using ((select private.is_admin()));
