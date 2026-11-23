-- ============================================================================
-- API grants — least privilege
--
-- Supabase grants anon and authenticated full table and function privileges
-- in the public schema by default and relies on RLS alone. We remove those
-- defaults and grant only what each role is meant to use, so a missing
-- policy can never open a table by accident. RLS still decides which rows.
-- ============================================================================

-- Tables: start from nothing. Only this project's tables are listed, so
-- applying this to a project that already has other tables leaves them alone.
revoke all on
  public.audit_log, public.profiles, public.user_roles, public.staff_permissions,
  public.venue_settings, public.courts, public.operating_hours, public.rate_rules, public.payment_methods,
  public.event_categories, public.events, public.bookings, public.booking_slots, public.payments,
  public.event_registrations
  from anon, authenticated;
revoke all on sequence public.audit_log_id_seq from anon, authenticated;

-- Public venue information (read-only for everyone)
grant select on public.venue_settings, public.courts, public.operating_hours, public.rate_rules,
  public.payment_methods, public.event_categories, public.events
  to anon, authenticated;

-- Signed-in reads; RLS limits each to the caller's own rows or staff
grant select on public.profiles, public.user_roles, public.staff_permissions, public.bookings,
  public.booking_slots, public.payments, public.event_registrations, public.audit_log
  to authenticated;

-- Players may change only these profile fields (RLS: their own row)
grant update (full_name, display_name, phone, self_rated_level, avatar_path, leaderboard_opt_out)
  on public.profiles to authenticated;

-- Staff and admin writes; RLS restricts each to the right permission
grant update on public.venue_settings to authenticated;
grant insert, update, delete on public.courts, public.operating_hours, public.rate_rules,
  public.payment_methods, public.event_categories, public.events
  to authenticated;
grant insert, update, delete on public.booking_slots to authenticated;

-- Deliberately no direct writes on: profiles (except the columns above),
-- user_roles, staff_permissions, bookings, payments, event_registrations,
-- audit_log. Those change only through SECURITY DEFINER functions.

-- Functions: nothing callable unless granted --------------------------------
revoke execute on function
  public.get_my_access(),
  public.admin_list_members(text, int, int),
  public.admin_grant_role(uuid, public.app_role, text),
  public.admin_revoke_role(uuid, public.app_role, text),
  public.admin_set_staff_permissions(uuid, public.app_permission[], text),
  public.admin_set_account_status(uuid, public.account_status, text),
  public.staff_set_player_level(uuid, public.player_level, text)
  from public, anon, authenticated;

grant execute on function public.get_my_access() to authenticated;
grant execute on function
  public.admin_list_members(text, int, int),
  public.admin_grant_role(uuid, public.app_role, text),
  public.admin_revoke_role(uuid, public.app_role, text),
  public.admin_set_staff_permissions(uuid, public.app_permission[], text),
  public.admin_set_account_status(uuid, public.account_status, text),
  public.staff_set_player_level(uuid, public.player_level, text)
  to authenticated;

-- Future objects created by migrations get no API access until granted.
-- Note: this changes the default for every table created later in public.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
