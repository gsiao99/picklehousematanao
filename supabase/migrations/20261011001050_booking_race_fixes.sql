-- Two race fixes found by repeated runs of scripts/local-db/concurrency-test.py.
-- Both functions are copied from 20261011001000_booking_engine.sql with one change each.
--
-- 1. confirm_booking: when another session's expiry job expired a hold just
--    before the player pressed Confirm, it raised "can no longer be confirmed"
--    instead of reporting 'expired'.
-- 2. hold_slots: simultaneous holds on the same hour occasionally ended in a
--    Postgres deadlock error instead of the "was just taken" message. No double
--    booking was possible either way (the exclusion constraint held).

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
  -- Another session's expiry job may have expired this hold a moment ago.
  if _b.status = 'expired' then
    return query select 'expired'::text, _b.id, _b.reference, 0::bigint;
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
    -- Two sessions inserting the same hour at the same instant can each wait on
    -- the other inside the exclusion check; Postgres then aborts one with a
    -- deadlock. The loser gets the same "just taken" answer either way.
    exception when exclusion_violation or deadlock_detected then
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
