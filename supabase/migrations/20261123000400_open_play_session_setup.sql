-- ============================================================================
-- Open play session setup (Phase A)
--
--   * events.queue_record_results: record the winning team of each game
--     (standings, winners-stay) or just finish games.
--   * Walk-ins may pay later at open play: admin_add_walk_in takes _pay_later;
--     the fee owed is kept on the entry until staff_mark_walk_in_paid records
--     what was received (counted in that day's money).
--   * Checking in at the desk puts an open play player straight into the stack,
--     as the QR self check-in already does; staff_check_in_all checks in
--     everyone who can be.
--   * get_session_standings: games and wins per person this session.
--   * staff_start_session: fills every free reserved court with a game.
--
-- Additive: two new columns, one function recreated with an extra parameter,
-- new functions, and staff_check_in recreated with the same signature.
-- ============================================================================

alter table public.events
  add column if not exists queue_record_results boolean not null default true;
comment on column public.events.queue_record_results is
  'Open play: staff record the winning team of each game (standings, winners-stay). Off: games are just finished.';
grant insert (queue_record_results), update (queue_record_results) on public.events to authenticated;

alter table public.event_registrations
  add column if not exists walk_in_fee_due_centavos bigint check (walk_in_fee_due_centavos is null or walk_in_fee_due_centavos > 0);
comment on column public.event_registrations.walk_in_fee_due_centavos is
  'Open play walk-in who pays later: the fee still owed. Cleared when staff record the payment.';

-- ---------------------------------------------------------------------------
-- Walk-ins: pay now (any event) or, for open play, pay later
-- ---------------------------------------------------------------------------
drop function public.admin_add_walk_in(uuid, uuid, text, text, uuid, text, bigint, public.payment_method_kind, text);
create function public.admin_add_walk_in(
  _event_id uuid,
  _division_id uuid,
  _name text,
  _phone text default null,
  _partner_id uuid default null,
  _partner_name text default null,
  _paid_centavos bigint default 0,
  _method public.payment_method_kind default null,
  _reference text default null,
  _pay_later boolean default false
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
  _later boolean := coalesce(_pay_later, false);
  _id uuid;
begin
  select * into _e from public.events where id = _event_id;
  if not found then
    raise exception 'That event was not found.' using errcode = 'P0002';
  end if;
  -- Open play is run at the desk: its managers may add walk-ins. Everything else: admins only.
  if _e.event_type = 'open_play' then
    perform private.require_event_manager(_event_id);
  else
    perform private.require_admin();
  end if;
  select * into _e from public.events where id = _event_id for update;
  if _e.status in ('draft', 'cancelled', 'completed') then
    raise exception 'Walk-ins can only be added to a published event that has not finished.' using errcode = '22023';
  end if;
  if _later and _e.event_type <> 'open_play' then
    raise exception 'Paying later is only for open play. Enter the amount received.' using errcode = '22023';
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
  if _later then
    _paid := 0;
  else
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
  end if;

  perform set_config('app.audit_reason', case when _later and _fee > 0 then 'Walk-in entry added (pays later)' else 'Walk-in entry added' end, true);
  insert into public.event_registrations (
    event_id, division_id, player_id, partner_id, guest_name, guest_phone, partner_guest_name, status, created_by,
    walk_in_paid_centavos, walk_in_method, walk_in_reference, walk_in_recorded_at, walk_in_recorded_by, walk_in_fee_due_centavos)
  values (
    _event_id, _division_id, null, _partner_id, _clean_name, _clean_phone, _clean_partner, 'confirmed', _uid,
    case when _paid > 0 then _paid end, case when _paid > 0 then _method end,
    case when _paid > 0 then nullif(left(btrim(coalesce(_reference, '')), 60), '') end,
    case when _paid > 0 then now() end, case when _paid > 0 then _uid end,
    case when _later and _fee > 0 then _fee end)
  returning id into _id;

  if _partner_id is not null then
    perform private.notify(_partner_id, 'partner_added', 'You’ve been added as a partner',
      _clean_name || ' (walk-in) and you are registered for ' || _e.title || coalesce(' · ' || _d.name, '') || '.', '/my/events');
  end if;
  return _id;
end;
$$;

revoke all on function public.admin_add_walk_in(uuid, uuid, text, text, uuid, text, bigint, public.payment_method_kind, text, boolean)
  from public, anon, authenticated;
grant execute on function public.admin_add_walk_in(uuid, uuid, text, text, uuid, text, bigint, public.payment_method_kind, text, boolean)
  to authenticated;

-- Staff: a pay-later walk-in has paid. The amount must cover what is owed.
create or replace function public.staff_mark_walk_in_paid(
  _registration_id uuid,
  _received_centavos bigint,
  _method public.payment_method_kind,
  _reference text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _r public.event_registrations;
begin
  select * into _r from public.event_registrations where id = _registration_id for update;
  if not found or _r.player_id is not null then
    raise exception 'That walk-in was not found.' using errcode = 'P0002';
  end if;
  perform private.require_event_manager(_r.event_id);
  if _r.walk_in_fee_due_centavos is null then
    raise exception 'Nothing is owed for this entry.' using errcode = '22023';
  end if;
  if _method is null then
    raise exception 'Choose how the fee was paid.' using errcode = '22023';
  end if;
  if coalesce(_received_centavos, 0) < _r.walk_in_fee_due_centavos then
    raise exception 'The entry fee is ₱%. Enter the full amount received.',
      to_char(_r.walk_in_fee_due_centavos / 100.0, 'FM999,999,990.00') using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', 'Walk-in fee received', true);
  update public.event_registrations
     set walk_in_paid_centavos = _received_centavos, walk_in_method = _method,
         walk_in_reference = nullif(left(btrim(coalesce(_reference, '')), 60), ''),
         walk_in_recorded_at = now(), walk_in_recorded_by = auth.uid(), walk_in_fee_due_centavos = null
   where id = _r.id;
end;
$$;

revoke all on function public.staff_mark_walk_in_paid(uuid, bigint, public.payment_method_kind, text) from public, anon, authenticated;
grant execute on function public.staff_mark_walk_in_paid(uuid, bigint, public.payment_method_kind, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Check-in at the desk: open play players go straight into the stack
-- ---------------------------------------------------------------------------
create or replace function public.staff_check_in(_registration_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _r public.event_registrations;
  _e public.events;
begin
  select * into _r from public.event_registrations where id = _registration_id for update;
  if not found then
    raise exception 'That registration was not found.' using errcode = 'P0002';
  end if;
  _e := private.require_event_manager(_r.event_id);
  if _e.status in ('cancelled', 'draft') then
    raise exception 'This event is not running.' using errcode = '22023';
  end if;
  if _r.status = 'pending' then
    raise exception 'The entry fee has not been confirmed yet.' using errcode = '22023';
  end if;
  if _r.status <> 'confirmed' then
    raise exception 'This registration is %.', _r.status using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', 'Checked in', true);
  update public.event_registrations
     set attendance = 'present', checked_in_at = coalesce(checked_in_at, now()), checked_in_by = auth.uid()
   where id = _r.id;
  insert into public.check_ins (player_id, event_id, registration_id, checked_in_by, kind)
  select p, _r.event_id, _r.id, auth.uid(), 'event'
  from unnest(array[_r.player_id, _r.partner_id]) p where p is not null
  on conflict do nothing;

  -- Open play: straight into the stack (as with the QR self check-in), unless already in it.
  if _e.event_type = 'open_play' and _e.status <> 'completed' then
    perform pg_advisory_xact_lock(hashtext('dd.queue'), hashtext(_e.id::text));
    if _r.player_id is not null then
      if not exists (select 1 from public.queue_entries q
                     where q.event_id = _e.id and q.player_id = _r.player_id and q.status in ('waiting', 'called', 'playing')) then
        perform private.enqueue(_e.id, _r.player_id, _r.id, 0, null);
      end if;
    elsif not exists (select 1 from public.queue_entries q
                      where q.event_id = _e.id and q.player_id is null and q.registration_id = _r.id
                        and q.status in ('waiting', 'called', 'playing')) then
      perform private.enqueue(_e.id, null, _r.id, 0, null);
    end if;
  end if;
end;
$$;

-- Check in everyone who can be (confirmed, not yet here). Returns how many were checked in.
create or replace function public.staff_check_in_all(_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _id uuid;
  _n int := 0;
begin
  perform private.require_event_manager(_event_id);
  for _id in
    select r.id from public.event_registrations r
    where r.event_id = _event_id and r.status = 'confirmed' and r.attendance is distinct from 'present'
    order by r.created_at
  loop
    perform public.staff_check_in(_id);
    _n := _n + 1;
  end loop;
  return _n;
end;
$$;

revoke all on function public.staff_check_in_all(uuid) from public, anon, authenticated;
grant execute on function public.staff_check_in_all(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Standings: games and wins per person this session (staff and its players)
-- ---------------------------------------------------------------------------
create or replace function public.get_session_standings(_event_id uuid)
returns table (rank integer, player_name text, games integer, wins integer, losses integer, is_me boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _e public.events;
begin
  select * into _e from public.events where id = _event_id;
  if not found or auth.uid() is null then
    raise exception 'That session was not found.' using errcode = 'P0002';
  end if;
  if not private.can_manage_event_type(_e.event_type)
     and not exists (select 1 from public.event_registrations r where r.event_id = _e.id
                     and auth.uid() in (r.player_id, r.partner_id) and r.status = 'confirmed') then
    raise exception 'Only players registered for this session can see its standings.' using errcode = '42501';
  end if;
  return query
  select (rank() over (order by count(*) filter (where q.outcome = 'won') desc, count(*) desc))::int,
         private.queue_person_name(max(q.player_id::text)::uuid, max(q.registration_id::text)::uuid),
         count(*)::int,
         (count(*) filter (where q.outcome = 'won'))::int,
         (count(*) filter (where q.outcome = 'lost'))::int,
         coalesce(bool_or(q.player_id = auth.uid()), false)
  from public.queue_entries q
  where q.event_id = _e.id and q.status = 'completed'
  group by coalesce(q.player_id, q.registration_id)
  order by 1, 2;
end;
$$;

revoke all on function public.get_session_standings(uuid) from public, anon, authenticated;
grant execute on function public.get_session_standings(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Start: fill every free court reserved for the session right now
-- ---------------------------------------------------------------------------
create or replace function public.staff_start_session(_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _e public.events := private.queue_session(_event_id);
  _court uuid;
  _n int := 0;
  _free int := 0;
begin
  perform private.require_event_manager(_event_id);
  for _court in
    select s.court_id from public.booking_slots s
    join public.courts c on c.id = s.court_id
    where s.event_id = _e.id and s.status not in ('cancelled', 'released') and s.slot @> now()
      and not exists (select 1 from public.queue_games g
                      where g.event_id = _e.id and g.court_id = s.court_id and g.status in ('called', 'playing'))
    group by s.court_id, c.sort_order, c.name
    order by c.sort_order, c.name
  loop
    _free := _free + 1;
    begin
      perform public.staff_call_next(_e.id, _court);
      _n := _n + 1;
    exception when sqlstate '22023' then
      -- Not enough players waiting for this court's stack: leave it free.
      null;
    end;
  end loop;
  if _n = 0 then
    raise exception '%', case when _free = 0
      then 'No court is free: every court reserved for now already has a game, or none is reserved for this time.'
      else format('Not enough players are waiting: each game needs %s from the same level.', _e.queue_players_per_game) end
      using errcode = '22023';
  end if;
  return _n;
end;
$$;

revoke all on function public.staff_start_session(uuid) from public, anon, authenticated;
grant execute on function public.staff_start_session(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Registrations list: also what a pay-later walk-in still owes
-- ---------------------------------------------------------------------------
drop function public.staff_list_registrations(uuid);
create function public.staff_list_registrations(_event_id uuid)
returns table(registration_id uuid, division_id uuid, division_name text, category_name text, player_id uuid, player_name text,
              player_phone text, player_level public.player_level, partner_id uuid, partner_name text,
              status public.registration_status, attendance text, checked_in_at timestamptz, booking_id uuid,
              booking_reference text, payment_status public.booking_payment_status, fee_centavos bigint, seed smallint,
              created_at timestamptz, cancel_reason text,
              is_walk_in boolean, walk_in_paid_centavos bigint, walk_in_method public.payment_method_kind, walk_in_reference text,
              walk_in_fee_due_centavos bigint)
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
         case when r.player_id is null and r.walk_in_paid_centavos > 0 then 'paid'::public.booking_payment_status
              when r.player_id is null and r.walk_in_fee_due_centavos > 0 then 'unpaid'::public.booking_payment_status
              else b.payment_status end,
         coalesce(b.total_centavos, r.walk_in_paid_centavos, r.walk_in_fee_due_centavos), r.seed, r.created_at, r.cancel_reason,
         r.player_id is null, r.walk_in_paid_centavos, r.walk_in_method, r.walk_in_reference, r.walk_in_fee_due_centavos
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
