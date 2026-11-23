-- Bookings, booking slots and payments: ownership, staff scoping, conflicts.
begin;
select plan(27);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'ana.reyes@test.local', '{"full_name":"Ana Reyes"}'),
  ('22222222-2222-4222-8222-222222222222', 'ben.cruz@test.local', '{"full_name":"Ben Cruz"}'),
  ('33333333-3333-4333-8333-333333333333', 'carla.mendoza@test.local', '{"full_name":"Carla Mendoza"}'),
  ('44444444-4444-4444-8444-444444444444', 'dan.villanueva@test.local', '{"full_name":"Dan Villanueva"}');
insert into public.user_roles (user_id, role) values
  ('33333333-3333-4333-8333-333333333333', 'staff'),
  ('44444444-4444-4444-8444-444444444444', 'staff');
insert into public.staff_permissions (user_id, permission) values
  ('44444444-4444-4444-8444-444444444444', 'payments.verify'),
  ('44444444-4444-4444-8444-444444444444', 'schedule.manage');

insert into public.bookings (id, player_id, status, hold_expires_at, total_centavos) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'held', now() + interval '15 minutes', 100),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'held', now() + interval '15 minutes', 100);

insert into public.booking_slots (booking_id, court_id, slot, kind, status, price_centavos)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id,
       tstzrange('2026-11-06 14:00+08', '2026-11-06 15:00+08'), 'rental', 'held', 100
from public.courts where number = 1;
insert into public.booking_slots (booking_id, court_id, slot, kind, status, price_centavos)
select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', id,
       tstzrange('2026-11-06 19:00+08', '2026-11-06 20:00+08'), 'rental', 'held', 100
from public.courts where number = 3;

insert into public.payments (id, booking_id, method_kind, amount_centavos, reference_no, proof_path, submitted_by)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'gcash', 100, 'GC-1234567',
        '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/receipt.jpg',
        '11111111-1111-4111-8111-111111111111');

-- ---- Data rules (as postgres) ---------------------------------------------------------
select ok((select reference ~ '^DD-[0-9]{6}-[0-9]{4}$' from public.bookings where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'bookings get a DD-YYMMDD-0000 reference');
select throws_ok($$ insert into public.booking_slots (booking_id, court_id, slot, kind)
                   select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', id, tstzrange('2026-11-06 14:00+08', '2026-11-06 15:00+08'), 'rental'
                   from public.courts where number = 1 $$,
  '23P01', null, 'the same court and hour cannot be booked twice');
select lives_ok($$ insert into public.booking_slots (booking_id, court_id, slot, kind)
                  select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', id, tstzrange('2026-11-06 14:00+08', '2026-11-06 15:00+08'), 'rental'
                  from public.courts where number = 2 $$,
  'the same hour on a different court is fine');
select throws_ok($$ insert into public.booking_slots (booking_id, court_id, slot, kind)
                   select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', id, tstzrange('2026-11-06 15:30+08', '2026-11-06 16:30+08'), 'rental'
                   from public.courts where number = 1 $$,
  '23514', null, 'rental slots must start on the hour');
select throws_ok($$ insert into public.booking_slots (booking_id, court_id, slot, kind)
                   select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', id, tstzrange('2026-11-06 16:00+08', '2026-11-06 18:00+08'), 'rental'
                   from public.courts where number = 1 $$,
  '23514', null, 'rental slots are exactly one hour (longer bookings are separate slots)');

insert into public.booking_slots (id, booking_id, court_id, slot, kind)
select 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', id,
       tstzrange('2026-11-07 00:00+08', '2026-11-07 01:00+08'), 'rental'
from public.courts where number = 1;
select is((select operating_date from public.booking_slots where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  '2026-11-06'::date, 'a 12:00 MN – 1:00 AM slot files under the previous operating day');

update public.booking_slots set status = 'released' where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
select lives_ok($$ insert into public.booking_slots (booking_id, court_id, slot, kind)
                  select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id, tstzrange('2026-11-07 00:00+08', '2026-11-07 01:00+08'), 'rental'
                  from public.courts where number = 1 $$,
  'a released slot frees the court for someone else');
select throws_ok($$ insert into public.payments (booking_id, method_kind, amount_centavos, reference_no, proof_path)
                   values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'gcash', 100, ' gc-1234567 ',
                           '22222222-2222-4222-8222-222222222222/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/r.jpg') $$,
  '23505', null, 'a payment reference number cannot be reused, whatever its case or spacing');
select throws_ok($$ insert into public.payments (booking_id, method_kind, amount_centavos)
                   values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'maya', 100) $$,
  '23514', null, 'an online payment needs a reference number and a proof file');

-- ---- Anonymous visitor ----------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok('select * from public.bookings', '42501', null, 'visitors cannot read bookings');
select throws_ok('select * from public.payments', '42501', null, 'visitors cannot read payments');

-- ---- Ana (player) ------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

select is((select count(*)::int from public.bookings), 1, 'a player sees only their own booking');
select is_empty($$ select 1 from public.booking_slots where booking_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' $$,
  'a player cannot see another player''s booked slots');
select is((select count(*)::int from public.payments), 1, 'a player sees their own payment');
select throws_ok($$ insert into public.bookings (player_id) values ('11111111-1111-4111-8111-111111111111') $$,
  '42501', null, 'a player cannot create bookings directly (only through checkout)');
select throws_ok($$ update public.bookings set status = 'confirmed' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  '42501', null, 'a player cannot confirm their own booking');
select throws_ok($$ insert into public.booking_slots (booking_id, court_id, slot, kind)
                   select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id, tstzrange('2026-11-08 14:00+08', '2026-11-08 15:00+08'), 'rental'
                   from public.courts where number = 2 $$,
  '42501', null, 'a player cannot add rental slots directly');
select throws_ok($$ update public.payments set status = 'approved' $$,
  '42501', null, 'a player cannot approve their own payment');
select throws_ok($$ insert into public.payments (booking_id, method_kind, amount_centavos) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cash', 100) $$,
  '42501', null, 'a player cannot record payments directly');

-- ---- Ben (player) ---------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select is_empty('select 1 from public.payments', 'another player cannot see Ana''s payment');

-- ---- Carla (staff, no permissions) ----------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select is((select count(*)::int from public.bookings), 2, 'front-desk staff can see all bookings');
select is_empty('select 1 from public.payments', 'staff without payments.verify cannot see payments');
select throws_ok($$ insert into public.booking_slots (court_id, slot, kind)
                   select id, tstzrange('2026-11-09 06:00+08', '2026-11-09 08:00+08'), 'block' from public.courts where number = 2 $$,
  '42501', null, 'staff without schedule.manage cannot block courts');

-- ---- Dan (payments.verify + schedule.manage) --------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
select is((select count(*)::int from public.payments), 1, 'a payment verifier can see submitted payments');
select lives_ok($$ insert into public.booking_slots (court_id, slot, kind, note)
                  select id, tstzrange('2026-11-09 06:00+08', '2026-11-09 08:00+08'), 'maintenance', 'Net repair'
                  from public.courts where number = 2 $$,
  'a schedule manager can block a court for maintenance');
select throws_ok($$ insert into public.booking_slots (court_id, slot, kind)
                   select id, tstzrange('2026-11-06 14:00+08', '2026-11-06 16:00+08'), 'block' from public.courts where number = 1 $$,
  '23P01', null, 'a block cannot be placed over an existing booking');

-- ---- Suspended staff lose their powers ------------------------------------------------
reset role;
update public.profiles set status = 'suspended' where id = '44444444-4444-4444-8444-444444444444';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
select is_empty('select 1 from public.payments', 'a suspended verifier can no longer see payments');

reset role;
select * from finish();
rollback;
