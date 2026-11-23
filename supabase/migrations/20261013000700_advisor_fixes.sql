-- ============================================================================
-- Database advisor fixes (Oct 13 2026)
--
--   * private.venue_time_zone had no fixed search_path (security advisor).
--   * Foreign keys without a covering index (performance advisor): lookups and
--     deletes that follow these links (deleting an event, a player, a booking)
--     would scan whole tables as data grows. Additive only.
-- ============================================================================

alter function private.venue_time_zone() set search_path = '';

create index if not exists booking_slots_created_by_idx on public.booking_slots (created_by);
create index if not exists bookings_cancelled_by_idx on public.bookings (cancelled_by);
create index if not exists bookings_created_by_idx on public.bookings (created_by);
create index if not exists check_ins_checked_in_by_idx on public.check_ins (checked_in_by);
create index if not exists check_ins_event_idx on public.check_ins (event_id);
create index if not exists event_divisions_category_idx on public.event_divisions (category_id);
create index if not exists event_matches_entry_a_idx on public.event_matches (entry_a);
create index if not exists event_matches_entry_b_idx on public.event_matches (entry_b);
create index if not exists event_matches_next_match_idx on public.event_matches (next_match_id);
create index if not exists event_matches_recorded_by_idx on public.event_matches (recorded_by);
create index if not exists event_matches_winner_idx on public.event_matches (winner);
create index if not exists event_registrations_category_idx on public.event_registrations (category_id);
create index if not exists event_registrations_checked_in_by_idx on public.event_registrations (checked_in_by);
create index if not exists event_registrations_created_by_idx on public.event_registrations (created_by);
create index if not exists event_registrations_division_idx on public.event_registrations (division_id);
create index if not exists events_created_by_idx on public.events (created_by);
create index if not exists payments_payment_method_idx on public.payments (payment_method_id);
create index if not exists payments_reviewed_by_idx on public.payments (reviewed_by);
create index if not exists payments_submitted_by_idx on public.payments (submitted_by);
create index if not exists queue_entries_court_idx on public.queue_entries (court_id);
create index if not exists queue_entries_player_idx on public.queue_entries (player_id);
create index if not exists queue_entries_registration_idx on public.queue_entries (registration_id);
create index if not exists queue_entries_stay_court_idx on public.queue_entries (stay_court_id);
create index if not exists queue_games_called_by_idx on public.queue_games (called_by);
create index if not exists queue_games_court_idx on public.queue_games (court_id);
create index if not exists staff_permissions_granted_by_idx on public.staff_permissions (granted_by);
create index if not exists user_roles_granted_by_idx on public.user_roles (granted_by);
