-- Open play matching modes: Social mix ignores levels and pairs people who
-- have partnered least; Winners vs losers fills a game with people whose last
-- result matches the first in line. Walk-ins (no accounts) keep fixtures short.
-- Hours, rates and sessions are TEST FIXTURES inside this rolled-back transaction.
begin;
select plan(7);
\ir _fixtures.sql

create function pg_temp.court(_n int) returns uuid language sql stable security definer as
  $$ select id from public.courts where number = _n $$;
grant execute on function pg_temp.court(int) to public;

insert into auth.users (id, email, raw_user_meta_data) values
  ('d1000000-0000-4000-8000-000000000001', 'modestaff@test.local', '{"full_name":"Mia Mode"}');
insert into public.user_roles (user_id, role) values ('d1000000-0000-4000-8000-000000000001', 'staff');
insert into public.staff_permissions (user_id, permission) values ('d1000000-0000-4000-8000-000000000001', 'openplay.manage');
insert into public.operating_hours (weekday, opens_at, closes_at) select d, '06:00', '01:00' from generate_series(0, 6) d;
insert into public.rate_rules (product, label, tier, starts_at, ends_at, price_centavos, unit)
values ('court_rental', 'Test rate', 'off_peak', '06:00', '01:00', 25000, 'per_court_hour');
insert into public.event_categories (id, name, slug) values
  ('d2000000-0000-4000-8000-000000000001', 'Mode Novice', 'mode-novice'),
  ('d2000000-0000-4000-8000-000000000002', 'Mode Inter', 'mode-inter');

select set_config('app.audit_reason', 'Test fixtures', true);
insert into public.events (id, slug, title, event_type, starts_at, ends_at, status, queue_players_per_game, queue_rotation, queue_matching) values
  ('d3000000-0000-4000-8000-000000000001', 'mode-night', 'Mode Night', 'open_play', now() - interval '30 minutes', now() + interval '3 hours',
   'ongoing', 4, 'all_off', 'social');
insert into public.event_divisions (id, event_id, category_id, name, sort_order) values
  ('d4000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'Mode Novice', 1),
  ('d4000000-0000-4000-8000-000000000002', 'd3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000002', 'Mode Inter', 2);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.staff_assign_event_courts('d3000000-0000-4000-8000-000000000001', array[pg_temp.court(1)],
  now() - interval '30 minutes', now() + interval '2 hours') $$, 'a court is reserved for now');

-- Two novices and two intermediates (walk-ins), checked in: straight into their stacks.
select public.admin_add_walk_in('d3000000-0000-4000-8000-000000000001', d, n)
from (values ('d4000000-0000-4000-8000-000000000001'::uuid, 'Ann N'), ('d4000000-0000-4000-8000-000000000002'::uuid, 'Bea I'),
             ('d4000000-0000-4000-8000-000000000001'::uuid, 'Cid N'), ('d4000000-0000-4000-8000-000000000002'::uuid, 'Dan I')) v(d, n);
select public.staff_check_in_all('d3000000-0000-4000-8000-000000000001');

-- Social mix: one line for everyone, so the four mixed levels make a game.
create temp table g as select public.staff_call_next('d3000000-0000-4000-8000-000000000001', pg_temp.court(1)) as id;
select is((select count(distinct division_id)::int from public.queue_entries where game_id = (select id from g)), 2,
  'Social mix puts both levels in one game');
select is((select count(*)::int from public.queue_entries where game_id = (select id from g)), 4, 'with four players');

-- Finish it (Ann+Bea vs Cid+Dan or similar), then the next Social game must change partners.
reset role;
update public.queue_entries set team = case when (select guest_name from public.event_registrations r where r.id = registration_id) in ('Ann N', 'Bea I') then 'a' else 'b' end
 where game_id = (select id from g);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.staff_start_game((select id from g));
select public.staff_complete_game((select id from g), 'a');
create temp table g2 as select public.staff_call_next('d3000000-0000-4000-8000-000000000001', pg_temp.court(1)) as id;
select ok((select x.team <> y.team from public.queue_entries x, public.queue_entries y, public.event_registrations rx, public.event_registrations ry
           where x.game_id = (select id from g2) and y.game_id = (select id from g2)
             and rx.id = x.registration_id and ry.id = y.registration_id and rx.guest_name = 'Ann N' and ry.guest_name = 'Bea I'),
  'Social mix gives Ann a new partner next game');

-- Winners vs losers: Ann and Bea won, Cid and Dan lost. With a winner first in line, the next game
-- (singles here, to keep it small) pairs the two winners.
reset role;
update public.queue_games set status = 'cancelled' where id = (select id from g2);
update public.queue_entries set status = 'waiting', game_id = null, court_id = null, team = null where game_id = (select id from g2);
update public.queue_entries set queued_at = clock_timestamp() + interval '1 minute'
 where status = 'waiting' and registration_id in (select id from public.event_registrations where guest_name in ('Cid N', 'Dan I'));
update public.events set queue_matching = 'winners_losers', queue_players_per_game = 2 where id = 'd3000000-0000-4000-8000-000000000001';
update public.queue_entries set queued_at = clock_timestamp() + interval '2 minutes'
 where status = 'waiting' and registration_id = (select id from public.event_registrations where guest_name = 'Bea I');
-- Unlike Social mix, Winners vs losers keeps each level's line, so put Bea in Ann's
-- line for this check (otherwise Ann's game can only take the Novice players).
update public.queue_entries set division_id = (select q.division_id from public.queue_entries q join public.event_registrations r on r.id = q.registration_id
                                                where r.guest_name = 'Ann N' and q.status = 'waiting')
 where status = 'waiting' and registration_id = (select id from public.event_registrations where guest_name = 'Bea I');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
create temp table g3 as select public.staff_call_next('d3000000-0000-4000-8000-000000000001', pg_temp.court(1)) as id;
select is((select string_agg(r.guest_name, ',' order by r.guest_name) from public.queue_entries q join public.event_registrations r on r.id = q.registration_id
           where q.game_id = (select id from g3)), 'Ann N,Bea I',
  'Winners vs losers skips the losers waiting ahead to pair the two winners');

-- Balanced is unchanged by default.
reset role;
select is((select column_default from information_schema.columns where table_name = 'events' and column_name = 'queue_matching'),
  '''balanced''::text', 'sessions are Balanced unless chosen otherwise');
select ok(not has_function_privilege('authenticated', 'private.queue_partner_count(uuid, uuid, uuid)', 'execute'),
  'the helper functions are not callable from the API');

select * from finish();
rollback;
