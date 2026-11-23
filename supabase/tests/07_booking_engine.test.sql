-- Booking engine: availability, holds, confirmation, conflicts, expiry,
-- cancellation, blocks, live view. Hours and rates below are TEST FIXTURES
-- inside this rolled-back transaction, not venue data.
begin;
select plan(53);

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
select throws_ok($$ select public.hold_slots(jsonb_build_array(pg_temp.slot(1, 14))) $$,
  '42501', null, 'visitors cannot hold slots');

-- ---------------------------------------------------------------------------
-- 1. Single slot: hold then confirm (Ana)
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

select lives_ok($$ select public.hold_slots(jsonb_build_array(pg_temp.slot(1, 14))) $$, 'a player can hold one slot');
select ok((select status = 'held' and total_centavos = 25000 and payment_status = 'unpaid'
                  and hold_expires_at between now() + interval '14 minutes' and now() + interval '16 minutes'
           from public.bookings where status = 'held'),
  'the hold is priced by the server and lasts the configured 15 minutes');
select is(pg_temp.status_at(1, 14), 'in_cart', 'the held slot shows as in the player''s cart');
select is((select status from public.confirm_booking((select id from public.bookings where status = 'held'))),
  'confirmed', 'the player can confirm the hold');
select ok((select reference ~ '^DD-[0-9]{6}-[0-9]{4}$' and status = 'confirmed' and payment_status = 'unpaid'
           from public.bookings where status = 'confirmed'),
  'a confirmed booking has a unique reference and its payment status is tracked separately');
select is(pg_temp.status_at(1, 14), 'mine', 'the player sees the slot as theirs');

-- ---------------------------------------------------------------------------
-- 2. Multiple courts and nonconsecutive hours in one booking (Ben)
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);

-- Unpaid bookings show as pending until staff confirm payment (Oct 13 2026).
select is(pg_temp.status_at(1, 14) || '/' || coalesce(pg_temp.price_at(1, 14)::text, 'hidden'), 'pending/hidden',
  'another player sees an unpaid booking as pending payment, without its price or owner');
select lives_ok($$ select public.hold_slots(jsonb_build_array(pg_temp.slot(2, 14), pg_temp.slot(3, 18), pg_temp.slot(2, 20))) $$,
  'a player can hold different courts at nonconsecutive hours at once');
select is((select total_centavos from public.bookings where status = 'held'), 90000::bigint,
  'the total is the sum of each hour''s database rate (250 + 350 + 300 pesos)');
select is((select count(*)::int from public.booking_slots where booking_id = (select id from public.bookings where status = 'held')),
  3, 'the booking has three separate slots');
select is((select status from public.confirm_booking((select id from public.bookings where status = 'held'))),
  'confirmed', 'the multi-slot booking is confirmed');

-- ---------------------------------------------------------------------------
-- 3. Same slot twice, and all-or-nothing holds
-- ---------------------------------------------------------------------------
select throws_ok($$ select public.hold_slots(jsonb_build_array(pg_temp.slot(1, 14))) $$,
  '23P01', 'Court 1 at 2:00 PM was just taken. Remove it and try again.', 'booking an already booked slot is refused');
select throws_ok($$ select public.hold_slots(jsonb_build_array(pg_temp.slot(1, 15), pg_temp.slot(1, 14))) $$,
  '23P01', null, 'a hold that includes one taken slot is refused');
select is(pg_temp.status_at(1, 15), 'available', 'nothing from the refused request is held (all or nothing)');

-- Validation
select throws_ok($$ select public.hold_slots(jsonb_build_array(pg_temp.slot(1, 5))) $$,
  '22023', null, 'times outside opening hours are refused');
select throws_ok($$ select public.hold_slots(jsonb_build_array(pg_temp.slot(1, 6))) $$,
  '22023', null, 'times with no rate are refused');
select throws_ok($$ select public.hold_slots(jsonb_build_array(jsonb_build_object('court_id', pg_temp.court(1),
                   'starts_at', date_trunc('hour', now()) - interval '1 hour'))) $$,
  '22023', null, 'past times are refused');
select throws_ok($$ select public.hold_slots(jsonb_build_array(jsonb_build_object('court_id', pg_temp.court(1),
                   'starts_at', pg_temp.at_hour(14) + interval '31 days'))) $$,
  '22023', null, 'times beyond the booking window are refused');
select throws_ok($$ select public.hold_slots(jsonb_build_array(jsonb_build_object('court_id', pg_temp.court(1),
                   'starts_at', pg_temp.at_hour(14) + interval '30 minutes'))) $$,
  '22023', null, 'times not on the hour are refused');
select throws_ok($$ select public.hold_slots((select jsonb_agg(pg_temp.slot(c, h)) from generate_series(1, 3) c, generate_series(8, 10) h)) $$,
  '22023', 'One booking can hold up to 8 court-hours.', 'the per-booking limit is enforced');

-- ---------------------------------------------------------------------------
-- Hold expiry releases the time
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select public.hold_slots(jsonb_build_array(pg_temp.slot(1, 16)));

reset role;
update public.bookings set hold_expires_at = now() - interval '1 minute' where status = 'held'
  and player_id = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select is(pg_temp.status_at(1, 16), 'available', 'an expired hold no longer blocks the time');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select is((select status from public.confirm_booking(
            (select id from public.bookings where player_id = '11111111-1111-4111-8111-111111111111' and status = 'held'))),
  'expired', 'confirming after the hold ran out reports it expired instead of confirming');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select lives_ok($$ select public.hold_slots(jsonb_build_array(pg_temp.slot(1, 16))) $$,
  'someone else can then book the released time');

-- ---------------------------------------------------------------------------
-- 5a. Cancellation policy and release
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select throws_ok($$ select public.cancel_booking((select id from public.bookings where status = 'confirmed'), null) $$,
  '42501', 'Contact the club to cancel a confirmed booking.', 'with no player cancellation policy set, players cannot cancel confirmed bookings');

reset role;
update public.venue_settings set player_cancel_cutoff_hours = 2;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select lives_ok($$ select public.cancel_booking((select id from public.bookings where status = 'confirmed'), 'Change of plans') $$,
  'with a cutoff configured, a player can cancel ahead of it');
select is(pg_temp.status_at(1, 14), 'available', 'a cancelled booking releases its time');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select throws_ok($$ select public.cancel_booking((select id from public.bookings
                   where player_id = '11111111-1111-4111-8111-111111111111' limit 1), 'nope') $$,
  'P0002', null, 'a player cannot cancel someone else''s booking');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
select throws_ok($$ select public.cancel_booking((select id from public.bookings
                   where player_id = '22222222-2222-4222-8222-222222222222' and status = 'confirmed'), 'test') $$,
  'P0002', null, 'staff without bookings.cancel cannot cancel bookings');
select isnt_empty($$ select 1 from public.staff_get_schedule(pg_temp.test_day()) where player_name = 'Ben Cruz' $$,
  'staff can see who booked each slot on the detailed schedule');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select throws_ok($$ select public.cancel_booking((select id from public.bookings
                   where player_id = '22222222-2222-4222-8222-222222222222' and status = 'confirmed'), '') $$,
  '22023', null, 'staff must give a reason to cancel');
select lives_ok($$ select public.cancel_booking((select id from public.bookings
                  where player_id = '22222222-2222-4222-8222-222222222222' and status = 'confirmed'), 'Venue closed for repairs') $$,
  'staff with bookings.cancel can cancel a confirmed booking');

-- ---------------------------------------------------------------------------
-- 5b. Maintenance and private-event blocks
-- ---------------------------------------------------------------------------
select lives_ok($$ select public.staff_block_courts(array[pg_temp.court(1), pg_temp.court(2)], pg_temp.at_hour(9),
                  pg_temp.at_hour(11), 'maintenance', 'Resurfacing', 'Scheduled resurfacing') $$,
  'a schedule manager can block two courts for maintenance');
select is(pg_temp.status_at(1, 9) || ' ' || pg_temp.status_at(2, 10) || ' ' || pg_temp.status_at(3, 9),
  'maintenance maintenance available', 'the blocked hours show as maintenance and other courts stay open');
select throws_ok($$ select public.staff_block_courts(array[pg_temp.court(1)], pg_temp.at_hour(16), pg_temp.at_hour(17),
                   'block', null, 'Coaching') $$,
  '23P01', null, 'a block cannot be placed over a player''s held or confirmed time');
select lives_ok($$ select public.staff_block_courts(array[pg_temp.court(3)], pg_temp.at_hour(12), pg_temp.at_hour(14),
                  'private_event', 'Company outing', 'Private hire') $$,
  'a schedule manager can reserve a court for a private event');
select is(pg_temp.status_at(3, 13), 'private_event', 'private events show on the schedule');
select lives_ok($$ select public.staff_remove_block((select slot_id from public.staff_get_schedule(pg_temp.test_day())
                  where kind = 'maintenance' and court_name = 'Court 1'), 'Resurfacing postponed') $$,
  'a schedule manager can lift a block');
select is(pg_temp.status_at(1, 9), 'available', 'lifting the block frees the time');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select throws_ok($$ select public.hold_slots(jsonb_build_array(pg_temp.slot(2, 9))) $$,
  '23P01', null, 'players cannot book over a maintenance block');
select throws_ok($$ select public.staff_block_courts(array[pg_temp.court(1)], pg_temp.at_hour(9), pg_temp.at_hour(10),
                   'block', null, 'mine now') $$,
  '42501', null, 'players cannot block courts');
select throws_ok('select private.expire_stale_holds()', '42501', null, 'players cannot run internal maintenance functions');

-- ---------------------------------------------------------------------------
-- 6. Live court view and change signals
-- ---------------------------------------------------------------------------
reset role;
select ok((select version > 5 from public.schedule_signals where operating_date = pg_temp.test_day()),
  'every schedule change bumps the day''s change signal');

insert into public.bookings (id, player_id, status) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'confirmed');
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
  'get_cafe_menu,get_court_availability,get_events,get_gallery,get_live_courts,get_operating_day,get_session_board',
  'anonymous visitors can call only the public read functions');

select * from finish();
rollback;
