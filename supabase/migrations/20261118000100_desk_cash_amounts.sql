-- ============================================================================
-- Desk payments record the cash actually counted
--
--   * staff_mark_booking_paid ("Paid / confirmed") no longer approves a
--     waiting receipt: receipts are reviewed in Payments, where staff enter the
--     amount the receipt shows. While one is waiting, it refuses.
--   * staff_mark_booking_paid and staff_record_cash_payment take the cash
--     received (_received_centavos). Less than the balance is recorded as a
--     part payment and the booking stays unpaid ("Partly paid" on screen);
--     more than the balance is refused (give change instead).
--   * Without an amount both refuse, so no desk action can record money
--     nobody counted.
--
-- Additive: same function names, one extra parameter with a default.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Shared: record cash counted at the desk for a confirmed booking.
-- The caller has already checked permission, ownership and the booking state.
-- Returns what is still due afterwards.
-- ---------------------------------------------------------------------------
create or replace function private.record_desk_cash(_b public.bookings, _received bigint, _why text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _due bigint := private.amount_due(_b.id);
  _left bigint;
begin
  if _received is null or _received <= 0 then
    raise exception 'Enter the cash received.' using errcode = '22023';
  end if;
  if _due <= 0 then
    raise exception 'This booking does not need a payment.' using errcode = '22023';
  end if;
  if _received > _due then
    raise exception 'Only ₱% is still due. Enter that amount and give change for the rest.',
      to_char(_due / 100.0, 'FM999,999,990.00') using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', _why, true);
  insert into public.payments (booking_id, method_kind, amount_centavos, status, submitted_by, reviewed_by, reviewed_at, review_note)
  values (_b.id, 'cash', _received, 'approved', _uid, _uid, now(), _why);

  _left := _due - _received;
  if _left = 0 then
    update public.bookings set payment_status = 'paid', payment_due_at = null where id = _b.id;
    update public.event_registrations set status = 'confirmed' where booking_id = _b.id and status = 'pending';
    perform private.notify(_b.player_id, 'payment_approved', 'Booking confirmed',
      format('Your payment for %s is confirmed. See you on court!', _b.reference), '/bookings/' || _b.id);
  else
    perform private.notify(_b.player_id, 'payment_approved', 'Part of your payment received',
      format('₱%s cash was received for %s. ₱%s is still due.',
             to_char(_received / 100.0, 'FM999,999,990.00'), _b.reference, to_char(_left / 100.0, 'FM999,999,990.00')),
      '/bookings/' || _b.id);
  end if;
  return _left;
end;
$$;

revoke all on function private.record_desk_cash(public.bookings, bigint, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Desk: "Paid / confirmed" (cash counted at the desk)
-- ---------------------------------------------------------------------------
drop function public.staff_mark_booking_paid(uuid, text);
create function public.staff_mark_booking_paid(_booking_id uuid, _note text default null, _received_centavos bigint default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _b public.bookings;
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
  if _b.payment_status = 'pending_verification'
     or exists (select 1 from public.payments where booking_id = _b.id and status = 'submitted') then
    raise exception 'A receipt is waiting for this booking. Review it in Payments and enter the amount it shows.'
      using errcode = '22023';
  end if;
  if _b.payment_status <> 'unpaid' then
    raise exception 'This booking''s payment is %; it cannot be marked paid.', replace(_b.payment_status::text, '_', ' ')
      using errcode = '22023';
  end if;

  perform private.record_desk_cash(_b, _received_centavos,
    coalesce(nullif(left(btrim(coalesce(_note, '')), 300), ''), 'Cash received at the desk'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Desk: "Record cash payment…" (same rule, from booking search)
-- ---------------------------------------------------------------------------
drop function public.staff_record_cash_payment(uuid, text);
create function public.staff_record_cash_payment(_booking_id uuid, _note text default null, _received_centavos bigint default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _b public.bookings;
  _id uuid;
begin
  if not private.has_permission('payments.verify') then
    raise exception 'You do not have permission to record payments.' using errcode = '42501';
  end if;
  select * into _b from public.bookings where id = _booking_id for update;
  if not found then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if _b.player_id = _uid then
    raise exception 'You cannot record a payment for your own booking.' using errcode = '42501';
  end if;
  if exists (select 1 from public.payments where booking_id = _b.id and status = 'submitted') then
    raise exception 'A receipt is waiting for this booking. Review it in Payments and enter the amount it shows.'
      using errcode = '22023';
  end if;
  if _b.status <> 'confirmed' or _b.payment_status <> 'unpaid' then
    raise exception 'This booking does not need a payment.' using errcode = '22023';
  end if;

  perform private.record_desk_cash(_b, _received_centavos,
    coalesce(nullif(left(btrim(coalesce(_note, '')), 300), ''), 'Cash received at the desk'));
  select id into _id from public.payments
   where booking_id = _b.id and method_kind = 'cash' and submitted_by = _uid
   order by created_at desc limit 1;
  return _id;
end;
$$;

revoke all on function
  public.staff_mark_booking_paid(uuid, text, bigint),
  public.staff_record_cash_payment(uuid, text, bigint)
  from public, anon, authenticated;
grant execute on function
  public.staff_mark_booking_paid(uuid, text, bigint),
  public.staff_record_cash_payment(uuid, text, bigint)
  to authenticated;
