-- ============================================================================
-- Let event managers save the open play game time limit.
--
-- Writes to public.events are limited to listed columns (migration
-- 20261012000100); queue_game_minutes (20261101000100) was missing, so
-- creating or saving any event from the admin form was refused.
-- RLS still decides who may write which events.
-- ============================================================================

grant insert (queue_game_minutes), update (queue_game_minutes) on public.events to authenticated;
