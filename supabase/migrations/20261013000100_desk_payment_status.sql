-- ============================================================================
-- Front desk payment status, and a public name for a court booking
--
--   * bookings.display_name: an optional name the player chooses for the court
--     board ("Team Purple"). Shown publicly on Live courts and the schedule;
--     nothing else about the player ever is.
--   * staff_mark_booking_paid / staff_mark_booking_unpaid: one-step desk
--     actions for the dashboard. Cancelling keeps using cancel_booking.
--   * Live courts and the public schedule tell paid bookings ("booked" /
--     in use) apart from ones still waiting for payment ("pending"/"reserved").
--     The time stays taken either way; only the label changes.
--   * Changing a booking's payment status or name now signals the schedule,
--     so open Live courts pages refresh at once.
--
-- Additive only: new column, new functions, replaced function bodies.
-- ============================================================================

alter table public.bookings
  add column display_name text
  check (display_name is null or char_length(display_name) between 1 and 30);

comment on column public.bookings.display_name is
  'Optional public name for the court board, chosen by the player. Shown to everyone on Live courts.';

-- ---------------------------------------------------------------------------
-- Player (or desk staff): set or clear the court board name
-- ---------------------------------------------------------------------------
create or replace function public.set_booking_display_name(_booking_id uuid, _name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _b public.bookings;
  _clean text;
begin
  if _uid is null then
    raise exception 'Sign in to manage bookings.' using errcode = '42501';
  end if;
  select * into _b from public.bookings where id = _booking_id for update;
  if not found or (_b.player_id <> _uid and not private.has_permission('bookings.manage')) then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if _b.status not in ('held', 'confirmed') then
    raise exception 'This booking can no longer be changed.' using errcode = '22023';
  end if;

  -- One line of plain text: control characters removed, spaces collapsed.
  _clean := nullif(btrim(regexp_replace(regexp_replace(coalesce(_name, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), '');
  if _clean is not null and char_length(_clean) > 30 then
    raise exception 'Keep the court board name to 30 characters or fewer.' using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', 'Court board name changed', true);
  update public.bookings set display_name = _clean where id = _b.id;
  return _clean;
end;
$$;

-- ---------------------------------------------------------------------------
-- Desk: mark a booking paid (approves a waiting receipt, or records payment)
-- ---------------------------------------------------------------------------
create or replace function public.staff_mark_booking_paid(_booking_id uuid, _note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _b public.bookings;
  _why text := coalesce(nullif(left(btrim(coalesce(_note, '')), 300), ''), 'Marked paid at the desk');
  _due bigint;
begin
  if not private.has_permission('payments.verify') then
    raise exception 'You do not have permission to confirm payments.' using errcode = '42501';
  end if;
  select * into _b from public.bookings where id = _booking_id for update;
  if not found then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if _b.player_id = _uid then
    raise exception 'You cannot confirm payment for your own booking. Ask another staff member.' using errcode = '42501';
  end if;
  if _b.status <> 'confirmed' then
    raise exception 'Only an active booking can be marked paid (this one is %).', _b.status using errcode = '22023';
  end if;
  if _b.payment_status in ('paid', 'waived') then
    return;
  end if;
  if _b.payment_status not in ('unpaid', 'pending_verification') then
    raise exception 'This booking''s payment is %; it cannot be marked paid.', replace(_b.payment_status::text, '_', ' ')
      using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', _why, true);

  -- A receipt waiting for review is accepted (unless this staff member sent it).
  update public.payments
     set status = 'approved', reviewed_by = _uid, reviewed_at = now(), review_note = _why
   where booking_id = _b.id and status = 'submitted' and submitted_by is distinct from _uid;

  -- Anything still owed was received at the desk.
  _due := private.amount_due(_b.id);
  if _due > 0 then
    insert into public.payments (booking_id, method_kind, amount_centavos, status, submitted_by, reviewed_by, reviewed_at, review_note)
    values (_b.id, 'cash', _due, 'approved', _uid, _uid, now(), _why);
  end if;

  update public.bookings set payment_status = 'paid', payment_due_at = null where id = _b.id;
  update public.event_registrations set status = 'confirmed' where booking_id = _b.id and status = 'pending';

  perform private.notify(_b.player_id, 'payment_approved', 'Booking confirmed',
    format('Your payment for %s is confirmed. See you on court!', _b.reference), '/bookings/' || _b.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Desk: put a paid booking back to "pending payment" (a mistake, a bounced
-- transfer). Approved payments are reversed, with the reason recorded.
-- ---------------------------------------------------------------------------
create or replace function public.staff_mark_booking_unpaid(_booking_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _b public.bookings;
  _why text;
begin
  if not private.has_permission('payments.verify') then
    raise exception 'You do not have permission to change payments.' using errcode = '42501';
  end if;
  _why := private.require_reason(_reason);
  select * into _b from public.bookings where id = _booking_id for update;
  if not found then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if _b.player_id = _uid then
    raise exception 'You cannot change payment for your own booking. Ask another staff member.' using errcode = '42501';
  end if;
  if _b.status <> 'confirmed' then
    raise exception 'Only an active booking can be changed (this one is %).', _b.status using errcode = '22023';
  end if;
  if _b.payment_status in ('unpaid', 'pending_verification') then
    return;
  end if;
  if _b.payment_status <> 'paid' then
    raise exception 'This booking''s payment is %; it cannot be set back to pending.', replace(_b.payment_status::text, '_', ' ')
      using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', _why, true);
  update public.payments
     set status = 'rejected', reviewed_by = _uid, reviewed_at = now(), review_note = left('Reversed: ' || _why, 500)
   where booking_id = _b.id and status = 'approved';
  update public.bookings set payment_status = 'unpaid' where id = _b.id;

  perform private.notify(_b.player_id, 'payment_rejected', 'Payment needed',
    format('Your booking %s is waiting for payment again. Reason: %s', _b.reference, _why), '/bookings/' || _b.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Signal the schedule when a booking's payment status or board name changes
-- ---------------------------------------------------------------------------
create or replace function private.signal_booking_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _d date;
begin
  for _d in select distinct operating_date from public.booking_slots where booking_id = new.id loop
    perform private.bump_schedule_signal(_d);
  end loop;
  return null;
end;
$$;

create trigger bookings_signal
after update of payment_status, display_name on public.bookings
for each row
when (old.payment_status is distinct from new.payment_status or old.display_name is distinct from new.display_name)
execute function private.signal_booking_change();

-- ---------------------------------------------------------------------------
-- Public schedule: 'booked' only once paid; 'pending' while waiting for
-- payment. A booking's chosen board name is its label.
-- ---------------------------------------------------------------------------
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
                 when s.mine then 'mine'
                 when s.payment_status in ('paid', 'waived') then 'booked'
                 else 'pending' end
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
      when s.kind = 'rental' and s.status <> 'held' then s.display_name
    end,
    coalesce(s.mine, false)
  from public.courts c
  cross join lateral generate_series(_w.opens_at, _w.closes_at - interval '1 hour', interval '1 hour') as h(hour_start)
  left join lateral (
    select bs.id, bs.kind, bs.status, bs.price_centavos, b.payment_status, b.display_name,
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

-- ---------------------------------------------------------------------------
-- Live courts: a paid booking is 'in_use' now / 'booked' next; an unpaid one
-- is 'reserved'. Rentals show the booking's board name, if any.
-- ---------------------------------------------------------------------------
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
    select bs.court_id, bs.slot, bs.kind, bs.status, bs.event_id,
           case when e.status <> 'draft' then e.title end as event_title,
           (b.payment_status in ('paid', 'waived')) as paid,
           b.display_name
    from public.booking_slots bs
    left join public.events e on e.id = bs.event_id
    left join public.bookings b on b.id = bs.booking_id
    where bs.operating_date in (_today, _today + 1)
      and bs.status not in ('released', 'cancelled', 'held')
  )
  select
    c.id, c.number, c.name,
    case
      when c.status = 'maintenance' then 'maintenance'
      when cur.kind = 'rental' and cur.paid then 'in_use'
      when cur.kind = 'rental' then 'reserved'
      when cur.kind = 'maintenance' then 'maintenance'
      when cur.kind = 'block' then 'blocked'
      when cur.kind = 'private_event' then 'private_event'
      when cur.kind is not null then 'event'
      when _w.state <> 'open' or now() < _w.opens_at or now() >= _w.closes_at then 'closed'
      else 'available'
    end,
    case
      when cur.kind = 'rental' then cur.display_name
      when cur.kind = 'open_play' then coalesce(cur.event_title, 'Open play')
        || case qg.status when 'playing' then ' · game in progress' when 'called' then ' · players called' else '' end
      when cur.kind = 'event' then coalesce(cur.event_title, 'Event') || coalesce(' · ' || mt.division_name, '')
      when cur.kind = 'private_event' then 'Private event'
      when cur.kind = 'maintenance' or c.status = 'maintenance' then 'Maintenance'
    end,
    upper(cur.slot),
    nxt.starts,
    case
      when nxt.kind is null then null
      when nxt.kind = 'rental' and nxt.paid then 'booked'
      when nxt.kind = 'rental' then 'reserved'
      when nxt.kind = 'maintenance' then 'maintenance'
      when nxt.kind = 'block' then 'blocked'
      when nxt.kind = 'private_event' then 'private_event'
      else 'event'
    end,
    now()
  from public.courts c
  left join lateral (
    select l.kind, l.slot, l.event_title, l.event_id, l.paid, l.display_name from live l
    where l.court_id = c.id and l.slot @> now()
    limit 1
  ) cur on true
  left join lateral (
    select g.status from public.queue_games g
    where g.court_id = c.id and g.event_id = cur.event_id and g.status in ('called', 'playing')
    limit 1
  ) qg on true
  left join lateral (
    select d.name as division_name from public.event_matches m join public.event_divisions d on d.id = m.division_id
    where m.court_id = c.id and m.event_id = cur.event_id and m.scheduled @> now()
      and m.status in ('scheduled', 'in_progress')
    limit 1
  ) mt on true
  left join lateral (
    select lower(l.slot) as starts, l.kind, l.paid from live l
    where l.court_id = c.id and lower(l.slot) > now()
    order by lower(l.slot)
    limit 1
  ) nxt on true
  where c.status <> 'inactive'
  order by c.sort_order, c.number;
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff schedule: also return the board name (new column, so drop + create)
-- ---------------------------------------------------------------------------
drop function public.staff_get_schedule(date);
create function public.staff_get_schedule(_date date)
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
  event_title text,
  display_name text
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
         b.id, b.reference, b.status, b.payment_status, p.full_name, p.phone, bs.note, e.title, b.display_name
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
-- Grants: signed-in users only (each function checks its own permission)
-- ---------------------------------------------------------------------------
revoke all on function
  public.set_booking_display_name(uuid, text),
  public.staff_mark_booking_paid(uuid, text),
  public.staff_mark_booking_unpaid(uuid, text),
  public.staff_get_schedule(date)
  from public, anon, authenticated;
grant execute on function
  public.set_booking_display_name(uuid, text),
  public.staff_mark_booking_paid(uuid, text),
  public.staff_mark_booking_unpaid(uuid, text),
  public.staff_get_schedule(date)
  to authenticated;

revoke all on function private.signal_booking_change() from public;
