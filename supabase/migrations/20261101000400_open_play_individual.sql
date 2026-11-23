-- ============================================================================
-- Open play is for individual players
--
-- Every player books their own place in an open play session; no partners.
--   * Divisions of an open play session are always singles (team_size 1);
--     existing doubles divisions in open play sessions are switched.
--   * A registration with a partner is refused for open play sessions.
-- Tournaments and other events keep doubles with partners.
-- ============================================================================

update public.event_divisions d set team_size = 1
from public.events e
where e.id = d.event_id and e.event_type = 'open_play' and d.team_size <> 1;

create or replace function private.open_play_division_individual()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.events e where e.id = new.event_id and e.event_type = 'open_play') then
    new.team_size := 1;
  end if;
  return new;
end;
$$;

create trigger event_divisions_open_play_individual
before insert or update on public.event_divisions
for each row execute function private.open_play_division_individual();

-- Named to run before event_registrations_check, so this clearer message wins.
create or replace function private.open_play_registration_individual()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.partner_id is not null
     and exists (select 1 from public.events e where e.id = new.event_id and e.event_type = 'open_play') then
    raise exception 'Open play is for individual players. Each player books their own place.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger event_registrations_a_open_play_individual
before insert or update of partner_id on public.event_registrations
for each row execute function private.open_play_registration_individual();

revoke all on function private.open_play_division_individual(), private.open_play_registration_individual() from public;
