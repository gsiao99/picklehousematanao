-- Open play auto-fill: finishing a game calls the next game on that court
-- when the session has it on, and leaves the court free when it is off.
-- Walk-ins keep fixtures short. Hours, rates and sessions are TEST FIXTURES
-- inside this rolled-back transaction.
begin;
select plan(5);
\ir _fixtures.sql

create function pg_temp.court(_n int) returns uuid language sql stable security definer as
  $$ select id from public.courts where number = _n $$;
grant execute on function pg_temp.court(int) to public;

insert into auth.users (id, email, raw_user_meta_data) values
  ('e5000000-0000-4000-8000-000000000001', 'fillstaff@test.local', '{"full_name":"Fey Fill"}');
insert into public.user_roles (user_id, role) values ('e5000000-0000-4000-8000-000000000001', 'staff');
insert into public.staff_permissions (user_id, permission) values ('e5000000-0000-4000-8000-000000000001', 'openplay.manage');
insert into public.operating_hours (weekday, opens_at, closes_at) select d, '06:00', '01:00' from generate_series(0, 6) d;
insert into public.rate_rules (product, label, tier, starts_at, ends_at, price_centavos, unit)
values ('court_rental', 'Test rate', 'off_peak', '06:00', '01:00', 25000, 'per_court_hour');

select set_config('app.audit_reason', 'Test fixtures', true);
insert into public.events (id, slug, title, event_type, starts_at, ends_at, status, queue_players_per_game, queue_rotation, queue_auto_fill) values
  ('e6000000-0000-4000-8000-000000000001', 'fill-night', 'Fill Night', 'open_play', now() - interval '30 minutes', now() + interval '3 hours',
   'ongoing', 4, 'all_off', true);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e5000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.staff_assign_event_courts('e6000000-0000-4000-8000-000000000001', array[pg_temp.court(1)],
  now() - interval '30 minutes', now() + interval '2 hours') $$, 'a court is reserved for now');
select public.admin_add_walk_in('e6000000-0000-4000-8000-000000000001', null, 'Fill ' || g) from generate_series(1, 8) g;
select public.staff_check_in_all('e6000000-0000-4000-8000-000000000001');

create temp table g1 as select public.staff_call_next('e6000000-0000-4000-8000-000000000001', pg_temp.court(1)) as id;
select public.staff_start_game((select id from g1));
select lives_ok($$ select public.staff_complete_game((select id from g1), 'a') $$, 'the first game finishes');
select is((select count(*)::int from public.queue_games where event_id = 'e6000000-0000-4000-8000-000000000001' and status = 'called'), 1,
  'auto-fill called the next game on the same court');

-- Auto-fill off: finishing leaves the court free.
reset role;
update public.events set queue_auto_fill = false where id = 'e6000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e5000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
create temp table g2 as select id from public.queue_games where event_id = 'e6000000-0000-4000-8000-000000000001' and status = 'called';
select public.staff_start_game((select id from g2));
select lives_ok($$ select public.staff_complete_game((select id from g2), 'b') $$, 'the second game finishes');
select is((select count(*)::int from public.queue_games where event_id = 'e6000000-0000-4000-8000-000000000001' and status in ('called', 'playing')), 0,
  'with auto-fill off the court stays free');

select * from finish();
rollback;
