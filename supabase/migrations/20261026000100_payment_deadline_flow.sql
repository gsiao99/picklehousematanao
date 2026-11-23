-- ============================================================================
-- Payment deadline flow
--
--   * Same-day bookings get a shorter window to pay (venue_settings.
--     same_day_payment_minutes), so a court booked for tonight and never paid
--     is released while someone else can still use it.
--   * Players get one reminder 30 minutes before their deadline (only when
--     their window was longer than 45 minutes; a short window needs no reminder).
--   * A rejected receipt gives the player a fresh 30 minutes to pay again
--     instead of an instant cancellation when the original deadline has passed.
--
-- The deadline itself stays off until the club sets payment_due_hours in
-- Admin → Settings. Bookings confirmed before that keep no deadline.
-- ============================================================================

alter table public.venue_settings
  add column same_day_payment_minutes int
    check (same_day_payment_minutes is null or same_day_payment_minutes between 10 and 240);

comment on column public.venue_settings.same_day_payment_minutes is
  'With a payment deadline set: bookings that play on the same day they are made must be paid within this many minutes instead (never later than their first slot). NULL: same-day bookings use payment_due_hours.';

alter table public.bookings add column payment_reminder_sent_at timestamptz;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'payment_submitted', 'payment_approved', 'payment_rejected', 'booking_cancelled', 'refund_recorded',
  'registration_confirmed', 'registration_pending_payment', 'registration_cancelled', 'partner_added',
  'event_cancelled', 'queue_called', 'match_scheduled', 'staff_activity', 'payment_reminder'));

-- When a booking confirmed now must be paid by (NULL: the club has no deadline).
create or replace function private.payment_deadline_for(_booking_id uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _hours int;
  _minutes int;
  _first timestamptz;
  _first_date date;
  _due timestamptz;
begin
  select payment_due_hours, same_day_payment_minutes into _hours, _minutes from public.venue_settings limit 1;
  if _hours is null then
    return null;
  end if;
  select lower(slot), operating_date into _first, _first_date
  from public.booking_slots
  where booking_id = _booking_id and status not in ('released', 'cancelled')
  order by lower(slot)
  limit 1;
  _due := now() + make_interval(hours => _hours);
  if _minutes is not null and _first_date = private.operating_date_of(now()) then
    _due := least(_due, now() + make_interval(mins => _minutes));
  end if;
  return least(_due, coalesce(_first, 'infinity'::timestamptz));
end;
$$;

-- Set the payment deadline when a booking is confirmed (same trigger as before).
create or replace function private.set_payment_due()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' and new.payment_status = 'unpaid' then
    new.payment_due_at := private.payment_deadline_for(new.id);
    new.payment_reminder_sent_at := null;
  end if;
  return new;
end;
$$;

-- A rejected receipt: at least 30 more minutes to pay again (never past the first slot).
create or replace function private.extend_payment_due_after_rejection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _first timestamptz;
begin
  if new.status = 'confirmed' and new.payment_due_at is not null
     and old.payment_status = 'pending_verification' and new.payment_status = 'unpaid' then
    select min(lower(slot)) into _first from public.booking_slots
     where booking_id = new.id and status not in ('released', 'cancelled');
    new.payment_due_at := least(greatest(new.payment_due_at, now() + interval '30 minutes'),
                                coalesce(_first, 'infinity'::timestamptz));
    new.payment_reminder_sent_at := null;
  end if;
  return new;
end;
$$;

create trigger bookings_extend_payment_due
before update of payment_status on public.bookings
for each row execute function private.extend_payment_due_after_rejection();

-- One reminder, 30 minutes before the deadline.
create or replace function private.remind_unpaid_bookings()
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
    select b.id, b.player_id, b.reference, b.payment_due_at
    from public.bookings b
    where b.status = 'confirmed' and b.payment_status = 'unpaid' and b.event_id is null
      and b.payment_due_at is not null and b.payment_reminder_sent_at is null
      and b.payment_due_at > now() and b.payment_due_at <= now() + interval '30 minutes'
      and b.payment_due_at - coalesce(b.confirmed_at, b.created_at) > interval '45 minutes'
    for update of b skip locked
  loop
    update public.bookings set payment_reminder_sent_at = now() where id = _b.id;
    perform private.notify(_b.player_id, 'payment_reminder', 'Pay soon to keep your booking',
      format('%s will be cancelled at %s unless you send your payment and upload the receipt.',
             _b.reference, private.fmt_time(_b.payment_due_at)),
      '/player/bookings/' || _b.id);
    _n := _n + 1;
  end loop;
  return _n;
end;
$$;

create or replace function private.run_booking_jobs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.expire_stale_holds();
  perform private.remind_unpaid_bookings();
  perform private.expire_unpaid_bookings();
end;
$$;

revoke all on function
  private.payment_deadline_for(uuid),
  private.extend_payment_due_after_rejection(),
  private.remind_unpaid_bookings()
  from public;
grant execute on function private.remind_unpaid_bookings() to service_role;
