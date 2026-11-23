-- ============================================================================
-- Picklehouse Matanao — foundation
-- Extensions, shared enums, the private helper schema, timestamps, audit log.
--
-- Additive only: creates objects, never drops or rewrites existing data.
-- ============================================================================

create extension if not exists btree_gist with schema extensions;

-- Internal helpers live in `private`, which the Data API does not expose.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('player', 'staff', 'admin');

-- Grantable staff powers. Admins hold all of them implicitly.
create type public.app_permission as enum (
  'payments.verify',
  'bookings.manage',
  'bookings.cancel',
  'schedule.manage',
  'openplay.manage',
  'events.manage',
  'players.manage',
  'content.manage',
  'reports.view'
);

create type public.player_level as enum ('novice', 'low_intermediate', 'high_intermediate', 'advanced');
create type public.account_status as enum ('active', 'suspended');
create type public.court_environment as enum ('indoor', 'outdoor');
create type public.court_status as enum ('active', 'maintenance', 'inactive');
create type public.rate_product as enum ('court_rental', 'open_play');
create type public.payment_method_kind as enum ('gcash', 'maya', 'bank_transfer', 'cash');

create type public.booking_status as enum (
  'cart', 'held', 'pending_verification', 'confirmed', 'rejected', 'expired', 'cancelled', 'completed'
);
create type public.slot_kind as enum ('rental', 'open_play', 'event', 'block', 'maintenance');
create type public.slot_status as enum (
  'held', 'pending_verification', 'confirmed', 'checked_in', 'completed', 'no_show', 'released', 'cancelled'
);
create type public.payment_status as enum ('submitted', 'approved', 'rejected');

create type public.event_type as enum ('open_play', 'tournament', 'clinic', 'league', 'social');
create type public.event_status as enum (
  'draft', 'published', 'registration_open', 'registration_closed', 'ongoing', 'completed', 'cancelled'
);
create type public.registration_status as enum ('pending', 'confirmed', 'waitlisted', 'cancelled', 'rejected');

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit log: append-only. Written by triggers, readable by admins only.
-- RPCs may set `app.audit_reason` (transaction-local) to record why.
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  reason text
);

create index audit_log_occurred_at_idx on public.audit_log (occurred_at desc);
create index audit_log_table_record_idx on public.audit_log (table_name, record_id);
create index audit_log_actor_idx on public.audit_log (actor_id);

alter table public.audit_log enable row level security;

create or replace function private.write_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  _new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  _id text := coalesce(_new ->> 'id', _old ->> 'id',
                       concat_ws(':', coalesce(_new, _old) ->> 'user_id', coalesce(_new, _old) ->> 'role',
                                 coalesce(_new, _old) ->> 'permission'));
begin
  insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data, reason)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    _id,
    _old,
    _new,
    nullif(current_setting('app.audit_reason', true), '')
  );
  return coalesce(new, old);
end;
$$;

revoke all on function private.write_audit() from public;
