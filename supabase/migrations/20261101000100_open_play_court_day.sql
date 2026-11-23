-- ============================================================================
-- Open play on court: game timer, TV court board, "on deck" alerts, QR check-in
--
--   * events.queue_game_minutes: the game time limit shown on the court board
--     (default 15; NULL turns it off for that session).
--   * private.event_codes: a secret check-in code (for the QR at the desk) and
--     a board code (for the TV link) per event. Kept out of public.events,
--     which anyone can read.
--   * public.self_check_in: a booked, paid player scans the desk QR, is marked
--     present, and joins the open play stack straight away.
--   * public.get_session_board: the TV board (anonymous, with the board code):
--     courts, teams, game start times and who is next. Names are public names
--     (first name and initial).
--   * "You're on deck": a one-time alert when a waiting player gets within two
--     games of being called.
-- ============================================================================

alter table public.events
  add column queue_game_minutes smallint default 15 check (queue_game_minutes is null or queue_game_minutes between 5 and 60);

comment on column public.events.queue_game_minutes is
  'Open play: the game time limit shown on the court board, in minutes. NULL: no limit.';

alter table public.queue_entries add column on_deck_notified_at timestamptz;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'payment_submitted', 'payment_approved', 'payment_rejected', 'booking_cancelled', 'refund_recorded',
  'registration_confirmed', 'registration_pending_payment', 'registration_cancelled', 'partner_added',
  'event_cancelled', 'queue_called', 'match_scheduled', 'staff_activity', 'payment_reminder', 'queue_soon'));

-- ---------------------------------------------------------------------------
-- Secret codes per event
-- ---------------------------------------------------------------------------
create table private.event_codes (
  event_id uuid primary key references public.events (id) on delete cascade,
  checkin_code text not null default substr(md5(gen_random_uuid()::text), 1, 10),
  board_code text not null default substr(md5(gen_random_uuid()::text), 1, 16),
  created_at timestamptz not null default now()
);
revoke all on private.event_codes from public, anon, authenticated;
-- Row level security on with no policies: only the database's own functions read it.
alter table private.event_codes enable row level security;

insert into private.event_codes (event_id) select id from public.events on conflict do nothing;

create or replace function private.add_event_codes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.event_codes (event_id) values (new.id) on conflict do nothing;
  return null;
end;
$$;

create trigger events_add_codes after insert on public.events
for each row execute function private.add_event_codes();

-- Staff who manage the event read its codes (to show the QR and the TV link).
create or replace function public.staff_event_codes(_event_id uuid)
returns table (checkin_code text, board_code text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_event_manager(_event_id);
  insert into private.event_codes (event_id) values (_event_id) on conflict do nothing;
  return query select c.checkin_code, c.board_code from private.event_codes c where c.event_id = _event_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- QR self check-in
-- ---------------------------------------------------------------------------
create or replace function public.self_check_in(_event_id uuid, _code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := private.require_bookable_player();
  _e public.events;
  _r public.event_registrations;
begin
  select * into _e from public.events where id = _event_id;
  if not found or _e.status in ('draft', 'cancelled', 'completed') then
    raise exception 'That session was not found or is not running.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from private.event_codes c where c.event_id = _e.id and c.checkin_code = btrim(coalesce(_code, ''))) then
    raise exception 'This check-in code is not valid. Scan the QR code at the desk again.' using errcode = '22023';
  end if;
  if now() < _e.starts_at - interval '45 minutes' then
    raise exception 'Check-in opens 45 minutes before the start (%).', private.fmt_time(_e.starts_at) using errcode = '22023';
  end if;
  if now() > _e.ends_at then
    raise exception 'This session has ended.' using errcode = '22023';
  end if;

  select * into _r from public.event_registrations
  where event_id = _e.id and _uid in (player_id, partner_id) and status in ('pending', 'confirmed', 'waitlisted')
  order by status = 'confirmed' desc
  limit 1
  for update;
  if not found then
    raise exception 'You are not booked for %. Book it first, then scan again.', _e.title using errcode = '22023';
  end if;
  if _r.status = 'pending' then
    raise exception 'Your fee has not been confirmed yet. Show your payment at the desk.' using errcode = '22023';
  end if;
  if _r.status = 'waitlisted' then
    raise exception 'You are on the waitlist for %. The desk will tell you if a place opens.', _e.title using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', 'Self check-in (QR)', true);
  update public.event_registrations
     set attendance = 'present', checked_in_at = coalesce(checked_in_at, now()), checked_in_by = coalesce(checked_in_by, _uid)
   where id = _r.id;
  insert into public.check_ins (player_id, event_id, registration_id, checked_in_by, kind)
  values (_uid, _e.id, _r.id, _uid, 'event')
  on conflict do nothing;

  -- Open play: straight into the stack ('queued' also when already in it, so a second scan is harmless).
  if _e.event_type = 'open_play' then
    perform pg_advisory_xact_lock(hashtext('dd.queue'), hashtext(_e.id::text));
    if not exists (select 1 from public.queue_entries q
                   where q.event_id = _e.id and q.player_id = _uid and q.status in ('waiting', 'called', 'playing')) then
      perform private.enqueue(_e.id, _uid, _r.id, 0, null);
    end if;
    return 'queued';
  end if;
  return 'checked_in';
end;
$$;

-- ---------------------------------------------------------------------------
-- "You're on deck": once per queue place, within two games of being called
-- ---------------------------------------------------------------------------
create or replace function private.notify_on_deck(_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _e public.events;
  _q record;
begin
  select * into _e from public.events where id = _event_id;
  if not found or _e.event_type <> 'open_play' then
    return;
  end if;
  for _q in
    select w.id, w.player_id, w.pos from (
      select q.id, q.player_id, q.on_deck_notified_at,
             row_number() over (order by (q.stay_court_id is not null) desc, q.queued_at, q.id) as pos
      from public.queue_entries q
      where q.event_id = _event_id and q.status = 'waiting'
    ) w
    where w.pos <= 2 * _e.queue_players_per_game and w.on_deck_notified_at is null
  loop
    update public.queue_entries set on_deck_notified_at = now() where id = _q.id;
    perform private.notify(_q.player_id, 'queue_soon', 'You’re on deck',
      format('You’re #%s in line for %s. Stay close, you’ll be called soon.', _q.pos, _e.title),
      '/player/paddle-stacking');
  end loop;
end;
$$;

create or replace function private.queue_games_on_deck()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.notify_on_deck(new.event_id);
  return null;
end;
$$;

-- On start, finish or cancel (not on call: the called players are not marked yet at that moment).
create trigger queue_games_on_deck after update of status on public.queue_games
for each row execute function private.queue_games_on_deck();

-- ---------------------------------------------------------------------------
-- TV court board (anonymous, with the board code)
-- ---------------------------------------------------------------------------
create or replace function public.get_session_board(_event_id uuid, _code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _e public.events;
begin
  select * into _e from public.events where id = _event_id;
  if not found or _e.status = 'draft'
     or not exists (select 1 from private.event_codes c where c.event_id = _e.id and c.board_code = btrim(coalesce(_code, ''))) then
    raise exception 'This court board link is not valid.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'title', _e.title,
    'status', _e.status,
    'starts_at', _e.starts_at,
    'ends_at', _e.ends_at,
    'game_minutes', _e.queue_game_minutes,
    'players_per_game', _e.queue_players_per_game,
    'now', now(),
    'courts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'court_id', c.id,
        'court_name', c.name,
        'game_status', g.status,
        'called_at', g.called_at,
        'started_at', g.started_at,
        'team_a', (select coalesce(jsonb_agg(private.public_name(q.player_id) order by q.called_at, q.queued_at), '[]'::jsonb)
                   from public.queue_entries q where q.game_id = g.id and q.team = 'a' and q.status in ('called', 'playing')),
        'team_b', (select coalesce(jsonb_agg(private.public_name(q.player_id) order by q.called_at, q.queued_at), '[]'::jsonb)
                   from public.queue_entries q where q.game_id = g.id and q.team = 'b' and q.status in ('called', 'playing'))
      ) order by c.sort_order, c.name), '[]'::jsonb)
      from public.courts c
      left join public.queue_games g on g.court_id = c.id and g.event_id = _e.id and g.status in ('called', 'playing')
      where exists (select 1 from public.booking_slots s
                    where s.event_id = _e.id and s.court_id = c.id and s.status not in ('cancelled', 'released')
                      and s.slot && tstzrange(_e.starts_at, _e.ends_at))
    ),
    'next', (
      select coalesce(jsonb_agg(w.name order by w.pos), '[]'::jsonb)
      from (select private.public_name(q.player_id) as name,
                   row_number() over (order by (q.stay_court_id is not null) desc, q.queued_at, q.id) as pos
            from public.queue_entries q where q.event_id = _e.id and q.status = 'waiting') w
      where w.pos <= 12
    ),
    'waiting', (select count(*) from public.queue_entries q where q.event_id = _e.id and q.status = 'waiting')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function
  private.add_event_codes(),
  private.notify_on_deck(uuid),
  private.queue_games_on_deck(),
  public.staff_event_codes(uuid),
  public.self_check_in(uuid, text),
  public.get_session_board(uuid, text)
  from public;
grant execute on function public.staff_event_codes(uuid), public.self_check_in(uuid, text) to authenticated;
grant execute on function public.get_session_board(uuid, text) to anon, authenticated;
