-- ============================================================================
-- CSV reports (staff with reports.view; admins have every permission)
--
-- Read-only functions; the browser turns their rows into CSV files.
-- Money is integer centavos. Dates are Asia/Manila operating dates.
-- Revenue = payments APPROVED by staff (or cash recorded), dated by when they
-- were approved. Submitted-but-unchecked and rejected payments are not revenue.
-- Refunds are shown by booking payment status; the app does not record refund
-- amounts separately (a refund returns the whole approved amount).
-- ============================================================================

create or replace function private.require_report_access(_from date, _to date)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('reports.view') then
    raise exception 'You do not have permission to view reports.' using errcode = '42501';
  end if;
  if _from is null or _to is null or _to < _from then
    raise exception 'Choose a start date and an end date on or after it.' using errcode = '22023';
  end if;
  if _to - _from > 366 then
    raise exception 'Reports cover at most one year at a time.' using errcode = '22023';
  end if;
end;
$$;

-- Bookings whose court time falls in the range (court rentals), plus event-fee
-- bookings created in the range.
create or replace function public.report_bookings(_from date, _to date)
returns table (
  reference text, kind text, operating_date date, first_start timestamptz, courts text, court_hours int,
  player_name text, player_phone text, booking_status public.booking_status,
  payment_status public.booking_payment_status, total_centavos bigint, approved_centavos bigint,
  event_title text, created_at timestamptz, cancelled_at timestamptz, cancel_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_report_access(_from, _to);
  return query
  with s as (
    select bs.booking_id, min(bs.operating_date) as op_date, min(lower(bs.slot)) as first_at,
           string_agg(distinct c.name, ', ' order by c.name) as courts,
           count(*) filter (where bs.status not in ('released', 'cancelled'))::int as hours
    from public.booking_slots bs join public.courts c on c.id = bs.court_id
    where bs.booking_id is not null and bs.status <> 'released'
    group by bs.booking_id
  )
  select b.reference,
         case when b.event_id is not null then 'event_fee' else 'court_rental' end,
         coalesce(s.op_date, private.operating_date_of(b.created_at)), s.first_at, s.courts, coalesce(s.hours, 0),
         p.full_name, p.phone, b.status, b.payment_status, b.total_centavos,
         coalesce((select sum(x.amount_centavos) from public.payments x where x.booking_id = b.id and x.status = 'approved'), 0)::bigint,
         e.title, b.created_at, b.cancelled_at, b.cancel_reason
  from public.bookings b
  join public.profiles p on p.id = b.player_id
  left join s on s.booking_id = b.id
  left join public.events e on e.id = b.event_id
  where b.status not in ('cart', 'held')
    and coalesce(s.op_date, private.operating_date_of(b.created_at)) between _from and _to
  order by 3, s.first_at nulls last, b.reference;
end;
$$;

-- Every payment submitted or recorded in the range, with its outcome.
create or replace function public.report_payments(_from date, _to date)
returns table (
  submitted_at timestamptz, booking_reference text, purpose text, player_name text,
  method public.payment_method_kind, amount_centavos bigint, reference_no text, status public.payment_status,
  reviewed_by text, reviewed_at timestamptz, review_note text, booking_payment_status public.booking_payment_status
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_report_access(_from, _to);
  return query
  select x.created_at, b.reference,
         case when b.event_id is not null then 'Entry fee: ' || coalesce(e.title, 'event') else 'Court rental' end,
         p.full_name, x.method_kind, x.amount_centavos, x.reference_no, x.status,
         r.full_name, x.reviewed_at, x.review_note, b.payment_status
  from public.payments x
  join public.bookings b on b.id = x.booking_id
  join public.profiles p on p.id = b.player_id
  left join public.profiles r on r.id = x.reviewed_by
  left join public.events e on e.id = b.event_id
  where private.operating_date_of(x.created_at) between _from and _to
  order by x.created_at;
end;
$$;

-- Approved money per day, split by purpose and by method.
create or replace function public.report_revenue_daily(_from date, _to date)
returns table (
  day date, payments_approved int, court_rental_centavos bigint, event_fee_centavos bigint,
  cash_centavos bigint, online_centavos bigint, total_centavos bigint, refunded_or_due_centavos bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_report_access(_from, _to);
  return query
  with a as (
    select private.operating_date_of(x.reviewed_at) as d, x.amount_centavos as amt, x.method_kind as m,
           b.event_id is not null as is_event, b.payment_status in ('refund_due', 'refunded') as refunded
    from public.payments x join public.bookings b on b.id = x.booking_id
    where x.status = 'approved' and private.operating_date_of(x.reviewed_at) between _from and _to
  )
  select g.d::date, count(a.amt)::int,
         coalesce(sum(a.amt) filter (where not a.is_event), 0)::bigint,
         coalesce(sum(a.amt) filter (where a.is_event), 0)::bigint,
         coalesce(sum(a.amt) filter (where a.m = 'cash'), 0)::bigint,
         coalesce(sum(a.amt) filter (where a.m <> 'cash'), 0)::bigint,
         coalesce(sum(a.amt), 0)::bigint,
         coalesce(sum(a.amt) filter (where a.refunded), 0)::bigint
  from generate_series(_from, _to, interval '1 day') g(d)
  left join a on a.d = g.d::date
  group by g.d
  order by g.d;
end;
$$;

-- Registrations and attendance for one event.
create or replace function public.report_event_registrations(_event_id uuid)
returns table (
  event_title text, event_date date, division text, category text, player_name text, player_phone text,
  partner_name text, status public.registration_status, attendance text, checked_in_at timestamptz,
  fee_centavos bigint, payment_status public.booking_payment_status, registered_at timestamptz, cancel_reason text
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
  if not private.has_permission('reports.view') then
    raise exception 'You do not have permission to view reports.' using errcode = '42501';
  end if;
  select * into _e from public.events where id = _event_id;
  if not found then
    raise exception 'That event was not found.' using errcode = 'P0002';
  end if;
  return query
  select _e.title, private.operating_date_of(_e.starts_at), d.name, c.name, p.full_name, p.phone, q.full_name,
         r.status, r.attendance, r.checked_in_at, b.total_centavos, b.payment_status, r.created_at, r.cancel_reason
  from public.event_registrations r
  join public.profiles p on p.id = r.player_id
  left join public.profiles q on q.id = r.partner_id
  left join public.event_divisions d on d.id = r.division_id
  left join public.event_categories c on c.id = r.category_id
  left join public.bookings b on b.id = r.booking_id
  where r.event_id = _e.id
  order by d.sort_order nulls first, d.name, r.created_at;
end;
$$;

-- Check-ins (attendance) in the range: court rentals and events.
create or replace function public.report_check_ins(_from date, _to date)
returns table (
  checked_in_at timestamptz, kind text, player_name text, what text, booking_reference text, checked_in_by text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_report_access(_from, _to);
  return query
  select ci.checked_in_at, ci.kind, p.full_name, coalesce(e.title, 'Court rental'), b.reference, s.full_name
  from public.check_ins ci
  join public.profiles p on p.id = ci.player_id
  left join public.events e on e.id = ci.event_id
  left join public.bookings b on b.id = ci.booking_id
  left join public.profiles s on s.id = ci.checked_in_by
  where private.operating_date_of(ci.checked_in_at) between _from and _to
  order by ci.checked_in_at;
end;
$$;

revoke all on function private.require_report_access(date, date) from public, anon, authenticated;
revoke all on function
  public.report_bookings(date, date), public.report_payments(date, date), public.report_revenue_daily(date, date),
  public.report_event_registrations(uuid), public.report_check_ins(date, date)
  from public, anon, authenticated;
grant execute on function
  public.report_bookings(date, date), public.report_payments(date, date), public.report_revenue_daily(date, date),
  public.report_event_registrations(uuid), public.report_check_ins(date, date)
  to authenticated;
