-- ============================================================================
-- Open play: one paddle stack per category, court levels, winners split
--
--   * Stacks: every queue place belongs to the division (category) on the
--     player's registration. Players are only ever called with players from
--     the same stack, so a Novice never lands in an Intermediate game.
--   * Court levels: staff give a court one category (it only takes that
--     stack) or leave it Flex (no row). A Flex court takes the next game from
--     the longest stack that has enough players; ties go to whoever has
--     waited longest. Winners staying on a court keep its stack for the next
--     game.
--   * Rotation per stack (event_divisions.queue_rotation; NULL = the session
--     rule): 'all_off', 'winners_stay', or 'winners_split' — the two winners
--     stay but are put on opposite teams with new partners, up to
--     queue_max_consecutive games in a row.
--   * Fresh games are balanced from today's results: the player with the
--     most wins partners the one with the fewest, avoiding the partner from
--     their last game. With no results yet, queue order decides (1+2 v 3+4).
--   * A no-show is replaced by the next waiting player of the same stack.
--   * Game format: timed (queue_game_minutes) or per game, played to a score
--     (queue_game_points, e.g. 11). Per game has no timer; the board counts
--     up and staff finish the game when the score is reached.
-- Additive: new columns, a new table, replaced function bodies.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Stacks follow the registration's division
-- ---------------------------------------------------------------------------
alter table public.queue_entries add column division_id uuid references public.event_divisions (id) on delete set null;
alter table public.queue_games add column division_id uuid references public.event_divisions (id) on delete set null;
create index queue_entries_stack_idx on public.queue_entries (event_id, division_id, queued_at) where status = 'waiting';
create index queue_entries_division_idx on public.queue_entries (division_id);
create index queue_games_division_idx on public.queue_games (division_id);

update public.queue_entries q set division_id = r.division_id
from public.event_registrations r where r.id = q.registration_id and q.division_id is null;
update public.queue_games g set division_id = (select q.division_id from public.queue_entries q where q.game_id = g.id limit 1)
where g.division_id is null;

create or replace function private.queue_entry_division()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.registration_id is not null then
    select r.division_id into new.division_id from public.event_registrations r where r.id = new.registration_id;
  end if;
  return new;
end;
$$;

create trigger queue_entries_division before insert or update of registration_id on public.queue_entries
for each row execute function private.queue_entry_division();

-- Per game: first to this many points (NULL: not set). Timed sessions use queue_game_minutes.
alter table public.events
  add column queue_game_points smallint check (queue_game_points is null or queue_game_points between 5 and 25);
comment on column public.events.queue_game_points is 'Open play per-game format: games are played to this score. NULL: timed or unset.';
grant insert (queue_game_points), update (queue_game_points) on public.events to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Rotation per stack
-- ---------------------------------------------------------------------------
alter table public.event_divisions
  add column queue_rotation text check (queue_rotation in ('all_off', 'winners_stay', 'winners_split'));
comment on column public.event_divisions.queue_rotation is
  'Open play: what happens after a game in this stack. NULL: the session rule.';

create or replace function private.stack_rotation(_division_id uuid, _e public.events)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select d.queue_rotation from public.event_divisions d where d.id = _division_id), _e.queue_rotation);
$$;

-- ---------------------------------------------------------------------------
-- 3. Court levels (no row: Flex)
-- ---------------------------------------------------------------------------
create table public.event_court_lanes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  court_id uuid not null references public.courts (id) on delete cascade,
  division_id uuid not null references public.event_divisions (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, court_id)
);
create index event_court_lanes_court_idx on public.event_court_lanes (court_id);
create index event_court_lanes_division_idx on public.event_court_lanes (division_id);

create trigger event_court_lanes_set_updated_at before update on public.event_court_lanes
for each row execute function private.set_updated_at();
create trigger event_court_lanes_audit after insert or update or delete on public.event_court_lanes
for each row execute function private.write_audit();

alter table public.event_court_lanes enable row level security;
create policy "Event managers read court levels" on public.event_court_lanes
for select to authenticated
using (exists (select 1 from public.events e where e.id = event_id and private.can_manage_event_type(e.event_type)));
grant select on public.event_court_lanes to authenticated;

-- Give a session court one category, or make it Flex (_division_id NULL).
create or replace function public.staff_set_court_lane(_event_id uuid, _court_id uuid, _division_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _e public.events := private.require_event_manager(_event_id);
begin
  if _e.event_type <> 'open_play' then
    raise exception 'Only open play sessions have court levels.' using errcode = '22023';
  end if;
  if _division_id is not null
     and not exists (select 1 from public.event_divisions d where d.id = _division_id and d.event_id = _e.id) then
    raise exception 'That category is not part of this session.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.booking_slots s
                 where s.event_id = _e.id and s.court_id = _court_id and s.status not in ('cancelled', 'released')) then
    raise exception 'That court is not reserved for this session.' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', 'Open play court level changed', true);
  if _division_id is null then
    delete from public.event_court_lanes where event_id = _e.id and court_id = _court_id;
  else
    insert into public.event_court_lanes (event_id, court_id, division_id) values (_e.id, _court_id, _division_id)
    on conflict (event_id, court_id) do update set division_id = excluded.division_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Today's results, for balanced teams
-- ---------------------------------------------------------------------------
create or replace function private.queue_wins(_event_id uuid, _player_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.queue_entries q
  where q.event_id = _event_id and q.player_id = _player_id and q.outcome = 'won';
$$;

-- True when either player's most recent game in the session was with the other as partner.
create or replace function private.queue_were_partners(_event_id uuid, _a uuid, _b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from (
      select q.game_id, q.team, q.player_id,
             row_number() over (partition by q.player_id order by q.ended_at desc, q.id) as rn
      from public.queue_entries q
      where q.event_id = _event_id and q.player_id in (_a, _b) and q.status = 'completed'
    ) last_game
    join public.queue_entries p on p.game_id = last_game.game_id and p.team = last_game.team
                               and p.player_id = case when last_game.player_id = _a then _b else _a end
    where last_game.rn = 1
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. Calling the next game
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
  select array_agg(x.id order by x.rn), array_agg(x.player_id order by x.rn), count(*) filter (where x.stays)
    into _picked, _players, _stayers
  from (
    select q.id, q.player_id, coalesce(q.stay_court_id = _court_id, false) as stays,
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

-- ---------------------------------------------------------------------------
-- 6. Finishing a game: the stack's rotation decides who stays
-- ---------------------------------------------------------------------------
create or replace function public.staff_complete_game(_game_id uuid, _winning_team text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _g public.queue_games;
  _e public.events;
  _q public.queue_entries;
  _rotation text;
  _stays boolean;
begin
  select * into _g from public.queue_games where id = _game_id;
  if not found then
    raise exception 'That game was not found.' using errcode = 'P0002';
  end if;
  perform private.require_event_manager(_g.event_id);
  _e := private.queue_session(_g.event_id);
  perform pg_advisory_xact_lock(hashtext('dd.queue'), hashtext(_g.event_id::text));
  select * into _g from public.queue_games where id = _game_id for update;
  if _g.status = 'called' then
    raise exception 'Start the game before finishing it.' using errcode = '22023';
  end if;
  if _g.status <> 'playing' then
    raise exception 'This game is already %.', _g.status using errcode = '22023';
  end if;
  if _winning_team is not null and _winning_team not in ('a', 'b') then
    raise exception 'The winning team must be A or B.' using errcode = '22023';
  end if;
  _rotation := private.stack_rotation(_g.division_id, _e);
  if _rotation in ('winners_stay', 'winners_split') and _winning_team is null then
    raise exception 'Winners stay on in this stack. Choose the winning team.' using errcode = '22023';
  end if;

  update public.queue_games set status = 'completed', ended_at = now(), winning_team = _winning_team where id = _g.id;
  for _q in select * from public.queue_entries where game_id = _g.id and status = 'playing'
            order by (team = _winning_team) desc nulls last, queued_at, id loop
    update public.queue_entries
       set status = 'completed', ended_at = now(),
           outcome = case when _winning_team is null then null when team = _winning_team then 'won' else 'lost' end
     where id = _q.id;
    _stays := _rotation in ('winners_stay', 'winners_split') and _q.team = _winning_team
              and _q.consecutive_games + 1 < _e.queue_max_consecutive;
    perform private.enqueue(_g.event_id, _q.player_id, _q.registration_id,
      case when _stays then _q.consecutive_games + 1 else 0 end,
      case when _stays then _g.court_id end);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. A no-show is replaced from the same stack
-- ---------------------------------------------------------------------------
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
  where event_id = _q.event_id and status = 'waiting' and player_id <> _q.player_id and stay_court_id is null
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
-- 8. "On deck" counts places within the player's own stack
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
             row_number() over (partition by q.division_id
                                order by (q.stay_court_id is not null) desc, q.queued_at, q.id) as pos
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

-- ---------------------------------------------------------------------------
-- 9. The queue, with each player's stack (positions count within the stack)
-- ---------------------------------------------------------------------------
drop function public.get_queue(uuid);
create function public.get_queue(_event_id uuid)
returns table (
  entry_id uuid, player_name text, status text, queue_position int, queued_at timestamptz,
  game_id uuid, game_status text, court_id uuid, court_name text, team text,
  consecutive_games smallint, games_played int, stays_on_court boolean, is_me boolean,
  division_id uuid, division_name text, wins int
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
  select q.id, private.public_name(q.player_id), q.status,
         case when q.status = 'waiting'
              then (row_number() over (partition by (q.status = 'waiting'), q.division_id
                                       order by (q.stay_court_id is not null) desc, q.queued_at, q.id))::int end,
         q.queued_at, q.game_id, g.status, q.court_id, c.name, q.team, q.consecutive_games,
         (select count(*)::int from public.queue_entries x where x.event_id = _e.id and x.player_id = q.player_id
            and x.status = 'completed'),
         q.stay_court_id is not null, q.player_id = auth.uid(),
         q.division_id, d.name, private.queue_wins(_e.id, q.player_id)
  from public.queue_entries q
  left join public.queue_games g on g.id = q.game_id
  left join public.courts c on c.id = coalesce(q.court_id, q.stay_court_id)
  left join public.event_divisions d on d.id = q.division_id
  where q.event_id = _e.id and q.status in ('waiting', 'called', 'playing')
  order by q.status = 'waiting', c.sort_order, q.team, d.sort_order, 4, q.queued_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. TV board: each court's level and one "Next up" list per stack
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
    'stacks', (
      select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'waiting', s.waiting, 'next', s.next)
                                order by s.sort_order nulls first, s.name), '[]'::jsonb)
      from (
        select d.name, d.sort_order, k.division_id,
               (select count(*) from public.queue_entries q
                where q.event_id = _e.id and q.status = 'waiting' and q.division_id is not distinct from k.division_id) as waiting,
               (select coalesce(jsonb_agg(w.name order by w.pos), '[]'::jsonb)
                from (select private.public_name(q.player_id) as name,
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
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function
  private.queue_entry_division(),
  private.stack_rotation(uuid, public.events),
  private.queue_wins(uuid, uuid),
  private.queue_were_partners(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.staff_set_court_lane(uuid, uuid, uuid), public.get_queue(uuid) from public, anon, authenticated;
grant execute on function public.staff_set_court_lane(uuid, uuid, uuid), public.get_queue(uuid) to authenticated;
