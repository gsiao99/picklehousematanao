-- ============================================================================
-- Walk-ins for open play: in the paddle stack like everyone else
--
--   * admin_add_walk_in now also takes open play sessions. For open play,
--     admins and staff who manage open play may add walk-ins (they run the
--     session at the desk); tournaments and other events stay admins only.
--     The division picked is the walk-in's level stack.
--   * queue_entries.player_id may be null: a walk-in's place is tied to their
--     registration instead. Wherever the queue tells people apart (one place
--     each, win counts, "not last game's partner", no-show replacement) it now
--     uses the account, or else the walk-in's registration. Account holders
--     behave exactly as before.
--   * staff_queue_add_walk_in puts a checked-in walk-in in the stack.
--   * The stack, the staff queue and the court board show walk-ins by name.
--   * Cancelling a walk-in removes their waiting place.
--
-- Additive: a nullable column, a check, a partial unique index, new functions,
-- and functions recreated with the same signatures.
-- ============================================================================

alter table public.queue_entries
  alter column player_id drop not null,
  add constraint queue_entries_who check (player_id is not null or registration_id is not null);

-- One live place per walk-in (account holders keep queue_entries_one_active).
create unique index queue_entries_one_active_walk_in on public.queue_entries (event_id, registration_id)
  where player_id is null and status in ('waiting', 'called', 'playing');

-- The name shown for a queue place: the account's public name, else the walk-in's name.
create or replace function private.queue_person_name(_player_id uuid, _registration_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.public_name(_player_id),
                  (select r.guest_name from public.event_registrations r where r.id = _registration_id));
$$;
revoke all on function private.queue_person_name(uuid, uuid) from public;

create or replace function private.enqueue(_event_id uuid, _player_id uuid, _reg uuid, _consecutive integer, _stay_court uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _id uuid;
begin
  insert into public.queue_entries (event_id, player_id, registration_id, consecutive_games, stay_court_id, queued_at)
  values (_event_id, _player_id, _reg, _consecutive, _stay_court, clock_timestamp())
  returning id into _id;
  return _id;
exception when unique_violation then
  raise exception '% already in the queue.',
    case when _player_id = auth.uid() then 'You are' else coalesce(private.queue_person_name(_player_id, _reg), 'This player') || ' is' end
    using errcode = '23505';
end;
$$;

-- Wins and last partners: by account, or by registration for a walk-in.
create or replace function private.queue_wins(_event_id uuid, _player_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.queue_entries q
  where q.event_id = _event_id and coalesce(q.player_id, q.registration_id) = _player_id and q.outcome = 'won';
$$;

create or replace function private.queue_were_partners(_event_id uuid, _a uuid, _b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from (
      select q.game_id, q.team, coalesce(q.player_id, q.registration_id) as who,
             row_number() over (partition by coalesce(q.player_id, q.registration_id) order by q.ended_at desc, q.id) as rn
      from public.queue_entries q
      where q.event_id = _event_id and coalesce(q.player_id, q.registration_id) in (_a, _b) and q.status = 'completed'
    ) last_game
    join public.queue_entries p on p.game_id = last_game.game_id and p.team = last_game.team
                               and coalesce(p.player_id, p.registration_id) = case when last_game.who = _a then _b else _a end
    where last_game.rn = 1
  );
$$;

-- ---------------------------------------------------------------------------
-- Calling the next game: walk-ins identified by registration for team-making
-- ---------------------------------------------------------------------------
create or replace function public.staff_call_next(_event_id uuid, _court_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _e public.events := private.queue_session(_event_id);
  _n int := _e.queue_players_per_game;
  _court public.courts;
  _lane uuid;
  _has_lane boolean;
  _stack uuid;
  _stack_name text;
  _rotation text;
  _game uuid;
  _picked uuid[];
  _players uuid[];
  _stayers int;
  _waiting int;
  _order int[];
  _teams text[];
  _wins_differ boolean;
  _mate int;
  _j int;
  _rest int[];
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

  -- Which stack plays: winners staying here keep theirs, then the court's level, then (Flex) the longest stack.
  select l.division_id into _lane from public.event_court_lanes l where l.event_id = _e.id and l.court_id = _court_id;
  _has_lane := found;
  select q.division_id into _stack from public.queue_entries q
  where q.event_id = _e.id and q.status = 'waiting' and q.stay_court_id = _court_id
  order by q.queued_at, q.id limit 1;
  if not found then
    if _has_lane then
      _stack := _lane;
    else
      select w.division_id into _stack from (
        select q.division_id, count(*) as n, min(q.queued_at) as first_at
        from public.queue_entries q
        where q.event_id = _e.id and q.status = 'waiting' and q.stay_court_id is null
        group by q.division_id
      ) w
      order by (w.n >= _n) desc, w.n desc, w.first_at
      limit 1;
    end if;
  end if;
  select d.name into _stack_name from public.event_divisions d where d.id = _stack;

  -- Winners staying on this court first, then everyone else in the stack in queue order.
  -- _players holds who each place is: the account, or a walk-in's registration.
  select array_agg(x.id order by x.rn), array_agg(x.who order by x.rn), count(*) filter (where x.stays)
    into _picked, _players, _stayers
  from (
    select q.id, coalesce(q.player_id, q.registration_id) as who, coalesce(q.stay_court_id = _court_id, false) as stays,
           row_number() over (order by (q.stay_court_id = _court_id) desc nulls last, q.queued_at, q.id) as rn
    from public.queue_entries q
    where q.event_id = _e.id and q.status = 'waiting' and q.division_id is not distinct from _stack
      and (q.stay_court_id is null or q.stay_court_id = _court_id)
  ) x
  where x.rn <= _n;
  _waiting := coalesce(cardinality(_picked), 0);
  if _waiting < _n then
    raise exception 'Only % of % % players are waiting.', _waiting, _n, coalesce(_stack_name, '')
      using errcode = '22023';
  end if;

  -- Teams.
  _rotation := private.stack_rotation(_stack, _e);
  _teams := array_fill('b'::text, array[_n]);
  if _stayers > 0 and _rotation = 'winners_split' then
    -- Winners split up: stayers are first, so alternating puts one on each side.
    for _i in 1.._n loop
      _teams[_i] := case when _i % 2 = 1 then 'a' else 'b' end;
    end loop;
  elsif _stayers > 0 or _n = 2 then
    for _i in 1.._n loop
      _teams[_i] := case when _i <= _n / 2 then 'a' else 'b' end;
    end loop;
  else
    -- Fresh four: most wins partners fewest wins; avoid last game's partner.
    select array_agg(i order by private.queue_wins(_e.id, _players[i]) desc, i),
           count(distinct private.queue_wins(_e.id, _players[i])) > 1
      into _order, _wins_differ
    from generate_subscripts(_players, 1) i;
    _mate := null;
    foreach _j in array case when _wins_differ then array[4, 3, 2] else array[2, 3, 4] end loop
      select array_agg(k order by k) into _rest from unnest(array[2, 3, 4]) k where k <> _j;
      if not private.queue_were_partners(_e.id, _players[_order[1]], _players[_order[_j]])
         and not private.queue_were_partners(_e.id, _players[_order[_rest[1]]], _players[_order[_rest[2]]]) then
        _mate := _j;
        exit;
      end if;
    end loop;
    _mate := coalesce(_mate, case when _wins_differ then 4 else 2 end);
    _teams[_order[1]] := 'a';
    _teams[_order[_mate]] := 'a';
  end if;

  insert into public.queue_games (event_id, court_id, called_by, division_id) values (_e.id, _court_id, auth.uid(), _stack)
  returning id into _game;
  for _i in 1.._waiting loop
    update public.queue_entries
       set status = 'called', game_id = _game, court_id = _court_id, called_at = now(), team = _teams[_i]
     where id = _picked[_i];
  end loop;
  perform private.notify(q.player_id, 'queue_called', 'You’re up on ' || _court.name,
    'Head to ' || _court.name || ' now.', '/events/' || _e.slug)
  from public.queue_entries q where q.game_id = _game;
  return _game;
end;
$$;

-- No-show: the replacement is the next waiting person other than this one.
create or replace function public.staff_queue_no_show(_entry_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _q public.queue_entries;
  _e public.events;
  _court text;
  _repl uuid;
begin
  select * into _q from public.queue_entries where id = _entry_id;
  if not found then
    raise exception 'That queue entry was not found.' using errcode = 'P0002';
  end if;
  perform private.require_event_manager(_q.event_id);
  _e := private.queue_session(_q.event_id);
  perform pg_advisory_xact_lock(hashtext('dd.queue'), hashtext(_q.event_id::text));
  select * into _q from public.queue_entries where id = _entry_id;
  if _q.status <> 'called' then
    raise exception 'Only a called player can be marked as a no-show.' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', 'Queue no-show', true);
  update public.queue_entries set status = 'no_show', ended_at = now() where id = _q.id;
  if _e.queue_no_show_rule = 'back_of_queue' then
    perform private.enqueue(_q.event_id, _q.player_id, _q.registration_id, 0, null);
  end if;

  -- Call the next waiting player of the same stack into the same place.
  select id into _repl from public.queue_entries
  where event_id = _q.event_id and status = 'waiting'
    and coalesce(player_id, registration_id) <> coalesce(_q.player_id, _q.registration_id) and stay_court_id is null
    and division_id is not distinct from _q.division_id
  order by queued_at, id limit 1;
  if _repl is not null then
    update public.queue_entries
       set status = 'called', game_id = _q.game_id, court_id = _q.court_id, team = _q.team, called_at = now()
     where id = _repl;
    select name into _court from public.courts where id = _q.court_id;
    perform private.notify(player_id, 'queue_called', 'You’re up on ' || _court, 'Head to ' || _court || ' now.',
      '/events/' || _e.slug)
    from public.queue_entries where id = _repl;
  end if;
  return _repl;
end;
$$;

-- ---------------------------------------------------------------------------
-- The stack for players and staff: walk-ins by name
-- ---------------------------------------------------------------------------
create or replace function public.get_queue(_event_id uuid)
returns table(entry_id uuid, player_name text, status text, queue_position integer, queued_at timestamptz, game_id uuid,
              game_status text, court_id uuid, court_name text, team text, consecutive_games smallint, games_played integer,
              stays_on_court boolean, is_me boolean, division_id uuid, division_name text, wins integer)
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
    raise exception 'Only players registered for this session can see its queue.' using errcode = '42501';
  end if;
  return query
  select q.id, private.queue_person_name(q.player_id, q.registration_id), q.status,
         case when q.status = 'waiting'
              then (row_number() over (partition by (q.status = 'waiting'), q.division_id
                                       order by (q.stay_court_id is not null) desc, q.queued_at, q.id))::int end,
         q.queued_at, q.game_id, g.status, q.court_id, c.name, q.team, q.consecutive_games,
         (select count(*)::int from public.queue_entries x where x.event_id = _e.id
            and coalesce(x.player_id, x.registration_id) = coalesce(q.player_id, q.registration_id)
            and x.status = 'completed'),
         q.stay_court_id is not null, coalesce(q.player_id = auth.uid(), false),
         q.division_id, d.name, private.queue_wins(_e.id, coalesce(q.player_id, q.registration_id))
  from public.queue_entries q
  left join public.queue_games g on g.id = q.game_id
  left join public.courts c on c.id = coalesce(q.court_id, q.stay_court_id)
  left join public.event_divisions d on d.id = q.division_id
  where q.event_id = _e.id and q.status in ('waiting', 'called', 'playing')
  order by q.status = 'waiting', c.sort_order, q.team, d.sort_order, 4, q.queued_at;
end;
$$;

-- The court board (TV): walk-ins by name.
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
    'game_points', _e.queue_game_points,
    'players_per_game', _e.queue_players_per_game,
    'now', now(),
    'courts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'court_id', c.id,
        'court_name', c.name,
        'lane', (select d.name from public.event_court_lanes l join public.event_divisions d on d.id = l.division_id
                 where l.event_id = _e.id and l.court_id = c.id),
        'game_division', (select d.name from public.event_divisions d where d.id = g.division_id),
        'game_status', g.status,
        'called_at', g.called_at,
        'started_at', g.started_at,
        'team_a', (select coalesce(jsonb_agg(private.queue_person_name(q.player_id, q.registration_id) order by q.called_at, q.queued_at), '[]'::jsonb)
                   from public.queue_entries q where q.game_id = g.id and q.team = 'a' and q.status in ('called', 'playing')),
        'team_b', (select coalesce(jsonb_agg(private.queue_person_name(q.player_id, q.registration_id) order by q.called_at, q.queued_at), '[]'::jsonb)
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
      from (select private.queue_person_name(q.player_id, q.registration_id) as name,
                   row_number() over (order by (q.stay_court_id is not null) desc, q.queued_at, q.id) as pos
            from public.queue_entries q where q.event_id = _e.id and q.status = 'waiting') w
      where w.pos <= 12
    ),
    'stacks', (
      select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'waiting', s.waiting, 'next', s.next)
                                order by s.sort_order nulls first, s.name), '[]'::jsonb)
      from (
        select d.name, d.sort_order, k.division_id,
               (select count(*) from public.queue_entries q
                where q.event_id = _e.id and q.status = 'waiting' and q.division_id is not distinct from k.division_id) as waiting,
               (select coalesce(jsonb_agg(w.name order by w.pos), '[]'::jsonb)
                from (select private.queue_person_name(q.player_id, q.registration_id) as name,
                             row_number() over (order by (q.stay_court_id is not null) desc, q.queued_at, q.id) as pos
                      from public.queue_entries q
                      where q.event_id = _e.id and q.status = 'waiting' and q.division_id is not distinct from k.division_id) w
                where w.pos <= 8) as next
        from (select x.id as division_id from public.event_divisions x where x.event_id = _e.id
              union
              select q.division_id from public.queue_entries q
              where q.event_id = _e.id and q.status = 'waiting' and q.division_id is null) k
        left join public.event_divisions d on d.id = k.division_id
      ) s
    ),
    'waiting', (select count(*) from public.queue_entries q where q.event_id = _e.id and q.status = 'waiting')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff: put a checked-in walk-in in the stack
-- ---------------------------------------------------------------------------
create or replace function public.staff_queue_add_walk_in(_registration_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _r public.event_registrations;
  _e public.events;
begin
  select * into _r from public.event_registrations where id = _registration_id;
  if not found or _r.player_id is not null then
    raise exception 'That walk-in was not found.' using errcode = 'P0002';
  end if;
  perform private.require_event_manager(_r.event_id);
  _e := private.queue_session(_r.event_id);
  perform pg_advisory_xact_lock(hashtext('dd.queue'), hashtext(_e.id::text));
  select * into _r from public.event_registrations where id = _registration_id;
  if _r.status <> 'confirmed' then
    raise exception 'This entry is %.', _r.status using errcode = '22023';
  end if;
  if _r.attendance is distinct from 'present' then
    raise exception 'Check % in at the desk first.', _r.guest_name using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', 'Walk-in added to the stack', true);
  return private.enqueue(_e.id, null, _r.id, 0, null);
end;
$$;

revoke all on function public.staff_queue_add_walk_in(uuid) from public, anon, authenticated;
grant execute on function public.staff_queue_add_walk_in(uuid) to authenticated;

-- Cancelling an entry removes its waiting place, for walk-ins too.
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
     and (player_id in (_reg.player_id, _reg.partner_id) or (player_id is null and registration_id = _reg.id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Walk-ins for open play: admins, and staff who manage open play
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
