-- Storage: guest receipts through upload grants, private payment proofs and
-- QR codes, public venue assets. Rows in storage.objects are what Supabase
-- Storage writes as the caller.
begin;
select plan(19);
\ir _fixtures.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-4333-8333-333333333333', 'carla.mendoza@test.local', '{"full_name":"Carla Mendoza"}'),
  ('44444444-4444-4444-8444-444444444444', 'dan.villanueva@test.local', '{"full_name":"Dan Villanueva"}'),
  ('55555555-5555-4555-8555-555555555555', 'lea.navarro@test.local', '{"full_name":"Lea Navarro"}');
insert into public.user_roles (user_id, role) values
  ('33333333-3333-4333-8333-333333333333', 'staff'),
  ('44444444-4444-4444-8444-444444444444', 'staff'),
  ('55555555-5555-4555-8555-555555555555', 'admin');
insert into public.staff_permissions (user_id, permission) values
  ('44444444-4444-4444-8444-444444444444', 'payments.verify');

-- Two guest bookings with known tokens (TEST FIXTURES).
insert into public.bookings (id, reference, status, total_centavos, display_name, guest_phone, manage_token_hash) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'PH-TEST-A', 'confirmed', 10000, 'Ana R.', '09170000001', private.token_hash('token-a')),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'PH-TEST-B', 'confirmed', 10000, 'Ben C.', '09170000002', private.token_hash('token-b'));

-- Payment QR codes: one for an active method, one for an inactive one.
insert into public.payment_methods (kind, label, account_name, account_number, qr_image_path, is_active) values
  ('gcash', 'GCash test', 'Test Name', '09170000000', 'qr/active.png', true),
  ('maya', 'Old wallet', 'Test Name', '09170000000', 'qr/old.png', false);
insert into storage.objects (bucket_id, name) values ('payment-qr', 'qr/active.png'), ('payment-qr', 'qr/old.png');

-- ---- A guest (anonymous visitor) ------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
create temp table grant_a as select public.guest_begin_receipt_upload('PH-TEST-A', 'token-a', 'jpg') ->> 'path' as path;

select ok((select path like 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/%/receipt.jpg' from grant_a),
  'the manage link gets an upload path inside its own booking''s folder');
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('payment-proofs', (select path from grant_a)) $$,
  'the guest can upload the receipt to the granted path');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('payment-proofs',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/00000000-0000-4000-8000-000000000000/receipt.jpg') $$,
  '42501', null, 'any other path in the same booking''s folder is refused');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('payment-proofs',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/00000000-0000-4000-8000-000000000000/receipt.jpg') $$,
  '42501', null, 'a guest cannot upload into another booking''s folder');
select is(public.guest_begin_receipt_upload('PH-TEST-B', 'token-a', 'jpg') ->> 'error', 'not_found',
  'another booking''s reference with the wrong token gets no upload path');
select is_empty($$ select 1 from storage.objects where bucket_id = 'payment-proofs' $$,
  'guests cannot list or read payment proofs, even their own');
select is_empty($$ update storage.objects set name = name || '.bak' where bucket_id = 'payment-proofs' returning id $$,
  'guests cannot rename an uploaded receipt');
select is_empty($$ delete from storage.objects where bucket_id = 'payment-proofs' returning id $$,
  'guests cannot delete an uploaded receipt');

reset role;
update private.receipt_upload_grants set expires_at = now() - interval '1 second';
create temp table grant_a2 as select null::text as path;
grant all on grant_a2 to public;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
insert into grant_a2 select public.guest_begin_receipt_upload('PH-TEST-A', 'token-a', 'png') ->> 'path';
reset role;
update private.receipt_upload_grants set expires_at = now() - interval '1 second' where path = (select path from grant_a2 where path is not null);
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('payment-proofs', (select path from grant_a2 where path is not null)) $$,
  '42501', null, 'an expired upload path is refused');
select throws_ok($$ select public.guest_begin_receipt_upload('PH-TEST-A', 'token-a', 'pdf') $$,
  '22023', null, 'only image receipts are accepted');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('venue-assets', 'courts/court-1.jpg') $$,
  '42501', null, 'visitors cannot upload venue images');
select is((select string_agg(name, ',') from storage.objects where bucket_id = 'payment-qr'), 'qr/active.png',
  'visitors can open the QR code of an active payment method only (for checkout)');

-- ---- Carla (staff, no permissions) ----------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select is_empty($$ select 1 from storage.objects where bucket_id = 'payment-proofs' $$,
  'staff without payments.verify cannot open payment proofs');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('payment-qr', 'qr/new.png') $$,
  '42501', null, 'staff who are not admins cannot upload payment QR codes');

-- ---- Dan (payments.verify) ----------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
select isnt_empty($$ select 1 from storage.objects where bucket_id = 'payment-proofs' $$,
  'a payment verifier can open payment proofs');
select throws_ok($$ select 1 from public.bookings where manage_token_hash is not null $$,
  '42501', null, 'staff cannot read or filter on the manage-link token hash');

-- ---- Lea (admin) -------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('venue-assets', 'courts/court-1.jpg') $$,
  'an admin can upload venue images');
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('payment-qr', 'qr/new.png') $$,
  'an admin can upload payment QR codes');
select is((select count(*)::int from storage.buckets where id = 'avatars'), 0, 'there is no avatar bucket (no player accounts)');

reset role;
select * from finish();
rollback;
