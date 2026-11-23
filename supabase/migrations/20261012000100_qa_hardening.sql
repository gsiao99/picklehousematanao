-- ============================================================================
-- Phase 6 QA fixes (found in the pre-launch audit; tests in 10_qa_audit.test.sql)
--
-- 1. A player whose entry was cancelled or withdrawn stayed in the open-play
--    queue and could still be called to a court.
-- 2. A queue game left 'called' or 'playing' when its session was cancelled,
--    completed or simply ended blocked that court for every later session
--    (the one-active-game index was per court, not per session).
-- 3. Event managers could write events.created_by directly (forging who
--    created an event) and could set status 'cancelled' with a direct update
--    and no reason, leaving no explanation for players or the audit log.
--
-- No data is removed. Constraint 3 is checked against existing rows.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Cancelled or withdrawn entries leave the queue
-- ---------------------------------------------------------------------------
create or replace function private.cancel_registration(_reg public.event_registrations, _by uuid, _why text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.audit_reason', _why, true);
  update public.event_registrations
     set status = 'cancelled', cancelled_at = now(), cancel_reason = left(_why, 300)
   where id = _reg.id;
  if _reg.booking_id is not null then
    update public.bookings
       set status = 'cancelled', cancelled_at = now(), cancelled_by = _by, cancel_reason = left(_why, 300),
           payment_status = case when payment_status in ('paid', 'pending_verification') then 'refund_due'
                                 else payment_status end
     where id = _reg.booking_id and status = 'confirmed';
  end if;
  -- Waiting places go; a game already called or in progress finishes normally.
  update public.queue_entries
     set status = 'removed', ended_at = now()
   where event_id = _reg.event_id and status = 'waiting'
     and player_id in (_reg.player_id, _reg.partner_id);
end;
$$;

revoke all on function private.cancel_registration(public.event_registrations, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Close the queue when a session is cancelled or completed; one active
--    game per court per session
-- ---------------------------------------------------------------------------
create or replace function private.close_event_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('cancelled', 'completed') and old.status is distinct from new.status then
    update public.queue_games set status = 'cancelled', ended_at = now()
     where event_id = new.id and status in ('called', 'playing');
    update public.queue_entries set status = 'removed', ended_at = now()
     where event_id = new.id and status in ('waiting', 'called', 'playing');
  end if;
  return null;
end;
$$;

revoke all on function private.close_event_queue() from public, anon, authenticated;

create trigger events_close_queue
after update of status on public.events
for each row execute function private.close_event_queue();

-- Court clashes between sessions are already impossible (their court slots
-- cannot overlap), so the active-game rule only needs to hold within a session.
drop index public.queue_games_one_active_per_court;
create unique index queue_games_one_active_per_court on public.queue_games (event_id, court_id)
  where status in ('called', 'playing');

-- ---------------------------------------------------------------------------
-- 3. Event writes: creator from the session only; cancellation needs a reason
-- ---------------------------------------------------------------------------
revoke insert, update on public.events from authenticated;
grant insert (slug, title, event_type, category_id, description, level, starts_at, ends_at,
              registration_opens_at, registration_closes_at, capacity, fee_centavos, fee_unit, status,
              skill_min, skill_max, queue_players_per_game, queue_rotation, queue_max_consecutive,
              queue_no_show_rule, cancel_reason)
  on public.events to authenticated;
grant update (slug, title, event_type, category_id, description, level, starts_at, ends_at,
              registration_opens_at, registration_closes_at, capacity, fee_centavos, fee_unit, status,
              skill_min, skill_max, queue_players_per_game, queue_rotation, queue_max_consecutive,
              queue_no_show_rule, cancel_reason)
  on public.events to authenticated;

alter table public.events
  add constraint events_cancel_needs_reason
  check (status <> 'cancelled' or char_length(btrim(coalesce(cancel_reason, ''))) >= 3);

-- ---------------------------------------------------------------------------
-- 4. Dashboard: "Courts in use now" counts courts running open play or an
--    event, not only rentals (same function otherwise; see 20261011001100).
-- ---------------------------------------------------------------------------
create or replace function public.staff_dashboard()
returns table (
  operating_date date,
  bookings_today int,
  court_hours_today int,
  unpaid_today int,
  pending_payments int,
  oldest_pending_at timestamptz,
  refunds_due int,
  active_holds int,
  courts_total int,
  courts_in_use int,
  courts_maintenance int,
  hours_configured boolean,
  rates_configured boolean,
  payment_methods_active int,
  payment_due_hours int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _today date := private.operating_date_of(now());
begin
  if not private.is_staff() then
    raise exception 'Only club staff can view the dashboard.' using errcode = '42501';
  end if;
  return query
  select
    _today,
    (select count(distinct s.booking_id)::int from public.booking_slots s join public.bookings b on b.id = s.booking_id
      where s.operating_date = _today and b.status = 'confirmed' and s.status in ('confirmed', 'checked_in', 'completed')),
    (select count(*)::int from public.booking_slots s join public.bookings b on b.id = s.booking_id
      where s.operating_date = _today and b.status = 'confirmed' and s.status in ('confirmed', 'checked_in', 'completed')),
    (select count(distinct b.id)::int from public.bookings b join public.booking_slots s on s.booking_id = b.id
      where s.operating_date = _today and b.status = 'confirmed' and b.payment_status = 'unpaid'),
    (select count(*)::int from public.payments where status = 'submitted'),
    (select min(created_at) from public.payments where status = 'submitted'),
    (select count(*)::int from public.bookings where payment_status = 'refund_due'),
    (select count(*)::int from public.bookings where status = 'held' and hold_expires_at > now()),
    (select count(*)::int from public.courts where status <> 'inactive'),
    (select count(distinct s.court_id)::int from public.booking_slots s
      where s.slot @> now() and s.status in ('confirmed', 'checked_in') and s.kind in ('rental', 'open_play', 'event')),
    (select count(*)::int from public.courts c where c.status = 'maintenance'
       or exists (select 1 from public.booking_slots s where s.court_id = c.id and s.kind = 'maintenance'
                  and s.status = 'confirmed' and s.slot @> now())),
    exists (select 1 from public.operating_hours where not is_closed),
    exists (select 1 from public.rate_rules where is_active and product = 'court_rental'),
    (select count(*)::int from public.payment_methods where is_active and kind <> 'cash'),
    (select v.payment_due_hours from public.venue_settings v limit 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Calling players checks for an active game on the court in THIS session
--    only (same function otherwise; see 20261011001300). Found by test 10.
-- ---------------------------------------------------------------------------
create or replace function public.staff_call_next(_event_id uuid, _court_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _e public.events := private.queue_session(_event_id);
  _court public.courts;
  _game uuid;
  _picked uuid[];
  _waiting int;
  _i int;
begin
  perform private.require_event_manager(_event_id);
  perform pg_advisory_xact_lock(hashtext('dd.queue'), hashtext(_e.id::text));
  select * into _court from public.courts where id = _court_id;
  if not exists (select 1 from public.booking_slots s
                 where s.event_id = _e.id and s.court_id = _court_id and s.status not in ('cancelled', 'released')
                   and s.slot @> now()) then
    raise exception '% is not reserved for this session right now.', coalesce(_court.name, 'That court') using errcode = '22023';
  end if;
  if exists (select 1 from public.queue_games where event_id = _e.id and court_id = _court_id and status in ('called', 'playing')) then
    raise exception '% already has a game. Finish it first.', _court.name using errcode = '22023';
  end if;

  -- Winners staying on this court first, then everyone else in queue order.
  select array_agg(id) into _picked from (
    select id from public.queue_entries
    where event_id = _e.id and status = 'waiting' and (stay_court_id is null or stay_court_id = _court_id)
    order by (stay_court_id = _court_id) desc nulls last, queued_at, id
    limit _e.queue_players_per_game
  ) x;
  _waiting := coalesce(cardinality(_picked), 0);
  if _waiting < _e.queue_players_per_game then
    raise exception 'Only % of % players are waiting.', _waiting, _e.queue_players_per_game using errcode = '22023';
  end if;

  insert into public.queue_games (event_id, court_id, called_by) values (_e.id, _court_id, auth.uid())
  returning id into _game;
  for _i in 1.._waiting loop
    update public.queue_entries
       set status = 'called', game_id = _game, court_id = _court_id, called_at = now(),
           team = case when _i <= _e.queue_players_per_game / 2 then 'a' else 'b' end
     where id = _picked[_i];
  end loop;
  perform private.notify(q.player_id, 'queue_called', 'You’re up on ' || _court.name,
    'Head to ' || _court.name || ' now.', '/events/' || _e.slug)
  from public.queue_entries q where q.game_id = _game;
  return _game;
end;
$$;
