-- ============================================================================
-- Community: open play sessions, tournaments and social events
--
--   * events (existing) gain skill ranges and open-play queue rules
--   * event_divisions: per-event divisions built from admin-defined categories
--     (event_categories) with skill range, team size, capacity and fee
--   * event_registrations record the division AND category the player chose;
--     "Who's Playing" reads that, never the player's profile level
--   * capacity and duplicate rules are enforced by a trigger under a
--     per-event advisory lock, so parallel requests cannot exceed them
--   * entry fees reuse the Phase 4 manual payment flow: a paid entry creates a
--     slot-less booking (bookings.event_id) that the player pays like any other
--   * court assignments are booking_slots (kind open_play / event), so the
--     exclusion constraint blocks conflicts with rentals and other events and
--     the live court view and availability grid show them
--   * check_ins record actual attendance (events and court rentals)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.events
  add column skill_min public.player_level,
  add column skill_max public.player_level,
  add column queue_players_per_game smallint not null default 4 check (queue_players_per_game in (2, 4)),
  add column queue_rotation text not null default 'all_off' check (queue_rotation in ('all_off', 'winners_stay')),
  add column queue_max_consecutive smallint not null default 2 check (queue_max_consecutive between 1 and 10),
  add column queue_no_show_rule text not null default 'back_of_queue' check (queue_no_show_rule in ('back_of_queue', 'remove')),
  add column cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 300),
  add constraint events_skill_range check (skill_min is null or skill_max is null or skill_min <= skill_max);

alter table public.events alter column created_by set default auth.uid();

comment on column public.events.capacity is 'Most players (registrants plus partners) with a pending or confirmed entry. NULL: no limit.';
comment on column public.events.level is 'Unused; see skill_min / skill_max.';

alter table public.bookings add column event_id uuid references public.events (id) on delete set null;
comment on column public.bookings.event_id is 'Set for an event entry fee: a booking with no court slots, paid through the normal payment flow.';
create index bookings_event_idx on public.bookings (event_id) where event_id is not null;

-- ---------------------------------------------------------------------------
-- Divisions
-- ---------------------------------------------------------------------------
create table public.event_divisions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  category_id uuid not null references public.event_categories (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  team_size smallint not null default 1 check (team_size in (1, 2)),
  skill_min public.player_level,
  skill_max public.player_level,
  capacity int check (capacity is null or capacity > 0),
  fee_centavos bigint check (fee_centavos is null or fee_centavos >= 0),
  format text not null default 'round_robin' check (format in ('round_robin', 'single_elimination', 'none')),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, name),
  check (skill_min is null or skill_max is null or skill_min <= skill_max)
);

comment on column public.event_divisions.capacity is 'Most entries (teams, or players in singles). NULL: no limit.';
comment on column public.event_divisions.fee_centavos is 'NULL: use the event fee.';

create index event_divisions_event_idx on public.event_divisions (event_id, sort_order);

create trigger event_divisions_set_updated_at before update on public.event_divisions
for each row execute function private.set_updated_at();
create trigger event_divisions_audit after insert or update or delete on public.event_divisions
for each row execute function private.write_audit();

alter table public.event_divisions enable row level security;

create policy "Anyone reads divisions of visible events" on public.event_divisions
for select to anon, authenticated
using (exists (select 1 from public.events e where e.id = event_id
               and (e.status <> 'draft' or private.can_manage_event_type(e.event_type))));

create policy "Event managers manage divisions" on public.event_divisions
for all to authenticated
using (exists (select 1 from public.events e where e.id = event_id and private.can_manage_event_type(e.event_type)))
with check (exists (select 1 from public.events e where e.id = event_id and private.can_manage_event_type(e.event_type)));

grant select on public.event_divisions to anon, authenticated;
grant insert, update, delete on public.event_divisions to authenticated;

-- ---------------------------------------------------------------------------
-- Registrations: division, category, attendance
-- ---------------------------------------------------------------------------
alter table public.event_registrations
  add column division_id uuid references public.event_divisions (id) on delete restrict,
  add column category_id uuid references public.event_categories (id) on delete restrict,
  add column attendance text check (attendance in ('present', 'no_show')),
  add column checked_in_at timestamptz,
  add column checked_in_by uuid references public.profiles (id) on delete set null,
  add column cancelled_at timestamptz,
  add column cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 300),
  add column created_by uuid references public.profiles (id) on delete set null,
  add column seed smallint check (seed is null or seed > 0);

comment on column public.event_registrations.category_id is
  'The category of the division the player registered in, recorded on the registration itself.';

-- One player may enter several divisions of the same event; the one-entry
-- rule is per division (or per event when it has no divisions).
alter table public.event_registrations drop constraint event_registrations_event_id_player_id_key;

create unique index event_registrations_one_active_player on public.event_registrations
  (event_id, coalesce(division_id, '00000000-0000-0000-0000-000000000000'::uuid), player_id)
  where status in ('pending', 'confirmed', 'waitlisted');
create unique index event_registrations_one_active_partner on public.event_registrations
  (event_id, coalesce(division_id, '00000000-0000-0000-0000-000000000000'::uuid), partner_id)
  where partner_id is not null and status in ('pending', 'confirmed', 'waitlisted');
create index event_registrations_event_idx on public.event_registrations (event_id, status);
create index event_registrations_partner_idx on public.event_registrations (partner_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- "Ana R." — or the display name the player chose. Used wherever other
-- players can see a name; full names, emails and phones stay staff-only.
create or replace function private.public_name(_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(p.display_name), ''),
    split_part(btrim(p.full_name), ' ', 1)
      || case when position(' ' in btrim(p.full_name)) > 0
              then ' ' || left(regexp_replace(btrim(p.full_name), '^.*\s', ''), 1) || '.' else '' end)
  from public.profiles p where p.id = _id;
$$;

create or replace function private.level_label(_l public.player_level)
returns text
language sql
immutable
set search_path = ''
as $$
  select case _l when 'novice' then 'Novice' when 'low_intermediate' then 'Low intermediate'
                 when 'high_intermediate' then 'High intermediate' when 'advanced' then 'Advanced' end;
$$;

create or replace function private.skill_text(_min public.player_level, _max public.player_level)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when _min is null and _max is null then 'All levels'
    when _min = _max then private.level_label(_min)
    when _max is null then private.level_label(_min) || ' and up'
    when _min is null then 'Up to ' || private.level_label(_max)
    else private.level_label(_min) || ' to ' || private.level_label(_max) end;
$$;

-- Registration state of an event at this moment.
create or replace function private.registration_state(_e public.events)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when _e.status not in ('published', 'registration_open') then
      case when _e.status in ('registration_closed', 'ongoing') then 'closed' else 'unavailable' end
    when now() >= _e.starts_at then 'closed'
    when _e.registration_opens_at is not null and now() < _e.registration_opens_at then 'not_yet'
    when _e.registration_closes_at is not null and now() >= _e.registration_closes_at then 'closed'
    else 'open' end;
$$;

create or replace function private.require_event_manager(_event_id uuid)
returns public.events
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _e public.events;
begin
  select * into _e from public.events where id = _event_id;
  if not found then
    raise exception 'That event was not found.' using errcode = 'P0002';
  end if;
  if not private.can_manage_event_type(_e.event_type) then
    raise exception 'You do not have permission to manage this event.' using errcode = '42501';
  end if;
  return _e;
end;
$$;

-- People (registrant + partner) holding a place in an event.
create or replace function private.event_people(_event_id uuid, _exclude uuid default null)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(1 + (partner_id is not null)::int), 0)::int
  from public.event_registrations
  where event_id = _event_id and status in ('pending', 'confirmed')
    and (_exclude is null or id <> _exclude);
$$;

create or replace function private.division_entries(_division_id uuid, _exclude uuid default null)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.event_registrations
  where division_id = _division_id and status in ('pending', 'confirmed')
    and (_exclude is null or id <> _exclude);
$$;

-- ---------------------------------------------------------------------------
-- Registration rules (trigger): category snapshot, duplicates, capacity
-- ---------------------------------------------------------------------------
create or replace function private.check_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _e public.events;
  _d public.event_divisions;
  _becoming_active boolean;
begin
  if new.status not in ('pending', 'confirmed', 'waitlisted') then
    return new;
  end if;

  -- Serialise every registration change for this event.
  perform pg_advisory_xact_lock(hashtext('dd.event'), hashtext(new.event_id::text));
  select * into _e from public.events where id = new.event_id;

  if new.division_id is not null then
    select * into _d from public.event_divisions where id = new.division_id;
    if not found or _d.event_id <> new.event_id then
      raise exception 'That division is not part of this event.' using errcode = '22023';
    end if;
    new.category_id := _d.category_id;
    if _d.team_size = 2 and new.partner_id is null then
      raise exception '% is a doubles division. Add your partner.', _d.name using errcode = '22023';
    end if;
    if _d.team_size = 1 and new.partner_id is not null then
      raise exception '% is a singles division.', _d.name using errcode = '22023';
    end if;
  elsif exists (select 1 from public.event_divisions where event_id = new.event_id) then
    raise exception 'Choose a division.' using errcode = '22023';
  end if;

  if new.partner_id = new.player_id then
    raise exception 'Your partner must be another player.' using errcode = '22023';
  end if;

  -- Nobody may hold two live places in the same division (as player or partner).
  if exists (
    select 1 from public.event_registrations r
    where r.id <> new.id and r.event_id = new.event_id
      and r.division_id is not distinct from new.division_id
      and r.status in ('pending', 'confirmed', 'waitlisted')
      and (r.player_id in (new.player_id, new.partner_id) or r.partner_id in (new.player_id, new.partner_id))
  ) then
    raise exception '%', case when new.partner_id is null
      then 'You are already registered for this.'
      else 'You or your partner are already registered for this.' end
      using errcode = '23505';
  end if;

  _becoming_active := tg_op = 'INSERT'
    or old.status not in ('pending', 'confirmed')
    or (old.partner_id is null and new.partner_id is not null)
    or old.division_id is distinct from new.division_id;

  if _becoming_active and new.status in ('pending', 'confirmed') then
    if _e.capacity is not null
       and private.event_people(new.event_id, new.id) + 1 + (new.partner_id is not null)::int > _e.capacity then
      raise exception '% is full.', _e.title using errcode = '22023';
    end if;
    if new.division_id is not null and _d.capacity is not null
       and private.division_entries(new.division_id, new.id) + 1 > _d.capacity then
      raise exception '% is full.', _d.name using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger event_registrations_check
before insert or update of status, division_id, player_id, partner_id on public.event_registrations
for each row execute function private.check_registration();

-- Capacity can't be lowered below the places already taken.
create or replace function private.check_capacity_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _taken int;
begin
  if new.capacity is null or new.capacity >= coalesce(old.capacity, 2147483647) then
    return new;
  end if;
  if tg_table_name = 'events' then
    perform pg_advisory_xact_lock(hashtext('dd.event'), hashtext(new.id::text));
    _taken := private.event_people(new.id);
  else
    perform pg_advisory_xact_lock(hashtext('dd.event'), hashtext(new.event_id::text));
    _taken := private.division_entries(new.id);
  end if;
  if new.capacity < _taken then
    raise exception 'Capacity cannot be lower than the % places already taken.', _taken using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger events_capacity_check before update of capacity on public.events
for each row execute function private.check_capacity_change();
create trigger event_divisions_capacity_check before update of capacity on public.event_divisions
for each row execute function private.check_capacity_change();

-- ---------------------------------------------------------------------------
-- Notifications: new kinds
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'payment_submitted', 'payment_approved', 'payment_rejected', 'booking_cancelled', 'refund_recorded',
  'registration_confirmed', 'registration_pending_payment', 'registration_cancelled', 'partner_added',
  'event_cancelled', 'queue_called', 'match_scheduled'));

-- ---------------------------------------------------------------------------
-- Creating registrations (shared by players and staff)
-- ---------------------------------------------------------------------------
create or replace function private.create_registration(
  _event_id uuid, _division_id uuid, _player_id uuid, _partner_id uuid, _by uuid, _waive_fee boolean, _note text
)
returns table (registration_id uuid, status public.registration_status, booking_id uuid, amount_due_centavos bigint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _e public.events;
  _d public.event_divisions;
  _min public.player_level;
  _max public.player_level;
  _who record;
  _fee bigint;
  _reg uuid;
  _booking uuid;
  _status public.registration_status;
  _hours int;
begin
  select * into _e from public.events where id = _event_id;
  if _division_id is not null then
    select * into _d from public.event_divisions where id = _division_id and event_id = _event_id;
    if not found then
      raise exception 'That division is not part of this event.' using errcode = '22023';
    end if;
  end if;

  -- Skill requirement: staff-assessed level, else the player's own rating.
  _min := coalesce(_d.skill_min, _e.skill_min);
  _max := coalesce(_d.skill_max, _e.skill_max);
  if _min is not null or _max is not null then
    for _who in
      select p.id, p.full_name, coalesce(p.level, p.self_rated_level) as lvl
      from public.profiles p where p.id in (_player_id, _partner_id)
    loop
      if _who.lvl is null then
        raise exception '% has no skill level set. Add it in the profile first.',
          case when _who.id = _player_id and _by = _player_id then 'Your account' else _who.full_name end
          using errcode = '22023';
      end if;
      if (_min is not null and _who.lvl < _min) or (_max is not null and _who.lvl > _max) then
        raise exception 'Level required: %. % %.',
          case when _min is null then 'up to ' || private.level_label(_max)
               when _max is null then private.level_label(_min) || ' or higher'
               when _min = _max then private.level_label(_min)
               else private.level_label(_min) || ' to ' || private.level_label(_max) end,
          case when _who.id = _player_id and _by = _player_id then 'Your level is' else _who.full_name || '''s level is' end,
          private.level_label(_who.lvl)
          using errcode = '22023';
      end if;
    end loop;
  end if;

  _fee := coalesce(_d.fee_centavos, _e.fee_centavos)
          * case when _e.fee_unit = 'per_player' then 1 + (_partner_id is not null)::int else 1 end;
  _status := case when _fee > 0 and not _waive_fee then 'pending' else 'confirmed' end;

  begin
    insert into public.event_registrations (event_id, division_id, player_id, partner_id, status, note, created_by)
    values (_event_id, _division_id, _player_id, _partner_id, _status, nullif(btrim(coalesce(_note, '')), ''), _by)
    returning id into _reg;
  exception when unique_violation then
    raise exception '%', case when sqlerrm like 'duplicate key%' then 'You or your partner are already registered for this.'
                              else sqlerrm end using errcode = '23505';
  end;

  if _fee > 0 then
    select payment_due_hours into _hours from public.venue_settings limit 1;
    insert into public.bookings (player_id, created_by, status, total_centavos, payment_status, confirmed_at, event_id,
                                 payment_due_at, notes)
    values (_player_id, _by, 'confirmed', _fee,
            case when _waive_fee then 'waived'::public.booking_payment_status else 'unpaid'::public.booking_payment_status end,
            now(), _event_id,
            case when _hours is not null and not _waive_fee then least(now() + make_interval(hours => _hours), _e.starts_at) end,
            left('Entry fee: ' || _e.title || coalesce(' · ' || _d.name, ''), 500))
    returning id into _booking;
    update public.event_registrations set booking_id = _booking where id = _reg;
  end if;

  perform private.notify(_player_id,
    case when _status = 'confirmed' then 'registration_confirmed' else 'registration_pending_payment' end,
    case when _status = 'confirmed' then 'You’re in: ' || _e.title else 'Pay to confirm: ' || _e.title end,
    case when _status = 'confirmed' then coalesce(_d.name || ' · ', '') || 'Your place is confirmed.'
         else 'Your place is held. Pay the entry fee of ₱' || to_char(_fee / 100.0, 'FM999,999,990.00')
              || ' to confirm it.' end,
    case when _booking is not null and _status = 'pending' then '/bookings/' || _booking else '/my/events' end);
  if _partner_id is not null then
    perform private.notify(_partner_id, 'partner_added', 'You’ve been added as a partner',
      private.public_name(_player_id) || ' registered you for ' || _e.title || coalesce(' · ' || _d.name, '') || '.',
      '/my/events');
  end if;

  return query select _reg, _status, _booking, case when _status = 'pending' then _fee else 0::bigint end;
end;
$$;

create or replace function private.find_partner(_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _id uuid;
begin
  if _email is null or btrim(_email) = '' then
    return null;
  end if;
  select p.id into _id from auth.users u join public.profiles p on p.id = u.id
  where lower(u.email) = lower(btrim(_email)) and p.status = 'active';
  if _id is null then
    raise exception 'No active player uses that email. Your partner needs an account first.' using errcode = 'P0002';
  end if;
  return _id;
end;
$$;

-- Player registers (optionally with a partner identified by their account email).
create or replace function public.register_for_event(
  _event_id uuid, _division_id uuid default null, _partner_email text default null, _note text default null
)
returns table (registration_id uuid, status public.registration_status, booking_id uuid, amount_due_centavos bigint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _uid uuid := private.require_bookable_player();
  _e public.events;
  _state text;
begin
  select * into _e from public.events where id = _event_id;
  if not found or _e.status = 'draft' then
    raise exception 'That event was not found.' using errcode = 'P0002';
  end if;
  _state := private.registration_state(_e);
  if _state = 'not_yet' then
    raise exception 'Registration opens %.', to_char(_e.registration_opens_at at time zone 'Asia/Manila', 'Dy, Mon FMDD at FMHH12:MI AM')
      using errcode = '22023';
  elsif _state <> 'open' then
    raise exception 'Registration for % is closed.', _e.title using errcode = '22023';
  end if;
  return query select * from private.create_registration(
    _event_id, _division_id, _uid, private.find_partner(_partner_email), _uid, false, _note);
end;
$$;

-- Staff register a player (walk-in); fees can be waived with a reason.
create or replace function public.staff_register_player(
  _event_id uuid, _player_id uuid, _division_id uuid default null, _partner_id uuid default null,
  _waive_fee boolean default false, _reason text default null
)
returns table (registration_id uuid, status public.registration_status, booking_id uuid, amount_due_centavos bigint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _e public.events := private.require_event_manager(_event_id);
begin
  if _e.status in ('cancelled', 'completed', 'draft') then
    raise exception 'Players can only be added to a published event that has not finished.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = _player_id and status = 'active') then
    raise exception 'That player was not found.' using errcode = 'P0002';
  end if;
  perform set_config('app.audit_reason',
    coalesce(nullif(btrim(coalesce(_reason, '')), ''), 'Registered by staff') || case when _waive_fee then ' (fee waived)' else '' end, true);
  if _waive_fee then
    perform private.require_reason(_reason);
  end if;
  return query select * from private.create_registration(
    _event_id, _division_id, _player_id, _partner_id, auth.uid(), _waive_fee, null);
end;
$$;

-- Cancel a registration and settle its fee booking.
create or replace function private.cancel_registration(_reg public.event_registrations, _by uuid, _why text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.audit_reason', _why, true);
  update public.event_registrations
     set status = 'cancelled', cancelled_at = now(), cancel_reason = left(_why, 300)
   where id = _reg.id;
  if _reg.booking_id is not null then
    update public.bookings
       set status = 'cancelled', cancelled_at = now(), cancelled_by = _by, cancel_reason = left(_why, 300),
           payment_status = case when payment_status in ('paid', 'pending_verification') then 'refund_due'
                                 else payment_status end
     where id = _reg.booking_id and status = 'confirmed';
  end if;
end;
$$;

create or replace function public.withdraw_registration(_registration_id uuid, _reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := private.require_bookable_player();
  _r public.event_registrations;
  _e public.events;
begin
  select * into _r from public.event_registrations where id = _registration_id for update;
  -- Either member of a team may withdraw it.
  if not found or _uid not in (_r.player_id, coalesce(_r.partner_id, _r.player_id)) then
    raise exception 'That registration was not found.' using errcode = 'P0002';
  end if;
  if _r.status not in ('pending', 'confirmed', 'waitlisted') then
    raise exception 'This registration is already %.', _r.status using errcode = '22023';
  end if;
  select * into _e from public.events where id = _r.event_id;
  if now() >= _e.starts_at then
    raise exception 'The event has started. Ask the club to withdraw you.' using errcode = '22023';
  end if;
  perform private.cancel_registration(_r, _uid,
    coalesce(nullif(btrim(coalesce(_reason, '')), ''), 'Withdrawn by player'));
  if _r.partner_id is not null then
    perform private.notify(case when _uid = _r.player_id then _r.partner_id else _r.player_id end,
      'registration_cancelled', 'Entry withdrawn: ' || _e.title,
      private.public_name(_uid) || ' withdrew your team''s entry.', '/my/events');
  end if;
end;
$$;

create or replace function public.staff_cancel_registration(_registration_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _r public.event_registrations;
  _e public.events;
  _why text := private.require_reason(_reason);
begin
  select * into _r from public.event_registrations where id = _registration_id for update;
  if not found then
    raise exception 'That registration was not found.' using errcode = 'P0002';
  end if;
  _e := private.require_event_manager(_r.event_id);
  if _r.status not in ('pending', 'confirmed', 'waitlisted') then
    raise exception 'This registration is already %.', _r.status using errcode = '22023';
  end if;
  perform private.cancel_registration(_r, auth.uid(), _why);
  perform private.notify(_r.player_id, 'registration_cancelled', 'Registration cancelled: ' || _e.title, _why, '/my/events');
  if _r.partner_id is not null then
    perform private.notify(_r.partner_id, 'registration_cancelled', 'Registration cancelled: ' || _e.title, _why, '/my/events');
  end if;
end;
$$;

-- A fee booking cancelled or expired elsewhere (payment deadline, staff) frees the place.
create or replace function private.cancel_registrations_for_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('cancelled', 'expired') and old.status is distinct from new.status then
    update public.event_registrations
       set status = 'cancelled', cancelled_at = now(),
           cancel_reason = left(coalesce(new.cancel_reason, 'Entry fee booking ' || new.status), 300)
     where booking_id = new.id and status in ('pending', 'confirmed', 'waitlisted');
  end if;
  return null;
end;
$$;

create trigger bookings_cancel_registrations after update of status on public.bookings
for each row execute function private.cancel_registrations_for_booking();

-- An entry fee settled by any route (receipt approved, cash at the desk, waived)
-- confirms the entry.
create or replace function private.confirm_registrations_for_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _r record;
begin
  if new.payment_status in ('paid', 'waived') and old.payment_status is distinct from new.payment_status
     and new.status = 'confirmed' then
    for _r in
      update public.event_registrations set status = 'confirmed'
       where booking_id = new.id and status = 'pending'
      returning player_id, event_id
    loop
      perform private.notify(_r.player_id, 'registration_confirmed', 'You’re in: ' || e.title,
        'Your entry fee was received. Your place is confirmed.', '/my/events')
      from public.events e where e.id = _r.event_id;
    end loop;
  end if;
  return null;
end;
$$;

create trigger bookings_confirm_registrations after update of payment_status on public.bookings
for each row execute function private.confirm_registrations_for_booking();

-- Payment deadline job: same as before, with wording for entry fees.
create or replace function private.expire_unpaid_bookings()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  _b record;
  _n int := 0;
begin
  for _b in
    select b.id, b.player_id, b.reference, b.event_id, e.title
    from public.bookings b left join public.events e on e.id = b.event_id
    where b.status = 'confirmed' and b.payment_status = 'unpaid'
      and b.payment_due_at is not null and b.payment_due_at <= now()
    for update of b skip locked
  loop
    perform set_config('app.audit_reason', 'Payment not received by the deadline', true);
    update public.booking_slots set status = 'cancelled'
     where booking_id = _b.id and status in ('held', 'confirmed');
    update public.bookings
       set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Payment not received by the deadline'
     where id = _b.id;
    perform private.notify(_b.player_id, 'booking_cancelled',
      case when _b.event_id is null then 'Booking cancelled' else 'Entry cancelled: ' || _b.title end,
      case when _b.event_id is null
        then format('%s was cancelled because payment was not received in time. The times are open again.', _b.reference)
        else 'Your entry was cancelled because the fee was not paid in time. The place is open again.' end,
      case when _b.event_id is null then '/bookings/' || _b.id else '/my/events' end);
    _n := _n + 1;
  end loop;
  return _n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Attendance and play history
-- ---------------------------------------------------------------------------
create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles (id) on delete cascade,
  event_id uuid references public.events (id) on delete set null,
  registration_id uuid references public.event_registrations (id) on delete set null,
  booking_id uuid references public.bookings (id) on delete set null,
  checked_in_at timestamptz not null default now(),
  checked_in_by uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('event', 'court_rental'))
);

create unique index check_ins_one_per_registration on public.check_ins (registration_id, player_id) where registration_id is not null;
create unique index check_ins_one_per_booking_day on public.check_ins (booking_id, player_id, ((checked_in_at at time zone 'Asia/Manila')::date))
  where booking_id is not null;
create index check_ins_player_idx on public.check_ins (player_id, checked_in_at desc);

alter table public.check_ins enable row level security;
create policy "Players read their own check-ins" on public.check_ins
for select to authenticated using (player_id = (select auth.uid()));
create policy "Staff read check-ins" on public.check_ins
for select to authenticated using ((select private.is_staff()));
grant select on public.check_ins to authenticated;

create trigger check_ins_audit after insert or update or delete on public.check_ins
for each row execute function private.write_audit();

create or replace function public.staff_check_in(_registration_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _r public.event_registrations;
  _e public.events;
begin
  select * into _r from public.event_registrations where id = _registration_id for update;
  if not found then
    raise exception 'That registration was not found.' using errcode = 'P0002';
  end if;
  _e := private.require_event_manager(_r.event_id);
  if _e.status in ('cancelled', 'draft') then
    raise exception 'This event is not running.' using errcode = '22023';
  end if;
  if _r.status = 'pending' then
    raise exception 'The entry fee has not been confirmed yet.' using errcode = '22023';
  end if;
  if _r.status <> 'confirmed' then
    raise exception 'This registration is %.', _r.status using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', 'Checked in', true);
  update public.event_registrations
     set attendance = 'present', checked_in_at = coalesce(checked_in_at, now()), checked_in_by = auth.uid()
   where id = _r.id;
  insert into public.check_ins (player_id, event_id, registration_id, checked_in_by, kind)
  select p, _r.event_id, _r.id, auth.uid(), 'event'
  from unnest(array[_r.player_id, _r.partner_id]) p where p is not null
  on conflict do nothing;
end;
$$;

create or replace function public.staff_mark_absent(_registration_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _r public.event_registrations;
begin
  select * into _r from public.event_registrations where id = _registration_id for update;
  if not found then
    raise exception 'That registration was not found.' using errcode = 'P0002';
  end if;
  perform private.require_event_manager(_r.event_id);
  if _r.attendance = 'present' then
    raise exception 'This player is already checked in.' using errcode = '22023';
  end if;
  if _r.status <> 'confirmed' then
    raise exception 'This registration is %.', _r.status using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', 'Marked no-show', true);
  update public.event_registrations set attendance = 'no_show' where id = _r.id;
end;
$$;

-- Court rental check-in at the desk (today's hours of a confirmed booking).
create or replace function public.staff_check_in_booking(_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _b public.bookings;
  _today date := private.operating_date_of(now());
begin
  if not private.has_permission('bookings.manage') then
    raise exception 'You do not have permission to check in bookings.' using errcode = '42501';
  end if;
  select * into _b from public.bookings where id = _booking_id for update;
  if not found then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if _b.status <> 'confirmed' then
    raise exception 'Only confirmed bookings can be checked in.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.booking_slots where booking_id = _b.id and operating_date = _today
                 and status in ('confirmed', 'checked_in')) then
    raise exception 'This booking has no court time today.' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', 'Checked in at the desk', true);
  update public.booking_slots set status = 'checked_in'
   where booking_id = _b.id and operating_date = _today and status = 'confirmed';
  insert into public.check_ins (player_id, booking_id, checked_in_by, kind)
  values (_b.player_id, _b.id, auth.uid(), 'court_rental')
  on conflict do nothing;
end;
$$;

create or replace function public.get_my_play_history(_limit int default 100)
returns table (
  check_in_id uuid, checked_in_at timestamptz, kind text, event_type public.event_type, title text,
  detail text, event_slug text, booking_id uuid, booking_reference text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.checked_in_at, c.kind, e.event_type,
         case when c.kind = 'event' then e.title else 'Court rental' end,
         case when c.kind = 'event' then coalesce(d.name, private.skill_text(e.skill_min, e.skill_max))
              else (select string_agg(distinct ct.name, ', ' order by ct.name)
                    from public.booking_slots s join public.courts ct on ct.id = s.court_id
                    where s.booking_id = c.booking_id
                      and s.operating_date = private.operating_date_of(c.checked_in_at)) end,
         e.slug, c.booking_id, b.reference
  from public.check_ins c
  left join public.events e on e.id = c.event_id
  left join public.event_registrations r on r.id = c.registration_id
  left join public.event_divisions d on d.id = r.division_id
  left join public.bookings b on b.id = c.booking_id
  where c.player_id = auth.uid()
  order by c.checked_in_at desc
  limit least(greatest(coalesce(_limit, 100), 1), 500);
$$;

-- ---------------------------------------------------------------------------
-- Court assignments for sessions and events
-- ---------------------------------------------------------------------------
create or replace function public.staff_assign_event_courts(
  _event_id uuid, _court_ids uuid[], _starts_at timestamptz, _ends_at timestamptz, _reason text default null
)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _e public.events := private.require_event_manager(_event_id);
  _court public.courts;
  _clash record;
  _id uuid;
begin
  if _e.status in ('cancelled', 'completed') then
    raise exception 'This event is %.', _e.status using errcode = '22023';
  end if;
  if coalesce(cardinality(_court_ids), 0) = 0 then
    raise exception 'Choose at least one court.' using errcode = '22023';
  end if;
  if _ends_at <= _starts_at then
    raise exception 'The end time must be after the start time.' using errcode = '22023';
  end if;
  if _starts_at < _e.starts_at or _ends_at > _e.ends_at then
    raise exception 'Court times must fall within the event (% to %).',
      private.fmt_time(_e.starts_at), private.fmt_time(_e.ends_at) using errcode = '22023';
  end if;
  perform private.expire_stale_holds();
  perform set_config('app.audit_reason', coalesce(nullif(btrim(coalesce(_reason, '')), ''), 'Courts assigned to ' || _e.title), true);

  for _court in select * from public.courts where id = any (_court_ids) order by sort_order, number loop
    if _court.status = 'inactive' then
      raise exception '% is not in use.', _court.name using errcode = '22023';
    end if;
    begin
      insert into public.booking_slots (event_id, court_id, slot, kind, status, price_centavos, note, created_by)
      values (_e.id, _court.id, tstzrange(_starts_at, _ends_at, '[)'),
              case when _e.event_type = 'open_play' then 'open_play'::public.slot_kind else 'event'::public.slot_kind end,
              'confirmed', 0, left(_e.title, 300), auth.uid())
      returning id into _id;
    exception when exclusion_violation then
      select s.kind, b.reference, ev.title, lower(s.slot) as starts into _clash
      from public.booking_slots s
      left join public.bookings b on b.id = s.booking_id
      left join public.events ev on ev.id = s.event_id
      where s.court_id = _court.id and s.slot && tstzrange(_starts_at, _ends_at, '[)')
        and private.slot_is_live(s.status, s.booking_id)
      order by lower(s.slot) limit 1;
      raise exception '% is already taken at % (%).', _court.name, private.fmt_time(_clash.starts),
        case when _clash.reference is not null then 'booking ' || _clash.reference
             when _clash.title is not null then _clash.title
             else replace(_clash.kind::text, '_', ' ') end
        using errcode = '23P01';
    end;
    return next _id;
  end loop;
end;
$$;

create or replace function public.staff_release_event_court(_slot_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _s public.booking_slots;
  _why text := private.require_reason(_reason);
begin
  select * into _s from public.booking_slots where id = _slot_id and kind in ('open_play', 'event') for update;
  if not found then
    raise exception 'That court assignment was not found.' using errcode = 'P0002';
  end if;
  perform private.require_event_manager(_s.event_id);
  if _s.status in ('cancelled', 'released') then
    raise exception 'That court was already released.' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', _why, true);
  update public.booking_slots set status = 'cancelled' where id = _s.id;
end;
$$;

-- Cancelling an event (any route) releases courts, cancels entries, settles fees.
create or replace function private.on_event_cancelled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _r public.event_registrations;
  _why text;
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    _why := coalesce(new.cancel_reason, 'Event cancelled');
    update public.booking_slots set status = 'cancelled'
     where event_id = new.id and status not in ('cancelled', 'released');
    for _r in select * from public.event_registrations
              where event_id = new.id and status in ('pending', 'confirmed', 'waitlisted') loop
      perform private.cancel_registration(_r, auth.uid(), _why);
      perform private.notify(_r.player_id, 'event_cancelled', 'Cancelled: ' || new.title, _why, '/my/events');
      if _r.partner_id is not null then
        perform private.notify(_r.partner_id, 'event_cancelled', 'Cancelled: ' || new.title, _why, '/my/events');
      end if;
    end loop;
  end if;
  return null;
end;
$$;

create trigger events_on_cancelled after update of status on public.events
for each row execute function private.on_event_cancelled();

create or replace function public.staff_cancel_event(_event_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _e public.events := private.require_event_manager(_event_id);
  _why text := private.require_reason(_reason);
begin
  if _e.status in ('cancelled', 'completed') then
    raise exception 'This event is already %.', _e.status using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', _why, true);
  update public.events set status = 'cancelled', cancel_reason = left(_why, 300) where id = _e.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reading events
-- ---------------------------------------------------------------------------
-- Published sessions and events with live place counts. No player data.
create or replace function public.get_events(
  _slug text default null, _type public.event_type default null, _include_past boolean default false
)
returns table (
  id uuid, slug text, title text, event_type public.event_type, status public.event_status,
  category_name text, description text, starts_at timestamptz, ends_at timestamptz,
  registration_opens_at timestamptz, registration_closes_at timestamptz, registration_state text,
  capacity int, players_registered int, spots_left int, fee_centavos bigint, fee_unit text,
  skill_min public.player_level, skill_max public.player_level, skill_text text,
  courts jsonb, divisions jsonb, cancel_reason text,
  queue_players_per_game smallint, queue_rotation text, queue_max_consecutive smallint, queue_no_show_rule text
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.slug, e.title, e.event_type, e.status, c.name, e.description, e.starts_at, e.ends_at,
         e.registration_opens_at, e.registration_closes_at, private.registration_state(e),
         e.capacity, private.event_people(e.id),
         case when e.capacity is null then null else greatest(e.capacity - private.event_people(e.id), 0) end,
         e.fee_centavos, e.fee_unit, e.skill_min, e.skill_max, private.skill_text(e.skill_min, e.skill_max),
         coalesce((select jsonb_agg(jsonb_build_object('slot_id', s.id, 'court_id', s.court_id, 'court_name', ct.name,
                                    'starts_at', lower(s.slot), 'ends_at', upper(s.slot)) order by lower(s.slot), ct.sort_order)
                   from public.booking_slots s join public.courts ct on ct.id = s.court_id
                   where s.event_id = e.id and s.status not in ('cancelled', 'released')), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', d.id, 'name', d.name, 'category_id', d.category_id, 'category_name', dc.name,
                     'team_size', d.team_size, 'skill_min', d.skill_min, 'skill_max', d.skill_max,
                     'skill_text', private.skill_text(coalesce(d.skill_min, e.skill_min), coalesce(d.skill_max, e.skill_max)),
                     'capacity', d.capacity, 'entries', private.division_entries(d.id),
                     'fee_centavos', coalesce(d.fee_centavos, e.fee_centavos), 'format', d.format) order by d.sort_order, d.name)
                   from public.event_divisions d join public.event_categories dc on dc.id = d.category_id
                   where d.event_id = e.id), '[]'::jsonb),
         e.cancel_reason, e.queue_players_per_game, e.queue_rotation, e.queue_max_consecutive, e.queue_no_show_rule
  from public.events e
  left join public.event_categories c on c.id = e.category_id
  where (e.status <> 'draft' or private.can_manage_event_type(e.event_type))
    and (_slug is null or e.slug = _slug)
    and (_type is null or e.event_type = _type)
    and (_slug is not null or _include_past or e.ends_at > now())
    and (_slug is not null or e.status <> 'draft')
  order by e.starts_at
  limit 200;
$$;

-- "Who's Playing": the division and category each entry registered in.
-- Signed-in players only; names are short public names, never contact details.
create or replace function public.get_whos_playing(_event_id uuid)
returns table (
  registration_id uuid, division_id uuid, division_name text, category_name text, team_size smallint,
  player_name text, partner_name text, status public.registration_status, checked_in boolean, is_me boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _e public.events;
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'Sign in to see who is playing.' using errcode = '42501';
  end if;
  select * into _e from public.events where id = _event_id;
  if not found or (_e.status = 'draft' and not private.can_manage_event_type(_e.event_type)) then
    raise exception 'That event was not found.' using errcode = 'P0002';
  end if;
  return query
  select r.id, r.division_id, d.name, c.name, d.team_size,
         private.public_name(r.player_id), private.public_name(r.partner_id),
         r.status, r.attendance = 'present',
         auth.uid() in (r.player_id, r.partner_id)
  from public.event_registrations r
  left join public.event_divisions d on d.id = r.division_id
  left join public.event_categories c on c.id = r.category_id
  where r.event_id = _event_id and r.status in ('pending', 'confirmed')
  order by d.sort_order nulls first, d.name, r.created_at;
end;
$$;

create or replace function public.get_my_registrations()
returns table (
  registration_id uuid, event_id uuid, event_slug text, event_title text, event_type public.event_type,
  event_status public.event_status, starts_at timestamptz, ends_at timestamptz,
  division_name text, category_name text, role text, player_name text, partner_name text,
  status public.registration_status, attendance text, booking_id uuid, booking_reference text,
  payment_status public.booking_payment_status, fee_centavos bigint, created_at timestamptz, cancel_reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, e.id, e.slug, e.title, e.event_type, e.status, e.starts_at, e.ends_at, d.name, c.name,
         case when r.player_id = auth.uid() then 'registrant' else 'partner' end,
         private.public_name(r.player_id), private.public_name(r.partner_id),
         r.status, r.attendance, b.id, b.reference, b.payment_status, b.total_centavos, r.created_at, r.cancel_reason
  from public.event_registrations r
  join public.events e on e.id = r.event_id
  left join public.event_divisions d on d.id = r.division_id
  left join public.event_categories c on c.id = r.category_id
  left join public.bookings b on b.id = r.booking_id
  where auth.uid() in (r.player_id, r.partner_id)
  order by e.starts_at desc, r.created_at desc;
$$;

create or replace function public.get_my_payments()
returns table (
  payment_id uuid, status public.payment_status, method_kind public.payment_method_kind, amount_centavos bigint,
  reference_no text, submitted_at timestamptz, reviewed_at timestamptz, review_note text,
  booking_id uuid, booking_reference text, booking_payment_status public.booking_payment_status, purpose text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.status, p.method_kind, p.amount_centavos, p.reference_no, p.created_at, p.reviewed_at,
         case when p.status = 'rejected' then p.review_note end,
         b.id, b.reference, b.payment_status,
         case when b.event_id is not null then 'Entry fee · ' || e.title else 'Court booking' end
  from public.payments p
  join public.bookings b on b.id = p.booking_id
  left join public.events e on e.id = b.event_id
  where b.player_id = auth.uid()
  order by p.created_at desc;
$$;

-- Staff registration list with contact details and attendance.
create or replace function public.staff_list_registrations(_event_id uuid)
returns table (
  registration_id uuid, division_id uuid, division_name text, category_name text,
  player_id uuid, player_name text, player_phone text, player_level public.player_level,
  partner_id uuid, partner_name text, status public.registration_status, attendance text,
  checked_in_at timestamptz, booking_id uuid, booking_reference text, payment_status public.booking_payment_status,
  fee_centavos bigint, seed smallint, created_at timestamptz, cancel_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_event_manager(_event_id);
  return query
  select r.id, r.division_id, d.name, c.name, r.player_id, p.full_name, p.phone, coalesce(p.level, p.self_rated_level),
         r.partner_id, pp.full_name, r.status, r.attendance, r.checked_in_at, b.id, b.reference, b.payment_status,
         b.total_centavos, r.seed, r.created_at, r.cancel_reason
  from public.event_registrations r
  join public.profiles p on p.id = r.player_id
  left join public.profiles pp on pp.id = r.partner_id
  left join public.event_divisions d on d.id = r.division_id
  left join public.event_categories c on c.id = r.category_id
  left join public.bookings b on b.id = r.booking_id
  where r.event_id = _event_id
  order by (r.status in ('pending', 'confirmed')) desc, d.sort_order nulls first, d.name, r.created_at;
end;
$$;

-- Staff: find a player to add (name, phone or email).
create or replace function public.staff_find_players(_query text)
returns table (player_id uuid, full_name text, phone text, level public.player_level)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _q text := nullif(btrim(coalesce(_query, '')), '');
begin
  if not (private.has_permission('events.manage') or private.has_permission('openplay.manage')) then
    raise exception 'You do not have permission to add players to events.' using errcode = '42501';
  end if;
  if _q is null or char_length(_q) < 2 then
    return;
  end if;
  return query
  select p.id, p.full_name, p.phone, coalesce(p.level, p.self_rated_level)
  from public.profiles p join auth.users u on u.id = p.id
  where p.status = 'active'
    and (p.full_name ilike '%' || _q || '%' or p.phone like '%' || _q || '%' or lower(u.email) = lower(_q))
  order by p.full_name
  limit 20;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function
  private.public_name(uuid), private.level_label(public.player_level),
  private.skill_text(public.player_level, public.player_level), private.registration_state(public.events),
  private.require_event_manager(uuid), private.event_people(uuid, uuid), private.division_entries(uuid, uuid),
  private.check_registration(), private.check_capacity_change(),
  private.create_registration(uuid, uuid, uuid, uuid, uuid, boolean, text), private.find_partner(text),
  private.cancel_registration(public.event_registrations, uuid, text), private.cancel_registrations_for_booking(),
  private.confirm_registrations_for_booking(), private.on_event_cancelled()
  from public, anon, authenticated;

revoke all on function
  public.register_for_event(uuid, uuid, text, text),
  public.staff_register_player(uuid, uuid, uuid, uuid, boolean, text),
  public.withdraw_registration(uuid, text), public.staff_cancel_registration(uuid, text),
  public.staff_check_in(uuid), public.staff_mark_absent(uuid), public.staff_check_in_booking(uuid),
  public.get_my_play_history(int),
  public.staff_assign_event_courts(uuid, uuid[], timestamptz, timestamptz, text),
  public.staff_release_event_court(uuid, text), public.staff_cancel_event(uuid, text),
  public.get_events(text, public.event_type, boolean), public.get_whos_playing(uuid),
  public.get_my_registrations(), public.get_my_payments(), public.staff_list_registrations(uuid),
  public.staff_find_players(text)
  from public, anon, authenticated;

grant execute on function public.get_events(text, public.event_type, boolean) to anon, authenticated;
grant execute on function
  public.register_for_event(uuid, uuid, text, text),
  public.staff_register_player(uuid, uuid, uuid, uuid, boolean, text),
  public.withdraw_registration(uuid, text), public.staff_cancel_registration(uuid, text),
  public.staff_check_in(uuid), public.staff_mark_absent(uuid), public.staff_check_in_booking(uuid),
  public.get_my_play_history(int),
  public.staff_assign_event_courts(uuid, uuid[], timestamptz, timestamptz, text),
  public.staff_release_event_court(uuid, text), public.staff_cancel_event(uuid, text),
  public.get_whos_playing(uuid), public.get_my_registrations(), public.get_my_payments(),
  public.staff_list_registrations(uuid), public.staff_find_players(text)
  to authenticated;
