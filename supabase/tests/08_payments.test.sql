-- Payments: manual verification, permissions, notifications, deadlines, and
-- staff operations. Hours, rates and payment accounts below are TEST FIXTURES
-- inside this rolled-back transaction, not venue data.
begin;
select plan(95);

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
-- Visitors see no account details and cannot pay
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select * from public.payment_methods $$, '42501', null,
  'visitors cannot read payment account details');
select throws_ok($$ select * from public.get_payment_instructions(gen_random_uuid()) $$, '42501', null,
  'visitors cannot fetch payment instructions');
select throws_ok($$ select public.submit_payment(gen_random_uuid(), gen_random_uuid(), 'x') $$, '42501', null,
  'visitors cannot submit payments');
select throws_ok($$ select * from public.notifications $$, '42501', null, 'visitors cannot read notifications');

-- ---------------------------------------------------------------------------
-- Ana books and submits a payment
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
insert into ids values ('ana1', pg_temp.book(1, 14));

select is_empty($$ select 1 from public.payment_methods $$,
  'players cannot list payment accounts directly');
select is((select count(*)::int from public.get_payment_instructions(pg_temp.id('ana1'))), 2,
  'the booking owner sees the two enabled methods (the disabled one is hidden)');
select ok((select bool_and(amount_due_centavos = 25000 and booking_reference ~ '^DD-' and account_number is not null)
           from public.get_payment_instructions(pg_temp.id('ana1'))),
  'instructions include the server-computed amount, the booking reference and account details');
select throws_ok($$ select public.submit_payment(pg_temp.id('ana1'), pg_temp.method('gcash'),
  '11111111-1111-4111-8111-111111111111/' || pg_temp.id('ana1') || '/missing.jpg') $$,
  '22023', 'Your proof of payment was not found. Upload it again.', 'a payment needs an uploaded proof');
select lives_ok($$ select pg_temp.upload(pg_temp.id('ana1'), 'receipt-1.jpg') $$, 'Ana uploads a proof to her private folder');
select throws_ok($$ select public.submit_payment(pg_temp.id('ana1'), pg_temp.method('bank_transfer'),
  '11111111-1111-4111-8111-111111111111/' || pg_temp.id('ana1') || '/receipt-1.jpg') $$,
  '22023', null, 'a disabled payment method is refused');
select throws_ok($$ select public.submit_payment(pg_temp.id('ana1'), pg_temp.method('gcash'),
  '22222222-2222-4222-8222-222222222222/' || pg_temp.id('ana1') || '/receipt-1.jpg') $$,
  '22023', null, 'a proof path outside the player''s own folder is refused');
select lives_ok($$ select public.submit_payment(pg_temp.id('ana1'), pg_temp.method('gcash'),
  '11111111-1111-4111-8111-111111111111/' || pg_temp.id('ana1') || '/receipt-1.jpg', null,
  repeat('a', 64)) $$, 'Ana submits her payment without a reference number (optional)');
select ok((select amount_centavos = 25000 and status = 'submitted' and reviewed_by is null and reference_no is null
           from public.payments where booking_id = pg_temp.id('ana1')),
  'the submission is recorded as waiting, with the amount set by the server');
select is((select status::text || '/' || payment_status::text from public.bookings where id = pg_temp.id('ana1')),
  'confirmed/pending_verification', 'the booking stays confirmed; only its payment status changes');
select throws_ok($$ select public.submit_payment(pg_temp.id('ana1'), pg_temp.method('maya'),
  '11111111-1111-4111-8111-111111111111/' || pg_temp.id('ana1') || '/receipt-1.jpg') $$,
  '22023', 'A payment for this booking is already being checked.', 'a second submission while one is pending is refused');
select throws_ok($$ update public.payments set status = 'approved' $$, '42501', null,
  'a player cannot change a payment''s status directly');
select throws_ok($$ update public.payments set amount_centavos = 1 $$, '42501', null,
  'a player cannot change a payment''s amount');
select throws_ok($$ insert into public.payments (booking_id, method_kind, amount_centavos, status)
  values (pg_temp.id('ana1'), 'cash', 1, 'approved') $$, '42501', null, 'a player cannot insert a payment record');
select throws_ok($$ update public.bookings set payment_status = 'paid' $$, '42501', null,
  'a player cannot mark their booking paid');
select throws_ok($$ select public.staff_review_payment((select id from public.payments limit 1), true) $$, '42501', null,
  'a player cannot approve their own payment');
select throws_ok($$ select * from public.staff_list_payments() $$, '42501', null, 'a player cannot see the verification queue');
select throws_ok($$ insert into public.notifications (user_id, kind, title) values (auth.uid(), 'payment_approved', 'Fake') $$,
  '42501', null, 'a player cannot create notifications');

-- Ben cannot see Ana's payment or instructions
reset role;
set local role authenticated;
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select throws_ok($$ select * from public.get_payment_instructions(pg_temp.id('ana1')) $$, 'P0002', null,
  'another player cannot fetch instructions for Ana''s booking');
select is_empty($$ select 1 from public.payments $$, 'another player cannot see Ana''s payment');
select is_empty($$ select 1 from storage.objects where bucket_id = 'payment-proofs' $$, 'another player cannot see Ana''s proof');
select throws_ok($$ select public.submit_payment(pg_temp.id('ana1'), pg_temp.method('gcash'),
  '22222222-2222-4222-8222-222222222222/x/receipt.jpg') $$, 'P0002', null, 'another player cannot pay into Ana''s booking');

-- ---------------------------------------------------------------------------
-- Staff without payments.verify (Carla)
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select pg_temp.as_user('33333333-3333-4333-8333-333333333333');
select throws_ok($$ select * from public.staff_list_payments() $$, '42501', null, 'staff without payments.verify cannot see the queue');
select throws_ok($$ select public.staff_review_payment((select id from public.payments limit 1), true) $$, '42501', null,
  'staff without payments.verify cannot approve');
select is_empty($$ select 1 from storage.objects where bucket_id = 'payment-proofs' $$, 'staff without payments.verify cannot open proofs');
select is((select count(*)::int from public.payment_methods), 3, 'staff can see every payment method');
-- All staff get activity alerts ('staff_activity'); submissions go only to verifiers.
select is_empty($$ select 1 from public.notifications where kind = 'payment_submitted' $$,
  'staff without payments.verify are not notified of submissions');

-- ---------------------------------------------------------------------------
-- Verifier (Dan): reject, then approve
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select ok((select count(*) = 1 and bool_and(link = '/admin/payments')
           from public.notifications where kind = 'payment_submitted'), 'the verifier is notified of the new submission');
select ok((select amount_centavos = 25000 and method_kind = 'gcash' and booking_reference ~ '^DD-' and player_name = 'Ana Reyes'
                  and not is_own and status = 'submitted'
           from public.staff_list_payments()),
  'the queue shows amount, method, booking reference and player');
select isnt_empty($$ select 1 from storage.objects where bucket_id = 'payment-proofs' $$, 'the verifier can open the proof');
select throws_ok($$ select public.staff_review_payment((select payment_id from public.staff_list_payments()), false) $$,
  '22023', 'Give the player a reason for rejecting this payment.', 'rejecting needs a reason');
select throws_ok($$ select public.staff_review_payment((select payment_id from public.staff_list_payments()), false, '  ') $$,
  '22023', null, 'a blank reason is refused');
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
select is((select count(*)::int from public.staff_list_payments()), 0, 'the queue is empty after review');
select is((select count(*)::int from public.staff_list_payments('rejected')), 1, 'rejected payments can be listed');

reset role;
select ok((select actor_id = '44444444-4444-4444-8444-444444444444' and reason = 'The amount on the receipt does not match.'
                  and old_data ->> 'status' = 'submitted' and new_data ->> 'status' = 'rejected'
           from public.audit_log where table_name = 'payments' and action = 'update'),
  'the audit trail records who rejected the payment, why, and the change');
select ok((select count(*) = 1 and bool_and(link = '/admin/bookings/' || pg_temp.id('ana1'))
           from public.notifications where kind = 'staff_activity' and title = 'Payment rejected'
             and user_id = '33333333-3333-4333-8333-333333333333'),
  'other staff are alerted to the rejected payment, linked to the booking');
select is_empty($$ select 1 from public.notifications where kind = 'staff_activity' and title = 'Payment rejected'
                    and user_id = '44444444-4444-4444-8444-444444444444' $$,
  'the staff member who rejected it is not alerted about their own action');

-- Ana sees the rejection and pays again
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select ok((select kind = 'payment_rejected' and body like '%does not match%' and read_at is null
           from public.notifications where user_id = auth.uid()),
  'the player is notified of the rejection with the reason');
select is((select count(*)::int from public.notifications), 1, 'the player sees only their own notifications');
select lives_ok($$ select public.mark_notifications_read() $$, 'the player can mark notifications read');
select is((select count(*)::int from public.notifications where read_at is null), 0, 'notifications are marked read');
select lives_ok($$ select public.submit_payment(pg_temp.id('ana1'), pg_temp.method('gcash'),
  pg_temp.upload(pg_temp.id('ana1'), 'receipt-2.jpg'), ' GC-123456 ', repeat('b', 64)) $$,
  'the player submits a new payment with a reference number');
select is((select reference_no from public.payments where booking_id = pg_temp.id('ana1') and status = 'submitted'),
  'GC-123456', 'the reference is trimmed and stored');

-- Ben books; reusing Ana's reference is refused
reset role;
set local role authenticated;
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
insert into ids values ('ben1', pg_temp.book(2, 15));
select throws_ok($$ select public.submit_payment(pg_temp.id('ben1'), pg_temp.method('gcash'),
  pg_temp.upload(pg_temp.id('ben1'), 'r.jpg'), 'gc-123456') $$,
  '23505', 'That reference number or receipt was already used for another payment.',
  'a reference number already used for the same method is refused');
select throws_ok($$ select public.submit_payment(pg_temp.id('ben1'), pg_temp.method('maya'),
  pg_temp.upload(pg_temp.id('ben1'), 'r2.jpg'), null, repeat('b', 64)) $$,
  '23505', null, 'the same receipt file (by hash) cannot be submitted twice');

-- The admin (Lea) books for herself and cannot approve her own payment
reset role;
set local role authenticated;
select pg_temp.as_user('55555555-5555-4555-8555-555555555555');
insert into ids values ('lea1', pg_temp.book(3, 14));
select lives_ok($$ select public.submit_payment(pg_temp.id('lea1'), pg_temp.method('maya'),
  pg_temp.upload(pg_temp.id('lea1'), 'lea.jpg')) $$, 'an admin can pay for her own booking like any player');
select ok((select bool_or(is_own) from public.staff_list_payments()), 'the queue marks the admin''s own payment');
select throws_ok($$ select public.staff_review_payment((select id from public.payments where booking_id = pg_temp.id('lea1')), true) $$,
  '42501', 'You cannot review a payment for your own booking. Ask another staff member.',
  'an admin cannot approve her own payment');
select throws_ok($$ select public.staff_record_cash_payment(pg_temp.id('lea1')) $$, '42501', null,
  'an admin cannot record cash for her own booking');

-- Dan approves Ana's new payment
reset role;
set local role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select lives_ok($$ select public.staff_review_payment(
  (select payment_id from public.staff_list_payments() where booking_id = pg_temp.id('ana1')), true) $$,
  'the verifier approves the payment');
select is((select status::text || '/' || payment_status::text from public.bookings where id = pg_temp.id('ana1')),
  'confirmed/paid', 'approval marks the booking paid and leaves its status confirmed');
select ok((select reviewed_by = '44444444-4444-4444-8444-444444444444' and review_note = 'Payment verified'
           from public.payments where booking_id = pg_temp.id('ana1') and status = 'approved'),
  'the approval records the reviewer');
select lives_ok($$ select public.staff_record_cash_payment(pg_temp.id('ben1'), 'Paid at the desk', 25000) $$,
  'the verifier records a cash payment for Ben');
select ok((select b.payment_status = 'paid' and p.amount_centavos = 25000 and p.method_kind = 'cash' and p.status = 'approved'
           from public.bookings b join public.payments p on p.booking_id = b.id where b.id = pg_temp.id('ben1')),
  'cash is recorded as approved for the amount due');
select throws_ok($$ select public.staff_record_cash_payment(pg_temp.id('ben1'), null, 25000) $$, '22023', null,
  'a paid booking cannot be paid again');

reset role;
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select ok((select kind = 'payment_approved' from public.notifications where read_at is null),
  'the player is notified of the approval');
select throws_ok($$ select public.submit_payment(pg_temp.id('ana1'), pg_temp.method('gcash'),
  pg_temp.upload(pg_temp.id('ana1'), 'receipt-3.jpg')) $$, '22023', 'This booking does not need a payment.',
  'a paid booking does not accept more payments');

-- ---------------------------------------------------------------------------
-- Cancellation and refunds
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select pg_temp.as_user('55555555-5555-4555-8555-555555555555');
select lives_ok($$ select public.cancel_booking(pg_temp.id('ana1'), 'Player cannot make it') $$, 'the admin cancels Ana''s paid booking');
select is((select status::text || '/' || payment_status::text from public.bookings where id = pg_temp.id('ana1')),
  'cancelled/refund_due', 'a cancelled paid booking is marked refund due');
select lives_ok($$ select public.cancel_booking(pg_temp.id('lea1'), 'Changed plans') $$,
  'Lea cancels while her payment is still being checked');

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
set local role authenticated;
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
insert into ids values ('ben2', pg_temp.book(1, 20));
select ok((select payment_due_at between now() + interval '119 minutes' and now() + interval '121 minutes'
           from public.bookings where id = pg_temp.id('ben2')),
  'a confirmed booking gets a payment deadline from the setting');
reset role;
update public.bookings set payment_due_at = now() - interval '1 minute' where id = pg_temp.id('ben2');
select is(private.expire_unpaid_bookings(), 1, 'the job cancels one overdue unpaid booking');
select ok((select b.status = 'cancelled' and b.payment_status = 'unpaid'
                  and not exists (select 1 from public.booking_slots s where s.booking_id = b.id and s.status = 'confirmed')
           from public.bookings b where b.id = pg_temp.id('ben2')),
  'the overdue booking is cancelled and its court time released');
select ok(exists (select 1 from public.notifications where user_id = '22222222-2222-4222-8222-222222222222'
                  and kind = 'booking_cancelled'), 'the player is told the booking was cancelled for non-payment');

-- Reminder 30 minutes before the deadline (once), and a fresh window after a rejected receipt
set local role authenticated;
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
insert into ids values ('ben3', pg_temp.book(2, 21));
reset role;
update public.bookings set payment_due_at = now() + interval '20 minutes', confirmed_at = now() - interval '100 minutes'
 where id = pg_temp.id('ben3');
select is(private.remind_unpaid_bookings(), 1, 'the job reminds a player whose payment deadline is 30 minutes away');
select is(private.remind_unpaid_bookings(), 0, 'the payment reminder is sent only once');
select ok(exists (select 1 from public.notifications where user_id = '22222222-2222-4222-8222-222222222222'
                  and kind = 'payment_reminder' and link = '/player/bookings/' || pg_temp.id('ben3')),
  'the reminder links the player to the booking');
update public.bookings set payment_status = 'pending_verification', payment_due_at = now() - interval '1 minute'
 where id = pg_temp.id('ben3');
update public.bookings set payment_status = 'unpaid' where id = pg_temp.id('ben3');
select ok((select payment_due_at > now() + interval '29 minutes' and payment_reminder_sent_at is null
           from public.bookings where id = pg_temp.id('ben3')),
  'a rejected receipt gives the player 30 more minutes to pay instead of an instant cancellation');
select is(private.expire_unpaid_bookings(), 0, 'the booking is not cancelled while the new window is open');

-- Reserve now, pay within minutes (Nov 5 2026): payment_due_minutes replaces the hours for court bookings
reset role;
update public.venue_settings set payment_due_minutes = 30;
set local role authenticated;
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
insert into ids values ('ben4', pg_temp.book(3, 20));
select ok((select payment_due_at between now() + interval '29 minutes' and now() + interval '31 minutes'
           from public.bookings where id = pg_temp.id('ben4')),
  'with a deadline in minutes, a reserved court must be paid within those minutes');
reset role;
select throws_ok($$ update public.venue_settings set payment_due_minutes = 5 $$, '23514', null,
  'the deadline in minutes cannot be shorter than 10 minutes');
update public.bookings set payment_due_at = now() - interval '1 minute' where id = pg_temp.id('ben4');
select is(private.expire_unpaid_bookings(), 1, 'an unpaid court past its minutes deadline is released');
update public.venue_settings set payment_due_minutes = null;

-- ---------------------------------------------------------------------------
-- Dashboard, booking search and player lookup
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select throws_ok($$ select * from public.staff_dashboard() $$, '42501', null, 'players cannot open the dashboard');
select throws_ok($$ select * from public.staff_search_bookings() $$, '42501', null, 'players cannot search bookings');
select throws_ok($$ select * from public.staff_lookup_players('Ben') $$, '42501', null, 'players cannot look up other players');

reset role;
set local role authenticated;
select pg_temp.as_user('33333333-3333-4333-8333-333333333333');
select ok((select courts_total = 3 and pending_payments = 0 and refunds_due = 0 and hours_configured and rates_configured
                  and payment_methods_active = 2 and payment_due_hours = 2
           from public.staff_dashboard()), 'staff see operational status on the dashboard');
select is((select count(*)::int from public.staff_search_bookings('ana')), 1, 'staff can search bookings by player name');
select is((select count(*)::int from public.staff_search_bookings(null, pg_temp.test_day(), pg_temp.test_day(), null, 'paid')),
  1, 'staff can filter bookings by date and payment status');
select ok((select email is null and phone = '09171234567' and bookings_total = 1 from public.staff_lookup_players('reyes')),
  'staff without players.manage see players without their email');
-- An empty search lists every player, so the Players page shows the whole club (Oct 13 2026).
select ok((select count(*) >= 1 from public.staff_lookup_players('')), 'an empty player search lists everyone');

reset role;
set local role authenticated;
select pg_temp.as_user('55555555-5555-4555-8555-555555555555');
select is((select email from public.staff_lookup_players('reyes')), 'ana.reyes@test.local', 'admins see player emails');

select * from finish();
rollback;
