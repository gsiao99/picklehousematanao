-- Open play stacks and court levels: one paddle stack per category, courts
-- given a category or left Flex, winners split, no-shows replaced from the
-- same stack. Hours, rates and events below are TEST FIXTURES inside this
-- rolled-back transaction, not venue data.
begin;
select plan(19);

create function pg_temp.court(_n int) returns uuid language sql stable security definer as
  $$ select id from public.courts where number = _n $$;
create function pg_temp.as_user(_id text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', _id, 'role', 'authenticated')::text, true);
end $$;
create table pg_temp.ids (name text primary key, id uuid);
grant all on pg_temp.ids to public;
create function pg_temp.id(_name text) returns uuid language sql stable as $$ select id from pg_temp.ids where name = _name $$;
create function pg_temp.keep(_name text, _id uuid) returns uuid language sql as
  $$ insert into pg_temp.ids values (_name, _id) on conflict (name) do update set id = excluded.id returning id $$;
create function pg_temp.pname(_id uuid) returns text language sql stable security definer as
  $$ select private.public_name(_id) $$;
-- Stack (division name) of every player in a game, e.g. 'Novice x4'.
create function pg_temp.game_stacks(_game uuid) returns text language sql stable security definer as
  $$ select string_agg(distinct d.name, ', ') || ' x' || count(*)
     from public.queue_entries q join public.event_divisions d on d.id = q.division_id where q.game_id = _game $$;
grant execute on function pg_temp.court(int), pg_temp.as_user(text), pg_temp.id(text), pg_temp.keep(text, uuid),
  pg_temp.pname(uuid), pg_temp.game_stacks(uuid) to public;

-- Staff, five novices (n1-n8 over time) and five intermediates (i1-i5).
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000001', 'opstaff@test.local', '{"full_name":"Olga Staff"}'),
  ('a0000000-0000-4000-8000-000000000002', 'plain@test.local', '{"full_name":"Pat Plain"}');
insert into auth.users (id, email, raw_user_meta_data)
select ('b0000000-0000-4000-8000-00000000000' || g)::uuid, 'n' || g || '@test.local',
       json_build_object('full_name', 'Novice' || g || ' Player')
from generate_series(1, 8) g;
insert into auth.users (id, email, raw_user_meta_data)
select ('c0000000-0000-4000-8000-00000000000' || g)::uuid, 'i' || g || '@test.local',
       json_build_object('full_name', 'Inter' || g || ' Player')
from generate_series(1, 5) g;
-- Readable copy of the test players (auth.users is not readable as authenticated).
create table pg_temp.people as select id, email from auth.users where email ~ '^[ni][0-9]@test.local$';
grant all on pg_temp.people to public;
insert into public.user_roles (user_id, role) values
  ('a0000000-0000-4000-8000-000000000001', 'staff'), ('a0000000-0000-4000-8000-000000000002', 'staff');
insert into public.staff_permissions (user_id, permission) values
  ('a0000000-0000-4000-8000-000000000001', 'openplay.manage');

insert into public.operating_hours (weekday, opens_at, closes_at) select d, '06:00', '01:00' from generate_series(0, 6) d;
insert into public.rate_rules (product, label, tier, starts_at, ends_at, price_centavos, unit)
values ('court_rental', 'Test rate', 'off_peak', '06:00', '01:00', 25000, 'per_court_hour');
insert into public.event_categories (name, slug) values ('Novice', 'novice'), ('Intermediate', 'intermediate')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Session running now on Courts 1-3 with a Novice and an Intermediate stack
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('a0000000-0000-4000-8000-000000000001');
with x as (
  insert into public.events (slug, title, event_type, starts_at, ends_at, status, queue_players_per_game, queue_rotation,
                             queue_max_consecutive, queue_no_show_rule)
  values ('stacks-now', 'Stacks Now', 'open_play', now() - interval '30 minutes', now() + interval '3 hours',
          'ongoing', 4, 'all_off', 2, 'back_of_queue') returning id) select pg_temp.keep('op', id) from x;
with x as (insert into public.event_divisions (event_id, category_id, name, sort_order)
           values (pg_temp.id('op'), (select id from public.event_categories where slug = 'novice'), 'Novice', 1) returning id)
select pg_temp.keep('nov', id) from x;
with x as (insert into public.event_divisions (event_id, category_id, name, sort_order)
           values (pg_temp.id('op'), (select id from public.event_categories where slug = 'intermediate'), 'Intermediate', 2) returning id)
select pg_temp.keep('int', id) from x;
select lives_ok($$ select public.staff_assign_event_courts(pg_temp.id('op'), array[pg_temp.court(1), pg_temp.court(2), pg_temp.court(3)],
  (select starts_at from public.events where id = pg_temp.id('op')), now() + interval '2 hours') $$, 'three courts are reserved for the session');

select lives_ok($$ select public.staff_register_player(pg_temp.id('op'), u.id, pg_temp.id(case when u.email like 'n%' then 'nov' else 'int' end))
  from pg_temp.people u where u.email ~ '^[ni][0-9]@test.local$' order by u.email $$, 'players register under their category');
-- Checking in at the desk puts open play players straight into their stack (migration 20261123000400).
select lives_ok($$ select public.staff_check_in(r.id) from public.event_registrations r join pg_temp.people u on u.id = r.player_id
  where r.event_id = pg_temp.id('op') and u.email ~ '^(n[1-5]|i[1-5])@test.local$' order by u.email $$,
  'five intermediates and five novices check in');

-- Court levels.
select lives_ok($$ select public.staff_set_court_lane(pg_temp.id('op'), pg_temp.court(1), pg_temp.id('nov')),
                          public.staff_set_court_lane(pg_temp.id('op'), pg_temp.court(2), pg_temp.id('int')) $$,
  'Court 1 is set to Novice and Court 2 to Intermediate (Court 3 stays Flex)');
select throws_ok($$ select public.staff_set_court_lane(pg_temp.id('op'), pg_temp.court(4), pg_temp.id('nov')) $$, '22023', null,
  'a court that is not reserved for the session cannot get a level');
reset role; set local role authenticated;
select pg_temp.as_user('a0000000-0000-4000-8000-000000000002');
select throws_ok($$ select public.staff_set_court_lane(pg_temp.id('op'), pg_temp.court(3), pg_temp.id('nov')) $$, '42501', null,
  'staff without open-play permission cannot set court levels');
select is((select count(*)::int from public.event_court_lanes), 0, 'and cannot read them');

-- Stacks.
reset role; set local role authenticated;
select pg_temp.as_user('a0000000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.get_queue(pg_temp.id('op')) where status = 'waiting'), 10,
  'checking in put all ten in the queue');
select is((select string_agg(division_name || ' #' || queue_position || ' ' || player_name, ', ' order by division_name, queue_position)
           from public.get_queue(pg_temp.id('op')) where queue_position = 1),
  'Intermediate #1 Inter1 P., Novice #1 Novice1 P.', 'each stack counts its own places');

select pg_temp.keep('g1', public.staff_call_next(pg_temp.id('op'), pg_temp.court(1)));
select is(pg_temp.game_stacks(pg_temp.id('g1')), 'Novice x4', 'the Novice court calls only novices');
select pg_temp.keep('g2', public.staff_call_next(pg_temp.id('op'), pg_temp.court(2)));
select is(pg_temp.game_stacks(pg_temp.id('g2')), 'Intermediate x4', 'the Intermediate court calls only intermediates');

-- A no-show is replaced from the same stack (Inter5 has waited longer than Novice5).
select pg_temp.keep('repl', public.staff_queue_no_show((select id from public.queue_entries where game_id = pg_temp.id('g1') order by queued_at limit 1)));
select is((select d.name from public.queue_entries q join public.event_divisions d on d.id = q.division_id where q.id = pg_temp.id('repl')),
  'Novice', 'a no-show on the Novice court is replaced by the next novice, not the longer-waiting intermediate');

select throws_ok($$ select public.staff_call_next(pg_temp.id('op'), pg_temp.court(3)) $$, '22023', null,
  'Flex refuses while no stack has four players waiting');
select lives_ok($$ select public.staff_check_in(r.id) from public.event_registrations r join pg_temp.people u on u.id = r.player_id
  where r.event_id = pg_temp.id('op') and u.email ~ '^n[6-8]@test.local$' order by u.email $$, 'three more novices arrive and check in');
select pg_temp.keep('g3', public.staff_call_next(pg_temp.id('op'), pg_temp.court(3)));
select is(pg_temp.game_stacks(pg_temp.id('g3')), 'Novice x4', 'the Flex court takes the longer stack');

-- Winners split on Intermediate.
update public.event_divisions set queue_rotation = 'winners_split' where id = pg_temp.id('int');
select public.staff_start_game(pg_temp.id('g2'));
select throws_ok($$ select public.staff_complete_game(pg_temp.id('g2')) $$, '22023', null,
  'a winners-split stack needs the winning team');
create temp table winners as select player_id from public.queue_entries where game_id = pg_temp.id('g2') and team = 'a';
select public.staff_complete_game(pg_temp.id('g2'), 'a');
select pg_temp.keep('g4', public.staff_call_next(pg_temp.id('op'), pg_temp.court(2)));
select is((select string_agg(team, '' order by team) from public.queue_entries
           where game_id = pg_temp.id('g4') and player_id in (select player_id from winners)),
  'ab', 'the two winners stay on but are split onto opposite teams');

-- Novice stays all off.
select public.staff_start_game(pg_temp.id('g1'));
select public.staff_complete_game(pg_temp.id('g1'), 'a');
select ok(not exists (select 1 from public.queue_entries q where q.event_id = pg_temp.id('op') and q.status = 'waiting'
                      and q.stay_court_id = pg_temp.court(1)),
  'in the Novice stack everyone goes to the back after a game');

-- TV board.
select is((select string_agg(s ->> 'name', ', ') from jsonb_array_elements(public.get_session_board(pg_temp.id('op'),
             (select board_code from public.staff_event_codes(pg_temp.id('op')))) -> 'stacks') s),
  'Novice, Intermediate', 'the court board lists one Next up per stack');

select * from finish();
rollback;
