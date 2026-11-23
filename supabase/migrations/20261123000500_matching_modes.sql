-- ============================================================================
-- Open play matching modes (Phase B)
--
--   * events.queue_matching: 'balanced' (unchanged default), 'social' or
--     'winners_losers'.
--   * Social mix: levels and court levels are ignored (one line for everyone);
--     the four players are split into the teams whose partners have played
--     together least this session.
--   * Winners vs losers: the first person in line decides the game; it is
--     filled with people whose last result matches theirs (won / lost / none
--     yet), then by queue order. Teams as in Balanced.
--   * Balanced: exactly as before.
--
-- Additive: one new column, two helper functions, staff_call_next recreated
-- with the same signature.
-- ============================================================================

alter table public.events
  add column if not exists queue_matching text not null default 'balanced'
    check (queue_matching in ('balanced', 'social', 'winners_losers'));
comment on column public.events.queue_matching is
  'Open play: how games are made. balanced (default), social (ignore levels, new partners), winners_losers (same last result).';
grant insert (queue_matching), update (queue_matching) on public.events to authenticated;

-- How often two people were on the same team this session (account, or a walk-in's registration).
create or replace function private.queue_partner_count(_event_id uuid, _a uuid, _b uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.queue_entries x
  join public.queue_entries y on y.game_id = x.game_id and y.team = x.team and y.id <> x.id
  where x.event_id = _event_id and x.status = 'completed'
    and coalesce(x.player_id, x.registration_id) = _a and coalesce(y.player_id, y.registration_id) = _b;
$$;

-- A person's last result this session: 'won', 'lost', or null (no recorded game yet).
create or replace function private.queue_last_outcome(_event_id uuid, _who uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select q.outcome from public.queue_entries q
  where q.event_id = _event_id and coalesce(q.player_id, q.registration_id) = _who and q.status = 'completed'
  order by q.ended_at desc nulls last, q.id desc
  limit 1;
$$;

revoke all on function private.queue_partner_count(uuid, uuid, uuid), private.queue_last_outcome(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- Calling the next game, by the session's matching mode
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
  _matching text := coalesce(_e.queue_matching, 'balanced');
  _social boolean := coalesce(_e.queue_matching, 'balanced') = 'social';
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
  _anchor text;
  _cost int;
  _best int;
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

  -- Which stack plays. Social mix: everyone is one line. Otherwise winners staying here
  -- keep theirs, then the court's level, then (Flex) the longest stack.
  if not _social then
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
  end if;

  -- Winners vs losers: the first in line decides the game's group (their last result).
  if _matching = 'winners_losers' then
    select coalesce(private.queue_last_outcome(_e.id, coalesce(q.player_id, q.registration_id)), 'none') into _anchor
    from public.queue_entries q
    where q.event_id = _e.id and q.status = 'waiting'
      and (_social or q.division_id is not distinct from _stack)
      and (q.stay_court_id is null or q.stay_court_id = _court_id)
    order by (q.stay_court_id = _court_id) desc nulls last, q.queued_at, q.id
    limit 1;
  end if;

  -- Winners staying on this court first, then the line (same-result people first in Winners vs losers).
  -- _players holds who each place is: the account, or a walk-in's registration.
  select array_agg(x.id order by x.rn), array_agg(x.who order by x.rn), count(*) filter (where x.stays)
    into _picked, _players, _stayers
  from (
    select q.id, coalesce(q.player_id, q.registration_id) as who, coalesce(q.stay_court_id = _court_id, false) as stays,
           row_number() over (
             order by (q.stay_court_id = _court_id) desc nulls last,
                      case when _anchor is not null
                           then coalesce(private.queue_last_outcome(_e.id, coalesce(q.player_id, q.registration_id)), 'none') = _anchor
                      end desc nulls last,
                      q.queued_at, q.id) as rn
    from public.queue_entries q
    where q.event_id = _e.id and q.status = 'waiting'
      and (_social or q.division_id is not distinct from _stack)
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
    for _i in 1.._n loop
      _teams[_i] := case when _i % 2 = 1 then 'a' else 'b' end;
    end loop;
  elsif _stayers > 0 or _n = 2 then
    for _i in 1.._n loop
      _teams[_i] := case when _i <= _n / 2 then 'a' else 'b' end;
    end loop;
  elsif _social then
    -- Social mix: of the three ways to pair four people, the one whose partners played together least.
    _best := null;
    foreach _j in array array[2, 3, 4] loop
      select array_agg(k order by k) into _rest from unnest(array[2, 3, 4]) k where k <> _j;
      _cost := private.queue_partner_count(_e.id, _players[1], _players[_j])
             + private.queue_partner_count(_e.id, _players[_rest[1]], _players[_rest[2]]);
      if _best is null or _cost < _best then
        _best := _cost;
        _mate := _j;
      end if;
    end loop;
    _teams[1] := 'a';
    _teams[_mate] := 'a';
  else
    -- Balanced (also Winners vs losers): most wins partners fewest wins; avoid last game's partner.
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
