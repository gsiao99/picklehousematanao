-- ============================================================================
-- Events: admin-defined categories and events (open play, tournaments, …)
-- Registrations live in 0500 because paid entries link to bookings.
-- ============================================================================

create table public.event_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 1 and 60),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text,
  is_active boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger event_categories_set_updated_at
before update on public.event_categories
for each row execute function private.set_updated_at();

create table public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (char_length(btrim(title)) between 2 and 120),
  event_type public.event_type not null,
  category_id uuid references public.event_categories (id) on delete set null,
  description text,
  level public.player_level,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  capacity int check (capacity is null or capacity > 0),
  fee_centavos bigint not null default 0 check (fee_centavos >= 0),
  fee_unit text not null default 'per_player' check (fee_unit in ('per_player', 'per_team')),
  status public.event_status not null default 'draft',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (registration_closes_at is null or registration_opens_at is null
         or registration_closes_at > registration_opens_at)
);

create index events_starts_at_idx on public.events (starts_at);
create index events_status_idx on public.events (status);
create index events_category_idx on public.events (category_id);

create trigger events_set_updated_at
before update on public.events
for each row execute function private.set_updated_at();

create trigger events_audit
after insert or update or delete on public.events
for each row execute function private.write_audit();

alter table public.event_categories enable row level security;
alter table public.events enable row level security;

-- Who may manage an event: events.manage for any type, openplay.manage for open play.
create or replace function private.can_manage_event_type(_type public.event_type)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission('events.manage')
      or (_type = 'open_play' and private.has_permission('openplay.manage'));
$$;

revoke all on function private.can_manage_event_type(public.event_type) from public;
grant execute on function private.can_manage_event_type(public.event_type) to anon, authenticated, service_role;

create policy "Anyone reads active categories" on public.event_categories
for select to anon, authenticated using (is_active or (select private.has_permission('events.manage')));

create policy "Event managers manage categories" on public.event_categories
for all to authenticated
using ((select private.has_permission('events.manage')))
with check ((select private.has_permission('events.manage')));

create policy "Anyone reads published events" on public.events
for select to anon, authenticated
using (status <> 'draft' or private.can_manage_event_type(event_type));

create policy "Event managers create events" on public.events
for insert to authenticated
with check (private.can_manage_event_type(event_type));

create policy "Event managers update events" on public.events
for update to authenticated
using (private.can_manage_event_type(event_type))
with check (private.can_manage_event_type(event_type));

create policy "Event managers delete draft events" on public.events
for delete to authenticated
using (status = 'draft' and private.can_manage_event_type(event_type));
