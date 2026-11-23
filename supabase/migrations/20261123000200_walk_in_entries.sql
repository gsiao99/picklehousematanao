-- ============================================================================
-- Walk-in entries: admins register someone without an account who has paid
--
--   * event_registrations.player_id may be null for a walk-in; the entry then
--     carries guest_name (and optional guest_phone), an optional walk-in
--     partner name, and the payment received at the desk (amount, method,
--     reference, who recorded it and when).
--   * admin_add_walk_in: admins only; not for open play (its queue needs an
--     account); not for draft, cancelled or finished events. The amount must
--     cover the entry fee. Capacity, duplicates, divisions and team size are
--     enforced by the registration check, which now counts a walk-in partner.
--   * Walk-ins show by name in the registrations list, Who's Playing,
--     brackets and standings and the event report; their fees count in
--     Today's money and the revenue report. They earn no leaderboard points
--     or play history (those belong to accounts).
--   * Notifications skip entries with no account.
--
-- Additive: nullable column change, new columns, a new function, and
-- functions recreated with the same or extra columns.
-- ============================================================================

alter table public.event_registrations
  alter column player_id drop not null,
  add column guest_name text check (guest_name is null or char_length(btrim(guest_name)) between 2 and 80),
  add column guest_phone text check (guest_phone is null or guest_phone ~ '^09[0-9]{9}$'),
  add column partner_guest_name text check (partner_guest_name is null or char_length(btrim(partner_guest_name)) between 2 and 80),
  add column walk_in_paid_centavos bigint check (walk_in_paid_centavos is null or walk_in_paid_centavos >= 0),
  add column walk_in_method public.payment_method_kind,
  add column walk_in_reference text check (walk_in_reference is null or char_length(walk_in_reference) <= 60),
  add column walk_in_recorded_at timestamptz,
  add column walk_in_recorded_by uuid references public.profiles (id) on delete set null,
  add constraint event_registrations_who check (player_id is not null or guest_name is not null),
  add constraint event_registrations_one_partner check (partner_id is null or partner_guest_name is null),
  add constraint event_registrations_walk_in_payment check ((walk_in_paid_centavos is null) = (walk_in_method is null));

comment on column public.event_registrations.guest_name is
  'Walk-in entry: the name of someone without an account, entered by an admin (player_id is then null).';

-- ---------------------------------------------------------------------------
-- Notifications: entries without an account have nobody to notify.
-- ---------------------------------------------------------------------------
create or replace function private.notify(_user uuid, _kind text, _title text, _body text, _link text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, link)
  select _user, _kind, _title, _body, _link where _user is not null;
$$;

-- ---------------------------------------------------------------------------
-- Names and counts that include walk-ins
-- ---------------------------------------------------------------------------
create or replace function private.entry_label(_registration_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.public_name(r.player_id), r.guest_name)
         || coalesce(' / ' || coalesce(private.public_name(r.partner_id), r.partner_guest_name), '')
  from public.event_registrations r where r.id = _registration_id;
$$;

create or replace function private.event_people(_event_id uuid, _exclude uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(1 + (partner_id is not null or partner_guest_name is not null)::int), 0)::int
  from public.event_registrations
  where event_id = _event_id and status in ('pending', 'confirmed')
    and (_exclude is null or id <> _exclude);
$$;

-- The registration check, with a walk-in partner counting as a partner.
create or replace function private.check_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _e public.events;
  _d public.event_divisions;
  _becoming_active boolean;
  _has_partner boolean := new.partner_id is not null or new.partner_guest_name is not null;
begin
  if new.status not in ('pending', 'confirmed', 'waitlisted') then
    return new;
  end if;

  -- Serialise every registration change for this event.
  perform pg_advisory_xact_lock(hashtext('dd.event'), hashtext(new.event_id::text));
  select * into _e from public.events where id = new.event_id;

  if new.division_id is not null then
    select * into _d from public.event_divisions where id = new.division_id;
    if not found or _d.event_id <> new.event_id then
      raise exception 'That division is not part of this event.' using errcode = '22023';
    end if;
    new.category_id := _d.category_id;
    if _d.team_size = 2 and not _has_partner then
      raise exception '% is a doubles division. Add your partner.', _d.name using errcode = '22023';
    end if;
    if _d.team_size = 1 and _has_partner then
      raise exception '% is a singles division.', _d.name using errcode = '22023';
    end if;
  elsif exists (select 1 from public.event_divisions where event_id = new.event_id) then
    raise exception 'Choose a division.' using errcode = '22023';
  end if;

  if new.partner_id = new.player_id then
    raise exception 'Your partner must be another player.' using errcode = '22023';
  end if;

  -- Nobody may hold two live places in the same division (as player or partner).
  if exists (
    select 1 from public.event_registrations r
    where r.id <> new.id and r.event_id = new.event_id
      and r.division_id is not distinct from new.division_id
      and r.status in ('pending', 'confirmed', 'waitlisted')
      and (r.player_id in (new.player_id, new.partner_id) or r.partner_id in (new.player_id, new.partner_id))
  ) then
    raise exception '%', case when new.partner_id is null
      then 'You are already registered for this.'
      else 'You or your partner are already registered for this.' end
      using errcode = '23505';
  end if;

  _becoming_active := tg_op = 'INSERT'
    or old.status not in ('pending', 'confirmed')
    or (old.partner_id is null and new.partner_id is not null)
    or old.division_id is distinct from new.division_id;

  if _becoming_active and new.status in ('pending', 'confirmed') then
    if _e.capacity is not null
       and private.event_people(new.event_id, new.id) + 1 + _has_partner::int > _e.capacity then
      raise exception '% is full.', _e.title using errcode = '22023';
    end if;
    if new.division_id is not null and _d.capacity is not null
       and private.division_entries(new.division_id, new.id) + 1 > _d.capacity then
      raise exception '% is full.', _d.name using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admins: add a walk-in who has paid
-- ---------------------------------------------------------------------------
create or replace function public.admin_add_walk_in(
  _event_id uuid,
  _division_id uuid,
  _name text,
  _phone text default null,
  _partner_id uuid default null,
  _partner_name text default null,
  _paid_centavos bigint default 0,
  _method public.payment_method_kind default null,
  _reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _e public.events;
  _d public.event_divisions;
  _clean_name text := btrim(regexp_replace(coalesce(_name, ''), '\s+', ' ', 'g'));
  _clean_partner text := nullif(btrim(regexp_replace(coalesce(_partner_name, ''), '\s+', ' ', 'g')), '');
  _clean_phone text := nullif(regexp_replace(coalesce(_phone, ''), '[\s-]', '', 'g'), '');
  _has_partner boolean;
  _fee bigint;
  _paid bigint := coalesce(_paid_centavos, 0);
  _id uuid;
begin
  perform private.require_admin();
  select * into _e from public.events where id = _event_id for update;
  if not found then
    raise exception 'That event was not found.' using errcode = 'P0002';
  end if;
  if _e.event_type = 'open_play' then
    raise exception 'Walk-ins are for tournaments and other events. Open play needs an account to join the queue.' using errcode = '22023';
  end if;
  if _e.status in ('draft', 'cancelled', 'completed') then
    raise exception 'Walk-ins can only be added to a published event that has not finished.' using errcode = '22023';
  end if;
  if char_length(_clean_name) < 2 or char_length(_clean_name) > 80 then
    raise exception 'Enter the player''s name.' using errcode = '22023';
  end if;
  if _clean_phone is not null and _clean_phone !~ '^09[0-9]{9}$' then
    raise exception 'Enter the mobile number as 09XXXXXXXXX, or leave it empty.' using errcode = '22023';
  end if;
  if _partner_id is not null and _clean_partner is not null then
    raise exception 'Choose the partner''s account or type a name, not both.' using errcode = '22023';
  end if;
  if _clean_partner is not null and char_length(_clean_partner) > 80 then
    raise exception 'The partner''s name is too long.' using errcode = '22023';
  end if;
  if _partner_id is not null and not exists (select 1 from public.profiles where id = _partner_id and status = 'active') then
    raise exception 'That partner was not found.' using errcode = 'P0002';
  end if;
  if _division_id is not null then
    select * into _d from public.event_divisions where id = _division_id and event_id = _event_id;
    if not found then
      raise exception 'That division is not part of this event.' using errcode = '22023';
    end if;
  end if;

  _has_partner := _partner_id is not null or _clean_partner is not null;
  _fee := coalesce(_d.fee_centavos, _e.fee_centavos, 0)
          * case when _e.fee_unit = 'per_player' then 1 + _has_partner::int else 1 end;
  if _paid < 0 then
    raise exception 'Enter the amount received.' using errcode = '22023';
  end if;
  if _paid < _fee then
    raise exception 'The entry fee is ₱%. Enter the full amount received.', to_char(_fee / 100.0, 'FM999,999,990.00')
      using errcode = '22023';
  end if;
  if _paid > 0 and _method is null then
    raise exception 'Choose how the fee was paid.' using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', 'Walk-in entry added', true);
  insert into public.event_registrations (
    event_id, division_id, player_id, partner_id, guest_name, guest_phone, partner_guest_name, status, created_by,
    walk_in_paid_centavos, walk_in_method, walk_in_reference, walk_in_recorded_at, walk_in_recorded_by)
  values (
    _event_id, _division_id, null, _partner_id, _clean_name, _clean_phone, _clean_partner, 'confirmed', _uid,
    case when _paid > 0 then _paid end, case when _paid > 0 then _method end,
    nullif(left(btrim(coalesce(_reference, '')), 60), ''), now(), _uid)
  returning id into _id;

  if _partner_id is not null then
    perform private.notify(_partner_id, 'partner_added', 'You’ve been added as a partner',
      _clean_name || ' (walk-in) and you are registered for ' || _e.title || coalesce(' · ' || _d.name, '') || '.', '/my/events');
  end if;
  return _id;
end;
$$;

revoke all on function public.admin_add_walk_in(uuid, uuid, text, text, uuid, text, bigint, public.payment_method_kind, text)
  from public, anon, authenticated;
grant execute on function public.admin_add_walk_in(uuid, uuid, text, text, uuid, text, bigint, public.payment_method_kind, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Who's Playing: walk-ins by name
-- ---------------------------------------------------------------------------
create or replace function public.get_whos_playing(_event_id uuid)
returns table(registration_id uuid, division_id uuid, division_name text, category_name text, team_size smallint,
              player_name text, partner_name text, status public.registration_status, checked_in boolean, is_me boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _e public.events;
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'Sign in to see who is playing.' using errcode = '42501';
  end if;
  select * into _e from public.events where id = _event_id;
  if not found or (_e.status = 'draft' and not private.can_manage_event_type(_e.event_type)) then
    raise exception 'That event was not found.' using errcode = 'P0002';
  end if;
  return query
  select r.id, r.division_id, d.name, c.name, d.team_size,
         coalesce(private.public_name(r.player_id), r.guest_name),
         coalesce(private.public_name(r.partner_id), r.partner_guest_name),
         r.status, r.attendance = 'present',
         coalesce(auth.uid() in (r.player_id, r.partner_id), false)
  from public.event_registrations r
  left join public.event_divisions d on d.id = r.division_id
  left join public.event_categories c on c.id = r.category_id
  where r.event_id = _event_id and r.status in ('pending', 'confirmed')
  order by d.sort_order nulls first, d.name, r.created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff registrations list: walk-ins, with what they paid at the desk
-- ---------------------------------------------------------------------------
drop function public.staff_list_registrations(uuid);
create function public.staff_list_registrations(_event_id uuid)
returns table(registration_id uuid, division_id uuid, division_name text, category_name text, player_id uuid, player_name text,
              player_phone text, player_level public.player_level, partner_id uuid, partner_name text,
              status public.registration_status, attendance text, checked_in_at timestamptz, booking_id uuid,
              booking_reference text, payment_status public.booking_payment_status, fee_centavos bigint, seed smallint,
              created_at timestamptz, cancel_reason text,
              is_walk_in boolean, walk_in_paid_centavos bigint, walk_in_method public.payment_method_kind, walk_in_reference text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_event_manager(_event_id);
  return query
  select r.id, r.division_id, d.name, c.name, r.player_id, coalesce(p.full_name, r.guest_name), coalesce(p.phone, r.guest_phone),
         coalesce(p.level, p.self_rated_level),
         r.partner_id, coalesce(pp.full_name, r.partner_guest_name), r.status, r.attendance, r.checked_in_at, b.id, b.reference,
         case when r.player_id is null and r.walk_in_paid_centavos > 0 then 'paid'::public.booking_payment_status else b.payment_status end,
         coalesce(b.total_centavos, r.walk_in_paid_centavos), r.seed, r.created_at, r.cancel_reason,
         r.player_id is null, r.walk_in_paid_centavos, r.walk_in_method, r.walk_in_reference
  from public.event_registrations r
  left join public.profiles p on p.id = r.player_id
  left join public.profiles pp on pp.id = r.partner_id
  left join public.event_divisions d on d.id = r.division_id
  left join public.event_categories c on c.id = r.category_id
  left join public.bookings b on b.id = r.booking_id
  where r.event_id = _event_id
  order by (r.status in ('pending', 'confirmed')) desc, d.sort_order nulls first, d.name, r.created_at;
end;
$$;

revoke all on function public.staff_list_registrations(uuid) from public, anon, authenticated;
grant execute on function public.staff_list_registrations(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Event report: walk-ins included
-- ---------------------------------------------------------------------------
create or replace function public.report_event_registrations(_event_id uuid)
returns table(event_title text, event_date date, division text, category text, player_name text, player_phone text,
              partner_name text, status public.registration_status, attendance text, checked_in_at timestamptz,
              fee_centavos bigint, payment_status public.booking_payment_status, registered_at timestamptz, cancel_reason text)
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
  select _e.title, private.operating_date_of(_e.starts_at), d.name, c.name,
         coalesce(p.full_name, r.guest_name || ' (walk-in)'), coalesce(p.phone, r.guest_phone),
         coalesce(q.full_name, r.partner_guest_name),
         r.status, r.attendance, r.checked_in_at, coalesce(b.total_centavos, r.walk_in_paid_centavos),
         case when r.player_id is null and r.walk_in_paid_centavos > 0 then 'paid'::public.booking_payment_status else b.payment_status end,
         r.created_at, r.cancel_reason
  from public.event_registrations r
  left join public.profiles p on p.id = r.player_id
  left join public.profiles q on q.id = r.partner_id
  left join public.event_divisions d on d.id = r.division_id
  left join public.event_categories c on c.id = r.category_id
  left join public.bookings b on b.id = r.booking_id
  where r.event_id = _e.id
  order by d.sort_order nulls first, d.name, r.created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Money: walk-in fees in Today's money and the revenue report
-- ---------------------------------------------------------------------------
create or replace function public.staff_money_summary(_date date default null)
returns table(kind text, method public.payment_method_kind, items integer, centavos bigint)
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
  select 'walk_in_fee'::text, r.walk_in_method, count(*)::int, sum(r.walk_in_paid_centavos)::bigint
  from public.event_registrations r
  where r.walk_in_paid_centavos > 0 and private.operating_date_of(r.walk_in_recorded_at) = _day
  group by r.walk_in_method
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

create or replace function public.report_revenue_daily(_from date, _to date)
returns table(day date, payments_approved integer, court_rental_centavos bigint, event_fee_centavos bigint,
              cash_centavos bigint, online_centavos bigint, total_centavos bigint, refunded_or_due_centavos bigint)
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
    union all
    -- Walk-in entry fees received at the desk.
    select private.operating_date_of(r.walk_in_recorded_at), r.walk_in_paid_centavos, r.walk_in_method, true, false
    from public.event_registrations r
    where r.walk_in_paid_centavos > 0 and private.operating_date_of(r.walk_in_recorded_at) between _from and _to
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
