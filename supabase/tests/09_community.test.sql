-- Community: events, registrations, capacity, duplicates, categories,
-- court conflicts, matches, standings, leaderboard, open-play queue,
-- check-ins and permissions. Hours, rates, fees and events below are TEST
-- FIXTURES inside this rolled-back transaction, not venue data.
begin;
select plan(137);
\ir _fixtures.sql

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
create function pg_temp.tday() returns date language sql stable security definer as
  $$ select private.operating_date_of(now()) + 1 $$;
create function pg_temp.at(_h int) returns timestamptz language sql stable security definer as
  $$ select (pg_temp.tday()::timestamp + make_interval(hours => _h)) at time zone 'Asia/Manila' $$;
create function pg_temp.court(_n int) returns uuid language sql stable security definer as
  $$ select id from public.courts where number = _n $$;
create function pg_temp.as_user(_id text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', _id, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.uid(_name text) returns uuid language sql stable security definer as
  $$ select id from auth.users where email = _name || '@test.local' $$;
create table pg_temp.ids (name text primary key, id uuid);
grant all on pg_temp.ids to public;
create function pg_temp.id(_name text) returns uuid language sql stable as $$ select id from pg_temp.ids where name = _name $$;
create function pg_temp.keep(_name text, _id uuid) returns uuid language sql as
  $$ insert into pg_temp.ids values (_name, _id) on conflict (name) do update set id = excluded.id returning id $$;
grant execute on function pg_temp.tday(), pg_temp.at(int), pg_temp.court(int), pg_temp.as_user(text), pg_temp.uid(text),
  pg_temp.id(text), pg_temp.keep(text, uuid) to public;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'ana@test.local', '{"full_name":"Ana Reyes","self_rated_level":"low_intermediate"}'),
  ('22222222-2222-4222-8222-222222222222', 'ben@test.local', '{"full_name":"Ben Cruz","self_rated_level":"novice"}'),
  ('33333333-3333-4333-8333-333333333333', 'carla@test.local', '{"full_name":"Carla Mendoza"}'),
  ('44444444-4444-4444-8444-444444444444', 'dan@test.local', '{"full_name":"Dan Villanueva"}'),
  ('55555555-5555-4555-8555-555555555555', 'lea@test.local', '{"full_name":"Lea Navarro"}'),
  ('66666666-6666-4666-8666-666666666666', 'eva@test.local', '{"full_name":"Eva Santos","self_rated_level":"novice"}'),
  ('77777777-7777-4777-8777-777777777777', 'fred@test.local', '{"full_name":"Fred Lim","self_rated_level":"novice"}'),
  ('88888888-8888-4888-8888-888888888888', 'gia@test.local', '{"full_name":"Gia Tan","self_rated_level":"novice"}'),
  ('99999999-9999-4999-8999-999999999999', 'hal@test.local', '{"full_name":"Hal Uy","self_rated_level":"novice"}');
-- LEGACY until Phase 2: event registration, queue and leaderboard flows still
-- run on player accounts here. Sign-up no longer creates players or reads
-- levels, so the player role and levels are set directly.
insert into public.user_roles (user_id, role)
select id, 'player' from auth.users where email in ('ana@test.local', 'ben@test.local', 'eva@test.local', 'fred@test.local',
                                                     'gia@test.local', 'hal@test.local');
update public.profiles p set self_rated_level = v.l::public.player_level, level = v.l::public.player_level
from (values ('11111111-1111-4111-8111-111111111111'::uuid, 'low_intermediate'), ('22222222-2222-4222-8222-222222222222', 'novice'),
             ('66666666-6666-4666-8666-666666666666', 'novice'), ('77777777-7777-4777-8777-777777777777', 'novice'),
             ('88888888-8888-4888-8888-888888888888', 'novice'), ('99999999-9999-4999-8999-999999999999', 'novice')) v(id, l)
where p.id = v.id;
insert into public.user_roles (user_id, role) values
  ('33333333-3333-4333-8333-333333333333', 'staff'),
  ('44444444-4444-4444-8444-444444444444', 'staff'),
  ('55555555-5555-4555-8555-555555555555', 'admin');
insert into public.staff_permissions (user_id, permission) values
  ('33333333-3333-4333-8333-333333333333', 'schedule.manage'),
  ('44444444-4444-4444-8444-444444444444', 'events.manage'),
  ('44444444-4444-4444-8444-444444444444', 'openplay.manage');
update public.profiles set leaderboard_opt_out = true where id = '99999999-9999-4999-8999-999999999999';

insert into public.operating_hours (weekday, opens_at, closes_at) select d, '06:00', '01:00' from generate_series(0, 6) d;
insert into public.rate_rules (product, label, tier, starts_at, ends_at, price_centavos, unit)
values ('court_rental', 'Test rate', 'off_peak', '06:00', '01:00', 25000, 'per_court_hour');
insert into public.event_categories (name, slug) values ('Mixed Doubles', 'mixed-doubles'), ('Singles', 'singles');
create function pg_temp.lbl(_reg uuid) returns text language sql stable security definer as
  $$ select private.entry_label(_reg) $$;
create function pg_temp.pname(_id uuid) returns text language sql stable security definer as
  $$ select private.public_name(_id) $$;
grant execute on function pg_temp.lbl(uuid), pg_temp.pname(uuid) to public;
create function pg_temp.cat(_slug text) returns uuid language sql stable security definer as
  $$ select id from public.event_categories where slug = _slug $$;
grant execute on function pg_temp.cat(text) to public;

select ok(has_column_privilege('authenticated', 'public.events', 'queue_game_minutes', 'INSERT')
          and has_column_privilege('authenticated', 'public.events', 'queue_game_minutes', 'UPDATE'),
  'the admin event form may save every column it sends (game time limit included)');

-- ---------------------------------------------------------------------------
-- Creating events: only event managers
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select throws_ok($$ insert into public.events (slug, title, event_type, starts_at, ends_at)
  values ('x', 'Player event', 'social', pg_temp.at(10), pg_temp.at(12)) $$, '42501', null, 'players cannot create events');

reset role; set local role authenticated;
select pg_temp.as_user('33333333-3333-4333-8333-333333333333');
select throws_ok($$ insert into public.events (slug, title, event_type, starts_at, ends_at)
  values ('x', 'Staff event', 'social', pg_temp.at(10), pg_temp.at(12)) $$, '42501', null,
  'staff without events.manage cannot create events');

reset role; set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select lives_ok($$ with x as (
  insert into public.events (slug, title, event_type, starts_at, ends_at, capacity, status)
  values ('social-mixer', 'Social Mixer', 'social', pg_temp.at(18), pg_temp.at(21), 2, 'registration_open') returning id) select pg_temp.keep('mixer', id) from x $$,
  'an event manager creates a social event');
select lives_ok($$ with x as (
  insert into public.events (slug, title, event_type, starts_at, ends_at)
  values ('secret-draft', 'Secret Draft', 'social', pg_temp.at(18), pg_temp.at(21)) returning id) select pg_temp.keep('draft', id) from x $$,
  'an event manager creates a draft');
select is((select created_by from public.events where id = pg_temp.id('mixer')), '44444444-4444-4444-8444-444444444444'::uuid,
  'the creator is recorded from the session, not the client');

-- ---------------------------------------------------------------------------
-- Public listing: no drafts, no personal data
-- ---------------------------------------------------------------------------
reset role; set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*)::int from public.get_events()), 1, 'visitors see the published event only');
select is((select spots_left from public.get_events('social-mixer')), 2, 'visitors see places left, not who took them');
select is_empty($$ select 1 from public.get_events('secret-draft') $$, 'drafts are hidden from visitors');
select throws_ok($$ select * from public.get_whos_playing((select id from public.get_events('social-mixer'))) $$, '42501', null,
  'visitors cannot see who is playing');

-- ---------------------------------------------------------------------------
-- Capacity and duplicate registrations (capacity 2)
-- ---------------------------------------------------------------------------
reset role; set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select is((select status::text from public.register_for_event(pg_temp.id('mixer'))), 'confirmed', 'a free event confirms straight away');
select throws_ok($$ select * from public.register_for_event(pg_temp.id('mixer')) $$, '23505', 'You are already registered for this.',
  'registering twice is refused');
select throws_ok($$ select * from public.register_for_event(pg_temp.id('draft')) $$, 'P0002', null, 'players cannot register for drafts');

reset role; set local role authenticated;
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select lives_ok($$ select * from public.register_for_event(pg_temp.id('mixer')) $$, 'the second player takes the last place');

reset role; set local role authenticated;
select pg_temp.as_user('66666666-6666-4666-8666-666666666666');
select throws_ok($$ select * from public.register_for_event(pg_temp.id('mixer')) $$, '22023', 'Social Mixer is full.',
  'a third player is refused when the event is full');
select is((select spots_left from public.get_events('social-mixer')), 0, 'no places are left');

reset role;
select throws_ok($$ insert into public.event_registrations (event_id, player_id, status)
  values (pg_temp.id('mixer'), '66666666-6666-4666-8666-666666666666', 'confirmed') $$, '22023', null,
  'capacity is enforced by the database even for direct inserts');
select throws_ok($$ insert into public.event_registrations (event_id, player_id, status)
  values (pg_temp.id('mixer'), '11111111-1111-4111-8111-111111111111', 'pending') $$, '23505', null,
  'duplicates are refused by the database even for direct inserts');

set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select throws_ok($$ update public.events set capacity = 1 where id = pg_temp.id('mixer') $$, '22023',
  'Capacity cannot be lower than the 2 places already taken.', 'capacity cannot drop below places taken');

reset role; set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select lives_ok($$ select public.withdraw_registration((select registration_id from public.get_my_registrations()
  where event_id = pg_temp.id('mixer'))) $$, 'a player withdraws');
select is((select spots_left from public.get_events('social-mixer')), 1, 'the place is free again');

reset role; set local role authenticated;
select pg_temp.as_user('66666666-6666-4666-8666-666666666666');
select lives_ok($$ select * from public.register_for_event(pg_temp.id('mixer')) $$, 'another player takes the freed place');

-- Skill requirement and registration window
reset role; set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
with x as (
  insert into public.events (slug, title, event_type, starts_at, ends_at, skill_max, status)
  values ('novice-night', 'Novice Night', 'open_play', pg_temp.at(19), pg_temp.at(21), 'novice', 'published') returning id) select pg_temp.keep('novice', id) from x;
with x as (
  insert into public.events (slug, title, event_type, starts_at, ends_at, registration_closes_at, status)
  values ('closed-reg', 'Closed Reg', 'social', pg_temp.at(19), pg_temp.at(21), now() - interval '1 minute', 'registration_open')
  returning id) select pg_temp.keep('closed', id) from x;

reset role; set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select throws_ok($$ select * from public.register_for_event(pg_temp.id('novice')) $$, '22023',
  'Level required: up to Novice. Your level is Low intermediate.', 'skill requirements are enforced');
select throws_ok($$ select * from public.register_for_event(pg_temp.id('closed')) $$, '22023',
  'Registration for Closed Reg is closed.', 'the registration deadline is enforced');

-- ---------------------------------------------------------------------------
-- Tournament: divisions, categories, partners, fees
-- ---------------------------------------------------------------------------
reset role; set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
with x as (
  insert into public.events (slug, title, event_type, starts_at, ends_at, fee_centavos, fee_unit, status)
  values ('club-open', 'Club Open', 'tournament', pg_temp.at(12), pg_temp.at(20), 40000, 'per_team', 'registration_open')
  returning id) select pg_temp.keep('open', id) from x;
with x as (
  insert into public.event_divisions (event_id, category_id, name, team_size, capacity, format)
  values (pg_temp.id('open'), pg_temp.cat('mixed-doubles'), 'Mixed Doubles · Open', 2, 2, 'round_robin') returning id) select pg_temp.keep('mixed', id) from x;
with x as (
  insert into public.event_divisions (event_id, category_id, name, team_size, fee_centavos, format)
  values (pg_temp.id('open'), pg_temp.cat('singles'), 'Singles · Open', 1, 0, 'round_robin') returning id) select pg_temp.keep('singles', id) from x;

reset role; set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select throws_ok($$ select * from public.register_for_event(pg_temp.id('open')) $$, '22023', 'Choose a division.',
  'a tournament entry needs a division');
select throws_ok($$ select * from public.register_for_event(pg_temp.id('open'), pg_temp.id('mixed')) $$, '22023', null,
  'a doubles division needs a partner');
select throws_ok($$ select * from public.register_for_event(pg_temp.id('open'), pg_temp.id('singles'), 'ben@test.local') $$, '22023',
  'Singles · Open is a singles division.', 'a singles division refuses a partner');
select throws_ok($$ select * from public.register_for_event(pg_temp.id('open'), pg_temp.id('mixed'), 'nobody@test.local') $$, 'P0002',
  null, 'an unknown partner email is refused');
select is((select status::text || '/' || amount_due_centavos from public.register_for_event(pg_temp.id('open'), pg_temp.id('mixed'), 'ben@test.local')),
  'pending/40000', 'a paid doubles entry is held pending the team fee');
select is((select category_id from public.event_registrations where event_id = pg_temp.id('open') and division_id = pg_temp.id('mixed')),
  pg_temp.cat('mixed-doubles'), 'the registration records the category of the chosen division');
reset role;  -- players no longer read bookings directly
select is((select total_centavos || '/' || payment_status || '/' || status from public.bookings
           where event_id = pg_temp.id('open') and player_id = '11111111-1111-4111-8111-111111111111'),
  '40000/unpaid/confirmed', 'the fee is a slot-less booking paid through the normal payment flow');
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select is((select status::text from public.register_for_event(pg_temp.id('open'), pg_temp.id('singles'))), 'confirmed',
  'the same player may also enter another division (free singles)');

reset role; set local role authenticated;
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select throws_ok($$ select * from public.register_for_event(pg_temp.id('open'), pg_temp.id('mixed'), 'eva@test.local') $$, '23505', null,
  'a partner cannot be entered twice in the same division');
select ok(exists (select 1 from public.notifications where kind = 'partner_added'), 'the partner is notified');

-- Category display ("Who's Playing")
reset role; set local role authenticated;
select pg_temp.as_user('66666666-6666-4666-8666-666666666666');
select is((select string_agg(category_name || ':' || player_name || coalesce(' / ' || partner_name, ''), ', ' order by category_name)
           from public.get_whos_playing(pg_temp.id('open'))),
  'Mixed Doubles:Ana R. / Ben C., Singles:Ana R.',
  'Who''s Playing shows each entry''s registered category and short names');
select is((select count(*)::int from public.get_whos_playing(pg_temp.id('open')) where category_name ilike '%intermediate%'
           or category_name ilike '%novice%'), 0, 'no profile skill level is shown as a category');
reset role;
update public.event_categories set name = 'Mixed Doubles (renamed)' where slug = 'mixed-doubles';
update public.profiles set self_rated_level = 'advanced' where id = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
select pg_temp.as_user('66666666-6666-4666-8666-666666666666');
select is((select category_name from public.get_whos_playing(pg_temp.id('open')) where division_name like 'Mixed%'),
  'Mixed Doubles (renamed)', 'the category comes from the registration''s category record, not the player''s profile');
select is((select count(*)::int from public.get_whos_playing(pg_temp.id('open')) where is_me), 0, 'is_me is false for others');

-- Fee paid at the desk confirms the entry
reset role; set local role authenticated;
select pg_temp.as_user('55555555-5555-4555-8555-555555555555');
select lives_ok($$ select public.staff_record_cash_payment(b.id, 'Entry fee at the desk', b.total_centavos) from public.bookings b
  where b.event_id = pg_temp.id('open') and b.player_id = '11111111-1111-4111-8111-111111111111' $$, 'staff record the entry fee in cash');
select is((select status::text from public.event_registrations where event_id = pg_temp.id('open') and division_id = pg_temp.id('mixed')),
  'confirmed', 'paying the fee confirms the entry');

-- ---------------------------------------------------------------------------
-- Court assignments and conflicts
-- ---------------------------------------------------------------------------
reset role; set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select lives_ok($$ select public.guest_create_booking(jsonb_build_array(jsonb_build_object('court_id', pg_temp.court(1), 'starts_at', pg_temp.at(14))),
  'Ben C.', '09170000002') $$, 'a guest rents Court 1 at 2:00 PM');

reset role; set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select throws_ok($$ select public.staff_assign_event_courts(pg_temp.id('open'), array[pg_temp.court(1)], pg_temp.at(13), pg_temp.at(17)) $$,
  '23P01', null, 'an event cannot take a court that is already rented');
select lives_ok($$ select public.staff_assign_event_courts(pg_temp.id('open'), array[pg_temp.court(2), pg_temp.court(3)], pg_temp.at(13), pg_temp.at(17)) $$,
  'the event takes two free courts');
select throws_ok($$ select public.staff_assign_event_courts(pg_temp.id('open'), array[pg_temp.court(2)], pg_temp.at(10), pg_temp.at(12)) $$,
  '22023', null, 'court times must fall within the event');
select throws_ok($$ select public.staff_assign_event_courts(pg_temp.id('mixer'), array[pg_temp.court(2)], pg_temp.at(20), pg_temp.at(22)) $$,
  '22023', null, 'court times outside an event are refused');

reset role; set local role authenticated;
select pg_temp.as_user('66666666-6666-4666-8666-666666666666');
select is((select status from public.get_court_availability(pg_temp.tday()) where court_number = 2 and starts_at = pg_temp.at(14)),
  'event', 'the availability grid shows the event court as taken');
reset role; set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select public.guest_create_booking(jsonb_build_array(jsonb_build_object('court_id', pg_temp.court(2), 'starts_at', pg_temp.at(15))),
  'Eva S.', '09170000006') $$, '23P01', null, 'a rental cannot take an event court');
reset role; set local role authenticated;
select pg_temp.as_user('66666666-6666-4666-8666-666666666666');
select is((select court_name || ' ' || to_char(starts_at at time zone 'Asia/Manila', 'HH24') from jsonb_to_recordset(
            (select courts from public.get_events('club-open'))) as c(court_name text, starts_at timestamptz) order by court_name limit 1),
  'Court 2 13', 'the public event shows its courts and times');

-- ---------------------------------------------------------------------------
-- Round robin, scheduling conflicts, results, standings
-- ---------------------------------------------------------------------------
reset role; set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select lives_ok($$ select public.staff_register_player(pg_temp.id('open'), p, pg_temp.id('singles'))
  from unnest(array['22222222-2222-4222-8222-222222222222', '66666666-6666-4666-8666-666666666666',
                    '77777777-7777-4777-8777-777777777777']::uuid[]) p $$, 'staff add three more singles players');
select throws_ok($$ select public.staff_register_player(pg_temp.id('open'), '22222222-2222-4222-8222-222222222222', pg_temp.id('singles')) $$,
  '23505', null, 'staff cannot add a duplicate either');
select is(public.staff_generate_matches(pg_temp.id('singles')), 6, 'round robin for four entries makes six matches');
select is((select count(distinct least(entry_a, entry_b)::text || greatest(entry_a, entry_b)::text)::int
           from public.event_matches where division_id = pg_temp.id('singles')), 6, 'every pair meets exactly once');
select is((select count(*)::int from (select entry from public.event_matches m,
             lateral (values (m.entry_a), (m.entry_b)) v(entry) where m.division_id = pg_temp.id('singles')
             group by entry, round having count(*) > 1) x), 0, 'nobody plays twice in a round');

reset role;
create function pg_temp.m(_round int, _no int) returns uuid language sql stable security definer as
  $$ select id from public.event_matches where division_id = pg_temp.id('singles') and round = _round and match_no = _no $$;
grant execute on function pg_temp.m(int, int) to public;
set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');

select lives_ok($$ select public.staff_schedule_match(pg_temp.m(1, 1), pg_temp.court(2), pg_temp.at(13), pg_temp.at(14)) $$,
  'a match is scheduled on an event court');
select throws_ok($$ select public.staff_schedule_match(pg_temp.m(1, 2), pg_temp.court(2), pg_temp.at(13), pg_temp.at(14)) $$,
  '23P01', null, 'two matches cannot share a court at the same time');
select throws_ok($$ select public.staff_schedule_match(pg_temp.m(1, 2), pg_temp.court(1), pg_temp.at(13), pg_temp.at(14)) $$,
  '22023', null, 'a match cannot use a court that is not reserved for the event');
select throws_ok($$ select public.staff_schedule_match(pg_temp.m(2, 1), pg_temp.court(3), pg_temp.at(13), pg_temp.at(14)) $$,
  '23P01', 'A player in this match is already playing another match at that time.',
  'a player cannot be scheduled in two matches at once');
select lives_ok($$ select public.staff_schedule_match(pg_temp.m(1, 2), pg_temp.court(3), pg_temp.at(13), pg_temp.at(14)) $$,
  'the other first-round match goes on the other court');
select throws_ok($$ select public.staff_record_match_result(pg_temp.m(1, 1), 11, 11) $$, '22023', null, 'a level score is refused');

-- Results: entry order is Ana, Ben, Eva, Fred (registration order). Ana wins all,
-- Ben beats Eva and Fred, Eva beats Fred.
reset role;
create function pg_temp.reg(_email text) returns uuid language sql stable security definer as
  $$ select r.id from public.event_registrations r join public.profiles p on p.id = r.player_id
     where r.division_id = pg_temp.id('singles') and lower(p.full_name) like _email || ' %' $$;
grant execute on function pg_temp.reg(text) to public;
set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select lives_ok($$ select public.staff_record_match_result(m.id,
    case when m.entry_a = w.id then 11 else 5 end, case when m.entry_b = w.id then 11 else 5 end)
  from public.event_matches m
  cross join lateral (select case
    when pg_temp.reg('ana') in (m.entry_a, m.entry_b) then pg_temp.reg('ana')
    when pg_temp.reg('ben') in (m.entry_a, m.entry_b) then pg_temp.reg('ben')
    else pg_temp.reg('eva') end as id) w
  where m.division_id = pg_temp.id('singles') $$, 'all six results are recorded');
select is((select string_agg(rank || ':' || label || ':' || wins, ', ' order by rank) from public.get_division_standings(pg_temp.id('singles'))),
  '1:Ana R.:3, 2:Ben C.:2, 3:Eva S.:1, 4:Fred L.:0', 'standings rank entries by wins');
select is((select points_for || '-' || points_against from public.get_division_standings(pg_temp.id('singles')) where rank = 1),
  '33-15', 'standings add up the points from each recorded match');
select throws_ok($$ select public.staff_generate_matches(pg_temp.id('singles')) $$, '22023', null,
  'matches cannot be regenerated once results exist');

-- ---------------------------------------------------------------------------
-- Single elimination with byes
-- ---------------------------------------------------------------------------
with x as (
  insert into public.event_divisions (event_id, category_id, name, team_size, fee_centavos, format)
  values (pg_temp.id('open'), pg_temp.cat('singles'), 'Singles · Knockout', 1, 0, 'single_elimination') returning id) select pg_temp.keep('ko', id) from x;
select lives_ok($$ select public.staff_register_player(pg_temp.id('open'), p, pg_temp.id('ko'))
  from unnest(array['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
                    '66666666-6666-4666-8666-666666666666', '77777777-7777-4777-8777-777777777777',
                    '88888888-8888-4888-8888-888888888888']::uuid[]) p $$, 'five players enter the knockout');
select is(public.staff_generate_matches(pg_temp.id('ko')), 7, 'five entries make an eight-slot bracket of seven matches');
select is((select count(*)::int from public.event_matches where division_id = pg_temp.id('ko') and status = 'bye'), 3,
  'the top three seeds get byes');
select is((select count(*)::int from public.event_matches where division_id = pg_temp.id('ko') and round = 2
           and entry_a is not null and entry_b is not null), 1, 'two byes already meet in round two');
reset role;
create function pg_temp.ko(_round int, _no int) returns uuid language sql stable security definer as
  $$ select id from public.event_matches where division_id = pg_temp.id('ko') and round = _round and match_no = _no $$;
grant execute on function pg_temp.ko(int, int) to public;
set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select is((select pg_temp.lbl(entry_a) || ' v ' || pg_temp.lbl(entry_b)
           from public.event_matches where id = pg_temp.ko(1, 2)), 'Fred L. v Gia T.', 'seeds 4 and 5 play the only first-round match');
select lives_ok($$ select public.staff_record_match_result(pg_temp.ko(1, 2), 6, 11) $$, 'the 5th seed wins');
select is((select pg_temp.lbl(entry_b) from public.event_matches where id = pg_temp.ko(2, 1)), 'Gia T.',
  'the winner moves into the next round automatically');
select lives_ok($$ select public.staff_record_match_result(pg_temp.ko(2, 1), 11, 3) $$, 'the semi-final is played');
select throws_ok($$ select public.staff_record_match_result(pg_temp.ko(1, 2), 11, 6) $$, '22023', null,
  'an earlier result cannot be flipped once the next round is played');

-- ---------------------------------------------------------------------------
-- Leaderboard (win 3, loss 1, walkover loss 0; opt-outs left off)
-- ---------------------------------------------------------------------------
reset role; set local role authenticated;
select pg_temp.as_user('66666666-6666-4666-8666-666666666666');
select is((select player_name || ':' || points || ':' || played from public.get_leaderboard() where rank = 1),
  'Ana R.:12:4', 'the leaderboard leader has 4 wins x 3 points (byes earn nothing)');
select ok(not exists (select 1 from public.get_leaderboard() where player_name like 'Hal%'), 'players who opted out are left off');
select is((select sum(points)::int from public.get_my_match_history()), (select points from public.get_leaderboard() where is_me),
  'a player''s points equal the sum of their recorded match results');
select is_empty($$ select 1 from public.event_matches $$, 'players cannot read the matches table directly');
select throws_ok($$ select public.staff_record_match_result(pg_temp.ko(3, 1), 11, 0) $$, '42501', null,
  'players cannot record results');

-- ---------------------------------------------------------------------------
-- Open-play queue (session running now on Court 1)
-- ---------------------------------------------------------------------------
reset role; set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
with x as (
  insert into public.events (slug, title, event_type, starts_at, ends_at, status, queue_players_per_game, queue_rotation,
                             queue_max_consecutive, queue_no_show_rule)
  values ('open-play-now', 'Open Play Now', 'open_play', now() - interval '30 minutes', now() + interval '3 hours',
          'ongoing', 4, 'winners_stay', 2, 'back_of_queue') returning id) select pg_temp.keep('op', id) from x;
select lives_ok($$ select public.staff_assign_event_courts(pg_temp.id('op'), array[pg_temp.court(1)],
  (select starts_at from public.events where id = pg_temp.id('op')), now() + interval '2 hours') $$, 'Court 1 is assigned to the session now');
select lives_ok($$ select public.staff_register_player(pg_temp.id('op'), p)
  from unnest(array['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
                    '66666666-6666-4666-8666-666666666666', '77777777-7777-4777-8777-777777777777',
                    '88888888-8888-4888-8888-888888888888', '99999999-9999-4999-8999-999999999999']::uuid[]) p $$,
  'six players are registered for the session');
select lives_ok($$ select public.staff_check_in(r.id) from public.event_registrations r
  where r.event_id = pg_temp.id('op') and r.player_id <> '99999999-9999-4999-8999-999999999999' $$, 'five of them check in');

reset role; set local role authenticated;
select pg_temp.as_user('99999999-9999-4999-8999-999999999999');
select throws_ok($$ select public.join_queue(pg_temp.id('op')) $$, '22023', 'Check in at the desk before joining the queue.',
  'a player who has not checked in cannot queue');

reset role; set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
-- Checking in at an open play session puts the player in the queue (in check-in order).
select is((select count(*)::int from public.get_queue(pg_temp.id('op')) where status = 'waiting'), 5,
  'checking in puts each checked-in player in the queue');
select throws_ok($$ select public.join_queue(pg_temp.id('op')) $$, '23505', 'You are already in the queue.',
  'a second active queue entry is refused');

reset role;
select throws_ok($$ insert into public.queue_entries (event_id, player_id) values (pg_temp.id('op'), '11111111-1111-4111-8111-111111111111') $$,
  '23505', null, 'the database refuses a duplicate active entry even for direct inserts');

set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select throws_ok($$ select public.staff_queue_add(pg_temp.id('op'), '22222222-2222-4222-8222-222222222222') $$,
  '23505', null, 'staff cannot add someone who is already in the queue');
select throws_ok($$ select public.staff_call_next(pg_temp.id('op'), pg_temp.court(2)) $$, '22023', null,
  'players cannot be called to a court that is not reserved for the session');
select pg_temp.keep('g1', public.staff_call_next(pg_temp.id('op'), pg_temp.court(1)));
select is((select string_agg(pg_temp.pname(player_id) || '=' || team, ', ' order by called_at, queued_at)
           from public.queue_entries where game_id = pg_temp.id('g1')),
  'Ana R.=a, Ben C.=a, Eva S.=b, Fred L.=b', 'the first four in the queue are called, two per team');
select is((select queue_position || ':' || player_name from public.get_queue(pg_temp.id('op')) where status = 'waiting'),
  '1:Gia T.', 'the fifth player is first in line');
select throws_ok($$ select public.staff_call_next(pg_temp.id('op'), pg_temp.court(1)) $$, '22023', null,
  'a court with a game cannot be called again');
select throws_ok($$ select public.staff_complete_game(pg_temp.id('g1'), 'a') $$, '22023', 'Start the game before finishing it.',
  'a called game must start before it can finish');

-- No-show: Fred does not come; Gia replaces him and Fred goes to the back.
select is(public.staff_queue_no_show((select id from public.queue_entries where game_id = pg_temp.id('g1')
  and player_id = '77777777-7777-4777-8777-777777777777')),
  (select id from public.queue_entries where player_id = '88888888-8888-4888-8888-888888888888' and status = 'waiting'),
  'a no-show is replaced by the next waiting player');
select is((select string_agg(pg_temp.pname(player_id) || ':' || status, ', ' order by player_id)
           from public.queue_entries where event_id = pg_temp.id('op') and player_id in
           ('77777777-7777-4777-8777-777777777777', '88888888-8888-4888-8888-888888888888')
             and status in ('waiting', 'called', 'no_show')),
  'Fred L.:no_show, Fred L.:waiting, Gia T.:called', 'the no-show is recorded and the player re-queued at the back');

select lives_ok($$ select public.staff_start_game(pg_temp.id('g1')) $$, 'the game starts');
select is((select count(*)::int from public.queue_entries where game_id = pg_temp.id('g1') and status = 'playing'), 4,
  'all four are playing');
reset role;
select is((select count(*)::int from public.notifications where kind = 'queue_soon'
           and user_id = '77777777-7777-4777-8777-777777777777'), 1,
  'when a game starts, the next player in line is told they are on deck');
set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select ok((select label like 'Open Play Now · game in progress%' from public.get_live_courts() where court_number = 1),
  'the live court view shows the open-play game on Court 1');
select throws_ok($$ select public.staff_complete_game(pg_temp.id('g1')) $$, '22023', null,
  'winners-stay sessions need the winning team');
select lives_ok($$ select public.staff_complete_game(pg_temp.id('g1'), 'a') $$, 'team A wins');
select is((select string_agg(player_name, ', ' order by queue_position) from public.get_queue(pg_temp.id('op')) where status = 'waiting'),
  'Ana R., Ben C., Fred L., Eva S., Gia T.', 'winners stay first; Fred (back of queue) is ahead of this game''s losers');
select pg_temp.keep('g2', public.staff_call_next(pg_temp.id('op'), pg_temp.court(1)));
select is((select string_agg(pg_temp.pname(player_id) || '=' || team, ', ' order by team, queued_at)
           from public.queue_entries where game_id = pg_temp.id('g2')),
  'Ana R.=a, Ben C.=a, Fred L.=b, Eva S.=b', 'the winners keep the court as team A');
select lives_ok($$ select public.staff_start_game(pg_temp.id('g2')) $$, 'game two starts');
select lives_ok($$ select public.staff_complete_game(pg_temp.id('g2'), 'a') $$, 'team A wins again');
select ok(not exists (select 1 from public.queue_entries where event_id = pg_temp.id('op') and status = 'waiting'
                      and stay_court_id is not null),
  'after the maximum consecutive games, winners go to the back too');
select pg_temp.keep('g3', public.staff_call_next(pg_temp.id('op'), pg_temp.court(1)));
select lives_ok($$ select public.staff_cancel_game(pg_temp.id('g3')) $$, 'a called game can be cancelled');
select is((select count(*)::int from public.queue_entries where event_id = pg_temp.id('op') and status = 'waiting'), 5,
  'cancelling a game puts its players back in line');
select is((select count(*)::int from public.queue_entries where event_id = pg_temp.id('op')
           and status in ('waiting', 'called', 'playing') group by player_id order by 1 desc limit 1), 1,
  'no player ever has two live queue entries');

reset role; set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from public.get_queue(pg_temp.id('op'))), 5, 'a registered player can see the queue');
select lives_ok($$ select public.leave_queue(pg_temp.id('op')) $$, 'a waiting player can leave');
reset role; set local role authenticated;
select pg_temp.as_user('33333333-3333-4333-8333-333333333333');
select throws_ok($$ select * from public.get_queue(pg_temp.id('op')) $$, '42501', null,
  'someone not registered (and not managing) cannot see the queue');
select throws_ok($$ select public.staff_call_next(pg_temp.id('op'), pg_temp.court(1)) $$, '42501', null,
  'staff without open-play permission cannot run the queue');
select throws_ok($$ select * from public.staff_list_registrations(pg_temp.id('op')) $$, '42501', null,
  'staff without event permission cannot list registrations');
select throws_ok($$ select public.staff_assign_event_courts(pg_temp.id('op'), array[pg_temp.court(3)], now(), now() + interval '1 hour') $$,
  '42501', null, 'staff without event permission cannot assign courts');
select throws_ok($$ select * from public.staff_event_codes(pg_temp.id('op')) $$, '42501', null,
  'staff without event permission cannot read the check-in and board codes');

-- QR self check-in and the TV court board
reset role;
create function pg_temp.codes(_e uuid) returns private.event_codes language sql stable security definer as
  $$ select * from private.event_codes where event_id = _e $$;
grant execute on function pg_temp.codes(uuid) to public;
set local role authenticated;
select pg_temp.as_user('99999999-9999-4999-8999-999999999999');
select throws_ok($$ select public.self_check_in(pg_temp.id('op'), 'wrong') $$, '22023', null,
  'a wrong check-in code is refused');
select is(public.self_check_in(pg_temp.id('op'), (pg_temp.codes(pg_temp.id('op'))).checkin_code), 'queued',
  'a booked player checks in with the QR code and joins the stack');
select ok(exists (select 1 from public.get_queue(pg_temp.id('op')) where is_me and status = 'waiting'),
  'the self-checked-in player is waiting in the queue');
select is((select public.self_check_in(pg_temp.id('op'), (pg_temp.codes(pg_temp.id('op'))).checkin_code)
           || ':' || (select count(*) from public.get_queue(pg_temp.id('op')) where is_me)), 'queued:1',
  'scanning again keeps exactly one place in the stack');
reset role; set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select is((select board_code from public.staff_event_codes(pg_temp.id('op'))), (pg_temp.codes(pg_temp.id('op'))).board_code,
  'the session manager can read the board code');
reset role; set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((public.get_session_board(pg_temp.id('op'), (pg_temp.codes(pg_temp.id('op'))).board_code)) ->> 'title', 'Open Play Now',
  'the TV board opens with its code, without signing in');
select ok(jsonb_array_length(public.get_session_board(pg_temp.id('op'), (pg_temp.codes(pg_temp.id('op'))).board_code) -> 'courts') = 1,
  'the TV board lists the session''s court');
select throws_ok($$ select public.get_session_board(pg_temp.id('op'), 'nope') $$, 'P0002', null,
  'the TV board needs the right code');
reset role;

-- ---------------------------------------------------------------------------
-- Check-ins and play history
-- ---------------------------------------------------------------------------
reset role; set local role authenticated;
select pg_temp.as_user('66666666-6666-4666-8666-666666666666');
select is((select title from public.get_my_play_history()), 'Open Play Now', 'play history comes from the check-in record');
select is((select count(*)::int from public.check_ins), 1, 'players see only their own check-ins');
reset role; set local role authenticated;
select pg_temp.as_user('33333333-3333-4333-8333-333333333333');
select is_empty($$ select 1 from public.get_my_play_history() $$, 'no check-in, no play history');

-- ---------------------------------------------------------------------------
-- Cancelling an event releases courts and settles entries
-- ---------------------------------------------------------------------------
reset role; set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select throws_ok($$ select public.staff_cancel_event(pg_temp.id('open'), '') $$, '22023', null, 'cancelling needs a reason');
select lives_ok($$ select public.staff_cancel_event(pg_temp.id('open'), 'Venue repairs') $$, 'the tournament is cancelled');
reset role;
select is((select count(*)::int from public.booking_slots where event_id = pg_temp.id('open') and status not in ('cancelled', 'released')), 0,
  'its court time is released');
select is((select count(*)::int from public.event_registrations where event_id = pg_temp.id('open') and status <> 'cancelled'), 0,
  'its entries are cancelled');
select is((select payment_status::text from public.bookings where event_id = pg_temp.id('open')
           and player_id = '11111111-1111-4111-8111-111111111111'), 'refund_due', 'a paid entry fee is marked for refund');
select ok(exists (select 1 from public.notifications where kind = 'event_cancelled'
                  and user_id = '22222222-2222-4222-8222-222222222222'), 'partners are told too');
set local role authenticated;
select pg_temp.as_user('66666666-6666-4666-8666-666666666666');
select is((select status from public.get_court_availability(pg_temp.tday()) where court_number = 2 and starts_at = pg_temp.at(14)),
  'available', 'the released court is bookable again');


-- Open play is individual: no doubles divisions, no partners
reset role; set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
with x as (insert into public.event_divisions (event_id, category_id, name, team_size)
  values (pg_temp.id('novice'), pg_temp.cat('singles'), 'Novice pairs', 2) returning id) select pg_temp.keep('np', id) from x;
select is((select team_size::int from public.event_divisions where id = pg_temp.id('np')), 1,
  'a division in an open play session is always for individual players');
select throws_ok($$ select * from public.staff_register_player(pg_temp.id('novice'), '22222222-2222-4222-8222-222222222222',
  pg_temp.id('np'), '66666666-6666-4666-8666-666666666666') $$, '22023',
  'Open play is for individual players. Each player books their own place.', 'open play refuses a partner');

-- Deleting: open play sessions can go even with players; tournaments cannot
reset role; set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select throws_ok($$ select public.staff_delete_event(pg_temp.id('open'), 'Clean up') $$, '22023', null,
  'a tournament players registered for cannot be deleted');
select lives_ok($$ select public.staff_delete_event(pg_temp.id('op'), 'Session moved to Saturday') $$,
  'an open play session with registered and queued players can be deleted');
reset role;
select ok(not exists (select 1 from public.events where id = pg_temp.id('op')), 'the deleted session is gone');
select ok(exists (select 1 from public.notifications where kind = 'event_cancelled'
                  and user_id = '99999999-9999-4999-8999-999999999999'), 'its registered players are told it was cancelled');

select * from finish();
rollback;
