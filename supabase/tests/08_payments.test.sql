-- Payments for guest bookings: receipt upload and submission through the
-- manage link, manual verification, permissions, own-booking rule, refunds,
-- deadlines and staff operations. Hours, rates and payment accounts below are
-- TEST FIXTURES inside this rolled-back transaction, not venue data.
begin;
select plan(76);
\ir _fixtures.sql

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
create function pg_temp.test_day() returns date language sql stable security definer as
  $$ select private.operating_date_of(now()) + 1 $$;
create function pg_temp.at_hour(_h int) returns timestamptz language sql stable security definer as
  $$ select (pg_temp.test_day()::timestamp + make_interval(hours => _h)) at time zone 'Asia/Manila' $$;
create function pg_temp.slot(_court int, _h int) returns jsonb language sql stable security definer as
  $$ select jsonb_build_object('court_id', (select id from public.courts where number = _court), 'starts_at', pg_temp.at_hour(_h)) $$;
create function pg_temp.as_user(_id text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', _id, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_guest() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end $$;
-- Bookings by name with their manage-link tokens, shared across role switches.
create temp table ids (name text primary key, id uuid, reference text, token text);
grant all on ids to public;
create function pg_temp.id(_name text) returns uuid language sql stable as $$ select id from ids where name = _name $$;
create function pg_temp.ref(_name text) returns text language sql stable as $$ select reference from ids where name = _name $$;
create function pg_temp.tok(_name text) returns text language sql stable as $$ select token from ids where name = _name $$;
create function pg_temp.bid(_ref text) returns uuid language sql stable security definer as
  $$ select id from public.bookings where reference = _ref $$;
-- A guest books one court-hour; the booking is remembered under _name.
create function pg_temp.book(_name text, _court int, _h int, _guest text default 'Ana R.', _phone text default '09170000001')
returns uuid language plpgsql as $$
declare _r record;
begin
  select * into _r from public.guest_create_booking(jsonb_build_array(pg_temp.slot(_court, _h)), _guest, _phone);
  insert into ids values (_name, pg_temp.bid(_r.reference), _r.reference, _r.token);
  return pg_temp.bid(_r.reference);
end $$;
-- The guest asks for an upload path and uploads there (what Supabase Storage does).
create function pg_temp.upload(_name text, _ext text default 'jpg') returns text language plpgsql as $$
declare _path text := public.guest_begin_receipt_upload(pg_temp.ref(_name), pg_temp.tok(_name), _ext) ->> 'path';
begin
  insert into storage.objects (bucket_id, name) values ('payment-proofs', _path);
  return _path;
end $$;
create function pg_temp.pay(_name text, _method uuid, _path text, _refno text default null, _sha text default null)
returns jsonb language sql as $$
  select public.guest_submit_payment(pg_temp.ref(_name), pg_temp.tok(_name), _method, _path, _refno, _sha)
$$;
create function pg_temp.view(_name text) returns jsonb language sql as $$
  select public.guest_get_booking(pg_temp.ref(_name), pg_temp.tok(_name))
$$;
grant execute on function pg_temp.test_day(), pg_temp.at_hour(int), pg_temp.slot(int, int), pg_temp.as_user(text), pg_temp.as_guest(),
  pg_temp.id(text), pg_temp.ref(text), pg_temp.tok(text), pg_temp.bid(text), pg_temp.book(text, int, int, text, text),
  pg_temp.upload(text, text), pg_temp.pay(text, uuid, text, text, text), pg_temp.view(text) to public;

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-4333-8333-333333333333', 'carla.mendoza@test.local', '{"full_name":"Carla Mendoza"}'),
  ('44444444-4444-4444-8444-444444444444', 'dan.villanueva@test.local', '{"full_name":"Dan Villanueva"}'),
  ('55555555-5555-4555-8555-555555555555', 'lea.navarro@test.local', '{"full_name":"Lea Navarro"}');
update public.profiles set phone = '09170005555' where id = '55555555-5555-4555-8555-555555555555';
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
-- Visitors see no account details or payments
-- ---------------------------------------------------------------------------
set local role anon;
select pg_temp.as_guest();
select throws_ok($$ select * from public.payment_methods $$, '42501', null,
  'visitors cannot read the payment methods table');
select throws_ok($$ select * from public.payments $$, '42501', null, 'visitors cannot read payments');
select throws_ok($$ select * from public.notifications $$, '42501', null, 'visitors cannot read notifications');
select is(public.guest_submit_payment('PH-000000-0000', 'nope', gen_random_uuid(), 'x') ->> 'error', 'not_found',
  'paying into an unknown booking answers not found');

-- ---------------------------------------------------------------------------
-- Ana (a guest) books and submits a payment
-- ---------------------------------------------------------------------------
select pg_temp.book('ana1', 1, 14);
select is(jsonb_array_length(pg_temp.view('ana1') -> 'payment_methods'), 2,
  'the manage link shows the two enabled methods (the disabled one is hidden)');
select ok((select (v ->> 'amount_due_centavos')::bigint = 25000 and v ->> 'reference' ~ '^PH-'
                  and v -> 'payment_methods' -> 0 ->> 'account_number' is not null
           from (select pg_temp.view('ana1') as v) x),
  'it includes the server-computed amount, the reference and the account details');
select throws_ok($$ select pg_temp.pay('ana1', pg_temp.method('gcash'),
  pg_temp.id('ana1') || '/00000000-0000-4000-8000-000000000000/receipt.jpg') $$,
  '22023', 'Upload your receipt first.', 'a payment needs a receipt uploaded with an upload grant');
create temp table paths (name text primary key, path text);
grant all on paths to public;
select lives_ok($$ insert into paths values ('ana1-1', pg_temp.upload('ana1')) $$, 'Ana uploads her receipt');
select throws_ok($$ select pg_temp.pay('ana1', pg_temp.method('bank_transfer'), (select path from paths where name = 'ana1-1')) $$,
  '22023', null, 'a disabled payment method is refused');
select is(public.guest_submit_payment(pg_temp.ref('ana1'), 'wrong-token', pg_temp.method('gcash'),
  (select path from paths where name = 'ana1-1')) ->> 'error', 'not_found', 'a wrong token cannot pay');
select lives_ok($$ select pg_temp.pay('ana1', pg_temp.method('gcash'), (select path from paths where name = 'ana1-1'), null, repeat('a', 64)) $$,
  'Ana submits her payment without a reference number (optional)');
select is(pg_temp.view('ana1') ->> 'payment_status', 'pending_verification', 'her manage link shows the payment being checked');
select throws_ok($$ select pg_temp.pay('ana1', pg_temp.method('maya'), (select path from paths where name = 'ana1-1')) $$,
  '22023', 'A payment for this booking is already being checked.', 'a second submission while one is pending is refused');
select throws_ok($$ update public.payments set status = 'approved' $$, '42501', null,
  'a guest cannot change a payment''s status directly');
select throws_ok($$ insert into public.payments (booking_id, method_kind, amount_centavos, status)
  values (pg_temp.id('ana1'), 'cash', 1, 'approved') $$, '42501', null, 'a guest cannot insert a payment record');
select throws_ok($$ update public.bookings set payment_status = 'paid' $$, '42501', null,
  'a guest cannot mark a booking paid');
select throws_ok($$ select public.staff_review_payment(gen_random_uuid(), true) $$, '42501', null,
  'a guest cannot review payments');
select throws_ok($$ select * from public.staff_list_payments() $$, '42501', null, 'a guest cannot see the verification queue');

reset role;
select ok((select amount_centavos = 25000 and status = 'submitted' and reviewed_by is null and reference_no is null and submitted_by is null
           from public.payments where booking_id = pg_temp.id('ana1')),
  'the submission is recorded as waiting, with the amount set by the server');
select is((select status::text || '/' || payment_status::text from public.bookings where id = pg_temp.id('ana1')),
  'confirmed/pending_verification', 'the booking stays confirmed; only its payment status changes');
select ok((select used_at is not null from private.receipt_upload_grants where path = (select path from paths where name = 'ana1-1')),
  'the upload grant is used up');

-- ---------------------------------------------------------------------------
-- Staff without payments.verify (Carla)
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('33333333-3333-4333-8333-333333333333');
select throws_ok($$ select * from public.staff_list_payments() $$, '42501', null, 'staff without payments.verify cannot see the queue');
select throws_ok($$ select public.staff_review_payment((select id from public.payments limit 1), true) $$, '42501', null,
  'staff without payments.verify cannot approve');
select is_empty($$ select 1 from storage.objects where bucket_id = 'payment-proofs' $$, 'staff without payments.verify cannot open receipts');
select is((select count(*)::int from public.payment_methods), 3, 'staff can see every payment method');
select is_empty($$ select 1 from public.notifications where kind = 'payment_submitted' $$,
  'staff without payments.verify are not notified of submissions');

-- ---------------------------------------------------------------------------
-- Verifier (Dan): reject, then approve
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select ok((select count(*) = 1 and bool_and(link = '/admin/payments' and body like 'Ana R.%')
           from public.notifications where kind = 'payment_submitted'), 'the verifier is notified of the new submission');
select ok((select amount_centavos = 25000 and method_kind = 'gcash' and booking_reference ~ '^PH-' and player_name = 'Ana R.'
                  and player_phone = '09170000001' and not is_own and status = 'submitted'
           from public.staff_list_payments()),
  'the queue shows amount, method, reference, and the guest''s name and phone');
select isnt_empty($$ select 1 from storage.objects where bucket_id = 'payment-proofs' $$, 'the verifier can open the receipt');
select throws_ok($$ select public.staff_review_payment((select payment_id from public.staff_list_payments()), false) $$,
  '22023', null, 'rejecting needs a reason');
select lives_ok($$ select public.staff_review_payment((select payment_id from public.staff_list_payments()), false,
  'The amount on the receipt does not match.') $$, 'the verifier rejects with a reason');
select ok((select status = 'rejected' and reviewed_by = '44444444-4444-4444-8444-444444444444' and reviewed_at is not null
                  and review_note = 'The amount on the receipt does not match.'
           from public.payments where booking_id = pg_temp.id('ana1')),
  'the rejection records the reviewer, time and reason');
select is((select status::text || '/' || payment_status::text from public.bookings where id = pg_temp.id('ana1')),
  'confirmed/unpaid', 'after rejection the booking is still confirmed and can be paid again');
select throws_ok($$ select public.staff_review_payment((select id from public.payments where booking_id = pg_temp.id('ana1')), true) $$,
  '22023', 'This payment was already rejected.', 'a reviewed payment cannot be reviewed again');

reset role;
select ok((select actor_id = '44444444-4444-4444-8444-444444444444' and reason = 'The amount on the receipt does not match.'
                  and old_data ->> 'status' = 'submitted' and new_data ->> 'status' = 'rejected'
           from public.audit_log where table_name = 'payments' and action = 'update'),
  'the audit trail records who rejected the payment, why, and the change');
select ok((select count(*) = 1 and bool_and(link = '/admin/bookings/' || pg_temp.id('ana1'))
           from public.notifications where kind = 'staff_activity' and title = 'Payment rejected'
             and user_id = '33333333-3333-4333-8333-333333333333'),
  'other staff are alerted to the rejected payment, linked to the booking');

-- Ana sees the rejection on her manage link and pays again
set local role anon;
select pg_temp.as_guest();
select ok((select v -> 'payments' -> 0 ->> 'status' = 'rejected'
                  and v -> 'payments' -> 0 ->> 'review_note' = 'The amount on the receipt does not match.'
                  and v ->> 'payment_status' = 'unpaid'
           from (select pg_temp.view('ana1') as v) x),
  'the guest sees the rejection and its reason on the manage link');
select lives_ok($$ select pg_temp.pay('ana1', pg_temp.method('gcash'), pg_temp.upload('ana1', 'png'), ' GC-123456 ', repeat('b', 64)) $$,
  'the guest submits a new payment with a reference number');
reset role;
select is((select reference_no from public.payments where booking_id = pg_temp.id('ana1') and status = 'submitted'),
  'GC-123456', 'the reference is trimmed and stored');

-- Ben books; reusing Ana's reference or receipt is refused
set local role anon;
select pg_temp.as_guest();
select pg_temp.book('ben1', 2, 15, 'Ben C.', '09170000002');
select throws_ok($$ select pg_temp.pay('ben1', pg_temp.method('gcash'), pg_temp.upload('ben1'), 'gc-123456') $$,
  '23505', 'That reference number or receipt was already used for another payment.',
  'a reference number already used for the same method is refused');
select throws_ok($$ select pg_temp.pay('ben1', pg_temp.method('maya'), pg_temp.upload('ben1'), null, repeat('b', 64)) $$,
  '23505', null, 'the same receipt file (by hash) cannot be submitted twice');
select throws_ok($$ select public.guest_submit_payment(pg_temp.ref('ben1'), pg_temp.tok('ben1'), pg_temp.method('gcash'),
  (select path from paths where name = 'ana1-1')) $$, '22023', 'Upload your receipt first.',
  'a guest cannot submit another booking''s receipt');

-- Lea (admin) books as a guest with the phone on her staff profile
select pg_temp.book('lea1', 3, 14, 'Lea N.', '09170005555');
select lives_ok($$ select pg_temp.pay('lea1', pg_temp.method('maya'), pg_temp.upload('lea1')) $$,
  'staff can book and pay as a guest like anyone');
reset role;
set local role authenticated;
select pg_temp.as_user('55555555-5555-4555-8555-555555555555');
select ok((select bool_or(is_own) from public.staff_list_payments() where booking_id = pg_temp.id('lea1')),
  'the queue marks a guest booking under the staff member''s own phone as theirs');
select throws_ok($$ select public.staff_review_payment((select id from public.payments where booking_id = pg_temp.id('lea1')), true) $$,
  '42501', 'You cannot review a payment for your own booking. Ask another staff member.',
  'an admin cannot approve the payment for her own guest booking');
select throws_ok($$ select public.staff_record_cash_payment(pg_temp.id('lea1')) $$, '42501', null,
  'an admin cannot record cash for her own guest booking');

-- Dan approves Ana's new payment and records Ben's cash
reset role;
set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select lives_ok($$ select public.staff_review_payment(
  (select payment_id from public.staff_list_payments() where booking_id = pg_temp.id('ana1')), true) $$,
  'the verifier approves the payment');
select is((select status::text || '/' || payment_status::text from public.bookings where id = pg_temp.id('ana1')),
  'confirmed/paid', 'approval marks the booking paid and leaves its status confirmed');
select lives_ok($$ select public.staff_record_cash_payment(pg_temp.id('ben1'), 'Paid at the desk', 25000) $$,
  'the verifier records a cash payment for Ben');
select ok((select b.payment_status = 'paid' and p.amount_centavos = 25000 and p.method_kind = 'cash' and p.status = 'approved'
           from public.bookings b join public.payments p on p.booking_id = b.id where b.id = pg_temp.id('ben1')),
  'cash is recorded as approved for the amount due');
select throws_ok($$ select public.staff_record_cash_payment(pg_temp.id('ben1'), null, 25000) $$, '22023', null,
  'a paid booking cannot be paid again');

reset role;
set local role anon;
select pg_temp.as_guest();
select is(pg_temp.view('ana1') ->> 'payment_status', 'paid', 'the guest sees the booking paid');
select throws_ok($$ select pg_temp.upload('ana1') $$, '22023', 'This booking does not need a payment.',
  'a paid booking does not accept more receipts');

-- ---------------------------------------------------------------------------
-- Cancellation and refunds
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select pg_temp.as_user('55555555-5555-4555-8555-555555555555');
select lives_ok($$ select public.cancel_booking(pg_temp.id('ana1'), 'Guest cannot make it') $$, 'the admin cancels Ana''s paid booking');
select is((select status::text || '/' || payment_status::text from public.bookings where id = pg_temp.id('ana1')),
  'cancelled/refund_due', 'a cancelled paid booking is marked refund due');
select lives_ok($$ select public.cancel_booking(pg_temp.id('lea1'), 'Changed plans') $$,
  'a booking can be cancelled while its payment is still being checked');

reset role;
set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select lives_ok($$ select public.staff_review_payment(
  (select payment_id from public.staff_list_payments() where booking_id = pg_temp.id('lea1')), false, 'No matching transfer found.') $$,
  'the verifier rejects the cancelled booking''s payment');
select is((select payment_status::text from public.bookings where id = pg_temp.id('lea1')), 'unpaid',
  'no refund is owed when the payment was rejected');
select throws_ok($$ select public.staff_record_refund(pg_temp.id('ana1'), '') $$, '22023', null, 'recording a refund needs a reason');
select lives_ok($$ select public.staff_record_refund(pg_temp.id('ana1'), 'Refunded via GCash') $$, 'the verifier records the refund');
select is((select payment_status::text from public.bookings where id = pg_temp.id('ana1')), 'refunded', 'the booking is marked refunded');

-- ---------------------------------------------------------------------------
-- Payment deadline (configurable; off by default)
-- ---------------------------------------------------------------------------
reset role;
select is((select payment_due_at from public.bookings where id = pg_temp.id('ben1')), null::timestamptz,
  'with no deadline configured, bookings have no payment due time');
update public.venue_settings set payment_due_hours = 2;
set local role anon;
select pg_temp.as_guest();
select pg_temp.book('ben2', 1, 20, 'Ben C.', '09170000002');
reset role;
select ok((select payment_due_at between now() + interval '119 minutes' and now() + interval '121 minutes'
           from public.bookings where id = pg_temp.id('ben2')),
  'a guest booking gets a payment deadline from the setting');
update public.bookings set payment_due_at = now() - interval '1 minute' where id = pg_temp.id('ben2');
select is(private.expire_unpaid_bookings(), 1, 'the job cancels one overdue unpaid booking');
select ok((select b.status = 'cancelled' and b.payment_status = 'unpaid'
                  and not exists (select 1 from public.booking_slots s where s.booking_id = b.id and s.status = 'confirmed')
           from public.bookings b where b.id = pg_temp.id('ben2')),
  'the overdue booking is cancelled and its court time released');
set local role anon;
select pg_temp.as_guest();
select is(pg_temp.view('ben2') ->> 'cancel_reason', 'Payment not received by the deadline',
  'the guest sees why on the manage link');

-- A rejected receipt gives a fresh window instead of an instant cancellation
select pg_temp.book('ben3', 2, 21, 'Ben C.', '09170000002');
reset role;
update public.bookings set payment_status = 'pending_verification', payment_due_at = now() - interval '1 minute'
 where id = pg_temp.id('ben3');
update public.bookings set payment_status = 'unpaid' where id = pg_temp.id('ben3');
select ok((select payment_due_at > now() + interval '29 minutes' from public.bookings where id = pg_temp.id('ben3')),
  'a rejected receipt gives the guest 30 more minutes to pay');
select is(private.expire_unpaid_bookings(), 0, 'the booking is not cancelled while the new window is open');

-- Deadline in minutes
update public.venue_settings set payment_due_minutes = 30;
set local role anon;
select pg_temp.as_guest();
select pg_temp.book('ben4', 3, 20, 'Ben C.', '09170000002');
reset role;
select ok((select payment_due_at between now() + interval '29 minutes' and now() + interval '31 minutes'
           from public.bookings where id = pg_temp.id('ben4')),
  'with a deadline in minutes, a reserved court must be paid within those minutes');
select throws_ok($$ update public.venue_settings set payment_due_minutes = 5 $$, '23514', null,
  'the deadline in minutes cannot be shorter than 10 minutes');
update public.venue_settings set payment_due_minutes = null;

-- ---------------------------------------------------------------------------
-- Dashboard and booking search
-- ---------------------------------------------------------------------------
set local role anon;
select pg_temp.as_guest();
select throws_ok($$ select * from public.staff_dashboard() $$, '42501', null, 'visitors cannot open the dashboard');
select throws_ok($$ select * from public.staff_search_bookings() $$, '42501', null, 'visitors cannot search bookings');

reset role;
set local role authenticated;
select pg_temp.as_user('33333333-3333-4333-8333-333333333333');
select ok((select courts_total = 3 and pending_payments = 0 and refunds_due = 0 and hours_configured and rates_configured
                  and payment_methods_active = 2 and payment_due_hours = 2
           from public.staff_dashboard()), 'staff see operational status on the dashboard');
select is((select count(*)::int from public.staff_search_bookings('ana r')), 1, 'staff can search bookings by guest name');
select is((select count(*)::int from public.staff_search_bookings('09170000002')), 4, 'staff can search bookings by guest phone');
select is((select count(*)::int from public.staff_search_bookings(null, pg_temp.test_day(), pg_temp.test_day(), null, 'paid')),
  1, 'staff can filter bookings by date and payment status');

select * from finish();
rollback;
