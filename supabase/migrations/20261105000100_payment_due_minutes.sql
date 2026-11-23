-- ============================================================================
-- Reserve now, pay within minutes (court bookings).
--
--   * venue_settings.payment_due_minutes: how long a player has, after
--     reserving courts, to send their payment and upload the receipt
--     (10 minutes to 24 hours). When it is set it replaces payment_due_hours
--     for court bookings; same_day_payment_minutes still applies when shorter.
--     Never later than the first booked hour, as before.
--   * Event entry fees keep using payment_due_hours.
--   * Nothing else changes: a booking whose receipt is being checked is never
--     cancelled for lateness, a rejected receipt gives 30 more minutes, and the
--     every-minute job releases unpaid courts once the deadline passes.
--
-- Additive: an older frontend ignores the new column and keeps working.
-- ============================================================================

alter table public.venue_settings
  add column payment_due_minutes int
    check (payment_due_minutes is null or payment_due_minutes between 10 and 1440);

comment on column public.venue_settings.payment_due_minutes is
  'Court bookings: minutes a player has after reserving to send payment and upload the receipt, or the courts are released. NULL: use payment_due_hours.';

-- When a booking confirmed now must be paid by (NULL: the club has no deadline).
create or replace function private.payment_deadline_for(_booking_id uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _due_minutes int;
  _hours int;
  _same_day int;
  _first timestamptz;
  _first_date date;
  _due timestamptz;
begin
  select payment_due_minutes, payment_due_hours, same_day_payment_minutes
    into _due_minutes, _hours, _same_day
  from public.venue_settings limit 1;
  if _due_minutes is null and _hours is null then
    return null;
  end if;
  select lower(slot), operating_date into _first, _first_date
  from public.booking_slots
  where booking_id = _booking_id and status not in ('released', 'cancelled')
  order by lower(slot)
  limit 1;
  _due := now() + coalesce(make_interval(mins => _due_minutes), make_interval(hours => _hours));
  if _same_day is not null and _first_date = private.operating_date_of(now()) then
    _due := least(_due, now() + make_interval(mins => _same_day));
  end if;
  return least(_due, coalesce(_first, 'infinity'::timestamptz));
end;
$$;

revoke all on function private.payment_deadline_for(uuid) from public;
