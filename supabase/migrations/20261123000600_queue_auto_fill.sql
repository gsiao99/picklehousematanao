-- ============================================================================
-- Open play auto-fill (Phase C)
--
--   * events.queue_auto_fill (off by default): when staff finish a game, the
--     next game on that court is called straight away, by the session's
--     matching mode. If not enough players are waiting, the court stays free
--     and the game still finishes normally.
--
-- Additive: one new column; staff_complete_game recreated with the same
-- signature (the finishing logic is unchanged).
-- ============================================================================

alter table public.events
  add column if not exists queue_auto_fill boolean not null default false;
comment on column public.events.queue_auto_fill is
  'Open play: when a game is finished, call the next game on that court automatically.';
grant insert (queue_auto_fill), update (queue_auto_fill) on public.events to authenticated;

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

  -- Auto-fill: call the next game on this court now. Not enough players waiting
  -- (or the court's time is over): leave the court free; the result still stands.
  if _e.queue_auto_fill then
    begin
      perform public.staff_call_next(_g.event_id, _g.court_id);
    exception when sqlstate '22023' then
      null;
    end;
  end if;
end;
$$;
