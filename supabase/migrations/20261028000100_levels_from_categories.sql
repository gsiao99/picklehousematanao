-- ============================================================================
-- Player levels follow the event categories
--
-- Every event category is also a player level. Adding a category in
-- Admin → Events (e.g. "Rookie") adds a matching value to public.player_level
-- automatically, placed by the category's order, so it appears in sign-up,
-- profiles, staff-confirmed levels and every event's lowest/highest level.
-- Level names come from the category names, so renaming a category renames
-- the level everywhere.
--
--   * event_categories.level_key is the level's stored value (set once, from
--     the slug: "low-intermediate" → "low_intermediate").
--   * Enum values are never removed; hiding a category hides it from new
--     choices while existing profiles and events keep their level.
--   * Columns and function signatures do not change, so a rollback of the
--     website keeps working.
-- ============================================================================

alter table public.event_categories add column level_key text unique
  check (level_key ~ '^[a-z][a-z0-9_]{0,62}$');

comment on column public.event_categories.level_key is
  'The public.player_level value this category stands for. Set when the category is created; never changes.';

-- The stored level for a category slug: lower case, underscores, starting with a letter.
create or replace function private.level_key_for(_slug text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(case when k ~ '^[a-z]' then k else 'level_' || k end, 63)
  from (select trim(both '_' from regexp_replace(lower(coalesce(_slug, '')), '[^a-z0-9]+', '_', 'g')) as k) s;
$$;

-- Make sure a level exists, placed before the next category in order (else last).
create or replace function private.ensure_player_level(_key text, _sort int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _before text;
begin
  if exists (select 1 from pg_enum e where e.enumtypid = 'public.player_level'::regtype and e.enumlabel = _key) then
    return;
  end if;
  select c.level_key into _before
  from public.event_categories c
  join pg_enum e on e.enumtypid = 'public.player_level'::regtype and e.enumlabel = c.level_key
  where c.sort_order > _sort and c.level_key <> _key
  order by c.sort_order, c.name
  limit 1;
  if _before is not null then
    execute format('alter type public.player_level add value %L before %L', _key, _before);
  else
    execute format('alter type public.player_level add value %L', _key);
  end if;
end;
$$;

-- Existing categories (Novice … Advanced match the current levels; Rookie and any others are added).
update public.event_categories set level_key = private.level_key_for(slug) where level_key is null;

do $$
declare
  _c record;
begin
  for _c in select level_key, sort_order from public.event_categories order by sort_order, name loop
    perform private.ensure_player_level(_c.level_key, _c.sort_order);
  end loop;
end $$;

-- New categories get their level; the key never changes afterwards.
create or replace function private.category_level()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.level_key := coalesce(new.level_key, private.level_key_for(new.slug));
    perform private.ensure_player_level(new.level_key, new.sort_order);
  else
    new.level_key := old.level_key;
  end if;
  return new;
end;
$$;

create trigger event_categories_level
before insert or update on public.event_categories
for each row execute function private.category_level();

-- Level names come from the category names (stable now: they read a table).
create or replace function private.level_label(_l public.player_level)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select c.name from public.event_categories c where c.level_key = _l::text),
    case _l::text when 'novice' then 'Novice' when 'low_intermediate' then 'Low intermediate'
                  when 'high_intermediate' then 'High intermediate' when 'advanced' then 'Advanced'
                  else initcap(replace(_l::text, '_', ' ')) end);
$$;

create or replace function private.skill_text(_min public.player_level, _max public.player_level)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when _min is null and _max is null then 'All levels'
    when _min = _max then private.level_label(_min)
    when _max is null then private.level_label(_min) || ' and up'
    when _min is null then 'Up to ' || private.level_label(_max)
    else private.level_label(_min) || ' to ' || private.level_label(_max) end;
$$;

revoke all on function
  private.level_key_for(text),
  private.ensure_player_level(text, int),
  private.category_level()
  from public;
