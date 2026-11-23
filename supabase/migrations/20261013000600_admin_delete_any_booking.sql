-- ============================================================================
-- Admins may delete any booking, paid or not (owner's decision, Oct 13 2026).
--
--   * Paid bookings: the payment records go with it. A full copy of the
--     booking, its court hours and its payments stays in audit_log, and the
--     staff notification says money had been received so the refund is
--     handled outside the system.
--   * Event entry fees: the booking is cancelled first, so the existing
--     trigger cancels the linked registration properly, then deleted.
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
  _received bigint;
begin
  if not private.is_admin() then
    raise exception 'Only admins can delete bookings.' using errcode = '42501';
  end if;
  _why := private.require_reason(_reason);
  select * into _b from public.bookings where id = _booking_id for update;
  if not found then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;

  select full_name into _who from public.profiles where id = _b.player_id;
  _when := private.booking_when(_b.id);
  select coalesce(sum(amount_centavos), 0) into _received
  from public.payments where booking_id = _b.id and status = 'approved';

  perform set_config('app.audit_reason', 'Booking deleted: ' || _why, true);

  -- Event entry: cancel first so the registration is cancelled the usual way.
  if _b.event_id is not null and _b.status in ('held', 'confirmed') then
    update public.booking_slots set status = 'cancelled' where booking_id = _b.id and status in ('held', 'confirmed');
    update public.bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = _uid, cancel_reason = left(_why, 300)
     where id = _b.id;
  end if;

  -- Payments (accepted or not) go with it; the audit log keeps a copy of each.
  delete from public.payments where booking_id = _b.id;
  -- Court hours cascade with the booking; check-ins keep their history without the link.
  delete from public.bookings where id = _b.id;

  if _b.player_id is distinct from _uid and _b.status in ('confirmed', 'completed') then
    perform private.notify(_b.player_id, 'booking_cancelled', 'Booking removed',
      format('Your booking %s%s was removed by the club. Reason: %s%s', _b.reference,
             coalesce(' (' || _when || ')', ''), _why,
             case when _received > 0 then ' The club will contact you about your payment.' else '' end),
      '/player/bookings');
  end if;
  perform private.notify_staff('Booking deleted',
    concat_ws(' · ', _b.reference, _who, _when,
              case when _received > 0 then private.peso(_received) || ' had been received: refund outside the system' end,
              _why)
      || coalesce((select ' · by ' || full_name from public.profiles where id = _uid), ''),
    '/admin/bookings', _uid);
end;
$$;
