-- ============================================================================
-- Matches, brackets, standings, leaderboards and the open-play queue
--
-- Brackets (only what is tested):
--   * round robin: every confirmed entry plays every other once (circle method)
--   * single elimination: seeded bracket padded to a power of two; top seeds
--     get byes; a recorded winner moves into the next match automatically
-- Standings (round robin): wins, then point difference, then points scored.
-- Leaderboard rule (published in the app): from completed or walkover matches
--   in events that were not cancelled — win 3 points, loss 1 point,
--   walkover loss 0 points. Every point traces to a match record.
-- Queue ("paddle stacking") per open-play session:
--   waiting → called (assigned to a court) → playing → completed, back of queue
--   rotation 'all_off': everyone returns to the back after a game
--   rotation 'winners_stay': winners keep the court for the next game, up to
--   queue_max_consecutive games in a row
--   no-show: 'back_of_queue' re-queues the player, 'remove' takes them out;
--   either way the next waiting player is called in their place
-- Court assignments (matches and queue games) live inside the courts already
-- reserved for the event, so they cannot clash with rentals; matches on the
-- same court cannot overlap (exclusion constraint); one active game per court.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Matches
-- ---------------------------------------------------------------------------
create table public.event_matches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  division_id uuid not null references public.event_divisions (id) on delete cascade,
  stage text not null check (stage in ('round_robin', 'elimination')),
  round smallint not null check (round > 0),
  match_no smallint not null check (match_no > 0),
  entry_a uuid references public.event_registrations (id) on delete set null,
  entry_b uuid references public.event_registrations (id) on delete set null,
  next_match_id uuid references public.event_matches (id) on delete set null,
  next_slot text check (next_slot in ('a', 'b')),
  court_id uuid references public.courts (id) on delete restrict,
  scheduled tstzrange,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'in_progress', 'completed', 'walkover', 'bye', 'cancelled')),
  score_a smallint check (score_a is null or score_a >= 0),
  score_b smallint check (score_b is null or score_b >= 0),
  winner uuid references public.event_registrations (id) on delete set null,
  result_note text check (result_note is null or char_length(result_note) <= 300),
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (division_id, stage, round, match_no),
  check ((court_id is null) = (scheduled is null)),
  check (scheduled is null or (not isempty(scheduled) and lower_inc(scheduled) and not upper_inc(scheduled))),
  check (status <> 'completed' or (score_a is not null and score_b is not null and winner is not null)),
  constraint event_matches_no_court_overlap
    exclude using gist (court_id with =, scheduled with &&)
    where (court_id is not null and status not in ('cancelled', 'bye'))
);

create index event_matches_event_idx on public.event_matches (event_id, division_id, stage, round, match_no);

create trigger event_matches_set_updated_at before update on public.event_matches
for each row execute function private.set_updated_at();
create trigger event_matches_audit after insert or update or delete on public.event_matches
for each row execute function private.write_audit();

alter table public.event_matches enable row level security;
create policy "Event managers read matches" on public.event_matches
for select to authenticated
using (exists (select 1 from public.events e where e.id = event_id and private.can_manage_event_type(e.event_type)));
grant select on public.event_matches to authenticated;

-- "Ana R. / Ben C."
create or replace function private.entry_label(_registration_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select private.public_name(r.player_id) || coalesce(' / ' || private.public_name(r.partner_id), '')
  from public.event_registrations r where r.id = _registration_id;
$$;

create or replace function private.advance_winner(_m public.event_matches, _winner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if _m.next_match_id is null then
    return;
  end if;
  if _m.next_slot = 'a' then
    update public.event_matches set entry_a = _winner where id = _m.next_match_id;
  else
    update public.event_matches set entry_b = _winner where id = _m.next_match_id;
  end if;
end;
$$;

create or replace function public.staff_generate_matches(_division_id uuid, _reason text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  _d public.event_divisions;
  _e public.events;
  _ids uuid[];
  _n int;
  _m int;
  _r int;
  _i int;
  _k int;
  _count int := 0;
  _size int;
  _rounds int;
  _order int[];
  _next int[];
  _s int;
  _prev uuid[];
  _cur uuid[];
  _a uuid;
  _b uuid;
  _match public.event_matches;
begin
  select * into _d from public.event_divisions where id = _division_id;
  if not found then
    raise exception 'That division was not found.' using errcode = 'P0002';
  end if;
  _e := private.require_event_manager(_d.event_id);
  if _d.format = 'none' then
    raise exception '% has no match format. Set round robin or single elimination first.', _d.name using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('dd.event'), hashtext(_e.id::text));
  if exists (select 1 from public.event_matches where division_id = _d.id
             and status in ('completed', 'walkover', 'in_progress')) then
    raise exception 'Results are already recorded for %. Matches cannot be regenerated.', _d.name using errcode = '22023';
  end if;

  select array_agg(id order by seed nulls last, created_at) into _ids
  from public.event_registrations where division_id = _d.id and status = 'confirmed';
  _n := coalesce(cardinality(_ids), 0);
  if _n < 2 then
    raise exception '% needs at least two confirmed entries.', _d.name using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', coalesce(nullif(btrim(coalesce(_reason, '')), ''), 'Matches generated for ' || _d.name), true);
  delete from public.event_matches where division_id = _d.id;

  if _d.format = 'round_robin' then
    if _n % 2 = 1 then
      _ids := _ids || null::uuid;
    end if;
    _m := cardinality(_ids);
    for _r in 1.._m - 1 loop
      _k := 0;
      for _i in 1.._m / 2 loop
        _a := _ids[_i];
        _b := _ids[_m + 1 - _i];
        if _a is not null and _b is not null then
          _k := _k + 1;
          insert into public.event_matches (event_id, division_id, stage, round, match_no, entry_a, entry_b)
          values (_e.id, _d.id, 'round_robin', _r, _k, _a, _b);
          _count := _count + 1;
        end if;
      end loop;
      -- Circle method: first entry fixed, the rest rotate one place.
      _ids := array[_ids[1], _ids[_m]] || _ids[2:_m - 1];
    end loop;
  else
    _size := 1;
    while _size < _n loop
      _size := _size * 2;
    end loop;
    _rounds := round(ln(_size) / ln(2))::int;
    -- Standard seeding order (1 v 8, 4 v 5, 2 v 7, 3 v 6 for 8)
    _order := array[1];
    while cardinality(_order) < _size loop
      _next := '{}';
      foreach _s in array _order loop
        _next := _next || _s || (2 * cardinality(_order) + 1 - _s);
      end loop;
      _order := _next;
    end loop;

    -- Create from the final backwards so each match knows where its winner goes.
    _prev := '{}';
    for _r in reverse _rounds..1 loop
      _cur := '{}';
      for _i in 1..(_size / (2 ^ _r)::int) loop
        insert into public.event_matches (event_id, division_id, stage, round, match_no, next_match_id, next_slot,
                                          entry_a, entry_b)
        values (_e.id, _d.id, 'elimination', _r, _i,
                case when _r < _rounds then _prev[(_i + 1) / 2] end,
                case when _r < _rounds then case when _i % 2 = 1 then 'a' else 'b' end end,
                case when _r = 1 and _order[2 * _i - 1] <= _n then _ids[_order[2 * _i - 1]] end,
                case when _r = 1 and _order[2 * _i] <= _n then _ids[_order[2 * _i]] end)
        returning id into _a;
        _cur := _cur || _a;
        _count := _count + 1;
      end loop;
      _prev := _cur;
    end loop;

    -- Byes: the seeded entry goes straight through.
    for _match in select * from public.event_matches
                  where division_id = _d.id and stage = 'elimination' and round = 1
                    and (entry_a is null or entry_b is null) loop
      _a := coalesce(_match.entry_a, _match.entry_b);
      update public.event_matches set status = 'bye', winner = _a where id = _match.id;
      perform private.advance_winner(_match, _a);
    end loop;
  end if;
  return _count;
end;
$$;

create or replace function public.staff_schedule_match(
  _match_id uuid, _court_id uuid, _starts_at timestamptz, _ends_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _m public.event_matches;
  _e public.events;
  _court text;
begin
  select * into _m from public.event_matches where id = _match_id for update;
  if not found then
    raise exception 'That match was not found.' using errcode = 'P0002';
  end if;
  _e := private.require_event_manager(_m.event_id);
  if _m.status not in ('scheduled', 'in_progress') then
    raise exception 'This match is already %.', _m.status using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', 'Match court and time set', true);
  if _court_id is null then
    update public.event_matches set court_id = null, scheduled = null where id = _m.id;
    return;
  end if;
  if _ends_at is null or _ends_at <= _starts_at then
    raise exception 'The end time must be after the start time.' using errcode = '22023';
  end if;
  select name into _court from public.courts where id = _court_id;
  if not exists (select 1 from public.booking_slots s
                 where s.event_id = _e.id and s.court_id = _court_id and s.status not in ('cancelled', 'released')
                   and s.slot @> tstzrange(_starts_at, _ends_at, '[)')) then
    raise exception '% is not reserved for % at that time. Assign the court to the event first.', coalesce(_court, 'That court'), _e.title
      using errcode = '22023';
  end if;
  -- A player cannot be in two matches at once (any division of this event).
  if exists (
    select 1 from public.event_matches o
    join public.event_registrations ro on ro.id in (o.entry_a, o.entry_b)
    join public.event_registrations rm on rm.id in (_m.entry_a, _m.entry_b)
    where o.event_id = _m.event_id and o.id <> _m.id and o.scheduled is not null
      and o.status not in ('cancelled', 'bye')
      and o.scheduled && tstzrange(_starts_at, _ends_at, '[)')
      and (ro.player_id in (rm.player_id, rm.partner_id) or ro.partner_id in (rm.player_id, rm.partner_id))
  ) then
    raise exception 'A player in this match is already playing another match at that time.' using errcode = '23P01';
  end if;
  begin
    update public.event_matches set court_id = _court_id, scheduled = tstzrange(_starts_at, _ends_at, '[)')
     where id = _m.id;
  exception when exclusion_violation then
    raise exception '% already has another match at %.', _court, private.fmt_time(_starts_at) using errcode = '23P01';
  end;
  if _m.entry_a is not null and _m.entry_b is not null then
    perform private.notify(u, 'match_scheduled', 'Match scheduled: ' || _e.title,
      private.entry_label(_m.entry_a) || ' vs ' || private.entry_label(_m.entry_b) || ' · ' || _court || ' at '
        || private.fmt_time(_starts_at),
      '/events/' || _e.slug)
    from (select unnest(array[r.player_id, r.partner_id]) u from public.event_registrations r
          where r.id in (_m.entry_a, _m.entry_b)) x
    where u is not null;
  end if;
end;
$$;

create or replace function public.staff_record_match_result(
  _match_id uuid, _score_a int default null, _score_b int default null,
  _walkover_winner uuid default null, _note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _m public.event_matches;
  _next public.event_matches;
  _winner uuid;
begin
  select * into _m from public.event_matches where id = _match_id for update;
  if not found then
    raise exception 'That match was not found.' using errcode = 'P0002';
  end if;
  perform private.require_event_manager(_m.event_id);
  if _m.status in ('bye', 'cancelled') then
    raise exception 'This match is %.', _m.status using errcode = '22023';
  end if;
  if _m.entry_a is null or _m.entry_b is null then
    raise exception 'Both sides of this match are not known yet.' using errcode = '22023';
  end if;

  if _walkover_winner is not null then
    if _walkover_winner not in (_m.entry_a, _m.entry_b) then
      raise exception 'The walkover winner must be one of the two entries.' using errcode = '22023';
    end if;
    _winner := _walkover_winner;
  else
    if _score_a is null or _score_b is null or _score_a < 0 or _score_b < 0 then
      raise exception 'Enter both scores.' using errcode = '22023';
    end if;
    if _score_a = _score_b then
      raise exception 'A match needs a winner; the scores cannot be level.' using errcode = '22023';
    end if;
    _winner := case when _score_a > _score_b then _m.entry_a else _m.entry_b end;
  end if;

  if _m.next_match_id is not null then
    select * into _next from public.event_matches where id = _m.next_match_id for update;
    if _next.status in ('completed', 'walkover', 'in_progress') and _m.winner is distinct from _winner then
      raise exception 'The next round has already started. Clear that result before changing this one.' using errcode = '22023';
    end if;
  end if;

  perform set_config('app.audit_reason', coalesce(nullif(btrim(coalesce(_note, '')), ''), 'Match result recorded'), true);
  update public.event_matches
     set status = case when _walkover_winner is not null then 'walkover' else 'completed' end,
         score_a = case when _walkover_winner is null then _score_a end,
         score_b = case when _walkover_winner is null then _score_b end,
         winner = _winner, result_note = left(nullif(btrim(coalesce(_note, '')), ''), 300),
         recorded_by = auth.uid(), recorded_at = now()
   where id = _m.id;
  perform private.advance_winner(_m, _winner);
end;
$$;

-- Signed-in players see the draw and results of published events.
create or replace function public.get_event_matches(_event_id uuid)
returns table (
  match_id uuid, division_id uuid, division_name text, stage text, round smallint, match_no smallint,
  entry_a uuid, entry_b uuid, label_a text, label_b text, court_name text, starts_at timestamptz, ends_at timestamptz,
  status text, score_a smallint, score_b smallint, winner uuid, is_mine boolean
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
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'Sign in to see matches.' using errcode = '42501';
  end if;
  select * into _e from public.events where id = _event_id;
  if not found or (_e.status = 'draft' and not private.can_manage_event_type(_e.event_type)) then
    raise exception 'That event was not found.' using errcode = 'P0002';
  end if;
  return query
  select m.id, m.division_id, d.name, m.stage, m.round, m.match_no, m.entry_a, m.entry_b,
         private.entry_label(m.entry_a), private.entry_label(m.entry_b), c.name, lower(m.scheduled), upper(m.scheduled),
         m.status, m.score_a, m.score_b, m.winner,
         exists (select 1 from public.event_registrations r where r.id in (m.entry_a, m.entry_b)
                 and auth.uid() in (r.player_id, r.partner_id))
  from public.event_matches m
  join public.event_divisions d on d.id = m.division_id
  left join public.courts c on c.id = m.court_id
  where m.event_id = _event_id
  order by d.sort_order, d.name, m.stage desc, m.round, m.match_no;
end;
$$;

create or replace function public.get_division_standings(_division_id uuid)
returns table (
  rank int, registration_id uuid, label text, played int, wins int, losses int,
  points_for int, points_against int, point_diff int, is_mine boolean
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
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'Sign in to see standings.' using errcode = '42501';
  end if;
  select e.* into _e from public.events e join public.event_divisions d on d.event_id = e.id where d.id = _division_id;
  if not found or (_e.status = 'draft' and not private.can_manage_event_type(_e.event_type)) then
    raise exception 'That division was not found.' using errcode = 'P0002';
  end if;
  return query
  with entries as (
    select r.id, r.player_id, r.partner_id, r.created_at from public.event_registrations r
    where r.division_id = _division_id and r.status = 'confirmed'
  ), results as (
    select x.entry, x.won, x.pf, x.pa
    from public.event_matches m
    cross join lateral (values (m.entry_a, m.winner = m.entry_a, coalesce(m.score_a, 0), coalesce(m.score_b, 0)),
                               (m.entry_b, m.winner = m.entry_b, coalesce(m.score_b, 0), coalesce(m.score_a, 0)))
                as x(entry, won, pf, pa)
    where m.division_id = _division_id and m.stage = 'round_robin' and m.status in ('completed', 'walkover')
  ), totals as (
    select en.id, en.player_id, en.partner_id, en.created_at,
           count(rs.entry)::int as played,
           count(*) filter (where rs.won)::int as wins,
           count(*) filter (where not rs.won)::int as losses,
           coalesce(sum(rs.pf), 0)::int as pf, coalesce(sum(rs.pa), 0)::int as pa
    from entries en left join results rs on rs.entry = en.id
    group by en.id, en.player_id, en.partner_id, en.created_at
  )
  select (rank() over (order by t.wins desc, t.pf - t.pa desc, t.pf desc))::int,
         t.id, private.entry_label(t.id), t.played, t.wins, t.losses, t.pf, t.pa, t.pf - t.pa,
         auth.uid() in (t.player_id, t.partner_id)
  from totals t
  order by 1, private.entry_label(t.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Leaderboards (signed-in players; players who opted out are left off)
-- ---------------------------------------------------------------------------
create or replace function private.match_results(_from date, _to date)
returns table (player_id uuid, match_id uuid, event_id uuid, played_on date, won boolean, walkover boolean,
               points_for int, points_against int, points int)
language sql
stable
security definer
set search_path = ''
as $$
  select p.pid, m.id, m.event_id, private.operating_date_of(coalesce(lower(m.scheduled), m.recorded_at)),
         x.entry = m.winner, m.status = 'walkover',
         x.pf, x.pa,
         case when x.entry = m.winner then 3 when m.status = 'walkover' then 0 else 1 end
  from public.event_matches m
  join public.events e on e.id = m.event_id and e.status <> 'cancelled'
  cross join lateral (values (m.entry_a, coalesce(m.score_a, 0), coalesce(m.score_b, 0)),
                             (m.entry_b, coalesce(m.score_b, 0), coalesce(m.score_a, 0))) as x(entry, pf, pa)
  join public.event_registrations r on r.id = x.entry
  cross join lateral unnest(array[r.player_id, r.partner_id]) as p(pid)
  where m.status in ('completed', 'walkover') and p.pid is not null
    and (_from is null or private.operating_date_of(coalesce(lower(m.scheduled), m.recorded_at)) >= _from)
    and (_to is null or private.operating_date_of(coalesce(lower(m.scheduled), m.recorded_at)) <= _to);
$$;

create or replace function public.get_leaderboard(_from date default null, _to date default null, _limit int default 50)
returns table (rank int, player_name text, played int, wins int, losses int, points int, point_diff int, is_me boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'Sign in to see the leaderboard.' using errcode = '42501';
  end if;
  return query
  select (rank() over (order by sum(mr.points) desc, count(*) filter (where mr.won) desc,
                       sum(mr.points_for - mr.points_against) desc))::int,
         private.public_name(mr.player_id), count(*)::int, (count(*) filter (where mr.won))::int,
         (count(*) filter (where not mr.won))::int, sum(mr.points)::int, sum(mr.points_for - mr.points_against)::int,
         mr.player_id = auth.uid()
  from private.match_results(_from, _to) mr
  join public.profiles p on p.id = mr.player_id and not p.leaderboard_opt_out and p.status = 'active'
  group by mr.player_id
  order by 1, 2
  limit least(greatest(coalesce(_limit, 50), 1), 200);
end;
$$;

create or replace function public.get_attendance_leaderboard(_days int default 30, _limit int default 50)
returns table (rank int, player_name text, sessions int, is_me boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'Sign in to see the leaderboard.' using errcode = '42501';
  end if;
  return query
  select (rank() over (order by count(*) desc))::int, private.public_name(c.player_id), count(*)::int,
         c.player_id = auth.uid()
  from public.check_ins c
  join public.profiles p on p.id = c.player_id and not p.leaderboard_opt_out and p.status = 'active'
  where c.checked_in_at >= now() - make_interval(days => least(greatest(coalesce(_days, 30), 1), 366))
  group by c.player_id
  order by 1, 2
  limit least(greatest(coalesce(_limit, 50), 1), 200);
end;
$$;

-- Each of my results and the leaderboard points it earned.
create or replace function public.get_my_match_history()
returns table (match_id uuid, event_title text, event_slug text, division_name text, played_on date,
               opponent text, won boolean, walkover boolean, score text, points int)
language sql
stable
security definer
set search_path = ''
as $$
  select mr.match_id, e.title, e.slug, d.name, mr.played_on,
         private.entry_label(case when r.id = m.entry_a then m.entry_b else m.entry_a end),
         mr.won, mr.walkover,
         case when mr.walkover then 'Walkover' else mr.points_for || '–' || mr.points_against end,
         mr.points
  from private.match_results(null, null) mr
  join public.event_matches m on m.id = mr.match_id
  join public.events e on e.id = m.event_id
  join public.event_divisions d on d.id = m.division_id
  join public.event_registrations r on r.id in (m.entry_a, m.entry_b) and mr.player_id in (r.player_id, r.partner_id)
  where mr.player_id = auth.uid()
  order by mr.played_on desc, e.title;
$$;

-- ---------------------------------------------------------------------------
-- Open-play queue ("paddle stacking")
-- ---------------------------------------------------------------------------
create table public.queue_games (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  court_id uuid not null references public.courts (id) on delete restrict,
  status text not null default 'called' check (status in ('called', 'playing', 'completed', 'cancelled')),
  winning_team text check (winning_team in ('a', 'b')),
  called_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  called_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index queue_games_one_active_per_court on public.queue_games (court_id) where status in ('called', 'playing');
create index queue_games_event_idx on public.queue_games (event_id, status);

create table public.queue_entries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  registration_id uuid references public.event_registrations (id) on delete set null,
  status text not null default 'waiting'
    check (status in ('waiting', 'called', 'playing', 'completed', 'no_show', 'left', 'removed')),
  queued_at timestamptz not null default clock_timestamp(),
  game_id uuid references public.queue_games (id) on delete set null,
  court_id uuid references public.courts (id) on delete set null,
  team text check (team in ('a', 'b')),
  stay_court_id uuid references public.courts (id) on delete set null,
  consecutive_games smallint not null default 0,
  outcome text check (outcome in ('won', 'lost')),
  called_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status not in ('called', 'playing') or (game_id is not null and court_id is not null and team is not null))
);

-- One live place in a session's queue per player.
create unique index queue_entries_one_active on public.queue_entries (event_id, player_id)
  where status in ('waiting', 'called', 'playing');
create index queue_entries_waiting_idx on public.queue_entries (event_id, queued_at) where status = 'waiting';
create index queue_entries_game_idx on public.queue_entries (game_id);

create trigger queue_games_set_updated_at before update on public.queue_games
for each row execute function private.set_updated_at();
create trigger queue_entries_set_updated_at before update on public.queue_entries
for each row execute function private.set_updated_at();
create trigger queue_games_audit after insert or update or delete on public.queue_games
for each row execute function private.write_audit();
create trigger queue_entries_audit after insert or update or delete on public.queue_entries
for each row execute function private.write_audit();

alter table public.queue_games enable row level security;
alter table public.queue_entries enable row level security;
create policy "Event managers read queue games" on public.queue_games
for select to authenticated
using (exists (select 1 from public.events e where e.id = event_id and private.can_manage_event_type(e.event_type)));
create policy "Event managers read queue entries" on public.queue_entries
for select to authenticated
using (exists (select 1 from public.events e where e.id = event_id and private.can_manage_event_type(e.event_type)));
create policy "Players read their own queue entries" on public.queue_entries
for select to authenticated using (player_id = (select auth.uid()));
grant select on public.queue_games, public.queue_entries to authenticated;

-- Queue and match changes refresh the live court view.
create or replace function private.signal_today()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.bump_schedule_signal(private.operating_date_of(now()));
  return null;
end;
$$;
create trigger queue_games_signal after insert or update or delete on public.queue_games
for each statement execute function private.signal_today();
create trigger event_matches_signal after insert or update or delete on public.event_matches
for each statement execute function private.signal_today();

create or replace function private.queue_session(_event_id uuid)
returns public.events
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _e public.events;
begin
  select * into _e from public.events where id = _event_id;
  if not found or _e.status = 'draft' then
    raise exception 'That session was not found.' using errcode = 'P0002';
  end if;
  if _e.event_type <> 'open_play' then
    raise exception 'Only open play sessions have a queue.' using errcode = '22023';
  end if;
  if _e.status in ('cancelled', 'completed') then
    raise exception 'This session is %.', _e.status using errcode = '22023';
  end if;
  return _e;
end;
$$;

-- The player's confirmed, checked-in registration for the session.
create or replace function private.queue_registration(_event_id uuid, _player_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _r public.event_registrations;
begin
  select * into _r from public.event_registrations
  where event_id = _event_id and _player_id in (player_id, partner_id) and status in ('pending', 'confirmed')
  order by status = 'confirmed' desc limit 1;
  if not found then
    raise exception 'Register for this session first.' using errcode = '22023';
  end if;
  if _r.status <> 'confirmed' then
    raise exception 'Your entry fee has not been confirmed yet.' using errcode = '22023';
  end if;
  if _r.attendance is distinct from 'present' then
    raise exception 'Check in at the desk before joining the queue.' using errcode = '22023';
  end if;
  return _r.id;
end;
$$;

create or replace function private.enqueue(_event_id uuid, _player_id uuid, _reg uuid, _consecutive int, _stay_court uuid)
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
    case when _player_id = auth.uid() then 'You are' else private.public_name(_player_id) || ' is' end
    using errcode = '23505';
end;
$$;

create or replace function public.join_queue(_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := private.require_bookable_player();
  _e public.events := private.queue_session(_event_id);
begin
  perform pg_advisory_xact_lock(hashtext('dd.queue'), hashtext(_e.id::text));
  return private.enqueue(_e.id, _uid, private.queue_registration(_e.id, _uid), 0, null);
end;
$$;

create or replace function public.leave_queue(_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := private.require_bookable_player();
  _q public.queue_entries;
begin
  perform pg_advisory_xact_lock(hashtext('dd.queue'), hashtext(_event_id::text));
  select * into _q from public.queue_entries
  where event_id = _event_id and player_id = _uid and status in ('waiting', 'called', 'playing');
  if not found then
    raise exception 'You are not in the queue.' using errcode = 'P0002';
  end if;
  if _q.status <> 'waiting' then
    raise exception 'You are on court. Ask staff to take you off.' using errcode = '22023';
  end if;
  update public.queue_entries set status = 'left', ended_at = now() where id = _q.id;
end;
$$;

create or replace function public.staff_queue_add(_event_id uuid, _player_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _e public.events := private.queue_session(_event_id);
begin
  perform private.require_event_manager(_event_id);
  perform pg_advisory_xact_lock(hashtext('dd.queue'), hashtext(_e.id::text));
  return private.enqueue(_e.id, _player_id, private.queue_registration(_e.id, _player_id), 0, null);
end;
$$;

create or replace function public.staff_queue_remove(_entry_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _q public.queue_entries;
  _why text := private.require_reason(_reason);
begin
  select * into _q from public.queue_entries where id = _entry_id;
  if not found then
    raise exception 'That queue entry was not found.' using errcode = 'P0002';
  end if;
  perform private.require_event_manager(_q.event_id);
  perform pg_advisory_xact_lock(hashtext('dd.queue'), hashtext(_q.event_id::text));
  select * into _q from public.queue_entries where id = _entry_id;
  if _q.status <> 'waiting' then
    raise exception 'Only waiting players can be removed. Use no-show or finish the game instead.' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', _why, true);
  update public.queue_entries set status = 'removed', ended_at = now() where id = _q.id;
end;
$$;

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
  if exists (select 1 from public.queue_games where court_id = _court_id and status in ('called', 'playing')) then
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

create or replace function public.staff_start_game(_game_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _g public.queue_games;
begin
  select * into _g from public.queue_games where id = _game_id for update;
  if not found then
    raise exception 'That game was not found.' using errcode = 'P0002';
  end if;
  perform private.require_event_manager(_g.event_id);
  if _g.status <> 'called' then
    raise exception 'This game is already %.', _g.status using errcode = '22023';
  end if;
  update public.queue_games set status = 'playing', started_at = now() where id = _g.id;
  update public.queue_entries set status = 'playing', started_at = now() where game_id = _g.id and status = 'called';
end;
$$;

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

  -- Call the next waiting player into the same place.
  select id into _repl from public.queue_entries
  where event_id = _q.event_id and status = 'waiting' and player_id <> _q.player_id and stay_court_id is null
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
  if _e.queue_rotation = 'winners_stay' and _winning_team is null then
    raise exception 'This session keeps winners on court. Choose the winning team.' using errcode = '22023';
  end if;

  update public.queue_games set status = 'completed', ended_at = now(), winning_team = _winning_team where id = _g.id;
  for _q in select * from public.queue_entries where game_id = _g.id and status = 'playing'
            order by (team = _winning_team) desc nulls last, queued_at, id loop
    update public.queue_entries
       set status = 'completed', ended_at = now(),
           outcome = case when _winning_team is null then null when team = _winning_team then 'won' else 'lost' end
     where id = _q.id;
    _stays := _e.queue_rotation = 'winners_stay' and _q.team = _winning_team
              and _q.consecutive_games + 1 < _e.queue_max_consecutive;
    perform private.enqueue(_g.event_id, _q.player_id, _q.registration_id,
      case when _stays then _q.consecutive_games + 1 else 0 end,
      case when _stays then _g.court_id end);
  end loop;
end;
$$;

create or replace function public.staff_cancel_game(_game_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _g public.queue_games;
begin
  select * into _g from public.queue_games where id = _game_id for update;
  if not found then
    raise exception 'That game was not found.' using errcode = 'P0002';
  end if;
  perform private.require_event_manager(_g.event_id);
  if _g.status not in ('called', 'playing') then
    raise exception 'This game is already %.', _g.status using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', 'Queue game cancelled; players keep their places', true);
  update public.queue_games set status = 'cancelled', ended_at = now() where id = _g.id;
  update public.queue_entries
     set status = 'waiting', game_id = null, court_id = null, team = null, called_at = null, started_at = null
   where game_id = _g.id and status in ('called', 'playing');
end;
$$;

-- The live queue for staff and for players registered in the session.
create or replace function public.get_queue(_event_id uuid)
returns table (
  entry_id uuid, player_name text, status text, queue_position int, queued_at timestamptz,
  game_id uuid, game_status text, court_id uuid, court_name text, team text,
  consecutive_games smallint, games_played int, stays_on_court boolean, is_me boolean
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
              then (row_number() over (partition by (q.status = 'waiting')
                                       order by (q.stay_court_id is not null) desc, q.queued_at, q.id))::int end,
         q.queued_at, q.game_id, g.status, q.court_id, c.name, q.team, q.consecutive_games,
         (select count(*)::int from public.queue_entries x where x.event_id = _e.id and x.player_id = q.player_id
            and x.status = 'completed'),
         q.stay_court_id is not null, q.player_id = auth.uid()
  from public.queue_entries q
  left join public.queue_games g on g.id = q.game_id
  left join public.courts c on c.id = coalesce(q.court_id, q.stay_court_id)
  where q.event_id = _e.id and q.status in ('waiting', 'called', 'playing')
  order by q.status = 'waiting', c.sort_order, q.team, 4, q.queued_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Live court view: show what is happening on event and open-play courts
-- ---------------------------------------------------------------------------
create or replace function public.get_live_courts()
returns table (
  court_id uuid,
  court_number smallint,
  court_name text,
  status text,
  label text,
  until timestamptz,
  next_starts_at timestamptz,
  next_status text,
  as_of timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _today date := private.operating_date_of(now());
  _w record;
begin
  select * into _w from private.operating_window(_today);
  return query
  with live as (
    select bs.court_id, bs.slot, bs.kind, bs.status, bs.event_id,
           case when e.status <> 'draft' then e.title end as event_title
    from public.booking_slots bs
    left join public.events e on e.id = bs.event_id
    where bs.operating_date in (_today, _today + 1)
      and bs.status not in ('released', 'cancelled', 'held')
  )
  select
    c.id, c.number, c.name,
    case
      when c.status = 'maintenance' then 'maintenance'
      when cur.kind = 'rental' then 'in_use'
      when cur.kind = 'maintenance' then 'maintenance'
      when cur.kind = 'block' then 'blocked'
      when cur.kind = 'private_event' then 'private_event'
      when cur.kind is not null then 'event'
      when _w.state <> 'open' or now() < _w.opens_at or now() >= _w.closes_at then 'closed'
      else 'available'
    end,
    case
      when cur.kind = 'open_play' then coalesce(cur.event_title, 'Open play')
        || case qg.status when 'playing' then ' · game in progress' when 'called' then ' · players called' else '' end
      when cur.kind = 'event' then coalesce(cur.event_title, 'Event') || coalesce(' · ' || mt.division_name, '')
      when cur.kind = 'private_event' then 'Private event'
      when cur.kind = 'maintenance' or c.status = 'maintenance' then 'Maintenance'
    end,
    upper(cur.slot),
    nxt.starts,
    case nxt.kind
      when 'rental' then 'booked' when 'maintenance' then 'maintenance' when 'block' then 'blocked'
      when 'private_event' then 'private_event' when null then null else 'event' end,
    now()
  from public.courts c
  left join lateral (
    select l.kind, l.slot, l.event_title, l.event_id from live l
    where l.court_id = c.id and l.slot @> now()
    limit 1
  ) cur on true
  left join lateral (
    select g.status from public.queue_games g
    where g.court_id = c.id and g.event_id = cur.event_id and g.status in ('called', 'playing')
    limit 1
  ) qg on true
  left join lateral (
    select d.name as division_name from public.event_matches m join public.event_divisions d on d.id = m.division_id
    where m.court_id = c.id and m.event_id = cur.event_id and m.scheduled @> now()
      and m.status in ('scheduled', 'in_progress')
    limit 1
  ) mt on true
  left join lateral (
    select lower(l.slot) as starts, l.kind from live l
    where l.court_id = c.id and lower(l.slot) > now()
    order by lower(l.slot)
    limit 1
  ) nxt on true
  where c.status <> 'inactive'
  order by c.sort_order, c.number;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function
  private.entry_label(uuid), private.advance_winner(public.event_matches, uuid),
  private.match_results(date, date), private.signal_today(), private.queue_session(uuid),
  private.queue_registration(uuid, uuid), private.enqueue(uuid, uuid, uuid, int, uuid)
  from public, anon, authenticated;

revoke all on function
  public.staff_generate_matches(uuid, text), public.staff_schedule_match(uuid, uuid, timestamptz, timestamptz),
  public.staff_record_match_result(uuid, int, int, uuid, text), public.get_event_matches(uuid),
  public.get_division_standings(uuid), public.get_leaderboard(date, date, int),
  public.get_attendance_leaderboard(int, int), public.get_my_match_history(),
  public.join_queue(uuid), public.leave_queue(uuid), public.staff_queue_add(uuid, uuid),
  public.staff_queue_remove(uuid, text), public.staff_call_next(uuid, uuid), public.staff_start_game(uuid),
  public.staff_queue_no_show(uuid), public.staff_complete_game(uuid, text), public.staff_cancel_game(uuid),
  public.get_queue(uuid)
  from public, anon, authenticated;

grant execute on function
  public.staff_generate_matches(uuid, text), public.staff_schedule_match(uuid, uuid, timestamptz, timestamptz),
  public.staff_record_match_result(uuid, int, int, uuid, text), public.get_event_matches(uuid),
  public.get_division_standings(uuid), public.get_leaderboard(date, date, int),
  public.get_attendance_leaderboard(int, int), public.get_my_match_history(),
  public.join_queue(uuid), public.leave_queue(uuid), public.staff_queue_add(uuid, uuid),
  public.staff_queue_remove(uuid, text), public.staff_call_next(uuid, uuid), public.staff_start_game(uuid),
  public.staff_queue_no_show(uuid), public.staff_complete_game(uuid, text), public.staff_cancel_game(uuid),
  public.get_queue(uuid)
  to authenticated;
