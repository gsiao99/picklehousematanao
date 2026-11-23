-- Payment amounts: players state what they sent (full payments only); staff
-- count what the receipt shows, so a short receipt leaves the rest due.
-- Tracing: search by reference number, balances, history, money by method.
-- Hours, rates and accounts are TEST FIXTURES in this rolled-back transaction.
begin;
select plan(16);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
create function pg_temp.test_day() returns date language sql stable security definer as
  $$ select private.operating_date_of(now()) + 1 $$;
create function pg_temp.at_hour(_h int) returns timestamptz language sql stable security definer as
  $$ select (pg_temp.test_day()::timestamp + make_interval(hours => _h)) at time zone 'Asia/Manila' $$;
create function pg_temp.slot(_court int, _h int) returns jsonb language sql stable security definer as
  $$ select jsonb_build_object('court_id', (select id from public.courts where number = _court), 'starts_at', pg_temp.at_hour(_h)) $$;
-- Hold and confirm one slot as the current user; returns the booking id.
create function pg_temp.book(_court int, _h int) returns uuid language plpgsql as $$
declare _id uuid;
begin
  _id := public.hold_slots(jsonb_build_array(pg_temp.slot(_court, _h)));
  perform public.confirm_booking(_id);
  return _id;
end $$;
create function pg_temp.as_user(_id text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', _id, 'role', 'authenticated')::text, true);
end $$;
-- Upload a proof as the current user (what Supabase Storage does on upload).
create function pg_temp.upload(_booking uuid, _file text) returns text language plpgsql as $$
declare _path text := auth.uid()::text || '/' || _booking::text || '/' || _file;
begin
  insert into storage.objects (bucket_id, name, owner, owner_id) values ('payment-proofs', _path, auth.uid(), auth.uid()::text);
  return _path;
end $$;
-- Booking ids by name, shared across role switches.
create temp table ids (name text primary key, id uuid);
grant all on ids to public;
create function pg_temp.id(_name text) returns uuid language sql stable as $$ select id from ids where name = _name $$;
grant execute on function pg_temp.test_day(), pg_temp.at_hour(int), pg_temp.slot(int, int), pg_temp.book(int, int),
  pg_temp.as_user(text), pg_temp.upload(uuid, text), pg_temp.id(text) to public;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'ana.reyes@test.local', '{"full_name":"Ana Reyes","phone":"09171234567"}'),
  ('22222222-2222-4222-8222-222222222222', 'ben.cruz@test.local', '{"full_name":"Ben Cruz"}'),
  ('33333333-3333-4333-8333-333333333333', 'carla.mendoza@test.local', '{"full_name":"Carla Mendoza"}'),
  ('44444444-4444-4444-8444-444444444444', 'dan.villanueva@test.local', '{"full_name":"Dan Villanueva"}'),
  ('55555555-5555-4555-8555-555555555555', 'lea.navarro@test.local', '{"full_name":"Lea Navarro"}');
insert into public.user_roles (user_id, role) values
  ('33333333-3333-4333-8333-333333333333', 'staff'),
  ('44444444-4444-4444-8444-444444444444', 'staff'),
  ('55555555-5555-4555-8555-555555555555', 'admin');
insert into public.staff_permissions (user_id, permission) values
  ('33333333-3333-4333-8333-333333333333', 'schedule.manage'),
  ('44444444-4444-4444-8444-444444444444', 'payments.verify');

insert into public.operating_hours (weekday, opens_at, closes_at)
select d, '06:00', '23:00' from generate_series(0, 6) d;
insert into public.rate_rules (product, label, tier, starts_at, ends_at, price_centavos, unit) values
  ('court_rental', 'Test rate', 'off_peak', '06:00', '23:00', 25000, 'per_court_hour');
insert into public.payment_methods (kind, label, account_name, account_number, bank_name, instructions, is_active, sort_order) values
  ('gcash', 'GCash', 'TEST ACCOUNT', '09000000001', null, 'Send the exact amount.', true, 1),
  ('maya', 'Maya', 'TEST ACCOUNT', '09000000002', null, null, true, 2),
  ('bank_transfer', 'Bank transfer', 'TEST ACCOUNT', '000000000003', 'TEST BANK', null, false, 3);
create function pg_temp.method(_kind text) returns uuid language sql stable security definer as
  $$ select id from public.payment_methods where kind::text = _kind $$;
grant execute on function pg_temp.method(text) to public;


-- ---------------------------------------------------------------------------
-- A player must send the full amount
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
insert into ids values ('b1', pg_temp.book(1, 14));
do $$ begin perform pg_temp.upload(pg_temp.id('b1'), 'half.jpg'); end $$;
select throws_ok($$ select public.submit_payment(pg_temp.id('b1'), pg_temp.method('gcash'),
  '11111111-1111-4111-8111-111111111111/' || pg_temp.id('b1') || '/half.jpg', 'GC-HALF-1', null, 12500) $$,
  '22023', null, 'a payment for less than the amount due is refused');
select lives_ok($$ select public.submit_payment(pg_temp.id('b1'), pg_temp.method('gcash'),
  '11111111-1111-4111-8111-111111111111/' || pg_temp.id('b1') || '/half.jpg', 'GC-REF-777', null, 25000) $$,
  'the full amount is accepted');
select is((select declared_centavos from public.payments where booking_id = pg_temp.id('b1')), 25000::bigint,
  'the amount the player said they sent is kept');

-- ---------------------------------------------------------------------------
-- The receipt shows only half: staff approve what arrived
-- ---------------------------------------------------------------------------
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select throws_ok($$ select public.staff_review_payment((select id from public.payments where booking_id = pg_temp.id('b1')), true, null, 0) $$,
  '22023', null, 'the received amount must be more than zero');
select lives_ok($$ select public.staff_review_payment((select id from public.payments where booking_id = pg_temp.id('b1')), true, null, 12500) $$,
  'staff approve the ₱125 that arrived');
select is((select payment_status::text from public.bookings where id = pg_temp.id('b1')), 'unpaid',
  'the booking is not marked paid');
select is((select due_centavos from public.staff_booking_balances(array[pg_temp.id('b1')])), 12500::bigint,
  'the balance still due is ₱125');
select is((select paid_centavos from public.staff_booking_balances(array[pg_temp.id('b1')])), 12500::bigint,
  'and ₱125 is counted as paid');
reset role;
select ok(exists (select 1 from public.notifications where user_id = '11111111-1111-4111-8111-111111111111'
                  and title = 'Part of your payment received' and body like '%₱125.00 is still due%'),
  'the player is told how much is still due');
set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');

-- ---------------------------------------------------------------------------
-- Tracing
-- ---------------------------------------------------------------------------
select is((select reference from public.staff_search_bookings('REF-777')), (select reference from public.bookings where id = pg_temp.id('b1')),
  'booking search finds a booking by its payment reference number');
select is((select count(*)::int from public.staff_search_payments('GC-REF')), 1, 'payment search matches the reference number');
select ok((select count(*) > 0 from public.staff_booking_history(pg_temp.id('b1')) where table_name = 'payments'),
  'payment staff see payment entries in the booking history');
select is((select centavos from public.staff_money_summary() where kind = 'booking_payment' and method = 'gcash'), 12500::bigint,
  'today''s money counts what was received, by method');

select pg_temp.as_user('33333333-3333-4333-8333-333333333333');
select is((select count(*)::int from public.staff_booking_history(pg_temp.id('b1')) where table_name = 'payments'), 0,
  'other staff see the booking history without payment entries');
select throws_ok($$ select * from public.staff_money_summary() $$, '42501', null, 'only payment staff see money totals');

select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select throws_ok($$ select * from public.staff_booking_history(pg_temp.id('b1')) $$, '42501', null, 'players cannot read booking history');

select * from finish();
rollback;
