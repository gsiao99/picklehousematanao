-- ============================================================================
-- Payment amounts and tracing.
--
-- Until now every submitted payment was recorded as the full amount due, so a
-- receipt for half the price, once approved, marked the booking fully paid.
--   * Players state the amount they sent; it must cover the amount due
--     (the club takes full payments only).
--   * Staff enter the amount shown on the receipt when approving. Only that
--     amount is counted: a short receipt leaves the rest due, and the player
--     is told how much is still owed.
-- Tracing: booking search also matches GCash / Maya / bank reference numbers,
-- staff can search payments, see balances, see a booking's history, and see
-- the day's money by method.
--
-- Additive: the payment functions keep their old arguments (the new ones are
-- optional), so the previous site keeps working if a deploy is rolled back.
-- ============================================================================

alter table public.payments add column if not exists declared_centavos bigint
  check (declared_centavos is null or declared_centavos > 0);
comment on column public.payments.declared_centavos is
  'What the player said they sent. amount_centavos is what the club counts (set by staff from the receipt when approving).';

-- ---------------------------------------------------------------------------
-- 1. Players: submit a receipt and the amount sent
-- ---------------------------------------------------------------------------
drop function public.submit_payment(uuid, uuid, text, text, text);
create function public.submit_payment(
  _booking_id uuid,
  _payment_method_id uuid,
  _proof_path text,
  _reference_no text default null,
  _proof_sha256 text default null,
  _amount_centavos bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := private.require_bookable_player();
  _b public.bookings;
  _m public.payment_methods;
  _due bigint;
  _id uuid;
  _ref text := nullif(btrim(coalesce(_reference_no, '')), '');
begin
  select * into _b from public.bookings where id = _booking_id for update;
  if not found or _b.player_id <> _uid then
    raise exception 'That booking was not found.' using errcode = 'P0002';
  end if;
  if _b.status <> 'confirmed' then
    raise exception 'Only confirmed bookings can be paid.' using errcode = '22023';
  end if;
  if _b.payment_status = 'pending_verification' then
    raise exception 'A payment for this booking is already being checked.' using errcode = '22023';
  end if;
  if _b.payment_status <> 'unpaid' then
    raise exception 'This booking does not need a payment.' using errcode = '22023';
  end if;

  select * into _m from public.payment_methods where id = _payment_method_id and is_active and kind <> 'cash';
  if not found then
    raise exception 'Choose one of the club''s payment methods.' using errcode = '22023';
  end if;

  -- The proof must be a file this player uploaded to this booking's private folder.
  if _proof_path is null or _proof_path not like _uid::text || '/' || _b.id::text || '/%' then
    raise exception 'Upload your proof of payment first.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'payment-proofs' and o.name = _proof_path
      and (o.owner = _uid or o.owner_id = _uid::text)
  ) then
    raise exception 'Your proof of payment was not found. Upload it again.' using errcode = '22023';
  end if;

  _due := private.amount_due(_b.id);
  if _due <= 0 then
    raise exception 'This booking does not need a payment.' using errcode = '22023';
  end if;
  -- Full payments only.
  if _amount_centavos is not null and _amount_centavos < _due then
    raise exception 'Send the full amount due (₱%). Part payments are not accepted.', to_char(_due / 100.0, 'FM999,999,990.00')
      using errcode = '22023';
  end if;

  begin
    insert into public.payments (booking_id, payment_method_id, method_kind, amount_centavos, declared_centavos, reference_no,
                                 proof_path, proof_sha256, status, submitted_by)
    values (_b.id, _m.id, _m.kind, _due, _amount_centavos, _ref, _proof_path, lower(nullif(_proof_sha256, '')), 'submitted', _uid)
    returning id into _id;
  exception when unique_violation then
    raise exception 'That reference number or receipt was already used for another payment.' using errcode = '23505';
  end;

  update public.bookings set payment_status = 'pending_verification' where id = _b.id;

  perform private.notify_payment_verifiers(
    'Payment to check: ' || _b.reference,
    format('%s · ₱%s', _m.label, to_char(coalesce(_amount_centavos, _due) / 100.0, 'FM999,999,990.00')),
    '/admin/payments');
  return _id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Staff: approve with the amount on the receipt
-- ---------------------------------------------------------------------------
drop function public.staff_review_payment(uuid, boolean, text);
create function public.staff_review_payment(
  _payment_id uuid,
  _approve boolean,
  _reason text default null,
  _received_centavos bigint default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _p public.payments;
  _b public.bookings;
  _why text;
  _counted bigint;
  _left bigint;
begin
  if not private.has_permission('payments.verify') then
    raise exception 'You do not have permission to verify payments.' using errcode = '42501';
  end if;

  select * into _p from public.payments where id = _payment_id for update;
  if not found then
    raise exception 'That payment was not found.' using errcode = 'P0002';
  end if;
  select * into _b from public.bookings where id = _p.booking_id for update;

  if _b.player_id = _uid or _p.submitted_by = _uid then
    raise exception 'You cannot review a payment for your own booking. Ask another staff member.' using errcode = '42501';
  end if;
  if _p.status <> 'submitted' then
    raise exception 'This payment was already %.', _p.status using errcode = '22023';
  end if;

  if _approve then
    if _received_centavos is not null and _received_centavos <= 0 then
      raise exception 'Enter the amount shown on the receipt.' using errcode = '22023';
    end if;
    _counted := coalesce(_received_centavos, _p.amount_centavos);
    _why := coalesce(nullif(btrim(coalesce(_reason, '')), ''),
                     case when _counted < _p.amount_centavos
                          then format('Part payment: ₱%s of ₱%s received', to_char(_counted / 100.0, 'FM999,999,990.00'),
                                      to_char(_p.amount_centavos / 100.0, 'FM999,999,990.00'))
                          else 'Payment verified' end);
  else
    if _reason is null or char_length(btrim(_reason)) < 3 then
      raise exception 'Give the player a reason for rejecting this payment.' using errcode = '22023';
    end if;
    _why := left(btrim(_reason), 500);
  end if;

  perform set_config('app.audit_reason', _why, true);
  update public.payments
     set status = case when _approve then 'approved'::public.payment_status else 'rejected'::public.payment_status end,
         amount_centavos = case when _approve then _counted else amount_centavos end,
         reviewed_by = _uid, reviewed_at = now(), review_note = _why
   where id = _p.id;

  if _approve then
    _left := private.amount_due(_b.id);
    -- A booking cancelled while its payment was being checked keeps 'refund_due':
    -- the money arrived, so the club owes it back.
    update public.bookings
       set payment_status = case
             when status <> 'confirmed' then 'refund_due'::public.booking_payment_status
             when _left = 0 then 'paid'::public.booking_payment_status
             else 'unpaid'::public.booking_payment_status end,
           payment_due_at = null
     where id = _b.id;
    -- Paid event entries linked to this booking are confirmed.
    update public.event_registrations set status = 'confirmed'
     where booking_id = _b.id and status = 'pending' and _left = 0;
    if _b.status = 'confirmed' and _left > 0 then
      perform private.notify(_b.player_id, 'payment_approved', 'Part of your payment received',
        format('₱%s was received for %s. ₱%s is still due: send the rest from your booking.',
               to_char(_counted / 100.0, 'FM999,999,990.00'), _b.reference, to_char(_left / 100.0, 'FM999,999,990.00')),
        '/bookings/' || _b.id);
    else
      perform private.notify(_b.player_id, 'payment_approved', 'Payment approved',
        format('Your payment for %s was verified. See you on court!', _b.reference), '/bookings/' || _b.id);
    end if;
  else
    -- Confirmed: the player can pay again. Cancelled while being checked: nothing
    -- was received, so no refund is owed after all.
    update public.bookings set payment_status = 'unpaid'
     where id = _b.id
       and (status = 'confirmed'
            or (payment_status = 'refund_due'
                and not exists (select 1 from public.payments where booking_id = _b.id and status = 'approved')));
    perform private.notify(_b.player_id, 'payment_rejected', 'Payment not accepted',
      format('Your payment for %s was not accepted. Reason: %s%s', _b.reference, _why,
             case when _b.status = 'confirmed' then ' You can submit a new payment from your booking.' else '' end),
      '/bookings/' || _b.id);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Booking search also matches payment reference numbers (same arguments)
-- ---------------------------------------------------------------------------
create or replace function public.staff_search_bookings(
  _query text default null,
  _from date default null,
  _to date default null,
  _status public.booking_status default null,
  _payment_status public.booking_payment_status default null,
  _limit int default 50
)
returns table (
  booking_id uuid,
  reference text,
  status public.booking_status,
  payment_status public.booking_payment_status,
  total_centavos bigint,
  player_id uuid,
  player_name text,
  player_phone text,
  first_slot_at timestamptz,
  operating_date date,
  slot_count int,
  courts text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _q text := nullif(btrim(coalesce(_query, '')), '');
  _pattern text;
begin
  if not private.is_staff() then
    raise exception 'Only club staff can search bookings.' using errcode = '42501';
  end if;
  _pattern := '%' || replace(replace(replace(coalesce(_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
  with s as (
    select bs.booking_id, min(lower(bs.slot)) as first_at, min(bs.operating_date) as op_date, count(*)::int as n,
           string_agg(distinct c.name, ', ' order by c.name) as courts
    from public.booking_slots bs join public.courts c on c.id = bs.court_id
    where bs.booking_id is not null and bs.status <> 'released'
    group by bs.booking_id
  )
  select b.id, b.reference, b.status, b.payment_status, b.total_centavos, p.id, p.full_name, p.phone,
         s.first_at, s.op_date, coalesce(s.n, 0), s.courts, b.created_at
  from public.bookings b
  join public.profiles p on p.id = b.player_id
  left join s on s.booking_id = b.id
  where (_q is null or b.reference ilike _pattern or p.full_name ilike _pattern or p.phone ilike _pattern
         or exists (select 1 from public.payments pa where pa.booking_id = b.id and pa.reference_no ilike _pattern))
    and (_from is null or s.op_date >= _from)
    and (_to is null or s.op_date <= _to)
    and (_status is null or b.status = _status)
    and (_payment_status is null or b.payment_status = _payment_status)
    and b.status <> 'cart'
  order by s.first_at desc nulls last, b.created_at desc
  limit least(greatest(coalesce(_limit, 50), 1), 200);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Staff: how much of each booking has been paid
-- ---------------------------------------------------------------------------
create or replace function public.staff_booking_balances(_booking_ids uuid[])
returns table (booking_id uuid, total_centavos bigint, paid_centavos bigint, due_centavos bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.is_staff() then
    raise exception 'Only club staff can see balances.' using errcode = '42501';
  end if;
  return query
  select b.id, b.total_centavos,
         coalesce((select sum(p.amount_centavos) from public.payments p where p.booking_id = b.id and p.status = 'approved'), 0)::bigint,
         private.amount_due(b.id)
  from public.bookings b
  where b.id = any(_booking_ids);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Staff: search payments by name, phone, booking or reference number, and date
-- ---------------------------------------------------------------------------
create or replace function public.staff_search_payments(
  _query text default null,
  _status public.payment_status default null,
  _from date default null,
  _to date default null,
  _limit int default 100
)
returns table (
  payment_id uuid, status public.payment_status, method_kind public.payment_method_kind, method_label text,
  amount_centavos bigint, declared_centavos bigint, reference_no text, proof_path text, submitted_at timestamptz,
  reviewed_at timestamptz, reviewer_name text, review_note text, booking_id uuid, booking_reference text,
  booking_status public.booking_status, booking_payment_status public.booking_payment_status, booking_total_centavos bigint,
  booking_due_centavos bigint, first_slot_at timestamptz, player_name text, player_phone text, is_own boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _q text := nullif(btrim(coalesce(_query, '')), '');
  _pattern text;
begin
  if not private.has_permission('payments.verify') then
    raise exception 'You do not have permission to verify payments.' using errcode = '42501';
  end if;
  _pattern := '%' || replace(replace(replace(coalesce(_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
  select p.id, p.status, p.method_kind, coalesce(m.label, initcap(replace(p.method_kind::text, '_', ' '))),
         p.amount_centavos, p.declared_centavos, p.reference_no, p.proof_path, p.created_at, p.reviewed_at, r.full_name, p.review_note,
         b.id, b.reference, b.status, b.payment_status, b.total_centavos, private.amount_due(b.id),
         (select min(lower(s.slot)) from public.booking_slots s where s.booking_id = b.id and s.status not in ('released', 'cancelled')),
         pl.full_name, pl.phone,
         (b.player_id = auth.uid() or p.submitted_by = auth.uid())
  from public.payments p
  join public.bookings b on b.id = p.booking_id
  join public.profiles pl on pl.id = b.player_id
  left join public.payment_methods m on m.id = p.payment_method_id
  left join public.profiles r on r.id = p.reviewed_by
  where (_status is null or p.status = _status)
    and (_q is null or b.reference ilike _pattern or pl.full_name ilike _pattern or pl.phone ilike _pattern
         or p.reference_no ilike _pattern)
    and (_from is null or private.operating_date_of(p.created_at) >= _from)
    and (_to is null or private.operating_date_of(p.created_at) <= _to)
  order by case when p.status = 'submitted' then p.created_at end asc nulls last, coalesce(p.reviewed_at, p.created_at) desc
  limit least(greatest(coalesce(_limit, 100), 1), 500);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Staff: a booking's history (payment entries only for payment staff)
-- ---------------------------------------------------------------------------
create or replace function public.staff_booking_history(_booking_id uuid)
returns table (id bigint, occurred_at timestamptz, actor_id uuid, action text, table_name text, old_data jsonb, new_data jsonb, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _payments boolean := private.has_permission('payments.verify');
begin
  if not private.is_staff() then
    raise exception 'Only club staff can see booking history.' using errcode = '42501';
  end if;
  return query
  select a.id, a.occurred_at, a.actor_id, a.action, a.table_name, a.old_data, a.new_data, a.reason
  from public.audit_log a
  where (a.table_name = 'bookings' and a.record_id = _booking_id::text)
     or (_payments and a.table_name = 'payments'
         and (a.new_data ->> 'booking_id' = _booking_id::text or a.old_data ->> 'booking_id' = _booking_id::text))
  order by a.occurred_at, a.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Staff: the club day's money by method (booking payments, desk sales, refunds)
-- ---------------------------------------------------------------------------
create or replace function public.staff_money_summary(_date date default null)
returns table (kind text, method public.payment_method_kind, items int, centavos bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _day date := coalesce(_date, private.operating_date_of(now()));
begin
  if not private.has_permission('payments.verify') then
    raise exception 'You do not have permission to see payment totals.' using errcode = '42501';
  end if;
  return query
  select 'booking_payment'::text, p.method_kind, count(*)::int, sum(p.amount_centavos)::bigint
  from public.payments p
  where p.status = 'approved' and private.operating_date_of(coalesce(p.reviewed_at, p.created_at)) = _day
  group by p.method_kind
  union all
  select 'desk_sale'::text, s.method, count(*)::int, sum(s.total_centavos)::bigint
  from public.sales s
  where s.voided_at is null and s.operating_date = _day
  group by s.method
  union all
  select 'refund'::text, p.method_kind, count(distinct a.record_id)::int, sum(p.amount_centavos)::bigint
  from public.audit_log a
  join public.payments p on p.booking_id::text = a.record_id and p.status = 'approved'
  where a.table_name = 'bookings'
    and a.old_data ->> 'payment_status' = 'refund_due' and a.new_data ->> 'payment_status' = 'refunded'
    and private.operating_date_of(a.occurred_at) = _day
  group by p.method_kind;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function
  public.submit_payment(uuid, uuid, text, text, text, bigint),
  public.staff_review_payment(uuid, boolean, text, bigint),
  public.staff_search_bookings(text, date, date, public.booking_status, public.booking_payment_status, int),
  public.staff_booking_balances(uuid[]),
  public.staff_search_payments(text, public.payment_status, date, date, int),
  public.staff_booking_history(uuid),
  public.staff_money_summary(date)
  from public, anon, authenticated;
grant execute on function
  public.submit_payment(uuid, uuid, text, text, text, bigint),
  public.staff_review_payment(uuid, boolean, text, bigint),
  public.staff_search_bookings(text, date, date, public.booking_status, public.booking_payment_status, int),
  public.staff_booking_balances(uuid[]),
  public.staff_search_payments(text, public.payment_status, date, date, int),
  public.staff_booking_history(uuid),
  public.staff_money_summary(date)
  to authenticated;
