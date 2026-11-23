-- ============================================================================
-- Court booking engine
--
--   Selection → hold_slots()      held for venue_settings.hold_minutes
--             → confirm_booking() revalidated under a row lock, then confirmed
--             → cancel_booking()  by the player (if policy allows) or staff
--   Expired holds are released by private.expire_stale_holds(), run by
--   pg_cron every minute when available and also before every hold.
--
-- Double booking is impossible: booking_slots_no_overlap (an exclusion
-- constraint) is the final guard under any concurrency. Prices come only
-- from rate_rules; hours only from operating_hours and its exceptions.
-- Nothing is invented: with no hours or rates set, nothing is bookable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
alter table public.venue_settings
  add column max_slots_per_booking int not null default 8 check (max_slots_per_booking between 1 and 48),
  add column player_cancel_cutoff_hours int check (player_cancel_cutoff_hours is null or player_cancel_cutoff_hours between 0 and 720);

comment on column public.venue_settings.player_cancel_cutoff_hours is
  'Players may cancel a confirmed booking up to this many hours before its first slot. NULL: only staff can cancel confirmed bookings.';
comment on column public.venue_settings.hold_minutes is
  'How long selected times are held in a cart before they are released.';

-- ---------------------------------------------------------------------------
-- Bookings: payment progress kept separate from the reservation status
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column payment_status public.booking_payment_status not null default 'unpaid',
  add column confirmed_at timestamptz,
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.profiles (id) on delete set null,
  add column cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 300),
  add column expired_at timestamptz;

create index bookings_player_status_idx on public.bookings (player_id, status);

-- ---------------------------------------------------------------------------
-- Hours: weekly hours on the hour, plus date-specific exceptions
-- ---------------------------------------------------------------------------
alter table public.operating_hours
  add constraint operating_hours_on_the_hour check (
    is_closed or (extract(minute from opens_at) = 0 and extract(second from opens_at) = 0
                  and extract(minute from closes_at) = 0 and extract(second from closes_at) = 0)
  );

create table public.operating_hour_exceptions (
  date date primary key,
  is_closed boolean not null default true,
  opens_at time,
  closes_at time,
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (is_closed or (opens_at is not null and closes_at is not null and opens_at <> closes_at
                       and extract(minute from opens_at) = 0 and extract(minute from closes_at) = 0))
);

create trigger operating_hour_exceptions_set_updated_at
before update on public.operating_hour_exceptions
for each row execute function private.set_updated_at();

create trigger operating_hour_exceptions_audit
after insert or update or delete on public.operating_hour_exceptions
for each row execute function private.write_audit();

alter table public.operating_hour_exceptions enable row level security;

create policy "Anyone reads hour exceptions" on public.operating_hour_exceptions
for select to anon, authenticated using (true);
create policy "Admins manage hour exceptions" on public.operating_hour_exceptions
for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Rates: named tiers (peak / off-peak) and a tie-breaking priority
-- ---------------------------------------------------------------------------
alter table public.rate_rules
  add column tier text not null default 'standard' check (tier in ('peak', 'off_peak', 'standard')),
  add column priority int not null default 0 check (priority between -100 and 100);

-- ---------------------------------------------------------------------------
-- Schedule change signal: a public, data-free table the app subscribes to
-- with Supabase Realtime. It says "this day changed", never who booked.
-- ---------------------------------------------------------------------------
create table public.schedule_signals (
  operating_date date primary key,
  version bigint not null default 1,
  changed_at timestamptz not null default now()
);

alter table public.schedule_signals enable row level security;
create policy "Anyone reads schedule signals" on public.schedule_signals
for select to anon, authenticated using (true);

-- Rows dated 2000-01-01 mean "hours, rates or courts changed: refresh any day".
create or replace function private.bump_schedule_signal(_date date)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.schedule_signals (operating_date) values (_date)
  on conflict (operating_date) do update
    set version = public.schedule_signals.version + 1, changed_at = now();
$$;

create or replace function private.signal_slot_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform private.bump_schedule_signal(new.operating_date);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and (tg_op = 'DELETE' or old.operating_date <> new.operating_date) then
    perform private.bump_schedule_signal(old.operating_date);
  end if;
  return null;
end;
$$;

create or replace function private.signal_config_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.bump_schedule_signal('2000-01-01');
  return null;
end;
$$;

create trigger booking_slots_signal
after insert or update or delete on public.booking_slots
for each row execute function private.signal_slot_change();

create trigger operating_hours_signal after insert or update or delete on public.operating_hours
for each statement execute function private.signal_config_change();
create trigger operating_hour_exceptions_signal after insert or update or delete on public.operating_hour_exceptions
for each statement execute function private.signal_config_change();
create trigger rate_rules_signal after insert or update or delete on public.rate_rules
for each statement execute function private.signal_config_change();
create trigger courts_signal after insert or update or delete on public.courts
for each statement execute function private.signal_config_change();
create trigger venue_settings_signal after update on public.venue_settings
for each statement execute function private.signal_config_change();

-- Expose the signal table to Realtime on Supabase (skipped where Realtime is absent).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.schedule_signals;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Time helpers (venue time zone is Asia/Manila; storage is timestamptz)
-- ---------------------------------------------------------------------------
create or replace function private.venue_time_zone()
returns text
language sql
immutable
as $$ select 'Asia/Manila'::text $$;

-- The operating day a moment belongs to (times before the cutoff belong to the previous day).
create or replace function private.operating_date_of(_ts timestamptz)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _cutoff time;
  _local timestamp := _ts at time zone private.venue_time_zone();
begin
  select operating_day_cutoff into _cutoff from public.venue_settings limit 1;
  _cutoff := coalesce(_cutoff, '04:00');
  return case when _local::time < _cutoff then (_local - interval '1 day')::date else _local::date end;
end;
$$;

-- Keep the slot trigger consistent with the helper above.
create or replace function private.set_operating_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.operating_date := private.operating_date_of(lower(new.slot));
  return new;
end;
$$;

-- "7:00 PM", "12:00 NN", "12:00 MN" in Manila time
create or replace function private.fmt_time(_ts timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select case to_char(_ts at time zone private.venue_time_zone(), 'HH24:MI')
    when '12:00' then '12:00 NN'
    when '00:00' then '12:00 MN'
    else ltrim(to_char(_ts at time zone private.venue_time_zone(), 'HH12:MI AM'), '0')
  end;
$$;

-- Opening window of an operating day, from the exception for that date or the weekly hours.
create or replace function private.operating_window(_date date)
returns table (state text, opens_at timestamptz, closes_at timestamptz, note text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _tz text := private.venue_time_zone();
  _cutoff time;
  _closed boolean;
  _open time;
  _close time;
  _note text;
  _found boolean := false;
begin
  select operating_day_cutoff into _cutoff from public.venue_settings limit 1;
  _cutoff := coalesce(_cutoff, '04:00');

  select e.is_closed, e.opens_at, e.closes_at, e.note into _closed, _open, _close, _note
  from public.operating_hour_exceptions e where e.date = _date;
  _found := found;
  if not _found then
    select h.is_closed, h.opens_at, h.closes_at into _closed, _open, _close
    from public.operating_hours h where h.weekday = extract(dow from _date)::smallint;
    _found := found;
  end if;

  if not _found then
    return query select 'unconfigured'::text, null::timestamptz, null::timestamptz, null::text;
    return;
  end if;
  if _closed then
    return query select 'closed'::text, null::timestamptz, null::timestamptz, _note;
    return;
  end if;

  -- Closing after midnight belongs to the same operating day, capped at the day cutoff.
  if _close <= _open and _close > _cutoff then
    _close := _cutoff;
  end if;

  return query select
    'open'::text,
    (_date + _open) at time zone _tz,
    (case when _close <= _open then _date + 1 else _date end + _close) at time zone _tz,
    _note;
end;
$$;

-- Court rental price for one hour starting at _starts_at, from rate_rules.
-- Court-specific rules win over all-court rules, then higher priority, then newest.
create or replace function private.price_for_slot(_court_id uuid, _starts_at timestamptz)
returns table (rate_id uuid, price_centavos bigint, label text, tier text)
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select private.operating_date_of(_starts_at) as op_date,
           (_starts_at at time zone private.venue_time_zone())::time as local_time
  )
  select r.id, r.price_centavos, r.label, r.tier
  from public.rate_rules r, t
  where r.product = 'court_rental'
    and r.unit = 'per_court_hour'
    and r.is_active
    and (r.court_id is null or r.court_id = _court_id)
    and extract(dow from t.op_date)::smallint = any (r.weekdays)
    and (r.valid_from is null or r.valid_from <= t.op_date)
    and (r.valid_to is null or r.valid_to >= t.op_date)
    and case when r.starts_at < r.ends_at
             then t.local_time >= r.starts_at and t.local_time < r.ends_at
             else t.local_time >= r.starts_at or t.local_time < r.ends_at end
  order by (r.court_id is not null) desc, r.priority desc, r.created_at desc
  limit 1;
$$;

-- Is a slot row currently occupying its court? (held slots count only until their hold expires)
create or replace function private.slot_is_live(_status public.slot_status, _booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when _status in ('released', 'cancelled') then false
    when _status = 'held' then exists (
      select 1 from public.bookings b
      where b.id = _booking_id and b.status = 'held' and b.hold_expires_at > now())
    else true
  end;
$$;

-- ---------------------------------------------------------------------------
-- Expire holds whose time is up and release their slots
-- ---------------------------------------------------------------------------
create or replace function private.expire_stale_holds()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  _ids uuid[];
begin
  with expired as (
    update public.bookings
       set status = 'expired', expired_at = now()
     where status = 'held' and hold_expires_at <= now()
    returning id
  )
  select coalesce(array_agg(id), '{}') into _ids from expired;

  if cardinality(_ids) > 0 then
    update public.booking_slots set status = 'released'
     where booking_id = any (_ids) and status = 'held';
  end if;
  return cardinality(_ids);
end;
$$;

-- ---------------------------------------------------------------------------
-- Public reads: operating day, availability grid, live courts
-- ---------------------------------------------------------------------------
create or replace function public.get_operating_day(_date date)
returns table (
  operating_date date,
  state text,
  opens_at timestamptz,
  closes_at timestamptz,
  note text,
  bookable boolean,
  first_bookable_date date,
  last_bookable_date date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _today date := private.operating_date_of(now());
  _window int;
begin
  select booking_window_days into _window from public.venue_settings limit 1;
  return query
  select _date, w.state, w.opens_at, w.closes_at, w.note,
         (w.state = 'open' and _date between _today and _today + _window),
         _today, _today + _window
  from private.operating_window(_date) w;
end;
$$;

create or replace function public.get_court_availability(_date date)
returns table (
  court_id uuid,
  court_number smallint,
  court_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  price_centavos bigint,
  rate_label text,
  tier text,
  label text,
  is_mine boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _w record;
  _today date := private.operating_date_of(now());
  _window int;
  _uid uuid := auth.uid();
begin
  select * into _w from private.operating_window(_date);
  if _w.state <> 'open' then
    return;
  end if;
  select booking_window_days into _window from public.venue_settings limit 1;

  return query
  select
    c.id, c.number, c.name, h.hour_start, h.hour_start + interval '1 hour',
    case
      when s.id is not null then
        case s.kind
          when 'rental' then
            case when s.status = 'held' then (case when s.mine then 'in_cart' else 'held' end)
                 else (case when s.mine then 'mine' else 'booked' end) end
          when 'maintenance' then 'maintenance'
          when 'block' then 'blocked'
          when 'private_event' then 'private_event'
          else 'event'
        end
      when c.status = 'maintenance' then 'maintenance'
      when h.hour_start <= now() then 'past'
      when _date > _today + _window or _date < _today then 'not_bookable'
      when p.price_centavos is null then 'unpriced'
      else 'available'
    end,
    case when s.id is null and c.status = 'active' then p.price_centavos
         when s.mine then s.price_centavos end,
    p.label,
    p.tier,
    case
      when s.kind in ('event', 'open_play') then coalesce(s.event_title, 'Event')
      when s.kind = 'private_event' then 'Private event'
      when s.kind = 'maintenance' or (s.id is null and c.status = 'maintenance') then 'Maintenance'
      when s.kind = 'block' then 'Unavailable'
    end,
    coalesce(s.mine, false)
  from public.courts c
  cross join lateral generate_series(_w.opens_at, _w.closes_at - interval '1 hour', interval '1 hour') as h(hour_start)
  left join lateral (
    select bs.id, bs.kind, bs.status, bs.price_centavos,
           (b.player_id = _uid and _uid is not null) as mine,
           case when e.status <> 'draft' then e.title end as event_title
    from public.booking_slots bs
    left join public.bookings b on b.id = bs.booking_id
    left join public.events e on e.id = bs.event_id
    where bs.court_id = c.id
      and bs.slot && tstzrange(h.hour_start, h.hour_start + interval '1 hour')
      and private.slot_is_live(bs.status, bs.booking_id)
    order by (bs.kind = 'rental') asc
    limit 1
  ) s on true
  left join lateral private.price_for_slot(c.id, h.hour_start) p on true
  where c.status <> 'inactive'
  order by c.sort_order, c.number, h.hour_start;
end;
$$;

create or replace function public.get_live_courts()
returns table (
  court_id uuid,
  court_number smallint,
  court_name text,
  status text,
  label text,
  until timestamptz,
  next_starts_at timestamptz,
  next_status text,
  as_of timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _today date := private.operating_date_of(now());
  _w record;
begin
  select * into _w from private.operating_window(_today);
  return query
  with live as (
    select bs.court_id, bs.slot, bs.kind, bs.status,
           case when e.status <> 'draft' then e.title end as event_title
    from public.booking_slots bs
    left join public.events e on e.id = bs.event_id
    where bs.operating_date in (_today, _today + 1)
      and bs.status not in ('released', 'cancelled', 'held')
  )
  select
    c.id, c.number, c.name,
    case
      when c.status = 'maintenance' then 'maintenance'
      when cur.kind = 'rental' then 'in_use'
      when cur.kind = 'maintenance' then 'maintenance'
      when cur.kind = 'block' then 'blocked'
      when cur.kind = 'private_event' then 'private_event'
      when cur.kind is not null then 'event'
      when _w.state <> 'open' or now() < _w.opens_at or now() >= _w.closes_at then 'closed'
      else 'available'
    end,
    case
      when cur.kind in ('event', 'open_play') then coalesce(cur.event_title, 'Event')
      when cur.kind = 'private_event' then 'Private event'
      when cur.kind = 'maintenance' or c.status = 'maintenance' then 'Maintenance'
    end,
    upper(cur.slot),
    nxt.starts,
    case nxt.kind
      when 'rental' then 'booked' when 'maintenance' then 'maintenance' when 'block' then 'blocked'
      when 'private_event' then 'private_event' when null then null else 'event' end,
    now()
  from public.courts c
  left join lateral (
    select l.kind, l.slot, l.event_title from live l
    where l.court_id = c.id and l.slot @> now()
    limit 1
  ) cur on true
  left join lateral (
    select lower(l.slot) as starts, l.kind from live l
    where l.court_id = c.id and lower(l.slot) > now()
    order by lower(l.slot)
    limit 1
  ) nxt on true
  where c.status <> 'inactive'
  order by c.sort_order, c.number;
end;
$$;

-- ---------------------------------------------------------------------------
-- Player booking RPCs
-- ---------------------------------------------------------------------------
create or replace function private.require_bookable_player()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to book a court.' using errcode = '42501';
  end if;
  if not private.is_active_user() then
    raise exception 'Your account cannot make bookings right now. Contact the club for help.' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

create or replace function private.recalculate_booking_total(_booking_id uuid)
returns bigint
language sql
security definer
set search_path = ''
as $$
  update public.bookings b
     set total_centavos = coalesce((
       select sum(s.price_centavos) from public.booking_slots s
       where s.booking_id = b.id and s.status not in ('released', 'cancelled')), 0)
   where b.id = _booking_id
  returning b.total_centavos;
$$;

-- Hold one or more court-hours, all or nothing. Adds to the player's open
-- cart if one exists. _slots: [{"court_id": "...", "starts_at": "2026-11-06T14:00:00+08:00"}, …]
create or replace function public.hold_slots(_slots jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := private.require_bookable_player();
  _settings public.venue_settings;
  _booking public.bookings;
  _item record;
  _court public.courts;
  _date date;
  _w record;
  _rate record;
  _today date;
  _count int;
begin
  if _slots is null or jsonb_typeof(_slots) <> 'array' or jsonb_array_length(_slots) = 0 then
    raise exception 'Choose at least one time slot.' using errcode = '22023';
  end if;

  select * into _settings from public.venue_settings limit 1;
  perform private.expire_stale_holds();
  _today := private.operating_date_of(now());

  -- One cart per player; serialise this player's cart changes.
  perform pg_advisory_xact_lock(hashtext('dd.cart'), hashtext(_uid::text));
  select * into _booking from public.bookings
   where player_id = _uid and status = 'held' and hold_expires_at > now()
   order by created_at desc limit 1
   for update;
  if not found then
    insert into public.bookings (player_id, created_by, status, hold_expires_at)
    values (_uid, _uid, 'held', now() + make_interval(mins => _settings.hold_minutes))
    returning * into _booking;
  end if;

  -- Validate and insert in a fixed order to avoid lock-order deadlocks.
  for _item in
    select distinct (e ->> 'court_id')::uuid as court_id, (e ->> 'starts_at')::timestamptz as starts_at
    from jsonb_array_elements(_slots) e
    order by 1, 2
  loop
    if _item.court_id is null or _item.starts_at is null then
      raise exception 'Each slot needs a court and a start time.' using errcode = '22023';
    end if;

    select * into _court from public.courts where id = _item.court_id;
    if not found or _court.status = 'inactive' then
      raise exception 'That court is not available for booking.' using errcode = '22023';
    end if;
    if _court.status = 'maintenance' then
      raise exception '% is closed for maintenance.', _court.name using errcode = '22023';
    end if;
    if extract(epoch from _item.starts_at)::bigint % 3600 <> 0 then
      raise exception 'Bookings start on the hour.' using errcode = '22023';
    end if;
    if _item.starts_at <= now() then
      raise exception '% at % has already started.', _court.name, private.fmt_time(_item.starts_at)
        using errcode = '22023';
    end if;

    _date := private.operating_date_of(_item.starts_at);
    if _date < _today or _date > _today + _settings.booking_window_days then
      raise exception 'You can book up to % days ahead.', _settings.booking_window_days using errcode = '22023';
    end if;

    select * into _w from private.operating_window(_date);
    if _w.state <> 'open' or _item.starts_at < _w.opens_at or _item.starts_at + interval '1 hour' > _w.closes_at then
      raise exception 'The club is not open at % on that day.', private.fmt_time(_item.starts_at) using errcode = '22023';
    end if;

    select * into _rate from private.price_for_slot(_item.court_id, _item.starts_at);
    if _rate.rate_id is null then
      raise exception 'No court rate is set for % at %. Contact the club.', _court.name, private.fmt_time(_item.starts_at)
        using errcode = '22023';
    end if;

    begin
      insert into public.booking_slots (booking_id, court_id, slot, kind, status, price_centavos, price_breakdown, created_by)
      values (
        _booking.id, _item.court_id,
        tstzrange(_item.starts_at, _item.starts_at + interval '1 hour', '[)'),
        'rental', 'held', _rate.price_centavos,
        jsonb_build_object('rate_id', _rate.rate_id, 'label', _rate.label, 'tier', _rate.tier,
                           'price_centavos', _rate.price_centavos),
        _uid
      );
    exception when exclusion_violation then
      raise exception '% at % was just taken. Remove it and try again.', _court.name, private.fmt_time(_item.starts_at)
        using errcode = '23P01',
              detail = jsonb_build_object('court_id', _item.court_id, 'starts_at', _item.starts_at)::text;
    end;
  end loop;

  select count(*) into _count from public.booking_slots
   where booking_id = _booking.id and status = 'held';
  if _count > _settings.max_slots_per_booking then
    raise exception 'One booking can hold up to % court-hours.', _settings.max_slots_per_booking using errcode = '22023';
  end if;

  perform private.recalculate_booking_total(_booking.id);
  return _booking.id;
end;
$$;

-- Remove one hour from the cart.
create or replace function public.release_held_slot(_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := private.require_bookable_player();
  _booking_id uuid;
begin
  select s.booking_id into _booking_id
  from public.booking_slots s join public.bookings b on b.id = s.booking_id
  where s.id = _slot_id and b.player_id = _uid and b.status = 'held' and s.status = 'held'
  for update of s, b;
  if _booking_id is null then
    raise exception 'That time is no longer in your cart.' using errcode = 'P0002';
  end if;

  update public.booking_slots set status = 'released' where id = _slot_id;
  if not exists (select 1 from public.booking_slots where booking_id = _booking_id and status = 'held') then
    update public.bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = _uid,
                               cancel_reason = 'Cart emptied', hold_expires_at = hold_expires_at
     where id = _booking_id;
  end if;
  perform private.recalculate_booking_total(_booking_id);
end;
$$;

-- Confirm a held booking. Revalidates every slot under a row lock.
-- Returns status 'confirmed', or 'expired' when the hold ran out (the
-- release is committed so the times free up immediately).
create or replace function public.confirm_booking(_booking_id uuid)
returns table (status text, booking_id uuid, reference text, total_centavos bigint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _uid uuid := private.require_bookable_player();
  _b public.bookings;
  _s record;
  _w record;
  _count int;
begin
  select * into _b from public.bookings where id = _booking_id for update;
  if not found or _b.player_id <> _uid then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;

  if _b.status = 'confirmed' then
    return query select 'confirmed'::text, _b.id, _b.reference, _b.total_centavos;
    return;
  end if;
  if _b.status <> 'held' then
    raise exception 'This booking can no longer be confirmed.' using errcode = '22023';
  end if;

  if _b.hold_expires_at <= now() then
    update public.bookings set status = 'expired', expired_at = now() where id = _b.id;
    update public.booking_slots set status = 'released' where booking_id = _b.id and booking_slots.status = 'held';
    return query select 'expired'::text, _b.id, _b.reference, 0::bigint;
    return;
  end if;

  select count(*) into _count from public.booking_slots where booking_slots.booking_id = _b.id and booking_slots.status = 'held';
  if _count = 0 then
    raise exception 'Your cart is empty.' using errcode = '22023';
  end if;

  -- Revalidate: still in the future, still within opening hours, court still open.
  for _s in
    select bs.id, bs.slot, c.name as court_name, c.status as court_status
    from public.booking_slots bs join public.courts c on c.id = bs.court_id
    where bs.booking_id = _b.id and bs.status = 'held'
    order by lower(bs.slot)
    for update of bs
  loop
    if lower(_s.slot) <= now() then
      raise exception '% at % has already started. Remove it to continue.', _s.court_name, private.fmt_time(lower(_s.slot))
        using errcode = '22023';
    end if;
    if _s.court_status <> 'active' then
      raise exception '% is no longer available. Remove it to continue.', _s.court_name using errcode = '22023';
    end if;
    select * into _w from private.operating_window(private.operating_date_of(lower(_s.slot)));
    if _w.state <> 'open' or lower(_s.slot) < _w.opens_at or upper(_s.slot) > _w.closes_at then
      raise exception 'The club''s hours changed and % at % is no longer open. Remove it to continue.',
        _s.court_name, private.fmt_time(lower(_s.slot)) using errcode = '22023';
    end if;
  end loop;

  update public.booking_slots set status = 'confirmed' where booking_slots.booking_id = _b.id and booking_slots.status = 'held';
  update public.bookings
     set status = 'confirmed', confirmed_at = now(), hold_expires_at = null
   where id = _b.id;
  perform private.recalculate_booking_total(_b.id);

  return query select 'confirmed'::text, b.id, b.reference, b.total_centavos from public.bookings b where b.id = _b.id;
end;
$$;

-- Cancel a booking. Players: their cart any time; a confirmed booking only
-- if venue_settings.player_cancel_cutoff_hours allows. Staff with
-- bookings.cancel: any held or confirmed booking, with a reason.
create or replace function public.cancel_booking(_booking_id uuid, _reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _b public.bookings;
  _is_owner boolean;
  _is_staff boolean := private.has_permission('bookings.cancel');
  _cutoff int;
  _first timestamptz;
  _why text;
begin
  if _uid is null then
    raise exception 'Sign in to manage bookings.' using errcode = '42501';
  end if;
  select * into _b from public.bookings where id = _booking_id for update;
  if not found then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  _is_owner := _b.player_id = _uid;
  if not _is_owner and not _is_staff then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if _b.status not in ('held', 'confirmed') then
    raise exception 'This booking is already %.', _b.status using errcode = '22023';
  end if;

  select min(lower(slot)) into _first from public.booking_slots
   where booking_slots.booking_id = _b.id and status not in ('released', 'cancelled');

  if _is_staff and not (_is_owner and _b.status = 'held') then
    _why := private.require_reason(_reason);
  elsif _b.status = 'confirmed' then
    if not private.is_active_user() then
      raise exception 'Your account cannot change bookings right now. Contact the club for help.' using errcode = '42501';
    end if;
    select player_cancel_cutoff_hours into _cutoff from public.venue_settings limit 1;
    if _cutoff is null then
      raise exception 'Contact the club to cancel a confirmed booking.' using errcode = '42501';
    end if;
    if _first is not null and _first - now() < make_interval(hours => _cutoff) then
      raise exception 'Bookings can be cancelled up to % hours before the first time slot.', _cutoff using errcode = '42501';
    end if;
    _why := coalesce(nullif(btrim(coalesce(_reason, '')), ''), 'Cancelled by player');
  else
    _why := 'Cart cancelled';
  end if;

  perform set_config('app.audit_reason', _why, true);
  update public.booking_slots set status = 'cancelled'
   where booking_slots.booking_id = _b.id and status in ('held', 'confirmed');
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = _uid, cancel_reason = left(_why, 300),
         hold_expires_at = case when status = 'held' then hold_expires_at end,
         payment_status = case when payment_status in ('paid', 'pending_verification') then 'refund_due'
                               else payment_status end
   where id = _b.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff: blocks, maintenance, private events, and the detailed schedule
-- ---------------------------------------------------------------------------
create or replace function public.staff_block_courts(
  _court_ids uuid[],
  _starts_at timestamptz,
  _ends_at timestamptz,
  _kind public.slot_kind,
  _note text,
  _reason text
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  _why text;
  _court public.courts;
  _ids uuid[] := '{}';
  _id uuid;
  _clash text;
begin
  if not private.has_permission('schedule.manage') then
    raise exception 'You do not have permission to block courts.' using errcode = '42501';
  end if;
  _why := private.require_reason(_reason);
  if _kind not in ('block', 'maintenance', 'private_event') then
    raise exception 'Choose a block, maintenance or private event.' using errcode = '22023';
  end if;
  if _court_ids is null or cardinality(_court_ids) = 0 then
    raise exception 'Choose at least one court.' using errcode = '22023';
  end if;
  if _ends_at <= _starts_at then
    raise exception 'The end time must be after the start time.' using errcode = '22023';
  end if;
  if extract(epoch from _starts_at)::bigint % 3600 <> 0 or extract(epoch from _ends_at)::bigint % 3600 <> 0 then
    raise exception 'Blocks start and end on the hour.' using errcode = '22023';
  end if;

  perform private.expire_stale_holds();
  perform set_config('app.audit_reason', _why, true);

  for _court in select * from public.courts where id = any (_court_ids) order by number loop
    begin
      insert into public.booking_slots (court_id, slot, kind, status, note, created_by)
      values (_court.id, tstzrange(_starts_at, _ends_at, '[)'), _kind, 'confirmed', nullif(btrim(coalesce(_note, '')), ''), auth.uid())
      returning id into _id;
      _ids := _ids || _id;
    exception when exclusion_violation then
      select coalesce('booking ' || b.reference, initcap(replace(bs.kind::text, '_', ' '))) into _clash
      from public.booking_slots bs left join public.bookings b on b.id = bs.booking_id
      where bs.court_id = _court.id and bs.slot && tstzrange(_starts_at, _ends_at, '[)')
        and private.slot_is_live(bs.status, bs.booking_id)
      order by lower(bs.slot) limit 1;
      raise exception '% already has % in that time. Cancel or move it first.', _court.name, coalesce(_clash, 'something')
        using errcode = '23P01';
    end;
  end loop;

  if cardinality(_ids) <> cardinality(_court_ids) then
    raise exception 'One of those courts was not found.' using errcode = 'P0002';
  end if;
  return _ids;
end;
$$;

create or replace function public.staff_remove_block(_slot_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _why text;
begin
  if not private.has_permission('schedule.manage') then
    raise exception 'You do not have permission to change blocks.' using errcode = '42501';
  end if;
  _why := private.require_reason(_reason);
  perform set_config('app.audit_reason', _why, true);
  update public.booking_slots set status = 'cancelled'
   where id = _slot_id and kind in ('block', 'maintenance', 'private_event') and status <> 'cancelled';
  if not found then
    raise exception 'That block was not found.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.staff_get_schedule(_date date)
returns table (
  slot_id uuid,
  court_id uuid,
  court_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  kind public.slot_kind,
  slot_status public.slot_status,
  booking_id uuid,
  booking_reference text,
  booking_status public.booking_status,
  payment_status public.booking_payment_status,
  player_name text,
  player_phone text,
  note text,
  event_title text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.is_staff() then
    raise exception 'Only club staff can view the full schedule.' using errcode = '42501';
  end if;
  return query
  select bs.id, bs.court_id, c.name, lower(bs.slot), upper(bs.slot), bs.kind, bs.status,
         b.id, b.reference, b.status, b.payment_status, p.full_name, p.phone, bs.note, e.title
  from public.booking_slots bs
  join public.courts c on c.id = bs.court_id
  left join public.bookings b on b.id = bs.booking_id
  left join public.profiles p on p.id = b.player_id
  left join public.events e on e.id = bs.event_id
  where bs.operating_date = _date
    and private.slot_is_live(bs.status, bs.booking_id)
  order by c.sort_order, c.number, lower(bs.slot);
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduled hold expiry (pg_cron on Supabase). Without pg_cron, holds still
-- expire: availability ignores them and every hold or confirm releases them.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule('dd-expire-stale-holds', '* * * * *', 'select private.expire_stale_holds()');
    exception when others then
      raise notice 'pg_cron could not be scheduled (%). Enable it in the dashboard and run: select cron.schedule(''dd-expire-stale-holds'', ''* * * * *'', ''select private.expire_stale_holds()'');', sqlerrm;
    end;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- New functions are executable by PUBLIC by default in Postgres, and a
-- per-schema default cannot change that. Remove it globally for objects
-- this role creates from now on, and lock down each function explicitly.
alter default privileges revoke execute on functions from public;

revoke all on function
  private.bump_schedule_signal(date), private.signal_slot_change(), private.signal_config_change(),
  private.operating_date_of(timestamptz), private.fmt_time(timestamptz), private.operating_window(date),
  private.price_for_slot(uuid, timestamptz), private.slot_is_live(public.slot_status, uuid),
  private.expire_stale_holds(), private.require_bookable_player(), private.recalculate_booking_total(uuid),
  private.set_operating_date(), private.venue_time_zone()
  from public, anon, authenticated;

grant execute on function private.slot_is_live(public.slot_status, uuid), private.operating_date_of(timestamptz),
  private.venue_time_zone() to authenticated, service_role;
grant execute on function private.expire_stale_holds() to service_role;

revoke all on function
  public.get_operating_day(date), public.get_court_availability(date), public.get_live_courts(),
  public.hold_slots(jsonb), public.release_held_slot(uuid), public.confirm_booking(uuid),
  public.cancel_booking(uuid, text),
  public.staff_block_courts(uuid[], timestamptz, timestamptz, public.slot_kind, text, text),
  public.staff_remove_block(uuid, text), public.staff_get_schedule(date)
  from public, anon, authenticated;

grant execute on function public.get_operating_day(date), public.get_court_availability(date), public.get_live_courts()
  to anon, authenticated;
grant execute on function
  public.hold_slots(jsonb), public.release_held_slot(uuid), public.confirm_booking(uuid),
  public.cancel_booking(uuid, text),
  public.staff_block_courts(uuid[], timestamptz, timestamptz, public.slot_kind, text, text),
  public.staff_remove_block(uuid, text), public.staff_get_schedule(date)
  to authenticated;

revoke all on public.operating_hour_exceptions, public.schedule_signals from anon, authenticated;
grant select on public.operating_hour_exceptions, public.schedule_signals to anon, authenticated;
grant insert, update, delete on public.operating_hour_exceptions to authenticated;
