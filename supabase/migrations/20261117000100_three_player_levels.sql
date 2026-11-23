-- ============================================================================
-- Three player levels: Rookie, Novice, Intermediate
--
-- The owner's decision (17 Nov 2026): Low Intermediate, High Intermediate and
-- Advanced are no longer offered. Players holding one of them, self-rated or
-- set by staff, become Intermediate. The three categories are hidden, not
-- deleted: level values are never removed (see 20261028000100).
--
-- Data only; no columns or functions change, so a website rollback keeps
-- working. Does nothing where the club has no Intermediate category.
-- ============================================================================

do $$
begin
  if not exists (select 1 from public.event_categories where level_key = 'intermediate')
     or not exists (select 1 from pg_enum where enumtypid = 'public.player_level'::regtype and enumlabel = 'intermediate') then
    return;
  end if;

  perform set_config('app.audit_reason', 'Player levels reduced to Rookie, Novice and Intermediate', true);

  update public.profiles
  set self_rated_level = 'intermediate'
  where self_rated_level::text in ('low_intermediate', 'high_intermediate', 'advanced');

  update public.profiles
  set level = 'intermediate'
  where level::text in ('low_intermediate', 'high_intermediate', 'advanced');

  update public.event_categories
  set is_active = false
  where level_key in ('low_intermediate', 'high_intermediate', 'advanced');

  -- Intermediate follows Novice in every list.
  update public.event_categories set sort_order = 2 where level_key = 'intermediate';
end $$;
