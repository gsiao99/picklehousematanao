-- Desk cash: "Paid / confirmed" and "Record cash payment" need the cash counted;
-- less than the balance is a part payment. Neither works while a receipt waits.
-- Hours, rates and accounts are TEST FIXTURES in this rolled-back transaction.
begin;
select plan(14);

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
-- A receipt is waiting: the desk cannot mark the booking paid
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
insert into ids values ('b1', pg_temp.book(1, 14));
do $$ begin perform pg_temp.upload(pg_temp.id('b1'), 'r.jpg'); end $$;
select lives_ok($$ select public.submit_payment(pg_temp.id('b1'), pg_temp.method('gcash'),
  '11111111-1111-4111-8111-111111111111/' || pg_temp.id('b1') || '/r.jpg', 'GC-WAIT-1', null, 25000) $$,
  'the player sends a receipt');
insert into ids values ('b2', pg_temp.book(2, 14));

select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select throws_ok($$ select public.staff_mark_booking_paid(pg_temp.id('b1'), null, 25000) $$,
  '22023', 'A receipt is waiting for this booking. Review it in Payments and enter the amount it shows.',
  '"Paid / confirmed" is refused while a receipt is waiting');
select throws_ok($$ select public.staff_record_cash_payment(pg_temp.id('b1'), null, 25000) $$,
  '22023', null, 'recording cash is refused while a receipt is waiting');
select is((select count(*) from public.payments where booking_id = pg_temp.id('b1') and status = 'submitted'), 1::bigint,
  'the receipt is still waiting for review');

-- ---------------------------------------------------------------------------
-- Cash at the desk: the amount counted is required and recorded
-- ---------------------------------------------------------------------------
select throws_ok($$ select public.staff_mark_booking_paid(pg_temp.id('b2')) $$,
  '22023', 'Enter the cash received.', 'marking paid without an amount is refused');
select throws_ok($$ select public.staff_mark_booking_paid(pg_temp.id('b2'), null, 30000) $$,
  '22023', null, 'more than the balance is refused');
select lives_ok($$ select public.staff_mark_booking_paid(pg_temp.id('b2'), null, 10000) $$, 'part of the balance in cash');
select is((select payment_status::text from public.bookings where id = pg_temp.id('b2')), 'unpaid',
  'a part payment leaves the booking unpaid');
select is(private.amount_due(pg_temp.id('b2')), 15000::bigint, 'the rest is still due');
select lives_ok($$ select public.staff_record_cash_payment(pg_temp.id('b2'), 'Rest at the desk', 15000) $$, 'the rest in cash');
select is((select payment_status::text from public.bookings where id = pg_temp.id('b2')), 'paid', 'the whole balance makes it paid');
select is((select array_agg(amount_centavos order by amount_centavos) from public.payments
            where booking_id = pg_temp.id('b2') and method_kind = 'cash' and status = 'approved'),
  array[10000, 15000]::bigint[], 'each cash payment records the amount counted');

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
reset role;
select ok(not has_function_privilege('anon', 'public.staff_mark_booking_paid(uuid, text, bigint)', 'execute'),
  'anonymous visitors cannot mark bookings paid');
select ok(not has_function_privilege('authenticated', 'private.record_desk_cash(public.bookings, bigint, text)', 'execute'),
  'the shared cash helper is not callable from the API');

select * from finish();
rollback;
