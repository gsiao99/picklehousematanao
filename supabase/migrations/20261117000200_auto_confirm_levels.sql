-- Player levels are confirmed automatically.
--
-- The level a player picks becomes their confirmed level straight away, so
-- nobody waits for staff. Staff can still change it with
-- staff_set_player_level, and a level staff have set is never overwritten by
-- the player changing their own pick later.
--
--   * A trigger fills profiles.level from self_rated_level whenever level is
--     empty (sign-up, or a player picking a level for the first time).
--   * Sign-up accepts any level that is an active event category. Until now it
--     only knew the four original levels, so a Rookie or Intermediate pick was
--     dropped.
--   * Players who already picked a level and were waiting are confirmed.

create function private.auto_confirm_level()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.level is null and new.self_rated_level is not null then
    new.level := new.self_rated_level;
  end if;
  return new;
end;
$$;

revoke all on function private.auto_confirm_level() from public;

create trigger profiles_auto_confirm_level
before insert or update of self_rated_level on public.profiles
for each row execute function private.auto_confirm_level();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  _name text := btrim(coalesce(_meta ->> 'full_name', ''));
  _phone text := regexp_replace(coalesce(_meta ->> 'phone', ''), '[^0-9]', '', 'g');
  _level text := _meta ->> 'self_rated_level';
  _consent boolean := coalesce((_meta ->> 'privacy_consent')::boolean, false);
begin
  if char_length(_name) < 2 then
    _name := coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Player');
  end if;
  if char_length(_name) > 80 then
    _name := left(_name, 80);
  end if;
  if _phone ~ '^639[0-9]{9}$' then
    _phone := '0' || substr(_phone, 3);
  end if;
  if _phone !~ '^09[0-9]{9}$' then
    _phone := null;
  end if;
  -- Only levels on offer: the active event categories.
  if _level is not null and not exists (
    select 1 from public.event_categories c where c.level_key = _level and c.is_active
  ) then
    _level := null;
  end if;

  insert into public.profiles (id, full_name, phone, self_rated_level, privacy_consent_at)
  values (new.id, _name, _phone, _level::public.player_level, case when _consent then now() end);

  insert into public.user_roles (user_id, role) values (new.id, 'player');

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public;

do $$
begin
  perform set_config('app.audit_reason', 'Player levels confirmed automatically', true);
  update public.profiles set level = self_rated_level
  where level is null and self_rated_level is not null;
end;
$$;
