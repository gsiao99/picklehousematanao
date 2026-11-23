-- ============================================================================
-- Admins: delete a booking outright
--
-- Removes the booking, its court hours (so the court shows free on Live
-- courts and the schedule at once: the booking_slots signal fires) and any
-- payment submissions that were not accepted. Everything removed is kept in
-- audit_log by the existing audit triggers.
--
-- Refused while money is on the books: a paid booking or a refund still due.
-- Set it back to pending payment (reverses the payment) or record the refund
-- first. Event entry-fee bookings are managed from the event's registrations.
-- ============================================================================

create or replace function public.staff_delete_booking(_booking_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _why text;
  _b public.bookings;
  _who text;
  _when text;
begin
  if not private.is_admin() then
    raise exception 'Only admins can delete bookings.' using errcode = '42501';
  end if;
  _why := private.require_reason(_reason);
  select * into _b from public.bookings where id = _booking_id for update;
  if not found then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if _b.payment_status in ('paid', 'refund_due') then
    raise exception 'Money was received for % (%). Set it back to pending payment, or record the refund, before deleting it.',
      _b.reference, replace(_b.payment_status::text, '_', ' ') using errcode = '22023';
  end if;
  if _b.event_id is not null then
    raise exception '% is an event entry fee. Manage it from the event''s registrations instead.', _b.reference
      using errcode = '22023';
  end if;

  select full_name into _who from public.profiles where id = _b.player_id;
  _when := private.booking_when(_b.id);

  perform set_config('app.audit_reason', 'Booking deleted: ' || _why, true);
  -- Receipts sent but not accepted go with it (the audit log keeps a copy).
  delete from public.payments where booking_id = _b.id and status <> 'approved';
  if exists (select 1 from public.payments where booking_id = _b.id) then
    raise exception 'An accepted payment is still recorded for %. Set it back to pending payment first.', _b.reference
      using errcode = '22023';
  end if;
  -- Court hours cascade with the booking; check-ins keep their history without the link.
  delete from public.bookings where id = _b.id;

  if _b.player_id is distinct from _uid and _b.status in ('confirmed', 'completed') then
    perform private.notify(_b.player_id, 'booking_cancelled', 'Booking removed',
      format('Your booking %s%s was removed by the club. Reason: %s', _b.reference,
             coalesce(' (' || _when || ')', ''), _why),
      '/player/bookings');
  end if;
  perform private.notify_staff('Booking deleted',
    concat_ws(' · ', _b.reference, _who, _when, _why)
      || coalesce((select ' · by ' || full_name from public.profiles where id = _uid), ''),
    '/admin/bookings', _uid);
end;
$$;

revoke all on function public.staff_delete_booking(uuid, text) from public, anon, authenticated;
grant execute on function public.staff_delete_booking(uuid, text) to authenticated;
