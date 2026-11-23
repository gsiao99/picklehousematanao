-- Booking engine with guest bookings: availability, booking, conflicts,
-- validation, staff cancellation, blocks, live view. Hours and rates below are TEST FIXTURES
-- inside this rolled-back transaction, not venue data.
begin;
select plan(42);
\ir _fixtures.sql

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
-- Test-only helpers (SECURITY DEFINER so any test role can use them).
-- Test day: tomorrow's operating date. at_hour(14) = 2:00 PM that day, at_hour(24) = 12:00 MN.
create function pg_temp.test_day() returns date language sql stable security definer as
  $$ select private.operating_date_of(now()) + 1 $$;
create function pg_temp.at_hour(_h int) returns timestamptz language sql stable security definer as
  $$ select (pg_temp.test_day()::timestamp + make_interval(hours => _h)) at time zone 'Asia/Manila' $$;
create function pg_temp.court(_n int) returns uuid language sql stable security definer as
  $$ select id from public.courts where number = _n $$;
create function pg_temp.slot(_court int, _h int) returns jsonb language sql stable security definer as
  $$ select jsonb_build_object('court_id', pg_temp.court(_court), 'starts_at', pg_temp.at_hour(_h)) $$;
create function pg_temp.status_at(_court int, _h int) returns text language sql stable as
  $$ select status from public.get_court_availability(pg_temp.test_day())
     where court_number = _court and starts_at = pg_temp.at_hour(_h) $$;
create function pg_temp.price_at(_court int, _h int) returns bigint language sql stable as
  $$ select price_centavos from public.get_court_availability(pg_temp.test_day())
     where court_number = _court and starts_at = pg_temp.at_hour(_h) $$;
grant execute on function pg_temp.test_day(), pg_temp.at_hour(int), pg_temp.court(int), pg_temp.slot(int, int),
  pg_temp.status_at(int, int), pg_temp.price_at(int, int) to public;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'ana.reyes@test.local', '{"full_name":"Ana Reyes"}'),
  ('22222222-2222-4222-8222-222222222222', 'ben.cruz@test.local', '{"full_name":"Ben Cruz"}'),
  ('33333333-3333-4333-8333-333333333333', 'carla.mendoza@test.local', '{"full_name":"Carla Mendoza"}'),
  ('44444444-4444-4444-8444-444444444444', 'dan.villanueva@test.local', '{"full_name":"Dan Villanueva"}');
insert into public.user_roles (user_id, role) values
  ('33333333-3333-4333-8333-333333333333', 'staff'),
  ('44444444-4444-4444-8444-444444444444', 'staff');
insert into public.staff_permissions (user_id, permission) values
  ('33333333-3333-4333-8333-333333333333', 'schedule.manage'),
  ('33333333-3333-4333-8333-333333333333', 'bookings.cancel');

-- Open 6:00 AM – 1:00 AM every day (fixture)
insert into public.operating_hours (weekday, opens_at, closes_at)
select d, '06:00', '01:00' from generate_series(0, 6) d;

-- Off-peak 8:00 AM – 5:00 PM, peak 5:00 PM – 1:00 AM, Court 3 peak override (fixtures)
insert into public.rate_rules (product, label, tier, starts_at, ends_at, price_centavos, unit) values
  ('court_rental', 'Off-peak', 'off_peak', '08:00', '17:00', 25000, 'per_court_hour'),
  ('court_rental', 'Peak', 'peak', '17:00', '01:00', 30000, 'per_court_hour');
insert into public.rate_rules (product, label, tier, court_id, starts_at, ends_at, price_centavos, unit)
values ('court_rental', 'Peak · Court 3', 'peak', pg_temp.court(3), '17:00', '01:00', 35000, 'per_court_hour');

-- ---------------------------------------------------------------------------
-- Availability and server-side prices (anonymous visitor)
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select is((select state || '/' || bookable::text from public.get_operating_day(pg_temp.test_day())), 'open/true',
  'the test day is open and bookable');
select is(pg_temp.status_at(1, 14) || ' ' || pg_temp.price_at(1, 14), 'available 25000',
  'off-peak hour is available at the off-peak database rate');
select is(pg_temp.price_at(1, 18), 30000::bigint, 'peak hour uses the peak rate');
select is(pg_temp.price_at(3, 18), 35000::bigint, 'a court-specific rate overrides the all-courts rate');
select is(pg_temp.status_at(2, 24) || ' ' || pg_temp.price_at(2, 24), 'available 30000',
  'the 12:00 MN hour belongs to the same day and uses the overnight peak window');
select is(pg_temp.status_at(1, 6), 'unpriced', 'an hour with no rate is shown as unpriced, not given an invented price');
select is((select count(*)::int from public.get_court_availability(pg_temp.test_day())), 3 * 19,
  'three courts × 19 opening hours are listed');
-- Guests book as anonymous visitors. pg_temp.book returns the reference and
-- keeps the token in pg_temp.tokens.
create temp table tokens (reference text primary key, token text);
grant all on tokens to public;
create function pg_temp.book(_slots jsonb, _name text default 'Ana R.', _phone text default '09170000001') returns text
language plpgsql as $$
declare _r record;
begin
  select * into _r from public.guest_create_booking(_slots, _name, _phone);
  insert into tokens values (_r.reference, _r.token);
  return _r.reference;
end $$;
grant execute on function pg_temp.book(jsonb, text, text) to public;
create function pg_temp.bid(_ref text) returns uuid language sql stable security definer as
  $$ select id from public.bookings where reference = _ref $$;
grant execute on function pg_temp.bid(text) to public;

-- ---------------------------------------------------------------------------
-- 1. Single slot (Ana, a guest)
-- ---------------------------------------------------------------------------
select lives_ok($$ select pg_temp.book(jsonb_build_array(pg_temp.slot(1, 14))) $$, 'a guest books one slot');
reset role;
select ok((select status = 'confirmed' and total_centavos = 25000 and payment_status = 'unpaid'
                  and reference ~ '^PH-[0-9]{6}-[0-9]{4}$' and player_id is null and guest_phone = '09170000001'
           from public.bookings),
  'the booking is confirmed at once, priced by the server, with a PH reference and the guest''s phone');
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(pg_temp.status_at(1, 14) || '/' || coalesce(pg_temp.price_at(1, 14)::text, 'hidden'), 'pending/hidden',
  'others see an unpaid booking as pending payment, without its price');

-- ---------------------------------------------------------------------------
-- 2. Multiple courts and nonconsecutive hours in one booking (Ben)
-- ---------------------------------------------------------------------------
select lives_ok($$ select pg_temp.book(jsonb_build_array(pg_temp.slot(2, 14), pg_temp.slot(3, 18), pg_temp.slot(2, 20)), 'Ben C.', '09170000002') $$,
  'a guest books different courts at nonconsecutive hours at once');
reset role;
select is((select total_centavos from public.bookings where display_name = 'Ben C.'), 90000::bigint,
  'the total is the sum of each hour''s database rate (250 + 350 + 300 pesos)');
select is((select count(*)::int from public.booking_slots where booking_id = (select id from public.bookings where display_name = 'Ben C.')),
  3, 'the booking has three separate slots');
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

-- ---------------------------------------------------------------------------
-- 3. Same slot twice, and all-or-nothing bookings
-- ---------------------------------------------------------------------------
select throws_ok($$ select pg_temp.book(jsonb_build_array(pg_temp.slot(1, 14)), 'Cara M.', '09170000003') $$,
  '23P01', 'Court 1 at 2:00 PM was just taken. Choose another time.', 'booking an already booked slot is refused');
select throws_ok($$ select pg_temp.book(jsonb_build_array(pg_temp.slot(1, 15), pg_temp.slot(1, 14)), 'Cara M.', '09170000003') $$,
  '23P01', null, 'a booking that includes one taken slot is refused');
select is(pg_temp.status_at(1, 15), 'available', 'nothing from the refused request is kept (all or nothing)');

-- Validation
select throws_ok($$ select pg_temp.book(jsonb_build_array(pg_temp.slot(1, 5))) $$,
  '22023', null, 'times outside opening hours are refused');
select throws_ok($$ select pg_temp.book(jsonb_build_array(pg_temp.slot(1, 6))) $$,
  '22023', null, 'times with no bookable rate are refused');
select throws_ok($$ select pg_temp.book(jsonb_build_array(jsonb_build_object('court_id', pg_temp.court(1),
                   'starts_at', date_trunc('hour', now()) - interval '1 hour'))) $$,
  '22023', null, 'past times are refused');
select throws_ok($$ select pg_temp.book(jsonb_build_array(jsonb_build_object('court_id', pg_temp.court(1),
                   'starts_at', pg_temp.at_hour(14) + interval '31 days'))) $$,
  '22023', null, 'times beyond the booking window are refused');
select throws_ok($$ select pg_temp.book(jsonb_build_array(jsonb_build_object('court_id', pg_temp.court(1),
                   'starts_at', pg_temp.at_hour(14) + interval '30 minutes'))) $$,
  '22023', null, 'times not on the hour are refused');
select throws_ok($$ select pg_temp.book((select jsonb_agg(pg_temp.slot(c, h)) from generate_series(1, 3) c, generate_series(8, 10) h)) $$,
  '22023', 'One booking can hold up to 8 court-hours.', 'the per-booking limit is enforced');

-- A rate whose basis is not confirmed (unit null) is shown but not bookable.
reset role;
update public.rate_rules set unit = null where label = 'Off-peak';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select pg_temp.book(jsonb_build_array(pg_temp.slot(1, 9))) $$,
  '22023', 'Court 1 at 9:00 AM cannot be booked online yet. Contact the club.', 'a rate with no basis cannot be booked');
reset role;
update public.rate_rules set unit = 'per_court_hour' where label = 'Off-peak';

-- ---------------------------------------------------------------------------
-- 4. Staff cancellation (guests cancel through their manage link: test 24)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
select throws_ok($$ select public.cancel_booking(pg_temp.bid((select reference from tokens order by reference desc limit 1)), 'test') $$,
  '42501', null, 'staff without bookings.cancel cannot cancel bookings');
select isnt_empty($$ select 1 from public.staff_get_schedule(pg_temp.test_day()) where player_name = 'Ben C.' and player_phone = '09170000002' $$,
  'staff see the guest''s name and phone on the detailed schedule');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select throws_ok($$ select public.cancel_booking((select id from public.bookings where display_name = 'Ben C.'), '') $$,
  '22023', null, 'staff must give a reason to cancel');
select lives_ok($$ select public.cancel_booking((select id from public.bookings where display_name = 'Ben C.'), 'Venue closed for repairs') $$,
  'staff with bookings.cancel can cancel a confirmed booking');
select is(pg_temp.status_at(2, 14), 'available', 'a cancelled booking releases its time');

-- ---------------------------------------------------------------------------
-- 5b. Maintenance and private-event blocks
-- ---------------------------------------------------------------------------
select lives_ok($$ select public.staff_block_courts(array[pg_temp.court(1), pg_temp.court(2)], pg_temp.at_hour(9),
                  pg_temp.at_hour(11), 'maintenance', 'Resurfacing', 'Scheduled resurfacing') $$,
  'a schedule manager can block two courts for maintenance');
select is(pg_temp.status_at(1, 9) || ' ' || pg_temp.status_at(2, 10) || ' ' || pg_temp.status_at(3, 9),
  'maintenance maintenance available', 'the blocked hours show as maintenance and other courts stay open');
select throws_ok($$ select public.staff_block_courts(array[pg_temp.court(1)], pg_temp.at_hour(14), pg_temp.at_hour(15),
                   'block', null, 'Coaching') $$,
  '23P01', null, 'a block cannot be placed over a booked time');
select lives_ok($$ select public.staff_block_courts(array[pg_temp.court(3)], pg_temp.at_hour(12), pg_temp.at_hour(14),
                  'private_event', 'Company outing', 'Private hire') $$,
  'a schedule manager can reserve a court for a private event');
select is(pg_temp.status_at(3, 13), 'private_event', 'private events show on the schedule');
select lives_ok($$ select public.staff_remove_block((select slot_id from public.staff_get_schedule(pg_temp.test_day())
                  where kind = 'maintenance' and court_name = 'Court 1'), 'Resurfacing postponed') $$,
  'a schedule manager can lift a block');
select is(pg_temp.status_at(1, 9), 'available', 'lifting the block frees the time');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select pg_temp.book(jsonb_build_array(pg_temp.slot(2, 9))) $$,
  '23P01', null, 'guests cannot book over a maintenance block');
select throws_ok($$ select public.staff_block_courts(array[pg_temp.court(1)], pg_temp.at_hour(9), pg_temp.at_hour(10),
                   'block', null, 'mine now') $$,
  '42501', null, 'visitors cannot block courts');
select throws_ok('select private.expire_stale_holds()', '42501', null, 'visitors cannot run internal maintenance functions');

-- ---------------------------------------------------------------------------
-- 6. Live court view and change signals
-- ---------------------------------------------------------------------------
reset role;
select ok((select version > 5 from public.schedule_signals where operating_date = pg_temp.test_day()),
  'every schedule change bumps the day''s change signal');

insert into public.bookings (id, status, display_name, guest_phone) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'confirmed', 'Live Guest', '09170000009');
insert into public.booking_slots (booking_id, court_id, slot, kind, status)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.court(2),
        tstzrange(date_trunc('hour', now()), date_trunc('hour', now()) + interval '1 hour'), 'rental', 'confirmed');
insert into public.booking_slots (court_id, slot, kind, status)
values (pg_temp.court(3), tstzrange(date_trunc('hour', now()), date_trunc('hour', now()) + interval '2 hours'),
        'maintenance', 'confirmed');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select string_agg(court_name || '=' || status, ' ' order by court_number) from public.get_live_courts()
           where court_number in (2, 3)),
  'Court 2=reserved Court 3=maintenance', 'the live view shows an unpaid booking in progress as reserved');

reset role;
update public.bookings set payment_status = 'paid' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select string_agg(court_name || '=' || status, ' ' order by court_number) from public.get_live_courts()
           where court_number in (2, 3)),
  'Court 2=in_use Court 3=maintenance', 'once paid, the live view shows the court in use');

-- Exposure: anonymous visitors may call only the public read functions (and the code-protected TV board)
reset role;
select is((select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
             and p.proname not in ('plan', 'ok', 'is', 'isnt', 'throws_ok', 'lives_ok', 'is_empty', 'isnt_empty', 'finish')
             and p.proname not like '\_%'),
  'get_court_availability,get_events,get_live_courts,get_operating_day,get_session_board,guest_begin_receipt_upload,guest_cancel_booking,guest_create_booking,guest_get_booking,guest_submit_payment',
  'anonymous visitors can call only the public read functions and the token-checked guest functions');

select * from finish();
rollback;
