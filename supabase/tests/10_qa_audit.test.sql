-- Phase 6 audit: schema-wide security checks, the QA fixes, dashboard numbers,
-- CSV report totals, rental check-in, and functions without earlier tests.
-- All rows are TEST FIXTURES inside this rolled-back transaction.
begin;
select plan(69);

-- ---------------------------------------------------------------------------
-- Schema-wide security inventory
-- ---------------------------------------------------------------------------
select is_empty($$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and n.nspname in ('public', 'private') and not c.relrowsecurity $$,
  'every table in public and private has row level security on');
select is_empty($$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and n.nspname = 'public' and c.relrowsecurity
    and not exists (select 1 from pg_policy p where p.polrelid = c.oid) $$,
  'every public table has at least one policy');
select is_empty($$ select table_name from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public' and privilege_type <> 'SELECT' $$,
  'visitors have no write access to any table');
select is_empty($$ select table_name from information_schema.column_privileges
  where grantee = 'anon' and table_schema = 'public' and privilege_type <> 'SELECT' $$,
  'visitors have no column-level write access either');
select is_empty($$ select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef and n.nspname in ('public', 'private')
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') $$,
  'every SECURITY DEFINER function pins its search_path');
select is_empty($$ select table_name from information_schema.role_table_grants
  where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    and table_name in ('bookings', 'payments', 'event_registrations', 'user_roles', 'staff_permissions', 'notifications',
                       'check_ins', 'queue_entries', 'queue_games', 'event_matches', 'audit_log') $$,
  'bookings, payments, registrations, roles, queue, matches and the audit log are written only by database functions');
select is_empty($$ select column_name from information_schema.column_privileges
  where grantee = 'authenticated' and table_schema = 'public' and table_name = 'profiles'
    and privilege_type = 'UPDATE' and column_name in ('level', 'status', 'id', 'created_at') $$,
  'players cannot change their own staff-assessed level or account status');
select is_empty($$ select column_name from information_schema.column_privileges
  where grantee = 'authenticated' and table_schema = 'public' and table_name = 'events'
    and privilege_type in ('INSERT', 'UPDATE') and column_name in ('created_by', 'id', 'created_at') $$,
  'nobody can write who created an event');

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
create function pg_temp.as_user(_id text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', _id, 'role', 'authenticated')::text, true);
end $$;
-- The current hour on the venue clock: every "today" fixture uses it, so they
-- all share today's operating date whatever time the test runs.
create function pg_temp.now_slot() returns tstzrange language sql stable security definer as
  $$ select tstzrange(date_trunc('hour', now()), date_trunc('hour', now()) + interval '1 hour', '[)') $$;
create function pg_temp.court(_n int) returns uuid language sql stable security definer as
  $$ select id from public.courts where number = _n $$;
create table pg_temp.ids (name text primary key, id uuid);
grant all on pg_temp.ids to public;
create function pg_temp.id(_name text) returns uuid language sql stable as $$ select id from pg_temp.ids where name = _name $$;
create function pg_temp.notes(_user uuid, _kind text) returns int language sql stable security definer as
  $$ select count(*)::int from public.notifications where user_id = _user and kind = _kind $$;
grant execute on function pg_temp.as_user(text), pg_temp.now_slot(), pg_temp.court(int), pg_temp.id(text), pg_temp.notes(uuid, text) to public;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'ana@test.local', '{"full_name":"Ana Reyes","phone":"09171234567"}'),
  ('22222222-2222-4222-8222-222222222222', 'ben@test.local', '{"full_name":"Ben Cruz"}'),
  ('33333333-3333-4333-8333-333333333333', 'carla@test.local', '{"full_name":"Carla Mendoza"}'),
  ('55555555-5555-4555-8555-555555555555', 'lea@test.local', '{"full_name":"Lea Navarro"}'),
  ('66666666-6666-4666-8666-666666666666', 'hal@test.local', '{"full_name":"Hal Uy"}'),
  ('77777777-7777-4777-8777-777777777777', 'ivy@test.local', '{"full_name":"Ivy Lim"}'),
  ('88888888-8888-4888-8888-888888888888', 'kim@test.local', '{"full_name":"Kim Go"}');
insert into public.user_roles (user_id, role) values
  ('33333333-3333-4333-8333-333333333333', 'staff'), ('55555555-5555-4555-8555-555555555555', 'admin');
insert into public.staff_permissions (user_id, permission) values
  ('33333333-3333-4333-8333-333333333333', 'schedule.manage');

-- Today's bookings, all in the current hour:
--   B1 Ana  Court 1  confirmed, unpaid
--   B2 Ben  Court 2  confirmed, paid (GCash ₱250 approved today)
--   B3 Hal  Court 3  cancelled, refund due (cash ₱300 approved today)
--   B4 Ben  tomorrow confirmed, payment waiting for review
with b as (
  insert into public.bookings (player_id, created_by, status, payment_status, total_centavos, confirmed_at)
  values ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'confirmed', 'unpaid', 25000, now())
  returning id)
insert into pg_temp.ids select 'b1', id from b;
with b as (
  insert into public.bookings (player_id, created_by, status, payment_status, total_centavos, confirmed_at)
  values ('22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'confirmed', 'paid', 25000, now())
  returning id)
insert into pg_temp.ids select 'b2', id from b;
with b as (
  insert into public.bookings (player_id, created_by, status, payment_status, total_centavos, confirmed_at, cancelled_at, cancel_reason)
  values ('66666666-6666-4666-8666-666666666666', '66666666-6666-4666-8666-666666666666', 'cancelled', 'refund_due', 30000, now(), now(), 'Test')
  returning id)
insert into pg_temp.ids select 'b3', id from b;
with b as (
  insert into public.bookings (player_id, created_by, status, payment_status, total_centavos, confirmed_at)
  values ('22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'confirmed', 'pending_verification', 25000, now())
  returning id)
insert into pg_temp.ids select 'b4', id from b;

insert into public.booking_slots (booking_id, court_id, slot, kind, status, price_centavos) values
  (pg_temp.id('b1'), pg_temp.court(1), pg_temp.now_slot(), 'rental', 'confirmed', 25000),
  (pg_temp.id('b2'), pg_temp.court(2), pg_temp.now_slot(), 'rental', 'confirmed', 25000),
  (pg_temp.id('b3'), pg_temp.court(3), pg_temp.now_slot(), 'rental', 'cancelled', 30000),
  (pg_temp.id('b4'), pg_temp.court(1), tstzrange(date_trunc('hour', now()) + interval '1 day', date_trunc('hour', now()) + interval '25 hours', '[)'),
   'rental', 'confirmed', 25000);

insert into public.payments (booking_id, method_kind, amount_centavos, proof_path, status, submitted_by, reviewed_by, reviewed_at)
values
  (pg_temp.id('b2'), 'gcash', 25000, '22222222-2222-4222-8222-222222222222/' || pg_temp.id('b2') || '/r.png', 'approved',
   '22222222-2222-4222-8222-222222222222', '55555555-5555-4555-8555-555555555555', now()),
  (pg_temp.id('b3'), 'cash', 30000, null, 'approved',
   '55555555-5555-4555-8555-555555555555', '55555555-5555-4555-8555-555555555555', now());
insert into public.payments (booking_id, method_kind, amount_centavos, proof_path, status, submitted_by)
values (pg_temp.id('b4'), 'gcash', 25000, '22222222-2222-4222-8222-222222222222/' || pg_temp.id('b4') || '/r.png', 'submitted',
        '22222222-2222-4222-8222-222222222222');

-- An open-play session running now with Court 3 (free since B3 was cancelled)
with e as (
  insert into public.events (slug, title, event_type, starts_at, ends_at, status)
  values ('qa-open-play', 'QA Open Play', 'open_play', now() - interval '1 hour', now() + interval '3 hours', 'registration_open')
  returning id)
insert into pg_temp.ids select 'op', id from e;
insert into public.booking_slots (event_id, court_id, slot, kind, status, price_centavos)
values (pg_temp.id('op'), pg_temp.court(3), tstzrange(now() - interval '1 hour', now() + interval '3 hours', '[)'), 'open_play', 'confirmed', 0);
insert into public.event_registrations (event_id, player_id, status, attendance)
select pg_temp.id('op'), u, 'confirmed', 'present'
from unnest(array['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
                  '66666666-6666-4666-8666-666666666666', '77777777-7777-4777-8777-777777777777',
                  '88888888-8888-4888-8888-888888888888']::uuid[]) u;

-- ---------------------------------------------------------------------------
-- Dashboard calculations (as a staff member)
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('33333333-3333-4333-8333-333333333333');
select is((select bookings_today from public.staff_dashboard()), 2, 'dashboard: two confirmed bookings today (the cancelled one is excluded)');
select is((select court_hours_today from public.staff_dashboard()), 2, 'dashboard: two court-hours today');
select is((select unpaid_today from public.staff_dashboard()), 1, 'dashboard: one of today''s bookings is unpaid');
select is((select pending_payments from public.staff_dashboard()), 1, 'dashboard: one payment waiting for review');
select is((select refunds_due from public.staff_dashboard()), 1, 'dashboard: one refund due');
select is((select courts_in_use from public.staff_dashboard()), 3,
  'dashboard: courts in use now counts two rentals and the open-play court');
select is((select courts_total from public.staff_dashboard()), 3, 'dashboard: three courts in service');

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
select throws_ok($$ select * from public.report_payments(current_date, current_date) $$, '42501', null,
  'reports: staff without reports.view are refused');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select * from public.report_revenue_daily(current_date, current_date) $$, '42501', null,
  'reports: visitors are refused');
reset role;
set local role authenticated;
select pg_temp.as_user('55555555-5555-4555-8555-555555555555');
select throws_ok($$ select * from public.report_bookings(current_date, current_date - 1) $$, '22023', null,
  'reports: an end date before the start is refused');
select throws_ok($$ select * from public.report_bookings(current_date - 400, current_date) $$, '22023', null,
  'reports: more than a year at once is refused');
select is((select count(*)::int from public.report_bookings(private.operating_date_of(now()), private.operating_date_of(now()))), 3,
  'bookings report: today''s three bookings (tomorrow''s is outside the range)');
select is((select approved_centavos from public.report_bookings(private.operating_date_of(now()), private.operating_date_of(now()))
           where player_name = 'Ben Cruz'), 25000::bigint, 'bookings report: approved amount per booking');
select is((select count(*)::int from public.report_payments(private.operating_date_of(now()), private.operating_date_of(now()))), 3,
  'payments report: every payment submitted today, whatever its status');
select is((select payments_approved || '|' || court_rental_centavos || '|' || cash_centavos || '|' || online_centavos || '|'
                  || total_centavos || '|' || refunded_or_due_centavos
           from public.report_revenue_daily(private.operating_date_of(now()), private.operating_date_of(now()))),
  '2|55000|30000|25000|55000|30000',
  'revenue report: only approved money counts; cash and online add up to the total; refunds shown separately');
select is((select count(*)::int from public.report_revenue_daily(private.operating_date_of(now()) - 6, private.operating_date_of(now()))), 7,
  'revenue report: one row per day, including days with no revenue');
select is((select sum(total_centavos)::bigint from public.report_revenue_daily(private.operating_date_of(now()) - 6, private.operating_date_of(now()))),
  (select sum(amount_centavos)::bigint from public.payments where status = 'approved'),
  'revenue report: the week''s total equals the sum of approved payments');
select is((select count(*)::int from public.report_event_registrations(pg_temp.id('op'))), 5,
  'registrations report: every entry of the event');

-- ---------------------------------------------------------------------------
-- Rental check-in and play history
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select pg_temp.as_user('33333333-3333-4333-8333-333333333333');
select throws_ok($$ select public.staff_check_in_booking(pg_temp.id('b1')) $$, '42501', null,
  'check-in: staff without bookings.manage cannot check in rentals');
reset role;
set local role authenticated;
select pg_temp.as_user('55555555-5555-4555-8555-555555555555');
select lives_ok($$ select public.staff_check_in_booking(pg_temp.id('b1')) $$, 'check-in: the admin checks Ana in for her rental');
select lives_ok($$ select public.staff_check_in_booking(pg_temp.id('b1')) $$, 'check-in: checking in twice is harmless');
select is((select count(*)::int from public.check_ins where booking_id = pg_temp.id('b1')), 1, 'check-in: one record per booking per day');
select is((select status::text from public.booking_slots where booking_id = pg_temp.id('b1')), 'checked_in', 'check-in: the slot is marked checked in');
select throws_ok($$ select public.staff_check_in_booking(pg_temp.id('b4')) $$, '22023', 'This booking has no court time today.',
  'check-in: a booking for another day cannot be checked in today');
select throws_ok($$ select public.staff_check_in_booking(pg_temp.id('b3')) $$, '22023', null,
  'check-in: a cancelled booking cannot be checked in');
select is((select count(*)::int from public.report_check_ins(private.operating_date_of(now()), private.operating_date_of(now()))), 1,
  'check-ins report: lists the check-in');
reset role;
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select is((select kind from public.get_my_play_history()), 'court_rental', 'play history: the rental check-in appears for Ana');
select is((select sessions from public.get_attendance_leaderboard(30) where is_me), 1, 'attendance board: counts Ana''s check-in');
select is((select count(*)::int from public.get_my_payments()), 0, 'my payments: Ana sees none of Ben''s payments');
reset role;
set local role authenticated;
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select is((select count(*)::int from public.get_my_payments()), 2, 'my payments: Ben sees his two payments');

-- ---------------------------------------------------------------------------
-- Queue fixes
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select lives_ok($$ select public.join_queue(pg_temp.id('op')) $$, 'queue: Ana joins');
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select lives_ok($$ select public.join_queue(pg_temp.id('op')) $$, 'queue: Ben joins');
select pg_temp.as_user('66666666-6666-4666-8666-666666666666');
select lives_ok($$ select public.join_queue(pg_temp.id('op')) $$, 'queue: Hal joins');
select pg_temp.as_user('77777777-7777-4777-8777-777777777777');
select lives_ok($$ select public.join_queue(pg_temp.id('op')) $$, 'queue: Ivy joins');
select pg_temp.as_user('88888888-8888-4888-8888-888888888888');
select lives_ok($$ select public.join_queue(pg_temp.id('op')) $$, 'queue: Kim joins (fifth, waiting)');

select pg_temp.as_user('55555555-5555-4555-8555-555555555555');
select lives_ok($$ select public.staff_call_next(pg_temp.id('op'), pg_temp.court(3)) $$, 'queue: four players are called to Court 3');
select lives_ok($$ select public.staff_cancel_registration(
  (select id from public.event_registrations where event_id = pg_temp.id('op') and player_id = '88888888-8888-4888-8888-888888888888'),
  'Left early') $$, 'staff cancel Kim''s entry');
select is((select status from public.queue_entries where event_id = pg_temp.id('op') and player_id = '88888888-8888-4888-8888-888888888888'),
  'removed', 'FIX: a cancelled entry leaves the waiting line and cannot be called');
select is((select count(*)::int from public.get_queue(pg_temp.id('op')) where status = 'waiting'), 0, 'the waiting line is now empty');
select is(pg_temp.notes('88888888-8888-4888-8888-888888888888', 'registration_cancelled'), 1, 'the player is notified of the cancellation');

select lives_ok($$ select public.staff_cancel_event(pg_temp.id('op'), 'Power cut') $$, 'staff cancel the session mid-game');
select is((select count(*)::int from public.queue_games where event_id = pg_temp.id('op') and status in ('called', 'playing')), 0,
  'FIX: the unfinished game is closed when the session is cancelled');
select is((select count(*)::int from public.queue_entries where event_id = pg_temp.id('op') and status in ('waiting', 'called', 'playing')), 0,
  'FIX: nobody is left active in a cancelled session''s queue');
select is((select status::text from public.booking_slots where event_id = pg_temp.id('op')), 'cancelled', 'the session''s court is released');
select is((select count(*)::int from public.event_registrations where event_id = pg_temp.id('op') and status = 'cancelled'), 5,
  'every entry of the cancelled session is cancelled');

-- A new session on Court 3, while an old session's game was never finished
reset role;
with e as (
  insert into public.events (slug, title, event_type, starts_at, ends_at, status)
  values ('qa-old-session', 'Old Session', 'open_play', now() - interval '8 days', now() - interval '7 days', 'registration_open')
  returning id)
insert into pg_temp.ids select 'old', id from e;
insert into public.queue_games (event_id, court_id, status) values (pg_temp.id('old'), pg_temp.court(3), 'playing');
with e as (
  insert into public.events (slug, title, event_type, starts_at, ends_at, status)
  values ('qa-new-session', 'New Session', 'open_play', now() - interval '30 minutes', now() + interval '2 hours', 'registration_open')
  returning id)
insert into pg_temp.ids select 'new', id from e;
insert into public.booking_slots (event_id, court_id, slot, kind, status, price_centavos)
values (pg_temp.id('new'), pg_temp.court(3), tstzrange(now() - interval '30 minutes', now() + interval '2 hours', '[)'), 'open_play', 'confirmed', 0);
insert into public.event_registrations (event_id, player_id, status, attendance)
select pg_temp.id('new'), u, 'confirmed', 'present'
from unnest(array['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
                  '66666666-6666-4666-8666-666666666666', '77777777-7777-4777-8777-777777777777']::uuid[]) u;
insert into public.queue_entries (event_id, player_id, status)
select pg_temp.id('new'), u, 'waiting'
from unnest(array['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
                  '66666666-6666-4666-8666-666666666666', '77777777-7777-4777-8777-777777777777']::uuid[]) u;
set local role authenticated;
select pg_temp.as_user('55555555-5555-4555-8555-555555555555');
select lives_ok($$ select public.staff_call_next(pg_temp.id('new'), pg_temp.court(3)) $$,
  'FIX: a game left open in an old session no longer blocks the court for a new session');
select throws_ok($$ select public.staff_call_next(pg_temp.id('new'), pg_temp.court(3)) $$, null, null,
  'still only one active game per court within a session');
select lives_ok($$ update public.events set status = 'completed' where id = pg_temp.id('new') $$, 'staff mark the session completed');
select is((select count(*)::int from public.queue_games where event_id = pg_temp.id('new') and status in ('called', 'playing')), 0,
  'FIX: completing a session closes its unfinished game');

-- ---------------------------------------------------------------------------
-- Event write hardening, court release, registration cancellation
-- ---------------------------------------------------------------------------
select throws_ok($$ insert into public.events (slug, title, event_type, starts_at, ends_at, created_by)
  values ('forged', 'Forged', 'social', now() + interval '1 day', now() + interval '1 day 2 hours', '11111111-1111-4111-8111-111111111111') $$,
  '42501', null, 'FIX: an event manager cannot forge who created an event');
select lives_ok($$ insert into public.events (slug, title, event_type, starts_at, ends_at, capacity, status)
  values ('qa-social', 'QA Social', 'social', now() + interval '2 days', now() + interval '2 days 2 hours', 1, 'registration_open') $$,
  'an event manager creates an event (creator from the session)');
select is((select created_by from public.events where slug = 'qa-social'), '55555555-5555-4555-8555-555555555555'::uuid,
  'the creator is the signed-in manager');
select throws_ok($$ update public.events set status = 'cancelled' where slug = 'qa-social' $$, '23514', null,
  'FIX: an event cannot be cancelled without a reason, even by a direct update');
select lives_ok($$ select public.staff_assign_event_courts((select id from public.events where slug = 'qa-social'),
  array[pg_temp.court(2)], now() + interval '2 days', now() + interval '2 days 2 hours') $$, 'courts reserved for the social');
select lives_ok($$ select public.staff_release_event_court(
  (select id from public.booking_slots where event_id = (select id from public.events where slug = 'qa-social')), 'Not needed') $$,
  'a reserved court is released with a reason');
select is((select status::text from public.booking_slots where event_id = (select id from public.events where slug = 'qa-social')),
  'cancelled', 'the released court is free again');
reset role;
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select lives_ok($$ select public.register_for_event((select id from public.events where slug = 'qa-social')) $$, 'Ana takes the only place');
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select throws_ok($$ select public.register_for_event((select id from public.events where slug = 'qa-social')) $$, '22023', null,
  'Ben is refused: full');
select pg_temp.as_user('55555555-5555-4555-8555-555555555555');
select throws_ok($$ select public.staff_cancel_registration(
  (select r.id from public.event_registrations r join public.events e on e.id = r.event_id where e.slug = 'qa-social'), '') $$,
  '22023', null, 'cancelling an entry needs a reason');
select lives_ok($$ select public.staff_cancel_registration(
  (select r.id from public.event_registrations r join public.events e on e.id = r.event_id where e.slug = 'qa-social'), 'Duplicate account') $$,
  'staff cancel Ana''s entry with a reason');
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select lives_ok($$ select public.register_for_event((select id from public.events where slug = 'qa-social')) $$,
  'the freed place can be taken');

select * from finish();
rollback;
